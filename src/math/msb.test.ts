import assert from "node:assert/strict";
import { describe, it } from "node:test";

import msb from "./msb";

describe("msb", () => {
  it("zero or negative", () => {
    assert.throws(() => msb(0n), /x must be positive/);
    assert.throws(() => msb(-1n), /x must be positive/);
  });

  it("large", () => {
    assert.throws(() => msb(1n << 128n), /x too large/);
  });

  it("small numbers", () => {
    assert.strictEqual(msb(1n), 0);
    assert.strictEqual(msb(2n), 1);
    assert.strictEqual(msb(3n), 1);
    assert.strictEqual(msb(4n), 2);
    assert.strictEqual(msb(5n), 2);
    assert.strictEqual(msb(6n), 2);
    assert.strictEqual(msb(7n), 2);
    assert.strictEqual(msb(8n), 3);
    assert.strictEqual(msb(9n), 3);
  });

  it("large numbers", () => {
    assert.strictEqual(msb(2n ** 128n - 1n), 127);
    assert.strictEqual(msb(2n ** 128n - 2n), 127);
    assert.strictEqual(msb(2n ** 128n - 3n), 127);
    assert.strictEqual(msb(2n ** 128n - 4n), 127);
    assert.strictEqual(msb(2n ** 64n + 1n), 64);
    assert.strictEqual(msb(2n ** 64n), 64);
    assert.strictEqual(msb(2n ** 64n - 1n), 63);
  });
});
