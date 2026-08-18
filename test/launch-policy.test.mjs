import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "../scripts/test/schema-validator/node_modules/ajv/dist/2020.js";

import {
  buildLaunchPolicyBinding,
  canonicalJson,
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

function trustedPolicyFixture(t, policy = canonicalPolicyRecord().policy) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "launch-policy-git-"));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repositoryRoot, "policy"), { recursive: true });
  fs.writeFileSync(
    path.join(repositoryRoot, "policy/launch-policy.v1.json"),
    `${canonicalJson(policy)}\n`,
    "utf8"
  );
  runGit(repositoryRoot, ["init", "--initial-branch=main"]);
  runGit(repositoryRoot, ["remote", "add", "origin", "https://github.com/0xprogrammable/submit-launch.git"]);
  runGit(repositoryRoot, ["add", "policy/launch-policy.v1.json"]);
  runGit(repositoryRoot, ["commit", "-m", "fixture policy"]);
  const baseCommit = runGit(repositoryRoot, ["rev-parse", "HEAD^{commit}"]);
  return {
    baseCommit,
    baseTree: runGit(repositoryRoot, ["rev-parse", "HEAD^{tree}"]),
    blob: runGit(repositoryRoot, ["rev-parse", "HEAD:policy/launch-policy.v1.json"]),
    record: readTrustedLaunchPolicyFromGit({ repositoryRoot, expectedBaseCommit: baseCommit }),
    repositoryRoot
  };
}

test("canonical policy exposes exactly build canary and disabled production profiles", () => {
  const record = canonicalPolicyRecord();
  assert.equal(record.policy.policyVersion, "1.3.0");
  assert.deepEqual(record.policy.profiles.map(({ id }) => id), ["build", "production-launch", "workflow-canary"]);
  assert.equal(selectLaunchPolicyProfile(record.policy, "build").enabled, true);
  assert.equal(selectLaunchPolicyProfile(record.policy, "production-launch").enabled, false);
  assert.equal(selectLaunchPolicyProfile(record.policy, "workflow-canary").enabled, true);
  assert.equal(selectLaunchPolicyProfile(record.policy, "build").outcome, "BUILT_NOT_REVIEWED");
  assert.equal(selectLaunchPolicyProfile(record.policy, "workflow-canary").outcome, "CANARY_WORKFLOW_PASSED");
  assert.doesNotMatch(JSON.stringify(record.policy), /LAUNCH_APPROVED/u);
});

test("current production-route policy is one sentence: Ethereum and the Programmable treasury 10 bps", (t) => {
  const { policy } = canonicalPolicyRecord();
  assert.equal(policy.policyVersion, "1.3.0");
  assert.deepEqual(policy.rules.map(({ id }) => id), ["LAUNCH.ETHEREUM_AND_TREASURY_10_BPS"]);
  assert.equal(policy.rules[0].requirement, "A Programmable Ethereum-mainnet launch must route 10 bps of trading volume to the Programmable treasury.");
  assert.deepEqual(rulesForProfile(policy, "build"), []);
  assert.deepEqual(rulesForProfile(policy, "production-launch").map(({ id }) => id), ["LAUNCH.ETHEREUM_AND_TREASURY_10_BPS"]);
  assert.deepEqual(rulesForProfile(policy, "workflow-canary"), []);
  assert.equal(policy.rules.some(({ status }) => status !== "active"), false);

  // The production profile is intentionally disabled. Exercise the deterministic
  // handler through a bounded test-only policy that makes the same rule available
  // to the checker-only build profile; this does not change the canonical policy.
  const checkerPolicy = structuredClone(policy);
  checkerPolicy.rules[0].profiles = ["build", "production-launch"];
  const { record } = trustedPolicyFixture(t, checkerPolicy);
  const validEvidence = {
    "programmable-launch-requirement": {
      basis: "gross-canonical-pool-volume",
      chainId: 1,
      hundredthsOfBip: 1000,
      network: "ethereum-mainnet",
      status: "passed",
      treasury: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c"
    }
  };
  const passed = evaluateLaunchPolicyRules({ policyRecord: record, profileId: "build", subject: {}, evidence: validEvidence });
  assert.equal(passed.passed, true);

  for (const [label, mutate] of [
    ["wrong chain", (evidence) => { evidence["programmable-launch-requirement"].chainId = 8453; }],
    ["wrong treasury", (evidence) => { evidence["programmable-launch-requirement"].treasury = `0x${"0".repeat(40)}`; }],
    ["wrong rate", (evidence) => { evidence["programmable-launch-requirement"].hundredthsOfBip = 999; }]
  ]) {
    const evidence = structuredClone(validEvidence);
    mutate(evidence);
    const failed = evaluateLaunchPolicyRules({ policyRecord: record, profileId: "build", subject: {}, evidence });
    assert.equal(failed.passed, false, label);
    assert.deepEqual(failed.findings.map(({ ruleId }) => ruleId), ["LAUNCH.ETHEREUM_AND_TREASURY_10_BPS"], label);
  }
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
  orphanedHandler.rules = [];
  assert.throws(() => validateLaunchPolicy(orphanedHandler), hasCode("LAUNCH_POLICY_RULE_INVALID"));
});

