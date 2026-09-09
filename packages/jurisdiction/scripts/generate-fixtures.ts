import { privateKeyToAccount } from "viem/accounts";
import { attestationTypedData } from "../src/common.js";
const wallet = privateKeyToAccount(`0x${"01".repeat(32)}`);
const other = privateKeyToAccount(`0x${"02".repeat(32)}`);
const now = 1_800_000_000;
const cases: {
  name: string;
  proof: unknown;
  now: number;
  wallet?: string;
  expected: string;
}[] = [];
async function signed(
  country: string,
  issuedAt: number,
  expiresAt: number,
  signer = wallet,
) {
  const typed_data = attestationTypedData(
    wallet.address,
    country,
    issuedAt,
    expiresAt,
  );
  return { typed_data, signature: await signer.signTypedData(typed_data) };
}
const valid = await signed("DE", now, now + 604800);
for (const [name, country, issued, expires, expected] of [
  ["one week", "DE", now, now + 604800, "DE"],
  ["shorter window", "FR", now, now + 60, "FR"],
  ["exact expiry", "DE", now - 60, now, "invalid_time"],
  ["future issuance", "DE", now + 1, now + 60, "invalid_time"],
  ["overlong window", "DE", now, now + 604801, "invalid_time"],
  ["zero window", "DE", now, now, "invalid_time"],
  ["unknown jurisdiction", "ZZ", now, now + 60, "invalid_jurisdiction"],
  ["lowercase jurisdiction", "de", now, now + 60, "invalid_jurisdiction"],
] as const)
  cases.push({
    name,
    proof: await signed(country, issued, expires),
    now,
    expected,
  });
cases.push({
  name: "wrong wallet",
  proof: valid,
  now,
  wallet: other.address,
  expected: "wrong_wallet",
});
cases.push({
  name: "wrong signer",
  proof: await signed("DE", now, now + 60, other),
  now,
  expected: "invalid_signature",
});
for (const [name, mutate] of [
  [
    "other domain",
    (value: typeof valid) => {
      Object.assign(value.typed_data.domain, { name: "other" });
    },
  ],
  [
    "other statement",
    (value: typeof valid) => {
      value.typed_data.message.statement = "other";
    },
  ],
  [
    "altered country",
    (value: typeof valid) => {
      value.typed_data.message.jurisdictionCode = "US";
    },
  ],
] as const) {
  const proof = JSON.parse(JSON.stringify(valid));
  mutate(proof);
  cases.push({
    name,
    proof,
    now,
    expected:
      name === "altered country" ? "invalid_signature" : "invalid_payload",
  });
}
cases.push({
  name: "unknown unsigned field",
  proof: { ...valid, extra: true },
  now,
  expected: "invalid_payload",
});
cases.push({
  name: "duplicate signature",
  proof: JSON.stringify(valid).replace(
    '"signature":',
    '"signature":"bad","signature":',
  ),
  now,
  expected: "invalid_payload",
});
cases.push({
  name: "malformed json",
  proof: "{",
  now,
  expected: "invalid_payload",
});
cases.push({
  name: "oversized",
  proof: " ".repeat(4097),
  now,
  expected: "invalid_payload",
});
await Bun.write(
  new URL("../fixtures/conformance.json", import.meta.url),
  JSON.stringify(cases, null, 2) + "\n",
);
