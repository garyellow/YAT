# YAT — Yet Another Typeless

[繁體中文](./README.md) | [English](./README.en.md)

YAT is a desktop voice input tool. Hold a hotkey, speak naturally, and YAT turns your speech into text; if polishing is configured, it also removes filler and repetition, improves punctuation and structure, fixes terminology, and then either pastes the result into the current app or keeps it in your clipboard.

## Why YAT

- Use the same hotkey in any app instead of switching back to a dedicated window
- Speak once and get text right where your cursor already is
- Keep natural code-switching instead of forcing everything into one language
- Add AI polishing only when you want cleaner, more send-ready output
- Switch to clipboard-only mode when direct paste is not the right fit for your workflow

## Who it's for

- Anyone who thinks faster than they type
- Developers dictating messages, notes, docs, or commit messages
- Multilingual users who naturally mix Chinese and English
- Anyone who wants a lighter, lower-friction way to enter text

## Quick start

1. Download and install YAT from the [Releases](../../releases) page
2. Launch YAT and open Settings from the tray icon
3. In the **Speech** tab, choose **Groq** / **OpenAI** or enter a custom OpenAI-compatible endpoint
4. Paste your API key and click **Test Connection**
5. If you want cleaner output, configure an LLM in the **Polish** tab
6. Press and hold your hotkey, then start speaking

> **Good to know**
> - Speech setup is enough to get started. If polishing is not configured, YAT outputs the raw transcript.
> - The default hotkey is **hold-to-talk**: **Right Ctrl** on Windows / Linux and **Right Cmd** on macOS.
> - The default output mode is **auto-paste**, and the result is also kept in the clipboard.

## How it works

1. Press and hold your hotkey to start recording
2. A floating status capsule shows recording state, elapsed time, and microphone level
3. Release the hotkey to stop; press **Esc** during recording or processing to cancel
4. YAT sends the audio to your STT provider
5. If polishing is enabled, YAT cleans up punctuation, paragraphs, lists, and terminology
6. The result is pasted into the current app or copied to the clipboard

## What makes it feel good to use

### Built like an input tool, not just a transcript viewer

- **Global hotkeys**: hold-to-talk, single key, double-tap, or combo
- **Auto-paste / clipboard-only**: aggressive when you want speed, conservative when you want control
- **Floating capsule**: see what is happening without switching back to the main window
- **Tray-first workflow**: stays quietly in the background until you need it

### Built for cleaner output

- **AI polishing**: removes filler, repetition, and stuttering; adds punctuation and structure
- **Natural code-switching**: keeps mixed-language speech mixed instead of flattening it
- **Vocabulary rules**: when polishing is enabled, product names and domain terms stay more consistent
- **Custom instructions**: tweak the output style with a few simple rules, then go deeper only if you need to

### Built for daily work

- **Microphone selection** for multi-device setups
- **Sound cues** so you do not need to keep watching the screen
- **Auto-mute while recording** on Windows and macOS
- **History** with search, copy, delete, and retry
- **Theme and language preferences**: system, light, dark, Traditional Chinese, or English
- **Auto-start on login** so YAT is ready when you are

## Settings overview

| Tab | What you do there |
|---|---|
| **Overview** | Check readiness, current status, and recent output |
| **General** | Adjust hotkeys, output mode, microphone, theme, UI language, sound effects, auto-mute, timeout, retries, and auto-start |
| **Speech** | Configure the STT provider, base URL, API key, model, and language hint |
| **Polish** | Enable or disable the LLM pass, then configure provider, base URL, API key, and model |
| **Prompt** | Add simple style rules first, then edit the advanced system prompt only if needed |
| **Terms** | Add vocabulary corrections for recurring names and terminology |
| **History** | Search, copy, retry, and clean up past outputs |

## API keys and a sensible starter setup

YAT is BYOK (Bring Your Own Key): your requests go directly to the provider you configure.

| Service | Sign up / console | Good for | Common models |
|---|---|---|---|
| **Groq** | [console.groq.com](https://console.groq.com) | Fastest way to get started, strong speed, friendly free tier | STT: `whisper-large-v3-turbo` / LLM: `llama-3.3-70b-versatile` |
| **OpenAI** | [platform.openai.com](https://platform.openai.com) | Official OpenAI-compatible API usage | STT: `whisper-1` / LLM: `gpt-4o-mini` |

> **Recommended starting point:**
> Start with **Groq for Speech** first. Once dictation feels solid, decide whether you want polishing on top.

## Platform notes

- **macOS**: auto-paste and global hotkeys usually require Accessibility permission, and microphone access still matters.
- **Windows**: auto-paste can fail if the target app is running as administrator while YAT is not. Clipboard-only is usually the safest fallback.
- **Linux**: global hotkeys currently need X11 or a compatibility layer, and paste simulation behavior varies a lot by desktop environment. If it feels unreliable, use clipboard mode. Auto-mute is not currently supported on Linux.
- **Esc behavior on Linux**: when you cancel with **Esc**, that key may still reach the foreground app.

## Privacy and data

- **API keys stay local**: they are stored on your device and sent only to the endpoint you configured
- **Audio is not stored**: recordings stay in memory only while being processed
- **History stays local**: transcription history is stored in a local SQLite database and is kept for 30 days by default
- **No telemetry**: YAT does not collect usage analytics

## Build from source

If you want to build it yourself:

- Node.js 20+
- Rust 1.77+

```bash
npm install
npm run tauri dev
npm run tauri build
```

## License

MIT
