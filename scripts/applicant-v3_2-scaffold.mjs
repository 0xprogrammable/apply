#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ApplicantV3_2ScaffoldError,
  buildApplicantV3_2Scaffold,
  canonicalApplicantV3_2ScaffoldBytes,
  checkApplicantV3_2Scaffold,
  writeApplicantV3_2Scaffold
} from "./applicant-v3_2-scaffold-core.mjs";
import { canonicalJson } from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const usage = "Usage: npm run applicant:scaffold -- --route <no-market|external|unresolved|official> --application-id <slug> [--category <custom|classic>] [--output <new-directory>] | --check <directory>";

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage}\n`);
  } else if (options.check !== null) {
    const report = checkApplicantV3_2Scaffold({
      cwd: process.cwd(),
      directory: options.check,
      repositoryRoot
    });
    process.stdout.write(`${canonicalJson(report)}\n`);
  } else {
    const scaffold = buildApplicantV3_2Scaffold({
      applicationId: options.applicationId,
      category: options.category,
      repositoryRoot,
      route: options.route
    });
    if (options.output === null) {
      process.stdout.write(canonicalApplicantV3_2ScaffoldBytes(scaffold));
    } else {
      const result = writeApplicantV3_2Scaffold({
        cwd: process.cwd(),
        directory: options.output,
        scaffold
      });
      process.stdout.write(`${canonicalJson({ ok: true, operation: "write", ...result })}\n`);
    }
  }
} catch (error) {
  const known = error instanceof ApplicantV3_2ScaffoldError;
  process.stdout.write(`${canonicalJson({
    error: {
      code: known ? error.code : "APPLICANT_SCAFFOLD_COMMAND_FAILED",
      message: String(known ? error.message : "Applicant scaffold command failed.").slice(0, 1000)
    },
    ok: false,
    writePerformed: false
  })}\n`);
  process.exitCode = known ? error.exitCode : 1;
}

function parseArguments(arguments_) {
  if (arguments_.length === 1 && arguments_[0] === "--help") {
    return Object.freeze({ help: true });
  }
  const allowed = new Set(["--application-id", "--category", "--check", "--output", "--route"]);
  const parsed = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowed.has(flag) || parsed.has(flag) || typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new ApplicantV3_2ScaffoldError("APPLICANT_SCAFFOLD_CLI_USAGE_INVALID", usage, { exitCode: 2 });
    }
    parsed.set(flag, value);
  }
  const check = parsed.get("--check") ?? null;
  if (check !== null) {
    if (parsed.size !== 1) {
      throw new ApplicantV3_2ScaffoldError("APPLICANT_SCAFFOLD_CLI_USAGE_INVALID", "--check cannot be combined with scaffold creation flags.", { exitCode: 2 });
    }
    return Object.freeze({ check, help: false });
  }
  if (!parsed.has("--route") || !parsed.has("--application-id")) {
    throw new ApplicantV3_2ScaffoldError("APPLICANT_SCAFFOLD_CLI_USAGE_INVALID", usage, { exitCode: 2 });
  }
  return Object.freeze({
    applicationId: parsed.get("--application-id"),
    category: parsed.get("--category") ?? null,
    check: null,
    help: false,
    output: parsed.get("--output") ?? null,
    route: parsed.get("--route")
  });
}
