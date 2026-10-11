import { EVM_MAX_TICK, fixedSqrtRatioToFloat, toSqrtRatio } from "./math/tick";
import { evmCompactSqrtRatioToTick } from "./math/evmCompactTick";
import { validateMevCaptureV21Config, type MevCaptureV21Config } from "./mevCaptureV21";

export interface MevCaptureV21Segment {
  k: bigint;
  loX16: bigint;
  hiX16: bigint;
  hiTick: bigint;
  /** Total 0.16 schedule fee, before the caller minFee is applied. */
  fee: bigint;
}

export interface MevCaptureV21ScheduleInput {
  config: MevCaptureV21Config;
  anchorX16: bigint;
  increasing: boolean;
  poolFee: bigint;
  spacingExp: bigint;
}

/** Floor approaching from below; ceil approaching from above (N1). */
export function mevCaptureV21TowardTick(anchorX16: bigint, increasing: boolean): bigint {
  return increasing ? anchorX16 >> 16n : -((-anchorX16) >> 16n);
}

/** Exact geometry, also for boundaries beyond the executable tick range. */
export function mevCaptureV21Segment(input: MevCaptureV21ScheduleInput, k: bigint): MevCaptureV21Segment {
  validateSchedule(input);
  validateSegmentIndex(k);
  const { config, poolFee, spacingExp, increasing } = input;
  const { a, g1, gJ, shift } = grid(input);
  const lo = k === 1n ? a : boundary(config, k - 1n, g1, gJ, shift);
  const hi = boundary(config, k, g1, gJ, shift);
  const feeShift = spacingExp + 18n;
  const numerator = config.slopeK * poolFee * (lo + hi - 2n * a);
  const fee = min(config.maxFee, poolFee + ((numerator + (1n << feeShift) - 1n) >> feeShift));
  const sign = increasing ? 1n : -1n;
  return { k, loX16: sign * lo, hiX16: sign * hi, hiTick: sign * (hi >> 16n), fee };
}

/**
 * Candidate from Core's tick, NOT final membership. A decreasing boundary hit
 * can have Core tick below the boundary. Use nextMevCaptureV21Segment for swaps.
 */
export function mevCaptureV21CandidateSegment(input: MevCaptureV21ScheduleInput, coreTick: bigint): bigint {
  validateSchedule(input);
  if (typeof coreTick !== "bigint") throw new RangeError("MEVCaptureV21: Core tick must be bigint");
  const { g1, gJ, shift } = grid(input);
  const p = (input.increasing ? coreTick : -coreTick - 1n) << 16n;
  if (p < g1) return 1n;
  if (p < gJ) return ((p - g1) >> shift) + 2n;
  const bits = BigInt((((p - gJ) >> shift) + 2n).toString(2).length);
  return input.config.jLin - 1n + bits;
}

/**
 * Select a strictly-beyond-price boundary by the RAW compact sqrt ratio.
 * Price membership never relies on Core tick (which is asymmetric at hits).
 * null boundary means the rest is at the cap or outside the tick domain.
 */
export function nextMevCaptureV21Segment(
  input: MevCaptureV21ScheduleInput,
  sqrtRatio: bigint,
  startK = 1n,
): MevCaptureV21Segment & { boundarySqrtRatio: bigint | null } {
  validateCompactRatio(sqrtRatio);
  validateSegmentIndex(startK);
  const candidate = mevCaptureV21CandidateSegment(input, evmCompactSqrtRatioToTick(sqrtRatio));
  for (let k = startK > candidate ? startK : candidate; k <= 256n; k++) {
    const segment = mevCaptureV21Segment(input, k);
    if (segment.fee === input.config.maxFee || abs(segment.hiTick) > BigInt(EVM_MAX_TICK)) {
      return { ...segment, boundarySqrtRatio: null };
    }
    const boundarySqrtRatio = fixedSqrtRatioToFloat(toSqrtRatio(Number(segment.hiTick), "evm"));
    if (input.increasing ? boundarySqrtRatio > sqrtRatio : boundarySqrtRatio < sqrtRatio) {
      return { ...segment, boundarySqrtRatio };
    }
  }
  throw new RangeError("MEVCaptureV21: unsupported segment state");
}

function validateSchedule(input: MevCaptureV21ScheduleInput): void {
  validateMevCaptureV21Config(input.config);
  validateScheduleIntegers(input);
  if (typeof input.increasing !== "boolean") throw new RangeError("MEVCaptureV21: increasing must be boolean");
  if (input.poolFee < 1n || input.poolFee >= input.config.maxFee) {
    throw new RangeError("MEVCaptureV21: pool fee must be nonzero and below maxFee");
  }
  if (input.spacingExp < 0n || input.spacingExp > 19n) {
    throw new RangeError("MEVCaptureV21: invalid spacingExp");
  }
  if (input.anchorX16 < -(1n << 63n) || input.anchorX16 >= 1n << 63n) {
    throw new RangeError("MEVCaptureV21: invalid anchorX16");
  }
}

function validateScheduleIntegers(input: MevCaptureV21ScheduleInput): void {
  if ([input.poolFee, input.spacingExp, input.anchorX16].some(x => typeof x !== "bigint")) {
    throw new RangeError("MEVCaptureV21: schedule fields must be bigint");
  }
}

function validateSegmentIndex(k: bigint): void {
  if (typeof k !== "bigint" || k < 1n || k > 256n) throw new RangeError("MEVCaptureV21: invalid segment index");
}

function validateCompactRatio(ratio: bigint): void {
  if (typeof ratio !== "bigint" || ratio < 4611797791050542631n || ratio > 79227682466138141934206691491n) {
    throw new RangeError("MEVCaptureV21: invalid compact sqrt ratio");
  }
  if ((ratio & ((1n << 94n) - 1n)) < 1n << 62n) {
    throw new RangeError("MEVCaptureV21: invalid compact sqrt ratio mantissa");
  }
}

function grid(input: MevCaptureV21ScheduleInput) {
  const a = input.increasing ? input.anchorX16 : -input.anchorX16;
  const shift = input.spacingExp + input.config.segmentExp + 16n;
  const g1 = ((a >> shift) + 1n) << shift;
  return { a, shift, g1, gJ: g1 + ((input.config.jLin - 1n) << shift) };
}

function boundary(c: MevCaptureV21Config, k: bigint, g1: bigint, gJ: bigint, shift: bigint): bigint {
  return k <= c.jLin ? g1 + ((k - 1n) << shift) : gJ + (((1n << (k - c.jLin + 1n)) - 2n) << shift);
}

function abs(x: bigint) { return x < 0n ? -x : x; }
function min(a: bigint, b: bigint) { return a < b ? a : b; }
