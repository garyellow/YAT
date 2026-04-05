mod audio;
mod config;
mod history;
mod hotkey;
mod llm;
mod output;
mod pipeline;
mod stt;
mod volume;

use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_store::StoreExt;

use audio::AudioRecorder;
use config::AppSettings;
use history::{HistoryEntry, HistoryManager};
use hotkey::HotkeySettings;

pub struct AppState {
    pub recorder: Mutex<AudioRecorder>,
    pub settings: Mutex<AppSettings>,
    pub history: Mutex<HistoryManager>,
    pub hotkey_settings: Arc<Mutex<HotkeySettings>>,
    pub mic_level: Arc<AtomicU32>,
    /// Tracks whether system audio was already muted before we auto-muted it.
    pub was_muted: Mutex<bool>,
    /// Incremented each time a new recording starts; auto-stop timers capture
    /// this value and only fire when it still matches, preventing stale timers
    /// from stopping a newer recording.
    pub recording_generation: Arc<AtomicU64>,
    /// Incremented each time the capsule is shown for a new operation; hide
    /// timers capture this value and skip hiding if a newer operation has since
    /// taken ownership of the capsule.
    pub capsule_generation: Arc<AtomicU64>,
    /// Set to `true` while the STT→LLM pipeline is running, preventing a
    /// new recording from starting until the current one finishes.
    pub pipeline_busy: Arc<AtomicBool>,
    /// Controls whether recording hotkeys are allowed to trigger while the
    /// settings window is focused. ESC cancellation still remains available
    /// for active operations.
    pub hotkey_triggers_enabled: Arc<AtomicBool>,
}

#[derive(Serialize)]
struct PlatformContext {
    os: &'static str,
}

// ── Tauri Commands ──────────────────────────────────────────────────

/// RAII guard that sets `pipeline_busy` to `true` on creation and back
/// to `false` on drop — even if the pipeline panics.
struct BusyGuard(Arc<AtomicBool>);

