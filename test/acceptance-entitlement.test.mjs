import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "../scripts/test/schema-validator/node_modules/ajv/dist/2020.js";

import { canonicalJson } from "../scripts/verify-public-hook-application-core.mjs";
import {
  ACCEPTANCE_COMMAND_VERSION,
  acceptanceCommandSigningBytes,
  authorityKeyId,
  compileLaunchEntitlementEnvelope,
  inspectSixFileApplicationPackage,
  LaunchEntitlementError,
  LAUNCH_ENTITLEMENT_ENVELOPE_VERSION,
  SIGNED_ACCEPTANCE_COMMAND_VERSION
} from "../scripts/acceptance-entitlement-core.mjs";
import {
  FIXTURE_BUILDER_USER_ID,
  makeAcceptancePackageFixture
} from "./helpers/acceptance-package-fixture.mjs";

const ACCEPTED_AT = "2026-08-12T10:00:00.000Z";
const NOW = new Date("2026-08-12T10:05:00.000Z");
const VALID_UNTIL = "2026-08-12T10:10:00.000Z";

test("the signed six-file adapter emits a schema-valid exact entitlement without issuing a permit", (t) => {
  const fixture = createFixture(t);
  const first = compileFixture(fixture);
  const second = compileFixture(fixture);

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, LAUNCH_ENTITLEMENT_ENVELOPE_VERSION);
  assert.equal(first.adapter.profile, "submit-launch-six-file-source-plan-v1");
  assert.equal(first.adapter.nativeSevenFileControlPackage, false);
  assert.equal(first.adapter.synthesizedLaunchJson, false);
  assert.equal(first.controlPackage.fileCount, 6);
  assert.equal(first.launchSpecification.path, fixture.data.launchPlanPath);
  assert.equal(first.execution.approvalServiceHandoff, "authenticated-ingress-requires-native-review-reconciliation-v1");
  assert.equal(first.execution.durableApprovalGrantState, "not-issued");
  assert.equal(first.execution.walletBindingState, "required-at-claim");
  assert.equal(first.execution.launchPermitState, "not-issued");
  assert.equal(first.execution.registryPublicationState, "requires-finalized-launch");
  assert.match(first.entitlementId, /^sha256:[0-9a-f]{64}$/u);

  const validate = compileEnvelopeSchema();
  assert.equal(validate(first), true, JSON.stringify(validate.errors));
});

test("current re-issuance deduplicates the same exact acceptance but review drift changes its id", (t) => {
  const fixture = createFixture(t);
  const original = compileFixture(fixture);
  const reissuedCommand = makeCommand(fixture, {
    acceptedAt: "2026-08-12T10:01:00.000Z",
    validUntil: "2026-08-12T10:11:00.000Z"
  });
  reissuedCommand.acceptedBy.mode = "automation-review";
  const reissued = compileFixture(fixture, { signedCommand: signFixtureCommand(fixture, reissuedCommand) });
  assert.notEqual(reissued.authorization.signedCommandDigest, original.authorization.signedCommandDigest);
  assert.equal(reissued.entitlementId, original.entitlementId);

  const changedReview = makeCommand(fixture);
  changedReview.review.reviewEvidenceDigest = `sha256:${"8".repeat(64)}`;
  const changed = compileFixture(fixture, { signedCommand: signFixtureCommand(fixture, changedReview) });
  assert.notEqual(changed.entitlementId, original.entitlementId);
});

test("the compiler rejects a command signed by an untrusted key", (t) => {
  const fixture = createFixture(t);
  const attacker = crypto.generateKeyPairSync("ed25519");
  const command = makeCommand(fixture);
  const signedCommand = signCommand(command, attacker.privateKey, attacker.publicKey);
  assert.throws(
    () => compileFixture(fixture, { signedCommand }),
    hasCode("AUTHORITY_KEY_MISMATCH")
  );
});

test("the compiler rejects signature tampering and an expired command", (t) => {
  const fixture = createFixture(t);
  const command = makeCommand(fixture);
  const signedCommand = signCommand(command, fixture.privateKey, fixture.publicKey);
  signedCommand.command.pullRequest.headCommitOid = "f".repeat(40);
  assert.throws(() => compileFixture(fixture, { signedCommand }), hasCode("SIGNATURE_INVALID"));

  const expired = makeCommand(fixture, {
    acceptedAt: "2026-08-12T09:40:00.000Z",
    validUntil: "2026-08-12T09:50:00.000Z"
  });
  assert.throws(
    () => compileFixture(fixture, { signedCommand: signFixtureCommand(fixture, expired) }),
    hasCode("COMMAND_NOT_CURRENT")
  );

  const excessiveLifetime = makeCommand(fixture, {
    acceptedAt: "2026-08-12T10:00:00.000Z",
    validUntil: "2026-08-12T10:15:00.001Z"
  });
  assert.throws(
    () => compileFixture(fixture, { signedCommand: signFixtureCommand(fixture, excessiveLifetime) }),
    hasCode("COMMAND_LIFETIME_INVALID")
  );
});

