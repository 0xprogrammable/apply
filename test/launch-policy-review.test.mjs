import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "../scripts/test/schema-validator/node_modules/ajv/dist/2020.js";

import {
  canonicalLaunchPolicyDecision,
  digestLaunchPolicyDecision,
  evaluateTrustedLaunchPolicyReview,
  validateLaunchPolicyReviewInput
} from "../review/launch-policy-review-core.mjs";
import {
  buildLaunchPolicyBinding,
  canonicalJson,
  readTrustedLaunchPolicyFromGit,
  rulesForProfile
} from "../scripts/launch-policy-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const policyPath = path.join(root, "policy/launch-policy.v1.json");

function runGit(repositoryRoot, args) {
  return childProcess.execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "review-test@example.invalid",
      GIT_AUTHOR_NAME: "Review Test",
      GIT_COMMITTER_EMAIL: "review-test@example.invalid",
      GIT_COMMITTER_NAME: "Review Test"
    }
  }).trim();
}

function trustedReviewFixture(t) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "launch-policy-review-"));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repositoryRoot, "policy"), { recursive: true });
  fs.copyFileSync(policyPath, path.join(repositoryRoot, "policy/launch-policy.v1.json"));
  runGit(repositoryRoot, ["init", "--initial-branch=main"]);
  runGit(repositoryRoot, ["remote", "add", "origin", "https://github.com/0xprogrammable/submit-launch.git"]);
  runGit(repositoryRoot, ["add", "policy/launch-policy.v1.json"]);
  runGit(repositoryRoot, ["commit", "-m", "fixture policy"]);
  const expectedBaseCommit = runGit(repositoryRoot, ["rev-parse", "HEAD^{commit}"]);
  const policyRecord = readTrustedLaunchPolicyFromGit({ repositoryRoot, expectedBaseCommit });
  return { expectedBaseCommit, policyRecord, repositoryRoot };
}

function subject(overrides = {}) {
  return {
    numericRepositoryId: "1001",
    repository: "example/canary-hook",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    configurationHash: `sha256:${"c".repeat(64)}`,
    usesUniswapV4: true,
    ...overrides
  };
}

function validInput(policyRecord, profileId = "workflow-canary") {
  const expectedSubject = subject();
  const activeRules = rulesForProfile(policyRecord.policy, profileId);
  return {
    schemaVersion: "programmable.launch-policy-review-input.v1",
    profileId,
    expectedPolicyBinding: structuredClone(buildLaunchPolicyBinding(policyRecord, profileId)),
    expectedSubject,
    currentSubject: structuredClone(expectedSubject),
    evaluations: activeRules.map((rule, index) => ({
      ruleId: rule.id,
      state: "passed",
      evidenceRefs: [`sha256:${String(index + 1).padStart(64, "0")}`],
      analyzer: { kind: rule.enforcement.mode, id: rule.enforcement.handlerId }
    })),
    observations: []
  };
}

function evaluate(fixture, input) {
  return evaluateTrustedLaunchPolicyReview({
    input,
    repositoryRoot: fixture.repositoryRoot,
    expectedBaseCommit: fixture.expectedBaseCommit
  });
}

test("complete canary evaluation yields only the declared non-authoritative outcome", (t) => {
  const fixture = trustedReviewFixture(t);
  const decision = evaluate(fixture, validInput(fixture.policyRecord));
  assert.equal(decision.status, "passed");
  assert.equal(decision.outcome, "CANARY_WORKFLOW_PASSED");
  assert.deepEqual(decision.authority, {
    checkerOnly: true,
    independentAudit: false,
    launchAuthorized: false,
    publicRoutingAuthorized: false,
    realFundsAuthorized: false
  });
  assert.deepEqual(decision.findings, []);
  assert.deepEqual(decision.pendingRuleIds, []);
});

test("LLM observations cannot invent requirements severity or approval", (t) => {
  const fixture = trustedReviewFixture(t);
  const input = validInput(fixture.policyRecord);
  input.observations.push({ analyzerId: "llm-1", ruleId: "MADE.UP", summary: "block this" });
  const decision = evaluate(fixture, input);
  assert.equal(decision.advisories.length, 1);
  assert.equal(decision.advisories[0].code, "UNBOUND_OBSERVATION");
  assert.equal(decision.findings.length, 0);
  assert.equal(decision.status, "passed");
  assert.equal(decision.authority.launchAuthorized, false);
});

