use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use thiserror::Error;

use crate::config::{AppSettings, OutputMode, VocabularyEntry};
use crate::llm;
use crate::output;
use crate::stt;

#[derive(Error, Debug)]
pub enum PipelineError {
    #[error("STT error: {0}")]
    Stt(#[from] stt::SttError),
    #[error("LLM error: {0}")]
    Llm(#[from] llm::LlmError),
    #[error("output error: {0}")]
    Output(#[from] output::OutputError),
}

#[derive(serde::Serialize, Clone)]
pub struct PipelineStatus {
    pub status: String,
    pub text: Option<String>,
    pub error: Option<String>,
}

fn emit_status(app: &AppHandle, status: &str, text: Option<&str>, error: Option<&str>) {
    let payload = PipelineStatus {
        status: status.into(),
        text: text.map(String::from),
        error: error.map(String::from),
    };
    if let Err(e) = app.emit("pipeline-status", payload) {
        log::error!("failed to emit pipeline status: {e}");
    }
}

fn was_cancelled(cancel_generation: &Arc<AtomicU64>, operation_generation: u64) -> bool {
    cancel_generation.load(Ordering::SeqCst) != operation_generation
}

/// Build the system prompt, appending user instructions and vocabulary entries.
pub fn build_system_prompt(base_prompt: &str, user_instructions: &str, vocabulary: &[VocabularyEntry]) -> String {
    let mut prompt = base_prompt.to_string();

    if !user_instructions.trim().is_empty() {
        prompt.push_str("\n\nAdditional user instructions:\n");
        prompt.push_str(user_instructions.trim());
    }

    if !vocabulary.is_empty() {
        prompt.push_str("\n\nVocabulary corrections (always apply these):\n");
        for entry in vocabulary {
            prompt.push_str(&format!("- \"{}\" → \"{}\"\n", entry.wrong, entry.correct));
        }
    }

    prompt
}

/// Result of a successful pipeline run.
pub struct PipelineResult {
    pub raw_text: String,
    pub polished_text: Option<String>,
    pub duration_seconds: f64,
    pub suppressed: bool,
    pub delivery_error: Option<String>,
}

/// Run the full pipeline: STT → LLM polish → output.
/// Caller is responsible for history insertion.
pub async fn run(
    app: &AppHandle,
    audio_data: Vec<u8>,
    settings: &AppSettings,
    recent_context: Vec<String>,
    cancel_generation: Arc<AtomicU64>,
    operation_generation: u64,
    paste_fail_count: &AtomicU32,
    auto_clipboard_fallback_threshold: u32,
) -> Result<PipelineResult, PipelineError> {
    let start = std::time::Instant::now();

    // Step 1: Speech-to-text
    emit_status(app, "transcribing", None, None);
    let raw_text = stt::transcribe(
        &settings.stt,
        audio_data,
        settings.general.timeout_ms,
        settings.general.max_retries,
    )
    .await?;

    if was_cancelled(&cancel_generation, operation_generation) {
        log::info!("pipeline cancelled after transcription; suppressing result presentation");
        return Ok(PipelineResult {
            raw_text,
            polished_text: None,
            duration_seconds: start.elapsed().as_secs_f64(),
            suppressed: true,
            delivery_error: None,
        });
    }

    if raw_text.trim().is_empty() {
        emit_status(app, "noSpeech", None, None);
        return Ok(PipelineResult {
            raw_text: String::new(),
            polished_text: None,
            duration_seconds: start.elapsed().as_secs_f64(),
            suppressed: false,
            delivery_error: None,
        });
    }

    // Step 2: LLM polish (optional)
    let polished = if settings.llm.enabled {
        emit_status(app, "polishing", Some(&raw_text), None);

        let system_prompt = build_system_prompt(
            &settings.prompt.system_prompt,
            &settings.prompt.user_instructions,
            &settings.prompt.vocabulary,
        );

        match llm::polish(
            &settings.llm,
            &system_prompt,
            &raw_text,
            &recent_context,
            settings.general.timeout_ms,
            settings.general.max_retries,
        )
        .await
        {
            Ok(polished) if !polished.trim().is_empty() => Some(polished),
            Ok(_) => {
                log::debug!("LLM returned empty polish, using raw text");
                None
            }
            Err(e) => {
                log::warn!("LLM polish failed, using raw text: {e}");
                None // Fall back to raw text
            }
        }
    } else {
        None
    };

    if was_cancelled(&cancel_generation, operation_generation) {
        log::info!("pipeline cancelled during processing; suppressing result presentation");
        return Ok(PipelineResult {
            raw_text,
            polished_text: polished,
            duration_seconds: start.elapsed().as_secs_f64(),
            suppressed: true,
            delivery_error: None,
        });
    }

    let final_text = polished.as_deref().unwrap_or(&raw_text);

    // Step 3: Output
    // Auto-fallback: if paste has failed consecutively too many times,
    // silently switch to clipboard-only for this operation.
    let effective_output_mode = if paste_fail_count.load(Ordering::Relaxed) >= auto_clipboard_fallback_threshold {
        &OutputMode::ClipboardOnly
    } else {
        &settings.general.output_mode
    };

    let outcome = if !final_text.is_empty() {
        match output::output_text(
            final_text,
            effective_output_mode,
            &settings.general.clipboard_behavior,
        ) {
            Ok(o) => o,
            Err(e) => {
                log::error!("output error: {e}");
                // Clipboard itself failed — nothing was delivered.
                emit_status(app, "error", Some(final_text), Some(&e.to_string()));
                return Ok(PipelineResult {
                    raw_text,
                    polished_text: polished,
                    duration_seconds: start.elapsed().as_secs_f64(),
                    suppressed: false,
                    delivery_error: Some(e.to_string()),
                });
            }
        }
    } else {
        output::OutputOutcome::CopiedToClipboard
    };

    match outcome {
        output::OutputOutcome::PasteFailedCopiedToClipboard => {
            paste_fail_count.fetch_add(1, Ordering::Relaxed);
            emit_status(app, "clipboardFallback", Some(final_text), None);
        }
        output::OutputOutcome::Pasted => {
            paste_fail_count.store(0, Ordering::Relaxed);
            emit_status(app, "done", Some(final_text), None);
        }
        _ => {
            emit_status(app, "done", Some(final_text), None);
        }
    }

    Ok(PipelineResult {
        raw_text,
        polished_text: polished,
        duration_seconds: start.elapsed().as_secs_f64(),
        suppressed: false,
        delivery_error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_system_prompt_base_only() {
        let result = build_system_prompt("You are a transcription assistant.", "", &[]);
        assert_eq!(result, "You are a transcription assistant.");
    }

    #[test]
    fn build_system_prompt_with_instructions() {
        let result = build_system_prompt("Base.", "Always use formal tone.", &[]);
        assert!(result.starts_with("Base."));
        assert!(result.contains("Additional user instructions:"));
        assert!(result.contains("Always use formal tone."));
    }

    #[test]
    fn build_system_prompt_with_vocabulary() {
        let vocab = vec![
            VocabularyEntry { wrong: "teh".into(), correct: "the".into() },
            VocabularyEntry { wrong: "recieve".into(), correct: "receive".into() },
        ];
        let result = build_system_prompt("Base.", "", &vocab);
        assert!(result.contains("Vocabulary corrections"));
        assert!(result.contains("\"teh\" → \"the\""));
        assert!(result.contains("\"recieve\" → \"receive\""));
        assert!(!result.contains("Additional user instructions:"));
    }

    #[test]
    fn build_system_prompt_with_both() {
        let vocab = vec![VocabularyEntry { wrong: "x".into(), correct: "y".into() }];
        let result = build_system_prompt("Base.", "Be concise.", &vocab);
        assert!(result.contains("Additional user instructions:"));
        assert!(result.contains("Be concise."));
        assert!(result.contains("\"x\" → \"y\""));
    }

    #[test]
    fn build_system_prompt_trims_whitespace_only_instructions() {
        let result = build_system_prompt("Base.", "   \n  ", &[]);
        assert_eq!(result, "Base.");
        assert!(!result.contains("Additional user instructions:"));
    }
}
