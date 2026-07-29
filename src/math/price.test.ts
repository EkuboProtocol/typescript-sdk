import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextSqrtRatioFromAmount0, nextSqrtRatioFromAmount1 } from "./price";
import { STARKNET_MAX_TICK, toSqrtRatio } from "./tick";

describe("nextSqrtRatioFromAmount0", () => {
  it("add_price_goes_down", () => {
    assert.strictEqual(
      nextSqrtRatioFromAmount0(1n << 128n, 1000000n, 1000n),
      339942424496442021441932674757011200256n,
    );
  });

  it("exact_out_overflow", () => {
    assert.strictEqual(
      nextSqrtRatioFromAmount0(1n << 128n, 1n, -100000000000000n),
      null,
    );
  });

  it("exact_in_cant_underflow", () => {
    assert.strictEqual(
      nextSqrtRatioFromAmount0(1n << 128n, 1n, 100000000000000n),
      3402823669209350606397054n,
    );
  });

  it("retains full precision at high Starknet prices", () => {
    assert.strictEqual(
      nextSqrtRatioFromAmount0(
        toSqrtRatio(STARKNET_MAX_TICK - 1, "starknet"),
        0x8000000000000000n,
        1n,
      ),
      2092366731423230380742239773058784341020777786053236834275n,
    );
  });

  it("retains full precision with a denominator wider than u256", () => {
    assert.strictEqual(
      nextSqrtRatioFromAmount0(
        2664380729359047878130455396782445615002136682488425930791n,
        42531265332720989308560689227437612046n,
        7478763362817280620612385270656745576n,
      ),
      1935164803785000531764469386445244376423n,
    );
  });

  it("rounds exact input towards the current price", () => {
    assert.strictEqual(
      nextSqrtRatioFromAmount0(1n << 128n, 100n, 100n),
      1n << 127n,
    );
  });

  it("sub_price_goes_up", () => {
    assert.strictEqual(
      nextSqrtRatioFromAmount0(1n << 128n, 100000000000n, -1000n),
      340282370323762166700996274441730955874n,
    );
  });
});

describe("nextSqrtRatioFromAmount1", () => {
  it("add_price_goes_up", () => {
    assert.strictEqual(
      nextSqrtRatioFromAmount1(1n << 128n, 1000000n, 1000n),
      340622649287859401926837982039199979667n,
    );
  });

  it("exact_out_overflow", () => {
    assert.strictEqual(
      nextSqrtRatioFromAmount1(1n << 128n, 1n, -100000000000000n),
      null,
    );
  });

  it("exact_in_cant_underflow", () => {
    assert.strictEqual(
      nextSqrtRatioFromAmount1(1n << 128n, 1n, 100000000000000n),
      34028236692094186628704381681640284520207431768211456n,
    );
  });

  it("sub_price_goes_down", () => {
    assert.strictEqual(
      nextSqrtRatioFromAmount1(1n << 128n, 100000000000n, -1000n),
      340282363518114794253989972798022137138n,
    );
  });
});
