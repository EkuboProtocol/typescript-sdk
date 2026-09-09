import { expect, test } from "bun:test";
import {
  verifyAttestation,
  attestationTypedData,
  AttestationVerificationError,
} from "../dist/index.js";
import fixture from "../fixtures/valid.json";
import cases from "../fixtures/conformance.json";
import { signedAttestationSchema } from "./schema.js";
for (const entry of cases) {
  test(`Wasm verifier: ${entry.name}`, async () => {
    try {
      const result = await verifyAttestation(
        entry.proof,
        "wallet" in entry ? entry.wallet : undefined,
        entry.now,
      );
      expect(result.jurisdiction_code).toBe(entry.expected);
    } catch (error) {
      expect(error).toBeInstanceOf(AttestationVerificationError);
      expect(String((error as AttestationVerificationError).code)).toBe(
        entry.expected,
      );
      expect(String(error)).not.toContain(fixture.signature);
    }
  });
}
test("builder and schema match the signed fixture", () => {
  expect(
    JSON.stringify(
      attestationTypedData(
        fixture.typed_data.message.wallet as `0x${string}`,
        "DE",
        1_800_000_000,
      ),
    ),
  ).toBe(JSON.stringify(fixture.typed_data));
  expect(signedAttestationSchema.safeParse(fixture).success).toBe(true);
});
