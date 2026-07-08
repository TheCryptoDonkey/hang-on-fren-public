// Audio engine, ported and trimmed from neon-sentinel. Same architecture:
// master -> compressor -> destination, with music + sfx buses, persisted
// settings, a continuous engine oscillator whose pitch tracks speed, and a
// cached voice-clip player for the reused "Want rose, fren?" line.

type ToneKind = 'rose' | 'crash' | 'wipeout' | 'skid' | 'tick' | 'milestone' | 'overtake' | 'nearMiss' | 'combo' | 'rev';

interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

const STORAGE_KEY = 'hangonfren:audio:v1';
const DEFAULTS: AudioSettings = { master: 0.86, music: 0.5, sfx: 1, muted: false };
const SFX_ARCADE_GAIN = 1.3;

let audioCtx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let engineOsc: OscillatorNode | null = null;
let engineGain: GainNode | null = null;
let engineFilter: BiquadFilterNode | null = null;
let engineSubOsc: OscillatorNode | null = null;
let engineSubGain: GainNode | null = null;
// Continuous off-road rumble (like the engine, driven every frame): a broadband
// gravel/grass ROAR plus a low corrugation BUZZ for the rumble strip.
let rumbleNoiseSrc: AudioBufferSourceNode | null = null;
let rumbleNoiseGain: GainNode | null = null;
let rumbleNoiseFilter: BiquadFilterNode | null = null;
let rumbleBuzzOsc: OscillatorNode | null = null;
let rumbleBuzzGain: GainNode | null = null;
// Continuous tyre SCREECH (driven every frame like the engine/rumble): a
// bandpass-filtered noise "scrub" that bites when the bike is loaded up hard in
// a corner and is silent when tracking straight.
let screechNoiseSrc: AudioBufferSourceNode | null = null;
let screechFilter: BiquadFilterNode | null = null;
let screechGain: GainNode | null = null;
// Continuous TURBO whoosh (rose nitro): a bright noise rush whose filter sweeps
// up with boost intensity, silent otherwise.
let turboNoiseSrc: AudioBufferSourceNode | null = null;
let turboFilter: BiquadFilterNode | null = null;
let turboGain: GainNode | null = null;
let sharedNoiseBuffer: AudioBuffer | null = null;
let unlocked = false;
let sfxPitch = 1;
let settings = loadSettings();

