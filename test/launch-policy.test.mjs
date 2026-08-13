import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildLaunchPolicyBinding,
  compareLaunchPolicyBindings,
  digestLaunchPolicyBytes,
  evaluateLaunchPolicyRules,
  parseLaunchPolicyBytes,
  readTrustedLaunchPolicyFromGit,
  renderLaunchPolicyMarkdown,
  rulesForProfile,
  selectLaunchPolicyProfile,
  validateLaunchPolicy
} from "../scripts/launch-policy-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const policyPath = path.join(root, "policy/launch-policy.v1.json");

function hasCode(code) {
  return (error) => error?.code === code;
}

function canonicalPolicyRecord() {
  return parseLaunchPolicyBytes(fs.readFileSync(policyPath));
}

function runGit(repositoryRoot, args) {
  return childProcess.execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "policy-test@example.invalid",
      GIT_AUTHOR_NAME: "Policy Test",
      GIT_COMMITTER_EMAIL: "policy-test@example.invalid",
      GIT_COMMITTER_NAME: "Policy Test"
    }
  }).trim();
}

test("canonical policy exposes exactly build canary and disabled production profiles", () => {
  const record = canonicalPolicyRecord();
  assert.deepEqual(record.policy.profiles.map(({ id }) => id), ["build", "production-launch", "workflow-canary"]);
  assert.equal(selectLaunchPolicyProfile(record.policy, "build").enabled, true);
  assert.equal(selectLaunchPolicyProfile(record.policy, "production-launch").enabled, false);
  assert.equal(selectLaunchPolicyProfile(record.policy, "workflow-canary").enabled, true);
  assert.equal(selectLaunchPolicyProfile(record.policy, "build").outcome, "BUILT_NOT_REVIEWED");
  assert.equal(selectLaunchPolicyProfile(record.policy, "workflow-canary").outcome, "CANARY_WORKFLOW_PASSED");
  assert.doesNotMatch(JSON.stringify(record.policy), /LAUNCH_APPROVED/u);
});

test("canonical policy keeps active build and canary rules separate from inactive production history", () => {
  const { policy } = canonicalPolicyRecord();
  assert.deepEqual(rulesForProfile(policy, "build").map(({ id }) => id), [
    "BUILD.DECLARED_EVIDENCE",
    "BUILD.EXACT_SOURCE",
    "BUILD.PRIVILEGED_VALUE_FLOW",
    "BUILD.V4_IDENTITY_PERMISSIONS"
  ]);
  assert.deepEqual(rulesForProfile(policy, "workflow-canary").map(({ id }) => id), [
    "CANARY.APPLICATION_IDENTITY",
    "CANARY.EXACT_PUBLIC_SOURCE",
    "CANARY.HIDDEN_NAMESPACE",
    "CANARY.NO_PUBLIC_ROUTING",
    "CANARY.NO_REAL_USER_FUNDS",
    "CANARY.REPRODUCIBLE_INERT_ARTIFACT"
  ]);
  assert.deepEqual(
    policy.rules.filter(({ status }) => status === "inactive").map(({ id, profiles }) => ({ id, profiles })),
    [
      { id: "LEGACY_V2.ADMISSION", profiles: ["production-launch"] },
      { id: "LEGACY_V2.FEE_PROJECTION", profiles: ["production-launch"] }
    ]
  );
});

test("policy rejects duplicate keys noncanonical bytes duplicate rule ids and unbound handlers", () => {
  assert.throws(
    () => parseLaunchPolicyBytes(Buffer.from('{"policyId":"a","policyId":"b"}\n')),
    hasCode("LAUNCH_POLICY_JSON_INVALID")
  );
  assert.throws(
    () => parseLaunchPolicyBytes(Buffer.from(`${JSON.stringify(canonicalPolicyRecord().policy, null, 2)}\n`)),
    hasCode("LAUNCH_POLICY_JSON_NONCANONICAL")
  );
  assert.throws(
    () => parseLaunchPolicyBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(policyPath)])),
    hasCode("LAUNCH_POLICY_JSON_NONCANONICAL")
  );
  assert.throws(
    () => parseLaunchPolicyBytes(Buffer.from([0xff, 0x0a])),
    hasCode("LAUNCH_POLICY_JSON_INVALID")
  );
  assert.throws(
    () => parseLaunchPolicyBytes(Buffer.alloc((512 * 1024) + 1, 0x20)),
    hasCode("LAUNCH_POLICY_SIZE_INVALID")
  );

  const duplicateRule = structuredClone(canonicalPolicyRecord().policy);
  duplicateRule.rules.push(structuredClone(duplicateRule.rules[0]));
  assert.throws(() => validateLaunchPolicy(duplicateRule), hasCode("LAUNCH_POLICY_RULE_ID_INVALID"));

  const unboundHandler = structuredClone(canonicalPolicyRecord().policy);
  unboundHandler.rules[0].enforcement.handlerId = "undeclared-handler-v1";
  assert.throws(() => validateLaunchPolicy(unboundHandler), hasCode("LAUNCH_POLICY_HANDLER_COVERAGE_INVALID"));

  const orphanedHandler = structuredClone(canonicalPolicyRecord().policy);
  orphanedHandler.rules = orphanedHandler.rules.filter(({ id }) => id !== "BUILD.DECLARED_EVIDENCE");
  assert.throws(() => validateLaunchPolicy(orphanedHandler), hasCode("LAUNCH_POLICY_HANDLER_COVERAGE_INVALID"));
});

