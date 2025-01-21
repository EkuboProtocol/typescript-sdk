export interface BasePoolState {
  readonly sqrtRatio: bigint;
  readonly liquidity: bigint;
  readonly activeTickIndex: number;
}

export interface BasePoolResources {
  readonly noOverridePriceChange: number;
  readonly initializedTicksCrossed: number;
  readonly tickSpacingsCrossed: number;
}

export interface Quote<
  TResources extends BasePoolResources,
  TState extends BasePoolState
> {
  readonly consumedAmount: bigint;
  readonly calculatedAmount: bigint;
  readonly isPriceIncreasing: boolean;
  readonly stateAfter: TState;
  readonly executionResources: TResources;
  readonly feesPaid: bigint;
}

export interface NodeKey {
  readonly token0: bigint;
  readonly token1: bigint;
  readonly fee: bigint;
  readonly tickSpacing: number;
  readonly extension: bigint;
}

export interface TokenAmount {
  readonly token: bigint;
  readonly amount: bigint;
}

export interface Block {
  readonly number: number;
  readonly time: number;
}

export interface QuoteMeta {
  readonly block: Block;
}

export interface QuoteParams<TState extends BasePoolState | LimitOrderPoolState> {
  // The amount of token to swap. The token must be one of (token0, token1)
  readonly tokenAmount: TokenAmount;
  // The metadata for the block at which the swap is occurring
  readonly meta: QuoteMeta;
  // The limit to swap to
  readonly sqrtRatioLimit?: bigint;
  // Optionally replace the current state of the pool before executing the swap
  readonly overrideState?: TState;
}

export interface Tick {
  readonly tick: number;
  readonly liquidityDelta: bigint;
}

export interface QuoteNode<
  TResources extends BasePoolResources = BasePoolResources,
  TSwapState extends BasePoolState = BasePoolState
> {
  readonly key: NodeKey;
  readonly state: Readonly<TSwapState>;
  readonly sortedTicks: Tick[];

  /**
   * Returns the result of swapping against the pool with the given parameters
   * @param params the parameters of the swap
   */
  quote(params: QuoteParams<TSwapState>): Quote<TResources, TSwapState>;

  /**
   * Given resources from two different swaps on the same pool, compute the total resources
   * @param resource the initial resources consumed
   * @param additionalResources the additional resources consumed
   */
  combineResources(
    resource: TResources,
    additionalResources: TResources
  ): TResources;

  /**
   * Returns the resources consumed by a no-op swap
   */
  initialResources(): TResources;

  /**
   * Returns whether the pool has any useful liquidity at all. Should be a fast check for eliminating empty pools.
   */
  hasLiquidity(): boolean;
}

// LİMIT ORDER 
export interface LimitOrderPoolState {
  basePoolState: BasePoolState;
  tickIndicesReached?: [number, number] | null;
}
export interface LimitOrderPoolResources {
  basePoolResources: BasePoolResources;
  ordersPulled: number;
}

export interface QuoteLimitOrderPool<
  TResources extends LimitOrderPoolResources,
  TState extends LimitOrderPoolState
> {
  readonly consumedAmount: bigint;
  readonly calculatedAmount: bigint;
  readonly isPriceIncreasing: boolean;
  readonly stateAfter: TState;
  readonly executionResources: TResources;
  readonly feesPaid: bigint;
}


export interface QuoteLimitOrderNode<
  TResources extends LimitOrderPoolResources = LimitOrderPoolResources,
  TSwapState extends LimitOrderPoolState = LimitOrderPoolState
> {
  readonly basePool: QuoteNode;
  readonly key: NodeKey;
  readonly state: Readonly<TSwapState>;
  readonly sortedTicks: Tick[];

  /**
   * Returns the result of swapping against the pool with the given parameters
   * @param params the parameters of the swap
   */
  quote(params: QuoteParams<TSwapState>): QuoteLimitOrderPool<TResources, TSwapState>;


}