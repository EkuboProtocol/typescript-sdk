import { nextSqrtRatioFromAmount0, nextSqrtRatioFromAmount1 } from "./price";
import { amount0Delta, amount1Delta } from "./delta";
import { MAX_U128 } from "./constants";

interface SwapResult {
  consumedAmount: bigint;
  calculatedAmount: bigint;
  sqrtRatioNext: bigint;
  feeAmount: bigint;
}

export function isPriceIncreasing(amount: bigint, isToken1: boolean): boolean {
  return amount < 0n !== isToken1;
}

function noOp(sqrtRatioNext: bigint): SwapResult {
  return {
    consumedAmount: 0n,
    calculatedAmount: 0n,
    sqrtRatioNext,
    feeAmount: 0n,
  };
}

export function amountBeforeFee(amount: bigint, fee: bigint): bigint {
  if (fee === 0n) return amount;
  const num = amount << 128n;
  const denom = (1n << 128n) - fee;
  const val = num / denom;
  const result = val + (num % denom !== 0n ? 1n : 0n);
  if (result > MAX_U128) throw new Error("AMOUNT_BEFORE_FEE_OVERFLOW");
  return result;
}

export function computeFee(amount: bigint, fee: bigint) {
  const num = amount * fee;
  const denom = 2n ** 128n;
  if (num % denom !== 0n) {
    return num / denom + 1n;
  } else {
    return num / denom;
  }
}

// The swap ran into the price limit before consuming the whole amount, so the
// step is bounded by the limit and the deltas are computed from it. Split out
// of computeStep because it is a self-contained ending, not a case that
// interleaves with the rest of the function.
function stepToLimit({
  sqrtRatio,
  liquidity,
  sqrtRatioLimit,
  amount,
  isToken1,
  fee,
}: {
  sqrtRatio: bigint;
  liquidity: bigint;
  sqrtRatioLimit: bigint;
  amount: bigint;
  isToken1: boolean;
  fee: bigint;
}): SwapResult {
  const isExactOutput = amount < 0n;
  const specifiedDelta = isToken1 ? amount1Delta : amount0Delta;
  const calculatedDelta = isToken1 ? amount0Delta : amount1Delta;

  const specifiedAmountDelta =
    specifiedDelta(sqrtRatioLimit, sqrtRatio, liquidity, amount >= 0n) *
    (isExactOutput ? -1n : 1n);
  const calculatedAmountDelta = calculatedDelta(
    sqrtRatioLimit,
    sqrtRatio,
    liquidity,
    isExactOutput,
  );

  // The fee is charged on whichever side the caller did not specify.
  if (isExactOutput) {
    const beforeFee = amountBeforeFee(calculatedAmountDelta, fee);
    return {
      consumedAmount: specifiedAmountDelta,
      calculatedAmount: beforeFee,
      feeAmount: beforeFee - calculatedAmountDelta,
      sqrtRatioNext: sqrtRatioLimit,
    };
  }

  const beforeFee = amountBeforeFee(specifiedAmountDelta, fee);
  return {
    consumedAmount: beforeFee,
    calculatedAmount: calculatedAmountDelta,
    feeAmount: beforeFee - specifiedAmountDelta,
    sqrtRatioNext: sqrtRatioLimit,
  };
}

export function computeStep({
  sqrtRatio,
  liquidity,
  sqrtRatioLimit,
  amount,
  isToken1,
  fee,
}: {
  sqrtRatio: bigint;
  liquidity: bigint;
  sqrtRatioLimit: bigint;
  amount: bigint;
  isToken1: boolean;
  fee: bigint;
}): SwapResult {
  if (amount === 0n || sqrtRatio === sqrtRatioLimit) {
    return noOp(sqrtRatio);
  }

  const increasing = isPriceIncreasing(amount, isToken1);

  if (sqrtRatioLimit < sqrtRatio === increasing) {
    throw new Error("computeStep: wrong direction");
  }

  if (liquidity === 0n) {
    return noOp(sqrtRatioLimit);
  }

  // On an exact-output swap the caller states the amount they want out, so the
  // fee is added on top afterwards rather than taken out of the input here.
  const priceImpactAmount =
    amount < 0n ? amount : amount - computeFee(amount, fee);

  const sqrtRatioNextFromAmount = (
    isToken1 ? nextSqrtRatioFromAmount1 : nextSqrtRatioFromAmount0
  )(sqrtRatio, liquidity, priceImpactAmount);

  if (
    sqrtRatioNextFromAmount === null ||
    sqrtRatioNextFromAmount > sqrtRatioLimit === increasing
  ) {
    return stepToLimit({
      sqrtRatio,
      liquidity,
      sqrtRatioLimit,
      amount,
      isToken1,
      fee,
    });
  }

  return stepWithinRange({
    sqrtRatio,
    sqrtRatioNext: sqrtRatioNextFromAmount,
    liquidity,
    amount,
    priceImpactAmount,
    isToken1,
    fee,
  });
}

// The whole amount fits before the price limit, so the step ends at the price
// the amount itself implies. Split out of computeStep for the same reason as
// stepToLimit: it is one of the function's endings, not a case woven through
// the rest of it.
function stepWithinRange({
  sqrtRatio,
  sqrtRatioNext,
  liquidity,
  amount,
  priceImpactAmount,
  isToken1,
  fee,
}: {
  sqrtRatio: bigint;
  sqrtRatioNext: bigint;
  liquidity: bigint;
  amount: bigint;
  priceImpactAmount: bigint;
  isToken1: boolean;
  fee: bigint;
}): SwapResult {
  // The amount was too small to move the price at all, so all of it is fee.
  if (sqrtRatioNext === sqrtRatio) {
    return {
      consumedAmount: amount,
      calculatedAmount: 0n,
      feeAmount: amount,
      sqrtRatioNext: sqrtRatio,
    };
  }

  const isExactOutput = amount < 0n;
  const calculatedDelta = isToken1 ? amount0Delta : amount1Delta;
  const calculatedAmountExcludingFee = calculatedDelta(
    sqrtRatioNext,
    sqrtRatio,
    liquidity,
    isExactOutput,
  );

  if (isExactOutput) {
    const includingFee = amountBeforeFee(calculatedAmountExcludingFee, fee);
    return {
      consumedAmount: amount,
      calculatedAmount: includingFee,
      sqrtRatioNext,
      feeAmount: includingFee - calculatedAmountExcludingFee,
    };
  }

  return {
    consumedAmount: amount,
    calculatedAmount: calculatedAmountExcludingFee,
    sqrtRatioNext,
    feeAmount: amount - priceImpactAmount,
  };
}
