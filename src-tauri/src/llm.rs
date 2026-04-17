use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::config::LlmConfig;

const MAX_ERROR_BODY_LEN: usize = 400;

#[derive(Debug, Deserialize)]
struct ApiErrorEnvelope {
    error: Option<ApiErrorBody>,
}

#[derive(Debug, Deserialize)]
struct ApiErrorBody {
    message: Option<String>,
}

fn truncate_for_ui(input: &str, max_len: usize) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut chars = trimmed.chars();
    let preview: String = chars.by_ref().take(max_len).collect();
    if chars.next().is_some() {
        format!("{preview}…")
    } else {
        preview
    }
}

fn summarize_api_error_body(raw_body: &str) -> String {
    if raw_body.trim().is_empty() {
        return "(empty response body)".to_string();
    }
    if let Ok(parsed) = serde_json::from_str::<ApiErrorEnvelope>(raw_body) {
        if let Some(message) = parsed.error.and_then(|err| err.message) {
            let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
            if !normalized.is_empty() {
                return truncate_for_ui(&normalized, MAX_ERROR_BODY_LEN);
            }
        }
    }
    truncate_for_ui(raw_body, MAX_ERROR_BODY_LEN)
}

#[derive(Error, Debug)]
pub enum LlmError {
    #[error("LLM request failed: {0}")]
    Request(String),
    #[error("LLM response error: {status} – {body}")]
    ApiError { status: u16, body: String },
    #[error("LLM parse error: {0}")]
    Parse(String),
}

#[derive(Serialize, Clone)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
}

#[derive(Serialize, Clone)]
struct ChatMessage {
    role: String,
    content: serde_json::Value,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessageResp,
}

#[derive(Deserialize)]
struct ChatMessageResp {
    content: String,
}

fn build_user_content(raw_text: &str, screenshot_base64: Option<&str>) -> serde_json::Value {
    if let Some(b64) = screenshot_base64 {
        serde_json::json!([
            { "type": "text", "text": raw_text },
            {
                "type": "image_url",
                "image_url": {
                    "url": format!("data:image/png;base64,{b64}"),
                    "detail": "low"
                }
            }
        ])
    } else {
        serde_json::Value::String(raw_text.to_string())
    }
}

fn error_looks_like_vision_unsupported(error: &LlmError) -> bool {
    match error {
        LlmError::ApiError {
            status: 400 | 404 | 413 | 415 | 422 | 501,
            body,
        } => {
            let body = body.to_lowercase();
            [
                "vision",
                "image_url",
                "image input",
                "images are not supported",
                "does not support images",
                "doesn't support images",
                "multimodal",
                "unsupported content",
                "unsupported message type",
                "invalid image",
                "content type",
                "must be a string",
                "must be a valid string",
                "payload too large",
                "request too large",
                "request entity too large",
                "content too large",
                "maximum image size",
                "max image size",
                "image too large",
                "context length",
            ]
            .iter()
            .any(|needle| body.contains(needle))
        }
        _ => false,
    }
}