impl BusyGuard {
    fn new(flag: &Arc<AtomicBool>) -> Self {
        flag.store(true, Ordering::SeqCst);
        Self(Arc::clone(flag))
    }
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn hotkey_type_from_config(hk_config: &config::HotkeyConfig) -> hotkey::HotkeyType {
    match hk_config.hotkey_type {
        config::HotkeyType::Single => hotkey::HotkeyType::Single,
        config::HotkeyType::DoubleTap => hotkey::HotkeyType::DoubleTap,
        config::HotkeyType::Combo => hotkey::HotkeyType::Combo,
        config::HotkeyType::Hold => hotkey::HotkeyType::Hold,
    }
}

fn build_hotkey_settings(hk_config: &config::HotkeyConfig) -> Result<HotkeySettings, String> {
    let key_name = hk_config.key.trim();
    if key_name.is_empty() {
        return Err("Hotkey key cannot be empty".into());
    }

    let key_matcher = hotkey::parse_key_match(key_name).ok_or_else(|| {
        format!(
            "Unsupported hotkey key '{key_name}'. Use a single letter, F1-F12, Alt, Ctrl, Shift, Meta, Space, Esc, Tab, CapsLock, Backspace, or Enter"
        )
    })?;
    let key = key_matcher.primary_key();

    if matches!(hk_config.hotkey_type, config::HotkeyType::DoubleTap)
        && !(100..=1000).contains(&hk_config.double_tap_interval_ms)
    {
        return Err("Double-tap interval must be between 100ms and 1000ms".into());
    }

    let (modifier, modifier_matcher) = if matches!(hk_config.hotkey_type, config::HotkeyType::Combo) {
        let modifier_name = hk_config
            .modifier
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or("Combo hotkey requires a modifier")?;

        let modifier_matcher = hotkey::parse_key_match(modifier_name).ok_or_else(|| {
            format!(
                "Unsupported hotkey modifier '{modifier_name}'. Use Alt, Ctrl, Shift, Meta, Space, Esc, Tab, CapsLock, Backspace, Enter, or a single letter"
            )
        })?;
        let modifier = modifier_matcher.primary_key();

        if hotkey::key_patterns_overlap(&key_matcher, &modifier_matcher) {
            return Err("Hotkey key and modifier must be different".into());
        }

        (Some(modifier), Some(modifier_matcher))
    } else {
        (None, None)
    };

    Ok(HotkeySettings {
        hotkey_type: hotkey_type_from_config(hk_config),
        key,
        key_matcher,
        modifier,
        modifier_matcher,
        double_tap_interval_ms: hk_config.double_tap_interval_ms,
    })
}

fn load_hotkey_settings(settings: &mut AppSettings) -> HotkeySettings {
    match build_hotkey_settings(&settings.general.hotkey) {
        Ok(settings) => settings,
        Err(error) => {
            log::warn!("invalid saved hotkey config, falling back to default: {error}");
            settings.general.hotkey = config::HotkeyConfig::default();
            HotkeySettings::default()
        }
    }
}

fn emit_status(app: &AppHandle, status: &str, text: Option<&str>, error: Option<&str>) {
    app.emit(
        "pipeline-status",
        pipeline::PipelineStatus {
            status: status.into(),
            text: text.map(String::from),
            error: error.map(String::from),
        },
    )
    .ok();
}

#[tauri::command]
async fn toggle_recording(
    state: tauri::State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    // Atomically check recording state and stop if active, all within a single
    // lock acquisition.  This eliminates the TOCTOU race where two rapid
    // hotkey presses could both see is_recording()==false and start two
    // concurrent recordings.
    let stop_data = {
        let mut recorder = state.recorder.lock();
        if recorder.is_recording() {
            Some((
                recorder.stop().map_err(|e| e.to_string())?,
                state.recording_generation.load(Ordering::SeqCst),
            ))
        } else {
            None
        }
    };

    if let Some((audio_data, operation_generation)) = stop_data {
        // ── STOP PATH ──────────────────────────────────────────────
        let _busy = BusyGuard::new(&state.pipeline_busy);
        let settings = state.settings.lock().clone();

        // Restore system audio after recording stops
        if settings.general.auto_mute {
            let was_muted = *state.was_muted.lock();
            if let Err(e) = volume::restore_system(was_muted) {
                log::warn!("auto-mute restore failed: {e}");
            }
        }

        // Skip pipeline for very short recordings (< 0.3s) — accidental taps, noise
        let too_short = if audio_data.len() >= 44 {
            let sample_rate = u32::from_le_bytes([
                audio_data[24],
                audio_data[25],
                audio_data[26],
                audio_data[27],
            ]);
            let block_align =
                u16::from_le_bytes([audio_data[32], audio_data[33]]) as u32;
            let data_bytes = (audio_data.len() - 44) as u32;
            let duration_ms = if sample_rate > 0 && block_align > 0 {
                (data_bytes as u64 * 1000) / (sample_rate as u64 * block_align as u64)
            } else {
                0
            };
            if duration_ms < 300 {
                log::info!("recording too short ({duration_ms}ms), skipping pipeline");
                true
            } else {
                false
            }
        } else {
            log::info!("recording data too small, skipping pipeline");
            true
        };

        if too_short {
            emit_status(&app, "done", Some(""), None);
            hide_capsule(&app);
            return Ok(String::new());
        }

        let recent_ctx = state
            .history
            .lock()
            .recent_context(settings.history.context_window_minutes)
            .unwrap_or_default();

        let cap_gen = state.capsule_generation.fetch_add(1, Ordering::SeqCst) + 1;
        show_capsule(&app, "transcribing");

        // All locks released — safe to await.
        // BusyGuard clears the flag even if pipeline::run panics.
        let result = pipeline::run(
            &app,
            audio_data,
            &settings,
            recent_ctx,
            Arc::clone(&state.recording_generation),
            operation_generation,
        )
        .await;
        drop(_busy);

        // Auto-hide capsule after delay (only if no newer operation owns it)
        let app_clone = app.clone();
        let cap_gen_ref = Arc::clone(&state.capsule_generation);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            if cap_gen_ref.load(Ordering::SeqCst) == cap_gen {
                hide_capsule(&app_clone);
            }
        });

