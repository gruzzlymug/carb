import { interpolateCurve } from "../../math/curve.js";
import type { CarSoundConfig } from "../../util/cars/index.js";

/** Nonlinear filter brightness for a given RPM fraction — see CarSoundConfig.brightness.curveExponent. */
export function brightnessFor(rpmFraction: number, sound: CarSoundConfig): number {
  return Math.pow(rpmFraction, sound.brightness.curveExponent);
}

/** Base oscillator-B detune (cents) for a given RPM fraction — the orchestrator adds any situational bonus (e.g. neutral) on top. */
export function detuneFor(rpmFraction: number, sound: CarSoundConfig): number {
  return interpolateCurve(rpmFraction, sound.detuneCurve);
}

export function saturationFor(rpmFraction: number, sound: CarSoundConfig): number {
  return interpolateCurve(rpmFraction, sound.saturationCurve);
}

/** Fade-in level for EngineTone's third (square) oscillator — silent below sound.highRpmOsc.startFraction, ramping to redline. */
export function highRpmOscLevelFor(rpmFraction: number, sound: CarSoundConfig): number {
  const { startFraction, level } = sound.highRpmOsc;
  const t = Math.max(0, Math.min(1, (rpmFraction - startFraction) / (1 - startFraction)));
  return t * level;
}

/**
 * Continuous "engine character" modulation layered on top of EngineTone's
 * raw pitch: an idle-only irregular wobble + rumble, and a redline-only
 * flutter, each its own gain node(s) + LFO so they can fade in/out
 * independently without fighting the main RPM/throttle loudness (owned by
 * the orchestrator). LFO frequencies/depths/tau come from the active car's
 * CarConfig.sound.idle/limiter.
 */
export class EngineCharacter {
  readonly input: AudioNode;
  readonly output: AudioNode;
  private readonly sound: CarSoundConfig;
  private readonly idleLfoADepth: GainNode;
  private readonly idleLfoBDepth: GainNode;
  private readonly rumbleGain: GainNode;
  private readonly limiterLfoDepth: GainNode;

  constructor(ctx: AudioContext, sound: CarSoundConfig) {
    this.sound = sound;
    const { idle, limiter } = sound;

    const idleTremolo = ctx.createGain();
    idleTremolo.gain.value = 1;

    const idleLfoA = ctx.createOscillator();
    idleLfoA.type = "sine";
    idleLfoA.frequency.value = idle.lfoAHz;
    const idleLfoADepth = ctx.createGain();
    idleLfoADepth.gain.value = 0;
    idleLfoA.connect(idleLfoADepth);
    idleLfoADepth.connect(idleTremolo.gain);
    idleLfoA.start();

    const idleLfoB = ctx.createOscillator();
    idleLfoB.type = "sine";
    idleLfoB.frequency.value = idle.lfoBHz;
    const idleLfoBDepth = ctx.createGain();
    idleLfoBDepth.gain.value = 0;
    idleLfoB.connect(idleLfoBDepth);
    idleLfoBDepth.connect(idleTremolo.gain);
    idleLfoB.start();

    const rumbleOsc = ctx.createOscillator();
    rumbleOsc.type = "triangle";
    rumbleOsc.frequency.value = idle.rumbleHz;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleOsc.connect(rumbleGain);
    rumbleGain.connect(idleTremolo); // sums with EngineTone's output feeding the same node
    rumbleOsc.start();

    const limiterTremolo = ctx.createGain();
    limiterTremolo.gain.value = 1;
    const limiterLfo = ctx.createOscillator();
    limiterLfo.type = "sine";
    limiterLfo.frequency.value = limiter.lfoHz;
    const limiterLfoDepth = ctx.createGain();
    limiterLfoDepth.gain.value = 0;
    limiterLfo.connect(limiterLfoDepth);
    limiterLfoDepth.connect(limiterTremolo.gain);
    limiterLfo.start();

    idleTremolo.connect(limiterTremolo);

    this.input = idleTremolo;
    this.output = limiterTremolo;
    this.idleLfoADepth = idleLfoADepth;
    this.idleLfoBDepth = idleLfoBDepth;
    this.rumbleGain = rumbleGain;
    this.limiterLfoDepth = limiterLfoDepth;
  }

  update(rpmFraction: number, throttleOn: boolean, limiterOn: boolean, now: number): void {
    const { idle, limiter } = this.sound;
    const idleThrottleMult = throttleOn ? idle.throttleDepthMult : 1;
    const idleFade = Math.max(0, 1 - rpmFraction / idle.fadeFraction);
    this.idleLfoADepth.gain.setTargetAtTime(idle.lfoADepthMax * idleFade * idleThrottleMult, now, idle.tau);
    this.idleLfoBDepth.gain.setTargetAtTime(idle.lfoBDepthMax * idleFade * idleThrottleMult, now, idle.tau);

    const rumbleFade = Math.max(0, 1 - rpmFraction / idle.rumbleFadeFraction);
    const rumbleThrottleMult = throttleOn ? idle.rumbleThrottleGainMult : 1;
    this.rumbleGain.gain.setTargetAtTime(idle.rumbleGainMax * rumbleFade * rumbleThrottleMult, now, idle.tau);

    const limiterDepth = limiterOn ? limiter.tremoloDepth : 0;
    this.limiterLfoDepth.gain.setTargetAtTime(limiterDepth, now, limiter.tau);
  }
}