export function unlockAudio(): void {
  const ctx = getCtx();
  if (ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
  try {
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    /* closed context — recreated on next gesture */
  }
  unlocked = true;
}

export function isAudioUnlocked(): boolean {
  return unlocked;
}

export interface EngineFrame {
  playing: boolean;
  speed: number; // 0..1
  throttle: number; // 0..1
}

export function updateEngine(frame: EngineFrame): void {
  if (!audioCtx || !engineOsc || !engineGain || !engineFilter || !engineSubOsc || !engineSubGain) return;
  const now = audioCtx.currentTime;
  const speed = clamp(frame.speed, 0, 1);
  const throttle = clamp(frame.throttle, 0, 1);
  const moving = clamp(speed * 0.7 + throttle * 0.4, 0, 1);
  // Buzzy two-stroke rasp: a fast putter plus a higher grain, both scaling with
  // how hard the scooter is working.
  const flutter = Math.sin(now * 7.4) * (3 + moving * 8) + Math.sin(now * 23) * moving * 5;
  const level = frame.playing ? 0.06 + moving * 0.2 : 0;
  engineOsc.frequency.setTargetAtTime(72 + speed * 168 + throttle * 52 + flutter, now, 0.05);
  engineFilter.frequency.setTargetAtTime(260 + moving * 1500 + throttle * 420, now, 0.07);
  engineGain.gain.setTargetAtTime(level * settings.sfx, now, 0.06);
  engineSubOsc.frequency.setTargetAtTime(34 + speed * 30, now, 0.09);
  engineSubGain.gain.setTargetAtTime((frame.playing ? 0.05 + moving * 0.12 : 0) * settings.sfx, now, 0.08);
}

export interface RumbleFrame {
  active: boolean;
  intensity: number; // 0..1 — how far off the tarmac (edge → deep grass)
  speed: number; // 0..1 — faster = angrier
}

/**
 * Drive the continuous off-road rumble. Called every frame like updateEngine:
 * silent on the tarmac, a low growl the instant a wheel touches the rumble strip,
 * building to a full gravel roar in the grass — and always louder the faster you
 * are travelling, so a wide drift in a quick sweeper really bites.
 */
export function updateRumble(frame: RumbleFrame): void {
  if (!audioCtx || !rumbleNoiseGain || !rumbleNoiseFilter || !rumbleBuzzGain || !rumbleBuzzOsc) return;
  const now = audioCtx.currentTime;
  const i = frame.active ? clamp(frame.intensity, 0, 1) : 0;
  const spd = clamp(frame.speed, 0, 1);
  // Roar: broadband grass/gravel hiss. Present even at a crawl (so you hear the
  // verge), but it opens up with speed. Filter brightens as you go deeper/faster.
  const roar = i * (0.22 + spd * 0.5);
  rumbleNoiseGain.gain.setTargetAtTime(roar * settings.sfx, now, 0.05);
  rumbleNoiseFilter.frequency.setTargetAtTime(340 + i * 480 + spd * 620, now, 0.08);
  // Buzz: the rumble-strip corrugation whir, pitch climbing with speed. Needs
  // both off-road AND motion, so a stationary drift off the edge won't drone.
  const buzz = i * spd * 0.15;
  rumbleBuzzGain.gain.setTargetAtTime(buzz * settings.sfx, now, 0.06);
  rumbleBuzzOsc.frequency.setTargetAtTime(46 + spd * 88, now, 0.05);
}

export interface ScreechFrame {
  active: boolean;
  load: number; // 0..1 — how hard the bike is loaded up in the corner
  speed: number; // 0..1 — faster = louder, higher scrub
}

/**
 * Drive the continuous tyre screech. Called every frame like updateRumble: a
 * bandpass "scrub" that opens up as the rider carries big lateral load through a
 * bend at speed, and shuts again the moment they straighten up or slow. The
 * bandpass centre rises with load so a hard corner squeals brighter.
 */
export function updateScreech(frame: ScreechFrame): void {
  if (!audioCtx || !screechGain || !screechFilter) return;
  const now = audioCtx.currentTime;
  const load = frame.active ? clamp(frame.load, 0, 1) : 0;
  const spd = clamp(frame.speed, 0, 1);
  // Only really speaks once both load AND speed are up — a slow, gentle drift
  // shouldn't squeal. Attack fast (a corner bites now), release a touch slower.
  const target = load * load * (0.12 + spd * 0.5);
  const smoothing = target > screechGain.gain.value ? 0.02 : 0.09;
  screechGain.gain.setTargetAtTime(target * settings.sfx, now, smoothing);
  screechFilter.frequency.setTargetAtTime(1900 + load * 1500 + spd * 400, now, 0.05);
}

export interface TurboFrame {
  active: boolean;
  intensity: number; // 0..1 — remaining boost fraction; the rush fades with it
}

/**
 * Drive the continuous turbo whoosh. Called every frame like updateEngine: a
 * bright rushing-air roar that slams open the instant a rose boost fires and
 * sinks with the boost's remaining time, with a slow shimmer in the filter so
 * it breathes rather than droning.
 */
export function updateTurbo(frame: TurboFrame): void {
  if (!audioCtx || !turboGain || !turboFilter) return;
  const now = audioCtx.currentTime;
  const i = frame.active ? clamp(frame.intensity, 0, 1) : 0;
  turboGain.gain.setTargetAtTime(i * 0.22 * settings.sfx, now, i > 0 ? 0.03 : 0.12);
  turboFilter.frequency.setTargetAtTime(700 + i * 2600 + Math.sin(now * 9) * 200, now, 0.05);
}

export function playSfx(kind: ToneKind, intensity = 1, pitch = 1): void {
  if (!audioCtx || !sfxBus) return;
  const amp = clamp(intensity, 0.2, 2.2);
  sfxPitch = clamp(pitch, 0.5, 2.4);

  if (kind === 'rose') {
    // Bright coin/bell "bling": a two-note ding, a shimmering bell partial, and
    // a rising sparkle so a pickup lands with clear, satisfying feedback.
    pulseMusicDuck(0.58, 300);
    tone(1319, 0.05, 'square', 0.06 * amp, 0);
    tone(1760, 0.3, 'square', 0.05 * amp, 0.05);
    tone(2637, 0.34, 'sine', 0.05 * amp, 0.055); // bright bell partial
    tone(3520, 0.26, 'sine', 0.03 * amp, 0.06);
    tone(2093, 0.08, 'sine', 0.036 * amp, 0.12);
    tone(3136, 0.12, 'sine', 0.03 * amp, 0.17);
    tone(4186, 0.16, 'sine', 0.022 * amp, 0.22);
    chirp(1600, 4600, 0.2, 'triangle', 0.03 * amp, 0.05, 3800, 'bandpass');
    noise(0.05, 0.032 * amp, 9500, 'highpass', 0.04);
  } else if (kind === 'crash') {
    pulseMusicDuck(0.42, 380);
    chirp(210, 28, 0.42, 'triangle', 0.2 * amp, 0, 560, 'lowpass');
    chirp(86, 22, 0.58, 'sine', 0.16 * amp, 0.012, 210, 'lowpass');
    noise(0.36, 0.24 * amp, 620, 'lowpass', 0.006);
    noise(0.12, 0.12 * amp, 3900, 'highpass', 0.014);
    tone(43, 0.48, 'sine', 0.14 * amp, 0.018);
  } else if (kind === 'wipeout') {
    pulseMusicDuck(0.16, 1180);
    chirp(220, 24, 0.72, 'triangle', 0.26 * amp, 0, 520, 'lowpass');
    chirp(78, 18, 0.98, 'sine', 0.2 * amp, 0.02, 170, 'lowpass');
    noise(0.62, 0.26 * amp, 500, 'lowpass', 0.008);
    noise(0.28, 0.14 * amp, 2500, 'bandpass', 0.016);
    tone(37, 0.96, 'sine', 0.22 * amp, 0.018);
    tone(58, 0.48, 'sine', 0.12 * amp, 0.28);
  } else if (kind === 'skid') {
    noise(0.34, 0.14 * amp, 2600, 'bandpass', 0);
    chirp(1400, 900, 0.3, 'sawtooth', 0.03 * amp, 0.02, 1800, 'bandpass');
  } else if (kind === 'tick') {
    tone(1400, 0.05, 'square', 0.06 * amp, 0);
    noise(0.02, 0.03 * amp, 6000, 'highpass', 0);
  } else if (kind === 'milestone') {
    pulseMusicDuck(0.55, 620);
    tone(659, 0.07, 'square', 0.05 * amp, 0);
    tone(784, 0.07, 'square', 0.05 * amp, 0.075);
    tone(988, 0.07, 'square', 0.05 * amp, 0.15);
    tone(1319, 0.08, 'square', 0.052 * amp, 0.225);
    tone(1976, 0.26, 'square', 0.048 * amp, 0.305);
    tone(2637, 0.4, 'triangle', 0.04 * amp, 0.42);
    tone(165, 0.66, 'triangle', 0.05 * amp, 0);
  } else if (kind === 'overtake') {
    pulseMusicDuck(0.66, 260);
    tone(784, 0.06, 'square', 0.05 * amp, 0);
    tone(1175, 0.09, 'square', 0.05 * amp, 0.065);
    tone(1568, 0.2, 'triangle', 0.042 * amp, 0.15);
    chirp(1200, 3600, 0.22, 'sawtooth', 0.026 * amp, 0.08, 3400, 'bandpass');
  } else if (kind === 'nearMiss') {
    chirp(6800, 760, 0.13, 'sawtooth', 0.1 * amp, 0, 5600, 'highpass');
    noise(0.1, 0.09 * amp, 8200, 'highpass', 0);
    tone(78, 0.09, 'sine', 0.034 * amp, 0.016);
  } else if (kind === 'combo') {
    tone(620, 0.045, 'square', 0.042 * amp, 0);
    tone(930, 0.06, 'sine', 0.034 * amp, 0.028);
  } else if (kind === 'rev') {
    chirp(80, 260, 0.3, 'sawtooth', 0.12 * amp, 0, 900, 'lowpass');
    chirp(260, 120, 0.35, 'sawtooth', 0.1 * amp, 0.28, 700, 'lowpass');
  }

  function tone(freq: number, duration: number, type: OscillatorType, gain: number, delay: number): void {
    if (!audioCtx || !sfxBus) return;
    const osc = audioCtx.createOscillator();
    const out = audioCtx.createGain();
    const start = audioCtx.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(freq * sfxPitch, start);
    out.gain.setValueAtTime(0, start);
    out.gain.linearRampToValueAtTime(gain, start + 0.008);
    out.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(out);
    out.connect(sfxBus);
    osc.start(start);
    osc.stop(start + duration + 0.02);
    releaseNodes([osc, out], [osc], (delay + duration + 0.16) * 1000);
  }
}

// ---- voice clips (the reused "Want rose, fren?") ---------------------------

const voiceClips = new Map<string, AudioBuffer | 'loading' | 'failed'>();

export function preloadVoiceClip(url: string): void {
  if (!audioCtx || voiceClips.has(url)) return;
  voiceClips.set(url, 'loading');
  fetch(url)
    .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`voice ${r.status}`))))
    .then(bytes => audioCtx!.decodeAudioData(bytes))
    .then(buffer => voiceClips.set(url, buffer))
    .catch(() => voiceClips.set(url, 'failed'));
}

