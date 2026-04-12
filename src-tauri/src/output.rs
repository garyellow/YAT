use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::sync::atomic::{AtomicBool, Ordering};
use thiserror::Error;

use crate::config::{ClipboardBehavior, OutputMode};

/// Global flag: when `true`, the keyboard grab callback should pass through
/// all events so that simulated key presses (Ctrl+V) are not intercepted.
static PASTE_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Returns `true` while a paste simulation is in progress.
pub fn is_paste_active() -> bool {
    PASTE_ACTIVE.load(Ordering::SeqCst)
}

/// RAII guard that sets `PASTE_ACTIVE` on creation and clears it on drop.
struct PasteGuard;

impl PasteGuard {
    fn activate() -> Self {
        PASTE_ACTIVE.store(true, Ordering::SeqCst);
        // Small delay so the grab thread sees the flag before any simulated
        // events arrive.
        std::thread::sleep(std::time::Duration::from_millis(10));
        Self
    }
}

impl Drop for PasteGuard {
    fn drop(&mut self) {
        // Small delay so any trailing simulated events finish passing through
        // before we re-enable interception.
        std::thread::sleep(std::time::Duration::from_millis(10));
        PASTE_ACTIVE.store(false, Ordering::SeqCst);
    }
}

#[derive(Error, Debug)]
pub enum OutputError {
    #[error("clipboard error: {0}")]
    Clipboard(String),
    #[error("keyboard simulation error: {0}")]
    Keyboard(String),
}

/// Describes how the text was actually delivered to the user.
#[derive(Debug, Clone, PartialEq)]
pub enum OutputOutcome {
    /// Successfully pasted into the focused application.
    Pasted,
    /// Copied to clipboard (user chose clipboard-only mode).
    CopiedToClipboard,
    /// Paste simulation failed; text is still available in the clipboard.
    PasteFailedCopiedToClipboard,
}

fn copy_to_clipboard(text: &str) -> Result<(), OutputError> {
    let mut clipboard = Clipboard::new().map_err(|e| OutputError::Clipboard(e.to_string()))?;
    clipboard
        .set_text(text)
        .map_err(|e| OutputError::Clipboard(e.to_string()))?;
    Ok(())
}

fn simulate_paste() -> Result<(), OutputError> {
    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| OutputError::Keyboard(e.to_string()))?;

    // Activate paste guard so the global keyboard grab passes through the
    // simulated Ctrl/Cmd+V instead of intercepting it as a hotkey.
    let _guard = PasteGuard::activate();

    // Small delay before simulating keys
    std::thread::sleep(std::time::Duration::from_millis(50));

    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;

    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo
        .key(modifier, Direction::Press)
        .map_err(|e| OutputError::Keyboard(e.to_string()))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| OutputError::Keyboard(e.to_string()))?;
    enigo
        .key(modifier, Direction::Release)
        .map_err(|e| OutputError::Keyboard(e.to_string()))?;

    // _guard drops here, clearing PASTE_ACTIVE after a small delay

    Ok(())
}

/// Output transcribed text according to user preferences.
pub fn output_text(
    text: &str,
    mode: &OutputMode,
    clipboard_behavior: &ClipboardBehavior,
) -> Result<OutputOutcome, OutputError> {
    match mode {
        OutputMode::ClipboardOnly => {
            copy_to_clipboard(text)?;
            log::info!("text copied to clipboard ({} chars)", text.len());
            Ok(OutputOutcome::CopiedToClipboard)
        }
        OutputMode::AutoPaste => {
            // Always copy to clipboard first (needed for paste simulation)
            copy_to_clipboard(text)?;

            match simulate_paste() {
                Ok(_) => {
                    log::info!("text auto-pasted ({} chars)", text.len());
                    // If behavior is OnlyOnPasteFail, clear clipboard after successful paste.
                    // Verify the clipboard still holds our text before clearing so we don't
                    // accidentally wipe something the user copied in the meantime.
                    if *clipboard_behavior == ClipboardBehavior::OnlyOnPasteFail {
                        let expected = text.to_string();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(500));
                            if let Ok(mut cb) = Clipboard::new() {
                                let still_ours = cb
                                    .get_text()
                                    .is_ok_and(|current| current == expected);
                                if still_ours {
                                    if let Err(error) = cb.clear() {
                                        log::debug!(
                                            "failed to clear clipboard after successful paste: {error}"
                                        );
                                    } else {
                                        log::debug!("clipboard cleared after successful paste");
                                    }
                                } else {
                                    log::debug!(
                                        "clipboard content changed since paste; skipping clear"
                                    );
                                }
                            }
                        });
                    }
                    Ok(OutputOutcome::Pasted)
                }
                Err(e) => {
                    log::warn!("paste simulation failed: {e}, text remains in clipboard");
                    // Text is already in clipboard from the copy above
                    Ok(OutputOutcome::PasteFailedCopiedToClipboard)
                }
            }
        }
    }
}
