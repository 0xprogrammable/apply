import fs from "node:fs";

import {
  bundledSchemas as frozenBundledSchemas
} from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";

export * from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";

const submissionSchema = JSON.parse(fs.readFileSync(
  new URL("../intake/schemas/open-world-submission-v2.schema.json", import.meta.url),
  "utf8"
));

export const bundledSchemas = Object.freeze({
  ...frozenBundledSchemas,
  submission: submissionSchema
});