export function playVoiceClip(url: string, gain = 1): void {
  if (!audioCtx || !sfxBus) return;
  const cached = voiceClips.get(url);
  if (cached === 'failed') return;
  if (cached === undefined || cached === 'loading') {
    if (cached === undefined) preloadVoiceClip(url);
    return; // skip this trigger; next pickup will speak once decoded
  }
  pulseMusicDuck(0.42, cached.duration * 1000);
  const src = audioCtx.createBufferSource();
  const out = audioCtx.createGain();
  src.buffer = cached;
  out.gain.value = clamp(gain, 0, 2);
  src.connect(out);
  out.connect(sfxBus);
  src.start();
  releaseNodes([src, out], [src], cached.duration * 1000 + 250);
}

// ---- settings --------------------------------------------------------------

export function setMuted(value: boolean): void {
  settings.muted = value;
  saveSettings();
  rampGain(master, value ? 0 : settings.master, 80);
}
export function isMuted(): boolean {
  return settings.muted;
}
export function toggleMuted(): boolean {
  setMuted(!settings.muted);
  return settings.muted;
}
export function getMusicDestination(): AudioNode {
  getCtx();
  return musicBus!;
}
export function getMusicGain(): number {
  return settings.music;
}

function pulseMusicDuck(depth: number, totalMs = 260): void {
  if (!musicBus || !audioCtx) return;
  const baseline = settings.music;
  const ducked = baseline * clamp(depth, 0.4, 1);
  const t = audioCtx.currentTime;
  musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setValueAtTime(musicBus.gain.value, t);
  musicBus.gain.linearRampToValueAtTime(ducked, t + 0.045);
  musicBus.gain.linearRampToValueAtTime(baseline, t + Math.max(0.34, totalMs / 1000));
}

