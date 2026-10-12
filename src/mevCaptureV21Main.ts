// MEVCapture v2.1 on the current EVM Core (`main` variant, EKU-946 rev 10
// section (b-main)), ported from rust-sdk `quoting::pools::mev_capture_v21_main`.
//
// The extension charges no `minFee`. Each charged Core call is cut one
// representable SqrtRatio step short of the next initialized tick, and its
// surcharge is added to the calculated token through `Core.accumulateAsFees`.
// Every initialized tick is crossed by its own uncharged one-step bridge call.
// This is independent of the `next` variant model.
import { EVM_MAX_SQRT_RATIO, EVM_MAX_TICK, EVM_MIN_SQRT_RATIO, EVM_MIN_TICK } from "./math/tick";
import {
  checkedI128,
  CoreTickSearch,
  coreSwap,
  evmAmountBeforeFee,
  evmComputeFee,
  isValidSqrtRatio,
  MevCaptureV21MainQuoteError,
  predSqrtRatio,
  succSqrtRatio,
  tickToSqrtRatio,
  type MevCaptureV21MainCoreState,
  type MevCaptureV21MainTick,
  type TickEvent,
} from "./mevCaptureV21MainCore";

export {
  isValidSqrtRatio as isValidMevCaptureV21MainSqrtRatio,
  MevCaptureV21MainQuoteError,
  predSqrtRatio,
  sqrtRatioFromRaw,
  sqrtRatioToRaw,
  succSqrtRatio,
  type MevCaptureV21MainCoreState,
  type MevCaptureV21MainTick,
} from "./mevCaptureV21MainCore";

/** `MAX_TICK_SPACING` of the current Core. */
export const MEV_CAPTURE_V21_MAIN_MAX_TICK_SPACING = 698_605;

/** The extension's `getConfig` tuple (`segmentWidthMultiplier` is `1 << segmentExp`). */
export interface MevCaptureV21MainConfig {
  halfLife: number;
  slopeK: number;
  segmentExp: number;
  jLin: number;
  /** Q0.64, like the pool fee. */
  maxFee: bigint;
  clampTicks: number;
  mGate: number;
}

/** All seven fields returned by `getAnchor`. Times are uint32 seconds. */
export interface MevCaptureV21MainAnchor {
  lastUpdateTime: number;
  lRefTime: number;
  lastPosTime: number;
  lRefBits: number;
  snapBits: number;
  lRefRaiseTime: number;
  anchorX16: bigint;
}

/** First-touch gate result; a failure corresponds to `AnchorGateFailed(poolId, lObs, eRef)`. */
export interface MevCaptureV21MainGate {
  passed: boolean;
  lObs: number;
  eRef: number;
}

const isUint = (x: number, max: number) => Number.isInteger(x) && x >= 0 && x <= max;

/** The extension constructor's checks. */
export function validateMevCaptureV21MainConfig(c: MevCaptureV21MainConfig): MevCaptureV21MainConfig {
  const ranges: [number, number, number][] = [
    [c.halfLife, 1, 1 << 20],
    [c.slopeK, 1, 16],
    [c.segmentExp, 0, 8],
    [c.jLin, 1, 64],
    [c.clampTicks, 1, 2 * EVM_MAX_TICK],
    [c.mGate, 0, 16],
  ];
  const valid =
    ranges.every(([x, min, max]) => isUint(x, max) && x >= min) &&
    typeof c.maxFee === "bigint" &&
    c.maxFee > 0n &&
    c.maxFee <= 1n << 63n;
  if (!valid) throw new RangeError("MEVCaptureV21Main: invalid configuration");
  return { ...c };
}

const sub32 = (a: number, b: number) => (a - b) >>> 0;

function bitLength(x: bigint): number {
  return x === 0n ? 0 : x.toString(2).length;
}

