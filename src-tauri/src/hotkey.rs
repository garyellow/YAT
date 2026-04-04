use parking_lot::Mutex;
use rdev::{listen, Event, EventType, Key};
use std::sync::Arc;
use std::time::Instant;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum HotkeyError {
    #[error("failed to start listener: {0}")]
    ListenerFailed(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum HotkeyType {
    Single,
    DoubleTap,
    Combo,
    Hold,
}

#[derive(Debug, Clone)]
pub struct HotkeySettings {
    pub hotkey_type: HotkeyType,
    pub key: Key,
    pub modifier: Option<Key>,
    pub double_tap_interval_ms: u64,
}

impl Default for HotkeySettings {
    fn default() -> Self {
        Self {
            hotkey_type: HotkeyType::Single,
            key: Key::Alt,
            modifier: None,
            double_tap_interval_ms: 300,
        }
    }
}

struct HotkeyState {
    key_down: bool,
    other_key_pressed: bool,
    last_trigger_time: Option<Instant>,
    modifier_held: bool,
    hold_active: bool,
}

/// Parse a string key name into an `rdev::Key`.
pub fn parse_key(name: &str) -> Option<Key> {
    match name.to_lowercase().as_str() {
        "alt" | "lalt" => Some(Key::Alt),
        "ralt" | "altgr" => Some(Key::AltGr),
        "ctrl" | "control" | "lctrl" => Some(Key::ControlLeft),
        "rctrl" => Some(Key::ControlRight),
        "shift" | "lshift" => Some(Key::ShiftLeft),
        "rshift" => Some(Key::ShiftRight),
        "meta" | "super" | "cmd" | "command" | "lmeta" => Some(Key::MetaLeft),
        "rmeta" | "rcmd" => Some(Key::MetaRight),
        "f1" => Some(Key::F1),
        "f2" => Some(Key::F2),
        "f3" => Some(Key::F3),
        "f4" => Some(Key::F4),
        "f5" => Some(Key::F5),
        "f6" => Some(Key::F6),
        "f7" => Some(Key::F7),
        "f8" => Some(Key::F8),
        "f9" => Some(Key::F9),
        "f10" => Some(Key::F10),
        "f11" => Some(Key::F11),
        "f12" => Some(Key::F12),
        "space" => Some(Key::Space),
        "escape" | "esc" => Some(Key::Escape),
        "tab" => Some(Key::Tab),
        "capslock" => Some(Key::CapsLock),
        "backspace" => Some(Key::Backspace),
        "enter" | "return" => Some(Key::Return),
        s if s.len() == 1 => {
            let ch = s.chars().next().unwrap();
            Some(Key::Unknown(ch as u32))
        }
        _ => None,
    }
}

fn is_same_key(a: &Key, b: &Key) -> bool {
    match (a, b) {
        (Key::Alt, Key::Alt) => true,
        (Key::AltGr, Key::AltGr) => true,
        (Key::ControlLeft, Key::ControlLeft) | (Key::ControlLeft, Key::ControlRight) => true,
        (Key::ControlRight, Key::ControlLeft) | (Key::ControlRight, Key::ControlRight) => true,
        (Key::ShiftLeft, Key::ShiftLeft) | (Key::ShiftLeft, Key::ShiftRight) => true,
        (Key::ShiftRight, Key::ShiftLeft) | (Key::ShiftRight, Key::ShiftRight) => true,
        (Key::MetaLeft, Key::MetaLeft) | (Key::MetaLeft, Key::MetaRight) => true,
        (Key::MetaRight, Key::MetaLeft) | (Key::MetaRight, Key::MetaRight) => true,
        (a, b) => a == b,
    }
}

fn is_modifier(key: &Key) -> bool {
    matches!(
        key,
        Key::Alt
            | Key::AltGr
            | Key::ControlLeft
            | Key::ControlRight
            | Key::ShiftLeft
            | Key::ShiftRight
            | Key::MetaLeft
            | Key::MetaRight
    )
}

/// Start a global keyboard listener on a background thread.
/// Calls `on_trigger` whenever the configured hotkey is activated.
pub fn start_listener<F>(settings: Arc<Mutex<HotkeySettings>>, on_trigger: F)
where
    F: Fn() + Send + 'static,
{
    std::thread::spawn(move || {
        let state = Arc::new(Mutex::new(HotkeyState {
            key_down: false,
            other_key_pressed: false,
            last_trigger_time: None,
            modifier_held: false,
            hold_active: false,
        }));

        let callback = move |event: Event| {
            let settings = settings.lock().clone();
            let mut st = state.lock();

            match event.event_type {
                EventType::KeyPress(key) => match settings.hotkey_type {
                    HotkeyType::Single => {
                        if is_same_key(&key, &settings.key) {
                            st.key_down = true;
                            st.other_key_pressed = false;
                        } else if st.key_down {
                            st.other_key_pressed = true;
                        }
                    }
                    HotkeyType::DoubleTap => {
                        if is_same_key(&key, &settings.key) {
                            st.key_down = true;
                            st.other_key_pressed = false;
                        } else if st.key_down {
                            st.other_key_pressed = true;
                        }
                    }
                    HotkeyType::Combo => {
                        if let Some(ref modifier) = settings.modifier {
                            if is_same_key(&key, modifier) {
                                st.modifier_held = true;
                            } else if is_same_key(&key, &settings.key) && st.modifier_held {
                                on_trigger();
                            }
                        }
                    }
                    HotkeyType::Hold => {
                        if is_same_key(&key, &settings.key) && !st.hold_active {
                            st.hold_active = true;
                            on_trigger();
                        }
                    }
                },
                EventType::KeyRelease(key) => match settings.hotkey_type {
                    HotkeyType::Single => {
                        if is_same_key(&key, &settings.key) && st.key_down && !st.other_key_pressed
                        {
                            st.key_down = false;
                            on_trigger();
                        } else {
                            st.key_down = false;
                        }
                    }
                    HotkeyType::DoubleTap => {
                        if is_same_key(&key, &settings.key) && st.key_down && !st.other_key_pressed
                        {
                            st.key_down = false;
                            let now = Instant::now();
                            if let Some(last) = st.last_trigger_time {
                                let elapsed = now.duration_since(last).as_millis() as u64;
                                if elapsed <= settings.double_tap_interval_ms {
                                    st.last_trigger_time = None;
                                    on_trigger();
                                } else {
                                    st.last_trigger_time = Some(now);
                                }
                            } else {
                                st.last_trigger_time = Some(now);
                            }
                        } else {
                            st.key_down = false;
                        }
                    }
                    HotkeyType::Combo => {
                        if let Some(ref modifier) = settings.modifier {
                            if is_same_key(&key, modifier) {
                                st.modifier_held = false;
                            }
                        }
                    }
                    HotkeyType::Hold => {
                        if is_same_key(&key, &settings.key) && st.hold_active {
                            st.hold_active = false;
                            on_trigger();
                        }
                    }
                },
                _ => {}
            }
        };

        if let Err(e) = listen(callback) {
            log::error!("keyboard listener error: {:?}", e);
        }
    });

    log::info!("global hotkey listener started");
}
