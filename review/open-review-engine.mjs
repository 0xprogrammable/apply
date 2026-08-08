import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const reviewRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultPolicy = JSON.parse(fs.readFileSync(path.join(reviewRoot, "policy.v1.json"), "utf8"));
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const OBJECT_ID = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const OBLIGATION_ID = /^[a-z0-9][a-z0-9._-]{2,79}$/u;
const AXES = new Set(["artifact_identity", "functionality", "disclosure", "integrity", "launch_compatibility", "advisory"]);
const OWNERS = new Set(["candidate", "platform"]);
const STATES = new Set(["closed", "unknown", "contradicted", "not_applicable"]);

export function evaluateOpenReview(input, policy = defaultPolicy) {
  validateOpenReviewInput(input, policy);

  const changed = !sameRevision(input.reviewedRevision, input.currentRevision);
  const completeBlocker = input.witnesses
    .map((witness) => ({ rule: policy.blockerRules.find(({ id }) => id === witness.ruleId), witness }))
    .find(({ rule, witness }) => rule?.enforcement === "hard_block_with_complete_witness" && isCompleteWitness(witness));

  const candidateCritical = input.obligations.filter((item) => item.critical && item.owner === "candidate" && !isClosed(item));
  const platformCritical = input.obligations.filter((item) => item.critical && item.owner === "platform" && !isClosed(item));
  const nonBlocking = input.obligations.filter((item) => !item.critical && !isClosed(item));
  const pendingWitnesses = input.witnesses.filter((witness) => {
    const rule = policy.blockerRules.find(({ id }) => id === witness.ruleId);
    return !isCompleteWitness(witness) || rule?.enforcement !== "hard_block_with_complete_witness";
  });

  let status = "launch_ready";
  let blocker = null;
  const rationaleCodes = [];
  const unresolved = [];

  if (changed) {
    status = "changed_since_review";
    rationaleCodes.push("EXACT_REVISION_CHANGED");
  } else if (completeBlocker) {
    status = "blocked_proven_integrity_failure";
    blocker = completeBlocker.witness;
    rationaleCodes.push(`PROVEN_${completeBlocker.witness.ruleId}`);
  } else if (candidateCritical.length > 0) {
    status = "changes_requested";
    rationaleCodes.push("CANDIDATE_CRITICAL_EVIDENCE_OPEN");
    unresolved.push(...candidateCritical.map(publicObligation));
  } else if (platformCritical.length > 0 || pendingWitnesses.length > 0) {
    status = "platform_analysis_pending";
    rationaleCodes.push("PLATFORM_CRITICAL_EVIDENCE_OPEN");
    unresolved.push(...platformCritical.map(publicObligation));
    unresolved.push(...pendingWitnesses.map((witness) => ({
      id: `witness.${witness.ruleId.toLowerCase()}`,
      axis: "integrity",
      owner: "platform",
      statement: isCompleteWitness(witness)
        ? "The claimed rule does not yet have a dedicated hard-block replay class in this policy version."
        : "The claimed integrity failure does not have a complete independently replayed witness."
    })));
  } else {
    rationaleCodes.push("ALL_CRITICAL_AXES_CLOSED");
  }

  const decisionWithoutDigest = {
    schemaVersion: "programmable.open-review-decision.v1",
    policyId: policy.policyId,
    policyVersion: policy.version,
    reviewedRevision: input.reviewedRevision,
    currentRevision: input.currentRevision,
    status,
    checkerOnly: true,
    launchAuthorized: false,
    independentAudit: false,
    rationaleCodes: [...new Set(rationaleCodes)].sort(),
    unresolved: uniqueById(unresolved),
    advisories: nonBlocking.map(publicObligation).sort((a, b) => a.id.localeCompare(b.id)),
    blocker
  };

  return {
    ...decisionWithoutDigest,
    digest: `sha256:${crypto.createHash("sha256").update(canonicalJson(decisionWithoutDigest)).digest("hex")}`
  };
}

