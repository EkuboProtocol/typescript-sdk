import { EVM_MAX_TICK, fixedSqrtRatioToFloat, toSqrtRatio } from "./math/tick";
import {
  refreshMevCaptureV21, updateMevCaptureV21Anchor,
  type MevCaptureV21Config, type MevCaptureV21State,
} from "./mevCaptureV21";
import {
  mevCaptureV21Segment, mevCaptureV21TowardTick, nextMevCaptureV21Segment,
  type MevCaptureV21ScheduleInput,
} from "./mevCaptureV21Schedule";

export const MEV_CAPTURE_V21_MIN_SQRT_RATIO = 4611797791050542631n;
export const MEV_CAPTURE_V21_MAX_SQRT_RATIO = 79227682466138141934206691491n;

export interface MevCaptureV21PoolState {
  /** Raw uint96 compact EVM SqrtRatio, NOT Q128 fixed point. */
  sqrtRatio: bigint;
  tick: bigint;
  liquidity: bigint;
}

export interface MevCaptureV21SwapParameters {
  amount: bigint;
  isToken1: boolean;
  /** Raw compact ratio; 0 selects the directional protocol limit. */
  sqrtRatioLimit: bigint;
  /** Caller total minimum, 0.16 (Core takes max(poolFee, minFee)). */
  minFee: bigint;
  skipAhead: bigint;
}

export interface MevCaptureV21CoreResult {
  delta0: bigint;
  delta1: bigint;
  pool: MevCaptureV21PoolState;
}

/**
 * A pure Core simulator with complete tick/bitmap data for this pool. It must
 * implement merged-Core rounding and skipAhead. Never substitute v1/Starknet
 * computeStep or an approximate price-impact model. Missing data must throw.
 */
export type MevCaptureV21CoreSwap = (
  pool: Readonly<MevCaptureV21PoolState>,
  params: Readonly<MevCaptureV21SwapParameters>,
) => MevCaptureV21CoreResult;

export interface MevCaptureV21QuoteInput {
  version: "2.1";
  poolType: "concentrated";
  config: MevCaptureV21Config;
  state: MevCaptureV21State;
  pool: MevCaptureV21PoolState;
  poolFee: bigint;
  spacingExp: bigint;
  timestamp: bigint;
  params: MevCaptureV21SwapParameters;
  coreSwap: MevCaptureV21CoreSwap;
}

export interface MevCaptureV21CoreCall extends MevCaptureV21CoreResult {
  params: MevCaptureV21SwapParameters;
}

export interface MevCaptureV21Quote extends MevCaptureV21CoreResult {
  state: MevCaptureV21State;
  remainingAmount: bigint;
  firstOfTimestamp: boolean;
  gate: { passed: boolean; lObs: bigint; eRef: bigint } | null;
  coreCalls: MevCaptureV21CoreCall[];
}

/** Pure forward-handler model. Returns a new state; never mutates input. */
export function quoteMevCaptureV21(input: MevCaptureV21QuoteInput): MevCaptureV21Quote {
  validateQuote(input);
  const update = updateMevCaptureV21Anchor(input.config, input.state, input.pool.tick, input.pool.liquidity, input.timestamp);
  const params = { ...input.params };
  const increasing = (params.amount < 0n) !== params.isToken1;
  if (params.sqrtRatioLimit === 0n) {
    params.sqrtRatioLimit = increasing ? MEV_CAPTURE_V21_MAX_SQRT_RATIO : MEV_CAPTURE_V21_MIN_SQRT_RATIO;
  }
  const context = {
    pool: { ...input.pool }, remaining: params.amount, sum0: 0n, sum1: 0n,
    calls: [] as MevCaptureV21CoreCall[], params, coreSwap: input.coreSwap,
  };
  const schedule = {
    config: input.config, anchorX16: update.state.anchorX16, increasing,
    poolFee: input.poolFee, spacingExp: input.spacingExp,
  };
  if (params.amount === 0n || context.pool.sqrtRatio === params.sqrtRatioLimit) {
    callCore(context, params.sqrtRatioLimit, params.minFee);
  } else {
    swapSegments(context, schedule);
  }
  return {
    delta0: context.sum0, delta1: context.sum1, pool: context.pool,
    state: refreshMevCaptureV21(input.config, update.state, context.pool.liquidity, input.timestamp),
    remainingAmount: context.remaining, firstOfTimestamp: update.first,
    gate: update.gate, coreCalls: context.calls,
  };
}

interface SwapContext {
  pool: MevCaptureV21PoolState;
  remaining: bigint;
  sum0: bigint;
  sum1: bigint;
  calls: MevCaptureV21CoreCall[];
  params: MevCaptureV21SwapParameters;
  coreSwap: MevCaptureV21CoreSwap;
}

function swapSegments(c: SwapContext, s: MevCaptureV21ScheduleInput): void {
  if (swapToward(c, s)) return;
  let k = 1n;
  for (let n = 0n; n < s.config.maxSegments; n++) {
    const segment = nextMevCaptureV21Segment(s, c.pool.sqrtRatio, k);
    let limit = c.params.sqrtRatioLimit;
    if (segment.boundarySqrtRatio !== null && n !== s.config.maxSegments - 1n) {
      limit = nearer(segment.boundarySqrtRatio, limit, s.increasing);
    }
    if (callCore(c, limit, max(segment.fee, c.params.minFee))) return;
    k = segment.k + 1n;
  }
  throw new Error("MEVCaptureV21: Core simulator did not terminate at segment budget");
}

