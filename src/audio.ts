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

const STORAGE_KEY = 'hangonfren:audio:v2';
const LEGACY_STORAGE_KEY = 'hangonfren:audio:v1';
// Keep the bed out of the way and let one-shot game feedback land clearly.
// The vehicle bus is deliberately quieter still: it runs continuously, while
// pickups, crashes and tyre squeal are allowed to jump forward in the mix.
const DEFAULTS: AudioSettings = { master: 0.78, music: 0.32, sfx: 1, muted: false };
const SFX_ARCADE_GAIN = 1.45;
const VEHICLE_MIX_GAIN = 0.68;

let audioCtx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let vehicleBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let engineOsc: OscillatorNode | null = null;
let engineGain: GainNode | null = null;
let engineFilter: BiquadFilterNode | null = null;
let engineSubOsc: OscillatorNode | null = null;
let engineSubGain: GainNode | null = null;
let engineSubFilter: BiquadFilterNode | null = null;
let engineNoiseSrc: AudioBufferSourceNode | null = null;
let engineNoiseGain: GainNode | null = null;
let engineNoiseFilter: BiquadFilterNode | null = null;
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
let screechWhineFilter: BiquadFilterNode | null = null;
let screechWhineGain: GainNode | null = null;
let screechToneOsc: OscillatorNode | null = null;
let screechToneGain: GainNode | null = null;
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

// ---- gearbox ---------------------------------------------------------------
// The engine's TIMBRE (the two-stroke firing pulse, its harmonic ladder and the
// exhaust rasp below) is left exactly as it was — it is good. What it lacked was
// STRUCTURE: revs slid in one unbroken line from idle to top speed, which is a
// slide whistle, not a machine. Real speed is sold by a LADDER — the note climbs,
// drops on a shift, and climbs again — and that ladder is also the only reason a
// rev limiter or a downshift can exist as sounds at all. So the note is now
// driven by revs-within-a-gear rather than by road speed directly.
//
// Top of each gear as a fraction of base top speed. The bands widen as they go,
// so the low cogs snap through and top gear is the long, screaming one.
const GEAR_TOPS = [0.2, 0.36, 0.53, 0.7, 0.86, 1] as const;
const GEARS = GEAR_TOPS.length;
const SHIFT_TIME = 0.13; // seconds the clutch is out and the note dips
const DOWNSHIFT_GAP = 0.03; // hysteresis, so a gear boundary can't flap

let gear = 0;
let shiftUntil = 0;

function gearFloor(g: number): number {
  return g === 0 ? 0 : GEAR_TOPS[g - 1];
}

/** The mechanical thunk of a cog going home — brighter up, heavier down. */
function shiftClunk(up: boolean): void {
  sfxPitch = 1;
  noise(0.05, 0.04 * SFX_ARCADE_GAIN, up ? 2600 : 1700, 'bandpass', 0);
  chirp(up ? 300 : 170, up ? 165 : 290, 0.09, 'sawtooth', 0.035, 0.004, 900, 'lowpass');
}

/** Reset the box to first — call when a run starts, so it never begins in top. */
export function resetGearbox(): void {
  gear = 0;
  shiftUntil = 0;
}

/** Which gear the box is in (1-based), for the HUD. */
export function currentGear(): number {
  return gear + 1;
}

export interface EngineFrame {
  playing: boolean;
  /**
   * Speed as a fraction of the BASE top speed — deliberately NOT of the current
   * maxSpeed, which a turbo raises. Normalising against a moving ceiling would
   * make a boost read as *lower* revs and drop a gear at the exact moment the
   * bike lunges. Here a boost pushes past 1 and the engine screams into its
   * limiter instead, which is what a boost should sound like.
   */
  speed: number;
  throttle: number; // 0..1
}

