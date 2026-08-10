import type { CarSoundConfig } from "../../util/cars/index.js";

export type ShiftKind = "upshift" | "manualDownshift" | "automaticDownshift";

/**
 * The felt "click" of a gear change: a brief gain duck on the main engine
 * chain plus a short percussive thump (and, for a manual downshift, an
 * extra sharp blip), fired the instant Player.gear changes. Independent of
 * how the continuous RPM->pitch mapping glides through the same shift,
 * since that alone reads as too smooth to notice. Manual vs. automatic
 * downshifts use deliberately different profiles (see CarSoundConfig.shift)
 * so a player-operated downshift reads as violent ("BRAAAAAAP") and a
 * gearbox-selected one reads as controlled ("BRRRP", no blip).
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

  trigger(kind: ShiftKind, now: number): void {
    const profile = kind === "upshift" ? this.sound.upshift : kind === "manualDownshift" ? this.sound.manualDownshift : this.sound.automaticDownshift;
    const gain = this.duck.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(profile.duckFloor, now + 0.008);
    gain.linearRampToValueAtTime(1, now + profile.duckMs / 1000);

    this.playTransient(now, profile.thumpDecayS, 1, () => {
      const thump = this.ctx.createOscillator();
      thump.type = "sine";
      thump.frequency.setValueAtTime(profile.thumpHz * 1.3, now);
      thump.frequency.exponentialRampToValueAtTime(profile.thumpHz, now + 0.02);
      return thump;
    });

    if (kind === "manualDownshift") {
      const { blipStartHz, blipEndHz, blipS } = this.sound.manualDownshift;
      this.playTransient(now, blipS, 0.5, () => {
        const blip = this.ctx.createOscillator();
        blip.type = "square";
        blip.frequency.setValueAtTime(blipStartHz, now);
        blip.frequency.exponentialRampToValueAtTime(blipEndHz, now + blipS);
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
