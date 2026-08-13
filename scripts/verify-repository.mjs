#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJson, RegistryError, verifyGeneratedArtifacts } from "./registry-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const generated = verifyGeneratedArtifacts({ repositoryRoot: root });
  verifyVendorReceipt();
  if (!fs.existsSync(path.join(root, "scripts/test/schema-validator/node_modules/ajv"))) {
    run("npm", ["ci", "--prefix", "scripts/test/schema-validator", "--ignore-scripts", "--no-audit", "--no-fund"]);
  }
  runNodeTests("test", (name) => name.endsWith(".test.mjs"));
  runNodeTests("scripts/test", (name) => name.startsWith("verify-public-hook-application") && name.endsWith(".test.mjs"), ["--test-concurrency=1"]);
  process.stdout.write(`${canonicalJson({ ...generated, checks: ["generated-registry", "vendor-receipt", "registry-tests", "trusted-intake-tests"], ok: true })}\n`);
} catch (error) {
  const code = error instanceof RegistryError ? error.code : "REPOSITORY_CHECK_FAILED";
  const message = error instanceof RegistryError ? error.message : String(error?.message ?? "repository verification failed").slice(0, 1000);
  process.stdout.write(`${canonicalJson({ error: { code, message }, ok: false })}\n`);
  process.exitCode = 1;
}

function verifyVendorReceipt() {
  const receiptPath = path.join(root, "vendor/receipt.json");
  if (!fs.existsSync(receiptPath)) throw new RegistryError("VENDOR_RECEIPT_MISSING", "vendor receipt is missing");
  const receiptBytes = fs.readFileSync(receiptPath, "utf8");
  const receipt = JSON.parse(receiptBytes);
  const expectedReceipt = {
    commit: "547482adf6ed0ed19e9cd4d0e884abd70e143229",
    release: "v0.5.1",
    repository: "0xprogrammable/hookbuilder",
    schemaVersion: "1.0.0",
    skillTree: "b7a0eeec627b2fd2dfe24fcadd35befcd42b8cec",
    source: "https://github.com/0xprogrammable/hookbuilder/tree/547482adf6ed0ed19e9cd4d0e884abd70e143229/skills/programmable-v4-hook-builder"
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
