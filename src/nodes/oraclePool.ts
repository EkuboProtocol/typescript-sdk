import { MAX_TICK_SPACING } from "../math/tick";
import { BasePool } from "./basePool";
import {
  BasePoolResources,
  BasePoolState,
  NodeKey,
  Quote,
  QuoteNode,
  QuoteParams,
  Tick,
} from "./quoteNode";

export interface OracleResources extends BasePoolResources {
  readonly snapshotUpdated: boolean;
}

export interface OraclePoolState extends BasePoolState {
  readonly lastSnapshotTime: bigint;
}

export class OraclePool implements QuoteNode<OracleResources, OraclePoolState> {
  private readonly extension: bigint;
  private readonly basePool: BasePool;
  private readonly lastSnapshotTime: bigint;

  constructor({
    token0,
    token1,
    sqrtRatio,
    liquidity,
    tick,
    sortedTicks,
    extension,
    lastSnapshotTime,
  }: {
    token0: bigint;
    token1: bigint;
    extension: bigint;
    sqrtRatio: bigint;
    liquidity: bigint;
    tick: number;
    sortedTicks: Tick[];
    lastSnapshotTime: bigint;
  }) {
    this.basePool = new BasePool({
      token0,
      token1,
      fee: 0n,
      tickSpacing: MAX_TICK_SPACING,
      sortedTicks,
      tick,
      sqrtRatio,
      liquidity,
    });
    this.extension = extension;
    this.lastSnapshotTime = lastSnapshotTime;
  }

  public get key(): NodeKey {
    return { ...this.basePool.key, extension: this.extension };
  }

  public get state(): Readonly<OraclePoolState> {
    return { ...this.basePool.state, lastSnapshotTime: this.lastSnapshotTime };
  }

  public get sortedTicks(): Tick[] {
    return this.basePool.sortedTicks;
  }

  quote(
    params: QuoteParams<OraclePoolState>
  ): Quote<OracleResources, OraclePoolState> {
    const quote = this.basePool.quote(params);

    const state = params.overrideState ?? this.state;
    const blockTimestamp = BigInt(params.meta.block.time);
    const snapshotUpdated = state.lastSnapshotTime < blockTimestamp;

    return {
      ...quote,
      executionResources: {
        ...quote.executionResources,
        snapshotUpdated,
      },
      stateAfter: {
        ...state,
        lastSnapshotTime: snapshotUpdated
          ? blockTimestamp
          : state.lastSnapshotTime,
      },
    };
  }

  combineResources(
    resource: OracleResources,
    additionalResources: OracleResources
  ): OracleResources {
    return {
      ...this.basePool.combineResources(resource, additionalResources),
      snapshotUpdated:
        resource.snapshotUpdated || additionalResources.snapshotUpdated,
    };
  }

  initialResources(): OracleResources {
    return {
      ...this.basePool.initialResources(),
      snapshotUpdated: false,
    };
  }

  hasLiquidity(): boolean {
    return this.basePool.hasLiquidity();
  }
}
