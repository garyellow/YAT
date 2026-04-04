use tauri::{AppHandle, Emitter};
use thiserror::Error;

use crate::config::{AppSettings, VocabularyEntry};
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

/// Build the system prompt, appending vocabulary entries if any.
fn build_system_prompt(base_prompt: &str, vocabulary: &[VocabularyEntry]) -> String {
    if vocabulary.is_empty() {
        return base_prompt.to_string();
    }

    let mut prompt = base_prompt.to_string();
    prompt.push_str("\n\nVocabulary corrections (always apply these):\n");
    for entry in vocabulary {
        prompt.push_str(&format!("- \"{}\" → \"{}\"\n", entry.wrong, entry.correct));
    }
    prompt
}

/// Result of a successful pipeline run.
pub struct PipelineResult {
    pub raw_text: String,
    pub polished_text: Option<String>,
    pub duration_seconds: f64,
}

/// Run the full pipeline: STT → LLM polish → output.
/// Caller is responsible for history insertion.
pub async fn run(
    app: &AppHandle,
    audio_data: Vec<u8>,
    settings: &AppSettings,
    recent_context: Vec<String>,
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

    if raw_text.trim().is_empty() {
        emit_status(app, "done", Some(""), None);
        return Ok(PipelineResult {
            raw_text: String::new(),
            polished_text: None,
            duration_seconds: start.elapsed().as_secs_f64(),
        });
    }

    // Step 2: LLM polish (optional)
    let polished = if settings.llm.enabled {
        emit_status(app, "polishing", Some(&raw_text), None);

        let system_prompt =
            build_system_prompt(&settings.prompt.system_prompt, &settings.prompt.vocabulary);

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
            Ok(polished) => Some(polished),
            Err(e) => {
                log::warn!("LLM polish failed, using raw text: {e}");
                None // Fall back to raw text
            }
        }
    } else {
        None
    };

    let final_text = polished.as_deref().unwrap_or(&raw_text);

    // Step 3: Output
    if !final_text.is_empty() {
        if let Err(e) = output::output_text(
            final_text,
            &settings.general.output_mode,
            &settings.general.clipboard_behavior,
        ) {
            log::error!("output error: {e}");
        }
    }

    emit_status(app, "done", Some(final_text), None);

    Ok(PipelineResult {
        raw_text,
        polished_text: polished,
        duration_seconds: start.elapsed().as_secs_f64(),
    })
}
