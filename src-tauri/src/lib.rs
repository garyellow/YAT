mod audio;
mod config;
mod context;
mod history;
mod hotkey;
mod llm;
mod output;
mod pipeline;
mod recording_env;
mod stt;

use parking_lot::Mutex;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_store::{resolve_store_path, StoreExt};

use audio::AudioRecorder;
use config::AppSettings;
use history::{HistoryEntry, HistoryManager};
use hotkey::HotkeySettings;

#[derive(Default)]
struct CapturedContext {
    clipboard: Option<String>,
    selection: Option<String>,
    app_info: Option<context::ActiveWindowInfo>,
    input_field: Option<String>,
    screenshot: Option<String>,
}

pub struct AppState {
    pub recorder: Mutex<AudioRecorder>,
    pub settings: Mutex<AppSettings>,
    pub history: Mutex<HistoryManager>,
    pub hotkey_settings: Arc<Mutex<HotkeySettings>>,
    pub mic_level: Arc<AtomicU32>,
    /// Snapshot of the recording environment (mute, media, DND) captured on
    /// recording start; used to restore everything when recording stops.
    pub recording_env_state: Mutex<recording_env::RecordingEnvState>,
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
    /// Tracks whether the main settings window is currently focused.
    pub main_window_focused: AtomicBool,
    /// Tracks whether the user is currently recording a new hotkey binding.
    pub hotkey_capture_active: AtomicBool,
    /// Tracks whether the user has been shown the close-to-tray education
    /// prompt at least once during this session.
    pub close_to_tray_hinted: AtomicBool,
    /// Consecutive paste failures; used to suggest clipboard-only mode.
    pub paste_fail_count: AtomicU32,
    /// Background context capture task for the current recording generation.
    context_capture_task: Mutex<Option<(u64, tauri::async_runtime::JoinHandle<CapturedContext>)>>,
}

#[derive(Serialize)]
struct PlatformContext {
    os: &'static str,
    /// Linux display server type: "wayland", "x11", or "unknown"
    #[serde(skip_serializing_if = "Option::is_none")]
    display_server: Option<String>,
}

const SETTINGS_STORE_FILE: &str = "settings.json";
const HISTORY_DB_FILE: &str = "history.db";
const CAPSULE_WIDTH: f64 = 280.0;
const CAPSULE_HEIGHT: f64 = 32.0;
const CAPSULE_HEIGHT_DETAIL: f64 = 62.0;
const CAPSULE_MAX_HEIGHT: f64 = 160.0;
const CAPSULE_HIDE_DELAY_SUCCESS_SECS: u64 = 2;
const CAPSULE_HIDE_DELAY_ERROR_SECS: u64 = 8;
const CAPSULE_HIDE_DELAY_DISMISSED_SECS: u64 = 1;
const CAPSULE_HIDE_DELAY_NO_SPEECH_SECS: u64 = 2;
const MIN_RECORDING_DURATION_MS: u64 = 500;
const POST_RECORDING_BUFFER_MS: u64 = 300;
const AUTO_CLIPBOARD_FALLBACK_THRESHOLD: u32 = 3;
const CONTEXT_CAPTURE_WAIT_MS: u64 = 1200;

const KEYRING_SERVICE: &str = "com.garyellow.yat";

/// Store an API key into the OS credential store.
fn keyring_set(account: &str, secret: &str) -> Result<(), String> {
    match keyring::Entry::new(KEYRING_SERVICE, account) {
        Ok(entry) => {
            if secret.is_empty() {
                if let Err(e) = entry.delete_credential() {
                    // NotFound is fine — nothing to delete
                    if !matches!(e, keyring::Error::NoEntry) {
                        return Err(format!("failed to delete credential '{account}': {e}"));
                    }
                }
            } else if let Err(e) = entry.set_password(secret) {
                return Err(format!("failed to store credential '{account}': {e}"));
            }

            Ok(())
        }
        Err(e) => Err(format!("failed to access credential entry '{account}': {e}")),
    }
}

/// Retrieve an API key from the OS credential store; returns empty string on failure.
fn keyring_get(account: &str) -> String {
    match keyring::Entry::new(KEYRING_SERVICE, account) {
        Ok(entry) => entry.get_password().unwrap_or_default(),
        Err(e) => {
            log::warn!("keyring entry {account}: {e}");
            String::new()
        }
    }
}

fn ensure_parent_dir_for_file(path: &Path) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn ensure_store_parent_dir(app: &AppHandle, store_name: &str) -> Result<std::path::PathBuf, String> {
    let store_path = resolve_store_path(app, store_name).map_err(|e| e.to_string())?;
    ensure_parent_dir_for_file(&store_path).map_err(|e| {
        format!(
            "Failed to prepare settings directory '{}': {e}",
            store_path
                .parent()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| String::from("<unknown>"))
        )
    })?;
    Ok(store_path)
}

