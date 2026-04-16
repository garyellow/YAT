//! Recording environment management — all side-effects that should be applied
//! when recording starts and reverted when it stops.
//!
//! Consolidates background-audio control and media pause into a single module
//! with a unified `prepare()` / `restore()` API so the caller does not have to
//! coordinate multiple modules.
//!
//! ## Background Audio Control
//!
//! During recording, the app can either:
//! - leave system audio unchanged,
//! - duck it (lower the current output volume and restore it later), or
//! - mute it completely.
//!
//! | Platform | Mechanism |
//! |----------|-----------|
//! | macOS    | `osascript` (AppleScript volume settings) |
//! | Windows  | Core Audio COM (`IAudioEndpointVolume`) |
//! | Linux    | `pactl` (PulseAudio / PipeWire) |
//!
//! ## Media Pause
//!
//! Asks currently playing media to pause, then resumes when the recording ends.
//!
//! | Platform | Mechanism |
//! |----------|-----------|
//! | Windows  | SMTC — enumerates every media session and pauses `Playing` ones |
//! | macOS    | AppleScript for Music & Spotify; if neither is active, sends a |
//! |          | system media-key (`NX_KEYTYPE_PLAY`) via `enigo` to pause the |
//! |          | current NowPlaying source (browsers, VLC, etc.) |
//! | Linux    | `playerctl` — pauses every MPRIS player reporting `Playing` |
//!
//! We intentionally do **not** toggle system-wide Do Not Disturb / Focus modes.
//! The available techniques on macOS and Windows rely on undocumented defaults,
//! registry state, or UI-level automation that is brittle across OS releases.

use crate::config::{BackgroundAudioMode, GeneralConfig};

// ── Public API ──────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
type SystemVolumeValue = u8;

#[cfg(target_os = "windows")]
type SystemVolumeValue = f32;

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
type SystemVolumeValue = u32;

/// State captured on recording start. Passed to [`restore`] to undo only what
/// was changed, so we never leave the system in an altered state.
#[derive(Clone, Default)]
pub struct RecordingEnvState {
    system_audio: Option<SystemAudioRestoreState>,
    paused_sessions: Vec<String>,
}

#[derive(Clone)]
enum SystemAudioRestoreState {
    Mute { was_muted: bool },
    Duck { snapshot: SystemAudioSnapshot },
}

#[derive(Clone)]
struct SystemAudioSnapshot {
    was_muted: bool,
    volume: SystemVolumeValue,
}

fn retained_volume_ratio(reduction_percent: u8) -> f32 {
    (1.0 - (f32::from(reduction_percent) / 100.0)).clamp(0.0, 1.0)
}

/// Prepare the recording environment according to the user's settings.
/// Returns a snapshot that **must** be passed to [`restore`] when recording
/// stops.
///
/// Order of operations matters:
/// 1. Pause media first (stops audio production)
/// 2. Adjust background audio (duck or mute remaining sounds)
pub fn prepare(general: &GeneralConfig) -> RecordingEnvState {
    let mut env = RecordingEnvState::default();

    if general.auto_pause_media {
        match pause_media() {
            Ok(ids) => env.paused_sessions = ids,
            Err(e) => log::warn!("auto-pause-media failed: {e}"),
        }
    }

    match general.background_audio_mode {
        BackgroundAudioMode::Off => {}
        BackgroundAudioMode::Mute => match mute_system() {
            Ok(was_muted) => {
                env.system_audio = Some(SystemAudioRestoreState::Mute { was_muted });
            }
            Err(e) => log::warn!("background-audio mute failed: {e}"),
        },
        BackgroundAudioMode::Duck => match duck_system(general.background_audio_ducking_percent)
        {
            Ok(snapshot) => {
                env.system_audio = Some(SystemAudioRestoreState::Duck { snapshot });
            }
            Err(e) => log::warn!("background-audio duck failed: {e}"),
        },
    }

    env
}

/// Restore the recording environment to its pre-recording state.
/// Operations run in reverse order of [`prepare`].
pub fn restore(_general: &GeneralConfig, env: &RecordingEnvState) {
    if let Some(system_audio) = &env.system_audio {
        retry_restore_once("background-audio", || restore_system_audio(system_audio));
    }

    // Resume only if we actually paused anything at recording start.
    // Do not gate this on *current* settings, because the user might have
    // changed `auto_pause_media` mid-recording.
    if !env.paused_sessions.is_empty() {
        retry_restore_once("auto-pause-media", || resume_media(&env.paused_sessions));
    }
}

