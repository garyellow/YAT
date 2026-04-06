# YAT — Yet Another Typeless

[繁體中文](./README.md) | [English](./README.en.md)

> Hold the hotkey. Start talking.
> Release it, and the text lands where your cursor already is.

**👉 [Download latest release](../../releases) ｜ [3-minute setup](#3-minute-setup) ｜ [Feature overview](#feature-overview) ｜ [FAQ](#faq)**

YAT is a desktop voice input tool. Hold your hotkey, speak naturally, and YAT turns speech into text. If you configure text polishing, it also cleans the output so it feels closer to something you can send right away.

## Quick look

| If you want | YAT helps by |
|---|---|
| Faster input | Hold the hotkey, speak, and release |
| Something that works in any app | Paste into the current cursor position or copy to the clipboard |
| Cleaner text | Remove filler, add punctuation, and organize paragraphs or lists |
| Natural mixed-language speech | Keep code-switching instead of flattening everything into one language |
| More reliable terminology | Use vocabulary rules for brands, product names, and recurring terms |

## A great fit for

- People who think faster than they type
- Developers dictating messages, notes, docs, or commit messages
- People who naturally mix Chinese and English
- People who want less keyboard load
- Anyone who wants “speak, then paste” to feel simple

## 3-minute setup

> **👉 First time here? Do these three things first: download, set up Speech, start talking.**

### 1. Download and install

| Platform | What to get |
|---|---|
| Windows | Windows build |
| macOS | macOS build |
| Linux | Linux build |

- Go to [Releases](../../releases)
- Install YAT
- Open Settings from the tray icon

### 2. Set up **Speech** first

- Open the **Speech** tab
- Choose **Groq** / **OpenAI**, or enter your own OpenAI-compatible API URL
- Paste your API key
- Click **Test Connection**

### 3. Start speaking

- The default hotkey is **hold-to-talk**
  - Windows / Linux: **Right Ctrl**
  - macOS: **Right Cmd**
- Hold to start recording, release to stop
- If you have not filled in the **Polish** API key yet, YAT outputs the raw transcript
- If you want cleaner output, configure **Polish** next

> **👉 Want the safest way to start?**
> Set output mode to **Clipboard only** first, then switch back to **Auto-paste** once everything feels solid.

## A recommended way to begin

| What matters most right now | Best first move |
|---|---|
| I want to start fast | Set up **Speech** first |
| I want cleaner output | Configure **Polish** next |
| I do not want text pasted into the wrong place | Start with **Clipboard only** |
| I use brand names or technical terms a lot | Set up **Terms** early |
| I want YAT ready after login | Turn on auto-start |

## Feature overview

### Input and control

- **Global hotkeys**: hold-to-talk, single key, double-tap, or combo
- **Floating status capsule**: shows recording state, elapsed time, and microphone level
- **Esc to cancel**: works during recording and processing
- **Tray-first workflow**: stays in the background until you need it

### Output modes

| Mode | Best when |
|---|---|
| **Auto-paste** | You want the result to appear immediately at the cursor |
| **Clipboard only** | You want to review first, or you often hit permission / compatibility issues |

- Even if auto-paste fails, the result still stays in the clipboard
- You can choose whether the latest result always remains in the clipboard

### Text cleanup

- **Text polishing**: removes filler, repetition, and stuttering; adds punctuation, paragraphs, and lists
- **Natural code-switching**: mixed-language speech stays mixed
- **Terms**: keep product names, brands, and proper nouns consistent
- **Prompt / custom rules**: tweak tone and formatting without changing the original meaning

### Day-to-day use

- **History**: search, copy, retry, or delete past outputs
- **Sound cues**: feedback for start, stop, completion, and errors
- **Auto-mute while recording**: supported on Windows and macOS
- **Theme options**: dark, light, or follow system
- **Bilingual UI**: Traditional Chinese by default, with English available in settings
- **Auto-start on login**: keep YAT ready in the background

## Which provider should you use?

YAT uses your own API keys (BYOK). Requests go directly to the provider you configure.

| If you want | Recommended provider | Why |
|---|---|---|
| The fastest way to get started | **Groq** | Fast, easy to try, and has a friendly free tier |
| Official OpenAI usage | **OpenAI** | Best if you already use the OpenAI API |
| Your own endpoint | **Custom OpenAI-compatible service** | Works with your own compatible API |

| Job | Common models |
|---|---|
| Speech-to-text | `whisper-large-v3-turbo`, `whisper-1` |
| Text polishing | `llama-3.3-70b-versatile`, `gpt-4o-mini` |

> **👉 Easiest starting point:**
> Get **Groq + Speech** working first, then decide whether you want **Polish** on top.

## What you can change in Settings

| Tab | What you do there |
|---|---|
| **Overview** | See whether setup is complete and review the latest output |
| **General** | Change hotkeys, output mode, microphone, theme, UI language, sound effects, auto-mute, timeout, retries, and auto-start |
| **Speech** | Set provider, API URL, API key, model, and language hint |
| **Polish** | Turn AI cleanup on or off, then set provider, API URL, API key, and model |
| **Prompt** | Add simple rules, or go deeper with the advanced system prompt |
| **Terms** | Manage brands, product names, and recurring terminology fixes |
| **History** | Search, copy, retry, and clean up past outputs |

## Platform notes

| Platform | What to know first |
|---|---|
| **macOS** | You need microphone permission, and auto-paste / global hotkeys usually also need Accessibility permission |
| **Windows** | Auto-paste can fail if the target app is running as administrator; **Clipboard only** is usually the safest fallback |
| **Linux** | Global hotkeys currently need X11 or a compatibility layer; if paste feels unreliable, use **Clipboard only**; auto-mute is not supported on Linux |

- Extra note: on Linux, pressing **Esc** to cancel may still send that key to the foreground app.

## FAQ

| Question | Answer |
|---|---|
| What do I need to set up first? | Set up **Speech** first. That is enough to start using YAT. |
| Do I have to use Polish? | No. Even if you have not filled in the API key yet, YAT can still output the raw transcript. |
| What is the default UI language? | Traditional Chinese. You can switch to English in **General** settings. |
| What is the default hotkey? | Right Ctrl on Windows / Linux, Right Cmd on macOS, using hold-to-talk by default. |
| What is the default output mode? | **Auto-paste**, while also keeping the result in the clipboard. |
| What should I do if auto-paste fails? | Switch to **Clipboard only**. That is usually the most reliable option. |
| How long is history kept? | 30 days by default. |
| Does YAT send my API key to its own servers? | No. The key stays on your device and is only sent to the endpoint you configured. |

## Privacy and data

- **API keys stay local**: they are stored on your device and sent only to the endpoint you configured
- **Audio is not stored**: recordings stay in memory only while being processed
- **History stays local**: transcription history is stored in a local SQLite database and kept for 30 days by default
- **No telemetry**: YAT does not collect usage analytics

## Build from source

- Node.js 20+
- Rust 1.77+

```bash
npm install
npm run tauri dev
npm run tauri build
```

> **👉 Want to try it now?** [Download the latest release](../../releases)

## License

MIT