        match result {
            Ok(pr) => {
                if pr.suppressed {
                    log::info!("suppressed pipeline result after user cancellation");
                    return Ok(String::new());
                }

                // Skip history for empty transcriptions (e.g. silence)
                if !pr.raw_text.is_empty() {
                    let entry = HistoryEntry {
                        id: uuid::Uuid::new_v4().to_string(),
                        raw_text: pr.raw_text.clone(),
                        polished_text: pr.polished_text.clone(),
                        created_at: chrono::Utc::now(),
                        duration_seconds: pr.duration_seconds,
                        status: "success".into(),
                    };
                    state.history.lock().insert(&entry).ok();
                }
                Ok(pr.polished_text.unwrap_or(pr.raw_text))
            }
            Err(e) => {
                if state.recording_generation.load(Ordering::SeqCst) != operation_generation {
                    log::info!("suppressed pipeline error after user cancellation: {e}");
                    return Ok(String::new());
                }

                let entry = HistoryEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    raw_text: String::new(),
                    polished_text: Some(format!("[Error] {e}")),
                    created_at: chrono::Utc::now(),
                    duration_seconds: 0.0,
                    status: "error".into(),
                };
                state.history.lock().insert(&entry).ok();
                emit_status(&app, "error", None, Some(&e.to_string()));
                Err(e.to_string())
            }
        }
    } else {
        // ── START PATH ─────────────────────────────────────────────

        // Reject if the pipeline is still processing a previous recording.
        if state.pipeline_busy.load(Ordering::SeqCst) {
            emit_status(&app, "busy", None, None);
            return Ok("busy".into());
        }

        let device_name = state.settings.lock().general.microphone_device.clone();
        let auto_mute = state.settings.lock().general.auto_mute;
        let max_secs = state.settings.lock().general.max_recording_seconds as u64;

        let mic_level = Arc::clone(&state.mic_level);

        let generation = {
            let mut recorder = state.recorder.lock();
            // Re-check inside the lock: another call may have started
            // recording between our first check and here. Only the winning
            // start path is allowed to advance the recording generation.
            if recorder.is_recording() {
                return Ok("already recording".into());
            }

            // Auto-mute only for the winning start path so a losing concurrent
            // trigger cannot overwrite `was_muted` or leave the system muted.
            if auto_mute {
                match volume::mute_system() {
                    Ok(was_muted) => *state.was_muted.lock() = was_muted,
                    Err(e) => log::warn!("auto-mute failed: {e}"),
                }
            }

            let generation = state.recording_generation.fetch_add(1, Ordering::SeqCst) + 1;
            recorder
                .start(device_name.as_deref(), mic_level)
                .map_err(|e| {
                    // Restore system audio if recording failed to start
                    if auto_mute {
                        let was_muted = *state.was_muted.lock();
                        volume::restore_system(was_muted).ok();
                    }
                    e.to_string()
                })?;
            generation
        };

        emit_status(&app, "recording", None, None);
        show_capsule(&app, "recording");

        // Auto-stop timer — only fires if the recording generation still
        // matches, preventing a stale timer from stopping a later recording.
        let app_clone = app.clone();
        let gen_ref = Arc::clone(&state.recording_generation);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(max_secs));
            if gen_ref.load(Ordering::SeqCst) != generation {
                log::debug!("auto-stop skipped: recording generation changed");
                return;
            }
            let state = app_clone.state::<AppState>();
            if state.recorder.lock().is_recording() {
                log::info!("auto-stopping after {max_secs}s");
                tauri::async_runtime::block_on(async {
                    match toggle_recording(app_clone.state::<AppState>(), app_clone.clone()).await {
                        Ok(_) => log::info!("auto-stopped recording"),
                        Err(e) => log::error!("auto-stop error: {e}"),
                    }
                });
            }
        });

        // Mic level emitter
        let app_mic = app.clone();
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_millis(100));
                let state = app_mic.state::<AppState>();
                if !state.recorder.lock().is_recording() {
                    break;
                }
                let level = f32::from_bits(state.mic_level.load(Ordering::Relaxed));
                app_mic.emit("mic-level", level).ok();
            }
        });

        Ok("recording".into())
    }
}

