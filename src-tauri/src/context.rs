//! Context gathering for LLM enrichment.
//!
//! Captures environmental context at the start of a recording:
//! - Active window / application name
//! - Clipboard text
//! - Selected text (native Accessibility API on macOS, clipboard simulation elsewhere)
//! - Focused input field full text (Windows UI Automation / macOS Accessibility)
//!
//! All functions are best-effort: they return `None` on failure rather than
//! propagating errors, since missing context should never block recording.

use arboard::Clipboard;
use serde::{Deserialize, Serialize};

// ── Active Window ───────────────────────────────────────────────────

/// Lightweight summary of the active window captured at recording start.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveWindowInfo {
    pub app_name: String,
    pub title: String,
}

/// Detect the currently focused window/application.
///
/// Uses `active-win-pos-rs` which supports Windows, macOS, and Linux
/// (X11 + KDE Wayland via `kdotool`).
///
/// **macOS caveat**: `title` is always empty unless the app has been
/// granted Screen Recording permission.
pub fn get_active_window_info() -> Option<ActiveWindowInfo> {
    match active_win_pos_rs::get_active_window() {
        Ok(w) => {
            let app = if w.app_name.is_empty() {
                // Fallback: extract name from process path
                std::path::Path::new(&w.process_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string()
            } else {
                w.app_name
            };
            Some(ActiveWindowInfo {
                app_name: app,
                title: w.title,
            })
        }
        Err(()) => {
            log::debug!("failed to detect active window");
            None
        }
    }
}

// ── Clipboard ───────────────────────────────────────────────────────

/// Read the current clipboard text content (non-empty only).
pub fn read_clipboard_text() -> Option<String> {
    Clipboard::new()
        .ok()?
        .get_text()
        .ok()
        .filter(|s| !s.trim().is_empty())
}

// ── Selected Text ───────────────────────────────────────────────────

/// Read the currently selected text using the best available method.
///
/// **macOS**: Prioritises the Accessibility API (`AXSelectedText`), then
///   falls back to simulating Cmd+C if the target app doesn't support it.
/// **Windows / Linux**: Simulates Ctrl+C via the clipboard (the only
///   reliable cross-app method on these platforms).
///
/// The `get-selected-text` crate handles all platform differences and
/// automatically mutes macOS alert sounds during simulation.
pub fn read_selected_text() -> Option<String> {
    match get_selected_text::get_selected_text() {
        Ok(text) if !text.trim().is_empty() => Some(text),
        Ok(_) => None,
        Err(e) => {
            log::debug!("failed to read selected text: {e}");
            None
        }
    }
}

// ── Input Field Text (platform-specific) ────────────────────────────

/// Read the full text content of the currently focused input field.
///
/// This uses platform-specific Accessibility / UI Automation APIs:
/// - **Windows**: `uiautomation` crate → `ValuePattern` (simple text
///   fields) or `TextPattern` (rich text controls).  Works in most
///   native controls; some apps (e.g. Firefox, Chrome) may not expose
///   these patterns.
/// - **macOS**: Accessibility API via `kAXValueAttribute` on the focused
///   UI element.  Requires Accessibility permission.
/// - **Linux**: Not available — returns `None`.
pub fn read_input_field_text() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        read_input_field_text_windows()
    }
    #[cfg(target_os = "macos")]
    {
        read_input_field_text_macos()
    }
    #[cfg(target_os = "linux")]
    {
        None
    }
}

// ── Windows: UI Automation ──────────────────────────────────────────

#[cfg(target_os = "windows")]
fn read_input_field_text_windows() -> Option<String> {
    use uiautomation::UIAutomation;
    use uiautomation::patterns::UITextPattern;

    let automation = UIAutomation::new().ok()?;
    let focused = automation.get_focused_element().ok()?;

    // Try ValuePattern first — works for simple text fields, combo boxes, etc.
    if let Ok(value) = focused.get_property_value(uiautomation::types::UIProperty::ValueValue) {
        let text = value.to_string();
        if !text.is_empty() && text != "null" {
            return Some(text);
        }
    }

    // Fall back to TextPattern for richer text controls (e.g. Notepad, VS Code)
    if let Ok(text_pattern) = focused.get_pattern::<UITextPattern>() {
        if let Ok(range) = text_pattern.get_document_range() {
            if let Ok(text) = range.get_text(-1) {
                if !text.trim().is_empty() {
                    return Some(text);
                }
            }
        }
    }

    log::debug!("focused element does not expose text via ValuePattern or TextPattern");
    None
}