function getCtx(): AudioContext {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  audioCtx = new Ctx();

  master = audioCtx.createGain();
  master.gain.value = settings.muted ? 0 : settings.master;
  compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 22;
  compressor.ratio.value = 5.5;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;

  sfxBus = audioCtx.createGain();
  sfxBus.gain.value = settings.sfx * SFX_ARCADE_GAIN;
  musicBus = audioCtx.createGain();
  musicBus.gain.value = settings.music;

  sfxBus.connect(master);
  musicBus.connect(master);
  master.connect(compressor);
  compressor.connect(audioCtx.destination);

  engineOsc = audioCtx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineGain = audioCtx.createGain();
  engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 300;
  engineFilter.Q.value = 0.5;
  engineGain.gain.value = 0;
  engineOsc.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(sfxBus);
  engineOsc.start();

  engineSubOsc = audioCtx.createOscillator();
  engineSubOsc.type = 'sine';
  engineSubGain = audioCtx.createGain();
  engineSubGain.gain.value = 0;
  engineSubOsc.connect(engineSubGain);
  engineSubGain.connect(sfxBus);
  engineSubOsc.start();

  // Off-road rumble chain — a looping noise ROAR and a low sawtooth BUZZ, both
  // held at zero gain until updateRumble() opens them when a wheel leaves the road.
  rumbleNoiseSrc = audioCtx.createBufferSource();
  rumbleNoiseSrc.buffer = getNoiseBuffer();
  rumbleNoiseSrc.loop = true;
  rumbleNoiseFilter = audioCtx.createBiquadFilter();
  rumbleNoiseFilter.type = 'lowpass';
  rumbleNoiseFilter.frequency.value = 400;
  rumbleNoiseFilter.Q.value = 0.7;
  rumbleNoiseGain = audioCtx.createGain();
  rumbleNoiseGain.gain.value = 0;
  rumbleNoiseSrc.connect(rumbleNoiseFilter);
  rumbleNoiseFilter.connect(rumbleNoiseGain);
  rumbleNoiseGain.connect(sfxBus);
  rumbleNoiseSrc.start();

  rumbleBuzzOsc = audioCtx.createOscillator();
  rumbleBuzzOsc.type = 'sawtooth';
  rumbleBuzzOsc.frequency.value = 52;
  const rumbleBuzzFilter = audioCtx.createBiquadFilter();
  rumbleBuzzFilter.type = 'lowpass';
  rumbleBuzzFilter.frequency.value = 320;
  rumbleBuzzFilter.Q.value = 3;
  rumbleBuzzGain = audioCtx.createGain();
  rumbleBuzzGain.gain.value = 0;
  rumbleBuzzOsc.connect(rumbleBuzzFilter);
  rumbleBuzzFilter.connect(rumbleBuzzGain);
  rumbleBuzzGain.connect(sfxBus);
  rumbleBuzzOsc.start();

  // Tyre-screech chain — a looping noise source through a resonant bandpass,
  // held at zero gain until updateScreech() opens it when the bike is loaded up
  // hard in a corner.
  screechNoiseSrc = audioCtx.createBufferSource();
  screechNoiseSrc.buffer = getBrightNoiseBuffer();
  screechNoiseSrc.loop = true;
  screechFilter = audioCtx.createBiquadFilter();
  screechFilter.type = 'bandpass';
  screechFilter.frequency.value = 2400;
  screechFilter.Q.value = 6;
  screechGain = audioCtx.createGain();
  screechGain.gain.value = 0;
  screechNoiseSrc.connect(screechFilter);
  screechFilter.connect(screechGain);
  screechGain.connect(sfxBus);
  screechNoiseSrc.start();

  // Turbo-whoosh chain — bright looping noise through a wide bandpass, held at
  // zero gain until updateTurbo() opens it during a rose boost.
  turboNoiseSrc = audioCtx.createBufferSource();
  turboNoiseSrc.buffer = getBrightNoiseBuffer();
  turboNoiseSrc.loop = true;
  turboFilter = audioCtx.createBiquadFilter();
  turboFilter.type = 'bandpass';
  turboFilter.frequency.value = 900;
  turboFilter.Q.value = 0.9;
  turboGain = audioCtx.createGain();
  turboGain.gain.value = 0;
  turboNoiseSrc.connect(turboFilter);
  turboFilter.connect(turboGain);
  turboGain.connect(sfxBus);
  turboNoiseSrc.start();

  return audioCtx;
}

