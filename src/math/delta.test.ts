import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { amount0Delta, amount1Delta } from "./delta";
import {
  EVM_MAX_SQRT_RATIO,
  EVM_MIN_SQRT_RATIO,
  STARKNET_MAX_SQRT_RATIO,
  STARKNET_MIN_SQRT_RATIO,
} from "./tick";

describe("amount0Delta", () => {
  it("price_down", () => {
    assert.strictEqual(
      amount0Delta(
        339942424496442021441932674757011200255n,
        0x100000000000000000000000000000000n,
        1000000n,
        false,
      ),
      1000n,
    );
  });

  it("price_down_reverse", () => {
    assert.strictEqual(
      amount0Delta(
        0x100000000000000000000000000000000n,
        339942424496442021441932674757011200255n,
        1000000n,
        false,
      ),
      1000n,
    );
  });

  it("price example down", () => {
    assert.strictEqual(
      amount0Delta(
        0x100000000000000000000000000000000n,
        34028236692093846346337460743176821145n + (1n << 128n),
        1000000000000000000n,
        false,
      ),
      90909090909090909n,
    );
  });

  it("price example up", () => {
    assert.strictEqual(
      amount0Delta(
        0x100000000000000000000000000000000n,
        34028236692093846346337460743176821145n + (1n << 128n),
        1000000000000000000n,
        true,
      ),
      90909090909090910n,
    );
  });
});

describe("amount1Delta", () => {
  it("price_down", () => {
    assert.strictEqual(
      amount1Delta(
        339942424496442021441932674757011200255n,
        0x100000000000000000000000000000000n,
        1000000n,
        false,
      ),
      999n,
    );
  });

  it("price_down_reverse", () => {
    assert.strictEqual(
      amount1Delta(
        0x100000000000000000000000000000000n,
        339942424496442021441932674757011200255n,
        1000000n,
        false,
      ),
      999n,
    );
  });

  it("price_up", () => {
    assert.strictEqual(
      amount1Delta(
        340622989910849312776150758189957120n + (1n << 128n),
        0x100000000000000000000000000000000n,
        1000000n,
        false,
      ),
      1001n,
    );
  });

  it("price_up_reverse", () => {
    assert.strictEqual(
      amount1Delta(
        0x100000000000000000000000000000000n,
        339942424496442021441932674757011200255n,
        1000000n,
        true,
      ),
      1000n,
    );
  });

  it("price_example_down", () => {
    assert.strictEqual(
      amount1Delta(
        0x100000000000000000000000000000000n,
        309347606291762239512158734028880192232n,
        1000000000000000000n,
        false,
      ),
      90909090909090909n,
    );
  });

  it("price_example_up", () => {
    assert.strictEqual(
      amount1Delta(
        0x100000000000000000000000000000000n,
        309347606291762239512158734028880192232n,
        1000000000000000000n,
        true,
      ),
      90909090909090910n,
    );
  });

  it("no overflow half price range (evm)", () => {
    assert.strictEqual(
      amount1Delta(
        0x100000000000000000000000000000000n,
        EVM_MAX_SQRT_RATIO,
        0xffffffffffffffffn,
        false,
      ),
      340274119756928397675478831269759003622n,
    );
  });

  it("no overflow half price range (starknet)", () => {
    assert.strictEqual(
      amount1Delta(
        0x100000000000000000000000000000000n,
        STARKNET_MAX_SQRT_RATIO,
        0xffffffffffffffffn,
        false,
      ),
      340282286429718909724583623827301092853n,
    );
  });

  it("should panic (evm)", () => {
    assert.throws(
      () =>
        amount1Delta(
          EVM_MIN_SQRT_RATIO,
          EVM_MAX_SQRT_RATIO,
          0xffffffffffffffffffffffffffffffffn,
          false,
        ),
      /AMOUNT1_DELTA_OVERFLOW_U256/,
    );
  });

  it("should panic (starknet)", () => {
    assert.throws(
      () =>
        amount1Delta(
          STARKNET_MIN_SQRT_RATIO,
          STARKNET_MAX_SQRT_RATIO,
          0xffffffffffffffffffffffffffffffffn,
          false,
        ),
      /AMOUNT1_DELTA_OVERFLOW_U256/,
    );
  });
});
