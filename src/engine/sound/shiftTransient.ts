import type { CarSoundConfig } from "../../util/cars/index.js";

/**
 * The felt "click" of a gear change: a brief gain duck on the main engine
 * chain plus a short percussive thump (and, for downshifts, an extra sharp
 * blip), fired the instant Player.gear changes. Independent of how the
 * continuous RPM->pitch mapping glides through the same shift, since that
 * alone reads as too smooth to notice. Tuning comes from the active car's
 * CarConfig.sound.shift.
 */
export class ShiftTransient {
  readonly input: AudioNode;
  readonly output: AudioNode;
  private readonly ctx: AudioContext;
  private readonly sound: CarSoundConfig["shift"];
  private readonly duck: GainNode;
  private readonly transientBus: GainNode;

  /** `destination` is EngineSound's masterGain, not raw ctx.destination — so muting also silences the thump/blip, not just the continuous tone. */
  constructor(ctx: AudioContext, destination: AudioNode, sound: CarSoundConfig["shift"]) {
    const duck = ctx.createGain();
    duck.gain.value = 1;

    const transientBus = ctx.createGain();
    transientBus.gain.value = sound.transientGain;
    transientBus.connect(destination);

    this.ctx = ctx;
    this.sound = sound;
    this.duck = duck;
    this.transientBus = transientBus;
    this.input = duck;
    this.output = duck;
  }

  trigger(isDownshift: boolean, now: number): void {
    const { upshift, downshift } = this.sound;
    const duckFloor = isDownshift ? downshift.duckFloor : upshift.duckFloor;
    const duckMs = isDownshift ? downshift.duckMs : upshift.duckMs;
    const gain = this.duck.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(duckFloor, now + 0.008);
    gain.linearRampToValueAtTime(1, now + duckMs / 1000);

    const thumpHz = isDownshift ? downshift.thumpHz : upshift.thumpHz;
    const thumpDecay = isDownshift ? downshift.thumpDecayS : upshift.thumpDecayS;
    this.playTransient(now, thumpDecay, 1, () => {
      const thump = this.ctx.createOscillator();
      thump.type = "sine";
      thump.frequency.setValueAtTime(thumpHz * 1.3, now);
      thump.frequency.exponentialRampToValueAtTime(thumpHz, now + 0.02);
      return thump;
    });

    if (isDownshift) {
      this.playTransient(now, downshift.blipS, 0.5, () => {
        const blip = this.ctx.createOscillator();
        blip.type = "square";
        blip.frequency.setValueAtTime(downshift.blipStartHz, now);
        blip.frequency.exponentialRampToValueAtTime(downshift.blipEndHz, now + downshift.blipS);
        return blip;
      });
    }
  }

  /** Fires a single envelope-shaped oscillator burst into the transient bus, then tears it down. */
  private playTransient(now: number, decay: number, peak: number, makeOsc: () => OscillatorNode): void {
    const osc = makeOsc();
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(peak, now + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + decay);
    osc.connect(envelope);
    envelope.connect(this.transientBus);
    osc.start(now);
    osc.stop(now + decay + 0.02);
    osc.onended = (): void => {
      osc.disconnect();
      envelope.disconnect();
    };
  }
}
