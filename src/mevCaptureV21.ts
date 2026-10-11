import { mevCaptureExp2 } from "./math/mevCaptureExp2";
import { EVM_MAX_TICK } from "./math/tick";

/** All fields are integers; obtain these from the extension's getConfig(). */
export interface MevCaptureV21Config {
  halfLife: bigint;
  slopeK: bigint;
  segmentExp: bigint;
  jLin: bigint;
  maxFee: bigint;
  clampTicks: bigint;
  mGate: bigint;
  maxSegments: bigint;
}

/** getAnchor() tuple, including the position snapshot and H1 clock. */
export interface MevCaptureV21State {
  lastUpdateTime: bigint;
  lRefTime: bigint;
  lastPosTime: bigint;
  lRefBits: bigint;
  snapBits: bigint;
  lRefRaiseTime: bigint;
  anchorX16: bigint;
}

export type MevCaptureV21ConfigTuple = readonly [
  bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
];
export type MevCaptureV21AnchorTuple = readonly [
  bigint, bigint, bigint, bigint, bigint, bigint, bigint,
];

export function validateMevCaptureV21Config(c: MevCaptureV21Config): void {
  inRange(c.halfLife, 1n, 1n << 20n, "halfLife");
  inRange(c.slopeK, 1n, 16n, "slopeK");
  inRange(c.segmentExp, 0n, 8n, "segmentExp");
  inRange(c.jLin, 1n, 64n, "jLin");
  inRange(c.maxFee, 1n, 1n << 15n, "maxFee");
  inRange(c.clampTicks, 1n, 2n * BigInt(EVM_MAX_TICK), "clampTicks");
  inRange(c.mGate, 0n, 16n, "mGate");
  if (c.maxSegments !== c.jLin + 24n) {
    throw new RangeError("MEVCaptureV21: maxSegments must equal jLin + 24");
  }
}

export function mevCaptureV21ConfigFromTuple(
  [halfLife, slopeK, segmentExp, jLin, maxFee, clampTicks, mGate, maxSegments]: MevCaptureV21ConfigTuple,
): MevCaptureV21Config {
  const config = { halfLife, slopeK, segmentExp, jLin, maxFee, clampTicks, mGate, maxSegments };
  validateMevCaptureV21Config(config);
  return config;
}

export function mevCaptureV21StateFromTuple(
  [lastUpdateTime, lRefTime, lastPosTime, lRefBits, snapBits, lRefRaiseTime, anchorX16]: MevCaptureV21AnchorTuple,
): MevCaptureV21State {
  const state = { lastUpdateTime, lRefTime, lastPosTime, lRefBits, snapBits, lRefRaiseTime, anchorX16 };
  validateMevCaptureV21State(state);
  return state;
}

export function validateMevCaptureV21State(s: MevCaptureV21State): void {
  for (const key of ["lastUpdateTime", "lRefTime", "lastPosTime", "lRefRaiseTime"] as const) {
    inRange(s[key], 0n, (1n << 32n) - 1n, key);
  }
  inRange(s.lRefBits, 0n, 128n, "lRefBits");
  inRange(s.snapBits, 0n, 128n, "snapBits");
  inRange(s.anchorX16, -(1n << 63n), (1n << 63n) - 1n, "anchorX16");
}

export function initializeMevCaptureV21(
  config: MevCaptureV21Config,
  tick: bigint,
  timestamp: bigint,
): MevCaptureV21State {
  validateMevCaptureV21Config(config);
  inRange(tick, -BigInt(EVM_MAX_TICK), BigInt(EVM_MAX_TICK), "tick");
  const now = uint32Time(timestamp);
  return {
    lastUpdateTime: now, lRefTime: now, lastPosTime: 0n,
    lRefBits: 0n, snapBits: 0n,
    lRefRaiseTime: elapsed(now, config.halfLife), anchorX16: tick << 16n,
  };
}

/** Snapshot active liquidity BEFORE the first position mutation in a timestamp. */
export function snapshotMevCaptureV21(
  state: MevCaptureV21State,
  activeLiquidity: bigint,
  timestamp: bigint,
): MevCaptureV21State {
  validateMevCaptureV21State(state);
  const bits = liquidityBits(activeLiquidity);
  const now = uint32Time(timestamp);
  return state.lastPosTime === now ? { ...state } : {
    ...state, lastPosTime: now, snapBits: bits,
  };
}

export interface MevCaptureV21AnchorUpdate {
  state: MevCaptureV21State;
  first: boolean;
  /** null on same-timestamp swaps, which do not evaluate or emit the gate. */
  gate: { passed: boolean; lObs: bigint; eRef: bigint } | null;
}

