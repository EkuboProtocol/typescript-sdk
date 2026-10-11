import { EVM_MAX_TICK, fixedSqrtRatioToFloat, toSqrtRatio } from "./tick";

/** Exact integer inverse of compact EVM tick ratios; no float logarithms. */
export function evmCompactSqrtRatioToTick(ratio: bigint): bigint {
  let low = -BigInt(EVM_MAX_TICK);
  let high = BigInt(EVM_MAX_TICK);
  while (low < high) {
    const mid = (low + high + 1n) >> 1n;
    if (fixedSqrtRatioToFloat(toSqrtRatio(Number(mid), "evm")) <= ratio) low = mid;
    else high = mid - 1n;
  }
  return low;
}
