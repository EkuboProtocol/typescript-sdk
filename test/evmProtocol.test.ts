import { describe, expect, it } from "bun:test";
import {
  applyEvmContinuousAuctionFee,
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
  getEvmContinuousAuctionLiveBid,
  parseEvmContinuousAuctionState,
  type EvmContinuousAuctionBid,
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

describe("EVM continuous auction", () => {
  const ONE_PERCENT = 42_949_672n;
  const FIVE_BPS = 2_147_483n;
  const THIRTY_PERCENT = 1_288_490_188n;
  const bid = (start: bigint, end: bigint, fee: bigint) =>
    ({
      bidder: `0x${"01".repeat(32)}`,
      rate: 1_000_000_000_000n,
      executor: MINTER,
      start,
      end,
      fee,
    }) as EvmContinuousAuctionBid;

  it("parses the auctions() result and treats an empty next bid as none", () => {
    const empty = {
      bidder: `0x${"00".repeat(32)}` as Hex,
      rate: 0n,
      executor: `0x${"00".repeat(20)}` as Hex,
      start: 0,
      end: 0,
      fee: 0,
    };
    const current = { ...bid(50n, 1_000n, ONE_PERCENT), start: 50, end: 1_000 };
    expect(
      parseEvmContinuousAuctionState([current, empty, 100, 7n, 9n]),
    ).toEqual({
      current: bid(50n, 1_000n, ONE_PERCENT),
      next: null,
      lastSettled: 100n,
    });
    expect(parseEvmContinuousAuctionState([empty, current, 49n]).next).toEqual(
      bid(50n, 1_000n, ONE_PERCENT),
    );
  });

  it("finds the live bid like _activeBid and closes the pool without one", () => {
    const incumbent = bid(50n, 1_000n, ONE_PERCENT);
    const next = bid(101n, 200n, 0n);
    const state = { current: incumbent, next, lastSettled: 100n };
    expect(getEvmContinuousAuctionLiveBid(state, 49n)).toBeNull();
    expect(getEvmContinuousAuctionLiveBid(state, 100n)).toBe(incumbent);
    expect(getEvmContinuousAuctionLiveBid(state, 101n)).toBe(next);
    // The next bid's end does not revive the displaced incumbent.
    expect(getEvmContinuousAuctionLiveBid(state, 200n)).toBeNull();
    expect(
      getEvmContinuousAuctionLiveBid({ ...state, next: null }, 1_000n),
    ).toBeNull();
  });

  // Core swaps through the extension at evm-contracts 4be93a5 (EKU-158 fixture generator):
  // [specified amount, executor's calculated amount, outsider's calculated amount].
  const fixtures: [bigint, [bigint, bigint, bigint][]][] = [
    [
      ONE_PERCENT,
      [
        [10n ** 17n, 99_997_000_766_373_173n, 98_997_030_781_060_512n],
        [-3n * 10n ** 17n, 300_026_943_863_093_729n, 303_057_518_985_207_167n],
        [4n * 10n ** 17n, 399_952_994_650_492_787n, 395_953_464_793_384_319n],
        [-2n * 10n ** 17n, 200_011_998_014_052_826n, 202_032_321_180_702_105n],
        [10n ** 15n, 999_999_700_067_247n, 989_999_703_290_091n],
      ],
    ],
    [
      FIVE_BPS,
      [
        [10n ** 17n, 99_999_580_010_793_784n, 99_949_580_235_875_749n],
        [-3n * 10n ** 17n, 300_003_779_966_357_745n, 300_153_856_849_497_004n],
        [4n * 10n ** 17n, 399_993_280_257_362_721n, 399_793_283_677_582_728n],
        [-2n * 10n ** 17n, 200_001_679_977_996_018n, 200_101_730_813_212_425n],
        [10n ** 15n, 999_999_957_998_054n, 999_499_958_169_929n],
      ],
    ],
    [
      THIRTY_PERCENT,
      [
        [10n ** 17n, 90_909_090_909_090_909n, 63_636_363_653_296_774n],
        [-3n * 10n ** 17n, 428_571_428_571_428_572n, 612_244_897_796_270_105n],
        [4n * 10n ** 17n, 285_714_285_714_285_714n, 200_000_000_053_218_432n],
        [-2n * 10n ** 17n, 250_000_000_000_000_000n, 357_142_857_047_824_228n],
        [10n ** 15n, 999_000_999_000_998n, 699_300_699_486_777n],
      ],
    ],
  ];

  it("charges outsiders the bid fee like the contract", () => {
    for (const [fee, cases] of fixtures) {
      for (const [amount, holder, outsider] of cases) {
        const result = applyEvmContinuousAuctionFee({
          amount,
          calculatedAmount: holder,
          fee,
        });
        expect(result.calculatedAmount).toBe(outsider);
        expect(result.feeAmount).toBe(
          amount >= 0n ? holder - outsider : outsider - holder,
        );
      }
    }
  });

  it("is fee-free at a zero fee and rejects out-of-range inputs", () => {
    expect(
      applyEvmContinuousAuctionFee({
        amount: -1n,
        calculatedAmount: 5n,
        fee: 0n,
      }),
    ).toEqual({ calculatedAmount: 5n, feeAmount: 0n });
    expect(() =>
      applyEvmContinuousAuctionFee({
        amount: 1n,
        calculatedAmount: 5n,
        fee: 1n << 32n,
      }),
    ).toThrow("fee must be a uint32");
    expect(() =>
      applyEvmContinuousAuctionFee({
        amount: -1n,
        calculatedAmount: 1n << 126n,
        fee: 1n << 31n,
      }),
    ).toThrow("AMOUNT_BEFORE_FEE_OVERFLOW");
  });
});