export function updateEngine(frame: EngineFrame): void {
  if (!audioCtx || !engineOsc || !engineGain || !engineFilter || !engineSubOsc || !engineSubGain ||
      !engineSubFilter || !engineNoiseGain || !engineNoiseFilter) return;
  const now = audioCtx.currentTime;
  const speed = clamp(frame.speed, 0, 1.3);
  const throttle = clamp(frame.throttle, 0, 1);

  // Pick the cog. Shifting up at the top of a band and back down a little below
  // its floor gives the hysteresis that stops a boundary chattering.
  let next = gear;
  if (speed > GEAR_TOPS[gear] && gear < GEARS - 1) next = gear + 1;
  else if (gear > 0 && speed < gearFloor(gear) - DOWNSHIFT_GAP) next = gear - 1;
  if (next !== gear) {
    const up = next > gear;
    gear = next;
    shiftUntil = now + SHIFT_TIME;
    if (frame.playing) shiftClunk(up);
  }

  // Revs WITHIN the cog: this is the ladder. Each upshift drops the note back to
  // the bottom of the band and it climbs again.
  const lo = gearFloor(gear);
  const hi = GEAR_TOPS[gear];
  const rpm = clamp(0.3 + 0.7 * ((speed - lo) / Math.max(0.01, hi - lo)), 0, 1.25);

  const moving = clamp(clamp(speed, 0, 1) * 0.78 + throttle * 0.28, 0, 1);
  // A Vespa's two-stroke note is a low firing pulse with a thick ladder of
  // harmonics and ragged exhaust noise. Keep the firing rate below the old
  // synth-like whine, then open the resonances and rasp as revs rise.
  const flutter = Math.sin(now * 5.3) * (1.2 + moving * 2.8) + Math.sin(now * 13.7) * (0.5 + throttle * 1.8);
  const firingRate = 48 + rpm * 116 + throttle * 22 + flutter;
  // Past the top of top gear (only reachable on a turbo) the limiter bounces off
  // the stop — a hard, fast flutter, not a smooth climb.
  const limiter = rpm > 1 ? 0.6 + 0.4 * Math.sin(now * 96) : 1;
  const dip = now < shiftUntil ? 0.34 : 1; // clutch out: the note falls away
  const level = frame.playing ? (0.052 + moving * 0.105 + throttle * 0.018) * dip * limiter : 0;
  engineOsc.frequency.setTargetAtTime(firingRate, now, 0.035);
  engineFilter.frequency.setTargetAtTime(720 + rpm * 1700 + throttle * 420, now, 0.06);
  engineFilter.Q.setTargetAtTime(1.15 + moving * 0.65, now, 0.08);
  engineGain.gain.setTargetAtTime(level, now, 0.04);

  // Half-rate crankcase thump gives the exhaust pulse some body without the
  // oversized sub-bass drone the previous engine carried. It tracks ROAD speed,
  // not revs, so the bottom end stays planted through a shift instead of dropping
  // out from under the bike along with the note.
  engineSubOsc.frequency.setTargetAtTime(Math.max(24, (48 + clamp(speed, 0, 1) * 112) * 0.5), now, 0.065);
  engineSubFilter.frequency.setTargetAtTime(150 + moving * 160, now, 0.08);
  engineSubGain.gain.setTargetAtTime(frame.playing ? 0.012 + moving * 0.03 : 0, now, 0.07);

  // Filtered noise supplies the breathy, metallic two-stroke rasp visible in
  // the reference spectrum between the main exhaust harmonics.
  engineNoiseFilter.frequency.setTargetAtTime(620 + rpm * 1900 + throttle * 380, now, 0.055);
  engineNoiseGain.gain.setTargetAtTime(frame.playing ? (0.007 + moving * 0.032 + throttle * 0.012) * dip : 0, now, 0.06);
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
  const roar = i * (0.08 + spd * 0.22);
  rumbleNoiseGain.gain.setTargetAtTime(roar, now, 0.05);
  rumbleNoiseFilter.frequency.setTargetAtTime(340 + i * 480 + spd * 620, now, 0.08);
  // Buzz: the rumble-strip corrugation whir, pitch climbing with speed. Needs
  // both off-road AND motion, so a stationary drift off the edge won't drone.
  const buzz = i * spd * 0.06;
  rumbleBuzzGain.gain.setTargetAtTime(buzz, now, 0.06);
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
  if (!audioCtx || !screechGain || !screechFilter || !screechWhineGain ||
      !screechWhineFilter || !screechToneGain || !screechToneOsc) return;
  const now = audioCtx.currentTime;
  const load = frame.active ? clamp(frame.load, 0, 1) : 0;
  const spd = clamp(frame.speed, 0, 1);
  // Rubber squeal has a broad scrub, a narrow resonant whine, and a small tonal
  // edge. Their pitches wander independently so a held turn never becomes a
  // static band of hiss. Speed gates the sound at a crawl.
  const speedGate = clamp((spd - 0.2) / 0.58, 0, 1);
  const chatter = 0.9 + Math.sin(now * 12.3) * 0.06 + Math.sin(now * 21.7) * 0.04;
  const body = Math.pow(load, 1.35) * speedGate * (0.08 + spd * 0.15) * chatter;
  const whine = Math.pow(load, 1.9) * speedGate * (0.018 + spd * 0.072);
  const tone = Math.pow(load, 2.3) * speedGate * (0.008 + spd * 0.022);
  const smoothing = body > screechGain.gain.value ? 0.018 : 0.085;
  screechGain.gain.setTargetAtTime(body, now, smoothing);
  screechFilter.frequency.setTargetAtTime(1050 + load * 650 + spd * 420 + Math.sin(now * 8.7) * 70, now, 0.045);
  screechWhineGain.gain.setTargetAtTime(whine, now, whine > screechWhineGain.gain.value ? 0.014 : 0.075);
  screechWhineFilter.frequency.setTargetAtTime(2350 + load * 1050 + spd * 520 + Math.sin(now * 15.1) * 120, now, 0.035);
  screechToneGain.gain.setTargetAtTime(tone, now, tone > screechToneGain.gain.value ? 0.012 : 0.07);
  screechToneOsc.frequency.setTargetAtTime(1680 + load * 720 + spd * 380 + Math.sin(now * 17.3) * 55, now, 0.035);
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
  turboGain.gain.setTargetAtTime(i * 0.16, now, i > 0 ? 0.03 : 0.12);
  turboFilter.frequency.setTargetAtTime(700 + i * 2600 + Math.sin(now * 9) * 200, now, 0.05);
}