const EXP2_FACTORS: readonly bigint[] = [
  0x16a09e667f3bcc908b2fb1366ea957d3en, 0x1306fe0a31b7152de8d5a46305c85edecn,
  0x1172b83c7d517adcdf7c8c50eb14a791fn, 0x10b5586cf9890f6298b92b71842a98363n,
  0x1059b0d31585743ae7c548eb68ca417fdn, 0x102c9a3e778060ee6f7caca4f7a29bde8n,
  0x10163da9fb33356d84a66ae336dcdfa3fn, 0x100b1afa5abcbed6129ab13ec11dc9543n,
  0x10058c86da1c09ea1ff19d294cf2f679bn, 0x1002c605e2e8cec506d21bfc89a23a00fn,
  0x100162f3904051fa128bca9c55c31e5dfn, 0x1000b175effdc76ba38e31671ca939725n,
  0x100058ba01fb9f96d6cacd4b180917c3dn, 0x10002c5cc37da9491d0985c348c68e7b3n,
  0x1000162e525ee054754457d5995292026n, 0x10000b17255775c040618bf4a4ade83fcn,
  0x1000058b91b5bc9ae2eed81e9b7d4cfabn, 0x100002c5c89d5ec6ca4d7c8acc017b7c9n,
  0x10000162e43f4f831060e02d839a9d16dn, 0x100000b1721bcfc99d9f890ea06911763n,
  0x10000058b90cf1e6d97f9ca14dbcc1628n, 0x1000002c5c863b73f016468f6bac5ca2bn,
  0x100000162e430e5a18f6119e3c02282a5n, 0x1000000b1721835514b86e6d96efd1bfen,
  0x100000058b90c0b48c6be5df846c5b2efn, 0x10000002c5c8601cc6b9e94213c72737an,
  0x1000000162e42fff037df38aa2b219f06n, 0x10000000b17217fba9c739aa5819f44f9n,
  0x1000000058b90bfcdee5acd3c1cedc823n, 0x100000002c5c85fe31f35a6a30da1be50n,
  0x10000000162e42ff0999ce3541b9fffcfn, 0x100000000b17217f80f4ef5aadda45554n,
  0x10000000058b90bfbf8479bd5a81b51adn, 0x1000000002c5c85fdf84bd62ae30a74ccn,
  0x100000000162e42fefb2fed257559bdaan, 0x1000000000b17217f7d5a7716bba4a9aen,
  0x100000000058b90bfbe9ddbac5e109ccen, 0x10000000002c5c85fdf4b15de6f17eb0dn,
  0x1000000000162e42fefa494f1478fde05n, 0x10000000000b17217f7d20cf927c8e94cn,
  0x1000000000058b90bfbe8f71cb4e4b33dn, 0x100000000002c5c85fdf477b662b26945n,
  0x10000000000162e42fefa3ae53369388cn, 0x100000000000b17217f7d1d351a389d40n,
  0x10000000000058b90bfbe8e8b2d3d4eden, 0x1000000000002c5c85fdf4741bea6e77en,
  0x100000000000162e42fefa39fe95583c2n, 0x1000000000000b17217f7d1cfb72b45e1n,
  0x100000000000058b90bfbe8e7cc35c3f0n, 0x10000000000002c5c85fdf473e242ea38n,
  0x1000000000000162e42fefa39f02b772cn, 0x10000000000000b17217f7d1cf7d83c1an,
  0x1000000000000058b90bfbe8e7bdcbe2en, 0x100000000000002c5c85fdf473dea871fn,
  0x10000000000000162e42fefa39ef44d91n, 0x100000000000000b17217f7d1cf79e949n,
  0x10000000000000058b90bfbe8e7bce544n, 0x1000000000000002c5c85fdf473de6ecan,
  0x100000000000000162e42fefa39ef366fn, 0x1000000000000000b17217f7d1cf79afan,
  0x100000000000000058b90bfbe8e7bcd6dn, 0x10000000000000002c5c85fdf473de6b2n,
  0x1000000000000000162e42fefa39ef358n, 0x10000000000000000b17217f7d1cf79abn,
];

/**
 * The contracts' `exp2`: unsigned 5.64 input, unsigned 64.64 output. The
 * factors are applied from the highest fraction bit down, rounding after each
 * product, exactly as the unrolled on-chain version does.
 */
export function mevCaptureV21Exp2(x: bigint): bigint {
  if (x < 0n || x >= 64n << 64n) throw new RangeError("MEVCaptureV21Main: exp2 input out of range");
  let result = 1n << 127n;
  for (let i = 0; i < 64; i++) {
    if ((x >> BigInt(63 - i)) & 1n) result = (result * EXP2_FACTORS[i]) >> 128n;
  }
  return result >> (63n - (x >> 64n));
}

