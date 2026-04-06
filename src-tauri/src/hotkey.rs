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
            Self::Exact(key) => key.clone(),
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
    pub modifier: Option<Key>,
    pub(crate) modifier_matcher: Option<KeyMatcher>,
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
            modifier: None,
            modifier_matcher: None,
            double_tap_interval_ms: 300,
        }
    }
}

struct HotkeyState {
    key_down: bool,
    key_consumed: bool,
    other_key_pressed: bool,
    last_trigger_time: Option<Instant>,
    modifier_held: bool,
    hold_active: bool,
    hold_start: Option<Instant>,
    esc_down: bool,
    esc_consumed: bool,
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
        s if s.len() == 1 => {
            let ch = s.chars().next().unwrap();
            Some(KeyMatcher::Exact(Key::Unknown(ch as u32)))
        }
        _ => None,
    }
}

/// Convert an rdev Key to the canonical string name used in settings.
pub fn key_to_name(key: &Key) -> Option<String> {
    match key {
        Key::Alt => Some("Alt".into()),
        Key::AltGr => Some("RAlt".into()),
        Key::ControlLeft => Some("LCtrl".into()),
        Key::ControlRight => Some("RCtrl".into()),
        Key::ShiftLeft => Some("LShift".into()),
        Key::ShiftRight => Some("RShift".into()),
        Key::MetaLeft => Some("LMeta".into()),
        Key::MetaRight => Some("RMeta".into()),
        Key::F1 => Some("F1".into()),
        Key::F2 => Some("F2".into()),
        Key::F3 => Some("F3".into()),
        Key::F4 => Some("F4".into()),
        Key::F5 => Some("F5".into()),
        Key::F6 => Some("F6".into()),
        Key::F7 => Some("F7".into()),
        Key::F8 => Some("F8".into()),
        Key::F9 => Some("F9".into()),
        Key::F10 => Some("F10".into()),
        Key::F11 => Some("F11".into()),
        Key::F12 => Some("F12".into()),
        Key::Space => Some("Space".into()),
        Key::Escape => Some("Escape".into()),
        Key::Tab => Some("Tab".into()),
        Key::CapsLock => Some("CapsLock".into()),
        Key::Backspace => Some("Backspace".into()),
        Key::Return => Some("Enter".into()),
        Key::Unknown(code) => {
            if let Some(ch) = char::from_u32(*code) {
                if ch.is_ascii_alphanumeric() || ch.is_ascii_punctuation() {
                    return Some(ch.to_uppercase().to_string());
                }
            }
            None
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
            if key == &Key::Escape
                && !st.esc_down
                && !settings.key_matcher.matches(&Key::Escape)
                && settings
                    .modifier_matcher
                    .as_ref()
                    .map_or(true, |m| !m.matches(&Key::Escape))
            {
                st.esc_down = true;
                st.esc_consumed = on_cancel();
                if st.esc_consumed {
                    st.hold_active = false;
                    st.hold_start = None;
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
                    if let Some(ref modifier_matcher) = settings.modifier_matcher {
                        if modifier_matcher.matches(key) {
                            st.modifier_held = true;
                        } else if settings.key_matcher.matches(key)
                            && st.modifier_held
                            && !st.key_down
                        {
                            st.key_down = true;
                            st.key_consumed = true;
                            on_trigger();
                            return true;
                        }
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
                let consumed = st.esc_consumed;
                st.esc_down = false;
                st.esc_consumed = false;
                return consumed;
            }

            match settings.hotkey_type {
                HotkeyType::Single => {
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
                        let consumed = st.key_consumed;
                        st.key_down = false;
                        st.key_consumed = false;
                        return consumed;
                    }
                    if let Some(ref modifier_matcher) = settings.modifier_matcher {
                        if modifier_matcher.matches(key) {
                            st.modifier_held = false;
                            st.key_down = false;
                            st.key_consumed = false;
                        }
                    }
                    false
                }
                HotkeyType::Hold => {
                    if settings.key_matcher.matches(key) && st.hold_active {
                        let consumed = st.key_consumed;
                        let too_short = st
                            .hold_start
                            .map_or(false, |t| t.elapsed().as_millis() < 150);
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
            modifier_held: false,
            hold_active: false,
            hold_start: None,
            esc_down: false,
            esc_consumed: false,
        }));

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let callback = move |event: Event| -> Option<Event> {
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
            let _ = handle_event(
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
            modifier_held: false,
            hold_active: false,
            hold_start: None,
            esc_down: false,
            esc_consumed: false,
        }
    }

    #[test]
    fn right_control_does_not_match_left_control_when_exact_side_is_configured() {
        let settings = HotkeySettings {
            hotkey_type: HotkeyType::Hold,
            key: Key::ControlRight,
            key_matcher: KeyMatcher::Exact(Key::ControlRight),
            modifier: None,
            modifier_matcher: None,
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
            modifier: None,
            modifier_matcher: None,
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
            modifier: None,
            modifier_matcher: None,
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
}