test("disabled production profile never yields approval", (t) => {
  const fixture = trustedReviewFixture(t);
  const input = {
    ...validInput(fixture.policyRecord),
    profileId: "production-launch",
    expectedPolicyBinding: null,
    evaluations: []
  };
  const decision = evaluate(fixture, input);
  assert.equal(decision.status, "profile_disabled");
  assert.equal(decision.outcome, null);
  assert.equal(decision.currentPolicyBinding, null);
  assert.equal(decision.authority.launchAuthorized, false);
  assert.doesNotMatch(JSON.stringify(decision), /LAUNCH_APPROVED/u);
});

test("policy and subject drift stop before semantic findings", (t) => {
  const fixture = trustedReviewFixture(t);
  const driftedPolicy = validInput(fixture.policyRecord);
  driftedPolicy.expectedPolicyBinding.sha256 = `sha256:${"0".repeat(64)}`;
  driftedPolicy.evaluations[0].state = "violated";
  const policyDecision = evaluate(fixture, driftedPolicy);
  assert.equal(policyDecision.status, "policy_drift");
  assert.deepEqual(policyDecision.findings, []);

  const driftedSubject = validInput(fixture.policyRecord);
  driftedSubject.currentSubject.commit = "d".repeat(40);
  driftedSubject.evaluations[0].state = "violated";
  const subjectDecision = evaluate(fixture, driftedSubject);
  assert.equal(subjectDecision.status, "subject_drift");
  assert.deepEqual(subjectDecision.findings, []);
});

test("missing rules stay pending while authorized violations project policy metadata", (t) => {
  const fixture = trustedReviewFixture(t);
  const pendingInput = validInput(fixture.policyRecord);
  const missing = pendingInput.evaluations.pop();
  const pending = evaluate(fixture, pendingInput);
  assert.equal(pending.status, "analysis_pending");
  assert.deepEqual(pending.pendingRuleIds, [missing.ruleId]);
  assert.deepEqual(pending.findings, []);

  const violatedInput = validInput(fixture.policyRecord);
  const sourceRule = fixture.policyRecord.policy.rules.find(({ id }) => id === "CANARY.EXACT_PUBLIC_SOURCE");
  violatedInput.evaluations.find(({ ruleId }) => ruleId === sourceRule.id).state = "violated";
  const violated = evaluate(fixture, violatedInput);
  assert.equal(violated.status, "changes_requested");
  assert.equal(violated.outcome, null);
  assert.deepEqual(violated.findings, [{
    ruleId: sourceRule.id,
    requirement: sourceRule.requirement,
    severity: sourceRule.severity,
    enforcement: sourceRule.enforcement,
    evidenceRefs: violatedInput.evaluations.find(({ ruleId }) => ruleId === sourceRule.id).evidenceRefs
  }]);
});

test("unknown evaluations are advisory only and analyzer authority must match policy", (t) => {
  const fixture = trustedReviewFixture(t);
  const unknown = validInput(fixture.policyRecord);
  unknown.evaluations.push({
    ruleId: "UNKNOWN.RULE",
    state: "violated",
    evidenceRefs: [`sha256:${"9".repeat(64)}`],
    analyzer: { kind: "deterministic", id: "unknown-handler-v1" }
  });
  const decision = evaluate(fixture, unknown);
  assert.equal(decision.status, "passed");
  assert.equal(decision.findings.length, 0);
  assert.equal(decision.advisories.some(({ code }) => code === "UNBOUND_EVALUATION"), true);

  const forged = validInput(fixture.policyRecord);
  forged.evaluations[0].analyzer = { kind: "llm", id: "llm-1" };
  assert.throws(() => evaluate(fixture, forged), hasCode("REVIEW_ANALYZER_MISMATCH"));
});

