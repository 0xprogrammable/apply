import fs from "node:fs";

import {
  bundledSchemas as frozenBundledSchemas
} from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";

export * from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";

const submissionSchema = JSON.parse(fs.readFileSync(
  new URL("../intake/schemas/open-world-submission-v2.schema.json", import.meta.url),
  "utf8"
));
const submissionV2_1Schema = JSON.parse(fs.readFileSync(
  new URL("../intake/schemas/open-world-submission-v2.1.schema.json", import.meta.url),
  "utf8"
));
const tradeCapabilityManifestV2Schema = JSON.parse(fs.readFileSync(
  new URL("../intake/schemas/trade-capability-manifest-v2.schema.json", import.meta.url),
  "utf8"
));

export const OPEN_WORLD_V2_1_STANDARD_VERSION = "2.1.0";
export const OPEN_WORLD_V2_1_SCHEMA_ID = "urn:programmable:v4-hook-submission:2.1.0";
export const OPEN_WORLD_V2_1_TRADE_CAPABILITY_ARTIFACT = Object.freeze({
  artifactType: "trade-capability-manifest",
  schemaId: "urn:programmable:trade-capability-manifest:2.0.0"
});

export function openWorldSubmissionContractFor(value) {
  if (value?.standardVersion === OPEN_WORLD_V2_1_STANDARD_VERSION) {
    return Object.freeze({
      schema: submissionV2_1Schema,
      schemaId: OPEN_WORLD_V2_1_SCHEMA_ID,
      standardVersion: OPEN_WORLD_V2_1_STANDARD_VERSION,
      tradeCapabilityArtifact: OPEN_WORLD_V2_1_TRADE_CAPABILITY_ARTIFACT
    });
  }
  if (value?.standardVersion === frozenBundledSchemas.submission.properties.standardVersion.const) {
    return Object.freeze({
      schema: submissionSchema,
      schemaId: submissionSchema.$id,
      standardVersion: submissionSchema.properties.standardVersion.const,
      tradeCapabilityArtifact: frozenBundledSchemas.tradeCapabilityManifest
        ? Object.freeze({
            artifactType: "trade-capability-manifest",
            schemaId: frozenBundledSchemas.tradeCapabilityManifest.$id
          })
        : null
    });
  }
  return null;
}

export const bundledSchemas = Object.freeze({
  ...frozenBundledSchemas,
  submission: submissionSchema,
  submissionV2_1: submissionV2_1Schema,
  tradeCapabilityManifestV2: tradeCapabilityManifestV2Schema
});
