use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use thiserror::Error;

use crate::config::{ClipboardBehavior, OutputMode};

#[derive(Error, Debug)]
pub enum OutputError {
    #[error("clipboard error: {0}")]
    Clipboard(String),
    #[error("keyboard simulation error: {0}")]
    Keyboard(String),
}

pub fn copy_to_clipboard(text: &str) -> Result<(), OutputError> {
    let mut clipboard = Clipboard::new().map_err(|e| OutputError::Clipboard(e.to_string()))?;
    clipboard
        .set_text(text)
        .map_err(|e| OutputError::Clipboard(e.to_string()))?;
    Ok(())
}

fn simulate_paste() -> Result<(), OutputError> {
    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| OutputError::Keyboard(e.to_string()))?;

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

    Ok(())
}

/// Output transcribed text according to user preferences.
pub fn output_text(
    text: &str,
    mode: &OutputMode,
    clipboard_behavior: &ClipboardBehavior,
) -> Result<(), OutputError> {
    match mode {
        OutputMode::ClipboardOnly => {
            copy_to_clipboard(text)?;
            log::info!("text copied to clipboard ({} chars)", text.len());
        }
        OutputMode::AutoPaste => {
            // Always copy to clipboard first (needed for paste simulation)
            copy_to_clipboard(text)?;

            match simulate_paste() {
                Ok(_) => {
                    log::info!("text auto-pasted ({} chars)", text.len());
                    // If behavior is OnlyOnPasteFail, clear clipboard after successful paste
                    if *clipboard_behavior == ClipboardBehavior::OnlyOnPasteFail {
                        std::thread::spawn(|| {
                            std::thread::sleep(std::time::Duration::from_millis(300));
                            if let Ok(mut cb) = Clipboard::new() {
                                let _ = cb.clear();
                                log::debug!("clipboard cleared after successful paste");
                            }
                        });
                    }
                }
                Err(e) => {
                    log::warn!("paste simulation failed: {e}, text remains in clipboard");
                    // Text is already in clipboard from the copy above
                }
            }
        }
    }
    Ok(())
}
