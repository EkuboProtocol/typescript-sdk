import { floatSqrtRatioToFixed, fixedSqrtRatioToFloat, toSqrtRatio, EVM_MAX_TICK } from "./math/tick";
import { evmCompactSqrtRatioToTick } from "./math/evmCompactTick";
import {
  validateMevCaptureV21PoolState, validateMevCaptureV21SqrtRatio,
  type MevCaptureV21CoreSwap, type MevCaptureV21PoolState, type MevCaptureV21SwapParameters,
} from "./mevCaptureV21Quote";

export interface EvmConcentratedTick {
  tick: bigint;
  /** Signed net liquidity change crossing this initialized tick upward. */
  liquidityDelta: bigint;
}

export interface EvmConcentratedCoreSnapshot {
  poolFee: bigint;
  spacingExp: bigint;
  /** All initialized ticks, including zero-net ticks with nonzero gross liquidity. */
  ticks: readonly EvmConcentratedTick[];
  /** Caller must have fetched the COMPLETE bitmap/tick snapshot at one block. */
  coverage: "complete";
}

const Q128 = 1n << 128n;
const MAX_U128 = Q128 - 1n;
const MAX_U256 = (1n << 256n) - 1n;
const MAX_RAW = (1n << 96n) - 1n;
const MAX_TICK = BigInt(EVM_MAX_TICK);
const BITMAP_OFFSET = 89421695n;

/**
 * Pure merged-Core price/liquidity/delta simulator, for concentrated pools only.
 * No RPC, positions, fee-growth accounting, or v1 extension side effects. The
 * immutable snapshot is shared by successive quotes; Core pool state is supplied
 * per call. Incomplete snapshots are unsupported, never treated as empty ranges.
 */
export function createEvmConcentratedCoreSwap(snapshot: EvmConcentratedCoreSnapshot): MevCaptureV21CoreSwap {
  validateSnapshot(snapshot);
  const data = { ...snapshot, ticks: snapshot.ticks.map(t => ({ ...t })).sort((a, b) => a.tick < b.tick ? -1 : 1) };
  return (pool, params) => simulateCore(data, { ...pool }, params);
}

function validateSnapshot(s: EvmConcentratedCoreSnapshot): void {
  if (s.coverage !== "complete") throw new Error("EVM Core: incomplete tick snapshot");
  assertBigints([s.poolFee, s.spacingExp]);
  if (s.poolFee < 0n || s.poolFee > 65535n || s.spacingExp < 0n || s.spacingExp > 19n) {
    throw new RangeError("EVM Core: invalid fee/spacing");
  }
  const seen = new Set<bigint>();
  for (const t of s.ticks) {
    validateTick(t, s.spacingExp);
    if (seen.has(t.tick)) throw new RangeError("EVM Core: duplicate initialized tick");
    int128(t.liquidityDelta);
    seen.add(t.tick);
  }
}

function validateTick(t: EvmConcentratedTick, spacingExp: bigint): void {
  assertBigints([t.tick, t.liquidityDelta]);
  if (t.tick < -MAX_TICK || t.tick > MAX_TICK || t.tick % (1n << spacingExp) !== 0n) {
    throw new RangeError("EVM Core: invalid initialized tick");
  }
}

function simulateCore(s: EvmConcentratedCoreSnapshot, pool: MevCaptureV21PoolState, params: Readonly<MevCaptureV21SwapParameters>) {
  validateMevCaptureV21PoolState(pool);
  validateMevCaptureV21SqrtRatio(params.sqrtRatioLimit);
  int128(params.amount);
  validateCoreParams(params);
  const increasing = (params.amount < 0n) !== params.isToken1;
  if (params.amount === 0n || pool.sqrtRatio === params.sqrtRatioLimit) return { delta0: 0n, delta1: 0n, pool };
  if ((params.sqrtRatioLimit < pool.sqrtRatio) === increasing) throw new Error("EVM Core: wrong price-limit direction");
  validateActiveLiquidity(s, pool);
  const fee = s.poolFee > params.minFee ? s.poolFee : params.minFee;
  let remaining = params.amount;
  let calculated = 0n;
  while (remaining !== 0n && pool.sqrtRatio !== params.sqrtRatioLimit) {
    const next = nextTick(s, pool.tick, increasing, params.skipAhead);
    const nextRatio = tickRatio(next.tick);
    const limit = increasing ? min(nextRatio, params.sqrtRatioLimit) : max(nextRatio, params.sqrtRatioLimit);
    const step = coreStep(pool, remaining, params.isToken1, fee, limit);
    remaining -= step.consumed;
    calculated += step.calculated;
    applyStep(pool, step.ratio, nextRatio, next, increasing);
  }
  const specified = int128(params.amount - remaining);
  // Merged Core saturates the negative calculated output at int128.min.
  calculated = int128(max(-(1n << 127n), calculated));
  return { delta0: params.isToken1 ? calculated : specified, delta1: params.isToken1 ? specified : calculated, pool };
}

