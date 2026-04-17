use serde::Deserialize;

pub(crate) const MAX_ERROR_BODY_LEN: usize = 400;

#[derive(Debug, Deserialize)]
pub(crate) struct ApiErrorEnvelope {
    pub error: Option<ApiErrorBody>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ApiErrorBody {
    pub message: Option<String>,
}

pub(crate) fn truncate_for_ui(input: &str, max_len: usize) -> String {
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

pub(crate) fn summarize_api_error_body(raw_body: &str) -> String {
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
