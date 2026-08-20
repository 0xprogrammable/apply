import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { canonicalJson } from "../../vendor/programmable-v4-hook-builder/scripts/submission-core.mjs";
import {
  architectureSnapshotSha256
} from "../../vendor/programmable-v4-hook-builder/scripts/open-world-v2-core.mjs";
import {
  PUBLIC_PR_APPLICATION_V3_BASE_REQUIRED_REVIEW_KINDS,
  derivePublicApplicationV3PackageBindingV1,
  derivePublicPrApplicationV3_2MigrationBinding,
  deriveTrustedPublicApplicationV3LaunchReadinessV1,
  isTrustedPublicApplicationV3LaunchReadinessV1,
  validatePublicApplicationV3PackageFiles,
  validatePublicApplicationV3SubmissionV2Bytes,
  validatePublicPrApplicationV3
} from "../verify-public-application-v3-core.mjs";
import { generatePublicPrApplicationV3 } from "../verify-public-application-v3-generation.mjs";
import {
  canonicalProgrammableLaunchRouterReadinessJson,
  deriveProgrammableLaunchRouterSourceConfigurationHashV1
} from "../programmable-launch-router-readiness-core.mjs";
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
  const pending = deriveTrustedPublicApplicationV3LaunchReadinessV1(result);
  assert.equal(pending.decision, "analysis-pending");
  assert.equal(pending.requestedRoute, null);
  assert.equal(pending.readinessBinding, null);
  const v2 = validateV2(fixture, result.application);
  assert.equal(v2.feeApplicability, "not-selected");
  assert.ok(v2.artifactCount >= 7);
  assert.equal(deriveTrustedPublicApplicationV3LaunchReadinessV1(v2).decision, "analysis-pending");
});

