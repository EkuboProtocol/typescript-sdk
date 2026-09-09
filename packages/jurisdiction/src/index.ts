import { initSync, verify_json } from "../dist/wasm/ekubo_jurisdiction.js";
import { wasmBytes } from "../dist/wasm/bytes.js";
import {
  parseVerification,
  proofJson,
  unixTime,
  type VerifiedAttestation,
} from "./common.js";
export * from "./common.js";
let initialized = false;
/** Native Rust verification compiled to Wasm; no network or storage. */
export async function verifyAttestation(
  proof: unknown,
  expectedWallet?: string | null,
  now = Math.floor(Date.now() / 1000),
): Promise<VerifiedAttestation> {
  if (!initialized) {
    initSync({ module: wasmBytes() });
    initialized = true;
  }
  return parseVerification(
    verify_json(proofJson(proof), expectedWallet ?? undefined, unixTime(now)),
  );
}
