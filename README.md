# YAT — Yet Another Typeless

[English](#english) | [繁體中文](#繁體中文)

---

## English

**YAT** turns your voice into polished, ready-to-use text — right where your cursor is.
Press a hotkey, speak, and YAT transcribes your speech, cleans it up with AI, then either pastes it into the app you're using or leaves it in your clipboard — depending on your output mode.

### Who Is This For?

- Anyone who thinks faster than they type
- Developers who want to dictate code comments, commit messages, or documentation
- Multilingual speakers who mix languages naturally (YAT preserves your code-switching)
- People who need a hands-free text input tool for accessibility

### How It Works

1. **Press and hold your hotkey** (default: Right Ctrl on Windows/Linux, Right Cmd on macOS) → YAT starts recording
2. **Speak naturally** → a floating capsule shows you're recording
3. **Release the hotkey** (or use another trigger mode / press **Esc** to cancel) → recording stops
4. **YAT transcribes** your speech using a cloud STT service (e.g. Groq Whisper)
5. **AI polishes** the text — removes fillers (um, 嗯), fixes punctuation, corrects proper nouns
6. **Result appears** at your cursor (auto-paste mode) or in your clipboard

On a stable network this often feels quick, but real latency depends on your provider, model, and connection.

### Quick Start

1. **Download & install** from the [Releases](../../releases) page
   – Windows: `.msi` or `.exe` installer
   – macOS: `.dmg`
   – Linux: `.deb` or `.AppImage`

2. **Launch YAT** — a tray icon appears. Click it (or right-click → Settings) to open the settings window.

3. **Set up Speech-to-Text** (required):
   - Go to the **Speech** tab
   - Choose a provider preset (e.g. **Groq**) or enter a custom OpenAI-compatible endpoint
   - Paste your API key
   - Click **Test Connection** to verify

4. **Set up AI Polishing** (optional but recommended):
   - Go to the **Polish** tab
   - Toggle it **On**
   - Choose a provider preset and paste your API key
   - Recommended models: `llama-3.3-70b-versatile` (Groq) or `gpt-4o` (OpenAI)
   - Click **Test Connection** to verify

5. **Start using it!** The default is hold-to-talk: press and hold, speak, then release. If you prefer, you can later switch to single key, double-tap, or combo.

### Obtaining API Keys

YAT uses your own API keys (BYOK — Bring Your Own Key). Here's how to get them:

| Provider | Sign Up | Free Tier | Models |
|----------|---------|-----------|--------|
| **Groq** | [console.groq.com](https://console.groq.com) | Yes (generous) | `whisper-large-v3-turbo` (STT), `llama-3.3-70b-versatile` (LLM) |
| **OpenAI** | [platform.openai.com](https://platform.openai.com) | Pay-as-you-go | `whisper-1` (STT), `gpt-4o` (LLM) |

> **Tip:** Groq's free tier is excellent for getting started — fast inference with no upfront cost.

### Features

| Feature | Description |
|---------|-------------|
| **Global Hotkey** | Trigger without returning to YAT. Supports single key, double-tap, key combo, or hold-to-talk, and you can change modes later. |
| **Floating Capsule** | A small always-on-top, click-through widget shows recording status, elapsed time, and microphone level. It never steals focus or blocks your mouse. |
| **Cancel Recording** | Press **Esc** during an active recording or pipeline step to cancel. On Linux, the key may still reach the foreground app. |
| **Auto-Paste** | Polished text is automatically pasted into the focused application. Falls back to clipboard if paste fails. |
| **AI Text Polishing** | Removes filler words and stuttering, adds punctuation, formats numbers, and corrects proper nouns. |
| **Custom Vocabulary** | Define correction pairs for domain-specific terms (e.g. "deep seek" → "DeepSeek"). |
| **Custom Prompt** | Full control over how AI processes your text. Add your own instructions or override the system prompt. |
| **Code-Switching** | Naturally mix languages (e.g. Chinese + English). YAT preserves each segment in its original language. |
| **Transcription History** | Browse, search, copy, or retry past transcriptions. Configurable retention period. |
| **Context Window** | Recent transcription history is fed to the AI for better consistency across dictation sessions. |
| **Auto-Mute** | On supported platforms (currently macOS and Windows), system audio can be muted during recording and restored afterward. |
| **Sound Effects** | Audio cues for recording start, stop, completion, and errors. Can be toggled off. |
| **Microphone Selection** | Choose a specific input device if you have multiple microphones. |
| **Dark Mode** | System, light, or dark theme. |
| **Bilingual UI** | English and 繁體中文. |
| **System Tray** | Runs quietly in the background. All operations via hotkey; settings via tray icon. |
| **Auto-Start** | Optionally launch YAT at system startup. |

### Settings Overview

| Tab | What You Configure |
|-----|-------------------|
| **Overview** | At-a-glance readiness check: is STT configured? Is LLM ready? Quick stats and latest output. |
| **General** | Hotkey type & key, output mode, recording limits, microphone, theme, language, sound effects, auto-mute, auto-start. |
| **Speech** | STT provider, base URL, API key, model, and optional language hint. |
| **Polish** | Enable/disable LLM, provider, base URL, API key, model. |
| **Prompt** | User instructions layered on top of the system prompt. Preset buttons for common styles. Advanced system prompt editing. |
| **Terms** | Vocabulary correction pairs. Define "wrong → correct" mappings that are always applied. |
| **History** | Search and browse past transcriptions. Retry with current settings. Configurable retention period. |

### Tips & Tricks

- **Language hint**: If you primarily speak one language, set the "Language" field in the Speech tab (e.g. `zh` for Chinese, `en` for English). This improves accuracy.
- **Vocabulary corrections**: Add terms specific to your work. YAT will always correct these, even if the AI misses them.
- **Context window**: YAT feeds the last 10 minutes of transcriptions to the AI as context. This helps maintain consistency when you dictate in multiple short bursts.
- **Clipboard behavior**: Choose "Always keep in clipboard" (default) to always have the latest transcription available for pasting manually. Or choose "Only keep when paste fails" if you don't want your clipboard overwritten.
- **Hotkey options**:
   - **Hold** (default): Hold Right Ctrl on Windows/Linux or Right Cmd on macOS to record, release to stop
   - **Single key**: Press once to start, press again to stop
   - **Double-tap**: Tap the same key twice quickly to toggle
   - **Combo**: Hold a modifier + press a key (e.g. Ctrl+Space)
- **Mode flexibility**: Alt hold is supported, and you can later switch the same key to single key, double-tap, or combo. Modifier-only single/double-tap hotkeys are still supported, but they are riskier in real apps.
- **Save shortcut**: Press **Ctrl+S** in the settings window to save changes quickly.
- **Cancel recording**: Press **Esc** while recording to cancel without processing. Useful when you misspoke or started recording by accident.
- **Hotkey safety**: While the settings window is focused, YAT pauses recording hotkeys so editing fields doesn't accidentally start dictation.

### Troubleshooting

| Problem | Solution |
|---------|----------|
| "No input device available" | Check that a microphone is connected and permitted. On macOS, grant microphone access in System Settings → Privacy. |
| STT test fails with 401 | Your API key is invalid or expired. Generate a new one from your provider's dashboard. |
| Text is garbled or wrong language | Set the language hint in the Speech tab to match your primary language. |
| Auto-paste doesn't work | Some applications block simulated keyboard input. Switch to "Clipboard Only" mode and paste manually (Ctrl+V). |
| Hotkey doesn't trigger | Ensure no other application is capturing the same key. Try a different hotkey or type. |
| Capsule window doesn't appear | The capsule is a small transparent overlay. Check if it's hidden behind your taskbar or another always-on-top window. |

### For Developers

<details>
<summary>Build from source</summary>

**Prerequisites:** Node.js 20+, Rust 1.77+

```bash
# Install dependencies
npm install

# Development mode (with hot-reload)
npm run tauri dev

# Production build
npm run tauri build
```

**Tech Stack:**
- Desktop framework: [Tauri v2](https://v2.tauri.app/) (Rust + WebView)
- Frontend: React 19, TypeScript, Tailwind CSS v4
- Audio: cpal (capture) + hound (WAV encoding)
- HTTP: reqwest (OpenAI-compatible API calls)
- Hotkey: rdev (global keyboard hooks)
- Storage: SQLite (history) + tauri-plugin-store (settings)

**Release:**
Push a git tag to trigger the GitHub Actions release workflow:
```bash
git tag v0.1.0
git push origin v0.1.0
```
This creates a draft release with platform-specific installers.

</details>

### Privacy & Security

- **Your API keys stay on your device.** They are stored locally and sent only to the endpoints you configure.
- **Audio is never stored.** Recordings are held in memory during processing and discarded immediately after transcription.
- **History is local.** Transcription history is stored in a local SQLite database and never leaves your machine.
- **No telemetry.** YAT does not collect any usage data.

---

## 繁體中文

**YAT** 把你的聲音轉換成潤飾好、可以直接使用的文字——就在你的游標所在之處。
按下快捷鍵、開始說話，YAT 會自動轉錄語音、用 AI 清理文字，然後依照你的輸出模式，直接貼到正在使用的應用程式中，或把結果留在剪貼簿裡。

### 適合誰？

- 想的比打字快的人
- 想用口述寫程式註解、commit message 或文件的開發者
- 自然混用多語言的人（YAT 保留你的語碼轉換）
- 需要無障礙文字輸入工具的使用者

### 運作流程

1. **按住快捷鍵**（Windows/Linux 預設為右 Ctrl，macOS 預設為右 Cmd）→ YAT 開始錄音
2. **自然說話** → 畫面上會出現浮動膠囊顯示錄音狀態
3. **放開快捷鍵**（或改用其他觸發模式／按 **Esc** 取消）→ 錄音停止
4. **YAT 轉錄**語音（使用雲端 STT 服務，如 Groq Whisper）
5. **AI 潤飾**文字 — 移除贅詞（嗯、呃、那個）、修正標點、校正專有名詞
6. **結果出現**在你的游標位置（自動貼上模式）或剪貼簿中

在穩定網路下通常會感覺很快，但實際延遲仍會受到服務商、模型與網路狀況影響。

### 快速開始

1. **下載安裝**：到 [Releases](../../releases) 頁面下載
   – Windows：`.msi` 或 `.exe` 安裝程式
   – macOS：`.dmg`
   – Linux：`.deb` 或 `.AppImage`

2. **啟動 YAT** — 系統匣出現圖示。點擊圖示（或右鍵 → 設定）開啟設定視窗。

3. **設定語音辨識**（必要）：
   - 前往「**語音辨識**」分頁
   - 選擇服務商（如 **Groq**）或輸入自訂的 OpenAI 相容端點
   - 貼上你的 API Key
   - 按「**測試連線**」確認

4. **設定文字潤飾**（可選，但建議啟用）：
   - 前往「**文字潤飾**」分頁
   - 將開關打開
   - 選擇服務商並貼上 API Key
   - 建議模型：`llama-3.3-70b-versatile`（Groq）或 `gpt-4o`（OpenAI）
   - 按「**測試連線**」確認

5. **開始使用！** 預設是按住說話：按住、說話、放開。如果你喜歡，也可以之後再改成單按、連按兩下或組合鍵。

### 取得 API Key

YAT 使用你自己的 API Key（BYOK）。以下是取得方式：

| 服務商 | 註冊網址 | 免費額度 | 可用模型 |
|--------|---------|---------|---------|
| **Groq** | [console.groq.com](https://console.groq.com) | 有（額度充裕） | `whisper-large-v3-turbo`（語音辨識）、`llama-3.3-70b-versatile`（文字潤飾） |
| **OpenAI** | [platform.openai.com](https://platform.openai.com) | 依用量計費 | `whisper-1`（語音辨識）、`gpt-4o`（文字潤飾） |

> **提示：** Groq 的免費方案非常適合入門 — 推論速度快，無需預付費用。

### 功能一覽

| 功能 | 說明 |
|------|------|
| **全域快捷鍵** | 不必先切回 YAT，也能觸發錄音。支援單一按鍵、連按兩下、組合鍵與長按，之後也能再切換模式。 |
| **浮動膠囊** | 小型置頂、可穿透點擊的視窗，顯示錄音狀態、經過時間與麥克風音量。不會搶奪焦點或阻擋滑鼠操作。 |
| **取消錄音** | 在錄音中或處理流程進行中按 **Esc** 可取消。Linux 上這顆鍵仍可能同時送到前景 App。 |
| **自動貼上** | 潤飾後的文字自動貼到目前焦點的應用程式。貼上失敗時自動退回到剪貼簿。 |
| **AI 文字潤飾** | 移除贅詞與口吃、加入標點、格式化數字、校正專有名詞。 |
| **自訂詞彙表** | 定義領域專業術語的校正對照（如「deep seek」→「DeepSeek」）。 |
| **自訂提示詞** | 完全控制 AI 如何處理你的文字。可加入自訂指示或覆寫系統提示詞。 |
| **語碼轉換** | 自然混用中英文。YAT 保留每段文句的原始語言。 |
| **轉錄歷史** | 瀏覽、搜尋、複製或重試過去的轉錄結果。可設定保留期限。 |
| **上下文視窗** | 近期轉錄紀錄會提供給 AI 作為上下文參考，提升跨次口述的一致性。 |
| **錄音自動靜音** | 在支援的平台（目前為 macOS / Windows）上，可於錄音時自動靜音系統音訊，結束後再恢復。 |
| **音效提示** | 錄音開始／結束、完成、錯誤時播放提示音。可關閉。 |
| **麥克風選擇** | 有多支麥克風時可指定錄音裝置。 |
| **深色模式** | 支援系統、淺色或深色主題。 |
| **雙語介面** | 繁體中文和英文。 |
| **系統匣** | 安靜地在背景運行。所有操作透過快捷鍵；設定透過系統匣圖示。 |
| **開機啟動** | 可選擇在系統啟動時自動啟動 YAT。 |

### 設定說明

| 分頁 | 設定內容 |
|------|---------|
| **總覽** | 一目了然的就緒狀態：語音辨識是否設定好？LLM 是否就緒？快速統計與最新輸出結果。 |
| **一般設定** | 快捷鍵類型與按鍵、輸出模式、錄音上限、麥克風、主題、語言、音效、自動靜音、開機啟動。 |
| **語音辨識** | STT 服務商、Base URL、API Key、模型、語言提示。 |
| **文字潤飾** | 啟用／停用 LLM、服務商、Base URL、API Key、模型。 |
| **提示詞** | 在系統提示詞之上疊加的使用者指示。預設按鈕可快速套用常見風格。進階系統提示詞編輯。 |
| **詞彙表** | 詞彙校正對照。定義「錯誤 → 正確」的對應規則，每次都會套用。 |
| **歷史紀錄** | 搜尋和瀏覽過去的轉錄紀錄。可用目前設定重試。可設定保留期限。 |

### 使用技巧

- **語言提示**：如果你主要使用一種語言，在語音辨識分頁的「語言」欄位填入相應代碼（如 `zh` 代表中文、`en` 代表英文），可以提升辨識準確度。
- **詞彙校正**：加入與你工作相關的專業術語。即使 AI 漏掉，YAT 也會確保這些詞彙被正確校正。
- **上下文視窗**：YAT 會將最近 10 分鐘的轉錄紀錄提供給 AI 作為上下文，幫助在多次短句口述中保持一致性。
- **剪貼簿行為**：選擇「永遠保留在剪貼簿」（預設），最新結果隨時可手動貼上。或選擇「僅在貼上失敗時保留」，避免覆蓋剪貼簿內容。
- **快捷鍵選項**：
   - **長按**（預設）：Windows/Linux 預設按住右 Ctrl、macOS 預設按住右 Cmd，放開即停止
   - **單一按鍵**：按一下開始，再按一下結束
   - **連按兩下**：快速連按同一鍵兩次來切換
   - **組合鍵**：按住修飾鍵 + 按下按鍵（如 Ctrl+Space）
- **模式可切換**：Alt 長按仍然支援，而且之後也可以把同一顆鍵改成單按、連按兩下或組合鍵。只是修飾鍵的單按 / 連按模式在真實 App 裡風險會比較高。
- **儲存快捷鍵**：在設定視窗中按 **Ctrl+S** 可快速儲存變更。
- **取消錄音**：錄音中按 **Esc** 可取消錄音並不處理。說錯話或不小心觸發時很實用。
- **熱鍵安全**：當設定視窗取得焦點時，YAT 會暫停錄音熱鍵，避免你在編輯欄位時意外開始錄音。

### 疑難排解

| 問題 | 解決方式 |
|------|---------|
| 「沒有可用的輸入裝置」 | 確認麥克風已連接並授權。macOS 使用者請在「系統設定 → 隱私權」中授予麥克風權限。 |
| STT 測試失敗，顯示 401 | API Key 無效或已過期。請到服務商後台重新產生。 |
| 文字亂碼或語言錯誤 | 在語音辨識分頁設定語言提示，填入你主要使用的語言代碼。 |
| 自動貼上無效 | 部分應用程式會阻擋模擬按鍵輸入。改用「僅複製到剪貼簿」模式，再手動 Ctrl+V 貼上。 |
| 快捷鍵沒有反應 | 確認沒有其他應用程式佔用了同一個按鍵。嘗試更換快捷鍵或觸發類型。 |
| 膠囊浮窗沒有出現 | 膠囊是小型透明覆蓋視窗。確認它沒有被工作列或其他置頂視窗遮擋。 |

### 開發者資訊

<details>
<summary>從原始碼建置</summary>

**環境需求：** Node.js 20+、Rust 1.77+

```bash
# 安裝相依套件
npm install

# 開發模式（支援熱重載）
npm run tauri dev

# 正式建置
npm run tauri build
```

**技術架構：**
- 桌面框架：[Tauri v2](https://v2.tauri.app/)（Rust + WebView）
- 前端：React 19、TypeScript、Tailwind CSS v4
- 音訊：cpal（擷取）+ hound（WAV 編碼）
- HTTP：reqwest（OpenAI 相容 API 呼叫）
- 快捷鍵：rdev（全域鍵盤攔截）
- 儲存：SQLite（歷史紀錄）+ tauri-plugin-store（設定）

**發佈：**
推送 git tag 以觸發 GitHub Actions 自動建置：
```bash
git tag v0.1.0
git push origin v0.1.0
```
將自動建立包含各平台安裝程式的草稿版本。

</details>

### 隱私與安全

- **API Key 只存在你的裝置上。** 它們儲存在本機，只會傳送到你設定的端點。
- **音訊不會被儲存。** 錄音只在處理期間暫存於記憶體中，轉錄完成後立即丟棄。
- **歷史紀錄是本機的。** 轉錄紀錄存放在本機 SQLite 資料庫，絕不會離開你的電腦。
- **沒有遙測。** YAT 不會收集任何使用資料。

---

## License

MIT
