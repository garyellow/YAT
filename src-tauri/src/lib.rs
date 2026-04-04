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
use std::sync::Arc;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
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
}

// ── Tauri Commands ──────────────────────────────────────────────────

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
    let is_recording = state.recorder.lock().is_recording();

    if is_recording {
        // Stop recording and collect all data from locks BEFORE any await
        let auto_mute = state.settings.lock().general.auto_mute;
        let audio_data = state.recorder.lock().stop().map_err(|e| e.to_string())?;
        let settings = state.settings.lock().clone();

        // Restore system audio after recording stops
        if auto_mute {
            if let Err(e) = volume::restore_system() {
                log::warn!("auto-mute restore failed: {e}");
            }
        }
        let recent_ctx = state
            .history
            .lock()
            .recent_context(settings.history.context_window_minutes)
            .unwrap_or_default();

        show_capsule(&app, "transcribing");

        // All locks released — safe to await
        let result = pipeline::run(&app, audio_data, &settings, recent_ctx).await;

        // Auto-hide capsule after delay
        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            hide_capsule(&app_clone);
        });

        match result {
            Ok(pr) => {
                let entry = HistoryEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    raw_text: pr.raw_text.clone(),
                    polished_text: pr.polished_text.clone(),
                    created_at: chrono::Utc::now(),
                    duration_seconds: pr.duration_seconds,
                    status: "success".into(),
                };
                state.history.lock().insert(&entry).ok();
                Ok(pr.polished_text.unwrap_or(pr.raw_text))
            }
            Err(e) => {
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
        // Start recording
        let device_name = state.settings.lock().general.microphone_device.clone();
        let auto_mute = state.settings.lock().general.auto_mute;
        let max_secs = state.settings.lock().general.max_recording_seconds as u64;

        // Auto-mute system audio if enabled
        if auto_mute {
            if let Err(e) = volume::mute_system() {
                log::warn!("auto-mute failed: {e}");
            }
        }

        state
            .recorder
            .lock()
            .start(device_name.as_deref())
            .map_err(|e| {
                // Restore system audio if recording failed to start
                if auto_mute {
                    volume::restore_system().ok();
                }
                e.to_string()
            })?;

        emit_status(&app, "recording", None, None);
        show_capsule(&app, "recording");

        // Auto-stop timer
        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(max_secs));
            let state = app_clone.state::<AppState>();
            if state.recorder.lock().is_recording() {
                log::info!("auto-stopping after {max_secs}s");
                // Directly invoke stop logic instead of calling async toggle_recording
                tauri::async_runtime::block_on(async {
                    match toggle_recording(app_clone.state::<AppState>(), app_clone.clone()).await {
                        Ok(_) => log::info!("auto-stopped recording"),
                        Err(e) => log::error!("auto-stop error: {e}"),
                    }
                });
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
    state.recorder.lock().cancel();
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
fn get_settings(state: tauri::State<'_, AppState>) -> AppSettings {
    state.settings.lock().clone()
}

#[tauri::command]
async fn save_settings(
    state: tauri::State<'_, AppState>,
    app: AppHandle,
    settings: AppSettings,
) -> Result<(), String> {
    // Update hotkey settings
    {
        let hk = &settings.general.hotkey;
        let key = hotkey::parse_key(&hk.key).unwrap_or(rdev::Key::Alt);
        let modifier = hk.modifier.as_deref().and_then(hotkey::parse_key);
        let hotkey_type = match hk.hotkey_type {
            config::HotkeyType::Single => hotkey::HotkeyType::Single,
            config::HotkeyType::DoubleTap => hotkey::HotkeyType::DoubleTap,
            config::HotkeyType::Combo => hotkey::HotkeyType::Combo,
        };
        let mut hs = state.hotkey_settings.lock();
        hs.hotkey_type = hotkey_type;
        hs.key = key;
        hs.modifier = modifier;
        hs.double_tap_interval_ms = hk.double_tap_interval_ms;
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

    show_capsule(&app, "polishing");

    let recent_ctx = state
        .history
        .lock()
        .recent_context(settings.history.context_window_minutes)
        .unwrap_or_default();

    let system_prompt = {
        let mut p = settings.prompt.system_prompt.clone();
        if !settings.prompt.vocabulary.is_empty() {
            p.push_str("\n\nVocabulary corrections:\n");
            for v in &settings.prompt.vocabulary {
                p.push_str(&format!("- \"{}\" → \"{}\"\n", v.wrong, v.correct));
            }
        }
        p
    };

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
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        hide_capsule(&app_clone);
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
        capsule.set_focus().ok();
    } else {
        // Create capsule window
        match WebviewWindowBuilder::new(
            app,
            "capsule",
            WebviewUrl::App("capsule.html".into()),
        )
        .title("YATL")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .inner_size(240.0, 56.0)
        .center()
        .build()
        {
            Ok(_) => log::info!("capsule window created"),
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
    let settings_item = MenuItemBuilder::with_id("settings", "Settings / 設定").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit / 結束").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("YATL – Voice to Text")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "settings" => {
                if let Some(win) = app.get_webview_window("main") {
                    win.show().ok();
                    win.set_focus().ok();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    win.show().ok();
                    win.set_focus().ok();
                }
            }
        })
        .build(app)?;

    Ok(())
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
            let settings = load_settings(&handle);

            // Initialize history manager
            let app_data_dir = handle
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let history =
                HistoryManager::new(app_data_dir).expect("failed to initialize history database");

            // Build hotkey settings from config
            let hk_config = &settings.general.hotkey;
            let key = hotkey::parse_key(&hk_config.key).unwrap_or(rdev::Key::Alt);
            let modifier = hk_config.modifier.as_deref().and_then(hotkey::parse_key);
            let hotkey_type = match hk_config.hotkey_type {
                config::HotkeyType::Single => hotkey::HotkeyType::Single,
                config::HotkeyType::DoubleTap => hotkey::HotkeyType::DoubleTap,
                config::HotkeyType::Combo => hotkey::HotkeyType::Combo,
            };
            let hotkey_settings = Arc::new(Mutex::new(HotkeySettings {
                hotkey_type,
                key,
                modifier,
                double_tap_interval_ms: hk_config.double_tap_interval_ms,
            }));

            // Create app state
            let state = AppState {
                recorder: Mutex::new(AudioRecorder::new()),
                settings: Mutex::new(settings),
                history: Mutex::new(history),
                hotkey_settings: Arc::clone(&hotkey_settings),
            };
            app.manage(state);

            // Setup system tray
            setup_tray(&handle)?;

            // Start global hotkey listener
            let app_handle = handle.clone();
            hotkey::start_listener(hotkey_settings, move || {
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>();
                    match toggle_recording(state, app_handle.clone()).await {
                        Ok(_) => {}
                        Err(e) => log::error!("toggle recording error: {e}"),
                    }
                });
            });

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
            test_stt,
            test_llm,
            get_history,
            delete_history,
            retry_history,
            clear_old_history,
            list_audio_devices,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run YATL");
}
