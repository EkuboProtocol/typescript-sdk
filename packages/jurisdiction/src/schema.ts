import { z } from "zod";
import {
  JURISDICTION_CODES,
  ATTESTATION_DOMAIN,
  ATTESTATION_TYPES,
  ATTESTATION_STATEMENT,
} from "./common.js";
export const jurisdictionCodeSchema = z.enum([...JURISDICTION_CODES] as [
  string,
  ...string[],
]);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const signedAttestationSchema = z
  .object({
    typed_data: z
      .object({
        domain: z
          .object({
            name: z.literal(ATTESTATION_DOMAIN.name),
            version: z.literal(ATTESTATION_DOMAIN.version),
          })
          .strict(),
        primaryType: z.literal("JurisdictionAttestation"),
        types: z
          .object({
            JurisdictionAttestation: z.tuple(
              ATTESTATION_TYPES.JurisdictionAttestation.map((field) =>
                z
                  .object({
                    name: z.literal(field.name),
                    type: z.literal(field.type),
                  })
                  .strict(),
              ) as unknown as [z.ZodType, ...z.ZodType[]],
            ),
          })
          .strict(),
        message: z
          .object({
            wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            jurisdictionCode: jurisdictionCodeSchema,
            statement: z.literal(ATTESTATION_STATEMENT),
            issuedAt: timestamp,
            expiresAt: timestamp,
          })
          .strict(),
      })
      .strict(),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  })
  .strict();