test("conditional applicability is derived from the closed subject", (t) => {
  const fixture = trustedReviewFixture(t);
  const input = validInput(fixture.policyRecord, "build");
  input.expectedSubject.usesUniswapV4 = false;
  input.currentSubject.usesUniswapV4 = false;
  input.evaluations = input.evaluations.filter(({ ruleId }) => ruleId !== "BUILD.V4_IDENTITY_PERMISSIONS");
  const decision = evaluate(fixture, input);
  assert.equal(decision.status, "passed");
  assert.deepEqual(decision.notApplicableRuleIds, ["BUILD.V4_IDENTITY_PERMISSIONS"]);
});

test("input grammar is closed and duplicate evaluations cannot compete", (t) => {
  const fixture = trustedReviewFixture(t);
  const extra = validInput(fixture.policyRecord);
  extra.outcome = "LAUNCH_APPROVED";
  assert.throws(() => validateLaunchPolicyReviewInput(extra), hasCode("REVIEW_INPUT_FIELDS_INVALID"));

  const duplicate = validInput(fixture.policyRecord);
  duplicate.evaluations.push(structuredClone(duplicate.evaluations[0]));
  assert.throws(() => validateLaunchPolicyReviewInput(duplicate), hasCode("REVIEW_EVALUATION_DUPLICATE"));

  const injectedMetadata = validInput(fixture.policyRecord);
  injectedMetadata.evaluations[0].severity = "blocker";
  assert.throws(() => validateLaunchPolicyReviewInput(injectedMetadata), hasCode("REVIEW_EVALUATION_INVALID"));

  const unsortedEvidence = validInput(fixture.policyRecord);
  unsortedEvidence.evaluations[0].evidenceRefs = [`sha256:${"2".repeat(64)}`, `sha256:${"1".repeat(64)}`];
  assert.throws(() => validateLaunchPolicyReviewInput(unsortedEvidence), hasCode("REVIEW_EVIDENCE_REFS_INVALID"));
});

test("decisions and digests are deterministic and timestamp-free", (t) => {
  const fixture = trustedReviewFixture(t);
  const input = validInput(fixture.policyRecord);
  input.observations = [
    { analyzerId: "llm-z", ruleId: "UNKNOWN.Z", summary: "z" },
    { analyzerId: "llm-a", ruleId: "UNKNOWN.A", summary: "a" }
  ];
  const first = evaluate(fixture, input);
  input.observations.reverse();
  const second = evaluate(fixture, input);
  assert.equal(canonicalLaunchPolicyDecision(first, fixture.policyRecord), canonicalLaunchPolicyDecision(second, fixture.policyRecord));
  assert.equal(first.digest, second.digest);
  assert.equal(first.digest, digestLaunchPolicyDecision(first, fixture.policyRecord));
  assert.match(first.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(first), /timestamp|createdAt|reviewedAt/iu);
});

test("canonical decision validation rejects re-digested authority or outcome escalation", (t) => {
  const fixture = trustedReviewFixture(t);
  const original = evaluate(fixture, validInput(fixture.policyRecord));

  const authority = structuredClone(original);
  authority.authority.launchAuthorized = true;
  authority.digest = unsafeDecisionDigest(authority);
  assert.throws(() => canonicalLaunchPolicyDecision(authority, fixture.policyRecord), hasCode("REVIEW_DECISION_AUTHORITY_INVALID"));

  const outcome = structuredClone(original);
  outcome.outcome = "LAUNCH_APPROVED";
  outcome.digest = unsafeDecisionDigest(outcome);
  assert.throws(() => canonicalLaunchPolicyDecision(outcome, fixture.policyRecord), hasCode("REVIEW_DECISION_OUTCOME_INVALID"));
});

