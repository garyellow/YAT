/// System volume control for auto-mute during recording.
///
/// Saves the previous mute state before muting, and restores it after recording.

use std::sync::atomic::{AtomicBool, Ordering};

static WAS_MUTED: AtomicBool = AtomicBool::new(false);

// ── macOS implementation ────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn mute_system() -> Result<(), String> {
    use std::process::Command;

    // Save current mute state
    let output = Command::new("osascript")
        .args(["-e", "output muted of (get volume settings)"])
        .output()
        .map_err(|e| format!("failed to query mute state: {e}"))?;

    let was_muted = String::from_utf8_lossy(&output.stdout).trim() == "true";
    WAS_MUTED.store(was_muted, Ordering::Relaxed);

    // Mute system audio
    Command::new("osascript")
        .args(["-e", "set volume output muted true"])
        .output()
        .map_err(|e| format!("failed to mute system: {e}"))?;

    log::info!("system audio muted (was_muted={was_muted})");
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn restore_system() -> Result<(), String> {
    use std::process::Command;

    let was_muted = WAS_MUTED.load(Ordering::Relaxed);
    if !was_muted {
        Command::new("osascript")
            .args(["-e", "set volume output muted false"])
            .output()
            .map_err(|e| format!("failed to unmute system: {e}"))?;
        log::info!("system audio restored (unmuted)");
    } else {
        log::info!("system was already muted, not restoring");
    }
    Ok(())
}

// ── Windows implementation ──────────────────────────────────────────

#[cfg(target_os = "windows")]
pub fn mute_system() -> Result<(), String> {
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("CoCreateInstance: {e}"))?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))?;

        let volume: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate: {e}"))?;

        let was_muted = volume.GetMute().map_err(|e| format!("GetMute: {e}"))?.as_bool();
        WAS_MUTED.store(was_muted, Ordering::Relaxed);

        volume
            .SetMute(true, std::ptr::null())
            .map_err(|e| format!("SetMute: {e}"))?;

        log::info!("system audio muted (was_muted={was_muted})");
        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub fn restore_system() -> Result<(), String> {
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    let was_muted = WAS_MUTED.load(Ordering::Relaxed);
    if was_muted {
        log::info!("system was already muted, not restoring");
        return Ok(());
    }

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("CoCreateInstance: {e}"))?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))?;

        let volume: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate: {e}"))?;

        volume
            .SetMute(false, std::ptr::null())
            .map_err(|e| format!("SetMute: {e}"))?;

        log::info!("system audio restored (unmuted)");
        Ok(())
    }
}

// ── Linux fallback (no-op) ──────────────────────────────────────────

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn mute_system() -> Result<(), String> {
    log::warn!("auto-mute not supported on this platform");
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn restore_system() -> Result<(), String> {
    Ok(())
}