function validateCoreParams(p: Readonly<MevCaptureV21SwapParameters>): void {
  assertBigints([p.amount, p.minFee, p.skipAhead, p.sqrtRatioLimit]);
  if (typeof p.isToken1 !== "boolean") throw new RangeError("EVM Core: isToken1 must be boolean");
  if (p.minFee < 0n || p.minFee > 65535n || p.skipAhead < 0n || p.skipAhead > 32767n) {
    throw new RangeError("EVM Core: invalid minFee/skipAhead");
  }
}

function validateActiveLiquidity(s: EvmConcentratedCoreSnapshot, pool: MevCaptureV21PoolState): void {
  const active = s.ticks.reduce((l, t) => t.tick <= pool.tick ? l + t.liquidityDelta : l, 0n);
  if (active !== pool.liquidity) throw new Error("EVM Core: inconsistent/incomplete active-liquidity snapshot");
}

function nextTick(s: EvmConcentratedCoreSnapshot, from: bigint, increasing: boolean, skip: bigint): EvmConcentratedTick {
  let cursor = from;
  for (;;) {
    const raw = ((cursor + (increasing ? 1n << s.spacingExp : 0n)) >> s.spacingExp) + BITMAP_OFFSET;
    const word = raw >> 8n;
    const wordLow = ((word << 8n) - BITMAP_OFFSET) << s.spacingExp;
    const wordHigh = wordLow + (255n << s.spacingExp);
    const found = findTick(s.ticks, cursor, wordLow, wordHigh, increasing);
    if (found) return found;
    const edge = increasing ? min(wordHigh, MAX_TICK) : max(wordLow, -MAX_TICK);
    if (skip === 0n || edge === (increasing ? MAX_TICK : -MAX_TICK)) return { tick: edge, liquidityDelta: 0n };
    cursor = increasing ? edge : edge - 1n;
    skip--;
  }
}

function findTick(ticks: readonly EvmConcentratedTick[], from: bigint, low: bigint, high: bigint, increasing: boolean) {
  const eligible = ticks.filter(t => t.tick >= low && t.tick <= high && (increasing ? t.tick > from : t.tick <= from));
  return increasing ? eligible[0] : eligible[eligible.length - 1];
}

function applyStep(pool: MevCaptureV21PoolState, ratio: bigint, nextRatio: bigint, next: EvmConcentratedTick, increasing: boolean): void {
  if (ratio === nextRatio) {
    pool.sqrtRatio = ratio;
    pool.tick = next.tick - (increasing ? 0n : 1n);
    pool.liquidity += increasing ? next.liquidityDelta : -next.liquidityDelta;
    uint128(pool.liquidity);
  } else if (pool.sqrtRatio !== ratio) {
    pool.sqrtRatio = ratio;
    pool.tick = evmCompactSqrtRatioToTick(ratio);
  }
}

function coreStep(pool: MevCaptureV21PoolState, amount: bigint, isToken1: boolean, fee: bigint, limit: bigint) {
  if (pool.liquidity === 0n) return { ratio: limit, consumed: 0n, calculated: 0n };
  const exactOut = amount < 0n;
  const impact = exactOut ? amount : amount - ceilDiv(amount * fee, 65536n);
  const next = isToken1 ? nextFrom1(pool.sqrtRatio, pool.liquidity, impact) : nextFrom0(pool.sqrtRatio, pool.liquidity, impact);
  const increasing = exactOut !== isToken1;
  if (increasing ? next > limit : next < limit) return stepToLimit(pool, amount, isToken1, fee, limit);
  if (next === pool.sqrtRatio) {
    if (exactOut) throw new Error("EVM Core: exact output failed to move price");
    return { ratio: next, consumed: amount, calculated: 0n };
  }
  const calculated = delta(next, pool.sqrtRatio, pool.liquidity, !isToken1, exactOut);
  return { ratio: next, consumed: amount, calculated: exactOut ? beforeFee(calculated, fee) : -calculated };
}