/** Validated configuration with the anchor state machine. */
export class MevCaptureV21MainModel {
  readonly config: MevCaptureV21MainConfig;

  constructor(config: MevCaptureV21MainConfig) {
    this.config = validateMevCaptureV21MainConfig(config);
  }

  /** `beforeInitializePool`. */
  initialize(tick: number, now: number): MevCaptureV21MainAnchor {
    return {
      lastUpdateTime: now,
      lRefTime: now,
      lastPosTime: 0,
      lRefBits: 0,
      snapBits: 0,
      lRefRaiseTime: sub32(now, this.config.halfLife),
      anchorX16: BigInt(tick) << 16n,
    };
  }

  /** `beforeUpdatePosition`: snapshot of the active liquidity, once per timestamp. Mutates `state`. */
  beforePosition(state: MevCaptureV21MainAnchor, liquidity: bigint, now: number): void {
    if (state.lastPosTime !== now) {
      state.lastPosTime = now;
      state.snapBits = bitLength(liquidity);
    }
  }

  private decayedReference(state: MevCaptureV21MainAnchor, now: number): number {
    const decay = Math.floor(sub32(now, state.lRefTime) / this.config.halfLife);
    return Math.max(0, state.lRefBits - decay);
  }

  private raise(base: number, observed: number, now: number, raiseTime: number): [number, number] {
    if (observed > base && sub32(now, raiseTime) >= this.config.halfLife) return [base + 1, now];
    return [base, raiseTime];
  }

  /** The anchor movement toward the current tick, clamped by the allowance. */
  private moveAnchor(anchorX16: bigint, tick: number, dt: number): bigint {
    const { halfLife, clampTicks } = this.config;
    const offset = anchorX16 - (BigInt(tick) << 16n);
    const halvings = Math.floor(dt / halfLife);
    const abs = offset < 0n ? -offset : offset;
    const shifted = halvings >= 128 ? 0n : abs >> BigInt(halvings);
    const fraction = (BigInt(dt % halfLife) << 64n) / BigInt(halfLife);
    const magnitude = (shifted << 64n) / mevCaptureV21Exp2(fraction);
    const decayed = offset < 0n ? -magnitude : magnitude;
    // F-13: rounds up on `main` (the `next` variant floors), so every update
    // that consumes elapsed time grants at least one 2^-16 tick
    const hl = BigInt(halfLife);
    const limit = ((BigInt(clampTicks) << 16n) * BigInt(Math.min(dt, halfLife)) + hl - 1n) / hl;
    const move = decayed - offset;
    return anchorX16 + (move > limit ? limit : move < -limit ? -limit : move);
  }

  /** `_anchorUpdate`, run only on the first swap of a timestamp; `null` otherwise. Mutates `state`. */
  beforeSwap(
    state: MevCaptureV21MainAnchor,
    tick: number,
    liquidity: bigint,
    now: number,
  ): MevCaptureV21MainGate | null {
    if (state.lastUpdateTime === now) return null;
    const dt = sub32(now, state.lastUpdateTime);
    const lObs = state.lastPosTime === now ? state.snapBits : bitLength(liquidity);
    const eRef = this.decayedReference(state, now);
    const passed = lObs + this.config.mGate >= eRef;
    if (passed) {
      state.anchorX16 = this.moveAnchor(state.anchorX16, tick, dt);
      const base = Math.max(eRef, Math.min(state.lRefBits, lObs));
      [state.lRefBits, state.lRefRaiseTime] = this.raise(base, lObs, now, state.lRefRaiseTime);
      state.lRefTime = now;
    }
    state.lastUpdateTime = now;
    return { passed, lObs, eRef };
  }

  /** `_refresh`: raises the reference from the liquidity after the swap. Mutates `state`. */
  afterSwap(state: MevCaptureV21MainAnchor, liquidity: bigint, now: number): void {
    if (state.lastPosTime === now) return;
    const e = this.decayedReference(state, now);
    const [raised, raiseTime] = this.raise(e, bitLength(liquidity), now, state.lRefRaiseTime);
    if (raised !== e) {
      state.lRefBits = raised;
      state.lRefTime = now;
      state.lRefRaiseTime = raiseTime;
    }
  }
}

const floorDiv = (a: bigint, b: bigint) => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};

/** Away segments in mirrored Q16 tick coordinates (the swap always moves toward larger values). */
class Grid {
  readonly w16: bigint;
  readonly g1: bigint;
  readonly gJ: bigint;
  readonly jLin: number;

