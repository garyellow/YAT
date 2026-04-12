//! Recording environment management — all side-effects that should be applied
//! when recording starts and reverted when it stops.
//!
//! Consolidates system mute, media pause, and DND into a single module with
//! a unified `prepare()` / `restore()` API so the caller does not have to
//! coordinate multiple modules.

use crate::config::GeneralConfig;

// ── Public API ──────────────────────────────────────────────────────

/// State captured on recording start. Passed to [`restore`] to undo only what
/// was changed, so we never leave the system in an altered state.
#[derive(Clone, Default)]
pub struct RecordingEnvState {
    was_muted: bool,
    paused_sessions: Vec<String>,
    dnd_was_off: bool,
}

/// Prepare the recording environment according to the user's settings.
/// Returns a snapshot that **must** be passed to [`restore`] when recording
/// stops.
///
/// Order of operations matters:
/// 1. Pause media first (stops audio production)
/// 2. Mute system audio (silences remaining sounds + prevents feedback)
/// 3. Enable DND (suppresses visual/audio notifications)
pub fn prepare(general: &GeneralConfig) -> RecordingEnvState {
    let mut env = RecordingEnvState::default();

    if general.auto_pause_media {
        match pause_media() {
            Ok(ids) => env.paused_sessions = ids,
            Err(e) => log::warn!("auto-pause-media failed: {e}"),
        }
    }

    if general.auto_mute {
        match mute_system() {
            Ok(was_muted) => env.was_muted = was_muted,
            Err(e) => log::warn!("auto-mute failed: {e}"),
        }
    }

    if general.auto_dnd {
        match enable_dnd() {
            Ok(was_off) => env.dnd_was_off = was_off,
            Err(e) => log::warn!("auto-dnd failed: {e}"),
        }
    }

    env
}

/// Restore the recording environment to its pre-recording state.
/// Operations run in reverse order of [`prepare`].
pub fn restore(general: &GeneralConfig, env: &RecordingEnvState) {
    if general.auto_dnd {
        if let Err(e) = disable_dnd(env.dnd_was_off) {
            log::warn!("auto-dnd restore failed: {e}");
        }
    }

    if general.auto_mute {
        if let Err(e) = restore_system(env.was_muted) {
            log::warn!("auto-mute restore failed: {e}");
        }
    }

    if general.auto_pause_media {
        if let Err(e) = resume_media(&env.paused_sessions) {
            log::warn!("auto-pause-media resume failed: {e}");
        }
    }
}

// ════════════════════════════════════════════════════════════════════
// §1  System Mute
// ════════════════════════════════════════════════════════════════════

// ── macOS ───────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn mute_system() -> Result<bool, String> {
    use std::process::Command;

    let output = Command::new("osascript")
        .args(["-e", "output muted of (get volume settings)"])
        .output()
        .map_err(|e| format!("failed to query mute state: {e}"))?;

    let was_muted = String::from_utf8_lossy(&output.stdout).trim() == "true";

    Command::new("osascript")
        .args(["-e", "set volume output muted true"])
        .output()
        .map_err(|e| format!("failed to mute system: {e}"))?;

    log::info!("system audio muted (was_muted={was_muted})");
    Ok(was_muted)
}

#[cfg(target_os = "macos")]
fn restore_system(was_muted: bool) -> Result<(), String> {
    if was_muted {
        log::info!("system was already muted, not restoring");
        return Ok(());
    }

    use std::process::Command;

    Command::new("osascript")
        .args(["-e", "set volume output muted false"])
        .output()
        .map_err(|e| format!("failed to unmute system: {e}"))?;

    log::info!("system audio restored (unmuted)");
    Ok(())
}

// ── Windows ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
struct ComGuard {
    should_uninitialize: bool,
}

