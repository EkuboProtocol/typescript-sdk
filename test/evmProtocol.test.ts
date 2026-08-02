import { describe, expect, it } from "bun:test";
import {
  calculateEvmTwammMaxSaleRate,
  decodeEvmAuctionConfig,
  decodeEvmTwammOrderConfig,
  deriveEvmAuctionTokenId,
  deriveEvmIndexedSalt,
  deriveEvmTwammOrderTokenId,
  deriveEvmVeTokenId,
  encodeEvmAuctionConfig,
  encodeEvmSaltedTokenPreimage,
  encodeEvmTwammOrderConfig,
  type Hex,
} from "../src";

const MINTER = "0x1111111111111111111111111111111111111111" as const;
const CONTRACT = "0x2222222222222222222222222222222222222222" as const;
const SALT = `0x${"33".repeat(32)}` as Hex;
const HASH = `0x${"ff".repeat(32)}` as Hex;
const identityHash = (_value: Hex) => HASH;

describe("EVM protocol configs", () => {
  it("round-trips auction configs and validates the derived end time", () => {
    const input = {
      creatorFee: 123_456_789,
      isSellingToken1: true,
      minBoostDuration: 86_400,
      graduationPoolFee: 0x1111_2222_3333_4444n,
      graduationPoolTickSpacing: 60,
      startTime: 1_726_972_800n,
      auctionDuration: 604_800,
    };
    const encoded = encodeEvmAuctionConfig(input);
    expect(encoded).toHaveLength(66);
    expect(decodeEvmAuctionConfig(encoded)).toEqual({
      ...input,
      endTime: input.startTime + BigInt(input.auctionDuration),
    });
    expect(() =>
      encodeEvmAuctionConfig({ ...input, endTime: input.startTime }),
    ).toThrow("endTime must equal");
  });

  it("round-trips TWAMM order configs without rounding uint64 fields", () => {
    const input = {
      fee: (1n << 64n) - 1n,
      isSellingToken1: true,
      startTime: 1_700_000_000n,
      endTime: 1_700_086_400n,
    };
    expect(decodeEvmTwammOrderConfig(encodeEvmTwammOrderConfig(input))).toEqual(
      input,
    );
    expect(() =>
      encodeEvmTwammOrderConfig({ ...input, fee: 1n << 64n }),
    ).toThrow("fee must be a uint64");
  });

  it("computes TWAMM max sale rate from bigint timestamps", () => {
    expect(
      calculateEvmTwammMaxSaleRate({
        amount: 1000n,
        startTime: 1100n,
        endTime: 2100n,
        pendingTimestamp: 1000n,
        deadlineSeconds: 120n,
      }),
    ).toBe((1000n << 32n) / 980n);
    expect(
      calculateEvmTwammMaxSaleRate({
        amount: 1000n,
        startTime: 0n,
        endTime: 1000n,
        pendingTimestamp: 1000n,
      }),
    ).toBe(1000n << 32n);
  });
});

describe("salted EVM token IDs", () => {
  const input = {
    minter: MINTER,
    salt: SALT,
    chainId: 4663n,
    contract: CONTRACT,
  };

  it("ABI-encodes the four fixed-width words hashed by managers", () => {
    expect(encodeEvmSaltedTokenPreimage(input)).toBe(
      `0x${"11".repeat(20).padStart(64, "0")}${"33".repeat(32)}${4663n.toString(16).padStart(64, "0")}${"22".repeat(20).padStart(64, "0")}`,
    );
  });

  it("applies each manager's exact token-ID truncation", () => {
    expect(deriveEvmAuctionTokenId(input, identityHash)).toBe(
      (1n << 256n) - 1n,
    );
    expect(deriveEvmTwammOrderTokenId(input, identityHash)).toBe(
      (1n << 128n) - 1n,
    );
    expect(deriveEvmVeTokenId(input, identityHash)).toBe((1n << 192n) - 1n);
  });

  it("derives indexed salts from two bytes32 ABI words", () => {
    let preimage: Hex | undefined;
    deriveEvmIndexedSalt(SALT, 7n, (value) => {
      preimage = value;
      return HASH;
    });
    expect(preimage).toBe(`0x${"33".repeat(32)}${"7".padStart(64, "0")}`);
  });
});