  constructor(a: bigint, spacing: number, config: MevCaptureV21MainConfig) {
    this.w16 = BigInt(spacing) << BigInt(config.segmentExp + 16);
    this.g1 = (floorDiv(a, this.w16) + 1n) * this.w16;
    this.gJ = this.g1 + BigInt(config.jLin - 1) * this.w16;
    this.jLin = config.jLin;
  }

  /** `_boundary`. */
  boundary(k: number): bigint {
    if (k <= this.jLin) return this.g1 + BigInt(k - 1) * this.w16;
    return this.gJ + ((1n << BigInt(k - this.jLin + 1)) - 2n) * this.w16;
  }

  /** `_firstSegment`. */
  firstSegment(p: bigint): number {
    const p16 = p << 16n;
    if (p16 < this.g1) return 1;
    if (p16 < this.gJ) return Number((p16 - this.g1) / this.w16 + 2n);
    return this.jLin - 1 + bitLength((p16 - this.gJ) / this.w16 + 2n);
  }
}

/** `_surcharge`: `min(maxFee - poolFee, ceil(slopeK * poolFee * twiceMid / (spacing << 18)))`. */
function surcharge(config: MevCaptureV21MainConfig, poolFee: bigint, twiceMidX16: bigint, spacing: number) {
  const den = BigInt(spacing) << 18n;
  const sur = (BigInt(config.slopeK) * poolFee * twiceMidX16 + den - 1n) / den;
  const cap = config.maxFee - poolFee;
  return sur > cap ? cap : sur;
}

/** Execution resources of one forwarded swap. */
export interface MevCaptureV21MainResources {
  /** `CORE.swap` calls made by the extension. */
  coreCalls: number;
  /** Core swap loop iterations, summed over calls (one bitmap search each). */
  coreSteps: number;
  /** Initialized ticks crossed. */
  initializedTicksCrossed: number;
  bridges: number;
  /** Tick-event searches by the extension (`next/prevInitializedTick`). */
  tickEventSearches: number;
  /** `CORE.accumulateAsFees` calls. */
  accumulateAsFees: number;
  /** 1 when this swap runs the first-touch anchor update of its timestamp. */
  anchorUpdates: number;
  /** 1 when the extension writes its pool state. */
  stateWrites: number;
}

/** Role of a Core call made by the extension. */
export type MevCaptureV21MainCallKind =
  /** Zero amount or price already at the user limit: the user's parameters are forwarded. */
  | { kind: "passThrough" }
  /** The uncut, uncharged call toward the anchor. */
  | { kind: "toward" }
  /** A call in away segment `k` (1-based), charged `surcharge` (Q0.64) on the calculated token. */
  | { kind: "charged"; k: number; surcharge: bigint }
  /** One representable step onto an initialized tick, uncharged. */
  | { kind: "bridge" };

/** One `CORE.swap` call, with the exact parameters the extension passes. */
export interface MevCaptureV21MainCoreCall {
  kind: MevCaptureV21MainCallKind;
  sqrtRatioLimit: bigint;
  /** The remaining specified amount passed to Core. */
  amount: bigint;
  /** Core's balance update (positive: paid to the pool). */
  delta0: bigint;
  delta1: bigint;
  /** Surcharge passed to `accumulateAsFees` right after the call (zero: not called). */
  surcharge0: bigint;
  surcharge1: bigint;
  /** LP fees paid inside Core (pool fee). */
  feesPaid: bigint;
  stateBefore: MevCaptureV21MainCoreState;
  stateAfter: MevCaptureV21MainCoreState;
  steps: number;
  initializedTicksCrossed: number;
}

/** User swap parameters forwarded to the extension. */
export interface MevCaptureV21MainSwapParams {
  isToken1: boolean;
  /** Positive for exact input, negative for exact output. */
  amount: bigint;
  /** Fixed-point limit; omitted is the contract default (minimum or maximum sqrt ratio). */
  sqrtRatioLimit?: bigint;
  skipAhead?: number;
}

export interface MevCaptureV21MainPoolState {
  core: MevCaptureV21MainCoreState;
  anchor: MevCaptureV21MainAnchor;
}

