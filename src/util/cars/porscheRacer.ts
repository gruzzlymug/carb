import type { CarConfig } from "./carConfig.js";

/**
 * The default (and currently only) car: a lightweight ~2.7L naturally-
 * aspirated flat-six racer — think 911 Carrera/RS rather than a modern
 * turbo car. Relatively modest off-idle torque, a strong midrange, and
 * an increasingly aggressive, high-revving top end (~7,800 RPM redline)
 * rather than a big torquey low end.
 *
 * gearRatios/redlineRpm together were chosen so 5th still redlines at
 * ~67.7 m/s (~151mph), matching the car's pre-retune top speed — raising
 * the redline was meant to add engine character, not raise the car's
 * overall pace. See util/engineModel.ts for how ratio/RPM/torque combine.
 */
export const PORSCHE_RACER: CarConfig = {
  name: "Porsche-esque flat-six racer",

  maxSpeed: 72,
  maxReverseSpeed: 12,
  acceleration: 8,
  brakeForce: 20,
  handbrakeForce: 35,
  friction: 6,
  engineBraking: 10,
  topSpeedFalloff: 0.35,

  idleRpm: 900,
  redlineRpm: 7800,
  limiterRpm: 8000,
  maxTransmissionRpm: 8400,
  recommendedShiftRpm: 7400,

  // Redline speeds: 1st 15.3 m/s (34mph), 2nd 23.0 (52mph), 3rd 31.7 (71mph),
  // 4th 41.8 (94mph), 5th 67.7 (~151mph). 2nd-4th kept closer together than a
  // generic sports-car spread so a shift doesn't drop out of the powerband.
  gearRatios: [3.0, 2.0, 1.45, 1.1, 0.68],
  gearAccelMultipliers: [1.5, 1.32, 1.14, 1.0, 0.88],
  // Peak torque pushed to ~68% of redline and the falloff delayed, so the
  // upper range reads as "getting angry" rather than falling off a cliff.
  engineTorqueCurve: [
    [0.1, 0.52],
    [0.3, 0.78],
    [0.5, 0.96],
    [0.68, 1.0],
    [0.82, 0.96],
    [0.92, 0.82],
    [0.97, 0.55],
    [1.0, 0.0],
  ],
  reverseGearRatio: 3.5,
  reverseAccelMultiplier: 1.5,
  rpmScale: 150,

  // Scaled proportionally to the redline increase (x1.114) to preserve the
  // automatic box's relative shift feel.
  automaticUpshiftRpm: 7350,
  automaticCoastUpshiftRpm: 5600,
  automaticDownshiftRpm: 3350,
  automaticBrakeDownshiftRpm: 3900,
  automaticKickdownRpm: 4450,
  automaticKickdownMinGain: 0.12,
  automaticMaxDownshiftRpm: 7600,

  manualShiftCooldownMs: 90,
  automaticShiftCooldownMs: 120,
  downshiftSettleMs: 120,
  shiftRpmBlendMs: 90,
  shiftTorqueCutMs: 55,
  shiftTorqueCutFactor: 0.15,

  neutralRevRateUpRpmPerSec: 6000,
  neutralRevRateDownRpmPerSec: 4000,
  neutralRevTargetFraction: 0.75,
  limiterBouncePeriodMs: 70,

  chassis: {
    wheelbase: 2.4,
    tireGrip: 16,
    steeringGrip: 14.5,
    steeringSaturationKnee: 0.7,
    handbrakeMaxYawRate: 3.5,
    slipRecoveryPerSec: 18,
    slipHoldPerSec: 3,
    slipCatchEpsilonRad: 0.02,
    wheelMaxSteerRad: 0.7,
    wheelSteerSmoothPerSec: 28,
    steeringRatioCurve: [
      [0, 1.0],
      [15, 1.0],
      [30, 0.85],
      [45, 0.7],
      [60, 0.6],
    ],
    lowSpeedAssistMaxSpeed: 8,
    lowSpeedAssistMaxYawRate: 0.8,
    reverseMaxYawRate: 1.8,
  },

  sound: {
    smoothingTau: 0.035,

    tone: {
      idleHz: 55,
      redlineHz: 380,
      baseDetuneCents: 12,
      saturationDriveRange: 0.8,
    },
    detuneCurve: [
      [0, 12],
      [0.4, 8],
      [1, 4],
    ],
    saturationCurve: [
      [0, 0],
      [0.24, 0],
      [0.46, 0.05],
      [0.69, 0.15],
      [0.84, 0.25],
      [0.91, 0.35],
      [1, 0.4],
    ],
    highRpmOsc: { startFraction: 0.55, level: 0.15 },

    brightness: {
      curveExponent: 0.65,
      filterHzBase: 500,
      filterHzRange: 2500,
      throttleBrightnessHz: 900,
      highRpmBoostStartFraction: 0.75,
      highRpmExtraBrightnessHz: 700,
    },
    gain: {
      coastingBase: 0.02,
      coastingRange: 0.03,
      throttleBase: 0.06,
      throttleRange: 0.08,
    },

    limiter: {
      lfoHz: 15,
      tremoloDepth: 0.35,
      gainBoost: 1.15,
      brightnessHz: 700,
      tau: 0.02,
    },
    idle: {
      lfoAHz: 1.7,
      lfoADepthMax: 0.04,
      lfoBHz: 2.3,
      lfoBDepthMax: 0.02,
      fadeFraction: 0.25,
      throttleDepthMult: 0.4,
      tau: 0.035,
      rumbleHz: 30,
      rumbleGainMax: 0.015,
      rumbleFadeFraction: 0.18,
      rumbleThrottleGainMult: 0.4,
    },
    neutral: {
      pitchTau: 0.018,
      filterBonusHz: 400,
      gainMult: 1.15,
      detuneBonusCents: 6,
    },

    shift: {
      upshift: { duckFloor: 0.15, duckMs: 55, thumpHz: 90, thumpDecayS: 0.07 },
      downshift: {
        duckFloor: 0.12,
        duckMs: 45,
        thumpHz: 130,
        thumpDecayS: 0.05,
        blipStartHz: 650,
        blipEndHz: 260,
        blipS: 0.03,
      },
      transientGain: 0.5,
    },
    overrun: {
      liftoffRpmFractionThreshold: 0.3,
      dipS: 0.3,
      dipGainFraction: 0.4,
      dipFilterHz: 800,
      dipTau: 0.05,
      filterHzOpen: 20000,
      noiseBurstS: 0.2,
      noiseBurstPeak: 0.025,
      noiseBandpassHz: 1100,
      noiseBandpassQ: 0.7,
    },
  },
};