/**
 * A car tearing past. Two things sell it, and neither is the noise itself:
 *
 *  DOPPLER — the pitch drops as the car stops closing and starts receding. A
 *  whoosh at constant pitch reads as a sound effect; a whoosh that falls reads as
 *  an object with momentum going somewhere.
 *
 *  PAN — it goes past on the side it actually went past on, and keeps travelling
 *  outward as it goes, so the stereo image sweeps rather than sits.
 *
 * `side` is the car's lateral offset from the bike (negative = it went by on your
 * left); `intensity` is how fast you took it and how close you came.
 */
export function playPassBy(side: number, intensity = 1): void {
  if (!audioCtx || !sfxBus) return;
  const amp = clamp(intensity, 0.15, 1.6);
  const now = audioCtx.currentTime;
  const dur = 0.42;
  const pan = clamp(side * 1.6, -0.95, 0.95);

  const src = audioCtx.createBufferSource();
  src.buffer = getBrightNoiseBuffer();
  const band = audioCtx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.1;
  // The Doppler drop: closing → receding, about a fifth down.
  const f0 = 1500 + amp * 900;
  band.frequency.setValueAtTime(f0, now);
  band.frequency.exponentialRampToValueAtTime(f0 * 0.55, now + dur);

  const panner = audioCtx.createStereoPanner();
  panner.pan.setValueAtTime(pan * 0.5, now);
  panner.pan.linearRampToValueAtTime(pan, now + dur); // keeps travelling outward

  const out = audioCtx.createGain();
  out.gain.setValueAtTime(0.0001, now);
  out.gain.linearRampToValueAtTime(0.13 * amp, now + 0.05); // it arrives fast
  out.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  src.connect(band);
  band.connect(panner);
  panner.connect(out);
  out.connect(sfxBus);
  src.start(now, 0, dur + 0.02);
  releaseNodes([src, band, panner, out], [src], (dur + 0.2) * 1000);
}

