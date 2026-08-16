import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { canonicalJson } from "../../vendor/programmable-v4-hook-builder/scripts/submission-core.mjs";
import {
  PUBLIC_PR_APPLICATION_V3_BASE_REQUIRED_REVIEW_KINDS,
  validatePublicApplicationV3PackageFiles,
  validatePublicApplicationV3SubmissionV2Bytes,
  validatePublicPrApplicationV3
} from "../verify-public-application-v3-core.mjs";
import { createApplicationV3TestPackage } from "./application-v3-package-fixture.mjs";

const SCHEMA_PATH = new URL("../../intake/schemas/public-pr-application-v3.schema.json", import.meta.url);
const EXAMPLE_PATH = new URL("./fixtures/public-pr-application-v3.1.example.json", import.meta.url);
const EXPECTED_SCHEMA_SHA256 = "2d51837bbbfe52672ecca334596243bebcec78e8e0a885d67084dfd98955bcb7";
const EXPECTED_EXAMPLE_SHA256 = "e98a66ef0984307e16e3dfde6515e57134534a05e28ff4fced2ecf6fc6eddc0e";

test("central Application V3.1 schema and fixture stay bound to the frozen Hookbuilder contract", () => {
  assert.equal(sha256Hex(fs.readFileSync(SCHEMA_PATH)), EXPECTED_SCHEMA_SHA256);
  assert.equal(sha256Hex(fs.readFileSync(EXAMPLE_PATH)), EXPECTED_EXAMPLE_SHA256);
  const report = validatePublicPrApplicationV3(readExample());
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.approvalGranted, false);
});

test("complete fee-unselected Application V3.1 materializes without fabricated Fee V2 artifacts", () => {
  const fixture = createApplicationV3TestPackage();
  const report = validatePublicPrApplicationV3(fixture.application);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.deepEqual(fixture.application.reviewPackage.requiredKinds, PUBLIC_PR_APPLICATION_V3_BASE_REQUIRED_REVIEW_KINDS);
  assert.equal(fixture.application.reviewPackage.records.some(({ kind }) => kind.startsWith("fee-policy")), false);
  const result = validatePackage(fixture);
  assert.equal(result.report.valid, true);
  assert.equal(result.application.policyBindings.feeApplicability, "not-selected");
  assert.equal(result.application.reviewState.status, "unreviewed");
  const v2 = validateV2(fixture);
  assert.equal(v2.feeApplicability, "not-selected");
  assert.ok(v2.artifactCount >= 7);
});

test("not-selected rejects fabricated Fee V2 fields and fee-policy review records", () => {
  const withField = makeNoFeeApplication(readExample());
  withField.policyBindings.programmableFeePolicyId = "programmable-volume-fee-v2";
  assert.equal(validatePublicPrApplicationV3(withField).valid, false);
  const withRecord = makeNoFeeApplication(readExample());
  withRecord.reviewPackage.records.push({
    kind: "fee-policy-schema",
    path: "submissions/legacy-open-world-example/fee-policy-v2.schema.json",
    mediaType: "application/schema+json",
    byteLength: 2,
    sha256: `sha256:${"1".repeat(64)}`,
    source: "source-repository",
    repositoryRef: "primary"
  });
  assert.equal(validatePublicPrApplicationV3(withRecord).valid, false);
});

test("complete Submission V2 packages derive fee-unselected and selected Fee V2 states", () => {
  const unselected = createApplicationV3TestPackage();
  assert.equal(validateV2(unselected).feeApplicability, "not-selected");
  const selected = createApplicationV3TestPackage({ feeMode: "selected" });
  assert.equal(validateV2(selected).feeApplicability, "applicable");
  selected.application.policyBindings.feeApplicability = "not-selected";
  assert.throws(
    () => validateV2(selected),
    (error) => error?.code === "APPLICATION_V3_FEE_APPLICABILITY_MISMATCH"
  );
});

test("Submission V2 validation rejects skeletal calls and a semantic-invalid complete package", () => {
  const skeletal = createApplicationV3TestPackage();
  const submissionBytes = skeletal.sourceFiles.get(skeletal.application.policyBindings.submissionPath);
  assert.throws(
    () => validatePublicApplicationV3SubmissionV2Bytes({ application: skeletal.application, submissionBytes }),
    (error) => error?.code === "APPLICATION_V3_SUBMISSION_INVALID"
  );
  const malformed = createApplicationV3TestPackage();
  const submission = structuredClone(malformed.sourcePackage.submission);
  delete submission.implementation;
  rebindSourceSubmission(malformed, jsonBytes(submission));
  assert.throws(
    () => validateV2(malformed),
    (error) => error?.code === "APPLICATION_REMOTE_V2_PACKAGE_INVALID"
  );
});

test("selected Fee V2 tradable root and exact package closure materialize unreviewed", () => {
  const fixture = createApplicationV3TestPackage({ feeMode: "selected" });
  const result = validatePackage(fixture);
  assert.equal(result.report.valid, true);
  assert.equal(result.application.policyBindings.feeApplicability, "applicable");
  assert.equal(result.application.reviewState.status, "unreviewed");
  assert.ok(fixture.application.reviewPackage.records.some(({ kind }) => kind === "trade-capability-manifest"));
  assert.ok(fixture.application.reviewPackage.records.some(({ kind }) => kind === "trade-test-result"));
  assert.equal(validateV2(fixture).feeApplicability, "applicable");
});

