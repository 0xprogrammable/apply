import fs from "node:fs";

import {
  bundledSchemas as frozenBundledSchemas
} from "../vendor/programmable-v4-hook-builder/scripts/open-world-v2-contracts.mjs";

export * from "../vendor/programmable-v4-hook-builder/scripts/open-world-v2-contracts.mjs";

const submissionSchema = JSON.parse(fs.readFileSync(
  new URL("../intake/schemas/open-world-submission-v2.schema.json", import.meta.url),
  "utf8"
));

export const bundledSchemas = Object.freeze({
  ...frozenBundledSchemas,
  submission: submissionSchema
});