// ---- tunnel echo ------------------------------------------------------------
// A tunnel you can see but not HEAR is a painted backdrop. The moment the walls
// close in, your own engine should come back at you off the tiles — that returning
// slap is most of what makes the space feel real, and it is the thing you notice
// the instant you burst back out into the open and it stops.
//
// A feedback delay tapped off the vehicle bus, held shut at zero gain outside.
// Cheap where a convolution reverb would not be: this runs on phones.

let echoDelay: DelayNode | null = null;
let echoFeedback: GainNode | null = null;
let echoDamp: BiquadFilterNode | null = null;
let echoSend: GainNode | null = null;

export interface EnclosureFrame {
  /** 0 out in the open … 1 deep under a tunnel. */
  amount: number;
}

export function updateEcho(frame: EnclosureFrame): void {
  if (!audioCtx || !echoSend || !echoFeedback || !echoDamp) return;
  const now = audioCtx.currentTime;
  const a = clamp(frame.amount, 0, 1);
  // Opens fast (the wall arrives) and closes fast (daylight) — a slow release
  // would smear the echo out across the road beyond the exit.
  echoSend.gain.setTargetAtTime(a * 0.4 * settings.sfx, now, 0.08);
  // A bigger space rings longer; the returning sound is also duller, because the
  // top end is what the concrete eats first.
  echoFeedback.gain.setTargetAtTime(0.22 + a * 0.3, now, 0.12);
  echoDamp.frequency.setTargetAtTime(1500 + a * 900, now, 0.12);
}

// ---- traffic engines --------------------------------------------------------
// Until now the traffic was silent right up to the instant it went past, at which
// point a whoosh appeared out of nowhere. Cars you are hunting down should be
// AUDIBLE while you hunt them — you should hear the van you are about to come up
// behind, and hear which side it is on, before you can pick it out of the haze.
//
// A small pool of voices, keyed on Car.id. The pool is deliberately tiny: four
// engines is already a busy-sounding road, and every extra voice is a permanent
// oscillator burning CPU on a phone.

const TRAFFIC_VOICES = 4;

interface TrafficVoice {
  /** Which car this voice is currently being, or null when idle. */
  carId: number | null;
  osc: OscillatorNode;
  /** Detuned second saw — one oscillator alone reads as a synth, not an engine. */
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  gain: GainNode;
}

let trafficVoices: TrafficVoice[] = [];

function buildTrafficVoices(ctx: AudioContext, out: AudioNode): TrafficVoice[] {
  const voices: TrafficVoice[] = [];
  for (let i = 0; i < TRAFFIC_VOICES; i += 1) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.detune.value = 14; // a few cents apart: beating gives it a rough idle
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 1.4;
    const panner = ctx.createStereoPanner();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(panner);
    panner.connect(gain);
    gain.connect(out);
    osc.start();
    osc2.start();
    voices.push({ carId: null, osc, osc2, filter, panner, gain });
  }
  return voices;
}

/** One car as the mixer needs it — see world.ts `audibleTraffic`. */
export interface TrafficSoundFrame {
  id: number;
  proximity: number; // 0..1
  pan: number; // -1..1
  rpm: number; // 0..1
  closing: number; // 0..1
}

/**
 * Drive the traffic engines. Called every frame like the player's own engine.
 *
 * Voices are matched to cars BY ID and held there. Re-allocating by proximity
 * rank each frame would be simpler and would sound broken: two cars swapping
 * places in the sort order would swap their engines with them, and a machine
 * would appear to change pitch instantly for no reason the player can see.
 */