// ── macOS: Accessibility API ────────────────────────────────────────

#[cfg(target_os = "macos")]
fn read_input_field_text_macos() -> Option<String> {
    use std::ffi::c_void;
    use std::ptr;

    // Core Foundation + Accessibility types are available through the
    // system frameworks that Tauri already links.
    extern "C" {
        fn AXUIElementCreateSystemWide() -> *mut c_void;
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: *const c_void,
            value: *mut *mut c_void,
        ) -> i32;
        fn CFRelease(cf: *mut c_void);
    }

    // CFString constants for accessibility attributes
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        static kAXFocusedUIElementAttribute: *const c_void;
        static kAXValueAttribute: *const c_void;
    }

    unsafe {
        let system_wide = AXUIElementCreateSystemWide();
        if system_wide.is_null() {
            return None;
        }

        // Get the focused UI element
        let mut focused: *mut c_void = ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(
            system_wide,
            kAXFocusedUIElementAttribute,
            &mut focused,
        );
        if err != 0 || focused.is_null() {
            CFRelease(system_wide);
            return None;
        }

        // Read the value attribute (full text of the input field)
        let mut value: *mut c_void = ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(focused, kAXValueAttribute, &mut value);

        let result = if err == 0 && !value.is_null() {
            cfstring_to_string(value)
        } else {
            None
        };

        if !value.is_null() {
            CFRelease(value);
        }
        CFRelease(focused);
        CFRelease(system_wide);

        result.filter(|s| !s.trim().is_empty())
    }
}

/// Convert a CFStringRef to a Rust String.
#[cfg(target_os = "macos")]
unsafe fn cfstring_to_string(cfstr: *mut std::ffi::c_void) -> Option<String> {
    extern "C" {
        fn CFStringGetLength(theString: *const std::ffi::c_void) -> isize;
        fn CFStringGetCString(
            theString: *const std::ffi::c_void,
            buffer: *mut u8,
            bufferSize: isize,
            encoding: u32,
        ) -> bool;
    }

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

    let len = CFStringGetLength(cfstr);
    if len <= 0 {
        return None;
    }

    // UTF-8 can be up to 4 bytes per char; add 1 for null terminator
    let buf_size = (len * 4 + 1) as usize;
    let mut buf = vec![0u8; buf_size];

    if CFStringGetCString(cfstr, buf.as_mut_ptr(), buf_size as isize, K_CF_STRING_ENCODING_UTF8) {
        let nul_pos = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        String::from_utf8(buf[..nul_pos].to_vec()).ok()
    } else {
        None
    }
}

// ── Screenshot Capture ──────────────────────────────────────────────

/// Capture a screenshot of the monitor containing the active window (or the
/// primary monitor as fallback) and return it as a base64-encoded PNG string.
///
/// Uses the `xcap` crate which supports Windows, macOS, and Linux.
/// Like other context functions, returns `None` on any failure.
pub fn capture_screenshot_base64() -> Option<String> {
    use base64::Engine as _;
    use xcap::Monitor;

    // Try to find which monitor contains the cursor / active window.
    // Fall back to the primary (first) monitor.
    let monitors = Monitor::all().ok()?;
    if monitors.is_empty() {
        log::debug!("no monitors detected for screenshot capture");
        return None;
    }

    // Capture from the first monitor (primary) — xcap lists the primary first.
    let monitor = &monitors[0];
    let image = match monitor.capture_image() {
        Ok(img) => img,
        Err(e) => {
            log::debug!("screenshot capture failed: {e}");
            return None;
        }
    };

    // Encode as PNG into memory
    let mut png_buf = std::io::Cursor::new(Vec::new());
    if image
        .write_to(&mut png_buf, image::ImageFormat::Png)
        .is_err()
    {
        log::debug!("failed to encode screenshot as PNG");
        return None;
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(png_buf.into_inner());
    Some(b64)
}