fn sanitize_settings_for_store(settings: &AppSettings) -> AppSettings {
    let mut disk_settings = settings.clone();
    disk_settings.stt.api_key.clear();
    disk_settings.llm.api_key.clear();
    disk_settings
}

fn persist_settings_to_store(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let store_path = ensure_store_parent_dir(app, SETTINGS_STORE_FILE)?;
    let store = app.store(SETTINGS_STORE_FILE).map_err(|e| e.to_string())?;
    let json = serde_json::to_value(settings).map_err(|e| e.to_string())?;

    store.set("settings", json);
    store
        .save()
        .map_err(|e| format!("Failed to save settings at {}: {e}", store_path.display()))
}

fn prepare_history_db_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
        std::fs::create_dir_all(&app_data_dir).map_err(|e| {
            format!(
                "Failed to prepare history directory '{}': {e}",
                app_data_dir.display()
            )
        })?;

        return Ok(app_data_dir.join(HISTORY_DB_FILE));
    }

    #[cfg(target_os = "windows")]
    {
    let local_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve local app data directory: {e}"))?;
    std::fs::create_dir_all(&local_dir).map_err(|e| {
        format!(
            "Failed to prepare history directory '{}': {e}",
            local_dir.display()
        )
    })?;

    Ok(local_dir.join(HISTORY_DB_FILE))
    }
}

fn schedule_capsule_hide(
    app: AppHandle,
    capsule_generation: Arc<AtomicU64>,
    expected_generation: u64,
    delay: Duration,
) {
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        if capsule_generation.load(Ordering::SeqCst) == expected_generation {
            hide_capsule(&app);
        }
    });
}

fn sync_hotkey_triggers_enabled(state: &AppState) {
    let enabled = !state.main_window_focused.load(Ordering::SeqCst)
        && !state.hotkey_capture_active.load(Ordering::SeqCst);
    state.hotkey_triggers_enabled.store(enabled, Ordering::SeqCst);
}

fn capture_context_snapshot(
    context_enabled: bool,
    prompt_cfg: config::PromptConfig,
) -> CapturedContext {
    if !context_enabled {
        return CapturedContext::default();
    }

    // Active window must be captured first — it's needed before any
    // simulated keystrokes (which may change focus).
    let app_info = if prompt_cfg.context_active_app {
        context::get_active_window_info()
    } else {
        None
    };

    let clipboard = if prompt_cfg.context_clipboard {
        context::read_clipboard_text()
    } else {
        None
    };

    let selection = if prompt_cfg.context_selection {
        context::read_selected_text()
    } else {
        None
    };

    let input_field = if prompt_cfg.context_input_field {
        context::read_input_field_text()
    } else {
        None
    };

    let screenshot = if prompt_cfg.context_screenshot {
        context::capture_screenshot_base64()
    } else {
        None
    };

    CapturedContext {
        clipboard,
        selection,
        app_info,
        input_field,
        screenshot,
    }
}

fn replace_context_capture_task(
    state: &AppState,
    generation: u64,
    context_enabled: bool,
    prompt_cfg: config::PromptConfig,
) {
    abort_context_capture_task(state);

    if !context_enabled {
        return;
    }

    let handle = tauri::async_runtime::spawn_blocking(move || {
        capture_context_snapshot(context_enabled, prompt_cfg)
    });

    *state.context_capture_task.lock() = Some((generation, handle));
}

fn abort_context_capture_task(state: &AppState) {
    if let Some((_generation, handle)) = state.context_capture_task.lock().take() {
        handle.abort();
    }
}

