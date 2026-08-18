import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("the complete repository verifier invokes the Universal Admission contract gate", () => {
  const source = fs.readFileSync(path.join(root, "scripts/verify-repository.mjs"), "utf8");
  assert.match(source, /UniversalAdmissionContractError,/u);
  assert.match(source, /verifyUniversalAdmissionContractV1/u);
  assert.match(source, /verifyUniversalAdmissionContractV1\(\{ repositoryRoot: root \}\)/u);
  assert.match(source, /"universal-admission-contract"/u);
  assert.match(source, /error instanceof UniversalAdmissionContractError/u);
});

test("the package exposes the closed contract, admission test, and offline benchmark commands", () => {
  const packageRecord = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lockRecord = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  assert.equal(packageRecord.engines.node, ">=24.12.0");
  assert.equal(lockRecord.packages[""].engines.node, ">=24.12.0");
  assert.equal(packageRecord.scripts["admission:contract:check"], "node scripts/universal-admission-contract.mjs --check");
  assert.equal(packageRecord.scripts["admission:contract:write"], "node scripts/universal-admission-contract.mjs --write");
  assert.equal(packageRecord.scripts["admission:reference:benchmark"], "node scripts/benchmark-universal-admission-sqlite.mjs");
  assert.match(packageRecord.scripts["test:admission"], /universal-admission-contract\.test\.mjs/u);
  assert.match(packageRecord.scripts["test:admission"], /authenticated-admission-service\.test\.mjs/u);
  assert.match(packageRecord.scripts["test:admission"], /universal-admission-sqlite\.test\.mjs/u);
});