test("policy semantic validation rejects field and UTF-8 ordering drift", () => {
  const extraField = structuredClone(canonicalPolicyRecord().policy);
  extraField.hiddenAuthority = true;
  assert.throws(() => validateLaunchPolicy(extraField), hasCode("LAUNCH_POLICY_FIELDS_INVALID"));

  const profileOrder = structuredClone(canonicalPolicyRecord().policy);
  profileOrder.profiles.reverse();
  assert.throws(() => validateLaunchPolicy(profileOrder), hasCode("LAUNCH_POLICY_ORDER_INVALID"));

  const evidenceOrder = structuredClone(canonicalPolicyRecord().policy);
  evidenceOrder.rules[0].evidence = ["z-evidence", "a-evidence"];
  assert.throws(() => validateLaunchPolicy(evidenceOrder), hasCode("LAUNCH_POLICY_ORDER_INVALID"));
});

test("active rules cannot become non-enforcing historical records", () => {
  const policy = structuredClone(canonicalPolicyRecord().policy);
  for (const rule of policy.rules.filter(({ status }) => status === "active")) {
    rule.applicability = { mode: "historical" };
  }
  assert.throws(() => validateLaunchPolicy(policy), hasCode("LAUNCH_POLICY_RULE_INVALID"));
});

test("build and canary authority cannot carry routing discovery or real-user funds", () => {
  for (const profileId of ["build", "workflow-canary"]) {
    for (const [field, invalidValue] of [
      ["checkerOnly", false],
      ["independentAudit", true],
      ["launchAuthorized", true],
      ["productionDiscoveryAllowed", true],
      ["publicRoutingAllowed", true],
      ["realUserFundsAllowed", true]
    ]) {
      const policy = structuredClone(canonicalPolicyRecord().policy);
      policy.profiles.find(({ id }) => id === profileId).authority[field] = invalidValue;
      assert.throws(
        () => validateLaunchPolicy(policy),
        hasCode("LAUNCH_POLICY_AUTHORITY_INVALID"),
        `${profileId}.${field}`
      );
    }
  }
});

test("workflow canary carries no admission requirement while production remains disabled", (t) => {
  const { record } = trustedPolicyFixture(t);
  const passed = evaluateLaunchPolicyRules({
    policyRecord: record,
    profileId: "workflow-canary",
    subject: {},
    evidence: {}
  });
  assert.equal(passed.passed, true);
  assert.equal(passed.outcome, "CANARY_WORKFLOW_PASSED");
  assert.equal(passed.authority.launchAuthorized, false);
  assert.equal(passed.authority.publicRoutingAllowed, false);
  assert.equal(passed.authority.realUserFundsAllowed, false);

  assert.throws(
    () => evaluateLaunchPolicyRules({ policyRecord: record, profileId: "production-launch", subject: {}, evidence: {} }),
    hasCode("LAUNCH_POLICY_PROFILE_DISABLED")
  );
});

test("fabricated records cannot mint bindings or evaluate policy", () => {
  const parsed = canonicalPolicyRecord();
  const fabricated = {
    ...parsed,
    repository: "0xprogrammable/submit-launch",
    numericRepositoryId: "1320171831",
    baseCommit: "0".repeat(40),
    baseTree: "0".repeat(40),
    path: "policy/launch-policy.v1.json",
    gitBlobOid: "0".repeat(40),
    sha256: `sha256:${"0".repeat(64)}`
  };
  assert.throws(
    () => buildLaunchPolicyBinding(fabricated, "workflow-canary"),
    hasCode("LAUNCH_POLICY_TRUST_INVALID")
  );
  assert.throws(
    () => evaluateLaunchPolicyRules({ policyRecord: fabricated, profileId: "workflow-canary", subject: {}, evidence: {} }),
    hasCode("LAUNCH_POLICY_TRUST_INVALID")
  );
});

test("trusted record bytes are revalidated and redigested at every authority boundary", (t) => {
  const { record } = trustedPolicyFixture(t);
  record.bytes[0] ^= 0xff;
  assert.throws(
    () => buildLaunchPolicyBinding(record, "workflow-canary"),
    hasCode("LAUNCH_POLICY_TRUST_INVALID")
  );
  assert.throws(
    () => evaluateLaunchPolicyRules({ policyRecord: record, profileId: "workflow-canary", subject: {}, evidence: {} }),
    hasCode("LAUNCH_POLICY_TRUST_INVALID")
  );
});

test("trusted Git reader binds fixed protected-base identity and rejects substitutions", (t) => {
  const { baseCommit, baseTree, blob, record, repositoryRoot } = trustedPolicyFixture(t);
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

test("JSON Schema rejects profile duplication production enablement approval and authority escalation", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, "policy/schemas/launch-policy.v1.schema.json"), "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const canonical = canonicalPolicyRecord().policy;
  assert.equal(validate(canonical), true, JSON.stringify(validate.errors));

  const mutations = [
    (policy) => { policy.profiles[0] = structuredClone(policy.profiles[2]); },
    (policy) => { policy.profiles[0].authority.checkerOnly = false; },
    (policy) => { policy.profiles[0].authority.publicRoutingAllowed = true; },
    (policy) => { policy.profiles[1].enabled = true; },
    (policy) => { policy.profiles[1].outcome = "LAUNCH_APPROVED"; },
    (policy) => { policy.profiles[2].authority.realUserFundsAllowed = true; },
    (policy) => { policy.rules.find(({ status }) => status === "active").applicability = { mode: "historical" }; }
  ];
  for (const mutate of mutations) {
    const policy = structuredClone(canonical);
    mutate(policy);
    assert.equal(validate(policy), false, JSON.stringify(policy.profiles));
  }
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
