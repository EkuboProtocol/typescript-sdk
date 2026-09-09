// Cloudflare permits statically imported Wasm modules, not runtime compilation.
import module from "../dist/wasm/ekubo_jurisdiction_bg.wasm";
import { initSync, verify_json } from "../dist/wasm/ekubo_jurisdiction.js";
import {
  parseVerification,
  proofJson,
  unixTime,
  type VerifiedAttestation,
} from "./common.js";
export * from "./common.js";
let initialized = false;
export async function verifyAttestation(
  proof: unknown,
  expectedWallet?: string | null,
  now = Math.floor(Date.now() / 1000),
): Promise<VerifiedAttestation> {
  if (!initialized) {
    initSync({ module });
    initialized = true;
  }
  return parseVerification(
    verify_json(proofJson(proof), expectedWallet ?? undefined, unixTime(now)),
  );
}