/** Full simulation of one forwarded swap. */
export interface MevCaptureV21MainSwap {
  /** Set on the first swap of a timestamp; `passed === false` emits `AnchorGateFailed`. */
  gate: MevCaptureV21MainGate | null;
  /** The anchor the swap used. */
  anchorX16: bigint;
  calls: MevCaptureV21MainCoreCall[];
  /** The forwarded balance update (Core deltas plus surcharges). */
  delta0: bigint;
  delta1: bigint;
  /** Total surcharge, by token (the sum of the `FeesAccumulated` amounts). */
  surcharge0: bigint;
  surcharge1: bigint;
  /** LP fees paid inside Core. */
  feesPaid: bigint;
  stateAfter: MevCaptureV21MainPoolState;
  resources: MevCaptureV21MainResources;
}

export interface MevCaptureV21MainQuote {
  isPriceIncreasing: boolean;
  /** Signed specified amount actually consumed. */
  consumedAmount: bigint;
  /** Unsigned calculated amount, surcharge included. */
  calculatedAmount: bigint;
  /** Pool fee only; the surcharge is part of `calculatedAmount`. */
  feesPaid: bigint;
  stateAfter: MevCaptureV21MainPoolState;
  resources: MevCaptureV21MainResources;
}

const nearer = (increasing: boolean, x: bigint, y: bigint) =>
  increasing === x < y ? x : y;

const cloneCore = (c: MevCaptureV21MainCoreState): MevCaptureV21MainCoreState => ({ ...c });
const cloneState = (s: MevCaptureV21MainPoolState): MevCaptureV21MainPoolState => ({
  core: cloneCore(s.core),
  anchor: { ...s.anchor },
});

/** Mutable context of one `_swapThroughSegments` run. */
interface SegmentRun {
  params: Required<MevCaptureV21MainSwapParams>;
  increasing: boolean;
  exactOut: boolean;
  search: CoreTickSearch;
  current: MevCaptureV21MainCoreState;
  remaining: bigint;
  calls: MevCaptureV21MainCoreCall[];
  tickEventSearches: number;
}

function validatePoolInput(
  model: MevCaptureV21MainModel,
  poolFee: bigint,
  tickSpacing: number,
): void {
  if (poolFee <= 0n || poolFee >= model.config.maxFee) {
    throw new RangeError("MEVCaptureV21Main: pool fee must be non-zero and below maxFee");
  }
  if (!isUint(tickSpacing, MEV_CAPTURE_V21_MAIN_MAX_TICK_SPACING) || tickSpacing === 0) {
    throw new RangeError("MEVCaptureV21Main: tick spacing must be in [1, MAX_TICK_SPACING]");
  }
}

function validateCoreState(core: MevCaptureV21MainCoreState): void {
  const valid =
    isValidSqrtRatio(core.sqrtRatio) &&
    Number.isInteger(core.tick) &&
    core.tick >= EVM_MIN_TICK &&
    core.tick <= EVM_MAX_TICK &&
    tickToSqrtRatio(core.tick) <= core.sqrtRatio &&
    (core.tick === EVM_MAX_TICK || tickToSqrtRatio(core.tick + 1) >= core.sqrtRatio);
  if (!valid) throw new RangeError("MEVCaptureV21Main: invalid sqrt ratio or tick");
}

function validateTicks(
  ticks: readonly MevCaptureV21MainTick[],
  spacing: number,
  core: MevCaptureV21MainCoreState,
): void {
  let active = 0n;
  ticks.forEach((t, i) => {
    const valid =
      Number.isInteger(t.index) &&
      t.index % spacing === 0 &&
      t.index >= EVM_MIN_TICK &&
      t.index <= EVM_MAX_TICK &&
      (i === 0 || ticks[i - 1].index < t.index);
    if (!valid) {
      throw new RangeError(
        "MEVCaptureV21Main: ticks must be sorted, unique, in range and multiples of the tick spacing",
      );
    }
    if (t.index <= core.tick) active += t.liquidityDelta;
  });
  if (active !== core.liquidity) {
    throw new RangeError("MEVCaptureV21Main: active liquidity does not match the ticks at or below the current tick");
  }
}

/**
 * A concentrated pool on the current Core behind MEVCapture v2.1 (`main` variant).
 *
 * Quotes are exact for the given initialized ticks: Core's bitmap words and
 * `skipAhead` are emulated because the extension cuts calls at Core's tick
 * events. Every initialized tick the swap can reach must be supplied,
 * including a referenced tick whose net delta is zero.
 */