/** Return true when the toward call completed the whole forwarded swap. */
function swapToward(c: SwapContext, s: MevCaptureV21ScheduleInput): boolean {
  const tick = mevCaptureV21TowardTick(s.anchorX16, s.increasing);
  const bound = BigInt(EVM_MAX_TICK);
  const clamped = tick < -bound ? -bound : tick > bound ? bound : tick;
  const anchorRatio = fixedSqrtRatioToFloat(toSqrtRatio(Number(clamped), "evm"));
  const toward = s.increasing ? c.pool.sqrtRatio < anchorRatio : c.pool.sqrtRatio > anchorRatio;
  return toward && callCore(c, nearer(anchorRatio, c.params.sqrtRatioLimit, s.increasing), c.params.minFee);
}

function callCore(c: SwapContext, limit: bigint, fee: bigint): boolean {
  const params = { ...c.params, amount: c.remaining, sqrtRatioLimit: limit, minFee: fee };
  const result = c.coreSwap(Object.freeze({ ...c.pool }), Object.freeze({ ...params }));
  validateMevCaptureV21PoolState(result.pool);
  checkedInt128(result.delta0);
  checkedInt128(result.delta1);
  c.sum0 = checkedInt128(c.sum0 + result.delta0);
  c.sum1 = checkedInt128(c.sum1 + result.delta1);
  c.remaining = checkedInt128(c.remaining - (params.isToken1 ? result.delta1 : result.delta0));
  c.pool = { ...result.pool };
  c.calls.push({ params, delta0: result.delta0, delta1: result.delta1, pool: { ...result.pool } });
  return c.remaining === 0n || limit === c.params.sqrtRatioLimit || c.pool.sqrtRatio !== limit;
}

export function validateMevCaptureV21PoolState(pool: MevCaptureV21PoolState): void {
  assertBigintFields(pool);
  validateMevCaptureV21SqrtRatio(pool.sqrtRatio);
  // A decreasing swap hitting MIN_TICK reports MIN_TICK - 1.
  if (pool.tick < -BigInt(EVM_MAX_TICK) - 1n || pool.tick > BigInt(EVM_MAX_TICK)) {
    throw new RangeError("MEVCaptureV21: invalid Core tick");
  }
  if (pool.liquidity < 0n || pool.liquidity >= 1n << 128n) {
    throw new RangeError("MEVCaptureV21: invalid Core liquidity");
  }
}

export function validateMevCaptureV21SqrtRatio(ratio: bigint): void {
  if (typeof ratio !== "bigint") throw new RangeError("MEVCaptureV21: sqrt ratio must be bigint");
  const mantissa = ratio & ((1n << 94n) - 1n);
  if (ratio < MEV_CAPTURE_V21_MIN_SQRT_RATIO || ratio > MEV_CAPTURE_V21_MAX_SQRT_RATIO || mantissa < 1n << 62n) {
    throw new RangeError("MEVCaptureV21: invalid compact sqrt ratio");
  }
}

function validateQuote(i: MevCaptureV21QuoteInput): void {
  if (i.version !== "2.1" || i.poolType !== "concentrated" || typeof i.coreSwap !== "function") {
    throw new Error("MEVCaptureV21: unsupported version/pool or missing Core simulator");
  }
  validateMevCaptureV21PoolState(i.pool);
  validateSwapParameters(i.params);
  checkedInt128(i.params.amount);
  if (i.params.minFee < 0n || i.params.minFee > 65535n || i.params.skipAhead < 0n || i.params.skipAhead > 32767n) {
    throw new RangeError("MEVCaptureV21: invalid minFee or skipAhead");
  }
  if (i.params.sqrtRatioLimit !== 0n) validateMevCaptureV21SqrtRatio(i.params.sqrtRatioLimit);
  validateDirection(i.pool.sqrtRatio, i.params);
  // Validate fees/spacing even for no-op swaps, without inferring config.
  mevCaptureV21Segment({ ...i, anchorX16: i.state.anchorX16, increasing: true }, 1n);
}

function validateSwapParameters(params: MevCaptureV21SwapParameters): void {
  assertBigintFields({ amount: params.amount, minFee: params.minFee, skipAhead: params.skipAhead, sqrtRatioLimit: params.sqrtRatioLimit });
  if (typeof params.isToken1 !== "boolean") throw new RangeError("MEVCaptureV21: isToken1 must be boolean");
}

function assertBigintFields(fields: object): void {
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== "bigint") throw new RangeError(`MEVCaptureV21: ${name} must be bigint`);
  }
}

function validateDirection(ratio: bigint, params: MevCaptureV21SwapParameters): void {
  if (params.amount === 0n || params.sqrtRatioLimit === 0n || params.sqrtRatioLimit === ratio) return;
  const increasing = (params.amount < 0n) !== params.isToken1;
  if ((params.sqrtRatioLimit < ratio) === increasing) throw new RangeError("MEVCaptureV21: wrong price-limit direction");
}

function checkedInt128(x: bigint): bigint {
  if (typeof x !== "bigint" || x < -(1n << 127n) || x >= 1n << 127n) throw new RangeError("MEVCaptureV21: int128 overflow or non-integer input");
  return x;
}

function nearer(a: bigint, b: bigint, increasing: boolean) { return increasing ? (a < b ? a : b) : max(a, b); }
function max(a: bigint, b: bigint) { return a > b ? a : b; }
