import { MAX_U256 } from "./constants";

const toBig = (value: unknown, name: string): bigint => {
  if (typeof value === "bigint") return value;
  try {
    return BigInt(value as any);
  } catch (err) {
    const printed =
      value === null || value === undefined ? String(value) : value.toString();
    const ctor =
      value && typeof value === "object" && "constructor" in value
        ? (value as { constructor: { name: string } }).constructor.name
        : undefined;
    throw new TypeError(
      `${name} must be bigint-compatible, received ${printed} (type ${typeof value}${
        ctor ? `, ctor ${ctor}` : ""
      })`,
    );
  }
};

export function nextSqrtRatioFromAmount0(
  sqrtRatio: bigint,
  liquidity: bigint,
  amount0: bigint,
): bigint | null {
  const sqrtRatioFixed = toBig(sqrtRatio, "sqrtRatio");
  const liquidityFixed = toBig(liquidity, "liquidity");
  const amount0Fixed = toBig(amount0, "amount0");

  if (amount0Fixed === 0n) return sqrtRatioFixed;

  if (liquidityFixed === 0n) throw new Error("NO_LIQUIDITY");

  const numerator1 = liquidityFixed << 128n;

  // because quotient is rounded down, this price movement is also rounded towards sqrt_ratio
  if (amount0Fixed < 0n) {
    const product = amount0Fixed * -1n * sqrtRatioFixed;

    if (product >= MAX_U256) {
      return null;
    }

    const denominator = numerator1 - product;

    if (denominator < 0n) {
      return null;
    }

    const num = numerator1 * sqrtRatioFixed;

    const result = num / denominator + (num % denominator === 0n ? 0n : 1n);

    if (result > MAX_U256) {
      return null;
    }

    return result;
  } else {
    const denomP1 = numerator1 / sqrtRatioFixed;

    const denom = denomP1 + amount0Fixed;
    const quotient = numerator1 / denom;
    const remainder = numerator1 % denom;

    if (remainder === 0n) return quotient;
    const sum = quotient + 1n;
    if (sum > MAX_U256) return null;
    return sum;
  }
}

export function nextSqrtRatioFromAmount1(
  sqrtRatio: bigint,
  liquidity: bigint,
  amount1: bigint,
): bigint | null {
  const sqrtRatioFixed = toBig(sqrtRatio, "sqrtRatio");
  const liquidityFixed = toBig(liquidity, "liquidity");
  const amount1Fixed = toBig(amount1, "amount1");

  if (amount1Fixed === 0n) return sqrtRatioFixed;

  if (liquidityFixed === 0n) throw new Error("NO_LIQUIDITY");

  const amountShifted = amount1Fixed << 128n;
  const quotient = amountShifted / liquidityFixed;
  const remainder = amountShifted % liquidityFixed;

  // because quotient is rounded down, this price movement is also rounded towards sqrt_ratio
  if (amount1Fixed < 0n) {
    // adding amount1, taking out amount0
    const res = sqrtRatioFixed + quotient;
    if (res < 0n) {
      return null;
    }
    if (remainder === 0n) {
      return res;
    } else {
      if (res != 0n) {
        return res - 1n;
      } else {
        return null;
      }
    }
  } else {
    // adding amount1, taking out amount0, price goes up
    const res = sqrtRatioFixed + quotient;
    if (res > MAX_U256) {
      return null;
    } else {
      return res;
    }
  }
}
