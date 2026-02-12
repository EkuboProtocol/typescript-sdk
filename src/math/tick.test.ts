import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EVM_MAX_SQRT_RATIO,
  EVM_MAX_TICK,
  EVM_MIN_SQRT_RATIO,
  EVM_MIN_TICK,
  STARKNET_MAX_SQRT_RATIO,
  STARKNET_MAX_TICK,
  STARKNET_MIN_SQRT_RATIO,
  STARKNET_MIN_TICK,
  approximateNumberOfTickSpacingsCrossed,
  fixedSqrtRatioToFloat,
  floatSqrtRatioToFixed,
  toSqrtRatio,
} from "./tick";

describe("toSqrtRatio", () => {
  it("evm: min tick", () => {
    assert.strictEqual(toSqrtRatio(EVM_MIN_TICK, "evm"), EVM_MIN_SQRT_RATIO);
  });
  it("evm: max tick", () => {
    assert.strictEqual(toSqrtRatio(EVM_MAX_TICK, "evm"), EVM_MAX_SQRT_RATIO);
  });
  it("evm: zero", () => {
    assert.strictEqual(toSqrtRatio(0, "evm"), 1n << 128n);
  });

  it("starknet: min tick", () => {
    assert.strictEqual(
      toSqrtRatio(STARKNET_MIN_TICK, "starknet"),
      STARKNET_MIN_SQRT_RATIO,
    );
  });
  it("starknet: max tick", () => {
    assert.strictEqual(
      toSqrtRatio(STARKNET_MAX_TICK, "starknet"),
      STARKNET_MAX_SQRT_RATIO,
    );
  });
  it("starknet: zero", () => {
    assert.strictEqual(toSqrtRatio(0, "starknet"), 1n << 128n);
  });

  it("sample positive ticks (both chains)", () => {
    const cases = [
      ["evm", 1_000_000, 561030636129153856579134353873645338624n],
      ["evm", 10_000_000, 50502254805927926084423855178401471004672n],
      ["starknet", 1_000_000, 561030636129153856592777659729523183729n],
      ["starknet", 10_000_000, 50502254805927926084427918474025309948677n],
    ] as const;

    for (const [chain, tick, expected] of cases) {
      assert.strictEqual(toSqrtRatio(tick, chain), expected);
    }
  });

  it("sample negative ticks (both chains)", () => {
    const cases = [
      ["evm", -1_000_000, 206391740095027370700312310528859963392n],
      ["evm", -10_000_000, 2292810285051363400276741630355046400n],
      ["starknet", -1_000_000, 206391740095027370700312310531588921767n],
      ["starknet", -10_000_000, 2292810285051363400276741638672651165n],
    ] as const;
    for (const [chain, tick, expected] of cases) {
      assert.strictEqual(toSqrtRatio(tick, chain), expected);
    }
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
  it("evm: max to min", () => {
    assert.strictEqual(
      approximateNumberOfTickSpacingsCrossed(
        EVM_MAX_SQRT_RATIO,
        EVM_MIN_SQRT_RATIO,
        1,
      ),
      706954,
    );
  });
  it("starknet: max to min", () => {
    assert.strictEqual(
      approximateNumberOfTickSpacingsCrossed(
        STARKNET_MAX_SQRT_RATIO,
        STARKNET_MIN_SQRT_RATIO,
        1,
      ),
      706955,
    );
  });
  it("evm: min to max", () => {
    assert.strictEqual(
      approximateNumberOfTickSpacingsCrossed(
        EVM_MIN_SQRT_RATIO,
        EVM_MAX_SQRT_RATIO,
        1,
      ),
      706954,
    );
  });
  it("starknet: min to max", () => {
    assert.strictEqual(
      approximateNumberOfTickSpacingsCrossed(
        STARKNET_MIN_SQRT_RATIO,
        STARKNET_MAX_SQRT_RATIO,
        1,
      ),
      706955,
    );
  });
  it("evm: min to max 1k tick spacing", () => {
    assert.strictEqual(
      approximateNumberOfTickSpacingsCrossed(
        EVM_MIN_SQRT_RATIO,
        EVM_MAX_SQRT_RATIO,
        1000,
      ),
      706,
    );
  });
  it("starknet: min to max 1k tick spacing", () => {
    assert.strictEqual(
      approximateNumberOfTickSpacingsCrossed(
        STARKNET_MIN_SQRT_RATIO,
        STARKNET_MAX_SQRT_RATIO,
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
    const cases = [EVM_MIN_SQRT_RATIO, EVM_MAX_SQRT_RATIO, 1n << 128n];
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