fn retry_restore_once<F>(label: &str, mut operation: F)
where
    F: FnMut() -> Result<(), String>,
{
    match operation() {
        Ok(()) => {}
        Err(first_error) => {
            log::warn!("{label} restore failed (first attempt): {first_error}");
            std::thread::sleep(std::time::Duration::from_millis(120));
            if let Err(second_error) = operation() {
                log::warn!("{label} restore failed (retry): {second_error}");
            }
        }
    }
}

// ════════════════════════════════════════════════════════════════════
// §1  Background Audio Control
// ════════════════════════════════════════════════════════════════════

fn restore_system_audio(state: &SystemAudioRestoreState) -> Result<(), String> {
    match state {
        SystemAudioRestoreState::Mute { was_muted } => restore_mute_state(*was_muted),
        SystemAudioRestoreState::Duck { snapshot } => restore_ducked_system(snapshot),
    }
}

// ── macOS ───────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn mute_system() -> Result<bool, String> {
    let was_muted = run_osascript("output muted of (get volume settings)")? == "true";

    run_osascript("set volume output muted true")
        .map_err(|e| format!("failed to mute system: {e}"))?;

    log::info!("system audio muted (was_muted={was_muted})");
    Ok(was_muted)
}

#[cfg(target_os = "macos")]
fn restore_mute_state(was_muted: bool) -> Result<(), String> {
    if was_muted {
        log::info!("system was already muted, not restoring");
        return Ok(());
    }

    run_osascript("set volume output muted false")
        .map_err(|e| format!("failed to unmute system: {e}"))?;

    log::info!("system audio restored (unmuted)");
    Ok(())
}

#[cfg(target_os = "macos")]
fn duck_system(reduction_percent: u8) -> Result<SystemAudioSnapshot, String> {
    let was_muted = run_osascript("output muted of (get volume settings)")? == "true";
    let current_volume = run_osascript("output volume of (get volume settings)")?
        .parse::<u8>()
        .map_err(|e| format!("failed to parse output volume: {e}"))?;

    if was_muted {
        log::info!("system audio already muted, skipping duck");
        return Ok(SystemAudioSnapshot {
            was_muted,
            volume: current_volume,
        });
    }

    let target_volume = ((f32::from(current_volume) * retained_volume_ratio(reduction_percent))
        .round())
        .clamp(0.0, 100.0) as u8;

    run_osascript(&format!(
        "set volume without output muted output volume {target_volume}"
    ))
    .map_err(|e| format!("failed to duck system audio: {e}"))?;

    log::info!(
        "system audio ducked (from={current_volume}, to={target_volume}, reduction={reduction_percent}%)"
    );

    Ok(SystemAudioSnapshot {
        was_muted,
        volume: current_volume,
    })
}

