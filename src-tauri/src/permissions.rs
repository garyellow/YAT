//! Platform permission checks.
//!
//! Provides a unified [`PermissionStatus`] snapshot that the frontend can query
//! to show real-time permission state on the Overview page and inline warnings
//! in the Settings UI.
//!
//! | Platform | Microphone              | Accessibility           | Screen Recording        | CLI tools      |
//! |----------|-------------------------|-------------------------|-------------------------|----------------|
//! | macOS    | `AVCaptureDevice` auth  | `AXIsProcessTrusted`    | `CGPreflightScreenCaptureAccess` | —     |
//! | Windows  | Registry consent store  | n/a                     | n/a                     | —              |
//! | Linux    | best-effort (cpal)      | n/a                     | n/a                     | pactl, playerctl |

use serde::Serialize;

#[cfg(target_os = "macos")]
use std::ffi::c_void;

/// Fine-grained permission state mirroring the native OS concepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)] // Variants are platform-conditional; some unused on each OS.
pub enum PermissionState {
    /// Permission has been explicitly granted.
    Granted,
    /// Permission has been explicitly denied by the user or system policy.
    Denied,
    /// The user has not yet been asked (macOS `.notDetermined`).
    NotDetermined,
    /// This permission category does not apply on the current platform.
    NotApplicable,
    /// The check itself failed or is unsupported; treat as unknown.
    Unknown,
}

/// Aggregated permission snapshot returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct PermissionStatus {
    pub microphone: PermissionState,
    pub accessibility: PermissionState,
    pub screen_recording: PermissionState,
    /// Linux only — whether `pactl` is on `$PATH`.
    pub pactl_available: Option<bool>,
    /// Linux only — whether `playerctl` is on `$PATH`.
    pub playerctl_available: Option<bool>,
}

// ── Public API ──────────────────────────────────────────────────────

/// Snapshot the current permission state for every category relevant to
/// the running platform.  This is a pure query — it never triggers a
/// system prompt.
pub fn check_all() -> PermissionStatus {
    PermissionStatus {
        microphone: check_microphone(),
        accessibility: check_accessibility(),
        screen_recording: check_screen_recording(),
        pactl_available: check_cli_tool("pactl"),
        playerctl_available: check_cli_tool("playerctl"),
    }
}

/// Ask the OS to present a permission prompt for the given category.
/// Returns the (possibly updated) state after the request.
///
/// Only macOS has meaningful request APIs; on other platforms this is a
/// no-op that returns the current state.
pub fn request(category: &str) -> PermissionState {
    match category {
        "microphone" => request_microphone(),
        "accessibility" => request_accessibility(),
        "screen_recording" => request_screen_recording(),
        _ => PermissionState::NotApplicable,
    }
}

// ════════════════════════════════════════════════════════════════════
// §1  Microphone
// ════════════════════════════════════════════════════════════════════

// ── macOS ───────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn check_microphone() -> PermissionState {
    // AVAuthorizationStatus constants (AVFoundation)
    // 0 = notDetermined, 1 = restricted, 2 = denied, 3 = authorized
    let status = unsafe { av_authorization_status_for_audio() };
    match status {
        3 => PermissionState::Granted,
        2 => PermissionState::Denied,
        1 => PermissionState::Denied, // restricted ≈ denied from the user's perspective
        0 => PermissionState::NotDetermined,
        _ => PermissionState::Unknown,
    }
}

#[cfg(target_os = "macos")]
fn request_microphone() -> PermissionState {
    // Best-effort prompt trigger for desktop macOS builds.
    //
    // The native API is callback-based; here we request and then re-check
    // shortly after so frontend state can update quickly.  If the user has
    // not responded yet, this may still report `NotDetermined` on this call.
    unsafe { av_request_access_for_audio() };
    // Small grace period so very fast user responses can be observed.
    std::thread::sleep(std::time::Duration::from_millis(200));
    check_microphone()
}

