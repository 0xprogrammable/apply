import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "../scripts/test/schema-validator/node_modules/ajv/dist/2020.js";

import {
  APPLICANT_COMPATIBILITY_PATH,
  APPLICANT_VALIDATOR_RECEIPT_PATH,
  ApplicantCompatibilityError,
  canonicalApplicantJson,
  parseApplicantCompatibilityBytesV1,
  verifyApplicantCompatibilityContract,
  verifyApplicantCompatibilityReadbackV1
} from "../scripts/applicant-compatibility-core.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("published compatibility and compact receipt schemas accept only the closed contracts", (t) => {
  const fixture = createCompactFixture(t);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateCompatibility = ajv.compile(readJson(repositoryRoot, "intake/schemas/applicant-compatibility-v1.schema.json"));
  const validateReceipt = ajv.compile(readJson(repositoryRoot, "intake/schemas/applicant-validator-package-receipt-v1.schema.json"));
  const compatibility = readJson(fixture.root, APPLICANT_COMPATIBILITY_PATH);
  const receipt = readJson(fixture.root, APPLICANT_VALIDATOR_RECEIPT_PATH);
  assert.equal(validateCompatibility(compatibility), true, JSON.stringify(validateCompatibility.errors));
  assert.equal(validateReceipt(receipt), true, JSON.stringify(validateReceipt.errors));
  compatibility.approvalAuthorized = true;
  receipt.files[0].command = "npm test";
  assert.equal(validateCompatibility(compatibility), false);
  assert.equal(validateReceipt(receipt), false);
});

test("a closed compact package produces an exact compatible base readback without executing package code", (t) => {
  const fixture = createCompactFixture(t);
  const result = verifyApplicantCompatibilityContract({
    allowLegacyFallback: false,
    repositoryRoot: fixture.root
  });

  assert.equal(result.mode, "declared-compact-validator-v1");
  assert.equal(result.validatorPackage.closureSha256, fixture.closureSha256);
  assert.equal(result.validatorPackage.fileCount, 3);
  assert.equal(result.validatorPackage.authority.candidateCodeExecuted, false);
  assert.equal(fs.existsSync(fixture.executionMarker), false);

  const readback = verifyApplicantCompatibilityReadbackV1({
    builderProtocolVersion: "1.0.0",
    bytes: fs.readFileSync(path.join(fixture.root, APPLICANT_COMPATIBILITY_PATH)),
    exactBaseCommit: "a".repeat(40),
    expectedDefaultBranch: "main",
    expectedRepositoryNumericId: "1320171831",
    requiredCapabilities: [
      "draft-transport:create",
      "source-closure:manifest",
      "missing-object-recovery",
      "unreviewed-draft-only"
    ]
  });
  assert.equal(readback.result, "compatible-protected-applicant-contract");
  assert.equal(readback.exactBaseCommit, "a".repeat(40));
  assert.equal(readback.validatorPackage.closureSha256, fixture.closureSha256);
});

test("compact package substitution fails before any package module is executed", (t) => {
  const fixture = createCompactFixture(t);
  fs.writeFileSync(
    path.join(fixture.root, "vendor/programmable-applicant-validator/scripts/support.mjs"),
    "export const closed = false;\n"
  );

  assert.throws(
    () => verifyApplicantCompatibilityContract({ allowLegacyFallback: false, repositoryRoot: fixture.root }),
    hasCode("APPLICANT_VALIDATOR_PACKAGE_FILE_SIZE_MISMATCH")
  );
  assert.equal(fs.existsSync(fixture.executionMarker), false);
});

test("unknown capabilities and an old Builder protocol fail closed", (t) => {
  const fixture = createCompactFixture(t);
  const bytes = fs.readFileSync(path.join(fixture.root, APPLICANT_COMPATIBILITY_PATH));
  const baseOptions = {
    builderProtocolVersion: "1.0.0",
    bytes,
    exactBaseCommit: "b".repeat(40),
    expectedDefaultBranch: "main",
    expectedRepositoryNumericId: "1320171831",
    requiredCapabilities: []
  };

  assert.throws(
    () => verifyApplicantCompatibilityReadbackV1({
      ...baseOptions,
      requiredCapabilities: ["review:auto-approve"]
    }),
    hasCode("APPLICANT_COMPATIBILITY_CAPABILITY_UNSUPPORTED")
  );
  assert.throws(
    () => verifyApplicantCompatibilityReadbackV1({
      ...baseOptions,
      builderProtocolVersion: "0.9.9"
    }),
    hasCode("APPLICANT_COMPATIBILITY_PROTOCOL_UNSUPPORTED")
  );
});

test("compatibility and receipt contracts reject extra authority or substitution fields", (t) => {
  const fixture = createCompactFixture(t);
  const manifestPath = path.join(fixture.root, APPLICANT_COMPATIBILITY_PATH);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.reviewAuthorized = true;
  const bytes = Buffer.from(`${canonicalApplicantJson(manifest)}\n`);
  assert.throws(
    () => parseApplicantCompatibilityBytesV1(bytes),
    hasCode("APPLICANT_COMPATIBILITY_INVALID")
  );

  const receiptPath = path.join(fixture.root, APPLICANT_VALIDATOR_RECEIPT_PATH);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  receipt.authority.networkAccessed = true;
  fs.writeFileSync(receiptPath, `${canonicalApplicantJson(receipt)}\n`);
  assert.throws(
    () => verifyApplicantCompatibilityContract({ allowLegacyFallback: false, repositoryRoot: fixture.root }),
    hasCode("APPLICANT_VALIDATOR_RECEIPT_AUTHORITY_INVALID")
  );
});