test("canonical validation re-establishes binding subject and verdict semantics from trusted policy", (t) => {
  const fixture = trustedReviewFixture(t);
  const original = evaluate(fixture, validInput(fixture.policyRecord));
  assert.equal(canonicalLaunchPolicyDecision(original, fixture.policyRecord), canonicalJson(original));
  assert.equal(digestLaunchPolicyDecision(original, fixture.policyRecord), original.digest);
  assert.throws(() => canonicalLaunchPolicyDecision(original), hasCode("REVIEW_TRUSTED_POLICY_REQUIRED"));
  assert.throws(() => digestLaunchPolicyDecision(original), hasCode("REVIEW_TRUSTED_POLICY_REQUIRED"));
  runGit(fixture.repositoryRoot, ["commit", "--allow-empty", "-m", "later trusted base"]);
  const laterBaseCommit = runGit(fixture.repositoryRoot, ["rev-parse", "HEAD^{commit}"]);
  const laterPolicyRecord = readTrustedLaunchPolicyFromGit({ repositoryRoot: fixture.repositoryRoot, expectedBaseCommit: laterBaseCommit });
  assert.throws(
    () => canonicalLaunchPolicyDecision(original, laterPolicyRecord),
    hasCode("REVIEW_DECISION_POLICY_PROJECTION_INVALID")
  );

  const binding = structuredClone(original);
  binding.expectedPolicyBinding.sha256 = `sha256:${"0".repeat(64)}`;
  binding.digest = unsafeDecisionDigest(binding);
  assert.throws(() => canonicalLaunchPolicyDecision(binding, fixture.policyRecord), hasCode("REVIEW_DECISION_STATUS_INVALID"));
  assert.throws(() => digestLaunchPolicyDecision(binding, fixture.policyRecord), hasCode("REVIEW_DECISION_STATUS_INVALID"));

  const subjectDrift = structuredClone(original);
  subjectDrift.currentSubject.commit = "d".repeat(40);
  subjectDrift.digest = unsafeDecisionDigest(subjectDrift);
  assert.throws(() => canonicalLaunchPolicyDecision(subjectDrift, fixture.policyRecord), hasCode("REVIEW_DECISION_STATUS_INVALID"));
  assert.throws(() => digestLaunchPolicyDecision(subjectDrift, fixture.policyRecord), hasCode("REVIEW_DECISION_STATUS_INVALID"));

  const violation = structuredClone(original);
  violation.evaluations[0].state = "violated";
  violation.evaluations = canonicalSort(violation.evaluations);
  violation.digest = unsafeDecisionDigest(violation);
  assert.throws(() => canonicalLaunchPolicyDecision(violation, fixture.policyRecord), hasCode("REVIEW_DECISION_STATUS_INVALID"));
  assert.throws(() => digestLaunchPolicyDecision(violation, fixture.policyRecord), hasCode("REVIEW_DECISION_STATUS_INVALID"));
});

test("canonical validation reconstructs analyzer and every finding field from trusted policy", (t) => {
  const fixture = trustedReviewFixture(t);
  const input = validInput(fixture.policyRecord);
  input.evaluations.find(({ ruleId }) => ruleId === "CANARY.EXACT_PUBLIC_SOURCE").state = "violated";
  const original = evaluate(fixture, input);
  assert.equal(original.status, "changes_requested");

  const analyzer = structuredClone(original);
  analyzer.evaluations.find(({ ruleId }) => ruleId === "CANARY.EXACT_PUBLIC_SOURCE").analyzer = { kind: "llm", id: "llm-1" };
  analyzer.evaluations = canonicalSort(analyzer.evaluations);
  analyzer.digest = unsafeDecisionDigest(analyzer);
  assert.throws(() => canonicalLaunchPolicyDecision(analyzer, fixture.policyRecord), hasCode("REVIEW_DECISION_POLICY_PROJECTION_INVALID"));
  assert.throws(() => digestLaunchPolicyDecision(analyzer, fixture.policyRecord), hasCode("REVIEW_DECISION_POLICY_PROJECTION_INVALID"));

  for (const mutate of [
    (finding) => { finding.requirement = "Attacker-authored requirement."; },
    (finding) => { finding.severity = "required"; },
    (finding) => { finding.enforcement.owner = "maintainer"; },
    (finding) => { finding.enforcement.handlerId = "attacker-handler-v1"; }
  ]) {
    const decision = structuredClone(original);
    mutate(decision.findings[0]);
    decision.findings = canonicalSort(decision.findings);
    decision.digest = unsafeDecisionDigest(decision);
    assert.throws(
      () => canonicalLaunchPolicyDecision(decision, fixture.policyRecord),
      hasCode("REVIEW_DECISION_POLICY_PROJECTION_INVALID")
    );
    assert.throws(
      () => digestLaunchPolicyDecision(decision, fixture.policyRecord),
      hasCode("REVIEW_DECISION_POLICY_PROJECTION_INVALID")
    );
  }
});

