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
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalSize, Manager, Size, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_store::{resolve_store_path, StoreExt};

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

const SETTINGS_STORE_FILE: &str = "settings.json";
const HISTORY_DB_FILE: &str = "history.db";
const CAPSULE_WIDTH: f64 = 360.0;
const CAPSULE_HEIGHT: f64 = 96.0;
const CAPSULE_HIDE_DELAY_SUCCESS_SECS: u64 = 2;
const CAPSULE_HIDE_DELAY_ERROR_SECS: u64 = 8;

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

fn sqlite_companion_paths(path: &Path) -> Vec<std::path::PathBuf> {
    let mut paths = Vec::with_capacity(3);
    paths.push(path.to_path_buf());

    let mut wal = path.as_os_str().to_os_string();
    wal.push("-wal");
    paths.push(std::path::PathBuf::from(wal));

    let mut shm = path.as_os_str().to_os_string();
    shm.push("-shm");
    paths.push(std::path::PathBuf::from(shm));

    paths
}

fn move_file_if_exists(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() || target.exists() {
        return Ok(());
    }

    ensure_parent_dir_for_file(target).map_err(|e| {
        format!(
            "Failed to prepare destination '{}' while migrating '{}': {e}",
            target.display(),
            source.display()
        )
    })?;

    match std::fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            std::fs::copy(source, target).map_err(|copy_error| {
                format!(
                    "Failed to migrate '{}' to '{}': rename failed ({rename_error}); copy failed ({copy_error})",
                    source.display(),
                    target.display()
                )
            })?;
            std::fs::remove_file(source).map_err(|remove_error| {
                format!(
                    "Migrated '{}' to '{}' but failed to remove the old file: {remove_error}",
                    source.display(),
                    target.display()
                )
            })?;
            Ok(())
        }
    }
}