test("Application V3.2 dispatches only Submission 2.1 and preserves open no-market and external-route paths", () => {
  for (const [requestedRoute, marketMode, expectedTrade] of [
    ["none", "no-market", "no-market"],
    ["other", "tradable", "tradable"]
  ]) {
    const fixture = createApplicationV3TestPackage({
      applicationContractVersion: "3.2.0",
      requestedRoute,
      marketMode
    });
    const packageResult = validatePackage(fixture);
    assert.equal(packageResult.report.valid, true, JSON.stringify(packageResult.report.findings));
    assert.equal(packageResult.application.contract.version, "3.2.0");
    assert.equal(packageResult.application.contract.submissionStandard, "2.1.0");
    const pendingOrNotApplicable = deriveTrustedPublicApplicationV3LaunchReadinessV1(packageResult);
    assert.equal(pendingOrNotApplicable.decision, "analysis-pending");
    assert.equal(pendingOrNotApplicable.requestedRoute, requestedRoute);
    assert.equal(pendingOrNotApplicable.readinessBinding, null);
    assert.match(pendingOrNotApplicable.applicationSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.match(pendingOrNotApplicable.packageSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(derivePublicApplicationV3PackageBindingV1({
      application: packageResult.application,
      applicationBytes: fixture.applicationPackageFiles.get("application.v3.json"),
      applicationRecords: packageResult.applicationRecords
    }), {
      applicationSha256: pendingOrNotApplicable.applicationSha256,
      packageSha256: pendingOrNotApplicable.packageSha256
    });
    assert.equal(isTrustedPublicApplicationV3LaunchReadinessV1(pendingOrNotApplicable), true);
    assert.equal(isTrustedPublicApplicationV3LaunchReadinessV1(structuredClone(pendingOrNotApplicable)), false);
    assert.throws(
      () => { packageResult.application.launchRequest.requestedRoute = "programmable-ethereum-mainnet"; },
      TypeError
    );
    assert.throws(
      () => deriveTrustedPublicApplicationV3LaunchReadinessV1({ ...packageResult }),
      (error) => error?.code === "APPLICATION_V3_LAUNCH_READINESS_TRUST_INVALID"
    );

    const submissionResult = validateV2(fixture, packageResult.application);
    assert.equal(submissionResult.submission.standardVersion, "2.1.0");
    assert.equal(submissionResult.submission.tradeCapability.applicability, expectedTrade);
    assert.equal(submissionResult.feeApplicability, "not-selected");
    const finalProjection = deriveTrustedPublicApplicationV3LaunchReadinessV1(submissionResult);
    assert.equal(finalProjection.decision, "not-applicable");
  }
});

test("V3.2 none cannot turn tradable or unresolved source bytes into not-applicable readiness", () => {
  const tradable = createApplicationV3TestPackage({
    applicationContractVersion: "3.2.0",
    requestedRoute: "none",
    marketMode: "tradable"
  });
  const tradablePackage = validatePackage(tradable);
  assert.equal(deriveTrustedPublicApplicationV3LaunchReadinessV1(tradablePackage).decision, "analysis-pending");
  assert.throws(
    () => validateV2(tradable, tradablePackage.application),
    (error) => error?.code === "APPLICATION_V3_ROUTE_DECLARATION_CONTRADICTORY"
  );

  const unresolved = createApplicationV3TestPackage({
    applicationContractVersion: "3.2.0",
    requestedRoute: "none",
    stage: "proposal"
  });
  const unresolvedPackage = validatePackage(unresolved);
  const unresolvedResult = validateV2(unresolved, unresolvedPackage.application);
  assert.equal(deriveTrustedPublicApplicationV3LaunchReadinessV1(unresolvedResult).decision, "analysis-pending");
});

test("official V3.2 route binds exact Router readiness, route source, fee source, and trusted required projection", () => {
  const fixture = officialRouteFixture();
  const packageResult = validatePackage(fixture);
  const pending = deriveTrustedPublicApplicationV3LaunchReadinessV1(packageResult);
  assert.equal(pending.decision, "analysis-pending");
  assert.deepEqual(pending.readinessBinding, {
    byteLength: fixture.application.launchRequest.routePlan.byteLength,
    gitBlobOid: fixture.application.launchRequest.routePlan.gitBlobOid,
    path: ".programmable/launch-router-readiness.v1.json",
    sha256: fixture.application.launchRequest.routePlan.sha256
  });

  const fullResult = validateV2(fixture, packageResult.application);
  const required = deriveTrustedPublicApplicationV3LaunchReadinessV1(fullResult);
  assert.equal(required.decision, "required");
  assert.equal(required.requestedRoute, "programmable-ethereum-mainnet");
  assert.equal(required.subject.configurationHash, fixture.launchReadinessDocument.subject.sourceConfigurationHash);
  assert.equal(required.applicationSha256, pending.applicationSha256);
  assert.equal(required.packageSha256, pending.packageSha256);
  assert.equal(fixture.launchReadinessBytes.length, fixture.application.launchRequest.routePlan.byteLength);
  assert.ok(fixture.application.reviewPackage.records.some(({ kind }) => kind === "programmable-launch-route-source"));
  assert.ok(fixture.application.reviewPackage.records.some(({ kind }) => kind === "programmable-launch-fee-source"));
});

test("official V3.2 full path rejects Router, fee, fallback, Developer, schema, and source substitutions", async (t) => {
  for (const [label, mutate] of [
    ["wrong Router", (document) => { document.resolvedRouter.address = `0x${"9".repeat(40)}`; }],
    ["wrong Router runtime", (document) => { document.resolvedRouter.runtimeCodeHash = `0x${"8".repeat(64)}`; }],
    ["wrong treasury", (document) => { document.feeConfiguration.treasury = `0x${"7".repeat(40)}`; }],
    ["wrong bps", (document) => { document.feeConfiguration.bps = 11; }],
    ["direct factory", (document) => { document.route.directFactoryCall = true; }],
    ["Developer ref", (document) => { document.developerReference.commit = "6".repeat(40); }]
  ]) {
    await t.test(label, () => {
      const fixture = officialRouteFixture();
      const document = structuredClone(fixture.launchReadinessDocument);
      mutate(document);
      rebindLaunchReadiness(fixture, document);
      assertOfficialRouteRejects(fixture, "APPLICATION_V3_ROUTE_PLAN_READINESS_INVALID");
    });
  }

  await t.test("protected readiness schema substitution", () => {
    const fixture = officialRouteFixture();
    fixture.application.launchRequest.routerReadinessSchema.sha256 = `sha256:${"f".repeat(64)}`;
    fixture.applicationPackageFiles.set("application.v3.json", jsonBytes(fixture.application));
    assertOfficialRouteRejects(fixture, "APPLICATION_V3_ROUTE_PLAN_SCHEMA_BINDING_MISMATCH");
  });

  await t.test("missing route source bytes", () => {
    const fixture = officialRouteFixture();
    fixture.sourceFiles.delete("src/LaunchRoute.sol");
    assertOfficialRouteRejects(fixture, "APPLICATION_V3_ROUTE_SOURCE_BYTES_MISMATCH");
  });

  await t.test("substituted fee source bytes", () => {
    const fixture = officialRouteFixture();
    fixture.sourceFiles.set("src/FeeConfiguration.sol", Buffer.from("substituted fee implementation\n"));
    assertOfficialRouteRejects(fixture, "APPLICATION_V3_ROUTE_SOURCE_BYTES_MISMATCH");
  });

  await t.test("jointly rewritten descriptor and configuration hash over unchanged source bytes", () => {
    const fixture = officialRouteFixture();
    const document = structuredClone(fixture.launchReadinessDocument);
    document.route.sourceIdentity.artifact.sha256 = `sha256:${"f".repeat(64)}`;
    document.route.sourceIdentity.artifact.gitBlobOid = "f".repeat(40);
    const configurationHash = deriveProgrammableLaunchRouterSourceConfigurationHashV1({
      feeImplementationArtifact: document.feeConfiguration.implementationArtifact,
      routeArtifact: document.route.sourceIdentity.artifact
    });
    document.route.sourceIdentity.configurationHash = configurationHash;
    document.subject.sourceConfigurationHash = configurationHash;
    rebindLaunchReadiness(fixture, document);
    assertOfficialRouteRejects(fixture, "APPLICATION_V3_ROUTE_SOURCE_BYTES_MISMATCH");
  });

  await t.test("Application category and kind differ from readiness", () => {
    const fixture = officialRouteFixture();
    fixture.application.launchRequest.category = "classic";
    fixture.application.launchRequest.launchKind = 2;
    fixture.applicationPackageFiles.set("application.v3.json", jsonBytes(fixture.application));
    assertOfficialRouteRejects(fixture, "APPLICATION_V3_ROUTE_PLAN_SEMANTICS_INVALID");
  });
});

test("Application V3.2 cannot select the historical branded Fee V2 contract", () => {
  const fixture = createApplicationV3TestPackage({ applicationContractVersion: "3.2.0" });
  fixture.application.policyBindings.feeApplicability = "applicable";
  fixture.application.policyBindings.programmableFeePolicyId = "programmable-volume-fee-v2";
  const report = validatePublicPrApplicationV3(fixture.application);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code }) => code === "APPLICATION_V3_2_LEGACY_FEE_SELECTION_FORBIDDEN"));
});