function chirp(from: number, to: number, duration: number, type: OscillatorType, gain: number, delay = 0, filterFreq = 0, filterType: BiquadFilterType = 'lowpass'): void {
  if (!audioCtx || !sfxBus) return;
  const now = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const out = audioCtx.createGain();
  let filter: BiquadFilterNode | null = null;
  osc.type = type;
  osc.frequency.setValueAtTime(from * sfxPitch, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to * sfxPitch), now + duration);
  out.gain.setValueAtTime(gain, now);
  out.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  if (filterFreq > 0) {
    filter = audioCtx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    filter.Q.value = filterType === 'bandpass' ? 4.8 : 0.8;
    osc.connect(filter);
    filter.connect(out);
  } else {
    osc.connect(out);
  }
  out.connect(sfxBus);
  osc.start(now);
  osc.stop(now + duration + 0.02);
  releaseNodes(filter ? [osc, filter, out] : [osc, out], [osc], (delay + duration + 0.16) * 1000);
}

function noise(duration: number, gain: number, filterFreq: number, filterType: BiquadFilterType = 'lowpass', delay = 0): void {
  if (!audioCtx || !sfxBus) return;
  const buffer = getNoiseBuffer();
  const now = audioCtx.currentTime + delay;
  const source = audioCtx.createBufferSource();
  const filter = audioCtx.createBiquadFilter();
  const out = audioCtx.createGain();
  source.buffer = buffer;
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  filter.Q.value = filterType === 'bandpass' ? 3.2 : 0.7;
  out.gain.setValueAtTime(0.0001, now);
  out.gain.linearRampToValueAtTime(gain, now + 0.006);
  out.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter);
  filter.connect(out);
  out.connect(sfxBus);
  source.start(now, 0, duration + 0.02);
  releaseNodes([source, filter, out], [source], (delay + duration + 0.16) * 1000);
}