#[tauri::command]
async fn cancel_recording(
    state: tauri::State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut restore_audio = false;
    let cancelled = {
        let mut recorder = state.recorder.lock();
        if recorder.is_recording() {
            restore_audio = true;
            // Invalidate the current recording's auto-stop timer before any
            // other task can observe the old generation.
            state.recording_generation.fetch_add(1, Ordering::SeqCst);
            recorder.cancel();
            true
        } else if state.pipeline_busy.load(Ordering::SeqCst) {
            // Mark the in-flight pipeline as cancelled. Network requests may
            // still finish, but their output and status presentation are
            // suppressed once this generation changes.
            state.recording_generation.fetch_add(1, Ordering::SeqCst);
            true
        } else {
            false
        }
    };

    if !cancelled {
        return Ok(());
    }

    // Restore system audio if auto-mute was enabled
    let auto_mute = state.settings.lock().general.auto_mute;
    if restore_audio && auto_mute {
        let was_muted = *state.was_muted.lock();
        if let Err(e) = volume::restore_system(was_muted) {
            log::warn!("auto-mute restore on cancel failed: {e}");
        }
    }

    app.emit("pipeline-status", pipeline::PipelineStatus {
        status: "idle".into(),
        text: None,
        error: None,
    }).ok();
    hide_capsule(&app);
    Ok(())
}

#[tauri::command]
fn get_recording_status(state: tauri::State<'_, AppState>) -> bool {
    state.recorder.lock().is_recording()
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, AppState>, app: AppHandle) -> AppSettings {
    let mut settings = state.settings.lock().clone();

    match app.autolaunch().is_enabled() {
        Ok(is_enabled) => {
            settings.general.auto_start = is_enabled;
            *state.settings.lock() = settings.clone();
        }
        Err(e) => log::warn!("failed to read autostart state: {e}"),
    }

    settings
}

#[tauri::command]
fn get_default_prompt() -> String {
    config::default_system_prompt().to_string()
}

#[tauri::command]
fn get_platform_context() -> PlatformContext {
    PlatformContext {
        os: std::env::consts::OS,
    }
}

#[tauri::command]
async fn save_settings(
    state: tauri::State<'_, AppState>,
    app: AppHandle,
    settings: AppSettings,
) -> Result<(), String> {
    let mut settings = settings;
    settings.general.hotkey.key = settings.general.hotkey.key.trim().to_string();
    settings.general.hotkey.modifier = settings
        .general
        .hotkey
        .modifier
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if !matches!(settings.general.hotkey.hotkey_type, config::HotkeyType::Combo) {
        settings.general.hotkey.modifier = None;
    }

    let validated_hotkey = build_hotkey_settings(&settings.general.hotkey)?;

    // Update hotkey settings (full struct replace so new fields like
    // key_matcher / modifier_matcher are never accidentally dropped).
    *state.hotkey_settings.lock() = validated_hotkey;

    if settings.general.auto_start {
        app.autolaunch().enable().map_err(|e| e.to_string())?;
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())?;
    }

    // Save to store
    let store = app
        .store("settings.json")
        .map_err(|e| e.to_string())?;
    let json = serde_json::to_value(&settings).map_err(|e| e.to_string())?;
    store.set("settings", json);

    // Update in-memory settings
    *state.settings.lock() = settings;
    Ok(())
}