test("exact version dispatch never validates V3.1 bytes through Submission 2.1 or V3.2 bytes through Submission 2.0", () => {
  const legacy = createApplicationV3TestPackage();
  const legacyRootRelabeled = structuredClone(legacy.application);
  legacyRootRelabeled.contract.version = "3.2.0";
  const legacyRootReport = validatePublicPrApplicationV3(legacyRootRelabeled);
  assert.equal(legacyRootReport.valid, false);
  assert.deepEqual(
    legacyRootReport.findings.slice(0, 3).map(({ code, path }) => ({ code, path })),
    [
      { code: "SCHEMA_CONST", path: "$.contract.submissionStandard" },
      { code: "SCHEMA_CONST", path: "$.contract.validatorProfile" },
      { code: "SCHEMA_REQUIRED", path: "$.launchRequest" }
    ]
  );
  legacy.sourcePackage.submission.$schema = "urn:programmable:v4-hook-submission:2.1.0";
  legacy.sourcePackage.submission.standardVersion = "2.1.0";
  rebindSourceSubmission(legacy, jsonBytes(legacy.sourcePackage.submission));
  assert.throws(() => validateV2(legacy), (error) => error?.code === "APPLICATION_V3_SUBMISSION_INVALID");

  const current = createApplicationV3TestPackage({ applicationContractVersion: "3.2.0" });
  const currentRootRelabeled = structuredClone(current.application);
  currentRootRelabeled.contract.version = "3.1.0";
  const currentRootReport = validatePublicPrApplicationV3(currentRootRelabeled);
  assert.equal(currentRootReport.valid, false);
  assert.deepEqual(
    currentRootReport.findings.slice(0, 3).map(({ code, path }) => ({ code, path })),
    [
      { code: "SCHEMA_ADDITIONAL_PROPERTY", path: "$.launchRequest" },
      { code: "SCHEMA_CONST", path: "$.contract.submissionStandard" },
      { code: "SCHEMA_CONST", path: "$.contract.validatorProfile" }
    ]
  );
  current.sourcePackage.submission.$schema = "urn:programmable:v4-hook-submission:2.0.0";
  current.sourcePackage.submission.standardVersion = "2.0.0";
  rebindSourceSubmission(current, jsonBytes(current.sourcePackage.submission));
  assert.throws(() => validateV2(current), (error) => error?.code === "APPLICATION_V3_SUBMISSION_INVALID");

  const unsupported = structuredClone(legacy.application);
  unsupported.contract.version = "9.9.9";
  const maliciousSchemaOverride = { type: "object" };
  const unsupportedReport = validatePublicPrApplicationV3(unsupported, { schema: maliciousSchemaOverride });
  assert.equal(unsupportedReport.valid, false);
  assert.ok(unsupportedReport.findings.some(({ code }) => code === "APPLICATION_CONTRACT_VERSION_UNSUPPORTED"));
});

