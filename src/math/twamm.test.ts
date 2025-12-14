import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateNextSqrtRatio, exp, sqrt } from "./twamm";

const TEST_CASES: {
  description?: string;
  sqrtRatio: bigint;
  liquidity: bigint;
  token0SaleRate: bigint;
  token1SaleRate: bigint;
  timeElapsed: bigint;
  fee: bigint;
  expected: bigint;
}[] = [
  {
    description: "liquidity is zero, price is sqrtSaleRatio",
    sqrtRatio: 0n,
    liquidity: 0n,
    token0SaleRate: (10n ** 18n) << 32n,
    token1SaleRate: (10n ** 18n) << 32n,
    timeElapsed: 0n,
    fee: 0n,
    expected: 340282366920938463463374607431768211456n,
  },
  {
    description: "large exponent (> 88), price is sqrtSaleRatio",
    sqrtRatio: 1n << 128n,
    liquidity: 1n,
    token0SaleRate: (10n ** 18n) << 32n,
    token1SaleRate: (1980n * 10n ** 18n) << 32n,
    timeElapsed: 1n,
    fee: 0n,
    expected: 15141609448466370575819539296664158208000n,
  },
  {
    description: "low liquidity, same sale rate",
    sqrtRatio: 2n << 128n,
    liquidity: 1n,
    token0SaleRate: (10n ** 18n) << 32n,
    token1SaleRate: (10n ** 18n) << 32n,
    timeElapsed: 1n,
    fee: 0n,
    expected: 340282366920938463463374607431768211456n,
  },
  {
    description: "low liquidity, token0SaleRate > token1SaleRate",
    sqrtRatio: 1n << 128n,
    liquidity: 1n,
    token0SaleRate: (2n * 10n ** 18n) << 32n,
    token1SaleRate: (10n ** 18n) << 32n,
    timeElapsed: 16n,
    fee: 0n,
    expected: 240615969168004511538585310832300654592n,
  },
  {
    description: "low liquidity, token1SaleRate > token0SaleRate",
    sqrtRatio: 1n << 128n,
    liquidity: 1n,
    token0SaleRate: (10n ** 18n) << 32n,
    token1SaleRate: (2n * 10n ** 18n) << 32n,
    timeElapsed: 16n,
    fee: 0n,
    expected: 481231938336009023077170621664601309184n,
  },
  {
    description: "high liquidity, same sale rate",
    sqrtRatio: 2n << 128n,
    liquidity: 1_000_000n * 10n ** 18n,
    token0SaleRate: (10n ** 18n) << 32n,
    token1SaleRate: (10n ** 18n) << 32n,
    timeElapsed: 1n,
    fee: 0n,
    expected: 680563712996817854544971649595310676716n,
  },
  {
    description: "high liquidity, token0SaleRate > token1SaleRate",
    sqrtRatio: 1n << 128n,
    liquidity: 1_000_000n * 10n ** 18n,
    token0SaleRate: (2n * 10n ** 18n) << 32n,
    token1SaleRate: (10n ** 18n) << 32n,
    timeElapsed: 1n,
    fee: 0n,
    expected: 340282026639252106118798709911530476351n,
  },
  {
    description: "high liquidity, token1SaleRate > token0SaleRate",
    sqrtRatio: 1n << 128n,
    liquidity: 1_000_000n * 10n ** 18n,
    token0SaleRate: (10n ** 18n) << 32n,
    token1SaleRate: (2n * 10n ** 18n) << 32n,
    timeElapsed: 1n,
    fee: 0n,
    expected: 340282707202965102147504331693640508329n,
  },
  {
    description: "round in direction of price",
    sqrtRatio: 481231811499356508086519009265716982182n,
    liquidity: 70710696755630728101718334n,
    token0SaleRate: 10526880627450980392156862745n,
    token1SaleRate: 10526880627450980392156862745n,
    timeElapsed: 2040n,
    fee: 0n,
    expected: 481207752340103616358571818546900413164n,
  },
];

describe("calculateNextSqrtRatio", () => {
  for (const testCase of TEST_CASES) {
    it(testCase.description || "test case", () => {
      assert.strictEqual(
        calculateNextSqrtRatio(
          testCase.sqrtRatio,
          testCase.liquidity,
          testCase.token0SaleRate,
          testCase.token1SaleRate,
          testCase.timeElapsed,
          testCase.fee,
        ),
        testCase.expected,
      );
    });
  }
});

describe("exp", () => {
  const cases: [bigint, bigint][] = [
    [0x1n, 340282366920938463481821351505477763073n],
    [0x10n, 340282366920938463758522512611121037439n],
    [0x100n, 340282366920938468185741090301413457919n],
    [0x1000n, 340282366920938539021238333346100019199n],
    [0x10000n, 340282366920939672389194222063090401279n],
    [0x100000n, 340282366920957806276488442048319324159n],
    [0x1000000n, 340282366921247948473196093237981347883n],
    [0x10000000n, 340282366925890223620552157328383847083n],
    [0x100000000n, 340282367000166625986862317062882765483n],
    [0x20000000000000000n, 2514365498655717699434277416465328696985n],
    [1n << 64n, 924983374546220337150911035843336795078n],
    [
      88n << 64n,
      56202269414179362208214868742863362868341779313762687677660940959816606662721n,
    ],
  ];

  for (const [num, expected] of cases) {
    it(`test ${num}`, () => {
      assert.strictEqual(exp(num), expected);
    });
  }
});

describe("sqrt", () => {
  const cases: [bigint, bigint][] = [
    [2n, 1n],
    [1n << 32n, 65536n],
    [1n << 64n, 4294967296n],
    [(10n ** 18n) << 32n, 65536000000000n],
  ];

  for (const [num, expected] of cases) {
    it(`test ${num}`, () => {
      assert.strictEqual(sqrt(num), expected);
    });
  }
});
