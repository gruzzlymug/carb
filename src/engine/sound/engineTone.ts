import type { CarSoundConfig } from "../../util/cars/index.js";

const SATURATION_CURVE_SAMPLES = 1024;

/** Builds a fixed, mild soft-clip curve for the saturation WaveShaperNode. Saturation *amount* is controlled by driving more signal into this fixed curve (via driveGain), not by regenerating it. */
function buildSoftClipCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(SATURATION_CURVE_SAMPLES * Float32Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < SATURATION_CURVE_SAMPLES; i++) {
    const x = (i / (SATURATION_CURVE_SAMPLES - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.5);
  }
  return curve;
}

/**
 * The raw instrument: two detuned sawtooth oscillators plus a third
 * square-wave oscillator (faded in only near redline, for a sharper
 * high-RPM edge distinct from the saws' harmonics), through a shared
 * lowpass filter and a mild saturation stage. Knows nothing about RPM,
 * throttle, shifting, or gears — it just exposes pitch/detune/filter/
 * saturation/high-RPM-level as continuous parameters for EngineCharacter
 * (and the EngineSound orchestrator) to drive. `idleHz`/`redlineHz` (the
 * pitch range) and `saturationDriveRange` come from the active car's
 * CarConfig.sound.tone, so a different car can have a different voice.
 */
export class EngineTone {
  readonly output: AudioNode;
  private readonly idleHz: number;
  private readonly redlineHz: number;
  private readonly saturationDriveRange: number;
  private readonly oscillatorA: OscillatorNode;
  private readonly oscillatorB: OscillatorNode;
  private readonly oscillatorC: OscillatorNode;
  private readonly oscillatorCGain: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly driveGain: GainNode;

  constructor(ctx: AudioContext, sound: CarSoundConfig["tone"]) {
    this.idleHz = sound.idleHz;
    this.redlineHz = sound.redlineHz;
    this.saturationDriveRange = sound.saturationDriveRange;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500;

    const oscA = ctx.createOscillator();
    oscA.type = "sawtooth";
    oscA.frequency.value = sound.idleHz;

    const oscB = ctx.createOscillator();
    oscB.type = "sawtooth";
    oscB.detune.value = sound.baseDetuneCents;
    oscB.frequency.value = sound.idleHz;

    const oscC = ctx.createOscillator();
    oscC.type = "square";
    oscC.frequency.value = sound.idleHz;
    const oscCGain = ctx.createGain();
    oscCGain.gain.value = 0; // faded in only near redline, see setHighRpmLevel

    const driveGain = ctx.createGain();
    driveGain.gain.value = 1;
    const shaper = ctx.createWaveShaper();
    shaper.curve = buildSoftClipCurve();

    oscA.connect(filter);
    oscB.connect(filter);
    oscC.connect(oscCGain);
    oscCGain.connect(filter);
    filter.connect(driveGain);
    driveGain.connect(shaper);
    oscA.start();
    oscB.start();
    oscC.start();

    this.oscillatorA = oscA;
    this.oscillatorB = oscB;
    this.oscillatorC = oscC;
    this.oscillatorCGain = oscCGain;
    this.filter = filter;
    this.driveGain = driveGain;
    this.output = shaper;
  }

  /** `rpmFraction` is 0 (idle) to 1 (MAX_TRANSMISSION_RPM); pitch is a straight lerp between idle and redline tones. */
  setPitch(rpmFraction: number, now: number, tau: number): void {
    const freq = this.idleHz + rpmFraction * (this.redlineHz - this.idleHz);
    this.oscillatorA.frequency.setTargetAtTime(freq, now, tau);
    this.oscillatorB.frequency.setTargetAtTime(freq, now, tau);
    this.oscillatorC.frequency.setTargetAtTime(freq, now, tau);
  }

  /** Detune (cents) on oscillator B relative to A — the orchestrator computes this from an RPM curve plus any bonus (e.g. neutral's extra grit); eased via setTargetAtTime since RPM changes every frame. */
  setDetune(cents: number, now: number, tau: number): void {
    this.oscillatorB.detune.setTargetAtTime(cents, now, tau);
  }

  setFilterHz(hz: number, now: number, tau: number): void {
    this.filter.frequency.setTargetAtTime(hz, now, tau);
  }

  /** `level` is the oscillator's gain relative to the main saws (see highRpmOscLevelFor in engineCharacter.ts). */
  setHighRpmLevel(level: number, now: number, tau: number): void {
    this.oscillatorCGain.gain.setTargetAtTime(level, now, tau);
  }

  /** `amount` is 0 (clean) to 1 (fully driven into the fixed soft-clip curve) — see saturationFor in engineCharacter.ts. */
  setSaturation(amount: number, now: number, tau: number): void {
    this.driveGain.gain.setTargetAtTime(1 + amount * this.saturationDriveRange, now, tau);
  }
}