test("V3.1 to V3.2 migration binding records the immutable predecessor version and rejects non-V3.1 input", () => {
  const legacy = createApplicationV3TestPackage();
  const binding = derivePublicPrApplicationV3_2MigrationBinding({
    application: legacy.application,
    applicationSha256: `sha256:${"1".repeat(64)}`,
    packageSha256: `sha256:${"2".repeat(64)}`
  });
  assert.equal(binding.applicationContractVersion, "3.1.0");
  assert.equal(binding.submissionStandard, "2.0.0");
  const current = createApplicationV3TestPackage({ applicationContractVersion: "3.2.0" });
  assert.throws(
    () => derivePublicPrApplicationV3_2MigrationBinding({
      application: current.application,
      applicationSha256: `sha256:${"1".repeat(64)}`,
      packageSha256: `sha256:${"2".repeat(64)}`
    }),
    /requires one exact V3\.1 predecessor/u
  );
});

test("policy-neutral custom-tradable proposal materializes only as an unreviewed architecture-review draft", () => {
  const fixture = createApplicationV3TestPackage({ stage: "proposal" });
  const report = validatePublicPrApplicationV3(fixture.application);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.approvalGranted, false);
  assert.equal(report.deploymentAuthorizationGranted, false);
  assert.equal(report.launchAuthorizationGranted, false);

  const v2 = validateV2(fixture);
  assert.equal(v2.feeApplicability, "not-selected");
  assert.equal(v2.submission.stage, "proposal");
  assert.deepEqual(v2.submission.tradeCapability, {
    applicability: "unresolved",
    facetEntryRef: "routing-trade-capability",
    markets: []
  });

  const generated = generateFixture(fixture);
  assert.equal(generated.materializationAllowed, true, JSON.stringify(generated.report.findings));
  assert.equal(generated.report.approvalGranted, false);
  assert.equal(generated.report.deploymentAuthorizationGranted, false);
  assert.equal(generated.report.launchAuthorizationGranted, false);
  assert.equal(generated.report.implementationAuthorizationGranted, false);

  const result = validatePackage(fixture);
  assert.equal(result.application.stage, "proposal");
  assert.equal(result.application.reviewState.status, "unreviewed");
  assert.equal(result.application.reviewPackage.records.some(({ kind }) => (
    kind === "trade-capability-manifest" || kind === "trade-test-result"
  )), false);
  assert.deepEqual(
    JSON.parse(fixture.applicationPackageFiles.get("compatibility-report.json")),
    { result: "architecture-review-required", schemaVersion: 3 }
  );
});

