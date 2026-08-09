import type { CarConfig } from "../../util/cars/index.js";
import { EngineTone } from "./engineTone.js";
import { EngineCharacter, brightnessFor, detuneFor, saturationFor, highRpmOscLevelFor } from "./engineCharacter.js";
import { ShiftTransient } from "./shiftTransient.js";
import { Overrun } from "./overrun.js";

/**
 * A synthesized engine tone (Web Audio, no audio assets), pitched directly
 * by engine RPM (see Player.rpm / util/engineModel.ts). Player.rpm itself
 * already models the interesting behavior — the limiter's rapid bounce, and
 * an aggressive downshift briefly screaming above redline before settling —
 * so this stays mostly a function of (rpm, throttle, gear): it renders that
 * signal plus its own shift/lift-off events, no gearbox simulation here.
 * Frequency is scaled against MAX_TRANSMISSION_RPM (not REDLINE_RPM) so that
 * scream has real pitch headroom above the normal redline whine.
 * Starts lazily on the first user gesture, since browsers block audio until
 * then regardless of when the AudioContext is constructed.
 *
 * Every timbre/behavior constant comes from the CarConfig passed to the
 * constructor (CarConfig.sound) — a different car can have a different
 * voice, not just a different RPM range. Fixed at construction (the audio
 * graph's topology doesn't change per-frame); swapping cars means
 * constructing a new EngineSound, same as Player.
 *
 * Layered as continuous state vs. one-off events, chained in series:
 *   EngineTone (oscillators + filter, pitched by RPM)
 *     -> EngineCharacter (idle wobble + limiter flutter, continuous)
 *     -> Overrun (lift-off gain/filter dip, event-triggered decay)
 *     -> ShiftTransient (gain duck, event-triggered)
 *     -> main gain (RPM/throttle loudness, continuous)
 *     -> master gain (the actual mute switch, see setEnabled)
 *     -> destination
 * Shift thumps/blips and the overrun noise tail are separate short-lived
 * nodes mixed in past their own layer (so they aren't ducked/dipped by the
 * very event that triggered them) but still through masterGain, not
 * straight to destination — otherwise muting only silences the continuous
 * tone and shift/overrun sounds keep playing regardless of setEnabled.
 */
export class EngineSound {
  private readonly car: CarConfig;
  private ctx: AudioContext | null = null;
  private mainGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private tone: EngineTone | null = null;
  private character: EngineCharacter | null = null;
  private overrun: Overrun | null = null;
  private shift: ShiftTransient | null = null;
  private enabled = true;
  private lastGear: number | null = null; // null until the first update() call establishes a baseline

  constructor(car: CarConfig) {
    this.car = car;
    const start = (): void => {
      window.removeEventListener("keydown", start);
      window.removeEventListener("pointerdown", start);
      this.init();
    };
    window.addEventListener("keydown", start);
    window.addEventListener("pointerdown", start);
  }

  private init(): void {
    const sound = this.car.sound;
    const ctx = new AudioContext();
    const masterGain = ctx.createGain();
    masterGain.gain.value = this.enabled ? 1 : 0;
    masterGain.connect(ctx.destination);

    const tone = new EngineTone(ctx, sound.tone);
    const character = new EngineCharacter(ctx, sound);
    const overrun = new Overrun(ctx, masterGain, sound.overrun);
    const shift = new ShiftTransient(ctx, masterGain, sound.shift);
    const mainGain = ctx.createGain();
    mainGain.gain.value = 0;

    tone.output.connect(character.input);
    character.output.connect(overrun.input);
    overrun.output.connect(shift.input);
    shift.output.connect(mainGain);
    mainGain.connect(masterGain);

    this.ctx = ctx;
    this.tone = tone;
    this.character = character;
    this.overrun = overrun;
    this.shift = shift;
    this.mainGain = mainGain;
    this.masterGain = masterGain;
  }

  /** Mutes/unmutes without losing pitch sync (e.g. a debug-panel toggle) — the single master switch every sound (continuous tone, shift transients, overrun noise) routes through. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(enabled ? 1 : 0, this.ctx.currentTime, 0.02);
    }
  }

  /** Call once per frame with the car's current engine RPM, whether the throttle is held, and the current gear (Player.gear: -1 reverse, 0 neutral, 1-5). */
  update(rpm: number, throttleOn: boolean, gear: number): void {
    if (!this.ctx || !this.mainGain || !this.tone || !this.character || !this.overrun || !this.shift) return;

    if (this.lastGear === null) {
      this.lastGear = gear;
    } else if (gear !== this.lastGear) {
      this.shift.trigger(gear < this.lastGear, this.ctx.currentTime);
      this.lastGear = gear;
    }

    const car = this.car;
    const sound = car.sound;
    const now = this.ctx.currentTime;
    const neutral = gear === 0;
    const engaged = gear !== 0;
    const rpmFraction = Math.max(0, Math.min(1, (rpm - car.idleRpm) / (car.maxTransmissionRpm - car.idleRpm)));
    const limiterOn = rpm >= car.redlineRpm;

    const pitchTau = neutral ? sound.neutral.pitchTau : sound.smoothingTau;
    this.tone.setPitch(rpmFraction, now, pitchTau);
    const detune = detuneFor(rpmFraction, sound) + (neutral ? sound.neutral.detuneBonusCents : 0);
    this.tone.setDetune(detune, now, pitchTau);
    this.tone.setHighRpmLevel(highRpmOscLevelFor(rpmFraction, sound), now, sound.smoothingTau);
    this.tone.setSaturation(saturationFor(rpmFraction, sound), now, sound.smoothingTau);

    const brightness = brightnessFor(rpmFraction, sound);
    const throttleBrightness = throttleOn ? sound.brightness.throttleBrightnessHz * brightness : 0;
    const limiterBrightness = limiterOn ? sound.limiter.brightnessHz : 0;
    const neutralBrightness = neutral ? sound.neutral.filterBonusHz : 0;
    const highRpmBoost =
      Math.max(0, rpmFraction - sound.brightness.highRpmBoostStartFraction) / (1 - sound.brightness.highRpmBoostStartFraction);
    const highRpmBrightness = highRpmBoost * sound.brightness.highRpmExtraBrightnessHz;
    const filterTarget =
      sound.brightness.filterHzBase +
      brightness * sound.brightness.filterHzRange +
      throttleBrightness +
      limiterBrightness +
      neutralBrightness +
      highRpmBrightness;
    this.tone.setFilterHz(filterTarget, now, sound.smoothingTau);

    this.character.update(rpmFraction, throttleOn, limiterOn, now);
    this.overrun.update(throttleOn, rpmFraction, engaged, now);

    const gainBase = throttleOn ? sound.gain.throttleBase : sound.gain.coastingBase;
    const gainRange = throttleOn ? sound.gain.throttleRange : sound.gain.coastingRange;
    let levelGain = gainBase + rpmFraction * gainRange;
    if (limiterOn) levelGain *= sound.limiter.gainBoost;
    if (neutral) levelGain *= sound.neutral.gainMult;
    this.mainGain.gain.setTargetAtTime(levelGain, now, sound.smoothingTau);
  }
}