/// FFI: `[AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio]`
///
/// We go through the Objective-C runtime directly so we don't need to
/// pull in a heavy `objc2` / `cocoa` dependency — the same pattern
/// already used in `context.rs` for Accessibility FFI.
#[cfg(target_os = "macos")]
unsafe fn av_authorization_status_for_audio() -> isize {
    extern "C" {
        fn objc_getClass(name: *const u8) -> *const c_void;
        fn sel_registerName(name: *const u8) -> *const c_void;
    }

    let cls = objc_getClass(b"AVCaptureDevice\0".as_ptr());
    if cls.is_null() {
        return -1;
    }

    let sel = sel_registerName(b"authorizationStatusForMediaType:\0".as_ptr());

    // AVMediaTypeAudio is an NSString constant.  We can obtain it from
    // the AVFoundation framework, but a simpler approach is to create
    // an NSString with the known value "soun" (the FourCC for audio).
    let ns_string_cls = objc_getClass(b"NSString\0".as_ptr());
    if ns_string_cls.is_null() {
        return -1;
    }
    let alloc_sel = sel_registerName(b"alloc\0".as_ptr());
    let init_sel = sel_registerName(b"initWithUTF8String:\0".as_ptr());
    let release_sel = sel_registerName(b"release\0".as_ptr());

    let raw = objc_msg_send_ptr_noargs(ns_string_cls, alloc_sel);
    if raw.is_null() {
        return -1;
    }
    let media_type = objc_msg_send_ptr_cstring_arg(raw, init_sel, b"soun\0".as_ptr());
    if media_type.is_null() {
        let _ = objc_msg_send_ptr_noargs(raw, release_sel);
        return -1;
    }

    let status = objc_msg_send_isize_ptr_arg(cls, sel, media_type);

    let _ = objc_msg_send_ptr_noargs(media_type, release_sel);

    status
}

/// FFI: `[AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL){}]`
///
/// We intentionally keep this as a minimal, best-effort trigger to avoid
/// adding heavy Objective-C wrapper dependencies for one call-site.
///
/// If the platform/runtime rejects a null completion handler, this call
/// effectively degrades to a no-op and the user can still grant access via
/// System Settings (the UI always offers that path).
#[cfg(target_os = "macos")]
unsafe fn av_request_access_for_audio() {
    extern "C" {
        fn objc_getClass(name: *const u8) -> *const c_void;
        fn sel_registerName(name: *const u8) -> *const c_void;
    }

    let cls = objc_getClass(b"AVCaptureDevice\0".as_ptr());
    if cls.is_null() {
        return;
    }

    // Build the media type NSString ("soun")
    let ns_string_cls = objc_getClass(b"NSString\0".as_ptr());
    if ns_string_cls.is_null() {
        return;
    }
    let alloc_sel = sel_registerName(b"alloc\0".as_ptr());
    let init_sel = sel_registerName(b"initWithUTF8String:\0".as_ptr());
    let release_sel = sel_registerName(b"release\0".as_ptr());

    let raw = objc_msg_send_ptr_noargs(ns_string_cls, alloc_sel);
    if raw.is_null() {
        return;
    }
    let media_type = objc_msg_send_ptr_cstring_arg(raw, init_sel, b"soun\0".as_ptr());
    if media_type.is_null() {
        let _ = objc_msg_send_ptr_noargs(raw, release_sel);
        return;
    }

    // Build a no-op block for the completion handler.
    // The simplest way: pass nil — macOS 10.14+ tolerates a nil handler
    // and will still show the prompt.
    let sel = sel_registerName(b"requestAccessForMediaType:completionHandler:\0".as_ptr());
    let nil: *const c_void = std::ptr::null();
    let _ = objc_msg_send_ptr_two_ptr_args(cls, sel, media_type, nil);

    let _ = objc_msg_send_ptr_noargs(media_type, release_sel);
}

#[cfg(target_os = "macos")]
unsafe fn objc_msg_send_ptr_noargs(receiver: *const c_void, sel: *const c_void) -> *const c_void {
    type MsgSend = unsafe extern "C" fn(*const c_void, *const c_void) -> *const c_void;
    extern "C" {
        fn objc_msgSend();
    }

    let func: MsgSend = std::mem::transmute(objc_msgSend as *const ());
    func(receiver, sel)
}

