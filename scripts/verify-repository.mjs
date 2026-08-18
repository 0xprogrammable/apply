#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ApplicantCompatibilityError,
  verifyApplicantCompatibilityContract
} from "./applicant-compatibility-core.mjs";
import { LaunchPolicyArtifactError, verifyLaunchPolicyArtifacts } from "./generate-launch-policy-artifacts.mjs";
import {
  LaunchPolicyAuthorityOwnershipError,
  verifyLaunchPolicyAuthorityOwnership
} from "./launch-policy-authority-ownership.mjs";
import { canonicalJson, RegistryError, verifyGeneratedArtifacts } from "./registry-core.mjs";
import { ReleaseVersionError, verifyReleaseVersion } from "./release-version-core.mjs";
import {
  UniversalAdmissionContractError,
  verifyUniversalAdmissionContractV1
} from "./universal-admission-contract-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const launchPolicy = verifyLaunchPolicyArtifacts({ repositoryRoot: root });
  const applicantCompatibility = verifyApplicantCompatibilityContract({
    allowLegacyFallback: true,
    repositoryRoot: root
  });
  const universalAdmissionContract = verifyUniversalAdmissionContractV1({ repositoryRoot: root });
  const authorityOwnership = verifyLaunchPolicyAuthorityOwnership({ repositoryRoot: root });
  const releaseVersion = verifyReleaseVersion({ repositoryRoot: root });
  const generated = verifyGeneratedArtifacts({ repositoryRoot: root });
  verifyVendorReceipt();
  verifySingleSourcePolicyGatePresent();
  if (!fs.existsSync(path.join(root, "scripts/test/schema-validator/node_modules/ajv"))) {
    run("npm", ["ci", "--prefix", "scripts/test/schema-validator", "--ignore-scripts", "--no-audit", "--no-fund"]);
  }
  runNodeTests("test", (name) => name.endsWith(".test.mjs"));
  runNodeTests("scripts/test", (name) => name.startsWith("verify-public-hook-application") && name.endsWith(".test.mjs"), ["--test-concurrency=1"]);
  process.stdout.write(`${canonicalJson({ ...generated, applicantCompatibility, authorityOwnership, checks: ["applicant-compatibility", "universal-admission-contract", "authority-ownership", "release-version", "generated-launch-policy", "generated-registry", "vendor-receipt", "single-source-policy", "registry-tests", "trusted-intake-tests"], launchPolicy, ok: true, releaseVersion, universalAdmissionContract })}\n`);
} catch (error) {
  const known = error instanceof RegistryError
    || error instanceof ApplicantCompatibilityError
    || error instanceof LaunchPolicyArtifactError
    || error instanceof LaunchPolicyAuthorityOwnershipError
    || error instanceof ReleaseVersionError
    || error instanceof UniversalAdmissionContractError;
  const code = known ? error.code : "REPOSITORY_CHECK_FAILED";
  const message = known ? error.message : String(error?.message ?? "repository verification failed").slice(0, 1000);
  process.stdout.write(`${canonicalJson({ error: { code, message }, ok: false })}\n`);
  process.exitCode = 1;
}

function verifyVendorReceipt() {
  const receiptPath = path.join(root, "vendor/receipt.json");
  if (!fs.existsSync(receiptPath)) throw new RegistryError("VENDOR_RECEIPT_MISSING", "vendor receipt is missing");
  const receiptBytes = fs.readFileSync(receiptPath, "utf8");
  const receipt = JSON.parse(receiptBytes);
  const expectedReceipt = {
    commit: "7869f44aa8dcc7cefeb379b76118407d53384558",
    release: "v0.10.3",
    repository: "0xprogrammable/hookbuilder",
    schemaVersion: "1.0.0",
    skillTree: "3b974b0bcb006e08d8f2504c783ac81f2ee3bd74",
    source: "https://github.com/0xprogrammable/hookbuilder/tree/7869f44aa8dcc7cefeb379b76118407d53384558/skills/programmable-v4-hook-builder"
  };
  if (receiptBytes !== `${canonicalJson(expectedReceipt)}\n`) throw new RegistryError("VENDOR_RECEIPT_INVALID", "vendor receipt does not match the exact released Builder identity");
  const temporaryIndex = path.join(root, `.vendor-index-${process.pid}`);
  try {
    const environment = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
    run("git", ["read-tree", "--empty"], { environment });
    run("git", ["add", "-f", "vendor/programmable-v4-hook-builder"], { environment });
    const tree = runText("git", ["write-tree"], { environment });
    const entry = runText("git", ["ls-tree", tree, "vendor/programmable-v4-hook-builder"], { environment });
    const match = /^040000 tree ([0-9a-f]{40})\t/u.exec(entry ?? "");
    if (match?.[1] !== receipt.skillTree) throw new RegistryError("VENDOR_TREE_MISMATCH", "vendored Builder bytes do not match the receipt");
  } finally {
    if (fs.existsSync(temporaryIndex)) fs.unlinkSync(temporaryIndex);
  }
}

function verifySingleSourcePolicyGatePresent() {
  const gatePath = path.join(root, "test/launch-policy-single-source.test.mjs");
  let status;
  try {
    status = fs.lstatSync(gatePath);
  } catch (error) {
    throw new RegistryError("SINGLE_SOURCE_POLICY_GATE_MISSING", "single-source policy gate is missing", { cause: error });
  }
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new RegistryError("SINGLE_SOURCE_POLICY_GATE_INVALID", "single-source policy gate must be a regular file");
  }
}

function runNodeTests(directory, predicate, extraArguments = []) {
  const files = fs.readdirSync(path.join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && predicate(entry.name))
    .map((entry) => path.posix.join(directory, entry.name))
    .sort();
  if (files.length === 0) throw new RegistryError("TESTS_MISSING", `${directory} contains no matching tests`);
  run(process.execPath, ["--test", ...extraArguments, ...files]);
}

function run(command, args, { environment = process.env } = {}) {
  const result = childProcess.spawnSync(command, args, { cwd: root, encoding: "utf8", env: environment, shell: false, stdio: "inherit" });
  if (result.status !== 0) throw new RegistryError("COMMAND_FAILED", `${command} failed`);
}

function runText(command, args, { environment = process.env } = {}) {
  const result = childProcess.spawnSync(command, args, { cwd: root, encoding: "utf8", env: environment });
  if (result.status !== 0) {
    throw new RegistryError("COMMAND_FAILED", `${command} failed`);
  }
  return result.stdout.trim();
}
