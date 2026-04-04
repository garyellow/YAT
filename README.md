# YATL — Yet Another Typeless

[English](#english) | [繁體中文](#繁體中文)

---

## English

YATL is a cross-platform desktop speech-to-text tool with LLM text polishing. Bring your own API keys (BYOK) to use any OpenAI-compatible STT and LLM services.

### Features

- **Speech-to-Text**: Record via hotkey, transcribe with any OpenAI-compatible STT API (Groq, OpenAI, etc.)
- **LLM Polishing**: Automatically clean up transcriptions — remove fillers, fix punctuation, correct proper nouns
- **Custom Vocabulary**: Define correction pairs for domain-specific terms
- **Custom Prompts**: Full control over the LLM system prompt
- **Global Hotkey**: Single key, double-tap, or combo key activation
- **Auto-Paste**: Automatically paste polished text into the active application
- **Auto-Mute**: Mute system audio during recording to avoid interference
- **Sound Effects**: Audio feedback for recording start/stop, completion, and errors
- **Microphone Selection**: Choose a specific input device for recording
- **Capsule Window**: Floating status widget showing recording state and elapsed time
- **History**: Searchable transcription history with retry and configurable retention
- **Bilingual UI**: 繁體中文 and English
- **Dark Mode**: System, light, or dark theme
- **Tray Icon**: Runs in the system tray with background hotkey listening

### Tech Stack

- **Desktop**: [Tauri v2](https://v2.tauri.app/) (Rust + WebView)
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4
- **Audio**: cpal (capture) + hound (WAV encoding)
- **APIs**: reqwest (OpenAI-compatible endpoints)
- **Hotkey**: rdev (global keyboard hooks)
- **Storage**: SQLite (history) + tauri-plugin-store (settings)

### Getting Started

```bash
# Prerequisites: Node.js 20+, Rust 1.77+
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

### Release

Push a git tag to trigger the GitHub Actions release workflow:

```bash
git tag v0.1.0
git push origin v0.1.0
```

This creates a draft release with Windows (.msi/.exe) and macOS (.dmg) installers.

### Configuration

1. Open Settings from the system tray
2. Set STT API credentials (e.g., Groq Whisper)
3. Optionally enable LLM polishing with API credentials
4. Configure your preferred hotkey
5. Start speaking!

---

## 繁體中文

YATL 是一款跨平台桌面語音轉文字工具，搭配 LLM 文字潤飾功能。自帶 API 金鑰（BYOK），可使用任何 OpenAI 相容的 STT 和 LLM 服務。

### 功能特色

- **語音轉文字**：透過快捷鍵錄音，使用任何 OpenAI 相容 STT API（Groq、OpenAI 等）轉錄
- **LLM 潤飾**：自動清理轉錄文字 — 移除贅詞、修正標點、校正專有名詞
- **自訂詞彙表**：定義領域專業術語的校正對照
- **自訂提示詞**：完全控制 LLM 系統提示詞
- **全域快捷鍵**：支援單一按鍵、連按兩下、組合鍵觸發
- **自動貼上**：自動將潤飾後的文字貼到目前的應用程式
- **錄音時自動靜音**：錄音時靜音系統音訊，避免干擾
- **音效提示**：錄音開始 / 結束、完成、錯誤時播放提示音
- **麥克風選擇**：指定錄音輸入裝置
- **膠囊浮窗**：錄音中顯示即時狀態與經過時間
- **歷史紀錄**：可搜尋的轉錄紀錄，支援重試與自訂保留期限
- **雙語介面**：繁體中文和英文
- **深色模式**：系統、淺色或深色主題
- **系統匣圖示**：在背景監聽快捷鍵

### 快速開始

```bash
# 需求：Node.js 20+、Rust 1.77+
npm install
npm run tauri dev
```

### 建置

```bash
npm run tauri build
```

### 發佈

推送 git tag 以觸發 GitHub Actions 自動建置：

```bash
git tag v0.1.0
git push origin v0.1.0
```

將自動建立包含 Windows（.msi/.exe）和 macOS（.dmg）安裝程式的草稿版本。

### 設定方式

1. 從系統匣開啟設定
2. 設定 STT API 憑證（例如 Groq Whisper）
3. 選擇性啟用 LLM 潤飾並設定 API 憑證
4. 設定偏好的快捷鍵
5. 開始講話！

---

## License

MIT