export class MevCaptureV21MainPool {
  readonly model: MevCaptureV21MainModel;
  readonly poolFee: bigint;
  readonly tickSpacing: number;
  readonly ticks: readonly MevCaptureV21MainTick[];
  private readonly initialState: MevCaptureV21MainPoolState;

  /**
   * `config` must be the extension's `getConfig` tuple and `state.anchor` its
   * `getAnchor`. `poolFee` is the pool key's Q0.64 fee.
   */
  constructor(input: {
    poolFee: bigint;
    tickSpacing: number;
    config: MevCaptureV21MainConfig;
    state: MevCaptureV21MainPoolState;
    sortedTicks: readonly MevCaptureV21MainTick[];
  }) {
    this.model = new MevCaptureV21MainModel(input.config);
    validatePoolInput(this.model, input.poolFee, input.tickSpacing);
    validateCoreState(input.state.core);
    validateTicks(input.sortedTicks, input.tickSpacing, input.state.core);
    this.poolFee = input.poolFee;
    this.tickSpacing = input.tickSpacing;
    this.initialState = cloneState(input.state);
    this.ticks = input.sortedTicks.map((t) => ({ ...t }));
  }

  get state(): MevCaptureV21MainPoolState {
    return cloneState(this.initialState);
  }

  /**
   * Simulates `forward` exactly: the first-touch anchor update, the toward
   * call, the away state machine (rate cuts, tick cuts, bridges, surcharges)
   * and the post-swap refresh.
   */
  simulateSwap(
    state: MevCaptureV21MainPoolState,
    params: MevCaptureV21MainSwapParams,
    now: number,
  ): MevCaptureV21MainSwap {
    const anchor = { ...state.anchor };
    const gate = this.model.beforeSwap(anchor, state.core.tick, state.core.liquidity, now);
    const swap = this.swapThroughSegments(state.core, params, anchor.anchorX16);
    this.model.afterSwap(anchor, swap.stateAfter.core.liquidity, now);
    swap.gate = gate;
    swap.resources.anchorUpdates = gate === null ? 0 : 1;
    swap.resources.stateWrites = anchorEquals(anchor, state.anchor) ? 0 : 1;
    swap.stateAfter.anchor = anchor;
    return swap;
  }

  /** Quotes `forward` at block timestamp `now`; use `simulateSwap` for per-call records. */
  quote(input: MevCaptureV21MainSwapParams & { now: number; overrideState?: MevCaptureV21MainPoolState }): MevCaptureV21MainQuote {
    const swap = this.simulateSwap(input.overrideState ?? this.initialState, input, input.now);
    const [specified, calculated] = input.isToken1 ? [swap.delta1, swap.delta0] : [swap.delta0, swap.delta1];
    return {
      isPriceIncreasing: input.isToken1 !== input.amount < 0n,
      consumedAmount: specified,
      calculatedAmount: calculated < 0n ? -calculated : calculated,
      feesPaid: swap.feesPaid,
      stateAfter: swap.stateAfter,
      resources: swap.resources,
    };
  }

  /**
   * `_swapThroughSegments` with a given anchor (no anchor update or refresh);
   * the returned `stateAfter.anchor` is the pool's stored anchor state.
   */
  swapThroughSegments(
    coreState: MevCaptureV21MainCoreState,
    params: MevCaptureV21MainSwapParams,
    anchorX16: bigint,
  ): MevCaptureV21MainSwap {
    const run = this.startRun(coreState, params);
    const userLimit = run.params.sqrtRatioLimit;
    if (run.remaining === 0n || run.current.sqrtRatio === userLimit) {
      this.call(run, { kind: "passThrough" }, userLimit);
    } else if (!this.toward(run, anchorX16)) {
      this.away(run, anchorX16);
    }
    return this.summarize(run, anchorX16);
  }

