import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextSqrtRatioFromAmount0, nextSqrtRatioFromAmount1 } from "./price";

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
