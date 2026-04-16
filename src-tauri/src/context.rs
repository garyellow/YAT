//! Context gathering for LLM enrichment.
//!
//! Captures environmental context at the start of a recording:
//! - Active window / application name
//! - Clipboard text
//! - Selected text (native APIs first, clipboard simulation as fallback)
//! - Focused input field full text (Windows UI Automation / macOS Accessibility)
//! - Screenshot (monitor containing the active window)
//!
//! All functions are best-effort: they return `None` on failure rather than
//! propagating errors, since missing context should never block recording.
//!
//! ## Selected text strategy by platform
//! - **macOS**: AXSelectedText via Accessibility API -> Cmd+C fallback (both
//!   handled by the `get-selected-text` crate; clipboard is restored after use).
//! - **Windows**: `UITextPattern.GetSelection()` via UI Automation API (no
//!   clipboard interaction) -> Ctrl+C fallback for apps that don't support it.
//! - **Linux (X11)**: X11 PRIMARY selection buffer (selected text is placed
//!   here automatically without requiring Ctrl+C) -> Ctrl+C fallback for
//!   Wayland sessions or apps that don't update the PRIMARY selection.

use arboard::Clipboard;
use serde::{Deserialize, Serialize};

// -- Active Window -----------------------------------------------------------

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

// -- Clipboard ---------------------------------------------------------------

/// Read the current clipboard text content (non-empty only).
pub fn read_clipboard_text() -> Option<String> {
    Clipboard::new()
        .ok()?
        .get_text()
        .ok()
        .filter(|s| !s.trim().is_empty())
}

// -- Selected Text -----------------------------------------------------------

/// Read the currently selected text using the best available native method.
///
/// Tries a clipboard-free native API first on each platform; falls back to
/// clipboard simulation only if the native API fails or is unsupported.
/// See the module-level documentation for per-platform details.
pub fn read_selected_text() -> Option<String> {
    // Windows: UITextPattern.GetSelection() (native, no clipboard)
    #[cfg(target_os = "windows")]
    if let Some(text) = read_selected_text_via_uia() {
        return Some(text);
    }

    // Linux: X11 PRIMARY selection (no clipboard interaction)
    #[cfg(target_os = "linux")]
    if let Some(text) = read_selected_text_x11_primary() {
        return Some(text);
    }

    // Universal fallback via get-selected-text crate:
    // macOS: Accessibility API -> Cmd+C (clipboard restored after use)
    // Windows: Ctrl+C simulation (clipboard briefly overwritten)
    // Linux:  Ctrl+C simulation (clipboard briefly overwritten)
    match get_selected_text::get_selected_text() {
        Ok(text) if !text.trim().is_empty() => Some(text),
        Ok(_) => None,
        Err(e) => {
            log::debug!("failed to read selected text: {e}");
            None
        }
    }
}

/// Windows: read selected text via UI Automation TextPattern (no clipboard).
///
/// Works for apps that expose `TextPattern` (most Win32 native controls, WPF,
/// newer Electron, Microsoft Word, Notepad, etc.).  Returns `None` for apps
/// that don't implement the pattern (triggers the Ctrl+C fallback).
#[cfg(target_os = "windows")]
fn read_selected_text_via_uia() -> Option<String> {
    use uiautomation::UIAutomation;
    use uiautomation::patterns::UITextPattern;

    let automation = UIAutomation::new().ok()?;
    let focused = automation.get_focused_element().ok()?;
    let text_pattern = focused.get_pattern::<UITextPattern>().ok()?;
    let ranges = text_pattern.get_selection().ok()?;

    for range in &ranges {
        if let Ok(text) = range.get_text(-1) {
            let text = text.trim().to_string();
            if !text.is_empty() {
                return Some(text);
            }
        }
    }
    None
}

/// Linux: read selected text from the X11 PRIMARY selection buffer.
///
/// On X11, selected text is placed in PRIMARY automatically without requiring
/// a Ctrl+C keystroke -- the clipboard is never touched.  Returns `None` on
/// Wayland sessions (where PRIMARY is unavailable) or on timeout.
#[cfg(target_os = "linux")]
fn read_selected_text_x11_primary() -> Option<String> {
    use std::time::Duration;
    use x11_clipboard::Clipboard;

    let clipboard = Clipboard::new().ok()?;
    let val = clipboard
        .load(
            clipboard.getter.atoms.primary,
            clipboard.getter.atoms.utf8_string,
            clipboard.getter.atoms.property,
            Duration::from_millis(100),
        )
        .ok()?;

    let text = String::from_utf8(val).ok()?;
    let text = text.trim().to_string();
    if text.is_empty() { None } else { Some(text) }
}

// -- Input Field Text (platform-specific) ------------------------------------

/// Read the full text content of the currently focused input field.
///
/// This uses platform-specific Accessibility / UI Automation APIs:
/// - **Windows**: `uiautomation` crate -> `ValuePattern` (simple text
///   fields) or `TextPattern` (rich text controls).  Works in most
///   native controls; some apps (e.g. Firefox, Chrome) may not expose
///   these patterns.
/// - **macOS**: Accessibility API via the focused element's `AXValue`
///   attribute. Requires Accessibility permission.
/// - **Linux**: Not available -- returns `None`.
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

// -- Windows: UI Automation --------------------------------------------------

