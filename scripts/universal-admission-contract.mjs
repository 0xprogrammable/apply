#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  UniversalAdmissionContractError,
  verifyUniversalAdmissionContractV1,
  writeUniversalAdmissionContractV1
} from "./universal-admission-contract-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [operation, ...extra] = process.argv.slice(2);

try {
  if (extra.length !== 0 || (operation !== "--check" && operation !== "--write")) {
    throw new UniversalAdmissionContractError(
      "UNIVERSAL_ADMISSION_CONTRACT_COMMAND_ARGUMENTS_INVALID",
      "Usage: node scripts/universal-admission-contract.mjs --check|--write"
    );
  }
  const result = operation === "--write"
    ? writeUniversalAdmissionContractV1({ repositoryRoot })
    : verifyUniversalAdmissionContractV1({ repositoryRoot });
  process.stdout.write(`${JSON.stringify({
    deploymentState: result.contract?.deployment?.state ?? result.deployment.state,
    ok: true,
    operation: operation.slice(2),
    path: result.path,
    sha256: result.sha256
  })}\n`);
} catch (error) {
  const known = error instanceof UniversalAdmissionContractError;
  process.stdout.write(`${JSON.stringify({
    error: {
      code: known ? error.code : "UNIVERSAL_ADMISSION_CONTRACT_COMMAND_FAILED",
      message: String(error?.message ?? "Universal Admission contract command failed.").slice(0, 1000)
    },
    ok: false
  })}\n`);
  process.exitCode = known && error.code === "UNIVERSAL_ADMISSION_CONTRACT_COMMAND_ARGUMENTS_INVALID" ? 2 : 1;
}