#[cfg(target_os = "windows")]
impl ComGuard {
    fn initialize() -> Result<Self, String> {
        use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

        unsafe {
            let result = CoInitializeEx(None, COINIT_MULTITHREADED);
            if result == RPC_E_CHANGED_MODE {
                log::debug!("COM already initialized with a different apartment model; reusing");
                Ok(Self {
                    should_uninitialize: false,
                })
            } else {
                result.ok().map_err(|e| format!("CoInitializeEx: {e}"))?;
                Ok(Self {
                    should_uninitialize: true,
                })
            }
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.should_uninitialize {
            unsafe {
                windows::Win32::System::Com::CoUninitialize();
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn with_endpoint_volume<T>(
    action: impl FnOnce(
        windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume,
    ) -> Result<T, String>,
) -> Result<T, String> {
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

    unsafe {
        let _com = ComGuard::initialize()?;

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("CoCreateInstance: {e}"))?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))?;

        let volume: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate: {e}"))?;

        action(volume)
    }
}

#[cfg(target_os = "windows")]
fn mute_system() -> Result<bool, String> {
    with_endpoint_volume(|volume| {
        let was_muted = unsafe {
            volume
                .GetMute()
                .map_err(|e| format!("GetMute: {e}"))?
                .as_bool()
        };

        unsafe {
            volume
                .SetMute(true, std::ptr::null())
                .map_err(|e| format!("SetMute: {e}"))?;
        }

        log::info!("system audio muted (was_muted={was_muted})");
        Ok(was_muted)
    })
}

#[cfg(target_os = "windows")]
fn restore_system(was_muted: bool) -> Result<(), String> {
    if was_muted {
        log::info!("system was already muted, not restoring");
        return Ok(());
    }

    with_endpoint_volume(|volume| {
        unsafe {
            volume
                .SetMute(false, std::ptr::null())
                .map_err(|e| format!("SetMute: {e}"))?;
        }

        log::info!("system audio restored (unmuted)");
        Ok(())
    })
}

// ── Linux (no-op) ───────────────────────────────────────────────────

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn mute_system() -> Result<bool, String> {
    log::warn!("auto-mute not supported on this platform");
    Ok(false)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn restore_system(_was_muted: bool) -> Result<(), String> {
    Ok(())
}

// ════════════════════════════════════════════════════════════════════
// §2  Media Pause
// ════════════════════════════════════════════════════════════════════

// ── Windows (SMTC) ──────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn pause_media() -> Result<Vec<String>, String> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| format!("RequestAsync: {e}"))?
        .get()
        .map_err(|e| format!("get manager: {e}"))?;

    let sessions = manager
        .GetSessions()
        .map_err(|e| format!("GetSessions: {e}"))?;

    let count = sessions.Size().unwrap_or(0);
    let mut paused_ids = Vec::new();

    for i in 0..count {
        let session = match sessions.GetAt(i) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let info = match session.GetPlaybackInfo() {
            Ok(info) => info,
            Err(_) => continue,
        };

        let status = match info.PlaybackStatus() {
            Ok(s) => s,
            Err(_) => continue,
        };

        if status != GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
            continue;
        }

        let app_id = session
            .SourceAppUserModelId()
            .map(|s| s.to_string())
            .unwrap_or_default();

        match session.TryPauseAsync() {
            Ok(op) => {
                if let Err(e) = op.get() {
                    log::warn!("failed to pause session {app_id}: {e}");
                    continue;
                }
                log::info!("paused media session: {app_id}");
                paused_ids.push(app_id);
            }
            Err(e) => {
                log::warn!("TryPauseAsync failed for {app_id}: {e}");
            }
        }
    }

    log::info!("paused {} media session(s)", paused_ids.len());
    Ok(paused_ids)
}

#[cfg(target_os = "windows")]
fn resume_media(paused_ids: &[String]) -> Result<(), String> {
    if paused_ids.is_empty() {
        return Ok(());
    }

    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| format!("RequestAsync: {e}"))?
        .get()
        .map_err(|e| format!("get manager: {e}"))?;

    let sessions = manager
        .GetSessions()
        .map_err(|e| format!("GetSessions: {e}"))?;

    let count = sessions.Size().unwrap_or(0);

    for i in 0..count {
        let session = match sessions.GetAt(i) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let app_id = session
            .SourceAppUserModelId()
            .map(|s| s.to_string())
            .unwrap_or_default();

        if !paused_ids.contains(&app_id) {
            continue;
        }

        match session.TryPlayAsync() {
            Ok(op) => {
                if let Err(e) = op.get() {
                    log::warn!("failed to resume session {app_id}: {e}");
                    continue;
                }
                log::info!("resumed media session: {app_id}");
            }
            Err(e) => {
                log::warn!("TryPlayAsync failed for {app_id}: {e}");
            }
        }
    }

    Ok(())
}

// ── macOS (AppleScript per-app) ─────────────────────────────────────

#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|e| format!("osascript: {e}"))?;

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "macos")]
const MEDIA_APPS: &[&str] = &["Music", "Spotify"];

#[cfg(target_os = "macos")]
fn pause_media() -> Result<Vec<String>, String> {
    let mut paused = Vec::new();

    for &app in MEDIA_APPS {
        let check_script = format!(
            "if application \"{app}\" is running then\n\
                 tell application \"{app}\" to get player state as text\n\
             else\n\
                 \"not running\"\n\
             end if"
        );

        let state = match run_osascript(&check_script) {
            Ok(s) => s,
            Err(e) => {
                log::debug!("skipping {app}: {e}");
                continue;
            }
        };

        if state != "playing" {
            continue;
        }

        let pause_script = format!("tell application \"{app}\" to pause");
        if let Err(e) = run_osascript(&pause_script) {
            log::warn!("failed to pause {app}: {e}");
            continue;
        }

        log::info!("paused media: {app}");
        paused.push(app.to_string());
    }

    log::info!("paused {} media app(s)", paused.len());
    Ok(paused)
}

#[cfg(target_os = "macos")]
fn resume_media(paused_ids: &[String]) -> Result<(), String> {
    for app in paused_ids {
        let play_script = format!("tell application \"{app}\" to play");
        if let Err(e) = run_osascript(&play_script) {
            log::warn!("failed to resume {app}: {e}");
            continue;
        }
        log::info!("resumed media: {app}");
    }
    Ok(())
}