export function updateTraffic(cars: readonly TrafficSoundFrame[]): void {
  if (!audioCtx || !trafficVoices.length) return;
  const now = audioCtx.currentTime;

  // Hold every voice that is still following a car we can hear.
  const live = new Set(cars.map(c => c.id));
  for (const voice of trafficVoices) {
    if (voice.carId !== null && !live.has(voice.carId)) voice.carId = null;
  }

  for (const car of cars) {
    let voice = trafficVoices.find(v => v.carId === car.id);
    if (!voice) {
      voice = trafficVoices.find(v => v.carId === null);
      if (!voice) continue; // pool full — this car is quieter than four others
      voice.carId = car.id;
      // Start the new voice silent: fading it in from zero is what stops a car
      // entering earshot from arriving as a click.
      voice.gain.gain.setValueAtTime(0, now);
    }
    // Doppler: a car you are closing on is coming at you, so its note rides up.
    const doppler = 1 + car.closing * 0.22;
    const base = (58 + car.rpm * 120) * doppler;
    voice.osc.frequency.setTargetAtTime(base, now, 0.06);
    voice.osc2.frequency.setTargetAtTime(base * 1.5, now, 0.06); // a fifth up: body
    // Distant engines are muffled by the air between you; they open up as they close.
    voice.filter.frequency.setTargetAtTime(240 + car.rpm * 520 + car.proximity * 900, now, 0.08);
    voice.panner.pan.setTargetAtTime(car.pan, now, 0.05);
    voice.gain.gain.setTargetAtTime(car.proximity * car.proximity * 0.2 * settings.sfx, now, 0.07);
  }

  // Anything not following a car fades out rather than cutting.
  for (const voice of trafficVoices) {
    if (voice.carId === null) voice.gain.gain.setTargetAtTime(0, now, 0.12);
  }
}