  private startRun(coreState: MevCaptureV21MainCoreState, params: MevCaptureV21MainSwapParams): SegmentRun {
    const exactOut = params.amount < 0n;
    const increasing = params.isToken1 !== exactOut;
    const sqrtRatioLimit =
      params.sqrtRatioLimit ?? (increasing ? EVM_MAX_SQRT_RATIO : EVM_MIN_SQRT_RATIO);
    if (!isValidSqrtRatio(sqrtRatioLimit)) {
      throw new MevCaptureV21MainQuoteError("InvalidSqrtRatioLimit");
    }
    checkedI128(params.amount);
    const skipAhead = params.skipAhead ?? 0;
    return {
      params: { isToken1: params.isToken1, amount: params.amount, sqrtRatioLimit, skipAhead },
      increasing,
      exactOut,
      search: new CoreTickSearch(this.ticks, this.tickSpacing, skipAhead),
      current: cloneCore(coreState),
      remaining: params.amount,
      calls: [],
      tickEventSearches: 0,
    };
  }

  /** The uncut, uncharged call toward the anchor; returns whether the swap is finished. */
  private toward(run: SegmentRun, anchorX16: bigint): boolean {
    const { increasing } = run;
    // floor of the mirrored anchor, mapped back: a ceiling when decreasing
    const mirroredTick = increasing ? anchorX16 >> 16n : -(-anchorX16 >> 16n);
    const anchorTick = Math.min(EVM_MAX_TICK, Math.max(EVM_MIN_TICK, Number(mirroredTick)));
    const anchorRatio = tickToSqrtRatio(anchorTick);
    if (run.current.sqrtRatio === anchorRatio || increasing !== run.current.sqrtRatio < anchorRatio) {
      return false;
    }
    const limit = nearer(increasing, anchorRatio, run.params.sqrtRatioLimit);
    this.call(run, { kind: "toward" }, limit);
    return run.remaining === 0n || limit === run.params.sqrtRatioLimit || run.current.sqrtRatio !== limit;
  }

  private away(run: SegmentRun, anchorX16: bigint): void {
    const { increasing } = run;
    const config = this.model.config;
    const a = increasing ? anchorX16 : -anchorX16;
    const grid = new Grid(a, this.tickSpacing, config);
    const p = increasing ? BigInt(run.current.tick) : -BigInt(run.current.tick) - 1n;
    let k = grid.firstSegment(p);
    let lo = k === 1 ? a : grid.boundary(k - 1);
    for (;;) {
      const hi = grid.boundary(k);
      const sur = surcharge(config, this.poolFee, lo + hi - 2n * a, this.tickSpacing);
      const rateLimit = this.rateLimit(run, hi, sur === config.maxFee - this.poolFee);
      if (rateLimit === null) {
        lo = hi;
        k += 1;
        continue;
      }
      this.awayCall(run, rateLimit, { kind: "charged", k, surcharge: sur });
      if (run.remaining === 0n || run.current.sqrtRatio === run.params.sqrtRatioLimit) return;
    }
  }

  /** The limit at the segment's rate boundary; `null` if the price is already past it. */
  private rateLimit(run: SegmentRun, hi: bigint, capped: boolean): bigint | null {
    const userLimit = run.params.sqrtRatioLimit;
    const hiTick = hi >> 16n;
    if (capped || hiTick > BigInt(EVM_MAX_TICK)) return userLimit;
    const { increasing } = run;
    const boundary = tickToSqrtRatio(Number(increasing ? hiTick : -hiTick));
    if (increasing ? boundary <= run.current.sqrtRatio : boundary >= run.current.sqrtRatio) return null;
    return nearer(increasing, boundary, userLimit);
  }

  private nextEvent(run: SegmentRun): { event: TickEvent; ratio: bigint } {
    const { increasing, search } = run;
    let event = search.search(run.current.tick, increasing);
    run.tickEventSearches += 1;
    let ratio = tickToSqrtRatio(event.tick);
    if (ratio === run.current.sqrtRatio) {
      event = search.search(increasing ? event.tick : event.tick - 1, increasing);
      run.tickEventSearches += 1;
      ratio = tickToSqrtRatio(event.tick);
    }
    return { event, ratio };
  }

  /** One away call: cut short of the next initialized tick, or a bridge onto it. */
  private awayCall(run: SegmentRun, rateLimit: bigint, charged: MevCaptureV21MainCallKind): void {
    const { increasing } = run;
    const { event, ratio } = this.nextEvent(run);
    if (event.index === null) {
      this.call(run, charged, nearer(increasing, ratio, rateLimit));
      return;
    }
    const cut = increasing ? predSqrtRatio(ratio) : succSqrtRatio(ratio);
    if (cut === run.current.sqrtRatio) {
      this.call(run, { kind: "bridge" }, nearer(increasing, ratio, run.params.sqrtRatioLimit));
    } else {
      this.call(run, charged, nearer(increasing, cut, rateLimit));
    }
  }

