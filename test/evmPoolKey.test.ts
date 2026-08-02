import { describe, expect, it } from "bun:test";
import {
  decodeEvmPoolConfig,
  deriveEvmPoolId,
  encodeEvmConcentratedPoolConfig,
  encodeEvmPoolKey,
  encodeEvmStableswapPoolConfig,
} from "../src/evmPoolKey";

const token0 = "0x0000000000000000000000000000000000000000" as const;
const token1 = "0x1111111111111111111111111111111111111111" as const;

describe("EVM v3 pool keys", () => {
  it("round-trips an exact uint64 concentrated config", () => {
    const config = encodeEvmConcentratedPoolConfig({
      fee: (1n << 64n) - 1n,
      tickSpacing: 1024,
      extension: token0,
    });
    expect(config).toBe(
      "0x0000000000000000000000000000000000000000ffffffffffffffff80000400",
    );
    expect(decodeEvmPoolConfig(config)).toEqual({
      config,
      extension: token0,
      fee: (1n << 64n) - 1n,
      typeConfig: "0x80000400",
      poolType: "concentrated",
      discriminatorBitSet: true,
      tickSpacing: 1024,
      stableswapParams: null,
    });
  });

  it("round-trips signed stableswap center ticks and full range", () => {
    const config = encodeEvmStableswapPoolConfig({
      fee: 7n,
      centerTick: -32,
      amplification: 4,
      extension: token1,
    });
    expect(decodeEvmPoolConfig(config)).toMatchObject({
      fee: 7n,
      poolType: "stableswap",
      stableswapParams: { centerTick: -32, amplification: 4 },
    });
    const fullRange = encodeEvmStableswapPoolConfig({
      fee: 0n,
      centerTick: 0,
      amplification: 0,
      extension: token0,
    });
    expect(decodeEvmPoolConfig(fullRange).poolType).toBe("full_range");
  });

  it("ABI-encodes PoolKey and passes it to the supplied hash", () => {
    const config = encodeEvmConcentratedPoolConfig({
      fee: 0n,
      tickSpacing: 1024,
      extension: token0,
    });
    const encoded = encodeEvmPoolKey({ token0, token1, config });
    expect(encoded.length).toBe(2 + 96 * 2);
    expect(deriveEvmPoolId({ token0, token1, config }, (value) => value)).toBe(
      encoded,
    );
  });
});

