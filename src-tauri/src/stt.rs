use bytes::Bytes;
use reqwest::multipart;
use serde::Deserialize;
use thiserror::Error;

use crate::config::SttConfig;

#[derive(Error, Debug)]
pub enum SttError {
    #[error("STT request failed: {0}")]
    Request(String),
    #[error("STT response error: {status} – {body}")]
    ApiError { status: u16, body: String },
    #[error("STT parse error: {0}")]
    Parse(String),
}

#[derive(Debug, Deserialize)]
struct SttResponse {
    text: String,
}

/// Send audio bytes (WAV) to an OpenAI-compatible `/audio/transcriptions` endpoint.
pub async fn transcribe(
    config: &SttConfig,
    wav_data: Vec<u8>,
    timeout_ms: u64,
    max_retries: u32,
) -> Result<String, SttError> {
    if config.base_url.trim().is_empty() {
        return Err(SttError::Request(
            "STT base URL is not configured. Please set it in Settings → STT.".into(),
        ));
    }
    if config.api_key.trim().is_empty() {
        return Err(SttError::Request(
            "STT API key is not configured. Please set it in Settings → STT.".into(),
        ));
    }
    if config.model.trim().is_empty() {
        return Err(SttError::Request(
            "STT model is not configured. Please set it in Settings → STT.".into(),
        ));
    }

    let url = format!(
        "{}/audio/transcriptions",
        config.base_url.trim_end_matches('/')
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| SttError::Request(e.to_string()))?;

    // Wrap in Bytes so retry loops only bump a refcount instead of
    // cloning the full audio buffer (which can be several MB).
    let shared_wav = Bytes::from(wav_data);

    let mut last_error = SttError::Request("no attempts made".into());

    for attempt in 0..=max_retries {
        if attempt > 0 {
            let delay = std::time::Duration::from_millis(500 * attempt as u64);
            tokio::time::sleep(delay).await;
            log::info!("STT retry attempt {attempt}/{max_retries}");
        }

        let file_part =
            multipart::Part::stream_with_length(shared_wav.clone(), shared_wav.len() as u64)
                .file_name("recording.wav")
                .mime_str("audio/wav")
                .map_err(|e| SttError::Request(e.to_string()))?;

        let mut form = multipart::Form::new()
            .text("model", config.model.clone())
            .text("temperature", "0")
            .text("response_format", "json")
            .part("file", file_part);

        if let Some(ref lang) = config.language {
            if !lang.is_empty() {
                form = form.text("language", lang.clone());
            }
        }

        let result = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .multipart(form)
            .send()
            .await;

        match result {
            Ok(resp) => {
                let status = resp.status().as_u16();
                if status >= 400 {
                    let body = resp.text().await.unwrap_or_default();
                    last_error = SttError::ApiError { status, body };
                    // Don't retry on client errors (4xx)
                    if status < 500 {
                        return Err(last_error);
                    }
                    continue;
                }

                let stt_resp: SttResponse = resp
                    .json()
                    .await
                    .map_err(|e| SttError::Parse(e.to_string()))?;

                return Ok(stt_resp.text);
            }
            Err(e) => {
                last_error = SttError::Request(e.to_string());
                continue;
            }
        }
    }

    Err(last_error)
}

/// Quick connectivity check – sends a tiny silence WAV.
pub async fn test_connection(config: &SttConfig) -> Result<String, SttError> {
    // Generate 0.5s silence WAV for testing
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = std::io::Cursor::new(Vec::new());
    let mut writer = hound::WavWriter::new(&mut cursor, spec)
        .map_err(|e| SttError::Request(e.to_string()))?;
    for _ in 0..8000 {
        writer
            .write_sample(0i16)
            .map_err(|e| SttError::Request(e.to_string()))?;
    }
    writer
        .finalize()
        .map_err(|e| SttError::Request(e.to_string()))?;

    transcribe(config, cursor.into_inner(), 30000, 0).await
}