export function validateOpenReviewInput(input, policy = defaultPolicy) {
  if (!plainObject(input)) fail("INPUT_INVALID", "review input must be an object");
  exactKeys(input, ["schemaVersion", "reviewedRevision", "currentRevision", "obligations", "witnesses"]);
  if (input.schemaVersion !== "programmable.open-review-input.v1") fail("SCHEMA_VERSION_INVALID", "unsupported review input version");
  validateRevision(input.reviewedRevision, "reviewedRevision");
  validateRevision(input.currentRevision, "currentRevision");
  if (!Array.isArray(input.obligations) || input.obligations.length === 0) fail("OBLIGATIONS_INVALID", "at least one obligation is required");
  if (!Array.isArray(input.witnesses)) fail("WITNESSES_INVALID", "witnesses must be an array");

  const ids = new Set();
  for (const item of input.obligations) {
    if (!plainObject(item)) fail("OBLIGATION_INVALID", "every obligation must be an object");
    exactKeys(item, ["id", "axis", "critical", "owner", "state", "statement", "evidence"]);
    if (!OBLIGATION_ID.test(item.id) || ids.has(item.id)) fail("OBLIGATION_ID_INVALID", "obligation ids must be unique and canonical");
    ids.add(item.id);
    if (!AXES.has(item.axis) || !OWNERS.has(item.owner) || !STATES.has(item.state)) fail("OBLIGATION_ENUM_INVALID", `obligation ${item.id} contains an unsupported value`);
    if (typeof item.critical !== "boolean") fail("OBLIGATION_CRITICAL_INVALID", `obligation ${item.id} critical must be boolean`);
    if (typeof item.statement !== "string" || item.statement.length < 1 || item.statement.length > 1000) fail("OBLIGATION_STATEMENT_INVALID", `obligation ${item.id} statement is invalid`);
    if (!Array.isArray(item.evidence) || new Set(item.evidence).size !== item.evidence.length || item.evidence.some((digest) => !SHA256.test(digest))) fail("OBLIGATION_EVIDENCE_INVALID", `obligation ${item.id} evidence is invalid`);
    if (isClosed(item) && item.evidence.length === 0) fail("CLOSED_WITHOUT_EVIDENCE", `obligation ${item.id} cannot close without evidence`);
    if (item.axis === "advisory" && item.critical) fail("ADVISORY_CRITICAL_INVALID", `advisory ${item.id} cannot be decision-critical`);
  }

  for (const axis of policy.requiredAxes) {
    if (!input.obligations.some((item) => item.axis === axis && item.critical)) fail("REQUIRED_AXIS_MISSING", `critical axis ${axis} is missing`);
  }

  const allowedRules = new Set(policy.blockerRules.map(({ id }) => id));
  for (const witness of input.witnesses) validateWitness(witness, allowedRules);
  return true;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function validateRevision(value, label) {
  if (!plainObject(value)) fail("REVISION_INVALID", `${label} must be an object`);
  exactKeys(value, ["numericRepositoryId", "repository", "commit", "tree", "configurationHash"]);
  if (!Number.isSafeInteger(value.numericRepositoryId) || value.numericRepositoryId < 1) fail("REVISION_REPOSITORY_ID_INVALID", `${label} repository id is invalid`);
  if (!REPOSITORY.test(value.repository)) fail("REVISION_REPOSITORY_INVALID", `${label} repository is invalid`);
  if (!OBJECT_ID.test(value.commit) || !OBJECT_ID.test(value.tree) || !SHA256.test(value.configurationHash)) fail("REVISION_IDENTITY_INVALID", `${label} identity is invalid`);
}

function validateWitness(witness, allowedRules) {
  if (!plainObject(witness)) fail("WITNESS_INVALID", "every witness must be an object");
  exactKeys(witness, ["ruleId", "universal", "revisionBound", "reachable", "complete", "independentlyReplayed", "sequenceHash", "affectedActors", "affectedValue", "violatedProperty", "reproduction"]);
  if (!allowedRules.has(witness.ruleId)) fail("WITNESS_RULE_INVALID", "witness rule is not recognized");
  for (const key of ["universal", "revisionBound", "reachable", "complete", "independentlyReplayed"]) {
    if (typeof witness[key] !== "boolean") fail("WITNESS_FLAG_INVALID", `witness ${key} must be boolean`);
  }
  if (!SHA256.test(witness.sequenceHash)) fail("WITNESS_SEQUENCE_INVALID", "witness sequence hash is invalid");
  for (const key of ["affectedActors", "affectedValue", "violatedProperty", "reproduction"]) {
    if (typeof witness[key] !== "string" || witness[key].trim() === "") fail("WITNESS_TEXT_INVALID", `witness ${key} is invalid`);
  }
}

function isCompleteWitness(witness) {
  return witness.universal && witness.revisionBound && witness.reachable && witness.complete && witness.independentlyReplayed;
}

function isClosed(item) {
  return item.state === "closed" || item.state === "not_applicable";
}

function sameRevision(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function publicObligation(item) {
  return { id: item.id, axis: item.axis, owner: item.owner, statement: item.statement };
}

function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

function exactKeys(value, expected) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) fail("FIELDS_INVALID", "object contains missing or unexpected fields");
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
