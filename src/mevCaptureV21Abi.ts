/** Read/event ABI at merged contract da368348238a46857d39b6db57bdb2b432c979df. */
export const MEV_CAPTURE_V21_ABI = [
  {
    type: "function", name: "getConfig", stateMutability: "view", inputs: [],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "halfLife", type: "uint32" },
      { name: "slopeK", type: "uint8" },
      { name: "segmentExp", type: "uint8" },
      { name: "jLin", type: "uint8" },
      { name: "maxFee", type: "uint16" },
      { name: "clampTicks", type: "uint32" },
      { name: "mGate", type: "uint8" },
      { name: "maxSegments", type: "uint8" },
    ] }],
  },
  {
    type: "function", name: "getAnchor", stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "lastUpdateTime", type: "uint32" },
      { name: "lRefTime", type: "uint32" },
      { name: "lastPosTime", type: "uint32" },
      { name: "lRefBits", type: "uint8" },
      { name: "snapBits", type: "uint8" },
      { name: "lRefRaiseTime", type: "uint32" },
      { name: "anchorX16", type: "int64" },
    ],
  },
  {
    type: "event", name: "AnchorGateFailed", anonymous: false,
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "lObs", type: "uint8", indexed: false },
      { name: "eRef", type: "uint8", indexed: false },
    ],
  },
] as const;