  /** The surcharge on a charged call's calculated token. */
  private callSurcharge(run: SegmentRun, kind: MevCaptureV21MainCallKind, calculated: bigint): bigint {
    if (kind.kind !== "charged" || kind.surcharge === 0n) return 0n;
    if (!run.exactOut) return evmComputeFee(calculated < 0n ? -calculated : calculated, kind.surcharge);
    const inputNet = calculated - evmComputeFee(calculated, this.poolFee);
    return evmAmountBeforeFee(inputNet, kind.surcharge) - inputNet;
  }

  /** Runs one Core call and, for a charged call, the surcharge on its calculated token. */
  private call(run: SegmentRun, kind: MevCaptureV21MainCallKind, limit: bigint): void {
    const { isToken1 } = run.params;
    const before = run.current;
    const r = coreSwap(run.search, before, { fee: this.poolFee, isToken1, amount: run.remaining, limit });
    const fee = this.callSurcharge(run, kind, isToken1 ? r.delta0 : r.delta1);
    const specified = isToken1 ? r.delta1 : r.delta0;
    run.calls.push({
      kind,
      sqrtRatioLimit: limit,
      amount: run.remaining,
      delta0: r.delta0,
      delta1: r.delta1,
      surcharge0: isToken1 ? fee : 0n,
      surcharge1: isToken1 ? 0n : fee,
      feesPaid: r.feesPaid,
      stateBefore: before,
      stateAfter: r.state,
      steps: r.steps,
      initializedTicksCrossed: r.crossed,
    });
    const progressed = !coreEquals(r.state, before) || specified !== 0n;
    run.remaining = checkedI128(run.remaining - specified);
    run.current = r.state;
    if (!progressed && run.remaining !== 0n && run.current.sqrtRatio !== run.params.sqrtRatioLimit) {
      throw new MevCaptureV21MainQuoteError("NoProgress", "a Core call moved neither the price nor the amount");
    }
  }

  private summarize(run: SegmentRun, anchorX16: bigint): MevCaptureV21MainSwap {
    const totals = { delta0: 0n, delta1: 0n, surcharge0: 0n, surcharge1: 0n, feesPaid: 0n };
    const resources: MevCaptureV21MainResources = {
      coreCalls: run.calls.length,
      coreSteps: 0,
      initializedTicksCrossed: 0,
      bridges: 0,
      tickEventSearches: run.tickEventSearches,
      accumulateAsFees: 0,
      anchorUpdates: 0,
      stateWrites: 0,
    };
    for (const c of run.calls) {
      totals.delta0 = checkedI128(totals.delta0 + c.delta0 + checkedI128(c.surcharge0));
      totals.delta1 = checkedI128(totals.delta1 + c.delta1 + checkedI128(c.surcharge1));
      totals.surcharge0 += c.surcharge0;
      totals.surcharge1 += c.surcharge1;
      totals.feesPaid += c.feesPaid;
      resources.coreSteps += c.steps;
      resources.initializedTicksCrossed += c.initializedTicksCrossed;
      resources.bridges += c.kind.kind === "bridge" ? 1 : 0;
      resources.accumulateAsFees += c.surcharge0 + c.surcharge1 !== 0n ? 1 : 0;
    }
    const maxU128 = (1n << 128n) - 1n;
    if (totals.feesPaid > maxU128) totals.feesPaid = maxU128;
    return {
      gate: null,
      anchorX16,
      calls: run.calls,
      ...totals,
      stateAfter: { core: run.current, anchor: { ...this.initialState.anchor } },
      resources,
    };
  }
}

function coreEquals(a: MevCaptureV21MainCoreState, b: MevCaptureV21MainCoreState): boolean {
  return a.sqrtRatio === b.sqrtRatio && a.tick === b.tick && a.liquidity === b.liquidity;
}

function anchorEquals(a: MevCaptureV21MainAnchor, b: MevCaptureV21MainAnchor): boolean {
  return (Object.keys(a) as (keyof MevCaptureV21MainAnchor)[]).every((key) => a[key] === b[key]);
}
