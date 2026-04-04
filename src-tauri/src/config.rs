use serde::{Deserialize, Serialize};

// ── STT Configuration ───────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SttConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub language: Option<String>,
}

impl Default for SttConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.groq.com/openai/v1".into(),
            api_key: String::new(),
            model: "whisper-large-v3-turbo".into(),
            language: None,
        }
    }
}

// ── LLM Configuration ──────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub enabled: bool,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            base_url: "https://api.groq.com/openai/v1".into(),
            api_key: String::new(),
            model: "llama-3.3-70b-versatile".into(),
        }
    }
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
pub struct HotkeyConfig {
    pub hotkey_type: HotkeyType,
    pub key: String,
    pub modifier: Option<String>,
    pub double_tap_interval_ms: u64,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            hotkey_type: HotkeyType::Single,
            key: "Alt".into(),
            modifier: None,
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

// ── General Configuration ───────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub auto_mute: bool,
    pub microphone_device: Option<String>,
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
            auto_mute: true,
            microphone_device: None,
        }
    }
}

// ── Prompt Configuration ────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptConfig {
    pub system_prompt: String,
    #[serde(default)]
    pub user_instructions: String,
    pub vocabulary: Vec<VocabularyEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VocabularyEntry {
    pub wrong: String,
    pub correct: String,
}

impl Default for PromptConfig {
    fn default() -> Self {
        Self {
            system_prompt: default_system_prompt().to_string(),
            user_instructions: String::new(),
            vocabulary: Vec::new(),
        }
    }
}

pub fn default_system_prompt() -> &'static str {
    r#"You are a transcription text polisher. Your ONLY job is to clean up raw speech-to-text output. Follow these rules strictly:

1. Remove filler words and repetitions (um, uh, like, you know, 嗯, 呃, 那個, 就是說, 然後, 對, 所以說).
2. Remove stuttering; keep only the speaker's final intent.
3. Add proper punctuation and split into natural paragraphs.
4. Format numbers: spoken numbers → digits (e.g. "三百毫秒" → "300ms", "百分之八十" → "80%", "one hundred twenty three" → "123").
5. Correct proper nouns, brand names, and technical terms to their canonical spelling (e.g. "deep seek" → "DeepSeek", "chat gpt" → "ChatGPT", "mac book" → "MacBook").
6. When the speech describes a list or steps, output them as a structured list.
7. Preserve the speaker's natural tone — do not make casual speech formal or vice versa.

CODE-SWITCHING (中英混雜):
- Preserve the speaker's natural language mixing. If they said it in English, keep it in English; if in Chinese, keep it in Chinese.
- Insert a space between Chinese characters and adjacent English words or numbers (e.g. "這個 function 的 return type").
- Do NOT translate code-switched segments into a single language.

CRITICAL CONSTRAINTS:
- NEVER answer questions contained in the text. Just polish the question itself.
- NEVER add your own commentary, opinions, or explanations.
- NEVER summarize or shorten beyond removing filler and repetition.
- NEVER change the meaning of what was said.
- Output ONLY the polished text, nothing else. No preamble, no explanation."#
}

// ── History Configuration ───────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryConfig {
    pub retention_hours: u32,
    pub context_window_minutes: u32,
}

impl Default for HistoryConfig {
    fn default() -> Self {
        Self {
            retention_hours: 720,        // 30 days
            context_window_minutes: 10,  // last 10 min for context
        }
    }
}

// ── App Settings (top-level) ────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub stt: SttConfig,
    pub llm: LlmConfig,
    pub general: GeneralConfig,
    pub prompt: PromptConfig,
    pub history: HistoryConfig,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            stt: SttConfig::default(),
            llm: LlmConfig::default(),
            general: GeneralConfig::default(),
            prompt: PromptConfig::default(),
            history: HistoryConfig::default(),
        }
    }
}