function releaseNodes(nodes: AudioNode[], sources: AudioScheduledSourceNode[], fallbackMs: number): void {
  let live = sources.length;
  let done = false;
  const free = (): void => {
    if (done) return;
    done = true;
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        /* already detached */
      }
    }
  };
  for (const source of sources) source.addEventListener('ended', () => { live -= 1; if (live <= 0) free(); }, { once: true });
  window.setTimeout(free, Math.max(200, fallbackMs));
}

function getNoiseBuffer(): AudioBuffer {
  if (!audioCtx) throw new Error('no audio context');
  if (sharedNoiseBuffer && sharedNoiseBuffer.sampleRate === audioCtx.sampleRate) return sharedNoiseBuffer;
  const samples = Math.floor(audioCtx.sampleRate * 2);
  const buffer = audioCtx.createBuffer(1, samples, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < samples; i += 1) {
    brown = brown * 0.96 + (Math.random() * 2 - 1) * 0.06;
    data[i] = brown;
  }
  sharedNoiseBuffer = buffer;
  return buffer;
}

// A brighter (near-white) noise buffer for the tyre screech — the brown buffer
// above has almost no energy up at the ~2.4 kHz screech band, so it would filter
// to near-silence. This keeps plenty of high end for the bandpass to grab.
let sharedBrightBuffer: AudioBuffer | null = null;
function getBrightNoiseBuffer(): AudioBuffer {
  if (!audioCtx) throw new Error('no audio context');
  if (sharedBrightBuffer && sharedBrightBuffer.sampleRate === audioCtx.sampleRate) return sharedBrightBuffer;
  const samples = Math.floor(audioCtx.sampleRate * 2);
  const buffer = audioCtx.createBuffer(1, samples, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < samples; i += 1) {
    const white = Math.random() * 2 - 1;
    // Gently high-pass-tilted noise (emphasise the change between samples) so the
    // screech reads as a bright rubber squeal rather than a dull hiss.
    data[i] = (white - last) * 0.7 + white * 0.3;
    last = white;
  }
  sharedBrightBuffer = buffer;
  return buffer;
}

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      master: clamp(typeof p.master === 'number' ? p.master : DEFAULTS.master, 0, 1),
      music: clamp(typeof p.music === 'number' ? p.music : DEFAULTS.music, 0, 1),
      sfx: clamp(typeof p.sfx === 'number' ? p.sfx : DEFAULTS.sfx, 0, 1),
      muted: typeof p.muted === 'boolean' ? p.muted : DEFAULTS.muted,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode — runtime audio still works */
  }
}

function rampGain(node: GainNode | null, target: number, ms = 60): void {
  if (!node || !audioCtx) return;
  const t = audioCtx.currentTime;
  node.gain.cancelScheduledValues(t);
  node.gain.setValueAtTime(node.gain.value, t);
  node.gain.linearRampToValueAtTime(target, t + ms / 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