#[cfg(target_os = "macos")]
fn restore_ducked_system(snapshot: &SystemAudioSnapshot) -> Result<(), String> {
    if snapshot.was_muted {
        log::info!("system was already muted, not restoring ducked audio");
        return Ok(());
    }

    run_osascript(&format!(
        "set volume without output muted output volume {}",
        snapshot.volume
    ))
    .map_err(|e| format!("failed to restore ducked system audio: {e}"))?;

    log::info!("system audio restored to volume {}", snapshot.volume);
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
fn restore_mute_state(was_muted: bool) -> Result<(), String> {
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

#[cfg(target_os = "windows")]
fn duck_system(reduction_percent: u8) -> Result<SystemAudioSnapshot, String> {
    with_endpoint_volume(|volume| {
        let was_muted = unsafe {
            volume
                .GetMute()
                .map_err(|e| format!("GetMute: {e}"))?
                .as_bool()
        };
        let current_volume = unsafe {
            volume
                .GetMasterVolumeLevelScalar()
                .map_err(|e| format!("GetMasterVolumeLevelScalar: {e}"))?
        };

        if was_muted {
            log::info!("system audio already muted, skipping duck");
            return Ok(SystemAudioSnapshot {
                was_muted,
                volume: current_volume,
            });
        }

        let target_volume = (current_volume * retained_volume_ratio(reduction_percent))
            .clamp(0.0, 1.0);

        unsafe {
            volume
                .SetMasterVolumeLevelScalar(target_volume, std::ptr::null())
                .map_err(|e| format!("SetMasterVolumeLevelScalar: {e}"))?;
        }

        log::info!(
            "system audio ducked (from={current_volume:.3}, to={target_volume:.3}, reduction={reduction_percent}%)"
        );

        Ok(SystemAudioSnapshot {
            was_muted,
            volume: current_volume,
        })
    })
}

#[cfg(target_os = "windows")]
fn restore_ducked_system(snapshot: &SystemAudioSnapshot) -> Result<(), String> {
    if snapshot.was_muted {
        log::info!("system was already muted, not restoring ducked audio");
        return Ok(());
    }

    with_endpoint_volume(|volume| {
        unsafe {
            volume
                .SetMasterVolumeLevelScalar(snapshot.volume, std::ptr::null())
                .map_err(|e| format!("SetMasterVolumeLevelScalar: {e}"))?;
        }

        log::info!("system audio restored to volume {:.3}", snapshot.volume);
        Ok(())
    })
}

// ── Linux (PulseAudio / PipeWire) ────────────────────────────────────

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn parse_first_percent(raw: &str) -> Result<u32, String> {
    raw.split_whitespace()
        .find_map(|token| token.strip_suffix('%').and_then(|value| value.parse::<u32>().ok()))
        .ok_or_else(|| format!("failed to parse sink volume from pactl output: {raw}"))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn mute_system() -> Result<bool, String> {
    use std::process::Command;

    let output = Command::new("pactl")
        .args(["get-sink-mute", "@DEFAULT_SINK@"])
        .output()
        .map_err(|e| format!("pactl: {e}"))?;

    if !output.status.success() {
        return Err("pactl get-sink-mute failed".into());
    }

    let was_muted = String::from_utf8_lossy(&output.stdout).contains("yes");

    let status = Command::new("pactl")
        .args(["set-sink-mute", "@DEFAULT_SINK@", "1"])
        .status()
        .map_err(|e| format!("pactl mute: {e}"))?;

    if !status.success() {
        return Err("pactl set-sink-mute failed".into());
    }

    log::info!("system audio muted (was_muted={was_muted})");
    Ok(was_muted)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn restore_mute_state(was_muted: bool) -> Result<(), String> {
    if was_muted {
        log::info!("system was already muted, not restoring");
        return Ok(());
    }

    use std::process::Command;

    let status = Command::new("pactl")
        .args(["set-sink-mute", "@DEFAULT_SINK@", "0"])
        .status()
        .map_err(|e| format!("pactl unmute: {e}"))?;

    if !status.success() {
        return Err("pactl set-sink-mute failed".into());
    }

    log::info!("system audio restored (unmuted)");
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn duck_system(reduction_percent: u8) -> Result<SystemAudioSnapshot, String> {
    use std::process::Command;

    let mute_output = Command::new("pactl")
        .args(["get-sink-mute", "@DEFAULT_SINK@"])
        .output()
        .map_err(|e| format!("pactl get-sink-mute: {e}"))?;

    if !mute_output.status.success() {
        return Err("pactl get-sink-mute failed".into());
    }

    let was_muted = String::from_utf8_lossy(&mute_output.stdout).contains("yes");

    let volume_output = Command::new("pactl")
        .args(["get-sink-volume", "@DEFAULT_SINK@"])
        .output()
        .map_err(|e| format!("pactl get-sink-volume: {e}"))?;

    if !volume_output.status.success() {
        return Err("pactl get-sink-volume failed".into());
    }

    let current_volume = parse_first_percent(&String::from_utf8_lossy(&volume_output.stdout))?;

    if was_muted {
        log::info!("system audio already muted, skipping duck");
        return Ok(SystemAudioSnapshot {
            was_muted,
            volume: current_volume,
        });
    }

    let target_volume = ((current_volume as f32) * retained_volume_ratio(reduction_percent))
        .round() as u32;

    let status = Command::new("pactl")
        .args([
            "set-sink-volume",
            "@DEFAULT_SINK@",
            &format!("{target_volume}%"),
        ])
        .status()
        .map_err(|e| format!("pactl set-sink-volume: {e}"))?;

    if !status.success() {
        return Err("pactl set-sink-volume failed".into());
    }

    log::info!(
        "system audio ducked (from={current_volume}%, to={target_volume}%, reduction={reduction_percent}%)"
    );

    Ok(SystemAudioSnapshot {
        was_muted,
        volume: current_volume,
    })
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn restore_ducked_system(snapshot: &SystemAudioSnapshot) -> Result<(), String> {
    if snapshot.was_muted {
        log::info!("system was already muted, not restoring ducked audio");
        return Ok(());
    }

    use std::process::Command;

    let status = Command::new("pactl")
        .args([
            "set-sink-volume",
            "@DEFAULT_SINK@",
            &format!("{}%", snapshot.volume),
        ])
        .status()
        .map_err(|e| format!("pactl set-sink-volume restore: {e}"))?;

    if !status.success() {
        return Err("pactl set-sink-volume failed".into());
    }

    log::info!("system audio restored to volume {}%", snapshot.volume);
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
        .join()
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
                if let Err(e) = op.join() {
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
        .join()
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
                if let Err(e) = op.join() {
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

// ── macOS (AppleScript + media-key fallback) ────────────────────────

#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|e| format!("osascript: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("osascript exited with {}: {stderr}", output.status));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Sentinel value stored in `paused_sessions` when we toggled the system
/// media key instead of targeting a specific app.
#[cfg(target_os = "macos")]
const MEDIA_KEY_SENTINEL: &str = "__media_key__";

#[cfg(target_os = "macos")]
const MEDIA_APPS: &[&str] = &["Music", "Spotify"];

#[cfg(target_os = "macos")]
fn pause_media() -> Result<Vec<String>, String> {
    let mut paused = Vec::new();

    // 1. Try known apps via AppleScript (state-aware, no permissions needed)
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

    // 2. If no known app was playing, send a system media key to pause the
    //    NowPlaying source (browsers, VLC, IINA, etc.).  This is the same
    //    HID event that Bluetooth headphone buttons generate.
    if paused.is_empty() {
        match simulate_media_play_pause() {
            Ok(()) => {
                log::info!("sent system media play/pause key");
                paused.push(MEDIA_KEY_SENTINEL.to_string());
            }
            Err(e) => log::debug!("media key fallback skipped: {e}"),
        }
    }

    log::info!("paused {} media source(s)", paused.len());
    Ok(paused)
}

#[cfg(target_os = "macos")]
fn resume_media(paused_ids: &[String]) -> Result<(), String> {
    // 1. If we used the media key, toggle it again to resume
    if paused_ids.iter().any(|id| id == MEDIA_KEY_SENTINEL) {
        match simulate_media_play_pause() {
            Ok(()) => log::info!("sent system media play/pause key (resume)"),
            Err(e) => log::warn!("media key resume failed: {e}"),
        }
    }

    // 2. Resume known apps via AppleScript
    for app in paused_ids {
        if app == MEDIA_KEY_SENTINEL {
            continue;
        }
        let play_script = format!("tell application \"{app}\" to play");
        if let Err(e) = run_osascript(&play_script) {
            log::warn!("failed to resume {app}: {e}");
            continue;
        }
        log::info!("resumed media: {app}");
    }
    Ok(())
}

/// Simulate a media play/pause key press using `enigo`.
///
/// This posts the same `NSSystemDefined` HID event (NX_KEYTYPE_PLAY = 16)
/// that physical media keys and Bluetooth AVRCP buttons generate, so it
/// controls whatever app is currently the NowPlaying source.
#[cfg(target_os = "macos")]
fn simulate_media_play_pause() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {e}"))?;
    enigo
        .key(Key::MediaPlayPause, Direction::Click)
        .map_err(|e| format!("media key: {e}"))?;
    Ok(())
}

// ── Linux (MPRIS via playerctl) ─────────────────────────────────────

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn pause_media() -> Result<Vec<String>, String> {
    use std::process::Command;

    let output = Command::new("playerctl")
        .args(["--list-all"])
        .output()
        .map_err(|e| format!("playerctl: {e}"))?;

    if !output.status.success() {
        return Err("playerctl not available — install it for media pause support".into());
    }

    let players: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let mut paused = Vec::new();

    for player in &players {
        let status = Command::new("playerctl")
            .args(["--player", player, "status"])
            .output();

        let status_str = match &status {
            Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
            Err(_) => continue,
        };

        if status_str != "Playing" {
            continue;
        }

        let result = Command::new("playerctl")
            .args(["--player", player, "pause"])
            .status();

        match result {
            Ok(s) if s.success() => {
                log::info!("paused MPRIS player: {player}");
                paused.push(player.clone());
            }
            Ok(_) => log::warn!("playerctl pause failed for {player}"),
            Err(e) => log::warn!("playerctl pause error for {player}: {e}"),
        }
    }

    log::info!("paused {} MPRIS player(s)", paused.len());
    Ok(paused)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn resume_media(paused_ids: &[String]) -> Result<(), String> {
    if paused_ids.is_empty() {
        return Ok(());
    }

    use std::process::Command;

    for player in paused_ids {
        let result = Command::new("playerctl")
            .args(["--player", player, "play"])
            .status();

        match result {
            Ok(s) if s.success() => log::info!("resumed MPRIS player: {player}"),
            Ok(_) => log::warn!("playerctl play failed for {player}"),
            Err(e) => log::warn!("playerctl play error for {player}: {e}"),
        }
    }

    Ok(())
}