#[cfg(target_os = "macos")]
unsafe fn objc_msg_send_ptr_cstring_arg(
    receiver: *const c_void,
    sel: *const c_void,
    arg: *const u8,
) -> *const c_void {
    type MsgSend = unsafe extern "C" fn(*const c_void, *const c_void, *const u8) -> *const c_void;
    extern "C" {
        fn objc_msgSend();
    }

    let func: MsgSend = std::mem::transmute(objc_msgSend as *const ());
    func(receiver, sel, arg)
}

#[cfg(target_os = "macos")]
unsafe fn objc_msg_send_isize_ptr_arg(
    receiver: *const c_void,
    sel: *const c_void,
    arg: *const c_void,
) -> isize {
    type MsgSend = unsafe extern "C" fn(*const c_void, *const c_void, *const c_void) -> isize;
    extern "C" {
        fn objc_msgSend();
    }

    let func: MsgSend = std::mem::transmute(objc_msgSend as *const ());
    func(receiver, sel, arg)
}

#[cfg(target_os = "macos")]
unsafe fn objc_msg_send_ptr_two_ptr_args(
    receiver: *const c_void,
    sel: *const c_void,
    arg1: *const c_void,
    arg2: *const c_void,
) -> *const c_void {
    type MsgSend =
        unsafe extern "C" fn(*const c_void, *const c_void, *const c_void, *const c_void) -> *const c_void;
    extern "C" {
        fn objc_msgSend();
    }

    let func: MsgSend = std::mem::transmute(objc_msgSend as *const ());
    func(receiver, sel, arg1, arg2)
}

// ── Windows ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn check_microphone() -> PermissionState {
    // Desktop (non-packaged) apps can check the ConsentStore registry
    // key.  The global toggle lives at:
    //   HKCU\Software\Microsoft\Windows\CurrentVersion
    //       \CapabilityAccessManager\ConsentStore\microphone
    //   Value = "Allow" | "Deny"
    //
    // If the value is "Deny", desktop apps cannot use the mic at all.
    // When "Allow", individual UWP entries may exist but desktop apps
    // are governed by the "Let desktop apps access…" toggle, which has
    // no direct API — so we report Granted when the global is Allow.

    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

    match hkcu.open_subkey(path) {
        Ok(key) => {
            let value: Result<String, _> = key.get_value("Value");
            match value.as_deref() {
                Ok("Allow") => PermissionState::Granted,
                Ok("Deny") => PermissionState::Denied,
                _ => PermissionState::Unknown,
            }
        }
        Err(_) => PermissionState::Unknown,
    }
}

#[cfg(target_os = "windows")]
fn request_microphone() -> PermissionState {
    // Windows has no programmatic prompt for desktop apps — the user
    // must toggle it in Settings manually.
    check_microphone()
}

