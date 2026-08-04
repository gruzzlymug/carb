import { IDLE_RPM, MAX_TRANSMISSION_RPM } from "../util/constants.js";

const IDLE_HZ = 55;
const REDLINE_HZ = 380;
const DETUNE_CENTS = 12; // slight detune between the two oscillators for a fuller, grittier tone

// Volume/tone scale with both RPM and throttle: an engine under load
// (throttle on) is louder and brighter than the same RPM while coasting
// or engine-braking, so redline+throttle reads as a distinct "shift!"
// cue rather than just a pitch.
const GAIN_COASTING_BASE = 0.02;
const GAIN_COASTING_RANGE = 0.03;
const GAIN_THROTTLE_BASE = 0.06;
const GAIN_THROTTLE_RANGE = 0.08;
const FILTER_HZ_BASE = 500;
const FILTER_HZ_RANGE = 2500;

/** Time constant for the pitch/gain smoothing — fast enough to keep the redline limiter's rapid RPM bounce audible as a warble, slow enough not to sound jumpy during normal driving. */
const SMOOTHING_TAU = 0.035;

/**
 * A synthesized engine tone (Web Audio, no audio assets): two detuned
 * sawtooth oscillators through a lowpass filter, pitched directly by
 * engine RPM (see Player.rpm / util/engineModel.ts). Player.rpm itself
 * already models the interesting behavior — the limiter's rapid bounce,
 * and an aggressive downshift briefly screaming above redline before
 * settling — so this stays a pure, simple function of (rpm, throttle):
 * no shift-event detection needed here, just render the signal.
 * Frequency is scaled against MAX_TRANSMISSION_RPM (not REDLINE_RPM) so
 * that scream has real pitch headroom above the normal redline whine.
 * Starts lazily on the first user gesture, since browsers block audio
 * until then regardless of when the AudioContext is constructed.
 */
export class EngineSound {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private oscillatorA: OscillatorNode | null = null;
  private oscillatorB: OscillatorNode | null = null;
  private enabled = true;

  constructor() {
    const start = (): void => {
      window.removeEventListener("keydown", start);
      window.removeEventListener("pointerdown", start);
      this.init();
    };
    window.addEventListener("keydown", start);
    window.addEventListener("pointerdown", start);
  }

  private init(): void {
    const ctx = new AudioContext();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = FILTER_HZ_BASE;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    const oscA = ctx.createOscillator();
    oscA.type = "sawtooth";
    oscA.frequency.value = IDLE_HZ;

    const oscB = ctx.createOscillator();
    oscB.type = "sawtooth";
    oscB.detune.value = DETUNE_CENTS;
    oscB.frequency.value = IDLE_HZ;

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    oscA.start();
    oscB.start();

    this.ctx = ctx;
    this.gainNode = gain;
    this.filterNode = filter;
    this.oscillatorA = oscA;
    this.oscillatorB = oscB;
  }

  /** Mutes/unmutes without losing pitch sync (e.g. a debug-panel toggle). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Call once per frame with the car's current engine RPM and whether the throttle is held. */
  update(rpm: number, throttleOn: boolean): void {
    if (!this.ctx || !this.gainNode || !this.filterNode || !this.oscillatorA || !this.oscillatorB) return;

    const rpmFraction = Math.max(0, Math.min(1, (rpm - IDLE_RPM) / (MAX_TRANSMISSION_RPM - IDLE_RPM)));
    const freq = IDLE_HZ + rpmFraction * (REDLINE_HZ - IDLE_HZ);
    const now = this.ctx.currentTime;
    this.oscillatorA.frequency.setTargetAtTime(freq, now, SMOOTHING_TAU);
    this.oscillatorB.frequency.setTargetAtTime(freq, now, SMOOTHING_TAU);
    this.filterNode.frequency.setTargetAtTime(FILTER_HZ_BASE + rpmFraction * FILTER_HZ_RANGE, now, SMOOTHING_TAU);

    const gainBase = throttleOn ? GAIN_THROTTLE_BASE : GAIN_COASTING_BASE;
    const gainRange = throttleOn ? GAIN_THROTTLE_RANGE : GAIN_COASTING_RANGE;
    const targetGain = this.enabled ? gainBase + rpmFraction * gainRange : 0;
    this.gainNode.gain.setTargetAtTime(targetGain, now, SMOOTHING_TAU);
  }
}