export function updateMevCaptureV21Anchor(
  config: MevCaptureV21Config,
  state: MevCaptureV21State,
  tick: bigint,
  liquidity: bigint,
  timestamp: bigint,
): MevCaptureV21AnchorUpdate {
  validateMevCaptureV21Config(config);
  validateMevCaptureV21State(state);
  inRange(tick, -BigInt(EVM_MAX_TICK) - 1n, BigInt(EVM_MAX_TICK), "tick");
  const bits = liquidityBits(liquidity);
  const now = uint32Time(timestamp);
  if (state.lastUpdateTime === now) return { state: { ...state }, first: false, gate: null };
  const lObs = state.lastPosTime === now ? state.snapBits : bits;
  const eRef = decayedReference(config, state, now);
  const passed = lObs + config.mGate >= eRef;
  const next = { ...state, lastUpdateTime: now };
  if (passed) {
    next.anchorX16 = moveAnchor(config, state, tick, now);
    // Rev 6 Q1: restore BEFORE the capped H1 raise. Fails preserve BOTH clocks.
    const base = max(eRef, min(state.lRefBits, lObs));
    [next.lRefBits, next.lRefRaiseTime] = raise(config, base, lObs, now, state.lRefRaiseTime);
    next.lRefTime = now;
  }
  return { state: next, first: true, gate: { passed, lObs, eRef } };
}

/** Refresh after EVERY swap; never observe same-timestamp position additions. */
export function refreshMevCaptureV21(
  config: MevCaptureV21Config,
  state: MevCaptureV21State,
  liquidityAfter: bigint,
  timestamp: bigint,
): MevCaptureV21State {
  validateMevCaptureV21Config(config);
  validateMevCaptureV21State(state);
  const bits = liquidityBits(liquidityAfter);
  const now = uint32Time(timestamp);
  if (state.lastPosTime === now) return { ...state };
  const e = decayedReference(config, state, now);
  const [raised, raiseTime] = raise(config, e, bits, now, state.lRefRaiseTime);
  if (raised === e) return { ...state };
  return { ...state, lRefBits: raised, lRefTime: now, lRefRaiseTime: raiseTime };
}

function moveAnchor(c: MevCaptureV21Config, s: MevCaptureV21State, tick: bigint, now: bigint): bigint {
  const dt = elapsed(now, s.lastUpdateTime);
  const offset = s.anchorX16 - (tick << 16n);
  const magnitude = offset < 0n ? -offset : offset;
  const whole = dt / c.halfLife;
  // EVM SHR shifts >= 256 to zero, without allocating a huge bigint shift.
  const shifted = whole >= 256n ? 0n : magnitude >> whole;
  const decayedMagnitude = (shifted << 64n) / mevCaptureExp2(((dt % c.halfLife) << 64n) / c.halfLife);
  const decayed = offset < 0n ? -decayedMagnitude : decayedMagnitude;
  const limit = ((c.clampTicks << 16n) * min(dt, c.halfLife)) / c.halfLife;
  return BigInt.asIntN(64, s.anchorX16 + max(-limit, min(limit, decayed - offset)));
}

function decayedReference(c: MevCaptureV21Config, s: MevCaptureV21State, now: bigint): bigint {
  return max(0n, s.lRefBits - elapsed(now, s.lRefTime) / c.halfLife);
}

function raise(c: MevCaptureV21Config, e: bigint, observed: bigint, now: bigint, raiseTime: bigint): [bigint, bigint] {
  return observed > e && elapsed(now, raiseTime) >= c.halfLife ? [e + 1n, now] : [e, raiseTime];
}

function liquidityBits(liquidity: bigint): bigint {
  inRange(liquidity, 0n, (1n << 128n) - 1n, "liquidity");
  return liquidity === 0n ? 0n : BigInt(liquidity.toString(2).length);
}

function elapsed(now: bigint, then: bigint): bigint {
  return BigInt.asUintN(32, now - then);
}

function uint32Time(timestamp: bigint): bigint {
  inRange(timestamp, 0n, (1n << 256n) - 1n, "timestamp");
  return BigInt.asUintN(32, timestamp);
}

function inRange(value: bigint, low: bigint, high: bigint, label: string): void {
  if (typeof value !== "bigint" || value < low || value > high) {
    throw new RangeError(`MEVCaptureV21: invalid ${label}`);
  }
}

function min(a: bigint, b: bigint): bigint { return a < b ? a : b; }
function max(a: bigint, b: bigint): bigint { return a > b ? a : b; }