test("policy semantic validation rejects field and UTF-8 ordering drift", () => {
  const extraField = structuredClone(canonicalPolicyRecord().policy);
  extraField.hiddenAuthority = true;
  assert.throws(() => validateLaunchPolicy(extraField), hasCode("LAUNCH_POLICY_FIELDS_INVALID"));

  const profileOrder = structuredClone(canonicalPolicyRecord().policy);
  profileOrder.profiles.reverse();
  assert.throws(() => validateLaunchPolicy(profileOrder), hasCode("LAUNCH_POLICY_ORDER_INVALID"));

  const evidenceOrder = structuredClone(canonicalPolicyRecord().policy);
  const disclosure = evidenceOrder.rules.find(({ id }) => id === "BUILD.PRIVILEGED_VALUE_FLOW");
  disclosure.evidence.reverse();
  assert.throws(() => validateLaunchPolicy(evidenceOrder), hasCode("LAUNCH_POLICY_ORDER_INVALID"));
});

test("active deterministic rules require their declared evidence before a profile can pass", () => {
  const record = canonicalPolicyRecord();
  const evidence = Object.fromEntries(
    rulesForProfile(record.policy, "workflow-canary")
      .flatMap(({ evidence: evidenceIds }) => evidenceIds)
      .map((id) => [id, { status: "passed" }])
  );
  const passed = evaluateLaunchPolicyRules({
    policyRecord: record,
    profileId: "workflow-canary",
    subject: {},
    evidence
  });
  assert.equal(passed.passed, true);
  assert.equal(passed.outcome, "CANARY_WORKFLOW_PASSED");
  assert.equal(passed.authority.launchAuthorized, false);
  assert.equal(passed.authority.publicRoutingAllowed, false);
  assert.equal(passed.authority.realUserFundsAllowed, false);

  delete evidence["canary-no-real-user-funds"];
  const failed = evaluateLaunchPolicyRules({ policyRecord: record, profileId: "workflow-canary", subject: {}, evidence });
  assert.equal(failed.passed, false);
  assert.equal(failed.outcome, null);
  assert.deepEqual(failed.findings.map(({ ruleId }) => ruleId), ["CANARY.NO_REAL_USER_FUNDS"]);
  assert.throws(
    () => evaluateLaunchPolicyRules({ policyRecord: record, profileId: "production-launch", subject: {}, evidence: {} }),
    hasCode("LAUNCH_POLICY_PROFILE_DISABLED")
  );
});

test("trusted Git reader binds fixed protected-base identity and rejects substitutions", (t) => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "launch-policy-git-"));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repositoryRoot, "policy"), { recursive: true });
  fs.copyFileSync(policyPath, path.join(repositoryRoot, "policy/launch-policy.v1.json"));
  runGit(repositoryRoot, ["init", "--initial-branch=main"]);
  runGit(repositoryRoot, ["remote", "add", "origin", "https://github.com/0xprogrammable/submit-launch.git"]);
  runGit(repositoryRoot, ["add", "policy/launch-policy.v1.json"]);
  runGit(repositoryRoot, ["commit", "-m", "fixture policy"]);
  const baseCommit = runGit(repositoryRoot, ["rev-parse", "HEAD^{commit}"]);
  const baseTree = runGit(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
  const blob = runGit(repositoryRoot, ["rev-parse", "HEAD:policy/launch-policy.v1.json"]);

  const record = readTrustedLaunchPolicyFromGit({ repositoryRoot, expectedBaseCommit: baseCommit });
  assert.equal(record.baseCommit, baseCommit);
  assert.equal(record.baseTree, baseTree);
  assert.equal(record.gitBlobOid, blob);
  assert.equal(record.path, "policy/launch-policy.v1.json");
  assert.equal(record.repository, "0xprogrammable/submit-launch");
  assert.equal(record.numericRepositoryId, "1320171831");

  const binding = buildLaunchPolicyBinding(record, "workflow-canary");
  assert.deepEqual(Object.keys(binding), [
    "schemaVersion",
    "repository",
    "numericRepositoryId",
    "baseCommit",
    "baseTree",
    "path",
    "gitBlobOid",
    "policyId",
    "policyVersion",
    "profileId",
    "sha256"
  ]);
  assert.equal(compareLaunchPolicyBindings(binding, structuredClone(binding)), true);
  assert.equal(compareLaunchPolicyBindings(binding, { ...binding, profileId: "build" }), false);
  assert.equal(digestLaunchPolicyBytes(record.bytes), record.sha256);

  assert.throws(
    () => readTrustedLaunchPolicyFromGit({ repositoryRoot, expectedBaseCommit: "0".repeat(40) }),
    hasCode("LAUNCH_POLICY_GIT_IDENTITY_INVALID")
  );
  assert.throws(
    () => readTrustedLaunchPolicyFromGit({ repositoryRoot, expectedBaseCommit: baseCommit, path: "attacker.json" }),
    hasCode("LAUNCH_POLICY_READER_ARGUMENTS_INVALID")
  );
});

test("Markdown projection identifies itself as generated and binds exact policy bytes", () => {
  const record = canonicalPolicyRecord();
  const markdown = renderLaunchPolicyMarkdown(record);
  assert.match(markdown, /^# Programmable Launch Policy\n/u);
  assert.match(markdown, /Generated from the canonical policy/u);
  assert.match(markdown, new RegExp(record.sha256, "u"));
  assert.match(markdown, /Production Launch \(disabled\)/u);
  assert.doesNotMatch(markdown, /LAUNCH_APPROVED/u);
});
