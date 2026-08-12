/**
 * Everything that defines "which car/engine": performance, gearbox, shift
 * behavior, chassis/steering feel, and engine sound. Plain JSON-compatible
 * data only (numbers, strings, arrays of [number, number] curve tuples) —
 * no functions or class instances — so a future standalone car-editing
 * tool can load/save this shape directly.
 *
 * Player, engineModel.ts, EngineSound, and Hud all take a CarConfig instead
 * of importing tuning constants directly, so adding a new car is just
 * adding a new file under util/cars/ that satisfies this interface. Only
 * genuinely car-independent values (world/physics timing, track/road,
 * camera) remain in util/constants.ts.
 */
export interface CarConfig {
  readonly name: string;

  readonly maxSpeed: number; // meters/second
  readonly maxReverseSpeed: number; // meters/second
  readonly acceleration: number; // meters/second^2, base — see entities/player.ts for the full torque chain
  readonly brakeForce: number; // meters/second^2
  readonly handbrakeForce: number; // meters/second^2
  readonly friction: number; // meters/second^2, applied when coasting
  readonly engineBraking: number; // meters/second^2, additional coast decel at redline RPM
  readonly topSpeedFalloff: number; // 0..1, aero-drag proxy fraction near the speed cap

  readonly idleRpm: number;
  readonly redlineRpm: number;
  readonly limiterRpm: number; // sustained bounce with redlineRpm while pinned with no recent downshift
  readonly maxTransmissionRpm: number; // hard ceiling on displayed/audible RPM, even right after an aggressive downshift
  readonly recommendedShiftRpm: number; // HUD/audio shift cue, comfortably below the limiter

  /** Gears 1-5. See util/engineModel.ts:rpmForGear for how ratio, idleRpm, and rpmScale combine. */
  readonly gearRatios: readonly number[];
  /** Gear torque multipliers (gears 1-5) — deliberately independent of gearRatios; see engineModel.ts. */
  readonly gearAccelMultipliers: readonly number[];
  /** Normalized engine torque (0..1), keyed by RPM as a fraction of redlineRpm. Interpolated in engineModel.ts. */
  readonly engineTorqueCurve: ReadonlyArray<readonly [number, number]>;
  readonly reverseGearRatio: number;
  readonly reverseAccelMultiplier: number;
  readonly rpmScale: number; // gameplay tuning factor, not a real final-drive ratio

  // Automatic transmission shift thresholds — see automaticGearFor in entities/player.ts.
  readonly automaticUpshiftRpm: number; // full throttle
  readonly automaticCoastUpshiftRpm: number; // partial/no throttle
  readonly automaticDownshiftRpm: number; // coasting/cruising
  readonly automaticBrakeDownshiftRpm: number; // under braking, drop gears sooner
  readonly automaticKickdownRpm: number; // only consider kickdown below this RPM
  readonly automaticKickdownMinGain: number; // require this much more torque to bother
  readonly automaticMaxDownshiftRpm: number; // automatic never downshifts into a gear that would spin past this

  // Shift feel/timing (not RPM-dependent).
  readonly manualShiftCooldownMs: number;
  readonly automaticShiftCooldownMs: number;
  /**
   * How long raw throttle must stay released before the automatic
   * transmission's shift logic treats the driver as actually coasting
   * (switching automaticUpshiftRpm -> automaticCoastUpshiftRpm etc.) — a
   * single-frame throttle blip (e.g. from an AI driver's bang-bang
   * throttle reacting to a speed profile that isn't perfectly monotonic)
   * shouldn't itself be enough to flip a 1000+ RPM shift-threshold regime.
   * Re-engaging throttle restores the throttle-on thresholds immediately,
   * no debounce — see Player.update.
   */
  readonly automaticThrottleLiftDebounceMs: number;
  readonly downshiftSettleMs: number; // how long a downshift may show RPM above redline before the limiter bounce takes over
  readonly shiftRpmBlendMs: number; // eases displayed RPM down after an upshift instead of teleporting
  readonly shiftTorqueCutMs: number; // brief post-upshift torque interruption window
  readonly shiftTorqueCutFactor: number; // torque multiplier during the cut (lower = more severe)

  // Neutral free-revving and limiter-bounce behavior — see Player.updateRpm.
  readonly neutralRevRateUpRpmPerSec: number; // throttle held
  readonly neutralRevRateDownRpmPerSec: number; // throttle released
  readonly neutralRevTargetFraction: number; // of redlineRpm, when throttle held in neutral
  readonly limiterBouncePeriodMs: number; // seconds per redline/limiter toggle while pinned

  readonly chassis: CarChassisConfig;
  readonly sound: CarSoundConfig;
}

