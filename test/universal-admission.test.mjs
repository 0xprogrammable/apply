import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "../scripts/test/schema-validator/node_modules/ajv/dist/2020.js";
import { canonicalJson } from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";
import {
  MAX_UNIVERSAL_ADMISSION_BYTES,
  UniversalAdmissionError,
  validateUniversalAdmission,
  validateUniversalAdmissionBytes
} from "../scripts/universal-admission-core.mjs";

const root = path.resolve(".");

test("universal admission schema is closed and accepts an open-world game/hook disclosure", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, "intake/schemas/universal-admission-v1.schema.json"), "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const value = fixture();
  assert.equal(validate(value), true, validate.errors ? JSON.stringify(validate.errors) : "schema rejected fixture");
  assert.equal(validate({ ...value, unexpected: true }), false);
});

test("proposal with unknown oracle/API details remains admitted but pending", () => {
  const value = fixture();
  value.application.requestedRoute = "none";
  value.disclosure.dependencies.push({
    id: "oracle",
    kind: "external oracle/API",
    status: "unknown",
    failureMode: "Stale, unavailable, conflicting, or manipulated provider data requires later review.",
    sourceRefs: ["README.md"]
  });
  const result = validateUniversalAdmissionBytes(Buffer.from(`${canonicalJson(value)}\n`));
  assert.equal(result.status, "ADMITTED_FOR_REVIEW_ANALYSIS_PENDING");
  assert.equal(result.reviewState, "analysis_pending");
  assert.equal(result.authority.approvalGranted, false);
  assert.equal(result.authority.launchAuthorized, false);
  assert.equal(result.findings.length, 0);
});

test("no-market/no-token declaration is explicit rather than a fabricated fee artifact", () => {
  const result = validateUniversalAdmission(fixture());
  assert.equal(result.status, "ADMITTED_FOR_REVIEW_ANALYSIS_PENDING");
  assert.equal(result.routeStatus, "not-selected");
  assert.equal(result.authority.externalWritesPerformed, false);
});

test("selecting the Programmable Ethereum route is disclosed and deferred, never silently passed", () => {
  const value = fixture();
  value.application.requestedRoute = "programmable-ethereum-mainnet";
  const result = validateUniversalAdmission(value);
  assert.equal(result.routeStatus, "platform-route-pending");
  assert.equal(result.status, "ADMITTED_FOR_REVIEW_ANALYSIS_PENDING");
  assert.equal(result.findings[0].code, "PLATFORM_ROUTE_REVIEW_REQUIRED");
});

test("hard failures are limited to transport or internally false claims", () => {
  const duplicate = fixture();
  duplicate.disclosure.privileges.push({ ...duplicate.disclosure.privileges[0] });
  assert.throws(() => validateUniversalAdmission(duplicate), hasCode("UNIVERSAL_ADMISSION_DUPLICATE_ID"));

  const unsafe = fixture();
  unsafe.disclosure.executionSurfaces[0].sourceRefs = ["../secret"];
  assert.throws(() => validateUniversalAdmission(unsafe), hasCode("UNIVERSAL_ADMISSION_PATH_INVALID"));

  const falseClaim = fixture();
  falseClaim.attestation.noApprovalClaim = false;
  assert.throws(() => validateUniversalAdmission(falseClaim), hasCode("UNIVERSAL_ADMISSION_ASSERTION_INVALID"));
});

test("canonical duplicate-free bytes and aggregate size are bounded", () => {
  const value = fixture();
  const bytes = Buffer.from(`${canonicalJson(value)}\n`);
  const parsed = validateUniversalAdmissionBytes(bytes);
  assert.match(parsed.sourceDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.throws(
    () => validateUniversalAdmission(value, { bytes: Buffer.from("{}\n") }),
    hasCode("UNIVERSAL_ADMISSION_BYTES_MISMATCH")
  );
  assert.throws(() => validateUniversalAdmissionBytes(Buffer.from(`{"kind":"x","kind":"y"}\n`)), hasCode("UNIVERSAL_ADMISSION_JSON_INVALID"));
  assert.throws(() => validateUniversalAdmissionBytes(Buffer.alloc(MAX_UNIVERSAL_ADMISSION_BYTES + 1, 0x20)), hasCode("UNIVERSAL_ADMISSION_SIZE_INVALID"));
});

function fixture() {
  return {
    $schema: "urn:programmable:universal-admission:1.0.0",
    application: {
      id: "minecraft-hook",
      projectLabel: "A Minecraft-like settlement experiment",
      requestedRoute: "none",
      revision: "1",
      stage: "proposal"
    },
    attestation: {
      candidateCodeExecuted: false,
      externalWritesPerformed: false,
      noApprovalClaim: true,
      noSafetyGuaranteeClaim: true,
      publicDataOnly: true,
      unknownsExplicit: true
    },
    disclosure: {
      dependencies: [{
        id: "none",
        kind: "other",
        status: "declared",
        failureMode: "No external dependency is claimed.",
        sourceRefs: ["README.md"]
      }],
      evidence: [{
        id: "source",
        kind: "source",
        ref: "src/Hook.sol@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sha256: `sha256:${"c".repeat(64)}`,
        status: "declared"
      }],
      executionSurfaces: [{
        id: "hook",
        kind: "Uniswap v4 hook and settlement contract",
        sourceRefs: ["src/Hook.sol"],
        status: "declared",
        summary: "A hook changes swap or settlement behavior for the described experiment."
      }, {
        id: "game",
        kind: "game client and service",
        sourceRefs: ["README.md"],
        status: "unknown",
        summary: "The game client and service are not independently verified in this envelope."
      }],
      privileges: [{
        id: "admin",
        kind: "administrator",
        sourceRefs: ["src/Hook.sol"],
        status: "unknown",
        summary: "Admin and upgrade powers require later source-bound review."
      }],
      valueFlows: [{
        basis: "No pool, token, fee, custody, or reward flow is claimed at this stage.",
        from: "none",
        id: "none",
        kind: "none",
        sourceRefs: ["README.md"],
        status: "declared",
        to: "none"
      }]
    },
    kind: "programmable-universal-admission",
    schemaVersion: "1.0.0",
    source: {
      commit: "a".repeat(40),
      packageSha256: `sha256:${"c".repeat(64)}`,
      path: "admission/application.json",
      repositoryId: "123456",
      repositoryUrl: "https://github.com/example/minecraft-hook",
      tree: "b".repeat(40)
    }
  };
}

function hasCode(code) {
  return (error) => error instanceof UniversalAdmissionError && error.code === code;
}