function stepToLimit(pool: MevCaptureV21PoolState, amount: bigint, isToken1: boolean, fee: bigint, limit: bigint) {
  const exactOut = amount < 0n;
  const specified = delta(limit, pool.sqrtRatio, pool.liquidity, isToken1, !exactOut);
  const calculated = delta(limit, pool.sqrtRatio, pool.liquidity, !isToken1, exactOut);
  return {
    ratio: limit, consumed: exactOut ? -specified : beforeFee(specified, fee),
    calculated: exactOut ? beforeFee(calculated, fee) : -calculated,
  };
}

function delta(a: bigint, b: bigint, liquidity: bigint, token1: boolean, up: boolean): bigint {
  const low = floatSqrtRatioToFixed(min(a, b));
  const high = floatSqrtRatioToFixed(max(a, b));
  if (token1) return uint128(div(liquidity * (high - low), Q128, up));
  return uint128(div(div((liquidity << 128n) * (high - low), high, up), low, up));
}

function nextFrom0(raw: bigint, liquidity: bigint, amount: bigint): bigint {
  if (amount === 0n) return raw;
  const fixed = floatSqrtRatioToFixed(raw);
  const numerator = liquidity << 128n;
  if (amount < 0n) {
    const product = -amount * fixed;
    if (product > MAX_U256 || product >= numerator) return MAX_RAW;
    const result = ceilDiv(numerator * fixed, numerator - product);
    if (result > (1n << 192n) - (1n << 98n)) return MAX_RAW;
    return encodeRatio(result, true);
  }
  return encodeRatio(ceilDiv(numerator, numerator / fixed + amount), true);
}

function nextFrom1(raw: bigint, liquidity: bigint, amount: bigint): bigint {
  const fixed = floatSqrtRatioToFixed(raw);
  if (amount < 0n) return encodeRatio(max(0n, fixed - ceilDiv(-amount << 128n, liquidity)), false);
  const sum = fixed + (amount << 128n) / liquidity;
  return sum >= 1n << 192n ? MAX_RAW : encodeRatio(sum, false);
}

function encodeRatio(fixed: bigint, up: boolean): bigint {
  for (let region = 0n; region < 4n; region++) {
    const shift = 2n + 32n * region;
    const rounded = fixed + (up ? (1n << shift) - 1n : 0n);
    if (rounded < 1n << (96n + region * 32n)) return (region << 94n) | (rounded >> shift);
  }
  throw new RangeError("EVM Core: sqrt ratio overflow");
}

function tickRatio(tick: bigint): bigint {
  // Tick is bounded to +/-88722835, so this integer conversion is lossless.
  return fixedSqrtRatioToFloat(toSqrtRatio(Number(tick), "evm"));
}

function beforeFee(amount: bigint, fee: bigint) { return uint128(ceilDiv(amount << 16n, 65536n - fee)); }
function div(n: bigint, d: bigint, up: boolean) { return up ? ceilDiv(n, d) : n / d; }
function ceilDiv(n: bigint, d: bigint) { return n / d + (n % d === 0n ? 0n : 1n); }
function min(a: bigint, b: bigint) { return a < b ? a : b; }
function max(a: bigint, b: bigint) { return a > b ? a : b; }
function uint128(x: bigint): bigint {
  if (x < 0n || x > MAX_U128) throw new RangeError("EVM Core: uint128 overflow");
  return x;
}
function int128(x: bigint): bigint {
  if (typeof x !== "bigint" || x < -(1n << 127n) || x >= 1n << 127n) throw new RangeError("EVM Core: int128 overflow or non-integer input");
  return x;
}

function assertBigints(values: readonly bigint[]): void {
  if (values.some(x => typeof x !== "bigint")) throw new RangeError("EVM Core: numeric fields must be bigint");
}