test("policy drift never accepts a binding from another profile", (t) => {
  const fixture = trustedReviewFixture(t);
  const original = evaluate(fixture, validInput(fixture.policyRecord));

  const crossExpected = asPolicyDrift(original);
  crossExpected.expectedPolicyBinding.profileId = "build";
  crossExpected.digest = unsafeDecisionDigest(crossExpected);
  assert.throws(
    () => digestLaunchPolicyDecision(crossExpected, fixture.policyRecord),
    hasCode("REVIEW_DECISION_PROFILE_INVALID")
  );
  assert.throws(
    () => canonicalLaunchPolicyDecision(crossExpected, fixture.policyRecord),
    hasCode("REVIEW_DECISION_PROFILE_INVALID")
  );

  const crossCurrent = asPolicyDrift(original);
  crossCurrent.currentPolicyBinding.profileId = "build";
  crossCurrent.digest = unsafeDecisionDigest(crossCurrent);
  assert.throws(
    () => digestLaunchPolicyDecision(crossCurrent, fixture.policyRecord),
    hasCode("REVIEW_DECISION_PROFILE_INVALID")
  );
  assert.throws(
    () => canonicalLaunchPolicyDecision(crossCurrent, fixture.policyRecord),
    hasCode("REVIEW_DECISION_PROFILE_INVALID")
  );

  const realDrift = asPolicyDrift(original);
  realDrift.expectedPolicyBinding.sha256 = `sha256:${"0".repeat(64)}`;
  realDrift.digest = unsafeDecisionDigest(realDrift);
  assert.equal(digestLaunchPolicyDecision(realDrift, fixture.policyRecord), realDrift.digest);
  assert.equal(canonicalLaunchPolicyDecision(realDrift, fixture.policyRecord), canonicalJson(realDrift));
});

test("new schemas compile strictly and validate examples and decisions", (t) => {
  const fixture = trustedReviewFixture(t);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateInput = ajv.compile(readJson("review/schemas/launch-policy-review-input.v1.schema.json"));
  const validateDecision = ajv.compile(readJson("review/schemas/launch-policy-review-decision.v1.schema.json"));

  for (const name of ["canary-passed.json", "canary-analysis-pending.json", "production-disabled.json"]) {
    const input = readJson(`review/examples/${name}`);
    if (input.profileId !== "production-launch") input.expectedPolicyBinding = buildLaunchPolicyBinding(fixture.policyRecord, input.profileId);
    assert.equal(validateInput(input), true, `${name}: ${JSON.stringify(validateInput.errors)}`);
    const decision = evaluate(fixture, input);
    assert.equal(validateDecision(decision), true, `${name}: ${JSON.stringify(validateDecision.errors)}`);
  }

  const passed = evaluate(fixture, validInput(fixture.policyRecord));
  const contradicted = structuredClone(passed);
  contradicted.evaluations[0].state = "violated";
  assert.equal(validateDecision(contradicted), false, "passed schema must reject a violation evaluation");

  const pendingInput = validInput(fixture.policyRecord);
  pendingInput.evaluations.pop();
  const pending = structuredClone(evaluate(fixture, pendingInput));
  pending.evaluations[0].state = "violated";
  assert.equal(validateDecision(pending), false, "pending schema must reject a violation evaluation");
});

test("published immutable snapshot examples reproduce only against their exact recorded policy commit", (t) => {
  const expectedBaseCommit = "599cbb7f9e6c6daf8a1aeca85340429db5a4f134";
  const snapshotRepositoryRoot = materializeImmutablePolicySnapshot(t, expectedBaseCommit);
  const passed = evaluateTrustedLaunchPolicyReview({
    input: readJson("review/examples/canary-passed.json"),
    repositoryRoot: snapshotRepositoryRoot,
    expectedBaseCommit
  });
  assert.equal(passed.status, "passed");
  assert.equal(passed.outcome, "CANARY_WORKFLOW_PASSED");

  const pending = evaluateTrustedLaunchPolicyReview({
    input: readJson("review/examples/canary-analysis-pending.json"),
    repositoryRoot: snapshotRepositoryRoot,
    expectedBaseCommit
  });
  assert.equal(pending.status, "analysis_pending");
  assert.deepEqual(pending.pendingRuleIds, ["CANARY.NO_REAL_USER_FUNDS", "CANARY.REPRODUCIBLE_INERT_APPLICATION_RECORD"]);
});