#[cfg(target_os = "windows")]
fn read_input_field_text_windows() -> Option<String> {
    use uiautomation::UIAutomation;
    use uiautomation::patterns::UITextPattern;

    let automation = UIAutomation::new().ok()?;
    let focused = automation.get_focused_element().ok()?;

    // Try ValuePattern first -- works for simple text fields, combo boxes, etc.
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

// -- macOS: Accessibility API ------------------------------------------------

#[cfg(target_os = "macos")]
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

#[cfg(target_os = "macos")]
fn read_input_field_text_macos() -> Option<String> {
    use std::ffi::{c_char, c_void, CString};
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
        fn CFRelease(cf: *const c_void);
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            c_str: *const c_char,
            encoding: u32,
        ) -> *const c_void;
    }

    let focused_attribute_name = CString::new("AXFocusedUIElement").ok()?;
    let value_attribute_name = CString::new("AXValue").ok()?;

    unsafe {
        let focused_attribute = CFStringCreateWithCString(
            ptr::null(),
            focused_attribute_name.as_ptr(),
            K_CF_STRING_ENCODING_UTF8,
        );
        let value_attribute = CFStringCreateWithCString(
            ptr::null(),
            value_attribute_name.as_ptr(),
            K_CF_STRING_ENCODING_UTF8,
        );

        if focused_attribute.is_null() || value_attribute.is_null() {
            if !focused_attribute.is_null() {
                CFRelease(focused_attribute);
            }
            if !value_attribute.is_null() {
                CFRelease(value_attribute);
            }
            return None;
        }

        let system_wide = AXUIElementCreateSystemWide();
        if system_wide.is_null() {
            CFRelease(focused_attribute);
            CFRelease(value_attribute);
            return None;
        }

        // Get the focused UI element
        let mut focused: *mut c_void = ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(
            system_wide,
            focused_attribute,
            &mut focused,
        );
        if err != 0 || focused.is_null() {
            CFRelease(system_wide);
            CFRelease(focused_attribute);
            CFRelease(value_attribute);
            return None;
        }

        // Read the value attribute (full text of the input field)
        let mut value: *mut c_void = ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(focused, value_attribute, &mut value);

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
        CFRelease(focused_attribute);
        CFRelease(value_attribute);

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

// -- Screenshot Capture ------------------------------------------------------

/// Capture a screenshot of the monitor containing the active window and
/// return it as a base64-encoded PNG string.
///
/// Uses `Monitor::from_point()` to target the monitor where the user is
/// currently working, falling back to the primary monitor if the active
/// window position cannot be determined.
pub fn capture_screenshot_base64() -> Option<String> {
    use base64::Engine as _;
    use xcap::Monitor;

    const MAX_EDGE: u32 = 1280;
    const MAX_PNG_BYTES: usize = 4 * 1024 * 1024;

    // Find the monitor that contains the active window's top-left corner.
    // Falls back to the primary monitor on any error.
    let monitor = find_active_monitor().or_else(|| {
        Monitor::all().ok().and_then(|mut ms| {
            if ms.is_empty() {
                log::debug!("no monitors detected for screenshot capture");
                None
            } else {
                Some(ms.swap_remove(0))
            }
        })
    })?;

    let image = match monitor.capture_image() {
        Ok(img) => img,
        Err(e) => {
            log::debug!("screenshot capture failed: {e}");
            return None;
        }
    };

    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        log::debug!("captured screenshot has invalid dimensions: {width}x{height}");
        return None;
    }

    let (target_width, target_height) =
        scale_dimensions_to_max_edge(width, height, MAX_EDGE);
    if target_width != width || target_height != height {
        log::debug!(
            "downscaling screenshot for LLM context: {}x{} -> {}x{}",
            width,
            height,
            target_width,
            target_height
        );
    }

    let resized = image::imageops::resize(
        &image,
        target_width,
        target_height,
        image::imageops::FilterType::Triangle,
    );

    // Encode as PNG into memory
    let mut png_buf = std::io::Cursor::new(Vec::new());
    if image::DynamicImage::ImageRgba8(resized)
        .write_to(&mut png_buf, image::ImageFormat::Png)
        .is_err()
    {
        log::debug!("failed to encode screenshot as PNG");
        return None;
    }

    if png_buf.get_ref().len() > MAX_PNG_BYTES {
        log::warn!(
            "screenshot PNG too large for context ({} bytes), skipping screenshot context",
            png_buf.get_ref().len()
        );
        return None;
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(png_buf.into_inner());
    Some(b64)
}

fn scale_dimensions_to_max_edge(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
    if width == 0 || height == 0 || max_edge == 0 {
        return (width.max(1), height.max(1));
    }

    let largest_edge = width.max(height);
    if largest_edge <= max_edge {
        return (width, height);
    }

    let scale = max_edge as f32 / largest_edge as f32;
    let target_width = ((width as f32 * scale).round() as u32).max(1);
    let target_height = ((height as f32 * scale).round() as u32).max(1);
    (target_width, target_height)
}

/// Return the monitor that contains the currently active window.
///
/// Uses the active window's position (its top-left corner) to find the
/// enclosing monitor via `Monitor::from_point()`.
fn find_active_monitor() -> Option<xcap::Monitor> {
    let window = active_win_pos_rs::get_active_window().ok()?;
    // Use the window's top-left corner to identify its monitor.
    let x = window.position.x as i32;
    let y = window.position.y as i32;
    xcap::Monitor::from_point(x, y).ok()
}

#[cfg(test)]
mod tests {
    use super::scale_dimensions_to_max_edge;

    #[test]
    fn keeps_dimensions_when_within_limit() {
        assert_eq!(scale_dimensions_to_max_edge(1280, 720, 1280), (1280, 720));
    }

    #[test]
    fn scales_down_landscape_to_max_edge() {
        assert_eq!(scale_dimensions_to_max_edge(2560, 1440, 1280), (1280, 720));
    }

    #[test]
    fn scales_down_portrait_to_max_edge() {
        assert_eq!(scale_dimensions_to_max_edge(1440, 2560, 1280), (720, 1280));
    }
}
