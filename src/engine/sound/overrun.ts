import type { CarSoundConfig } from "../../util/cars/index.js";

const NOISE_BUFFER_SECONDS = 1;

/**
 * Lift-off character: when the throttle is released while a gear is engaged
 * and RPM is reasonably high, briefly darkens/quiets the engine tone and
 * layers in a soft filtered-noise tail — "VRRAAAAA-hmmmm" instead of the
 * tone just cutting to coast level. A placeholder for exhaust pops/crackles
 * later; for now, texture only, no gameplay effect. Tuning comes from the
 * active car's CarConfig.sound.overrun.
 */
export class Overrun {
  readonly input: AudioNode;
  readonly output: AudioNode;
  private readonly ctx: AudioContext;
  private readonly sound: CarSoundConfig["overrun"];
  private readonly dipGain: GainNode;
  private readonly dipFilter: BiquadFilterNode;
  private readonly noiseBuffer: AudioBuffer;
  private readonly destination: AudioNode;
  private wasThrottleOn = false;
  private triggeredAt = -Infinity;

  /** `destination` is EngineSound's masterGain, not raw ctx.destination — so muting also silences the noise burst, not just the continuous tone. */
  constructor(ctx: AudioContext, destination: AudioNode, sound: CarSoundConfig["overrun"]) {
    const dipGain = ctx.createGain();
    dipGain.gain.value = 1;
    const dipFilter = ctx.createBiquadFilter();
    dipFilter.type = "lowpass";
    dipFilter.frequency.value = sound.filterHzOpen;
    dipGain.connect(dipFilter);

    this.ctx = ctx;
    this.sound = sound;
    this.destination = destination;
    this.dipGain = dipGain;
    this.dipFilter = dipFilter;
    this.input = dipGain;
    this.output = dipFilter;
    this.noiseBuffer = this.buildNoiseBuffer(ctx);
  }

  private buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.ceil(ctx.sampleRate * NOISE_BUFFER_SECONDS);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** `engaged` is Player.gear !== 0 (Neutral has no lift-off pull to release). */
  update(throttleOn: boolean, rpmFraction: number, engaged: boolean, now: number): void {
    const sound = this.sound;
    if (this.wasThrottleOn && !throttleOn && engaged && rpmFraction > sound.liftoffRpmFractionThreshold) {
      this.triggeredAt = now;
      this.playNoiseBurst(now);
    }
    this.wasThrottleOn = throttleOn;

    const elapsed = now - this.triggeredAt;
    const dip = elapsed >= 0 && elapsed < sound.dipS ? 1 - elapsed / sound.dipS : 0;
    this.dipGain.gain.setTargetAtTime(1 - dip * sound.dipGainFraction, now, sound.dipTau);
    this.dipFilter.frequency.setTargetAtTime(sound.filterHzOpen - dip * sound.dipFilterHz, now, sound.dipTau);
  }

  private playNoiseBurst(now: number): void {
    const sound = this.sound;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true; // buffer is a full second; only ever played for noiseBurstS

    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = sound.noiseBandpassHz;
    bandpass.Q.value = sound.noiseBandpassQ;

    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(sound.noiseBurstPeak, now + 0.02);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + sound.noiseBurstS);

    source.connect(bandpass);
    bandpass.connect(envelope);
    envelope.connect(this.destination);
    source.start(now);
    source.stop(now + sound.noiseBurstS + 0.02);
    source.onended = (): void => {
      source.disconnect();
      bandpass.disconnect();
      envelope.disconnect();
    };
  }
}
