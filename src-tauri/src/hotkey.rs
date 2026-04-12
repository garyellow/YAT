use parking_lot::Mutex;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use rdev::grab;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use rdev::listen;
use rdev::{Event, EventType, Key};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

#[derive(Debug, Clone, PartialEq)]
pub enum HotkeyType {
    Single,
    DoubleTap,
    Combo,
    Hold,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum KeyMatcher {
    Exact(Key),
    EitherCtrl,
    EitherShift,
    EitherMeta,
}

impl KeyMatcher {
    pub(crate) fn primary_key(&self) -> Key {
        match self {
            Self::Exact(key) => *key,
            Self::EitherCtrl => Key::ControlLeft,
            Self::EitherShift => Key::ShiftLeft,
            Self::EitherMeta => Key::MetaLeft,
        }
    }

    fn matches(&self, key: &Key) -> bool {
        match self {
            Self::Exact(expected) => expected == key,
            Self::EitherCtrl => matches!(key, Key::ControlLeft | Key::ControlRight),
            Self::EitherShift => matches!(key, Key::ShiftLeft | Key::ShiftRight),
            Self::EitherMeta => matches!(key, Key::MetaLeft | Key::MetaRight),
        }
    }
}

#[derive(Debug, Clone)]
pub struct HotkeySettings {
    pub hotkey_type: HotkeyType,
    pub key: Key,
    pub(crate) key_matcher: KeyMatcher,
    pub held_keys: Vec<Key>,
    pub(crate) held_key_matchers: Vec<KeyMatcher>,
    pub double_tap_interval_ms: u64,
}

impl Default for HotkeySettings {
    fn default() -> Self {
        Self {
            hotkey_type: HotkeyType::Hold,
            #[cfg(target_os = "macos")]
            key: Key::MetaRight,
            #[cfg(target_os = "macos")]
            key_matcher: KeyMatcher::Exact(Key::MetaRight),
            #[cfg(not(target_os = "macos"))]
            key: Key::ControlRight,
            #[cfg(not(target_os = "macos"))]
            key_matcher: KeyMatcher::Exact(Key::ControlRight),
            held_keys: Vec::new(),
            held_key_matchers: Vec::new(),
            double_tap_interval_ms: 300,
        }
    }
}

struct HotkeyState {
    key_down: bool,
    key_consumed: bool,
    other_key_pressed: bool,
    last_trigger_time: Option<Instant>,
    pressed_keys: Vec<Key>,
    hold_active: bool,
    hold_start: Option<Instant>,
    esc_down: bool,
    esc_consumed: bool,
    /// After ESC cancels a Hold, the next release of the hotkey must still be
    /// consumed so the OS doesn't receive a phantom key-up without a matching
    /// key-down.
    pending_consume_release: bool,
}

pub(crate) fn parse_key_match(name: &str) -> Option<KeyMatcher> {
    match name.to_lowercase().as_str() {
        "alt" | "lalt" => Some(KeyMatcher::Exact(Key::Alt)),
        "ralt" | "altgr" => Some(KeyMatcher::Exact(Key::AltGr)),
        "ctrl" | "control" => Some(KeyMatcher::EitherCtrl),
        "lctrl" => Some(KeyMatcher::Exact(Key::ControlLeft)),
        "rctrl" => Some(KeyMatcher::Exact(Key::ControlRight)),
        "shift" => Some(KeyMatcher::EitherShift),
        "lshift" => Some(KeyMatcher::Exact(Key::ShiftLeft)),
        "rshift" => Some(KeyMatcher::Exact(Key::ShiftRight)),
        "meta" | "super" | "cmd" | "command" => Some(KeyMatcher::EitherMeta),
        "lmeta" => Some(KeyMatcher::Exact(Key::MetaLeft)),
        "rmeta" | "rcmd" => Some(KeyMatcher::Exact(Key::MetaRight)),
        "f1" => Some(KeyMatcher::Exact(Key::F1)),
        "f2" => Some(KeyMatcher::Exact(Key::F2)),
        "f3" => Some(KeyMatcher::Exact(Key::F3)),
        "f4" => Some(KeyMatcher::Exact(Key::F4)),
        "f5" => Some(KeyMatcher::Exact(Key::F5)),
        "f6" => Some(KeyMatcher::Exact(Key::F6)),
        "f7" => Some(KeyMatcher::Exact(Key::F7)),
        "f8" => Some(KeyMatcher::Exact(Key::F8)),
        "f9" => Some(KeyMatcher::Exact(Key::F9)),
        "f10" => Some(KeyMatcher::Exact(Key::F10)),
        "f11" => Some(KeyMatcher::Exact(Key::F11)),
        "f12" => Some(KeyMatcher::Exact(Key::F12)),
        "space" => Some(KeyMatcher::Exact(Key::Space)),
        "escape" | "esc" => Some(KeyMatcher::Exact(Key::Escape)),
        "tab" => Some(KeyMatcher::Exact(Key::Tab)),
        "capslock" => Some(KeyMatcher::Exact(Key::CapsLock)),
        "backspace" => Some(KeyMatcher::Exact(Key::Backspace)),
        "enter" | "return" => Some(KeyMatcher::Exact(Key::Return)),
        // Navigation
        "up" | "arrowup" => Some(KeyMatcher::Exact(Key::UpArrow)),
        "down" | "arrowdown" => Some(KeyMatcher::Exact(Key::DownArrow)),
        "left" | "arrowleft" => Some(KeyMatcher::Exact(Key::LeftArrow)),
        "right" | "arrowright" => Some(KeyMatcher::Exact(Key::RightArrow)),
        "home" => Some(KeyMatcher::Exact(Key::Home)),
        "end" => Some(KeyMatcher::Exact(Key::End)),
        "pageup" => Some(KeyMatcher::Exact(Key::PageUp)),
        "pagedown" => Some(KeyMatcher::Exact(Key::PageDown)),
        "insert" => Some(KeyMatcher::Exact(Key::Insert)),
        "delete" => Some(KeyMatcher::Exact(Key::Delete)),
        // Punctuation / symbols
        "comma" => Some(KeyMatcher::Exact(Key::Comma)),
        "period" | "dot" => Some(KeyMatcher::Exact(Key::Dot)),
        "slash" => Some(KeyMatcher::Exact(Key::Slash)),
        "backslash" => Some(KeyMatcher::Exact(Key::BackSlash)),
        "semicolon" => Some(KeyMatcher::Exact(Key::SemiColon)),
        "quote" | "apostrophe" => Some(KeyMatcher::Exact(Key::Quote)),
        "backquote" | "grave" => Some(KeyMatcher::Exact(Key::BackQuote)),
        "leftbracket" | "bracketleft" => Some(KeyMatcher::Exact(Key::LeftBracket)),
        "rightbracket" | "bracketright" => Some(KeyMatcher::Exact(Key::RightBracket)),
        "minus" | "hyphen" => Some(KeyMatcher::Exact(Key::Minus)),
        "equal" | "equals" => Some(KeyMatcher::Exact(Key::Equal)),
        "intlbackslash" => Some(KeyMatcher::Exact(Key::IntlBackslash)),
        // Number row (named variants)
        "num0" | "digit0" => Some(KeyMatcher::Exact(Key::Num0)),
        "num1" | "digit1" => Some(KeyMatcher::Exact(Key::Num1)),
        "num2" | "digit2" => Some(KeyMatcher::Exact(Key::Num2)),
        "num3" | "digit3" => Some(KeyMatcher::Exact(Key::Num3)),
        "num4" | "digit4" => Some(KeyMatcher::Exact(Key::Num4)),
        "num5" | "digit5" => Some(KeyMatcher::Exact(Key::Num5)),
        "num6" | "digit6" => Some(KeyMatcher::Exact(Key::Num6)),
        "num7" | "digit7" => Some(KeyMatcher::Exact(Key::Num7)),
        "num8" | "digit8" => Some(KeyMatcher::Exact(Key::Num8)),
        "num9" | "digit9" => Some(KeyMatcher::Exact(Key::Num9)),
        // Numpad
        "kp0" | "numpad0" => Some(KeyMatcher::Exact(Key::Kp0)),
        "kp1" | "numpad1" => Some(KeyMatcher::Exact(Key::Kp1)),
        "kp2" | "numpad2" => Some(KeyMatcher::Exact(Key::Kp2)),
        "kp3" | "numpad3" => Some(KeyMatcher::Exact(Key::Kp3)),
        "kp4" | "numpad4" => Some(KeyMatcher::Exact(Key::Kp4)),
        "kp5" | "numpad5" => Some(KeyMatcher::Exact(Key::Kp5)),
        "kp6" | "numpad6" => Some(KeyMatcher::Exact(Key::Kp6)),
        "kp7" | "numpad7" => Some(KeyMatcher::Exact(Key::Kp7)),
        "kp8" | "numpad8" => Some(KeyMatcher::Exact(Key::Kp8)),
        "kp9" | "numpad9" => Some(KeyMatcher::Exact(Key::Kp9)),
        "kpreturn" | "numpadenter" => Some(KeyMatcher::Exact(Key::KpReturn)),
        "kpminus" | "numpadsubtract" => Some(KeyMatcher::Exact(Key::KpMinus)),
        "kpplus" | "numpadadd" => Some(KeyMatcher::Exact(Key::KpPlus)),
        "kpmultiply" | "numpadmultiply" => Some(KeyMatcher::Exact(Key::KpMultiply)),
        "kpdivide" | "numpaddivide" => Some(KeyMatcher::Exact(Key::KpDivide)),
        "kpdelete" | "numpaddecimal" => Some(KeyMatcher::Exact(Key::KpDelete)),
        "numlock" => Some(KeyMatcher::Exact(Key::NumLock)),
        // Lock / misc
        "printscreen" => Some(KeyMatcher::Exact(Key::PrintScreen)),
        "scrolllock" => Some(KeyMatcher::Exact(Key::ScrollLock)),
        "pause" => Some(KeyMatcher::Exact(Key::Pause)),
        // Single ASCII character fallback
        s if s.len() == 1 => {
            let ch = s.chars().next().unwrap();
            Some(KeyMatcher::Exact(Key::Unknown(ch as u32)))
        }
        _ => None,
    }
}

pub(crate) fn key_patterns_overlap(a: &KeyMatcher, b: &KeyMatcher) -> bool {
    match (a, b) {
        (KeyMatcher::EitherCtrl, KeyMatcher::EitherCtrl)
        | (KeyMatcher::EitherShift, KeyMatcher::EitherShift)
        | (KeyMatcher::EitherMeta, KeyMatcher::EitherMeta) => true,
        (KeyMatcher::EitherCtrl, KeyMatcher::Exact(key))
        | (KeyMatcher::Exact(key), KeyMatcher::EitherCtrl) => {
            matches!(key, Key::ControlLeft | Key::ControlRight)
        }
        (KeyMatcher::EitherShift, KeyMatcher::Exact(key))
        | (KeyMatcher::Exact(key), KeyMatcher::EitherShift) => {
            matches!(key, Key::ShiftLeft | Key::ShiftRight)
        }
        (KeyMatcher::EitherMeta, KeyMatcher::Exact(key))
        | (KeyMatcher::Exact(key), KeyMatcher::EitherMeta) => {
            matches!(key, Key::MetaLeft | Key::MetaRight)
        }
        (KeyMatcher::Exact(a), KeyMatcher::Exact(b)) => a == b,
        _ => false,
    }
}

pub(crate) fn is_modifier_key(key: &Key) -> bool {
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

fn should_consume_single_or_double_tap(key: &Key) -> bool {
    !is_modifier_key(key)
}

fn remember_pressed_key(pressed_keys: &mut Vec<Key>, key: &Key) {
    if !pressed_keys.iter().any(|pressed| pressed == key) {
        pressed_keys.push(*key);
    }
}

fn forget_pressed_key(pressed_keys: &mut Vec<Key>, key: &Key) {
    pressed_keys.retain(|pressed| pressed != key);
}

fn held_keys_active(settings: &HotkeySettings, pressed_keys: &[Key]) -> bool {
    settings
        .held_key_matchers
        .iter()
        .all(|matcher| pressed_keys.iter().any(|pressed| matcher.matches(pressed)))
}

fn handle_event_type<F, G>(
    event_type: &EventType,
    settings: &HotkeySettings,
    st: &mut HotkeyState,
    trigger_enabled: bool,
    on_trigger: &F,
    on_cancel: &G,
) -> bool
where
    F: Fn(),
    G: Fn() -> bool,
{
    match event_type {
        EventType::KeyPress(key) => {
            remember_pressed_key(&mut st.pressed_keys, key);

            if key == &Key::Escape
                && !st.esc_down
                && !settings.key_matcher.matches(&Key::Escape)
                && settings
                    .held_key_matchers
                    .iter()
                    .all(|matcher| !matcher.matches(&Key::Escape))
            {
                st.esc_down = true;
                st.esc_consumed = on_cancel();
                if st.esc_consumed {
                    // For Hold mode: consume the upcoming key release so the OS
                    // doesn't receive a phantom key-up without a matching key-down.
                    if st.hold_active {
                        st.pending_consume_release = true;
                    }
                    st.hold_active = false;
                    st.hold_start = None;
                    // Prevent Single/DoubleTap from firing on release after cancel.
                    st.other_key_pressed = true;
                }
                return st.esc_consumed;
            }

            if !trigger_enabled {
                return false;
            }

            match settings.hotkey_type {
                HotkeyType::Single => {
                    if settings.key_matcher.matches(key) {
                        st.key_down = true;
                        st.key_consumed = should_consume_single_or_double_tap(&settings.key);
                        st.other_key_pressed = false;
                        return st.key_consumed;
                    } else if st.key_down {
                        st.other_key_pressed = true;
                    }
                }
                HotkeyType::DoubleTap => {
                    if settings.key_matcher.matches(key) {
                        st.key_down = true;
                        st.key_consumed = should_consume_single_or_double_tap(&settings.key);
                        st.other_key_pressed = false;
                        return st.key_consumed;
                    } else if st.key_down {
                        st.other_key_pressed = true;
                    }
                }
                HotkeyType::Combo => {
                    if settings.key_matcher.matches(key)
                        && held_keys_active(settings, &st.pressed_keys)
                        && !st.key_down
                    {
                        st.key_down = true;
                        st.key_consumed = true;
                        on_trigger();
                        return true;
                    }
                }
                HotkeyType::Hold => {
                    if settings.key_matcher.matches(key) && !st.hold_active {
                        st.hold_active = true;
                        st.hold_start = Some(Instant::now());
                        st.key_consumed = true;
                        on_trigger();
                        return true;
                    }
                }
            }

            false
        }
        EventType::KeyRelease(key) => {
            if key == &Key::Escape {
                forget_pressed_key(&mut st.pressed_keys, key);
                let consumed = st.esc_consumed;
                st.esc_down = false;
                st.esc_consumed = false;
                return consumed;
            }

            match settings.hotkey_type {
                HotkeyType::Single => {
                    forget_pressed_key(&mut st.pressed_keys, key);
                    let consumed = st.key_consumed;
                    if settings.key_matcher.matches(key) && st.key_down && !st.other_key_pressed {
                        st.key_down = false;
                        st.key_consumed = false;
                        on_trigger();
                        return consumed;
                    } else {
                        st.key_down = false;
                        st.key_consumed = false;
                    }
                    consumed
                }
                HotkeyType::DoubleTap => {
                    forget_pressed_key(&mut st.pressed_keys, key);
                    let consumed = st.key_consumed;
                    if settings.key_matcher.matches(key) && st.key_down && !st.other_key_pressed {
                        st.key_down = false;
                        st.key_consumed = false;
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
                        return consumed;
                    } else {
                        st.key_down = false;
                        st.key_consumed = false;
                    }
                    consumed
                }
                HotkeyType::Combo => {
                    if settings.key_matcher.matches(key) {
                        forget_pressed_key(&mut st.pressed_keys, key);
                        let consumed = st.key_consumed;
                        st.key_down = false;
                        st.key_consumed = false;
                        return consumed;
                    }
                    if settings
                        .held_key_matchers
                        .iter()
                        .any(|matcher| matcher.matches(key))
                    {
                        forget_pressed_key(&mut st.pressed_keys, key);
                        st.key_down = false;
                        st.key_consumed = false;
                        return false;
                    }
                    forget_pressed_key(&mut st.pressed_keys, key);
                    false
                }
                HotkeyType::Hold => {
                    if settings.key_matcher.matches(key) {
                        forget_pressed_key(&mut st.pressed_keys, key);
                        // After ESC cancel, consume the release to avoid a
                        // phantom key-up reaching the OS.
                        if st.pending_consume_release {
                            st.pending_consume_release = false;
                            st.key_consumed = false;
                            return true;
                        }
                        if st.hold_active {
                            let consumed = st.key_consumed;
                            let too_short = st
                                .hold_start
                                .is_some_and(|t| t.elapsed().as_millis() < 150);
                            st.hold_active = false;
                            st.hold_start = None;
                            st.key_consumed = false;
                            if too_short {
                                // Micro-tap: cancel instead of delivering empty audio
                                on_cancel();
                            } else {
                                on_trigger();
                            }
                            return consumed;
                        }
                    }
                    forget_pressed_key(&mut st.pressed_keys, key);
                    false
                }
            }
        }
        _ => false,
    }
}

fn handle_event<F, G>(
    event: &Event,
    settings: &HotkeySettings,
    st: &mut HotkeyState,
    trigger_enabled: bool,
    on_trigger: &F,
    on_cancel: &G,
) -> bool
where
    F: Fn(),
    G: Fn() -> bool,
{
    handle_event_type(
        &event.event_type,
        settings,
        st,
        trigger_enabled,
        on_trigger,
        on_cancel,
    )
}

/// Start a global keyboard listener on a background thread.
/// Calls `on_trigger` whenever the configured hotkey is activated.
/// Calls `on_cancel` whenever Escape is pressed (for cancelling the current operation).
pub fn start_listener<F, G>(
    settings: Arc<Mutex<HotkeySettings>>,
    triggers_enabled: Arc<AtomicBool>,
    on_trigger: F,
    on_cancel: G,
)
where
    F: Fn() + Send + 'static,
    G: Fn() -> bool + Send + 'static,
{
    std::thread::spawn(move || {
        let state = Arc::new(Mutex::new(HotkeyState {
            key_down: false,
            key_consumed: false,
            other_key_pressed: false,
            last_trigger_time: None,
            pressed_keys: Vec::new(),
            hold_active: false,
            hold_start: None,
            esc_down: false,
            esc_consumed: false,
            pending_consume_release: false,
        }));

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let callback = move |event: Event| -> Option<Event> {
            // While a paste simulation is in progress, pass through ALL
            // events so the simulated Ctrl/Cmd+V is not intercepted.
            if crate::output::is_paste_active() {
                return Some(event);
            }

            let settings = settings.lock().clone();
            let mut st = state.lock();
            let trigger_enabled = triggers_enabled.load(Ordering::SeqCst);
            if handle_event(
                &event,
                &settings,
                &mut st,
                trigger_enabled,
                &on_trigger,
                &on_cancel,
            ) {
                None
            } else {
                Some(event)
            }
        };

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let callback = move |event: Event| {
            let settings = settings.lock().clone();
            let mut st = state.lock();
            let trigger_enabled = triggers_enabled.load(Ordering::SeqCst);
            handle_event(
                &event,
                &settings,
                &mut st,
                trigger_enabled,
                &on_trigger,
                &on_cancel,
            );
        };

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let result = grab(callback).map_err(|e| format!("{:?}", e));

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let result = listen(callback).map_err(|e| format!("{:?}", e));

        if let Err(e) = result {
            log::error!("keyboard listener error: {e}");
        }
    });

    log::info!("global hotkey listener started");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

    fn fresh_state() -> HotkeyState {
        HotkeyState {
            key_down: false,
            key_consumed: false,
            other_key_pressed: false,
            last_trigger_time: None,
            pressed_keys: Vec::new(),
            hold_active: false,
            hold_start: None,
            esc_down: false,
            esc_consumed: false,
            pending_consume_release: false,
        }
    }

    #[test]
    fn right_control_does_not_match_left_control_when_exact_side_is_configured() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::Hold,
            key: Key::ControlRight,
            key_matcher: KeyMatcher::Exact(Key::ControlRight),
            held_keys: Vec::new(),
            held_key_matchers: Vec::new(),
            double_tap_interval_ms: 300,
        };
        let mut state = fresh_state();
        let trigger_count = AtomicUsize::new(0);

        let consumed = handle_event_type(
            &EventType::KeyPress(Key::ControlLeft),
            &settings,
            &mut state,
            true,
            &|| {
                trigger_count.fetch_add(1, AtomicOrdering::SeqCst);
            },
            &|| false,
        );

        assert!(!consumed);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 0);
    }

    #[test]
    fn alt_hold_triggers_on_press_and_cancels_micro_tap() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::Hold,
            key: Key::Alt,
            key_matcher: KeyMatcher::Exact(Key::Alt),
            held_keys: Vec::new(),
            held_key_matchers: Vec::new(),
            double_tap_interval_ms: 300,
        };
        let mut state = fresh_state();
        let trigger_count = AtomicUsize::new(0);
        let cancel_count = AtomicUsize::new(0);

        // Press starts recording
        let pressed_consumed = handle_event_type(
            &EventType::KeyPress(Key::Alt),
            &settings,
            &mut state,
            true,
            &|| {
                trigger_count.fetch_add(1, AtomicOrdering::SeqCst);
            },
            &|| {
                cancel_count.fetch_add(1, AtomicOrdering::SeqCst);
                true
            },
        );

        assert!(pressed_consumed);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 1);

        // Instant release (< 150ms) → cancel instead of trigger
        let released_consumed = handle_event_type(
            &EventType::KeyRelease(Key::Alt),
            &settings,
            &mut state,
            true,
            &|| {
                trigger_count.fetch_add(1, AtomicOrdering::SeqCst);
            },
            &|| {
                cancel_count.fetch_add(1, AtomicOrdering::SeqCst);
                true
            },
        );

        assert!(released_consumed);
        // trigger_count still 1 (only press), cancel_count is 1 (micro-tap cancel)
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(cancel_count.load(AtomicOrdering::SeqCst), 1);
    }

    #[test]
    fn alt_single_triggers_on_release_without_consuming_modifier() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::Single,
            key: Key::Alt,
            key_matcher: KeyMatcher::Exact(Key::Alt),
            held_keys: Vec::new(),
            held_key_matchers: Vec::new(),
            double_tap_interval_ms: 300,
        };
        let mut state = fresh_state();
        let trigger_count = AtomicUsize::new(0);

        let pressed_consumed = handle_event_type(
            &EventType::KeyPress(Key::Alt),
            &settings,
            &mut state,
            true,
            &|| {
                trigger_count.fetch_add(1, AtomicOrdering::SeqCst);
            },
            &|| false,
        );
        let released_consumed = handle_event_type(
            &EventType::KeyRelease(Key::Alt),
            &settings,
            &mut state,
            true,
            &|| {
                trigger_count.fetch_add(1, AtomicOrdering::SeqCst);
            },
            &|| false,
        );

        assert!(!pressed_consumed);
        assert!(!released_consumed);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 1);
    }

    #[test]
    fn esc_cancel_consumes_following_hold_release() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::Hold,
            key: Key::Alt,
            key_matcher: KeyMatcher::Exact(Key::Alt),
            held_keys: Vec::new(),
            held_key_matchers: Vec::new(),
            double_tap_interval_ms: 300,
        };
        let mut state = fresh_state();
        let trigger_count = AtomicUsize::new(0);
        let cancel_count = AtomicUsize::new(0);

        let pressed_consumed = handle_event_type(
            &EventType::KeyPress(Key::Alt),
            &settings,
            &mut state,
            true,
            &|| {
                trigger_count.fetch_add(1, AtomicOrdering::SeqCst);
            },
            &|| {
                cancel_count.fetch_add(1, AtomicOrdering::SeqCst);
                true
            },
        );

        let esc_consumed = handle_event_type(
            &EventType::KeyPress(Key::Escape),
            &settings,
            &mut state,
            true,
            &|| {
                trigger_count.fetch_add(1, AtomicOrdering::SeqCst);
            },
            &|| {
                cancel_count.fetch_add(1, AtomicOrdering::SeqCst);
                true
            },
        );

        let release_consumed = handle_event_type(
            &EventType::KeyRelease(Key::Alt),
            &settings,
            &mut state,
            true,
            &|| {
                trigger_count.fetch_add(1, AtomicOrdering::SeqCst);
            },
            &|| {
                cancel_count.fetch_add(1, AtomicOrdering::SeqCst);
                true
            },
        );

        assert!(pressed_consumed);
        assert!(esc_consumed);
        assert!(release_consumed);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(cancel_count.load(AtomicOrdering::SeqCst), 1);
    }

    #[test]
    fn combo_triggers_on_modifier_plus_key() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::Combo,
            key: Key::Unknown('a' as u32),
            key_matcher: KeyMatcher::Exact(Key::Unknown('a' as u32)),
            held_keys: vec![Key::ControlLeft],
            held_key_matchers: vec![KeyMatcher::Exact(Key::ControlLeft)],
            double_tap_interval_ms: 300,
        };
        let mut state = fresh_state();
        let trigger_count = AtomicUsize::new(0);
        let on_trigger = || { trigger_count.fetch_add(1, AtomicOrdering::SeqCst); };
        let on_cancel = || false;

        // Press modifier alone — no trigger
        handle_event_type(&EventType::KeyPress(Key::ControlLeft), &settings, &mut state, true, &on_trigger, &on_cancel);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 0);

        // Press key while modifier held — trigger
        let consumed = handle_event_type(&EventType::KeyPress(Key::Unknown('a' as u32)), &settings, &mut state, true, &on_trigger, &on_cancel);
        assert!(consumed);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 1);

        // Release key, release modifier
        handle_event_type(&EventType::KeyRelease(Key::Unknown('a' as u32)), &settings, &mut state, true, &on_trigger, &on_cancel);
        handle_event_type(&EventType::KeyRelease(Key::ControlLeft), &settings, &mut state, true, &on_trigger, &on_cancel);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 1); // still only 1
    }

    #[test]
    fn combo_key_without_modifier_does_not_trigger() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::Combo,
            key: Key::Unknown('a' as u32),
            key_matcher: KeyMatcher::Exact(Key::Unknown('a' as u32)),
            held_keys: vec![Key::ControlLeft],
            held_key_matchers: vec![KeyMatcher::Exact(Key::ControlLeft)],
            double_tap_interval_ms: 300,
        };
        let mut state = fresh_state();
        let trigger_count = AtomicUsize::new(0);
        let on_trigger = || { trigger_count.fetch_add(1, AtomicOrdering::SeqCst); };
        let on_cancel = || false;

        // Press key without modifier — not consumed, no trigger
        let consumed = handle_event_type(&EventType::KeyPress(Key::Unknown('a' as u32)), &settings, &mut state, true, &on_trigger, &on_cancel);
        assert!(!consumed);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 0);
    }

    #[test]
    fn double_tap_within_interval_triggers() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::DoubleTap,
            key: Key::ControlRight,
            key_matcher: KeyMatcher::Exact(Key::ControlRight),
            held_keys: Vec::new(),
            held_key_matchers: Vec::new(),
            double_tap_interval_ms: 300,
        };
        let mut state = fresh_state();
        let trigger_count = AtomicUsize::new(0);
        let on_trigger = || { trigger_count.fetch_add(1, AtomicOrdering::SeqCst); };
        let on_cancel = || false;

        // First tap (press + release)
        handle_event_type(&EventType::KeyPress(Key::ControlRight), &settings, &mut state, true, &on_trigger, &on_cancel);
        handle_event_type(&EventType::KeyRelease(Key::ControlRight), &settings, &mut state, true, &on_trigger, &on_cancel);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 0); // first tap just records time

        // Second tap immediately (press + release, within interval)
        handle_event_type(&EventType::KeyPress(Key::ControlRight), &settings, &mut state, true, &on_trigger, &on_cancel);
        handle_event_type(&EventType::KeyRelease(Key::ControlRight), &settings, &mut state, true, &on_trigger, &on_cancel);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 1);
    }

    #[test]
    fn double_tap_expired_interval_no_trigger() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::DoubleTap,
            key: Key::ControlRight,
            key_matcher: KeyMatcher::Exact(Key::ControlRight),
            held_keys: Vec::new(),
            held_key_matchers: Vec::new(),
            double_tap_interval_ms: 300,
        };
        let mut state = fresh_state();
        let trigger_count = AtomicUsize::new(0);
        let on_trigger = || { trigger_count.fetch_add(1, AtomicOrdering::SeqCst); };
        let on_cancel = || false;

        // First tap
        handle_event_type(&EventType::KeyPress(Key::ControlRight), &settings, &mut state, true, &on_trigger, &on_cancel);
        handle_event_type(&EventType::KeyRelease(Key::ControlRight), &settings, &mut state, true, &on_trigger, &on_cancel);

        // Simulate expired interval by backdating last_trigger_time
        state.last_trigger_time = Some(Instant::now() - std::time::Duration::from_secs(5));

        // Second tap — interval expired, no trigger
        handle_event_type(&EventType::KeyPress(Key::ControlRight), &settings, &mut state, true, &on_trigger, &on_cancel);
        handle_event_type(&EventType::KeyRelease(Key::ControlRight), &settings, &mut state, true, &on_trigger, &on_cancel);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 0);
    }

    #[test]
    fn triggers_disabled_blocks_hotkey_but_not_esc() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::Hold,
            key: Key::Alt,
            key_matcher: KeyMatcher::Exact(Key::Alt),
            held_keys: Vec::new(),
            held_key_matchers: Vec::new(),
            double_tap_interval_ms: 300,
        };
        let mut state = fresh_state();
        let trigger_count = AtomicUsize::new(0);
        let cancel_count = AtomicUsize::new(0);
        let on_trigger = || { trigger_count.fetch_add(1, AtomicOrdering::SeqCst); };
        let on_cancel = || { cancel_count.fetch_add(1, AtomicOrdering::SeqCst); true };

        // Hotkey press with trigger_enabled=false — NOT consumed
        let consumed = handle_event_type(&EventType::KeyPress(Key::Alt), &settings, &mut state, false, &on_trigger, &on_cancel);
        assert!(!consumed);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 0);

        // ESC should still work even when triggers are disabled
        let esc_consumed = handle_event_type(&EventType::KeyPress(Key::Escape), &settings, &mut state, false, &on_trigger, &on_cancel);
        assert_eq!(cancel_count.load(AtomicOrdering::SeqCst), 1);
        // ESC consumed depends on on_cancel() return — here it returns true
        assert!(esc_consumed);
    }

    #[test]
    fn single_trigger_fires_on_release_only() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::Single,
            key: Key::Unknown('a' as u32),
            key_matcher: KeyMatcher::Exact(Key::Unknown('a' as u32)),
            held_keys: Vec::new(),
            held_key_matchers: Vec::new(),
            double_tap_interval_ms: 300,
        };
        let mut state = fresh_state();
        let trigger_count = AtomicUsize::new(0);
        let on_trigger = || { trigger_count.fetch_add(1, AtomicOrdering::SeqCst); };
        let on_cancel = || false;

        // Press — no trigger yet
        handle_event_type(&EventType::KeyPress(Key::Unknown('a' as u32)), &settings, &mut state, true, &on_trigger, &on_cancel);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 0);

        // Release — trigger fires
        handle_event_type(&EventType::KeyRelease(Key::Unknown('a' as u32)), &settings, &mut state, true, &on_trigger, &on_cancel);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 1);
    }

    #[test]
    fn single_trigger_suppressed_by_other_key() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::Single,
            key: Key::Unknown('a' as u32),
            key_matcher: KeyMatcher::Exact(Key::Unknown('a' as u32)),
            held_keys: Vec::new(),
            held_key_matchers: Vec::new(),
            double_tap_interval_ms: 300,
        };
        let mut state = fresh_state();
        let trigger_count = AtomicUsize::new(0);
        let on_trigger = || { trigger_count.fetch_add(1, AtomicOrdering::SeqCst); };
        let on_cancel = || false;

        // Press hotkey, press another key, release hotkey
        handle_event_type(&EventType::KeyPress(Key::Unknown('a' as u32)), &settings, &mut state, true, &on_trigger, &on_cancel);
        handle_event_type(&EventType::KeyPress(Key::Unknown('b' as u32)), &settings, &mut state, true, &on_trigger, &on_cancel);
        handle_event_type(&EventType::KeyRelease(Key::Unknown('a' as u32)), &settings, &mut state, true, &on_trigger, &on_cancel);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 0);
    }

    #[test]
    fn combo_supports_multiple_held_keys() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::Combo,
            key: Key::Unknown('c' as u32),
            key_matcher: KeyMatcher::Exact(Key::Unknown('c' as u32)),
            held_keys: vec![Key::ControlLeft, Key::ShiftLeft],
            held_key_matchers: vec![
                KeyMatcher::Exact(Key::ControlLeft),
                KeyMatcher::Exact(Key::ShiftLeft),
            ],
            double_tap_interval_ms: 300,
        };
        let mut state = fresh_state();
        let trigger_count = AtomicUsize::new(0);
        let on_trigger = || { trigger_count.fetch_add(1, AtomicOrdering::SeqCst); };
        let on_cancel = || false;

        handle_event_type(&EventType::KeyPress(Key::ControlLeft), &settings, &mut state, true, &on_trigger, &on_cancel);
        handle_event_type(&EventType::KeyPress(Key::ShiftLeft), &settings, &mut state, true, &on_trigger, &on_cancel);
        let consumed = handle_event_type(&EventType::KeyPress(Key::Unknown('c' as u32)), &settings, &mut state, true, &on_trigger, &on_cancel);

        assert!(consumed);
        assert_eq!(trigger_count.load(AtomicOrdering::SeqCst), 1);
    }
}