#[tauri::command]
async fn test_stt(stt_config: config::SttConfig) -> Result<String, String> {
    stt::test_connection(&stt_config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn test_llm(llm_config: config::LlmConfig) -> Result<String, String> {
    llm::test_connection(&llm_config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let mut req = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(10));
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let models = body["data"]
        .as_array()
        .ok_or("Invalid response: missing data array".to_string())?
        .iter()
        .filter_map(|m| m["id"].as_str().map(String::from))
        .collect::<Vec<_>>();
    Ok(models)
}

#[tauri::command]
fn get_history(
    state: tauri::State<'_, AppState>,
    query: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<HistoryEntry>, String> {
    state
        .history
        .lock()
        .search(query.as_deref(), limit.unwrap_or(100))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_history(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .history
        .lock()
        .delete(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn retry_history(
    state: tauri::State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> Result<String, String> {
    // Gather all data from locks BEFORE any await
    let entry = state
        .history
        .lock()
        .get_by_id(&id)
        .map_err(|e| e.to_string())?
        .ok_or("entry not found")?;

    let settings = state.settings.lock().clone();

    if !settings.llm.enabled {
        return Err("LLM is disabled".into());
    }

    let cap_gen = state.capsule_generation.fetch_add(1, Ordering::SeqCst) + 1;
    show_capsule(&app, "polishing");

    let recent_ctx = state
        .history
        .lock()
        .recent_context(settings.history.context_window_minutes)
        .unwrap_or_default();

    let system_prompt = pipeline::build_system_prompt(
        &settings.prompt.system_prompt,
        &settings.prompt.user_instructions,
        &settings.prompt.vocabulary,
    );

    // All locks released — safe to await
    let result = llm::polish(
        &settings.llm,
        &system_prompt,
        &entry.raw_text,
        &recent_ctx,
        settings.general.timeout_ms,
        settings.general.max_retries,
    )
    .await
    .map_err(|e| e.to_string())?;

    // Write result back to history
    let updated = HistoryEntry {
        polished_text: Some(result.clone()),
        ..entry
    };
    state
        .history
        .lock()
        .insert(&updated)
        .map_err(|e| e.to_string())?;

    let app_clone = app.clone();
    let cap_gen_ref = Arc::clone(&state.capsule_generation);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        if cap_gen_ref.load(Ordering::SeqCst) == cap_gen {
            hide_capsule(&app_clone);
        }
    });

    Ok(result)
}

#[tauri::command]
fn list_audio_devices() -> Vec<String> {
    audio::list_input_devices()
}

#[tauri::command]
fn clear_old_history(state: tauri::State<'_, AppState>) -> Result<u64, String> {
    let hours = state.settings.lock().history.retention_hours;
    state
        .history
        .lock()
        .clear_old(hours)
        .map_err(|e| e.to_string())
}

// ── Capsule Window Helpers ──────────────────────────────────────────

fn show_capsule(app: &AppHandle, status: &str) {
    if let Some(capsule) = app.get_webview_window("capsule") {
        capsule.show().ok();
        // Do NOT call set_focus(); the capsule is always-on-top so it's
        // visible anyway, and stealing focus would yank keyboard input
        // away from whatever app the user is working in.
        capsule.set_ignore_cursor_events(true).ok();
    } else {
        // Create capsule window
        match WebviewWindowBuilder::new(
            app,
            "capsule",
            WebviewUrl::App("capsule.html".into()),
        )
        .title("YAT")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .inner_size(240.0, 56.0)
        .center()
        .build()
        {
            Ok(w) => {
                w.set_ignore_cursor_events(true).ok();
                log::info!("capsule window created");
            }
            Err(e) => log::error!("failed to create capsule: {e}"),
        }
    }
    app.emit("capsule-status", status).ok();
}

fn hide_capsule(app: &AppHandle) {
    if let Some(capsule) = app.get_webview_window("capsule") {
        capsule.hide().ok();
    }
}

// ── App Setup ───────────────────────────────────────────────────────

fn load_settings(app: &AppHandle) -> AppSettings {
    match app.store("settings.json") {
        Ok(store) => {
            if let Some(val) = store.get("settings") {
                match serde_json::from_value(val.clone()) {
                    Ok(settings) => return settings,
                    Err(e) => log::warn!("failed to parse settings: {e}"),
                }
            }
            AppSettings::default()
        }
        Err(_) => AppSettings::default(),
    }
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItemBuilder::with_id("toggle_window", "Show / 顯示").build(app)?;
    let settings_item = MenuItemBuilder::with_id("settings", "Settings / 設定").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit / 結束").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let _tray = TrayIconBuilder::with_id("yat-tray")
        .menu(&menu)
        .tooltip("YAT – Voice to Text")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle_window" => {
                toggle_main_window(app);
            }
            "settings" => {
                if let Some(win) = app.get_webview_window("main") {
                    win.show().ok();
                    win.set_focus().ok();
                }
                refresh_tray_menu(app);
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_main_window(app);
            }
        })
        .build(app)?;

    Ok(())
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            win.hide().ok();
        } else {
            win.show().ok();
            win.set_focus().ok();
        }
        refresh_tray_menu(app);
    }
}