// ── Linux (no-op) ───────────────────────────────────────────────────

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn pause_media() -> Result<Vec<String>, String> {
    log::warn!("media pause not supported on this platform");
    Ok(Vec::new())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn resume_media(_paused_ids: &[String]) -> Result<(), String> {
    Ok(())
}

// ════════════════════════════════════════════════════════════════════
// §3  Do Not Disturb / Focus Mode
// ════════════════════════════════════════════════════════════════════

// ── Windows (toast notification suppression via registry) ───────────

#[cfg(target_os = "windows")]
fn enable_dnd() -> Result<bool, String> {
    use std::process::Command;

    // Read current toast-enabled state (1 = toasts on, 0 = toasts off)
    let output = Command::new("reg")
        .args([
            "query",
            r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\PushNotifications",
            "/v",
            "ToastEnabled",
        ])
        .output()
        .map_err(|e| format!("reg query: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Parse "ToastEnabled    REG_DWORD    0x1" → toasts were enabled
    let toasts_were_on = stdout.contains("0x1");

    // Disable toast notifications
    let result = Command::new("reg")
        .args([
            "add",
            r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\PushNotifications",
            "/v",
            "ToastEnabled",
            "/t",
            "REG_DWORD",
            "/d",
            "0",
            "/f",
        ])
        .output()
        .map_err(|e| format!("reg add: {e}"))?;

    if !result.status.success() {
        return Err("failed to disable toast notifications".into());
    }

    log::info!("DND enabled: toast notifications disabled (were_on={toasts_were_on})");
    Ok(toasts_were_on)
}

#[cfg(target_os = "windows")]
fn disable_dnd(was_off: bool) -> Result<(), String> {
    if !was_off {
        log::info!("DND was already active before recording, not restoring");
        return Ok(());
    }

    use std::process::Command;

    let result = Command::new("reg")
        .args([
            "add",
            r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\PushNotifications",
            "/v",
            "ToastEnabled",
            "/t",
            "REG_DWORD",
            "/d",
            "1",
            "/f",
        ])
        .output()
        .map_err(|e| format!("reg add: {e}"))?;

    if !result.status.success() {
        return Err("failed to re-enable toast notifications".into());
    }

    log::info!("DND disabled: toast notifications re-enabled");
    Ok(())
}

// ── macOS (Notification Center defaults) ────────────────────────────

#[cfg(target_os = "macos")]
fn enable_dnd() -> Result<bool, String> {
    use std::process::Command;

    // Check current DND state
    let output = Command::new("defaults")
        .args([
            "-currentHost",
            "read",
            "com.apple.notificationcenterui",
            "doNotDisturb",
        ])
        .output()
        .map_err(|e| format!("read DND state: {e}"))?;

    let currently_on = String::from_utf8_lossy(&output.stdout).trim() == "1";

    if currently_on {
        log::info!("DND already active, skipping");
        return Ok(false); // was NOT off → don't restore later
    }

    // Enable DND
    Command::new("defaults")
        .args([
            "-currentHost",
            "write",
            "com.apple.notificationcenterui",
            "doNotDisturb",
            "-boolean",
            "true",
        ])
        .output()
        .map_err(|e| format!("enable DND: {e}"))?;

    // Set DND time range to cover all day
    Command::new("defaults")
        .args([
            "-currentHost",
            "write",
            "com.apple.notificationcenterui",
            "dndStart",
            "-float",
            "0",
        ])
        .output()
        .ok();

    Command::new("defaults")
        .args([
            "-currentHost",
            "write",
            "com.apple.notificationcenterui",
            "dndEnd",
            "-float",
            "1440",
        ])
        .output()
        .ok();

    // Restart NotificationCenter to apply
    Command::new("killall")
        .arg("NotificationCenter")
        .output()
        .ok();

    log::info!("DND enabled (macOS defaults)");
    Ok(true) // was off → should restore later
}

#[cfg(target_os = "macos")]
fn disable_dnd(was_off: bool) -> Result<(), String> {
    if !was_off {
        log::info!("DND was already active before recording, not restoring");
        return Ok(());
    }

    use std::process::Command;

    Command::new("defaults")
        .args([
            "-currentHost",
            "write",
            "com.apple.notificationcenterui",
            "doNotDisturb",
            "-boolean",
            "false",
        ])
        .output()
        .map_err(|e| format!("disable DND: {e}"))?;

    Command::new("killall")
        .arg("NotificationCenter")
        .output()
        .ok();

    log::info!("DND disabled (macOS defaults)");
    Ok(())
}

// ── Linux (no-op) ───────────────────────────────────────────────────

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn enable_dnd() -> Result<bool, String> {
    log::warn!("DND not supported on this platform");
    Ok(false)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn disable_dnd(_was_off: bool) -> Result<(), String> {
    Ok(())
}