test("generator stage policy remains closed to proposal and prototype", () => {
  const proposal = generateFixture(createApplicationV3TestPackage({ stage: "proposal" }));
  const prototype = generateFixture(createApplicationV3TestPackage());
  assert.equal(proposal.materializationAllowed, true, JSON.stringify(proposal.report.findings));
  assert.equal(prototype.materializationAllowed, true, JSON.stringify(prototype.report.findings));

  const invalid = createApplicationV3TestPackage({ stage: "proposal" });
  invalid.application.stage = "idea";
  invalid.securityAssessment.subject.stage = "idea";
  const rejected = generateFixture(invalid);
  assert.equal(rejected.materializationAllowed, false);
  assert.ok(rejected.report.findings.some(({ code }) => code === "APPLICATION_GENERATOR_STAGE_INVALID"));
});

test("proposal rejects forged readiness, fabricated trade or Fee evidence, and stage substitution", async (t) => {
  await t.test("forged prototype", () => {
    const fixture = createApplicationV3TestPackage({ stage: "proposal" });
    fixture.application.stage = "prototype";
    fixture.sourcePackage.submission.stage = "prototype";
    const fidelityPath = fixture.sourcePackage.submission.intentPackage.intentFidelity.path;
    const fidelity = JSON.parse(fixture.sourceFiles.get(`submissions/${fixture.application.applicationId}/${fidelityPath}`));
    fidelity.inputDigests.architectureSnapshotSha256 = architectureSnapshotSha256(fixture.sourcePackage.submission);
    rebindSourceArtifact(fixture, "intent-fidelity", fidelityPath, fidelity);
    rebindSourceSubmission(fixture, jsonBytes(fixture.sourcePackage.submission));
    fixture.securityAssessment.subject.stage = "prototype";
    rebindApplicationArtifact(fixture, "security-assessment", jsonBytes(fixture.securityAssessment));
    fixture.applicationPackageFiles.set("application.v3.json", jsonBytes(fixture.application));
    assert.throws(
      () => validateV2(fixture),
      (error) => error?.code === "APPLICATION_REMOTE_V2_PACKAGE_INVALID"
    );
  });

  for (const kind of ["trade-capability-manifest", "trade-test-result"]) {
    await t.test(`fabricated ${kind}`, () => {
      const fixture = createApplicationV3TestPackage({ stage: "proposal" });
      const bytes = jsonBytes({ fabricated: true });
      fixture.application.reviewPackage.records.push({
        kind,
        path: `${kind}.json`,
        mediaType: "application/json",
        byteLength: bytes.length,
        sha256: sha256(bytes),
        source: "application-package",
        repositoryRef: null
      });
      fixture.applicationPackageFiles.set(`${kind}.json`, bytes);
      fixture.applicationPackageFiles.set("application.v3.json", jsonBytes(fixture.application));
      const report = validatePublicPrApplicationV3(fixture.application);
      assert.equal(report.valid, false);
      assert.ok(report.findings.some(({ code }) => code === "APPLICATION_PROPOSAL_TRADE_EVIDENCE_FORBIDDEN"));
    });
  }

  await t.test("fabricated Fee V2 tuple", () => {
    const fixture = createApplicationV3TestPackage({ stage: "proposal" });
    fixture.application.policyBindings.programmableFeePolicyId = "programmable-volume-fee-v2";
    const report = validatePublicPrApplicationV3(fixture.application);
    assert.equal(report.valid, false);
    assert.ok(report.findings.some(({ code }) => code === "APPLICATION_FEE_NOT_SELECTED_BINDING_INVALID"));
  });

  await t.test("prototype-ready compatibility", () => {
    const fixture = createApplicationV3TestPackage({ stage: "proposal" });
    rebindApplicationArtifact(
      fixture,
      "compatibility-report",
      jsonBytes({ result: "prototype-ready", schemaVersion: 3 })
    );
    assert.throws(
      () => validatePackage(fixture),
      (error) => error?.code === "APPLICATION_V3_MATERIALIZATION_INVALID"
    );
  });

  for (const [label, compatibility] of [
    ["wrong compatibility schema version", { result: "architecture-review-required", schemaVersion: 999 }],
    ["extra compatibility authority field", { approvalGranted: true, result: "architecture-review-required", schemaVersion: 3 }]
  ]) {
    await t.test(label, () => {
      const fixture = createApplicationV3TestPackage({ stage: "proposal" });
      rebindApplicationArtifact(fixture, "compatibility-report", jsonBytes(compatibility));
      assert.throws(
        () => validatePackage(fixture),
        (error) => error?.code === "APPLICATION_V3_MATERIALIZATION_INVALID"
      );
    });
  }

  await t.test("application and Submission V2 stage mismatch", () => {
    const fixture = createApplicationV3TestPackage({ stage: "proposal" });
    fixture.application.stage = "prototype";
    assert.throws(
      () => validateV2(fixture),
      (error) => error?.code === "APPLICATION_V3_SUBMISSION_INVALID"
    );
  });
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

function officialRouteFixture() {
  return createApplicationV3TestPackage({
    applicationContractVersion: "3.2.0",
    requestedRoute: "programmable-ethereum-mainnet",
    marketMode: "tradable"
  });
}

function rebindLaunchReadiness(fixture, document) {
  const bytes = Buffer.from(`${canonicalProgrammableLaunchRouterReadinessJson(document)}\n`, "utf8");
  fixture.launchReadinessDocument = document;
  fixture.launchReadinessBytes = bytes;
  fixture.sourceFiles.set(".programmable/launch-router-readiness.v1.json", bytes);
  Object.assign(fixture.application.launchRequest.routePlan, {
    byteLength: bytes.length,
    gitBlobOid: gitBlobOid(bytes),
    sha256: sha256(bytes)
  });
  const record = fixture.application.reviewPackage.records.find(({ kind }) => (
    kind === "programmable-launch-router-readiness"
  ));
  Object.assign(record, { byteLength: bytes.length, sha256: sha256(bytes) });
  fixture.applicationPackageFiles.set("application.v3.json", jsonBytes(fixture.application));
}

function assertOfficialRouteRejects(fixture, code) {
  const packageResult = validatePackage(fixture);
  assert.throws(
    () => validateV2(fixture, packageResult.application),
    (error) => error?.code === code
  );
}

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

function validateV2(fixture, application = fixture.application) {
  return validatePublicApplicationV3SubmissionV2Bytes({
    application,
    submissionBytes: fixture.sourceFiles.get(fixture.application.policyBindings.submissionPath),
    sourceArtifacts: new Map([...fixture.sourceFiles].map(([filePath, bytes]) => [`primary\0${filePath}`, bytes])),
    packageFiles: fixture.applicationPackageFiles
  });
}

function generateFixture(fixture) {
  const sourceCoverage = fixture.application.source.verificationReports.map((binding) => ({
    repositoryRef: binding.repositoryRef,
    revisionObjectId: binding.revisionObjectId,
    treeObjectId: binding.treeObjectId,
    sourceClosureMode: binding.sourceClosureMode,
    sourcePaths: binding.sourcePaths,
    sourcePathsSha256: binding.sourcePathsSha256,
    manifestPath: binding.manifestPath,
    manifestSha256: binding.manifestSha256,
    manifestByteLength: binding.manifestByteLength,
    closureSha256: binding.closureSha256,
    verificationReportPath: binding.reportPath,
    verificationReportSha256: binding.reportSha256,
    verificationReportByteLength: binding.reportByteLength,
    verificationReport: fixture.verificationReport
  }));
  const securityEvidenceBindings = fixture.securityAssessment.assessment.evidenceRefs.map((evidenceRef) => {
    const record = fixture.application.reviewPackage.records.find(({ path }) => path === evidenceRef);
    return {
      evidenceRef,
      kind: record.kind,
      path: record.path,
      repositoryRef: record.repositoryRef,
      sha256: record.sha256,
      source: record.source
    };
  });
  return generatePublicPrApplicationV3({
    application: fixture.application,
    securityAssessment: fixture.securityAssessment,
    sourceCoverage,
    securityEvidenceBindings
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

function rebindSourceArtifact(fixture, kind, relativePath, document) {
  const bytes = jsonBytes(document);
  const sourcePath = `submissions/${fixture.application.applicationId}/${relativePath}`;
  fixture.sourceFiles.set(sourcePath, bytes);
  const binding = fixture.sourcePackage.submission.intentPackage.intentFidelity;
  binding.sha256 = sha256(bytes);
  binding.byteLength = bytes.length;
  const record = fixture.application.reviewPackage.records.find((candidate) => candidate.kind === kind);
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
  } else if (kind === "security-assessment") {
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

function gitBlobOid(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
