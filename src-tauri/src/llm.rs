use reqwest::header::{HeaderMap, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::config::LlmConfig;

#[derive(Error, Debug)]
pub enum LlmError {
    #[error("LLM request failed: {0}")]
    Request(String),
    #[error("LLM response error: {status} – {body}")]
    ApiError { status: u16, body: String },
    #[error("LLM parse error: {0}")]
    Parse(String),
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
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

/// Send text to an OpenAI-compatible `/chat/completions` endpoint for polishing.
pub async fn polish(
    config: &LlmConfig,
    system_prompt: &str,
    raw_text: &str,
    recent_context: &[String],
    timeout_ms: u64,
    max_retries: u32,
) -> Result<String, LlmError> {
    let url = format!(
        "{}/chat/completions",
        config.base_url.trim_end_matches('/')
    );

    let mut messages = vec![ChatMessage {
        role: "system".into(),
        content: system_prompt.to_string(),
    }];

    // Add recent transcription context if available
    if !recent_context.is_empty() {
        let ctx = recent_context.join("\n---\n");
        messages.push(ChatMessage {
            role: "system".into(),
            content: format!(
                "Recent transcriptions for context (maintain consistency with these terms):\n{ctx}"
            ),
        });
    }

    messages.push(ChatMessage {
        role: "user".into(),
        content: raw_text.to_string(),
    });

    let body = ChatRequest {
        model: config.model.clone(),
        messages,
        temperature: 0.0,
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        format!("Bearer {}", config.api_key)
            .parse()
            .map_err(|_| LlmError::Request("invalid authorization header value".into()))?,
    );
    headers.insert(CONTENT_TYPE, "application/json".parse().unwrap());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| LlmError::Request(e.to_string()))?;

    let mut last_error = LlmError::Request("no attempts made".into());

    for attempt in 0..=max_retries {
        if attempt > 0 {
            let delay = std::time::Duration::from_millis(500 * attempt as u64);
            tokio::time::sleep(delay).await;
            log::info!("LLM retry attempt {attempt}/{max_retries}");
        }

        let result = client
            .post(&url)
            .headers(headers.clone())
            .json(&body)
            .send()
            .await;

        match result {
            Ok(resp) => {
                let status = resp.status().as_u16();
                if status >= 400 {
                    let body = resp.text().await.unwrap_or_default();
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

/// Quick connectivity check.
pub async fn test_connection(config: &LlmConfig) -> Result<String, LlmError> {
    polish(config, "Reply with: OK", "test", &[], 30000, 0).await
}
