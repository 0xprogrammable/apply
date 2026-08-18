#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonicalJson } from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";
import { validateUniversalAdmissionBytes } from "./universal-admission-core.mjs";

const inputPath = process.argv[2];
if (!inputPath || process.argv.length !== 3) {
  process.stderr.write("Usage: npm run admission -- path/to/admission.json\n");
  process.exitCode = 2;
} else {
  try {
    const absolute = path.resolve(inputPath);
    const result = validateUniversalAdmissionBytes(fs.readFileSync(absolute));
    process.stdout.write(`${canonicalJson(result)}\n`);
  } catch (error) {
    process.stdout.write(`${canonicalJson({ ok: false, error: { code: error.code ?? "UNIVERSAL_ADMISSION_INVALID", message: error.message, path: error.path ?? null } })}\n`);
    process.exitCode = 1;
  }
}
