import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MAX_TICK_SPACING,
  MIN_SQRT_RATIO,
  MIN_TICK,
  approximateNumberOfTickSpacingsCrossed,
  fixedSqrtRatioToFloat,
  floatSqrtRatioToFixed,
  toSqrtRatio,
} from "./tick";

describe("toSqrtRatio", () => {
  it("min tick", () => {
    assert.strictEqual(toSqrtRatio(MIN_TICK), MIN_SQRT_RATIO);
  });
  it("max tick", () => {
    assert.strictEqual(toSqrtRatio(MAX_TICK), MAX_SQRT_RATIO);
  });
  it("zero", () => {
    assert.strictEqual(toSqrtRatio(0), 1n << 128n);
  });

  it("sample positive ticks", () => {
    assert.strictEqual(
      toSqrtRatio(1_000_000),
      561030636129153856579134353873645338624n,
    );
    assert.strictEqual(
      toSqrtRatio(10_000_000),
      50502254805927926084423855178401471004672n,
    );
  });

  it("sample negative ticks", () => {
    assert.strictEqual(
      toSqrtRatio(-1_000_000),
      206391740095027370700312310528859963392n,
    );
    assert.strictEqual(
      toSqrtRatio(-10_000_000),
      2292810285051363400276741630355046400n,
    );
  });
});

describe("approximateNumberOfTickSpacingsCrossed", () => {
  it("same price", () => {
    assert.strictEqual(
      approximateNumberOfTickSpacingsCrossed(1n << 128n, 1n << 128n, 1),
      0,
    );
  });
  it("price doubling 1 tick spacing", () => {
    assert.strictEqual(
      approximateNumberOfTickSpacingsCrossed(1n << 128n, 1n << 129n, 1),
      5523,
    );
  });
  it("price doubling 1000 tick spacing", () => {
    assert.strictEqual(
      approximateNumberOfTickSpacingsCrossed(1n << 128n, 1n << 129n, 1000),
      5,
    );
  });
  it("max to min", () => {
    assert.strictEqual(
      approximateNumberOfTickSpacingsCrossed(MAX_SQRT_RATIO, MIN_SQRT_RATIO, 1),
      706954,
    );
  });
  it("min to max", () => {
    assert.strictEqual(
      approximateNumberOfTickSpacingsCrossed(MIN_SQRT_RATIO, MAX_SQRT_RATIO, 1),
      706954,
    );
  });
  it("min to max 1k tick spacing", () => {
    assert.strictEqual(
      approximateNumberOfTickSpacingsCrossed(
        MIN_SQRT_RATIO,
        MAX_SQRT_RATIO,
        1000,
      ),
      706,
    );
  });
});

describe("sqrt ratio float <-> fixed conversions", () => {
  it("decodes float sqrt ratio", () => {
    const floatValue =
      0x123456789abcden | // mantissa
      (32n << 89n); // exponent
    const expectedFixed =
      (floatValue & 0x3fffffffffffffffffffffffn) << (2n + 32n);
    assert.strictEqual(floatSqrtRatioToFixed(floatValue), expectedFixed);
  });

  it("encodes then decodes without loss for min/max ratios", () => {
    const cases = [MIN_SQRT_RATIO, MAX_SQRT_RATIO, 1n << 128n];
    for (const sqrtRatio of cases) {
      const floatEncoded = fixedSqrtRatioToFloat(sqrtRatio);
      const decoded = floatSqrtRatioToFixed(floatEncoded);
      assert.strictEqual(decoded, sqrtRatio);
    }
  });

  it("chooses compact exponent that still fits mantissa", () => {
    const floatEncoded = fixedSqrtRatioToFloat(1n << 128n);
    const exponent = (floatEncoded >> 89n) & 0x7fn;
    assert.strictEqual(exponent, 64n);
  });
});
