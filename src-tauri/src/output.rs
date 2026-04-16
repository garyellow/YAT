use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::sync::atomic::{AtomicBool, Ordering};
use thiserror::Error;

use crate::config::{ClipboardBehavior, OutputMode};

const PASTE_GUARD_ENTER_DELAY_MS: u64 = 20;
const PASTE_GUARD_EXIT_DELAY_MS: u64 = 20;
const PASTE_RETRY_BASE_DELAY_MS: u64 = 150;
const PASTE_RETRY_MAX_EXPONENT: u8 = 3;
const PASTE_SIMULATION_MAX_ATTEMPTS: u8 = 3;

trait KeyboardSimulator {
    fn send_key(&mut self, key: Key, direction: Direction) -> Result<(), OutputError>;
}

impl KeyboardSimulator for Enigo {
    fn send_key(&mut self, key: Key, direction: Direction) -> Result<(), OutputError> {
        self.key(key, direction)
            .map_err(|e| OutputError::Keyboard(e.to_string()))
    }
}

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
        std::thread::sleep(std::time::Duration::from_millis(PASTE_GUARD_ENTER_DELAY_MS));
        Self
    }
}

impl Drop for PasteGuard {
    fn drop(&mut self) {
        // Small delay so any trailing simulated events finish passing through
        // before we re-enable interception.
        std::thread::sleep(std::time::Duration::from_millis(PASTE_GUARD_EXIT_DELAY_MS));
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

fn perform_paste_shortcut(
    keyboard: &mut impl KeyboardSimulator,
    modifier: Key,
) -> Result<(), OutputError> {
    keyboard.send_key(modifier.clone(), Direction::Press)?;

    let paste_result = keyboard.send_key(Key::Unicode('v'), Direction::Click);
    let release_result = keyboard.send_key(modifier, Direction::Release);

    match (paste_result, release_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Ok(()), Err(release_error)) => Err(release_error),
        (Err(paste_error), Ok(())) => Err(paste_error),
        (Err(paste_error), Err(release_error)) => {
            log::warn!(
                "paste simulation failed and modifier release also failed: {release_error}"
            );
            Err(paste_error)
        }
    }
}

fn simulate_paste() -> Result<(), OutputError> {
    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| OutputError::Keyboard(e.to_string()))?;

    // Activate paste guard so the global keyboard grab passes through the
    // simulated Ctrl/Cmd+V instead of intercepting it as a hotkey.
    let _guard = PasteGuard::activate();

    // Small delay before simulating keys to ensure OS clipboard sync
    std::thread::sleep(std::time::Duration::from_millis(150));

    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;

    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    perform_paste_shortcut(&mut enigo, modifier)?;

    // _guard drops here, clearing PASTE_ACTIVE after a small delay

    Ok(())
}

fn retry_delay_for_attempt(attempt: u8) -> std::time::Duration {
    let exponent = attempt.saturating_sub(1).min(PASTE_RETRY_MAX_EXPONENT);
    let delay_ms = PASTE_RETRY_BASE_DELAY_MS.saturating_mul(1_u64 << exponent);
    std::time::Duration::from_millis(delay_ms)
}

fn simulate_paste_with_retry(max_attempts: u8) -> Result<(), OutputError> {
    let attempts = max_attempts.max(1);

    for attempt in 1..=attempts {
        match simulate_paste() {
            Ok(()) => {
                if attempt > 1 {
                    log::info!(
                        "paste simulation recovered on retry ({attempt}/{attempts})"
                    );
                }
                return Ok(());
            }
            Err(error) => {
                if attempt == attempts {
                    return Err(error);
                }

                log::warn!(
                    "paste simulation attempt {attempt}/{attempts} failed: {error}; retrying"
                );
                std::thread::sleep(retry_delay_for_attempt(attempt));
            }
        }
    }

    Err(OutputError::Keyboard(
        "paste simulation failed unexpectedly".to_string(),
    ))
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

            match simulate_paste_with_retry(PASTE_SIMULATION_MAX_ATTEMPTS) {
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

#[cfg(test)]
mod tests {
    use super::{perform_paste_shortcut, retry_delay_for_attempt, KeyboardSimulator, OutputError};
    use enigo::{Direction, Key};

    #[derive(Default)]
    struct FakeKeyboard {
        fail_on_call: Option<usize>,
        calls: Vec<(String, String)>,
    }

    impl KeyboardSimulator for FakeKeyboard {
        fn send_key(&mut self, key: Key, direction: Direction) -> Result<(), OutputError> {
            self.calls
                .push((format!("{key:?}"), format!("{direction:?}")));

            if self.fail_on_call == Some(self.calls.len()) {
                return Err(OutputError::Keyboard("simulated failure".into()));
            }

            Ok(())
        }
    }

    #[test]
    fn retry_delay_uses_exponential_backoff() {
        assert_eq!(retry_delay_for_attempt(1).as_millis(), 150);
        assert_eq!(retry_delay_for_attempt(2).as_millis(), 300);
        assert_eq!(retry_delay_for_attempt(3).as_millis(), 600);
    }

    #[test]
    fn retry_delay_caps_exponent_to_avoid_unbounded_wait() {
        assert_eq!(retry_delay_for_attempt(4).as_millis(), 1200);
        assert_eq!(retry_delay_for_attempt(7).as_millis(), 1200);
    }

    #[test]
    fn paste_shortcut_releases_modifier_after_click_failure() {
        let mut keyboard = FakeKeyboard {
            fail_on_call: Some(2),
            ..FakeKeyboard::default()
        };

        let result = perform_paste_shortcut(&mut keyboard, Key::Control);

        assert!(matches!(result, Err(OutputError::Keyboard(_))));
        assert_eq!(keyboard.calls.len(), 3);
        assert_eq!(keyboard.calls[0].1, "Press");
        assert_eq!(keyboard.calls[1].1, "Click");
        assert_eq!(keyboard.calls[2].1, "Release");
    }

    #[test]
    fn paste_shortcut_returns_release_error_when_click_succeeds() {
        let mut keyboard = FakeKeyboard {
            fail_on_call: Some(3),
            ..FakeKeyboard::default()
        };

        let result = perform_paste_shortcut(&mut keyboard, Key::Control);

        assert!(matches!(result, Err(OutputError::Keyboard(_))));
        assert_eq!(keyboard.calls.len(), 3);
        assert_eq!(keyboard.calls[2].1, "Release");
    }

    #[test]
    fn paste_shortcut_stops_immediately_when_press_fails() {
        let mut keyboard = FakeKeyboard {
            fail_on_call: Some(1),
            ..FakeKeyboard::default()
        };

        let result = perform_paste_shortcut(&mut keyboard, Key::Control);

        assert!(matches!(result, Err(OutputError::Keyboard(_))));
        assert_eq!(keyboard.calls.len(), 1);
        assert_eq!(keyboard.calls[0].1, "Press");
    }
}