/** Cut every traffic engine — new run, pause, title screen. */
export function silenceTraffic(): void {
  updateTraffic([]);
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
  compressor.threshold.value = -14;
  compressor.knee.value = 18;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;

  sfxBus = audioCtx.createGain();
  sfxBus.gain.value = settings.sfx * SFX_ARCADE_GAIN;
  vehicleBus = audioCtx.createGain();
  vehicleBus.gain.value = settings.sfx * VEHICLE_MIX_GAIN;
  musicBus = audioCtx.createGain();
  musicBus.gain.value = settings.music;

  sfxBus.connect(master);
  vehicleBus.connect(master);
  musicBus.connect(master);
  // Traffic engines ride the vehicle bus alongside the player's own, so the
  // whole road is balanced against the music as one thing.
  trafficVoices = buildTrafficVoices(audioCtx, vehicleBus);

  // Tunnel echo: a damped feedback delay tapped off the whole vehicle bus (your
  // engine, the traffic, the tyres — everything a wall would bounce back), held
  // shut until updateEcho opens it. It returns to MASTER, not back into the
  // vehicle bus: feeding it back into its own source is a runaway loop.
  echoSend = audioCtx.createGain();
  echoSend.gain.value = 0;
  echoDelay = audioCtx.createDelay(0.5);
  echoDelay.delayTime.value = 0.11; // a slap, not a cavern
  echoFeedback = audioCtx.createGain();
  echoFeedback.gain.value = 0.25;
  echoDamp = audioCtx.createBiquadFilter();
  echoDamp.type = 'lowpass';
  echoDamp.frequency.value = 1800;
  vehicleBus.connect(echoSend);
  echoSend.connect(echoDelay);
  echoDelay.connect(echoDamp);
  echoDamp.connect(echoFeedback);
  echoFeedback.connect(echoDelay); // the tail
  echoDamp.connect(master);
  master.connect(compressor);
  compressor.connect(audioCtx.destination);

  engineOsc = audioCtx.createOscillator();
  engineOsc.setPeriodicWave(createVespaWave(audioCtx));
  engineGain = audioCtx.createGain();
  engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 760;
  engineFilter.Q.value = 1.15;
  engineGain.gain.value = 0;
  engineOsc.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(vehicleBus);
  engineOsc.start();

  engineSubOsc = audioCtx.createOscillator();
  engineSubOsc.type = 'triangle';
  engineSubGain = audioCtx.createGain();
  engineSubFilter = audioCtx.createBiquadFilter();
  engineSubFilter.type = 'lowpass';
  engineSubFilter.frequency.value = 150;
  engineSubFilter.Q.value = 0.7;
  engineSubGain.gain.value = 0;
  engineSubOsc.connect(engineSubFilter);
  engineSubFilter.connect(engineSubGain);
  engineSubGain.connect(vehicleBus);
  engineSubOsc.start();

  engineNoiseSrc = audioCtx.createBufferSource();
  engineNoiseSrc.buffer = getBrightNoiseBuffer();
  engineNoiseSrc.loop = true;
  engineNoiseFilter = audioCtx.createBiquadFilter();
  engineNoiseFilter.type = 'bandpass';
  engineNoiseFilter.frequency.value = 620;
  engineNoiseFilter.Q.value = 0.9;
  engineNoiseGain = audioCtx.createGain();
  engineNoiseGain.gain.value = 0;
  engineNoiseSrc.connect(engineNoiseFilter);
  engineNoiseFilter.connect(engineNoiseGain);
  engineNoiseGain.connect(vehicleBus);
  engineNoiseSrc.start();

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
  rumbleNoiseGain.connect(vehicleBus);
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
  rumbleBuzzGain.connect(vehicleBus);
  rumbleBuzzOsc.start();

  // Tyre-screech chain — one bright noise source feeds a wide rubber scrub and
  // a narrower resonant squeal; a quiet triangle supplies the pitched edge.
  screechNoiseSrc = audioCtx.createBufferSource();
  screechNoiseSrc.buffer = getBrightNoiseBuffer();
  screechNoiseSrc.loop = true;
  screechFilter = audioCtx.createBiquadFilter();
  screechFilter.type = 'bandpass';
  screechFilter.frequency.value = 1200;
  screechFilter.Q.value = 2.2;
  screechGain = audioCtx.createGain();
  screechGain.gain.value = 0;
  screechNoiseSrc.connect(screechFilter);
  screechFilter.connect(screechGain);
  screechGain.connect(sfxBus);

  screechWhineFilter = audioCtx.createBiquadFilter();
  screechWhineFilter.type = 'bandpass';
  screechWhineFilter.frequency.value = 2600;
  screechWhineFilter.Q.value = 9;
  screechWhineGain = audioCtx.createGain();
  screechWhineGain.gain.value = 0;
  screechNoiseSrc.connect(screechWhineFilter);
  screechWhineFilter.connect(screechWhineGain);
  screechWhineGain.connect(sfxBus);

  screechToneOsc = audioCtx.createOscillator();
  screechToneOsc.type = 'triangle';
  screechToneOsc.frequency.value = 1800;
  screechToneGain = audioCtx.createGain();
  screechToneGain.gain.value = 0;
  screechToneOsc.connect(screechToneGain);
  screechToneGain.connect(sfxBus);
  screechNoiseSrc.start();
  screechToneOsc.start();

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

/** Dense, asymmetric exhaust harmonics rather than a mathematically clean saw. */
function createVespaWave(ctx: AudioContext): PeriodicWave {
  const real = new Float32Array([0, 1, 0.82, 0.61, 0.48, 0.36, 0.29, 0.23, 0.18, 0.14, 0.11, 0.09, 0.07, 0.05]);
  const imag = new Float32Array([0, 0, 0.16, -0.12, 0.1, -0.08, 0.07, -0.06, 0.05, -0.04, 0.035, -0.03, 0.025, -0.02]);
  return ctx.createPeriodicWave(real, imag);
}

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Preserve only the user's mute choice across the v2 rebalance. Carrying
      // the old gain defaults forward would defeat the quieter new mix.
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacy) return { ...DEFAULTS };
      const previous = JSON.parse(legacy) as Partial<AudioSettings>;
      return { ...DEFAULTS, muted: typeof previous.muted === 'boolean' ? previous.muted : DEFAULTS.muted };
    }
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