/** Steering/grip feel — see entities/player.ts's applySteering/updateWheelSteer for how these combine. */
export interface CarChassisConfig {
  readonly wheelbase: number; // meters, front axle to rear axle
  readonly tireGrip: number; // meters/second^2, physical peak lateral accel ("hard cap")
  readonly steeringGrip: number; // meters/second^2, "comfortable" grip -- always <= tireGrip; drives the soft-knee threshold
  readonly steeringSaturationKnee: number; // fraction of the steeringGrip-based yaw cap below which response is linear
  readonly curvatureHeadroom: number; // how far full-lock's demanded curvature is allowed to exceed the grip-limited curvature (e.g. 1.2 = 20% over) -- gives the soft knee room to shape the top of the wheel's range instead of the demand blowing past the cap by 10-50x
  // Speed-scaled "downforce" bonus, added to both tireGrip and steeringGrip
  // before the friction-circle calc (not a separate additive yaw bonus) --
  // ~0 at low speed (parking/mid-speed corners keep today's tuning), grows
  // through the high-speed range where 60-100mph testing showed the base
  // tireGrip alone leaves corners far wider than the game wants. See
  // applySteering for how it's applied.
  readonly gripBonusCurve: ReadonlyArray<readonly [number, number]>; // [speed m/s, bonus m/s^2]
  readonly handbrakeMaxYawRate: number; // rad/s, stability cap once the handbrake bypasses the friction circle
  readonly slipRecoveryPerSec: number; // velocityHeading->heading catch-up rate, off the handbrake
  readonly slipHoldPerSec: number; // velocityHeading->heading catch-up rate, while the handbrake is held
  readonly slipCatchEpsilonRad: number; // residual angle below which the catch-up snaps instead of asymptotically approaching
  readonly wheelMaxSteerRad: number; // front-wheel yaw at full lock, before the speed-sensitive ratio
  readonly wheelSteerSmoothPerSec: number; // physical wheel-response rate (unaffected by the speed-sensitive ratio)
  readonly steeringRatioCurve: ReadonlyArray<readonly [number, number]>; // [speed m/s, fraction of wheelMaxSteerRad]
  readonly reverseMaxYawRate: number; // rad/s, hard cap whenever speed < 0
}

/**
 * Every tunable in the synthesized engine sound (engine/sound/*.ts), grouped
 * to mirror that module's own class structure: tone (the raw oscillators),
 * brightness/gain (continuous RPM/throttle shaping), limiter/idle
 * (EngineCharacter's two modulation layers), neutral (bonus character),
 * shift (ShiftTransient), overrun (Overrun). See those files for how each
 * value is used.
 */
export interface CarSoundConfig {
  readonly smoothingTau: number; // orchestrator-level pitch/gain/filter smoothing time constant

  readonly tone: {
    readonly idleHz: number;
    readonly redlineHz: number;
    readonly baseDetuneCents: number; // detuneCurve's own values are relative to nothing else -- this is oscillator B's detune at rpmFraction 0 per detuneCurve[0]
    readonly saturationDriveRange: number; // driveGain target = 1 + amount * this
  };
  readonly detuneCurve: ReadonlyArray<readonly [number, number]>; // [rpmFraction, cents]
  readonly saturationCurve: ReadonlyArray<readonly [number, number]>; // [rpmFraction, amount 0..1]
  readonly highRpmOsc: { readonly startFraction: number; readonly level: number }; // third-oscillator fade-in start (rpmFraction) and peak level

  readonly brightness: {
    readonly curveExponent: number; // rpmFraction^this
    readonly filterHzBase: number;
    readonly filterHzRange: number;
    readonly throttleBrightnessHz: number;
    readonly highRpmBoostStartFraction: number;
    readonly highRpmExtraBrightnessHz: number;
  };
  readonly gain: {
    readonly coastingBase: number;
    readonly coastingRange: number;
    readonly throttleBase: number;
    readonly throttleRange: number;
  };

  readonly limiter: {
    readonly lfoHz: number;
    readonly tremoloDepth: number;
    readonly gainBoost: number;
    readonly brightnessHz: number;
    readonly tau: number;
  };
  readonly idle: {
    readonly lfoAHz: number;
    readonly lfoADepthMax: number;
    readonly lfoBHz: number;
    readonly lfoBDepthMax: number;
    readonly fadeFraction: number;
    readonly throttleDepthMult: number;
    readonly tau: number;
    readonly rumbleHz: number;
    readonly rumbleGainMax: number;
    readonly rumbleFadeFraction: number;
    readonly rumbleThrottleGainMult: number;
  };
  readonly neutral: {
    readonly pitchTau: number;
    readonly filterBonusHz: number;
    readonly gainMult: number;
    readonly detuneBonusCents: number;
  };

  readonly shift: {
    readonly upshift: { readonly duckFloor: number; readonly duckMs: number; readonly thumpHz: number; readonly thumpDecayS: number };
    /** Player-operated downshift (Q key) -- deliberately violent ("BRAAAAAAP"): sharp duck, higher/sharper thump, plus a blip. */
    readonly manualDownshift: {
      readonly duckFloor: number;
      readonly duckMs: number;
      readonly thumpHz: number;
      readonly thumpDecayS: number;
      readonly blipStartHz: number;
      readonly blipEndHz: number;
      readonly blipS: number;
    };
    /** Gearbox-selected downshift (automatic mode) -- deliberately controlled ("BRRRP"): shallower duck, duller thump, no blip. */
    readonly automaticDownshift: {
      readonly duckFloor: number;
      readonly duckMs: number;
      readonly thumpHz: number;
      readonly thumpDecayS: number;
    };
    readonly transientGain: number;
  };
  readonly overrun: {
    readonly liftoffRpmFractionThreshold: number;
    readonly dipS: number;
    readonly dipGainFraction: number;
    readonly dipFilterHz: number;
    readonly dipTau: number;
    readonly filterHzOpen: number;
    readonly noiseBurstS: number;
    readonly noiseBurstPeak: number;
    readonly noiseBandpassHz: number;
    readonly noiseBandpassQ: number;
  };
}
