use serde::{Deserialize, Serialize};

// ── STT Configuration ───────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SttConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub language: Option<String>,
}

// ── LLM Configuration ──────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct LlmConfig {
    pub enabled: bool,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

// ── Hotkey Configuration ────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum HotkeyType {
    Single,
    DoubleTap,
    Combo,
    Hold,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HotkeyConfig {
    pub hotkey_type: HotkeyType,
    pub key: String,
    #[serde(default)]
    pub held_keys: Vec<String>,
    pub double_tap_interval_ms: u64,
}

#[cfg(target_os = "macos")]
fn default_hotkey_key() -> &'static str {
    "RCmd"
}

#[cfg(not(target_os = "macos"))]
fn default_hotkey_key() -> &'static str {
    "RCtrl"
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            hotkey_type: HotkeyType::Hold,
            key: default_hotkey_key().into(),
            held_keys: Vec::new(),
            double_tap_interval_ms: 300,
        }
    }
}

// ── Output & Clipboard ─────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum OutputMode {
    AutoPaste,
    ClipboardOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardBehavior {
    Always,
    OnlyOnPasteFail,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundAudioMode {
    Off,
    Duck,
    Mute,
}

// ── General Configuration ───────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GeneralConfig {
    pub hotkey: HotkeyConfig,
    pub theme: String,
    pub auto_start: bool,
    pub max_recording_seconds: u32,
    pub output_mode: OutputMode,
    pub clipboard_behavior: ClipboardBehavior,
    pub language: String,
    pub timeout_ms: u64,
    pub max_retries: u32,
    pub sound_effects: bool,
    pub background_audio_mode: BackgroundAudioMode,
    pub background_audio_ducking_percent: u8,
    pub auto_pause_media: bool,
    pub microphone_device: Option<String>,
    pub close_to_tray: bool,
    pub start_minimized: bool,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            hotkey: HotkeyConfig::default(),
            theme: "system".into(),
            auto_start: false,
            max_recording_seconds: 180,
            output_mode: OutputMode::AutoPaste,
            clipboard_behavior: ClipboardBehavior::Always,
            language: "zh-TW".into(),
            timeout_ms: 30000,
            max_retries: 2,
            sound_effects: true,
            background_audio_mode: BackgroundAudioMode::Duck,
            background_audio_ducking_percent: 80,
            auto_pause_media: false,
            microphone_device: None,
            close_to_tray: true,
            start_minimized: true,
        }
    }
}

// ── Prompt Configuration ────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PromptConfig {
    pub system_prompt: String,
    #[serde(default)]
    pub user_instructions: String,
    pub vocabulary: Vec<VocabularyEntry>,
    #[serde(default)]
    pub context_clipboard: bool,
    #[serde(default)]
    pub context_selection: bool,
    #[serde(default)]
    pub context_active_app: bool,
    #[serde(default)]
    pub context_input_field: bool,
    #[serde(default)]
    pub context_screenshot: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VocabularyEntry {
    pub text: String,
}

impl Default for PromptConfig {
    fn default() -> Self {
        Self {
            system_prompt: default_system_prompt().to_string(),
            user_instructions: String::new(),
            vocabulary: Vec::new(),
            context_clipboard: false,
            context_selection: false,
            context_active_app: false,
            context_input_field: false,
            context_screenshot: false,
        }
    }
}

pub fn default_system_prompt() -> &'static str {
    r#"You are a speech-to-text typing assistant. Your job is to turn raw dictated speech into final text that feels like a skilled human typist cleaned it up.

You operate in two modes:

MODE A — Cleanup mode (default)
Use this when the user is simply dictating content.

MODE B — Commanded transform mode
Use this only when the dictated speech contains an explicit transformation command directed at this same dictated content (for example: "整理成條列", "列點", "寫 email", "幫我摘要", "rewrite this", "translate to English", "make this more formal").

When in commanded transform mode:
1. Remove the command phrase itself from the final output.
2. Apply that command to the remaining dictated content.
3. Keep all important facts, names, numbers, dates, and action items unless the command explicitly asks to shorten.
4. Output only the transformed final text.

Command behavior:
- Bullet/list commands: format as bullet or numbered lists when sequence/count is implied.
- Email commands: output a complete email (subject only if explicitly requested; otherwise greeting + body + closing).
- Summary commands: output a concise summary of the dictated content.
- Rewrite/tone commands: improve clarity/tone while preserving meaning.
- Translation commands: translate only when explicitly requested.
- Spoken formatting commands like "new line" or "new paragraph" should become real line/paragraph breaks.

Always follow these cleanup rules in both modes:
1. Remove filler words, repetitions, and obvious false starts (for example: um, uh, you know, 嗯, 呃, 那個, 然後).
2. When the speaker self-corrects or restarts, keep only the final intended wording.
3. Add punctuation and split the text into natural paragraphs.
4. Format spoken numbers into digits when that clearly improves readability (for example: "三百毫秒" → "300ms", "百分之八十" → "80%", "one hundred twenty three" → "123").
5. Preserve the speaker's natural tone. Do not make casual speech overly formal unless explicitly requested.
6. Preserve code-switching. Keep English in English and Chinese in Chinese when that matches the speaker's intent.
7. Insert spaces naturally between Chinese characters and adjacent English words or numbers when needed.
8. When a vocabulary list is provided, treat it as preferred spelling and terminology. Use those entries when they clearly match the speaker's intent, even if the raw transcription spaced or spelled them oddly.

Hard constraints:
- Do not chat with the user. You are not a conversational assistant in this pipeline.
- Do not add commentary, explanations, labels, or preamble.
- Do not invent facts that were not dictated.
- If command intent is ambiguous, fall back to Cleanup mode.
- Output only the final text."#
}

pub fn normalize_system_prompt(value: &str) -> String {
    let trimmed = value.trim();

    if trimmed.is_empty() || trimmed == default_system_prompt().trim() {
        default_system_prompt().to_string()
    } else {
        value.to_string()
    }
}

// ── History Configuration ───────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HistoryConfig {
    pub retention_hours: u32,
    pub context_window_minutes: u32,
    pub audio_retention_hours: u32,
}

impl Default for HistoryConfig {
    fn default() -> Self {
        Self {
            retention_hours: 720,       // 30 days
            context_window_minutes: 10, // last 10 min for context
            audio_retention_hours: 24,  // keep audio files for 24 hours
        }
    }
}

// ── App Settings (top-level) ────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppSettings {
    pub stt: SttConfig,
    pub llm: LlmConfig,
    pub general: GeneralConfig,
    pub prompt: PromptConfig,
    pub history: HistoryConfig,
}