// ── Linux ───────────────────────────────────────────────────────────

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn check_microphone() -> PermissionState {
    // Linux desktop apps generally have unrestricted microphone access
    // unless running under Flatpak/Snap sandboxing.  We do a best-effort
    // check by trying to list input devices via ALSA/PulseAudio.
    let devices = crate::audio::list_input_devices();
    if devices.is_empty() {
        // Could be no devices OR a permission issue — we can't tell.
        PermissionState::Unknown
    } else {
        PermissionState::Granted
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn request_microphone() -> PermissionState {
    check_microphone()
}

// ════════════════════════════════════════════════════════════════════
// §2  Accessibility (macOS only)
// ════════════════════════════════════════════════════════════════════

#[cfg(target_os = "macos")]
fn check_accessibility() -> PermissionState {
    let trusted = unsafe { macos_ax_is_process_trusted() };
    if trusted {
        PermissionState::Granted
    } else {
        PermissionState::Denied
    }
}

#[cfg(target_os = "macos")]
fn request_accessibility() -> PermissionState {
    // `AXIsProcessTrustedWithOptions` with the prompt flag opens the
    // system Accessibility preferences pane and highlights the app.
    unsafe { macos_ax_request_with_prompt() };
    // Re-query — the user may not have responded yet, but at least the
    // dialog is open.
    check_accessibility()
}

#[cfg(target_os = "macos")]
unsafe fn macos_ax_is_process_trusted() -> bool {
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    AXIsProcessTrusted()
}

#[cfg(target_os = "macos")]
unsafe fn macos_ax_request_with_prompt() {
    use std::ffi::c_void;

    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;

        // Core Foundation helpers for building the options dictionary
        fn CFDictionaryCreate(
            allocator: *const c_void,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> *const c_void;
        fn CFRelease(cf: *const c_void);

        // kCFBooleanTrue is a global constant pointer
        static kCFBooleanTrue: *const c_void;

        // kAXTrustedCheckOptionPrompt — the dictionary key that tells
        // the API to show the system prompt
        static kAXTrustedCheckOptionPrompt: *const c_void;

        static kCFTypeDictionaryKeyCallBacks: u8;
        static kCFTypeDictionaryValueCallBacks: u8;
    }

    let keys = [kAXTrustedCheckOptionPrompt];
    let values = [kCFBooleanTrue];

    let dict = CFDictionaryCreate(
        std::ptr::null(),
        keys.as_ptr(),
        values.as_ptr(),
        1,
        &kCFTypeDictionaryKeyCallBacks as *const u8 as *const c_void,
        &kCFTypeDictionaryValueCallBacks as *const u8 as *const c_void,
    );

    // The return value tells us the current state, but we ignore it
    // here — re-checking via check_accessibility gives us the struct.
    AXIsProcessTrustedWithOptions(dict);

    if !dict.is_null() {
        CFRelease(dict);
    }
}

// Non-macOS: Accessibility is not a gated permission.
#[cfg(not(target_os = "macos"))]
fn check_accessibility() -> PermissionState {
    PermissionState::NotApplicable
}

#[cfg(not(target_os = "macos"))]
fn request_accessibility() -> PermissionState {
    PermissionState::NotApplicable
}

// ════════════════════════════════════════════════════════════════════
// §3  Screen Recording (macOS only)
// ════════════════════════════════════════════════════════════════════

#[cfg(target_os = "macos")]
fn check_screen_recording() -> PermissionState {
    // `CGPreflightScreenCaptureAccess` was introduced in macOS 10.15
    // and returns true if screen capture has been authorised.
    let granted = unsafe {
        extern "C" {
            fn CGPreflightScreenCaptureAccess() -> bool;
        }
        CGPreflightScreenCaptureAccess()
    };
    if granted {
        PermissionState::Granted
    } else {
        PermissionState::Denied
    }
}

#[cfg(target_os = "macos")]
fn request_screen_recording() -> PermissionState {
    unsafe {
        extern "C" {
            fn CGRequestScreenCaptureAccess() -> bool;
        }
        CGRequestScreenCaptureAccess();
    }
    check_screen_recording()
}

#[cfg(not(target_os = "macos"))]
fn check_screen_recording() -> PermissionState {
    PermissionState::NotApplicable
}

#[cfg(not(target_os = "macos"))]
fn request_screen_recording() -> PermissionState {
    PermissionState::NotApplicable
}

// ════════════════════════════════════════════════════════════════════
// §4  CLI tool availability (Linux)
// ════════════════════════════════════════════════════════════════════

fn check_cli_tool(name: &str) -> Option<bool> {
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        use std::env;
        use std::os::unix::fs::PermissionsExt;

        let path = match env::var_os("PATH") {
            Some(path) => path,
            None => return Some(false),
        };

        Some(env::split_paths(&path).any(|dir| {
            let candidate = dir.join(name);
            candidate
                .metadata()
                .map(|meta| meta.is_file() && (meta.permissions().mode() & 0o111 != 0))
                .unwrap_or(false)
        }))
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let _ = name;
        None
    }
}