test("the compiler rejects six-file package drift after acceptance", (t) => {
  const fixture = createFixture(t);
  const signedCommand = signFixtureCommand(fixture, makeCommand(fixture));
  fs.appendFileSync(path.join(fixture.packageDirectory, "PROPOSAL.md"), "changed after acceptance\n");
  assert.throws(
    () => compileFixture(fixture, { signedCommand }),
    hasCode("PACKAGE_VALIDATION_FAILED")
  );
});

test("the compiler rejects launch-plan byte drift, undeclared paths, and source drift", (t) => {
  const fixture = createFixture(t);
  const command = makeCommand(fixture);
  const signedCommand = signFixtureCommand(fixture, command);
  fs.writeFileSync(fixture.launchPlanFile, `${canonicalJson({ changed: true })}\n`);
  assert.throws(
    () => compileFixture(fixture, { signedCommand }),
    hasCode("LAUNCH_PLAN_BINDING_MISMATCH")
  );

  fs.writeFileSync(fixture.launchPlanFile, fixture.data.launchPlanBytes);
  const undeclared = makeCommand(fixture);
  undeclared.launchPlan.path = "launch/not-declared.json";
  assert.throws(
    () => compileFixture(fixture, { signedCommand: signFixtureCommand(fixture, undeclared) }),
    hasCode("LAUNCH_PLAN_PATH_UNDECLARED")
  );

  const sourceDrift = makeCommand(fixture);
  sourceDrift.source.primary.revisionObjectId = "c".repeat(40);
  assert.throws(
    () => compileFixture(fixture, { signedCommand: signFixtureCommand(fixture, sourceDrift) }),
    hasCode("SOURCE_BINDING_MISMATCH")
  );

  fs.writeFileSync(fixture.launchPlanFile, '{"duplicate":1,"duplicate":2}\n');
  const duplicatePlan = makeCommand(fixture);
  const duplicateBytes = fs.readFileSync(fixture.launchPlanFile);
  duplicatePlan.launchPlan.byteLength = duplicateBytes.length;
  duplicatePlan.launchPlan.gitBlobOid = gitBlobOid(duplicateBytes);
  duplicatePlan.launchPlan.sha256 = sha256(duplicateBytes);
  assert.throws(
    () => compileFixture(fixture, { signedCommand: signFixtureCommand(fixture, duplicatePlan) }),
    hasCode("LAUNCH_PLAN_JSON_INVALID")
  );
});

test("the protected contract rejects PR-author substitution and review-label fields", (t) => {
  const fixture = createFixture(t);
  const substituted = makeCommand(fixture);
  substituted.pullRequest.authorGitHubUserId = "1234";
  assert.throws(
    () => compileFixture(fixture, { signedCommand: signFixtureCommand(fixture, substituted) }),
    hasCode("PULL_REQUEST_AUTHOR_MISMATCH")
  );

  const labelOnly = makeCommand(fixture);
  labelOnly.githubReviewDecision = "APPROVED";
  assert.throws(
    () => signFixtureCommand(fixture, labelOnly),
    hasCode("ACCEPTANCE_COMMAND_INVALID")
  );
});

test("the protected CLI writes a canonical envelope to stdout and never writes repository state", (t) => {
  const fixture = createFixture(t);
  const clock = new Date();
  const signedCommand = signFixtureCommand(fixture, makeCommand(fixture, {
    acceptedAt: new Date(clock.getTime() - 60_000).toISOString(),
    validUntil: new Date(clock.getTime() + 10 * 60_000).toISOString()
  }));
  const commandFile = path.join(fixture.root, "signed-command.json");
  const keyFile = path.join(fixture.root, "trusted-public-key.pem");
  fs.writeFileSync(commandFile, `${canonicalJson(signedCommand)}\n`, { mode: 0o600 });
  fs.writeFileSync(keyFile, fixture.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  const result = childProcess.spawnSync(process.execPath, [
    path.resolve("scripts/compile-launch-entitlement.mjs"),
    "--signed-command", commandFile,
    "--package-directory", fixture.packageDirectory,
    "--launch-plan-file", fixture.launchPlanFile,
    "--trusted-authority-public-key", keyFile
  ], {
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" },
    shell: false
  });
  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(result.stdout, `${canonicalJson(envelope)}\n`);
  assert.equal(envelope.schemaVersion, LAUNCH_ENTITLEMENT_ENVELOPE_VERSION);
  assert.equal(envelope.execution.launchPermitState, "not-issued");
  assert.equal(fs.readdirSync(fixture.packageDirectory).length, 6);
});

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "submit-launch-entitlement-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const data = makeAcceptancePackageFixture();
  const packageDirectory = path.join(root, data.application.applicationId);
  fs.mkdirSync(packageDirectory);
  for (const [fileName, bytes] of data.files) fs.writeFileSync(path.join(packageDirectory, fileName), bytes);
  const launchPlanFile = path.join(root, "launch-plan.json");
  fs.writeFileSync(launchPlanFile, data.launchPlanBytes);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const inspection = inspectSixFileApplicationPackage({ packageDirectory });
  return { data, inspection, launchPlanFile, packageDirectory, privateKey, publicKey, root };
}