fn refresh_tray_menu(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id("yat-tray") {
        let visible = app
            .get_webview_window("main")
            .map(|w| w.is_visible().unwrap_or(false))
            .unwrap_or(false);

        let label = if visible {
            "Hide / 隱藏"
        } else {
            "Show / 顯示"
        };

        if let Ok(show_item) = MenuItemBuilder::with_id("toggle_window", label).build(app) {
            if let Ok(settings_item) =
                MenuItemBuilder::with_id("settings", "Settings / 設定").build(app)
            {
                if let Ok(quit_item) =
                    MenuItemBuilder::with_id("quit", "Quit / 結束").build(app)
                {
                    if let Ok(menu) = MenuBuilder::new(app)
                        .item(&show_item)
                        .item(&settings_item)
                        .separator()
                        .item(&quit_item)
                        .build()
                    {
                        tray.set_menu(Some(menu)).ok();
                    }
                }
            }
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|app| {
            let handle = app.handle().clone();

            // Load settings
            let mut settings = load_settings(&handle);

            match handle.autolaunch().is_enabled() {
                Ok(is_enabled) => settings.general.auto_start = is_enabled,
                Err(e) => log::warn!("failed to sync autostart during setup: {e}"),
            }

            // Initialize history manager
            let app_data_dir = handle
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let history =
                HistoryManager::new(app_data_dir).expect("failed to initialize history database");

            // Build hotkey settings from config
            let hotkey_settings = Arc::new(Mutex::new(load_hotkey_settings(&mut settings)));
            let hotkey_triggers_enabled = Arc::new(AtomicBool::new(true));

            // Create app state
            let state = AppState {
                recorder: Mutex::new(AudioRecorder::new()),
                settings: Mutex::new(settings),
                history: Mutex::new(history),
                hotkey_settings: Arc::clone(&hotkey_settings),
                mic_level: Arc::new(AtomicU32::new(0)),
                was_muted: Mutex::new(false),
                recording_generation: Arc::new(AtomicU64::new(0)),
                capsule_generation: Arc::new(AtomicU64::new(0)),
                pipeline_busy: Arc::new(AtomicBool::new(false)),
                hotkey_triggers_enabled: Arc::clone(&hotkey_triggers_enabled),
            };
            app.manage(state);

            if let Some(main_window) = handle.get_webview_window("main") {
                let hotkey_triggers_enabled = Arc::clone(&hotkey_triggers_enabled);
                let handle_for_events = handle.clone();
                main_window.on_window_event(move |event| {
                    match event {
                        WindowEvent::Focused(focused) => {
                            hotkey_triggers_enabled.store(!focused, Ordering::SeqCst);
                        }
                        WindowEvent::CloseRequested { api, .. } => {
                            let state = handle_for_events.state::<AppState>();
                            let close_to_tray = state.settings.lock().general.close_to_tray;
                            if close_to_tray {
                                api.prevent_close();
                                if let Some(win) = handle_for_events.get_webview_window("main") {
                                    win.hide().ok();
                                }
                                refresh_tray_menu(&handle_for_events);
                            }
                        }
                        _ => {}
                    }
                });
            }

            // Setup system tray
            setup_tray(&handle)?;

            // Start global hotkey listener
            let app_handle = handle.clone();
            let app_handle_esc = handle.clone();
            hotkey::start_listener(
                hotkey_settings,
                hotkey_triggers_enabled,
                move || {
                    let app_handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app_handle.state::<AppState>();
                        match toggle_recording(state, app_handle.clone()).await {
                            Ok(_) => {}
                            Err(e) => log::error!("toggle recording error: {e}"),
                        }
                    });
                },
                move || {
                    let app_handle_esc = app_handle_esc.clone();
                    let state = app_handle_esc.state::<AppState>();
                    let should_consume = state.recorder.lock().is_recording()
                        || state.pipeline_busy.load(Ordering::SeqCst);

                    if should_consume {
                        tauri::async_runtime::spawn(async move {
                            let state = app_handle_esc.state::<AppState>();
                            if let Err(e) = cancel_recording(state, app_handle_esc.clone()).await {
                                log::error!("ESC cancel error: {e}");
                            }
                        });
                    }

                    should_consume
                },
            );

            // First-run detection: show settings on first launch
            match handle.store("settings.json") {
                Ok(store) => {
                    if store.get("first_run").is_none() {
                        if let Some(win) = handle.get_webview_window("main") {
                            win.show().ok();
                            win.set_focus().ok();
                        }
                        store.set("first_run", serde_json::Value::Bool(false));
                    }
                }
                Err(e) => log::warn!("failed to check first_run: {e}"),
            }

            // Clean up old history on startup
            let handle2 = handle.clone();
            tauri::async_runtime::spawn(async move {
                let state = handle2.state::<AppState>();
                clear_old_history(state).ok();
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            toggle_recording,
            cancel_recording,
            get_recording_status,
            get_settings,
            save_settings,
            get_default_prompt,
            get_platform_context,
            test_stt,
            test_llm,
            fetch_models,
            get_history,
            delete_history,
            retry_history,
            clear_old_history,
            list_audio_devices,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run YAT");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{HotkeyConfig, HotkeyType};
    use rdev::Key;

    #[test]
    fn build_hotkey_settings_accepts_alt_hold() {
        let config = HotkeyConfig {
            hotkey_type: HotkeyType::Hold,
            key: "Alt".into(),
            modifier: None,
            double_tap_interval_ms: 300,
        };

        let parsed = build_hotkey_settings(&config).expect("Alt hold should stay supported");

        assert_eq!(parsed.hotkey_type, hotkey::HotkeyType::Hold);
        assert_eq!(parsed.key, Key::Alt);
        assert!(parsed.modifier.is_none());
    }

    #[test]
    fn build_hotkey_settings_accepts_alt_single() {
        let config = HotkeyConfig {
            hotkey_type: HotkeyType::Single,
            key: "Alt".into(),
            modifier: None,
            double_tap_interval_ms: 300,
        };

        let parsed = build_hotkey_settings(&config).expect("Alt single should stay supported");

        assert_eq!(parsed.hotkey_type, hotkey::HotkeyType::Single);
        assert_eq!(parsed.key, Key::Alt);
        assert!(parsed.modifier.is_none());
    }
}