fn migrate_sqlite_family_if_needed(source_db_path: &Path, target_db_path: &Path) -> Result<(), String> {
    if target_db_path.exists() || !source_db_path.exists() {
        return Ok(());
    }

    let source_paths = sqlite_companion_paths(source_db_path);
    let target_paths = sqlite_companion_paths(target_db_path);

    for (source, target) in source_paths.iter().zip(target_paths.iter()) {
        move_file_if_exists(source, target)?;
    }

    log::info!(
        "migrated history database from '{}' to '{}'",
        source_db_path.display(),
        target_db_path.display()
    );

    Ok(())
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

    let local_db_path = local_dir.join(HISTORY_DB_FILE);
    if local_db_path.exists() {
        return Ok(local_db_path);
    }

    let roaming_db_path = match app.path().app_data_dir() {
        Ok(dir) => dir.join(HISTORY_DB_FILE),
        Err(e) => {
            log::warn!("failed to resolve roaming app data directory for history migration: {e}");
            return Ok(local_db_path);
        }
    };

    if !roaming_db_path.exists() {
        return Ok(local_db_path);
    }

    match migrate_sqlite_family_if_needed(&roaming_db_path, &local_db_path) {
        Ok(()) => Ok(local_db_path),
        Err(e) => {
            log::warn!(
                "failed to migrate history database to local app data, continuing with existing path '{}': {e}",
                roaming_db_path.display()
            );
            Ok(roaming_db_path)
        }
    }
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

    let (modifier, modifier_matcher) = if matches!(hk_config.hotkey_type, config::HotkeyType::Combo) {
        let modifier_name = hk_config
            .modifier
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or("Combo hotkey requires a modifier")?;

        let modifier_matcher = hotkey::parse_key_match(modifier_name).ok_or_else(|| {
            format!(
                "Unsupported hotkey modifier '{modifier_name}'. Use Alt, Ctrl, Shift, Meta, Space, Tab, CapsLock, Backspace, Enter, or a single letter"
            )
        })?;
        let modifier = modifier_matcher.primary_key();

        if modifier_name.eq_ignore_ascii_case("Escape") || modifier_name.eq_ignore_ascii_case("Esc") {
            return Err("Escape is reserved for cancelling recordings".into());
        }

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

                // Skip history for empty transcriptions (e.g. silence)
                if !pr.raw_text.is_empty() {
                    let entry = HistoryEntry {
                        id: uuid::Uuid::new_v4().to_string(),
                        raw_text: pr.raw_text.clone(),
                        polished_text: pr.polished_text.clone(),
                        created_at: chrono::Utc::now(),
                        duration_seconds: pr.duration_seconds,
                        status: entry_status.into(),
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

                schedule_capsule_hide(
                    app.clone(),
                    Arc::clone(&state.capsule_generation),
                    cap_gen,
                    Duration::from_secs(CAPSULE_HIDE_DELAY_SUCCESS_SECS),
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
        let store_path = ensure_store_parent_dir(&app, SETTINGS_STORE_FILE)?;
        let store = app.store(SETTINGS_STORE_FILE).map_err(|e| e.to_string())?;
        let json = serde_json::to_value(&settings).map_err(|e| e.to_string())?;
        store.set("settings", json);
        store
            .save()
            .map_err(|e| format!("Failed to save settings at {}: {e}", store_path.display()))?;
        Ok(())
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
    state.hotkey_triggers_enabled.store(false, Ordering::SeqCst);
}

#[tauri::command]
fn resume_hotkey_triggers(state: tauri::State<'_, AppState>) {
    state.hotkey_triggers_enabled.store(true, Ordering::SeqCst);
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
    if let Some(capsule) = app.get_webview_window("capsule") {
        capsule
            .set_size(Size::Logical(LogicalSize::new(CAPSULE_WIDTH, CAPSULE_HEIGHT)))
            .ok();
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
        .inner_size(CAPSULE_WIDTH, CAPSULE_HEIGHT)
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
            let history_db_path =
                prepare_history_db_path(&handle).expect("failed to resolve history database path");
            log::info!("history database path: {}", history_db_path.display());
            let history = HistoryManager::new(history_db_path)
                .expect("failed to initialize history database");

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
            if let Err(e) = ensure_store_parent_dir(&handle, SETTINGS_STORE_FILE) {
                log::warn!("failed to prepare settings store for first-run flag: {e}");
            }

            match handle.store(SETTINGS_STORE_FILE) {
                Ok(store) => {
                    if store.get("first_run").is_none() {
                        if let Some(win) = handle.get_webview_window("main") {
                            win.show().ok();
                            win.set_focus().ok();
                        }
                        store.set("first_run", serde_json::Value::Bool(false));
                        if let Err(e) = store.save() {
                            log::warn!("failed to persist first_run flag: {e}");
                        }
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
    fn sqlite_companion_paths_include_sidecars() {
        let db_path = Path::new("history.db");
        let companions = sqlite_companion_paths(db_path);

        assert_eq!(companions.len(), 3);
        assert_eq!(companions[0], Path::new("history.db"));
        assert_eq!(companions[1], Path::new("history.db-wal"));
        assert_eq!(companions[2], Path::new("history.db-shm"));
    }

    #[test]
    fn migrate_sqlite_family_moves_database_and_sidecars() {
        let root = unique_temp_dir("yat-history-migration");
        let old_db = root.join("roaming").join(HISTORY_DB_FILE);
        let new_db = root.join("local").join(HISTORY_DB_FILE);

        ensure_parent_dir_for_file(&old_db).expect("old parent should be created");
        std::fs::write(&old_db, b"main").expect("should write main db");
        std::fs::write(Path::new(&format!("{}-wal", old_db.display())), b"wal")
            .expect("should write wal sidecar");
        std::fs::write(Path::new(&format!("{}-shm", old_db.display())), b"shm")
            .expect("should write shm sidecar");

        migrate_sqlite_family_if_needed(&old_db, &new_db).expect("migration should succeed");

        assert!(new_db.exists());
        assert!(Path::new(&format!("{}-wal", new_db.display())).exists());
        assert!(Path::new(&format!("{}-shm", new_db.display())).exists());
        assert!(!old_db.exists());
        assert!(!Path::new(&format!("{}-wal", old_db.display())).exists());
        assert!(!Path::new(&format!("{}-shm", old_db.display())).exists());

        std::fs::remove_dir_all(root).ok();
    }
}
