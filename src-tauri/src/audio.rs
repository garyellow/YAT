use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{SampleFormat, WavSpec, WavWriter};
use parking_lot::Mutex;
use std::io::Cursor;
use std::sync::Arc;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AudioError {
    #[error("no input device available")]
    NoInputDevice,
    #[error("failed to get device config: {0}")]
    DeviceConfig(String),
    #[error("failed to build stream: {0}")]
    BuildStream(String),
    #[error("failed to encode WAV: {0}")]
    Encode(String),
    #[error("not recording")]
    NotRecording,
}

struct RecordingState {
    samples: Vec<f32>,
    sample_rate: u32,
    channels: u16,
}

/// Wrapper to make cpal::Stream Send.
/// cpal marks Stream as !Send conservatively, but on desktop (WASAPI/CoreAudio)
/// dropping or pausing from another thread is fine as long as access is serialised.
struct SendStream(cpal::Stream);
unsafe impl Send for SendStream {}

pub struct AudioRecorder {
    recording: Arc<Mutex<Option<RecordingState>>>,
    stream: Option<SendStream>,
}

/// List available audio input device names.
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    let mut names = Vec::new();
    if let Ok(devices) = host.input_devices() {
        for device in devices {
            if let Ok(name) = device.name() {
                names.push(name);
            }
        }
    }
    names
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            recording: Arc::new(Mutex::new(None)),
            stream: None,
        }
    }

    /// Start recording from the specified device (or system default if None).
    pub fn start(&mut self, device_name: Option<&str>) -> Result<(), AudioError> {
        let host = cpal::default_host();

        let device = if let Some(name) = device_name {
            // Try to find the requested device
            host.input_devices()
                .map_err(|e| AudioError::DeviceConfig(e.to_string()))?
                .find(|d| d.name().map(|n| n == name).unwrap_or(false))
                .ok_or_else(|| {
                    log::warn!("requested device '{name}' not found, using default");
                    AudioError::NoInputDevice
                })
                .or_else(|_| {
                    host.default_input_device().ok_or(AudioError::NoInputDevice)
                })?
        } else {
            host.default_input_device()
                .ok_or(AudioError::NoInputDevice)?
        };

        let config = device
            .default_input_config()
            .map_err(|e| AudioError::DeviceConfig(e.to_string()))?;

        let sample_rate = config.sample_rate().0;
        let channels = config.channels();

        {
            let mut rec = self.recording.lock();
            *rec = Some(RecordingState {
                samples: Vec::new(),
                sample_rate,
                channels,
            });
        }

        let recording = Arc::clone(&self.recording);
        let err_fn = |err: cpal::StreamError| {
            log::error!("audio stream error: {err}");
        };

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device
                .build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if let Some(ref mut state) = *recording.lock() {
                            state.samples.extend_from_slice(data);
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| AudioError::BuildStream(e.to_string()))?,
            cpal::SampleFormat::I16 => {
                let recording = Arc::clone(&self.recording);
                device
                    .build_input_stream(
                        &config.into(),
                        move |data: &[i16], _: &cpal::InputCallbackInfo| {
                            if let Some(ref mut state) = *recording.lock() {
                                state
                                    .samples
                                    .extend(data.iter().map(|&s| s as f32 / i16::MAX as f32));
                            }
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| AudioError::BuildStream(e.to_string()))?
            }
            cpal::SampleFormat::U16 => {
                let recording = Arc::clone(&self.recording);
                device
                    .build_input_stream(
                        &config.into(),
                        move |data: &[u16], _: &cpal::InputCallbackInfo| {
                            if let Some(ref mut state) = *recording.lock() {
                                state.samples.extend(
                                    data.iter()
                                        .map(|&s| (s as f32 / u16::MAX as f32) * 2.0 - 1.0),
                                );
                            }
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| AudioError::BuildStream(e.to_string()))?
            }
            _ => return Err(AudioError::DeviceConfig("unsupported sample format".into())),
        };

        stream
            .play()
            .map_err(|e| AudioError::BuildStream(e.to_string()))?;
        self.stream = Some(SendStream(stream));

        log::info!("recording started: {sample_rate}Hz, {channels}ch");
        Ok(())
    }

    /// Stop recording and return WAV bytes (PCM 16-bit, mono).
    pub fn stop(&mut self) -> Result<Vec<u8>, AudioError> {
        // Drop the stream first to stop capturing
        self.stream.take();

        let state = self
            .recording
            .lock()
            .take()
            .ok_or(AudioError::NotRecording)?;

        log::info!(
            "recording stopped: {} samples ({:.1}s)",
            state.samples.len(),
            state.samples.len() as f64 / state.sample_rate as f64 / state.channels as f64
        );

        encode_wav(&state.samples, state.sample_rate, state.channels)
    }

    pub fn cancel(&mut self) {
        self.stream.take();
        self.recording.lock().take();
        log::info!("recording cancelled");
    }

    pub fn is_recording(&self) -> bool {
        self.stream.is_some()
    }
}

/// Encode f32 samples to WAV (PCM 16-bit, mono-mixed).
fn encode_wav(samples: &[f32], sample_rate: u32, channels: u16) -> Result<Vec<u8>, AudioError> {
    let mut cursor = Cursor::new(Vec::new());

    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };

    let mut writer =
        WavWriter::new(&mut cursor, spec).map_err(|e| AudioError::Encode(e.to_string()))?;

    // Mix to mono and write as i16
    for chunk in samples.chunks(channels as usize) {
        let mono: f32 = chunk.iter().sum::<f32>() / channels as f32;
        let sample = (mono * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        writer
            .write_sample(sample)
            .map_err(|e| AudioError::Encode(e.to_string()))?;
    }

    writer
        .finalize()
        .map_err(|e| AudioError::Encode(e.to_string()))?;

    Ok(cursor.into_inner())
}