test("materialization rejects rehashed security-schema and assessment substitutions", () => {
  const schemaSubstitution = createApplicationV3TestPackage();
  rebindApplicationArtifact(
    schemaSubstitution,
    "security-assessment-schema",
    jsonBytes({ $id: "urn:attacker:replacement-security-schema" })
  );
  assert.throws(
    () => validatePackage(schemaSubstitution),
    (error) => error?.code === "APPLICATION_V3_MATERIALIZATION_INVALID"
  );

  const assessmentSubstitution = createApplicationV3TestPackage();
  const assessment = structuredClone(assessmentSubstitution.securityAssessment);
  assessment.subject.revision = "c".repeat(40);
  rebindApplicationArtifact(assessmentSubstitution, "security-assessment", jsonBytes(assessment));
  assert.throws(
    () => validatePackage(assessmentSubstitution),
    (error) => error?.code === "APPLICATION_V3_MATERIALIZATION_INVALID"
  );
});

test("closed package rejects duplicate keys, extra files, digest drift, and author substitution", () => {
  const duplicate = createApplicationV3TestPackage();
  duplicate.applicationPackageFiles.set("application.v3.json", Buffer.from(
    duplicate.applicationPackageFiles.get("application.v3.json").toString("utf8").replace(
      '"applicationId":"legacy-open-world-example"',
      '"applicationId":"legacy-open-world-example","applicationId":"legacy-open-world-example"'
    )
  ));
  assert.throws(() => validatePackage(duplicate), (error) => error?.code === "STRICT_JSON_DUPLICATE_KEY");

  const extra = createApplicationV3TestPackage();
  extra.applicationPackageFiles.set("unbound.txt", Buffer.from("unbound\n"));
  assert.throws(() => validatePackage(extra), (error) => error?.code === "APPLICATION_V3_PACKAGE_NOT_CLOSED");

  const drift = createApplicationV3TestPackage();
  drift.applicationPackageFiles.set("PROPOSAL.md", Buffer.from("changed after binding\n"));
  assert.throws(() => validatePackage(drift), (error) => error?.code === "APPLICATION_V3_PACKAGE_DIGEST_MISMATCH");

  const identity = createApplicationV3TestPackage();
  assert.throws(
    () => validatePublicApplicationV3PackageFiles({
      applicationId: identity.application.applicationId,
      applicationRevision: identity.application.applicationRevision,
      packageFiles: identity.applicationPackageFiles,
      expectedBuilderLogin: "attacker",
      expectedBuilderUserId: identity.application.builder.githubUserId
    }),
    (error) => error?.code === "BUILDER_LOGIN_PR_AUTHOR_MISMATCH"
  );
});

function readExample() {
  return JSON.parse(fs.readFileSync(EXAMPLE_PATH, "utf8"));
}

function makeNoFeeApplication(application) {
  Object.assign(application.policyBindings, {
    feePolicySchemaId: null,
    programmableFeePolicyId: null,
    programmableFeePolicyVersion: null,
    programmableFeePolicyHashPreimage: null,
    programmableFeePolicyHash: null,
    feeApplicability: "not-selected",
    feePolicySchemaPath: null,
    feePolicySchemaRepositoryRef: null,
    feePolicySchemaSha256: null,
    feePolicyInstancePath: null,
    feePolicyInstanceRepositoryRef: null,
    feePolicyInstanceSha256: null
  });
  application.reviewPackage.requiredKinds = [...PUBLIC_PR_APPLICATION_V3_BASE_REQUIRED_REVIEW_KINDS];
  application.reviewPackage.records = application.reviewPackage.records.filter(({ kind }) => (
    kind !== "fee-policy-schema" && kind !== "fee-policy"
  ));
  application.source.primary.sourcePaths = application.source.primary.sourcePaths.filter((sourcePath) => (
    !sourcePath.endsWith("/fee-policy-v2.schema.json") && !sourcePath.endsWith("/fee-policy.v2.json")
  ));
  return application;
}

function validatePackage(fixture) {
  return validatePublicApplicationV3PackageFiles({
    applicationId: fixture.application.applicationId,
    applicationRevision: fixture.application.applicationRevision,
    packageFiles: fixture.applicationPackageFiles,
    expectedBuilderLogin: fixture.application.builder.githubLogin,
    expectedBuilderUserId: fixture.application.builder.githubUserId
  });
}

function validateV2(fixture) {
  return validatePublicApplicationV3SubmissionV2Bytes({
    application: fixture.application,
    submissionBytes: fixture.sourceFiles.get(fixture.application.policyBindings.submissionPath),
    sourceArtifacts: new Map([...fixture.sourceFiles].map(([filePath, bytes]) => [`primary\0${filePath}`, bytes])),
    packageFiles: fixture.applicationPackageFiles
  });
}

function rebindSourceSubmission(fixture, bytes) {
  const submissionPath = fixture.application.policyBindings.submissionPath;
  fixture.sourceFiles.set(submissionPath, bytes);
  fixture.application.policyBindings.submissionSha256 = sha256(bytes);
  const record = fixture.application.reviewPackage.records.find(({ kind }) => kind === "submission");
  record.sha256 = sha256(bytes);
  record.byteLength = bytes.length;
}

function rebindApplicationArtifact(fixture, kind, bytes) {
  const record = fixture.application.reviewPackage.records.find((candidate) => candidate.kind === kind);
  fixture.applicationPackageFiles.set(record.path, bytes);
  record.sha256 = sha256(bytes);
  record.byteLength = bytes.length;
  if (kind === "security-assessment-schema") {
    fixture.application.securityBindings.securityAssessmentSchemaSha256 = record.sha256;
    fixture.application.securityBindings.securityAssessmentSchemaByteLength = bytes.length;
  } else {
    fixture.application.securityBindings.securityAssessmentSha256 = record.sha256;
    fixture.application.securityBindings.securityAssessmentByteLength = bytes.length;
  }
  fixture.applicationPackageFiles.set("application.v3.json", jsonBytes(fixture.application));
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function sha256(bytes) {
  return `sha256:${sha256Hex(bytes)}`;
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