async fn await_context_capture(state: &AppState, generation: u64) -> CapturedContext {
    let handle = {
        let mut task = state.context_capture_task.lock();
        match task.take() {
            Some((expected_generation, handle)) if expected_generation == generation => Some(handle),
            Some((_stale_generation, handle)) => {
                handle.abort();
                None
            }
            None => None,
        }
    };

    let Some(handle) = handle else {
        return CapturedContext::default();
    };

    match tokio::time::timeout(Duration::from_millis(CONTEXT_CAPTURE_WAIT_MS), handle).await {
        Ok(Ok(context)) => context,
        Ok(Err(error)) => {
            log::warn!("context capture task failed: {error}");
            CapturedContext::default()
        }
        Err(_) => {
            log::warn!(
                "context capture did not finish within {}ms; continuing without extra context",
                CONTEXT_CAPTURE_WAIT_MS
            );
            CapturedContext::default()
        }
    }
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

    if key_name.eq_ignore_ascii_case("Escape") || key_name.eq_ignore_ascii_case("Esc") {
        return Err("Escape is reserved for cancelling recordings".into());
    }

    let key_matcher = hotkey::parse_key_match(key_name).ok_or_else(|| {
        format!(
            "Unsupported hotkey key '{key_name}'. Use a single letter, F1-F12, Alt, Ctrl, Shift, Meta, Space, Tab, CapsLock, Backspace, or Enter"
        )
    })?;
    let key = key_matcher.primary_key();

    if matches!(hk_config.hotkey_type, config::HotkeyType::DoubleTap)
        && !(100..=1000).contains(&hk_config.double_tap_interval_ms)
    {
        return Err("Double-tap interval must be between 100ms and 1000ms".into());
    }

    let (held_keys, held_key_matchers) = if matches!(hk_config.hotkey_type, config::HotkeyType::Combo) {
        if hk_config.held_keys.is_empty() {
            return Err("Combo hotkey requires at least two keys".into());
        }

        let mut held_keys = Vec::new();
        let mut held_key_matchers = Vec::new();

        for held_key_name in hk_config
            .held_keys
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            if held_key_name.eq_ignore_ascii_case("Escape") || held_key_name.eq_ignore_ascii_case("Esc") {
                return Err("Escape is reserved for cancelling recordings".into());
            }

            let held_key_matcher = hotkey::parse_key_match(held_key_name).ok_or_else(|| {
                format!(
                    "Unsupported combo key '{held_key_name}'. Use Alt, Ctrl, Shift, Meta, Space, Tab, CapsLock, Backspace, Enter, or a single letter"
                )
            })?;

            if hotkey::key_patterns_overlap(&key_matcher, &held_key_matcher)
                || held_key_matchers
                    .iter()
                    .any(|matcher| hotkey::key_patterns_overlap(matcher, &held_key_matcher))
            {
                return Err("All keys in a combo hotkey must be different".into());
            }

            held_keys.push(held_key_matcher.primary_key());
            held_key_matchers.push(held_key_matcher);
        }

        if held_key_matchers.is_empty() {
            return Err("Combo hotkey requires at least two keys".into());
        }

        (held_keys, held_key_matchers)
    } else {
        (Vec::new(), Vec::new())
    };

    Ok(HotkeySettings {
        hotkey_type: hotkey_type_from_config(hk_config),
        key,
        key_matcher,
        held_keys,
        held_key_matchers,
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

    // Post-recording buffer: keep the mic open briefly to capture trailing
    // syllables before actually stopping.
    let needs_buffer = state.recorder.lock().is_recording();
    if needs_buffer {
        tokio::time::sleep(std::time::Duration::from_millis(POST_RECORDING_BUFFER_MS)).await;
    }

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

        // Restore recording environment (mute, media, DND)
        let env_snapshot = state.recording_env_state.lock().clone();
        recording_env::restore(&settings.general, &env_snapshot);

        // Update tray indicator
        if let Some(tray) = app.tray_by_id("yat-tray") {
            tray.set_tooltip(Some("YAT – Voice to Text")).ok();
        }

        // Skip pipeline for very short recordings (< 1s) — accidental taps, noise
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
            if duration_ms < MIN_RECORDING_DURATION_MS {
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
            abort_context_capture_task(&state);
            let cap_gen = state.capsule_generation.fetch_add(1, Ordering::SeqCst) + 1;
            emit_status(&app, "dismissed", None, None);
            schedule_capsule_hide(
                app.clone(),
                Arc::clone(&state.capsule_generation),
                cap_gen,
                Duration::from_secs(CAPSULE_HIDE_DELAY_DISMISSED_SECS),
            );
            return Ok(String::new());
        }

        let CapturedContext {
            clipboard: captured_clipboard_ctx,
            selection: captured_selection_ctx,
            app_info: captured_app_info,
            input_field: captured_input_field_ctx,
            screenshot: captured_screenshot_ctx,
        } = await_context_capture(&state, operation_generation).await;

        // Respect the *current* settings when deciding whether captured context
        // should still be used. This avoids leaking stale context if the user
        // turns polishing or an individual context source off mid-recording.
        let context_enabled = settings.llm.enabled;
        let clipboard_ctx = if context_enabled && settings.prompt.context_clipboard {
            captured_clipboard_ctx
        } else {
            None
        };
        let selection_ctx = if context_enabled && settings.prompt.context_selection {
            captured_selection_ctx
        } else {
            None
        };
        let app_info = if context_enabled && settings.prompt.context_active_app {
            captured_app_info
        } else {
            None
        };
        let input_field_ctx = if context_enabled && settings.prompt.context_input_field {
            captured_input_field_ctx
        } else {
            None
        };
        let screenshot_ctx = if context_enabled && settings.prompt.context_screenshot {
            captured_screenshot_ctx
        } else {
            None
        };

        // Per-app / recent context only matters when the LLM pass is enabled.
        let recent_ctx = if context_enabled {
            let history = state.history.lock();
            let minutes = settings.history.context_window_minutes;
            if let Some(ref info) = app_info {
                let per_app = history
                    .recent_context_for_app(minutes, &info.app_name)
                    .unwrap_or_default();
                if per_app.is_empty() {
                    history.recent_context(minutes).unwrap_or_default()
                } else {
                    per_app
                }
            } else {
                history.recent_context(minutes).unwrap_or_default()
            }
        } else {
            Vec::new()
        };

        let cap_gen = state.capsule_generation.fetch_add(1, Ordering::SeqCst) + 1;
        show_capsule(&app, "transcribing");

        // All locks released — safe to await.
        // BusyGuard clears the flag even if pipeline::run panics.
        let result = pipeline::run(
            &app,
            audio_data,
            &settings,
            recent_ctx,
            clipboard_ctx,
            selection_ctx,
            app_info.as_ref().map(|i| i.app_name.as_str()),
            input_field_ctx,
            screenshot_ctx,
            Arc::clone(&state.recording_generation),
            operation_generation,
            &state.paste_fail_count,
            AUTO_CLIPBOARD_FALLBACK_THRESHOLD,
        )
        .await;
        drop(_busy);

        match result {
            Ok(pr) => {
                if pr.suppressed {
                    log::info!("suppressed pipeline result after user cancellation");
                    return Ok(String::new());
                }

                let final_text = pr.polished_text.clone().unwrap_or_else(|| pr.raw_text.clone());
                let entry_status = if pr.delivery_error.is_some() {
                    "error"
                } else {
                    "success"
                };

                let history_app_name = if context_enabled && settings.prompt.context_active_app {
                    app_info.as_ref().map(|i| i.app_name.clone())
                } else {
                    None
                };

                // Skip history for empty transcriptions (e.g. silence)
                if !pr.raw_text.is_empty() {
                    let entry = HistoryEntry {
                        id: uuid::Uuid::new_v4().to_string(),
                        raw_text: pr.raw_text.clone(),
                        polished_text: pr.polished_text.clone(),
                        created_at: chrono::Utc::now(),
                        duration_seconds: pr.duration_seconds,
                        status: entry_status.into(),
                        app_name: history_app_name.clone(),
                    };
                    if let Err(e) = state.history.lock().insert(&entry) {
                        log::error!("failed to save history entry: {e}");
                    }
                }

                if let Some(error) = pr.delivery_error {
                    schedule_capsule_hide(
                        app.clone(),
                        Arc::clone(&state.capsule_generation),
                        cap_gen,
                        Duration::from_secs(CAPSULE_HIDE_DELAY_ERROR_SECS),
                    );
                    return Err(error);
                }

                // Use a shorter hide delay for no-speech results
                let hide_delay = if pr.raw_text.is_empty() {
                    CAPSULE_HIDE_DELAY_NO_SPEECH_SECS
                } else {
                    CAPSULE_HIDE_DELAY_SUCCESS_SECS
                };

                schedule_capsule_hide(
                    app.clone(),
                    Arc::clone(&state.capsule_generation),
                    cap_gen,
                    Duration::from_secs(hide_delay),
                );

                Ok(final_text)
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
                    app_name: if context_enabled && settings.prompt.context_active_app {
                        app_info.as_ref().map(|i| i.app_name.clone())
                    } else {
                        None
                    },
                };
                if let Err(db_err) = state.history.lock().insert(&entry) {
                    log::error!("failed to save history entry: {db_err}");
                }
                emit_status(&app, "error", None, Some(&e.to_string()));

                schedule_capsule_hide(
                    app.clone(),
                    Arc::clone(&state.capsule_generation),
                    cap_gen,
                    Duration::from_secs(CAPSULE_HIDE_DELAY_ERROR_SECS),
                );

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

        let settings_snapshot = state.settings.lock().clone();
        let general = settings_snapshot.general.clone();
        let device_name = general.microphone_device.clone();
        let max_secs = general.max_recording_seconds as u64;

        let context_enabled = settings_snapshot.llm.enabled;
        let prompt_cfg = settings_snapshot.prompt;

        let mic_level = Arc::clone(&state.mic_level);

        let generation = {
            let mut recorder = state.recorder.lock();
            // Re-check inside the lock: another call may have started
            // recording between our first check and here. Only the winning
            // start path is allowed to advance the recording generation.
            if recorder.is_recording() {
                return Ok("already recording".into());
            }

            // Prepare recording environment (pause media, mute, enable DND)
            // inside the lock so a losing concurrent trigger cannot conflict.
            let env_state = recording_env::prepare(&general);
            *state.recording_env_state.lock() = env_state;

            let generation = state.recording_generation.fetch_add(1, Ordering::SeqCst) + 1;
            recorder
                .start(device_name.as_deref(), mic_level)
                .map_err(|e| {
                    // Restore recording environment if start failed
                    let env_snapshot = state.recording_env_state.lock().clone();
                    recording_env::restore(&general, &env_snapshot);
                    e.to_string()
                })?;
            generation
        };

        // Capture context in the background after the mic starts so dictation
        // begins instantly, while still keeping the result tied to this exact
        // recording generation.
        replace_context_capture_task(&state, generation, context_enabled, prompt_cfg);

        emit_status(&app, "recording", None, None);
        show_capsule(&app, "recording");

        // Update tray indicator
        if let Some(tray) = app.tray_by_id("yat-tray") {
            tray.set_tooltip(Some("YAT – 🔴 Recording…")).ok();
        }

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

    abort_context_capture_task(&state);

    // Restore recording environment (mute, media, DND) if recording was active
    if restore_audio {
        let settings = state.settings.lock().clone();
        let env_snapshot = state.recording_env_state.lock().clone();
        recording_env::restore(&settings.general, &env_snapshot);
    }

    // Reset tray indicator
    if let Some(tray) = app.tray_by_id("yat-tray") {
        tray.set_tooltip(Some("YAT – Voice to Text")).ok();
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
        display_server: if cfg!(target_os = "linux") {
            Some(
                std::env::var("XDG_SESSION_TYPE")
                    .unwrap_or_else(|_| {
                        if std::env::var("WAYLAND_DISPLAY").is_ok() {
                            "wayland".into()
                        } else {
                            "unknown".into()
                        }
                    })
            )
        } else {
            None
        },
    }
}

#[tauri::command]
async fn save_settings(
    state: tauri::State<'_, AppState>,
    app: AppHandle,
    settings: AppSettings,
) -> Result<(), String> {
    let mut settings = settings;
    settings.stt.base_url = settings.stt.base_url.trim().to_string();
    settings.stt.api_key = settings.stt.api_key.trim().to_string();
    settings.stt.model = settings.stt.model.trim().to_string();
    settings.stt.language = settings
        .stt
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    settings.llm.base_url = settings.llm.base_url.trim().to_string();
    settings.llm.api_key = settings.llm.api_key.trim().to_string();
    settings.llm.model = settings.llm.model.trim().to_string();
    settings.general.hotkey.key = settings.general.hotkey.key.trim().to_string();
    settings.general.hotkey.held_keys = settings
        .general
        .hotkey
        .held_keys
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect();

    if !matches!(settings.general.hotkey.hotkey_type, config::HotkeyType::Combo) {
        settings.general.hotkey.held_keys.clear();
    }

    let validated_hotkey = build_hotkey_settings(&settings.general.hotkey)?;

    let previous_autostart = app.autolaunch().is_enabled().map_err(|e| e.to_string())?;
    let autostart_changed = previous_autostart != settings.general.auto_start;

    if autostart_changed {
        let autostart_result = if settings.general.auto_start {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        };
        autostart_result.map_err(|e| e.to_string())?;
    }

    let persist_result = (|| -> Result<(), String> {
        // Store API keys in OS credential store and strip from disk JSON
        keyring_set("stt_api_key", &settings.stt.api_key)?;
        keyring_set("llm_api_key", &settings.llm.api_key)?;

        let disk_settings = sanitize_settings_for_store(&settings);
        persist_settings_to_store(&app, &disk_settings)
    })();

    if let Err(error) = persist_result {
        if autostart_changed {
            let rollback_result = if previous_autostart {
                app.autolaunch().enable()
            } else {
                app.autolaunch().disable()
            };

            if let Err(rollback_error) = rollback_result {
                log::error!(
                    "failed to roll back autostart state after settings save failure: {rollback_error}"
                );
            }
        }

        return Err(error);
    }

    // Update hotkey settings only after persistence succeeds so runtime state
    // never diverges from what was actually written to disk.
    *state.hotkey_settings.lock() = validated_hotkey;

    // Update in-memory settings
    *state.settings.lock() = settings;
    Ok(())
}

#[tauri::command]
fn suspend_hotkey_triggers(state: tauri::State<'_, AppState>) {
    state.hotkey_capture_active.store(true, Ordering::SeqCst);
    sync_hotkey_triggers_enabled(&state);
}

#[tauri::command]
fn resume_hotkey_triggers(state: tauri::State<'_, AppState>) {
    state.hotkey_capture_active.store(false, Ordering::SeqCst);
    sync_hotkey_triggers_enabled(&state);
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
        None,
        settings.general.timeout_ms,
        settings.general.max_retries,
    )
    .await
    .map_err(|e| {
        let message = e.to_string();
        emit_status(&app, "error", None, Some(&message));
        schedule_capsule_hide(
            app.clone(),
            Arc::clone(&state.capsule_generation),
            cap_gen,
            Duration::from_secs(CAPSULE_HIDE_DELAY_ERROR_SECS),
        );
        message
    })?;

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

    emit_status(&app, "done", Some(&result), None);
    schedule_capsule_hide(
        app.clone(),
        Arc::clone(&state.capsule_generation),
        cap_gen,
        Duration::from_secs(CAPSULE_HIDE_DELAY_SUCCESS_SECS),
    );

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
    let height = match status {
        "error" | "clipboardFallback" | "dismissed" | "noSpeech" => CAPSULE_HEIGHT_DETAIL,
        _ => CAPSULE_HEIGHT,
    };

    // Resolve the monitor where the user is currently working.
    // Use cursor position → monitor_from_point so that capsule always appears
    // on the active screen in multi-monitor setups.
    let position_on_active_monitor =
        |app: &AppHandle, window: &tauri::WebviewWindow| {
        let monitor = app
            .cursor_position()
            .ok()
            .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
            .or_else(|| app.primary_monitor().ok().flatten());

        if let Some(mon) = monitor {
            let scale = mon.scale_factor();
            let mon_pos = mon.position();
            let mon_size = mon.size();
            // Convert to logical coordinates
            let mon_x = mon_pos.x as f64 / scale;
            let mon_y = mon_pos.y as f64 / scale;
            let mon_w = mon_size.width as f64 / scale;
            // Center horizontally on that monitor, 16 lp below the top edge
            let x = mon_x + (mon_w - CAPSULE_WIDTH) / 2.0;
            let y = mon_y + 16.0;
            window
                .set_position(Position::Logical(LogicalPosition::new(x, y)))
                .ok();
        }
    };

    if let Some(capsule) = app.get_webview_window("capsule") {
        capsule
            .set_size(Size::Logical(LogicalSize::new(CAPSULE_WIDTH, height)))
            .ok();
        position_on_active_monitor(app, &capsule);
        capsule.show().ok();
        capsule.set_ignore_cursor_events(true).ok();
    } else {
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
        .inner_size(CAPSULE_WIDTH, height)
        .build()
        {
            Ok(w) => {
                position_on_active_monitor(app, &w);
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

/// Resize the capsule window and reposition to keep the bottom edge fixed.
/// Called from the frontend when detail text appears/disappears.
#[tauri::command]
fn resize_capsule(app: AppHandle, height: f64) {
    let h = height.clamp(CAPSULE_HEIGHT, CAPSULE_MAX_HEIGHT);
    if let Some(capsule) = app.get_webview_window("capsule") {
        capsule
            .set_size(Size::Logical(LogicalSize::new(CAPSULE_WIDTH, h)))
            .ok();
        // Re-centre on the active monitor (top position stays the same
        // regardless of height since we anchor to the top edge)
        let monitor = app
            .cursor_position()
            .ok()
            .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
            .or_else(|| app.primary_monitor().ok().flatten());
        if let Some(mon) = monitor {
            let scale = mon.scale_factor();
            let mon_pos = mon.position();
            let mon_size = mon.size();
            let mon_x = mon_pos.x as f64 / scale;
            let mon_y = mon_pos.y as f64 / scale;
            let mon_w = mon_size.width as f64 / scale;
            let x = mon_x + (mon_w - CAPSULE_WIDTH) / 2.0;
            let y = mon_y + 16.0;
            capsule
                .set_position(Position::Logical(LogicalPosition::new(x, y)))
                .ok();
        }
    }
}

// ── App Setup ───────────────────────────────────────────────────────

fn load_settings(app: &AppHandle) -> AppSettings {
    let mut settings = load_settings_from_store(app);

    let legacy_stt_key = (!settings.stt.api_key.is_empty()).then(|| settings.stt.api_key.clone());
    let legacy_llm_key = (!settings.llm.api_key.is_empty()).then(|| settings.llm.api_key.clone());

    // Inject API keys from OS credential store
    let mut stt_key = keyring_get("stt_api_key");
    let mut llm_key = keyring_get("llm_api_key");

    let mut should_scrub_store = false;

    // Migration: if keys are still in the JSON file, move them to keyring
    if let Some(legacy_key) = legacy_stt_key.as_deref() {
        if stt_key.is_empty() {
            match keyring_set("stt_api_key", legacy_key) {
                Ok(()) => {
                    stt_key = legacy_key.to_string();
                    should_scrub_store = true;
                    log::info!("migrated STT API key to OS credential store");
                }
                Err(e) => log::warn!("failed to migrate STT API key to OS credential store: {e}"),
            }
        } else {
            should_scrub_store = true;
        }
    }
    if let Some(legacy_key) = legacy_llm_key.as_deref() {
        if llm_key.is_empty() {
            match keyring_set("llm_api_key", legacy_key) {
                Ok(()) => {
                    llm_key = legacy_key.to_string();
                    should_scrub_store = true;
                    log::info!("migrated LLM API key to OS credential store");
                }
                Err(e) => log::warn!("failed to migrate LLM API key to OS credential store: {e}"),
            }
        } else {
            should_scrub_store = true;
        }
    }

    if should_scrub_store {
        let disk_settings = sanitize_settings_for_store(&settings);
        if let Err(e) = persist_settings_to_store(app, &disk_settings) {
            log::warn!("failed to scrub legacy API keys from settings store: {e}");
        }
    }

    // Prefer keyring values; fall back to stored ones (pre-migration)
    if !stt_key.is_empty() {
        settings.stt.api_key = stt_key;
    } else if let Some(legacy_key) = legacy_stt_key {
        settings.stt.api_key = legacy_key;
    }
    if !llm_key.is_empty() {
        settings.llm.api_key = llm_key;
    } else if let Some(legacy_key) = legacy_llm_key {
        settings.llm.api_key = legacy_key;
    }

    settings
}

fn load_settings_from_store(app: &AppHandle) -> AppSettings {
    match ensure_store_parent_dir(app, SETTINGS_STORE_FILE) {
        Ok(path) => {
            log::info!("settings store path: {}", path.display());
        }
        Err(e) => {
            log::warn!("failed to prepare settings store directory: {e}");
            return AppSettings::default();
        }
    }

    match app.store(SETTINGS_STORE_FILE) {
        Ok(store) => {
            if let Some(val) = store.get("settings") {
                match serde_json::from_value(val.clone()) {
                    Ok(settings) => return settings,
                    Err(e) => {
                        log::warn!("failed to parse settings, fallback to defaults: {e}");
                    }
                }
            }

            let defaults = AppSettings::default();
            match serde_json::to_value(&defaults) {
                Ok(json) => {
                    store.set("settings", json);
                    if let Err(e) = store.save() {
                        log::warn!("failed to persist default settings: {e}");
                    }
                }
                Err(e) => log::warn!("failed to serialize default settings: {e}"),
            }

            defaults
        }
        Err(e) => {
            log::warn!("failed to open settings store: {e}");
            AppSettings::default()
        }
    }
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItemBuilder::with_id("toggle_window", "Show / 顯示").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit / 結束").build(app)?;
    let show_menu_on_left_click = cfg!(target_os = "linux");

    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let mut tray_builder = TrayIconBuilder::with_id("yat-tray")
        .menu(&menu)
        .icon_as_template(true)
        .show_menu_on_left_click(show_menu_on_left_click)
        .tooltip("YAT – Voice to Text");

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    #[cfg(target_os = "linux")]
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        tray_builder = tray_builder.temp_dir_path(cache_dir);
    }

    let _tray = tray_builder
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle_window" => {
                toggle_main_window(app);
            }
            "quit" => {
                // Flush the settings store so the last autosave-debounce is not lost
                if let Ok(store) = app.store(SETTINGS_STORE_FILE) {
                    if let Err(e) = store.save() {
                        log::warn!("failed to flush settings on quit: {e}");
                    }
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if cfg!(target_os = "linux") {
                return;
            }

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

#[cfg(target_os = "macos")]
fn sync_macos_activation_policy(app: &AppHandle, main_window_visible: bool) {
    let policy = if main_window_visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };

    app.set_activation_policy(policy);
}

#[cfg(not(target_os = "macos"))]
fn sync_macos_activation_policy(_app: &AppHandle, _main_window_visible: bool) {}

fn toggle_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            win.hide().ok();
            sync_macos_activation_policy(app, false);
        } else {
            sync_macos_activation_policy(app, true);
            win.unminimize().ok();
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
            if let Ok(quit_item) =
                MenuItemBuilder::with_id("quit", "Quit / 結束").build(app)
            {
                if let Ok(menu) = MenuBuilder::new(app)
                    .item(&show_item)
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
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
            let history_db_path =
                prepare_history_db_path(&handle).expect("failed to resolve history database path");
            log::info!("history database path: {}", history_db_path.display());
            let history = HistoryManager::new(history_db_path)
                .expect("failed to initialize history database");

            let launched_by_autostart = std::env::args().any(|a| a == "--autostart");
            let start_hidden = launched_by_autostart && settings.general.start_minimized;

            // Build hotkey settings from config
            let hotkey_settings = Arc::new(Mutex::new(load_hotkey_settings(&mut settings)));
            let hotkey_triggers_enabled = Arc::new(AtomicBool::new(start_hidden));

            // Create app state
            let state = AppState {
                recorder: Mutex::new(AudioRecorder::new()),
                settings: Mutex::new(settings),
                history: Mutex::new(history),
                hotkey_settings: Arc::clone(&hotkey_settings),
                mic_level: Arc::new(AtomicU32::new(0)),
                recording_env_state: Mutex::new(recording_env::RecordingEnvState::default()),
                recording_generation: Arc::new(AtomicU64::new(0)),
                capsule_generation: Arc::new(AtomicU64::new(0)),
                pipeline_busy: Arc::new(AtomicBool::new(false)),
                hotkey_triggers_enabled: Arc::clone(&hotkey_triggers_enabled),
                main_window_focused: AtomicBool::new(!start_hidden),
                hotkey_capture_active: AtomicBool::new(false),
                close_to_tray_hinted: AtomicBool::new(false),
                paste_fail_count: AtomicU32::new(0),
                context_capture_task: Mutex::new(None),
            };
            app.manage(state);
            sync_hotkey_triggers_enabled(&handle.state::<AppState>());

            if let Some(main_window) = handle.get_webview_window("main") {
                let handle_for_events = handle.clone();
                main_window.on_window_event(move |event| {
                    match event {
                        WindowEvent::Focused(focused) => {
                            let state = handle_for_events.state::<AppState>();
                            state.main_window_focused.store(*focused, Ordering::SeqCst);
                            sync_hotkey_triggers_enabled(&state);
                        }
                        WindowEvent::CloseRequested { api, .. } => {
                            let state = handle_for_events.state::<AppState>();
                            let close_to_tray = state.settings.lock().general.close_to_tray;
                            if close_to_tray {
                                api.prevent_close();
                                if let Some(win) = handle_for_events.get_webview_window("main") {
                                    win.hide().ok();
                                }
                                sync_macos_activation_policy(&handle_for_events, false);
                                refresh_tray_menu(&handle_for_events);

                                // Show a one-time education hint the first time the window hides to tray
                                if !state
                                    .close_to_tray_hinted
                                    .swap(true, Ordering::SeqCst)
                                {
                                    handle_for_events
                                        .emit("close-to-tray-hint", ())
                                        .ok();
                                }
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
                            Err(e) => {
                                log::error!("toggle recording error: {e}");
                                emit_status(&app_handle, "error", None, Some(&e));
                                let cap_gen = app_handle
                                    .state::<AppState>()
                                    .capsule_generation
                                    .fetch_add(1, Ordering::SeqCst)
                                    + 1;
                                show_capsule(&app_handle, "error");
                                schedule_capsule_hide(
                                    app_handle.clone(),
                                    Arc::clone(
                                        &app_handle.state::<AppState>().capsule_generation,
                                    ),
                                    cap_gen,
                                    Duration::from_secs(CAPSULE_HIDE_DELAY_ERROR_SECS),
                                );
                            }
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

            // Show main window unless autostart + user prefers to start minimised
            let start_minimized = handle.state::<AppState>().settings.lock().general.start_minimized;
            if !(launched_by_autostart && start_minimized) {
                if let Some(win) = handle.get_webview_window("main") {
                    sync_macos_activation_policy(&handle, true);
                    win.unminimize().ok();
                    win.show().ok();
                    win.set_focus().ok();
                }
            } else {
                sync_macos_activation_policy(&handle, false);
            }
            refresh_tray_menu(&handle);

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
            suspend_hotkey_triggers,
            resume_hotkey_triggers,
            get_default_prompt,
            get_platform_context,
            test_stt,
            test_llm,
            get_history,
            delete_history,
            retry_history,
            clear_old_history,
            list_audio_devices,
            resize_capsule,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run YAT");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{HotkeyConfig, HotkeyType};
    use rdev::Key;

    fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn build_hotkey_settings_accepts_alt_hold() {
        let config = HotkeyConfig {
            hotkey_type: HotkeyType::Hold,
            key: "Alt".into(),
            held_keys: Vec::new(),
            double_tap_interval_ms: 300,
        };

        let parsed = build_hotkey_settings(&config).expect("Alt hold should stay supported");

        assert_eq!(parsed.hotkey_type, hotkey::HotkeyType::Hold);
        assert_eq!(parsed.key, Key::Alt);
        assert!(parsed.held_keys.is_empty());
    }

    #[test]
    fn build_hotkey_settings_accepts_alt_single() {
        let config = HotkeyConfig {
            hotkey_type: HotkeyType::Single,
            key: "Alt".into(),
            held_keys: Vec::new(),
            double_tap_interval_ms: 300,
        };

        let parsed = build_hotkey_settings(&config).expect("Alt single should stay supported");

        assert_eq!(parsed.hotkey_type, hotkey::HotkeyType::Single);
        assert_eq!(parsed.key, Key::Alt);
        assert!(parsed.held_keys.is_empty());
    }

    #[test]
    fn ensure_parent_dir_for_file_creates_missing_directories() {
        let root = unique_temp_dir("yat-settings");
        let file_path = root.join("nested").join("settings.json");

        assert!(!file_path.parent().expect("parent dir").exists());

        ensure_parent_dir_for_file(&file_path).expect("should create parent dirs");

        assert!(file_path.parent().expect("parent dir").exists());

        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn sanitize_settings_for_store_clears_api_keys_only() {
        let mut settings = AppSettings::default();
        settings.stt.api_key = "stt-secret".into();
        settings.llm.api_key = "llm-secret".into();
        settings.stt.base_url = "https://example.invalid/v1".into();
        settings.llm.enabled = true;

        let sanitized = sanitize_settings_for_store(&settings);

        assert!(sanitized.stt.api_key.is_empty());
        assert!(sanitized.llm.api_key.is_empty());
        assert_eq!(sanitized.stt.base_url, "https://example.invalid/v1");
        assert!(sanitized.llm.enabled);
    }
}