function materializeImmutablePolicySnapshot(t, expectedBaseCommit) {
  const fixture = readJson("test/fixtures/launch-policy-review-snapshot-599cbb7.git-objects.v1.json");
  assert.deepEqual(
    Object.keys(fixture).sort(),
    ["baseCommit", "baseTree", "objects", "policyBlobOid", "policyPath", "repository", "schemaVersion"].sort()
  );
  assert.equal(fixture.schemaVersion, "programmable.launch-policy-review-git-snapshot.v1");
  assert.equal(fixture.repository, "0xprogrammable/submit-launch");
  assert.equal(fixture.baseCommit, expectedBaseCommit);
  assert.equal(fixture.baseTree, "3a3ffe028ff3e528bbdfb49d10f287a5d6f23b5a");
  assert.equal(fixture.policyPath, "policy/launch-policy.v1.json");
  assert.equal(fixture.policyBlobOid, "9310a2a83b13430686aadc07a726cca754f2dc70");
  assert.deepEqual(
    fixture.objects.map(({ oid, type }) => ({ oid, type })),
    [
      { oid: fixture.policyBlobOid, type: "blob" },
      { oid: "f20d2dabc8972fc45cb9e8e72ebbebfc92d28e5d", type: "tree" },
      { oid: fixture.baseTree, type: "tree" },
      { oid: fixture.baseCommit, type: "commit" }
    ]
  );

  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "launch-policy-snapshot-"));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  runGit(repositoryRoot, ["init", "--initial-branch=main"]);
  runGit(repositoryRoot, ["remote", "add", "origin", "https://github.com/0xprogrammable/submit-launch.git"]);
  for (const object of fixture.objects) {
    assert.deepEqual(Object.keys(object).sort(), ["base64", "oid", "type"].sort());
    assert.match(object.oid, /^[0-9a-f]{40}$/u);
    assert.ok(new Set(["blob", "commit", "tree"]).has(object.type));
    const bytes = Buffer.from(object.base64, "base64");
    assert.equal(bytes.toString("base64"), object.base64);
    assert.equal(runGitWithInput(repositoryRoot, ["hash-object", "-w", "-t", object.type, "--stdin"], bytes), object.oid);
  }
  assert.equal(runGit(repositoryRoot, ["rev-parse", `${expectedBaseCommit}^{tree}`]), fixture.baseTree);
  assert.equal(
    runGit(repositoryRoot, ["rev-parse", `${expectedBaseCommit}:${fixture.policyPath}`]),
    fixture.policyBlobOid
  );
  return repositoryRoot;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function runGitWithInput(repositoryRoot, args, input) {
  return childProcess.execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "review-test@example.invalid",
      GIT_AUTHOR_NAME: "Review Test",
      GIT_COMMITTER_EMAIL: "review-test@example.invalid",
      GIT_COMMITTER_NAME: "Review Test"
    }
  }).trim();
}

function hasCode(code) {
  return (error) => error?.code === code;
}

function canonicalSort(values) {
  return [...values].sort((left, right) => Buffer.compare(Buffer.from(canonicalJson(left)), Buffer.from(canonicalJson(right))));
}

function unsafeDecisionDigest(decision) {
  const withoutDigest = Object.fromEntries(Object.entries(decision).filter(([key]) => key !== "digest"));
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(withoutDigest), "utf8").digest("hex")}`;
}

function asPolicyDrift(decision) {
  const output = structuredClone(decision);
  output.status = "policy_drift";
  output.outcome = null;
  output.evaluations = [];
  output.pendingRuleIds = [];
  output.notApplicableRuleIds = [];
  output.findings = [];
  return output;
}
