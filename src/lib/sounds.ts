let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return ctx;
}

function beep(freq: number, duration: number) {
  const audioCtx = getCtx();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = freq;
  gain.gain.value = 0.25;
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.stop(audioCtx.currentTime + duration);
}

export const sounds = {
  startRecording: () => beep(880, 0.15),
  stopRecording: () => {
    beep(660, 0.1);
    setTimeout(() => beep(440, 0.15), 120);
  },
  done: () => {
    beep(523, 0.1);
    setTimeout(() => beep(659, 0.1), 100);
    setTimeout(() => beep(784, 0.15), 200);
  },
  error: () => beep(220, 0.3),
  busy: () => {
    beep(330, 0.08);
    setTimeout(() => beep(330, 0.08), 100);
  },
};
