# YAT — Yet Another Typeless

[繁體中文](./README.md) | [English](./README.en.md)

**Speak your mind, shape your text.**
YAT is a cross-platform desktop voice input tool. Simply hold a hotkey, speak into your microphone, and release the key. Your words are instantly transcribed, polished, and magically pasted exactly where you were typing.

Stop letting your typing speed hold back your thoughts.

**👉 [Download latest release](../../releases) ｜ [Quick Start](#quick-start) ｜ [Why YAT?](#why-yat) ｜ [FAQ](#faq)**

---

## Why choose YAT?

Whether you're a writer, a developer, or just someone answering endless messages, typing can sometimes feel like a bottleneck. You think faster than your fingers can move. YAT is built for precisely those moments.

- ⚡️ **Works everywhere, instantly**: Whether you're in Word, Notion, VS Code, or a chat app—just hold the hotkey to speak, and let go to paste.
- 🧠 **Not just dictation—your AI editor**: Powered by Large Language Models (like OpenAI, Groq, etc.), YAT doesn't just transcribe. It **removes filler words, adds punctuation, fixes stutters, and formats paragraphs**. The result? Perfect, ready-to-send text every single time.
- 🌍 **Flawless code-switching**: Do you mix English and other languages naturally? YAT understands. It preserves your natural phrasing without awkwardly forcing everything into a single language.
- 🎯 **Never misspell a brand name again**: Using the "Terms" vocabulary list, you can define product names, personal names, or industry jargon so YAT gets them right 100% of the time.
- 🔒 **Privacy first, BYOK (Bring Your Own Key)**: Your audio and data are sent *only* to the API providers you explicitly configure. Nothing runs through our servers. Your request history stays safely on your local machine.

## Who is this for?

- **Developers**: Dictate long commit messages, architecture thoughts, or documentation in seconds.
- **Content Creators**: Capture fleeting inspiration without breaking your creative flow.
- **Heavy Keyboard Users**: Give your wrists a well-deserved break.
- **Anyone**: If "speak it and paste it" sounds like it would make your life easier, YAT is for you.

## Quick Start (Under 3 minutes)

Getting started is incredibly easy. Just follow these three steps:

### 1. Get YAT
Go to the [Releases page](../../releases) and download the build for your OS (Windows, macOS, or Linux). Install and launch it. You will see the YAT icon appear in the menu bar or system tray.

### 2. Connect your speech provider
YAT uses your own API keys and supports any API compatible with the OpenAI format. You can start with speech recognition only, then turn on polishing later if you want cleaner output.
1. Click the menu bar or system tray icon and open **Settings**.
2. Go to the **Speech** tab, and enter your chosen API Base URL, Model name, and API Key.
3. Click **Test Connection** to make sure you're good to go!
*(Pro tip: Setup the **Polish** tab with another endpoint to have the AI clean up your formatting and grammar!)*

### 3. Start Talking
You're ready! Place your cursor in any text field:
- **Windows / Linux**: Hold down the **Right Ctrl** key.
- **macOS**: Hold down the **Right Cmd** key.

Once you see the floating status capsule appear, start speaking. Release the key when you're done, and watch your text appear.

> 💡 **Tip:** Afraid it'll paste in the wrong place? You can change the "Output Mode" to **Clipboard only** in the settings. YAT will silently save the text to your clipboard, allowing you to paste it manually.

## Dive Deeper

YAT is more than just a record button. It's packed with quality-of-life features:

- **Fully customizable hotkeys**: Not a fan of "hold-to-talk"? Change it to click-to-toggle, double-tap, or complex combos (like `Ctrl + Shift + C`).
- **Extra reference info (advanced)**: When you really need it, YAT can optionally read your clipboard, selected text, active app, current input field, or even take a **screen capture** before polishing. This helps the AI stay closer to what you are already working on. *(For privacy, **all of these are OFF by default**, and only the items you enable are sent.)*
- **Distraction-free recording**: Automatically pause playing media, mute system mics, or enable Do Not Disturb mode while you are speaking (varies by OS).

## FAQ

**Q: Do I *have* to use the Text Polish feature?**
A: Nope! If you only configure the "Speech" section, YAT will output the raw transcription. Polishing is just there to make your text look perfectly edited.

**Q: What if auto-paste doesn't work?**
A: Security features on certain operating systems (like missing Accessibility permissions on macOS, or typing in Admin-level apps on Windows) can block automated pasting. If this happens, simply switch the output mode to **Clipboard only**.

**Q: Is my API Key and data secure?**
A: Yes. Your API keys are stored locally on your device. Your request history is kept securely in a local SQLite database (for 30 days by default). YAT contains zero tracking or telemetry.

---

### For Developers: Build from source

If you'd like to build YAT yourself or contribute:
Prerequisites: Node.js 20+, Rust 1.77+

```bash
npm install
npm run tauri dev
npm run tauri build
```

YAT is released under the [MIT License](./LICENSE). Feel free to open an Issue or submit a PR to make YAT even better!