#[allow(clippy::too_many_arguments)]
async fn send_chat_request(
    client: &reqwest::Client,
    url: &str,
    headers: &HeaderMap,
    model: &str,
    base_messages: &[ChatMessage],
    raw_text: &str,
    screenshot_base64: Option<&str>,
    max_retries: u32,
) -> Result<String, LlmError> {
    let mut last_error = LlmError::Request("no attempts made".into());

    for attempt in 0..=max_retries {
        if attempt > 0 {
            let delay = std::time::Duration::from_millis(500 * attempt as u64);
            tokio::time::sleep(delay).await;
            log::info!("LLM retry attempt {attempt}/{max_retries}");
        }

        let mut messages = base_messages.to_vec();
        messages.push(ChatMessage {
            role: "user".into(),
            content: build_user_content(raw_text, screenshot_base64),
        });

        let body = ChatRequest {
            model: model.to_string(),
            messages,
            temperature: 0.0,
        };

        let result = client
            .post(url)
            .headers(headers.clone())
            .json(&body)
            .send()
            .await;

        match result {
            Ok(resp) => {
                let status = resp.status().as_u16();
                if status >= 400 {
                    let body = resp
                        .text()
                        .await
                        .map(|raw| summarize_api_error_body(&raw))
                        .unwrap_or_else(|_| "(failed to read error body)".to_string());
                    last_error = LlmError::ApiError { status, body };
                    if status < 500 {
                        return Err(last_error);
                    }
                    continue;
                }

                let chat_resp: ChatResponse = resp
                    .json()
                    .await
                    .map_err(|e| LlmError::Parse(e.to_string()))?;

                return chat_resp
                    .choices
                    .into_iter()
                    .next()
                    .map(|c| c.message.content)
                    .ok_or_else(|| LlmError::Parse("empty response choices".into()));
            }
            Err(e) => {
                last_error = LlmError::Request(e.to_string());
                continue;
            }
        }
    }

    Err(last_error)
}

/// Send text to an OpenAI-compatible `/chat/completions` endpoint for polishing.
pub async fn polish(
    config: &LlmConfig,
    system_prompt: &str,
    raw_text: &str,
    recent_context: &[String],
    screenshot_base64: Option<&str>,
    timeout_ms: u64,
    max_retries: u32,
) -> Result<String, LlmError> {
    let base_url = config.base_url.trim();
    let api_key = config.api_key.trim();
    let model = config.model.trim();

    if base_url.is_empty() {
        return Err(LlmError::Request(
            "LLM base URL is not configured. Please set it in Settings → LLM.".into(),
        ));
    }
    if model.is_empty() {
        return Err(LlmError::Request(
            "LLM model is not configured. Please set it in Settings → LLM.".into(),
        ));
    }

    let url = format!(
        "{}/chat/completions",
        base_url.trim_end_matches('/')
    );

    let mut messages = vec![ChatMessage {
        role: "system".into(),
        content: serde_json::Value::String(system_prompt.to_string()),
    }];

    // Add recent transcription context if available
    if !recent_context.is_empty() {
        let ctx = recent_context.join("\n---\n");
        messages.push(ChatMessage {
            role: "system".into(),
            content: serde_json::Value::String(format!(
                "Recent transcriptions for context (maintain consistency with the wording and terminology used here):\n{ctx}"
            )),
        });
    }

    let mut headers = HeaderMap::new();
    if !api_key.is_empty() {
        headers.insert(
            AUTHORIZATION,
            format!("Bearer {api_key}")
                .parse()
                .map_err(|_| LlmError::Request("invalid authorization header value".into()))?,
        );
    }
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| LlmError::Request(e.to_string()))?;

    match send_chat_request(
        &client,
        &url,
        &headers,
        model,
        &messages,
        raw_text,
        screenshot_base64,
        max_retries,
    )
    .await
    {
        Err(error) if screenshot_base64.is_some() && error_looks_like_vision_unsupported(&error) => {
            log::warn!(
                "LLM provider/model rejected screenshot input; retrying with text-only polishing"
            );
            send_chat_request(
                &client,
                &url,
                &headers,
                model,
                &messages,
                raw_text,
                None,
                max_retries,
            )
            .await
        }
        other => other,
    }
}

/// Quick connectivity check.
pub async fn test_connection(config: &LlmConfig) -> Result<String, LlmError> {
    polish(config, "Reply with: OK", "test", &[], None, 30000, 0).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vision_error_detector_matches_payload_too_large() {
        let error = LlmError::ApiError {
            status: 413,
            body: "Payload too large: image exceeds maximum size".into(),
        };

        assert!(error_looks_like_vision_unsupported(&error));
    }

    #[test]
    fn vision_error_detector_ignores_unrelated_server_errors() {
        let error = LlmError::ApiError {
            status: 500,
            body: "internal server error".into(),
        };

        assert!(!error_looks_like_vision_unsupported(&error));
    }
}