function makeCommand(fixture, overrides = {}) {
  const planBytes = fixture.data.launchPlanBytes;
  return {
    acceptedAt: overrides.acceptedAt ?? ACCEPTED_AT,
    acceptedBy: {
      githubLogin: "programmable-maintainer",
      githubUserId: "1000001",
      mode: "human-review"
    },
    action: "issue-launch-entitlement",
    application: {
      applicationId: fixture.data.application.applicationId,
      applicationRevision: fixture.data.application.applicationRevision,
      builderGitHubUserId: FIXTURE_BUILDER_USER_ID,
      packageContract: "public-pr-application-v2-six-file-v1",
      packageDigest: fixture.inspection.binding.digest
    },
    entitlement: {
      chainId: 1,
      claimPrincipalPolicy: "application-builder-github-user-v1",
      launchCount: 1,
      permitPolicy: "jit-single-use-v1",
      repositoryKeyPolicy: "numeric-github-repository-v1"
    },
    launchPlan: {
      byteLength: planBytes.length,
      gitBlobOid: gitBlobOid(planBytes),
      path: fixture.data.launchPlanPath,
      repositoryRole: "primary",
      sha256: sha256(planBytes)
    },
    pullRequest: {
      authorGitHubUserId: FIXTURE_BUILDER_USER_ID,
      baseCommitOid: "1".repeat(40),
      baseRepository: "0xprogrammable/submit-launch",
      baseRepositoryId: "1320171831",
      baseTreeOid: "2".repeat(40),
      headCommitOid: "3".repeat(40),
      headRepositoryId: "987654321",
      headTreeOid: "4".repeat(40),
      number: 12
    },
    review: {
      decision: "accepted",
      finalVerificationDigest: `sha256:${"5".repeat(64)}`,
      policyBundleDigest: `sha256:${"6".repeat(64)}`,
      reviewEvidenceDigest: `sha256:${"7".repeat(64)}`,
      supersedes: null
    },
    schemaVersion: ACCEPTANCE_COMMAND_VERSION,
    source: {
      companions: [],
      primary: {
        numericRepositoryId: fixture.data.primary.numericRepositoryId,
        repositoryUri: fixture.data.primary.repositoryUri,
        revisionObjectId: fixture.data.primary.revisionObjectId,
        treeObjectId: fixture.data.primary.treeObjectId
      },
      schemaVersion: "1.0.0"
    },
    validUntil: overrides.validUntil ?? VALID_UNTIL
  };
}

function signFixtureCommand(fixture, command) {
  return signCommand(command, fixture.privateKey, fixture.publicKey);
}

function signCommand(command, privateKey, publicKey) {
  const signature = crypto.sign(null, acceptanceCommandSigningBytes(command), privateKey).toString("base64url");
  return {
    authorization: {
      algorithm: "ed25519",
      keyId: authorityKeyId(publicKey),
      signature
    },
    command,
    schemaVersion: SIGNED_ACCEPTANCE_COMMAND_VERSION
  };
}

function compileFixture(fixture, overrides = {}) {
  return compileLaunchEntitlementEnvelope({
    signedCommand: overrides.signedCommand ?? signFixtureCommand(fixture, makeCommand(fixture)),
    packageDirectory: fixture.packageDirectory,
    launchPlanFile: fixture.launchPlanFile,
    trustedAuthorityPublicKey: fixture.publicKey,
    now: NOW
  });
}

function compileEnvelopeSchema() {
  const commandSchema = JSON.parse(fs.readFileSync(path.resolve("acceptance/schemas/protected-acceptance-command-v1.schema.json"), "utf8"));
  const envelopeSchema = JSON.parse(fs.readFileSync(path.resolve("acceptance/schemas/launch-entitlement-envelope-v1.schema.json"), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat("date-time", {
    type: "string",
    validate(value) {
      const parsed = new Date(value);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
    }
  });
  ajv.addSchema(commandSchema);
  return ajv.compile(envelopeSchema);
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function gitBlobOid(bytes) {
  return crypto.createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function hasCode(code) {
  return (error) => error instanceof LaunchEntitlementError && error.code === code;
}
