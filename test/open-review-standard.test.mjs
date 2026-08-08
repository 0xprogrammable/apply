import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "../scripts/test/schema-validator/node_modules/ajv/dist/2020.js";

import { canonicalJson, evaluateOpenReview, validateOpenReviewInput } from "../review/open-review-engine.mjs";

const root = path.resolve(".");

test("a disclosed high fee is not treated as an integrity failure", () => {
  const decision = evaluateOpenReview(fixture("disclosed-high-fee.json"));
  assert.equal(decision.status, "launch_ready");
  assert.equal(decision.checkerOnly, true);
  assert.equal(decision.launchAuthorized, false);
  assert.equal(decision.independentAudit, false);
});

test("novel platform-owned semantics remain pending rather than unsafe", () => {
  const decision = evaluateOpenReview(fixture("novel-platform-pending.json"));
  assert.equal(decision.status, "platform_analysis_pending");
  assert.deepEqual(decision.rationaleCodes, ["PLATFORM_CRITICAL_EVIDENCE_OPEN"]);
  assert.equal(decision.blocker, null);
});

test("only a complete supported and independently replayed witness hard-blocks", () => {
  const input = fixture("proven-unauthorized-diversion.json");
  assert.equal(evaluateOpenReview(input).status, "blocked_proven_integrity_failure");

  input.witnesses[0].independentlyReplayed = false;
  const incomplete = evaluateOpenReview(input);
  assert.equal(incomplete.status, "platform_analysis_pending");
  assert.equal(incomplete.blocker, null);
});

test("candidate-owned gaps request changes without calling the project unsafe", () => {
  const input = fixture("disclosed-high-fee.json");
  input.obligations.find(({ axis }) => axis === "disclosure").state = "unknown";
  input.obligations.find(({ axis }) => axis === "disclosure").evidence = [];
  const decision = evaluateOpenReview(input);
  assert.equal(decision.status, "changes_requested");
  assert.equal(decision.blocker, null);
});

test("any exact revision drift invalidates the prior review", () => {
  const input = fixture("disclosed-high-fee.json");
  input.currentRevision.commit = "d".repeat(40);
  assert.equal(evaluateOpenReview(input).status, "changed_since_review");
});

test("decisions and their digests are deterministic", () => {
  const input = fixture("disclosed-high-fee.json");
  const first = evaluateOpenReview(input);
  const second = evaluateOpenReview(input);
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.match(first.digest, /^sha256:[0-9a-f]{64}$/u);
});

test("closed critical obligations require evidence and all critical axes", () => {
  const input = fixture("disclosed-high-fee.json");
  input.obligations[0].evidence = [];
  assert.throws(() => validateOpenReviewInput(input), hasCode("CLOSED_WITHOUT_EVIDENCE"));

  const missingAxis = fixture("disclosed-high-fee.json");
  missingAxis.obligations = missingAxis.obligations.filter(({ axis }) => axis !== "integrity");
  assert.throws(() => validateOpenReviewInput(missingAxis), hasCode("REQUIRED_AXIS_MISSING"));
});

test("candidate-controlled scores and extra fields cannot affect the decision", () => {
  const input = fixture("disclosed-high-fee.json");
  input.riskScore = 100;
  assert.throws(() => validateOpenReviewInput(input), hasCode("FIELDS_INVALID"));
});

test("the published policy keeps novelty neutral and unknown distinct from unsafe", () => {
  const policy = JSON.parse(fs.readFileSync(path.join(root, "review/policy.v1.json"), "utf8"));
  assert.equal(policy.principles.noveltyIsNeutral, true);
  assert.equal(policy.principles.unknownIsUnsafe, false);
  assert.equal(policy.principles.modelVoteCanCloseCriticalUnknown, false);
  assert.equal(policy.blockerRules.filter(({ enforcement }) => enforcement === "hard_block_with_complete_witness").length, 1);
});

test("all public examples and decisions conform to the published closed schemas", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateInput = ajv.compile(JSON.parse(fs.readFileSync(path.join(root, "review/schemas/open-review-input.v1.schema.json"), "utf8")));
  const validateDecision = ajv.compile(JSON.parse(fs.readFileSync(path.join(root, "review/schemas/open-review-decision.v1.schema.json"), "utf8")));

  for (const name of fs.readdirSync(path.join(root, "review/examples")).filter((entry) => entry.endsWith(".json")).sort()) {
    const input = fixture(name);
    assert.equal(validateInput(input), true, `${name}: ${JSON.stringify(validateInput.errors)}`);
    const decision = evaluateOpenReview(input);
    assert.equal(validateDecision(decision), true, `${name}: ${JSON.stringify(validateDecision.errors)}`);
  }
});

test("the public CLI emits a checker-only decision", () => {
  const result = childProcess.spawnSync(process.execPath, ["review/cli.mjs", "review/examples/disclosed-high-fee.json"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.decision.status, "launch_ready");
  assert.equal(output.decision.launchAuthorized, false);
});

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(root, "review/examples", name), "utf8"));
}

function hasCode(code) {
  return (error) => error?.code === code;
}
