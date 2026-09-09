import { getAddress, type Address } from "viem";
import protocol from "../protocol.json";

export const ATTESTATION_TTL_SECONDS = protocol.maxValiditySeconds;
export const MAX_PROOF_BYTES = protocol.maxProofBytes;
export const JURISDICTION_CODES = Object.freeze(protocol.countryCodes);
export const ATTESTATION_DOMAIN = Object.freeze(protocol.domain);
export const ATTESTATION_TYPES = Object.freeze({
  JurisdictionAttestation: Object.freeze(
    protocol.types.JurisdictionAttestation.map((field) => Object.freeze(field)),
  ),
});
export const ATTESTATION_STATEMENT = protocol.statement;
export function attestationTypedData(
  address: Address,
  jurisdictionCode: string,
  issuedAt: number,
  expiresAt = issuedAt + ATTESTATION_TTL_SECONDS,
) {
  return {
    domain: ATTESTATION_DOMAIN,
    primaryType: "JurisdictionAttestation" as const,
    types: ATTESTATION_TYPES,
    message: {
      wallet: getAddress(address),
      jurisdictionCode,
      statement: ATTESTATION_STATEMENT,
      issuedAt,
      expiresAt,
    },
  };
}
export interface SignedAttestation {
  typed_data: ReturnType<typeof attestationTypedData>;
  signature: string;
}
export interface VerifiedAttestation {
  wallet: Address;
  jurisdiction_code: string;
  issued_at: number;
  expires_at: number;
}
export type VerificationErrorCode =
  | "invalid_payload"
  | "invalid_time"
  | "invalid_jurisdiction"
  | "wrong_wallet"
  | "invalid_signature";
export class AttestationVerificationError extends Error {
  constructor(readonly code: VerificationErrorCode) {
    super(`Jurisdiction attestation verification failed: ${code}`);
    this.name = "AttestationVerificationError";
  }
}
export function proofJson(proof: unknown): string {
  try {
    const json = typeof proof === "string" ? proof : JSON.stringify(proof);
    if (typeof json !== "string") throw new Error();
    return json;
  } catch {
    throw new AttestationVerificationError("invalid_payload");
  }
}
export function parseVerification(result: string): VerifiedAttestation {
  const parsed = JSON.parse(result) as {
    ok?: VerifiedAttestation;
    error?: VerificationErrorCode;
  };
  if (parsed.error) throw new AttestationVerificationError(parsed.error);
  if (!parsed.ok) throw new AttestationVerificationError("invalid_payload");
  return parsed.ok;
}
export function unixTime(now: number): bigint {
  if (!Number.isSafeInteger(now) || now < 0)
    throw new AttestationVerificationError("invalid_time");
  return BigInt(now);
}