test("released v1.6.3 remains the only compatibility-less full-vendor fallback", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "applicant-compat-legacy-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  for (const relativePath of [
    ".programmable/active-contract.json",
    "intake/schemas/public-pr-application-v3.schema.json",
    "vendor/receipt.json"
  ]) copyFixtureFile(repositoryRoot, fixtureRoot, relativePath);

  const result = verifyApplicantCompatibilityContract({
    allowLegacyFallback: true,
    repositoryRoot: fixtureRoot
  });
  assert.equal(result.mode, "legacy-full-vendor-v0.10.3");
  assert.equal(result.builder.release, "v0.10.3");
  assert.equal(result.applicationSchemaSha256, "sha256:2d51837bbbfe52672ecca334596243bebcec78e8e0a885d67084dfd98955bcb7");

  fs.appendFileSync(path.join(fixtureRoot, "intake/schemas/public-pr-application-v3.schema.json"), " ");
  assert.throws(
    () => verifyApplicantCompatibilityContract({ allowLegacyFallback: true, repositoryRoot: fixtureRoot }),
    hasCode("APPLICANT_COMPATIBILITY_LEGACY_SCHEMA_MISMATCH")
  );
});

test("a missing declaration cannot silently select legacy fallback when it is disabled", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "applicant-compat-required-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  assert.throws(
    () => verifyApplicantCompatibilityContract({ allowLegacyFallback: false, repositoryRoot: fixtureRoot }),
    hasCode("APPLICANT_COMPATIBILITY_MISSING")
  );
});

function createCompactFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "applicant-compat-compact-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executionMarker = path.join(root, "package-code-executed");
  const packageFiles = new Map([
    [
      "data/application-contract.json",
      Buffer.from("{\"contractId\":\"public-pr-application-v3.1\"}\n")
    ],
    [
      "scripts/public-applicant-validator.mjs",
      Buffer.from(`import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(executionMarker)}, "executed");\n`)
    ],
    [
      "scripts/support.mjs",
      Buffer.from("export const closed = true;\n")
    ]
  ]);
  const records = [...packageFiles].map(([relativePath, bytes]) => ({
    byteLength: bytes.byteLength,
    path: relativePath,
    role: relativePath === "scripts/public-applicant-validator.mjs"
      ? "entrypoint"
      : relativePath.endsWith(".mjs") ? "module" : "data",
    sha256: digest(bytes)
  })).sort((left, right) => compareUtf8(left.path, right.path));
  const closureSha256 = closureDigest(records, packageFiles);
  const totalBytes = records.reduce((sum, record) => sum + record.byteLength, 0);
  for (const [relativePath, bytes] of packageFiles) {
    writeFile(root, `vendor/programmable-applicant-validator/${relativePath}`, bytes);
  }
  const receipt = {
    $schema: "urn:programmable:applicant-validator-package-receipt:1.0.0",
    algorithm: "sha256-path-nul-size-nul-content-nul-v1",
    authority: {
      candidateCodeExecuted: false,
      credentialsUsed: false,
      externalWritesPerformed: false,
      networkAccessed: false
    },
    closureSha256,
    entrypoint: "scripts/public-applicant-validator.mjs",
    fileCount: records.length,
    files: records,
    kind: "programmable-applicant-validator-package-receipt",
    schemaVersion: "1.0.0",
    totalBytes
  };
  writeFile(root, APPLICANT_VALIDATOR_RECEIPT_PATH, Buffer.from(`${canonicalApplicantJson(receipt)}\n`));

  const applicationSchemaBytes = Buffer.from("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"type\":\"object\"}\n");
  writeFile(root, "intake/schemas/public-pr-application-v3.schema.json", applicationSchemaBytes);
  const compatibility = {
    $schema: "urn:programmable:applicant-compatibility:1.0.0",
    application: {
      contractId: "public-pr-application-v3.1",
      schemaPath: "intake/schemas/public-pr-application-v3.schema.json",
      schemaSha256: digest(applicationSchemaBytes)
    },
    capabilities: {
      draftTransportOperations: ["create", "update"],
      missingObjectRecovery: true,
      sourceClosureModes: ["inline", "manifest"],
      unreviewedDraftOnly: true
    },
    kind: "programmable-applicant-compatibility",
    minimumBuilderProtocolVersion: "1.0.0",
    schemaVersion: "1.0.0",
    trustedRepository: {
      defaultBranch: "main",
      numericId: "1320171831"
    },
    validatorPackage: {
      closureSha256,
      entrypointPath: "vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs",
      receiptPath: "vendor/programmable-applicant-validator/validator-package-receipt.v1.json",
      rootPath: "vendor/programmable-applicant-validator"
    }
  };
  writeFile(root, APPLICANT_COMPATIBILITY_PATH, Buffer.from(`${canonicalApplicantJson(compatibility)}\n`));
  return { closureSha256, executionMarker, root };
}

function closureDigest(records, packageFiles) {
  const hash = crypto.createHash("sha256");
  for (const record of records) {
    const bytes = packageFiles.get(record.path);
    hash.update(Buffer.from(record.path));
    hash.update(Buffer.from([0]));
    hash.update(Buffer.from(String(record.byteLength), "ascii"));
    hash.update(Buffer.from([0]));
    hash.update(bytes);
    hash.update(Buffer.from([0]));
  }
  return `sha256:${hash.digest("hex")}`;
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function writeFile(root, relativePath, bytes) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function copyFixtureFile(sourceRoot, targetRoot, relativePath) {
  const target = path.join(targetRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, ...relativePath.split("/")), target);
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, ...relativePath.split("/")), "utf8"));
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function hasCode(code) {
  return (error) => error instanceof ApplicantCompatibilityError && error.code === code;
}
