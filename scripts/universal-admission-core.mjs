import crypto from "node:crypto";
import { TextDecoder } from "node:util";

import {
  canonicalJson,
  parseBoundedLosslessJson,
  sha256Bytes
} from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";

export const UNIVERSAL_ADMISSION_SCHEMA_VERSION = "1.0.0";
export const UNIVERSAL_ADMISSION_SCHEMA_ID = "urn:programmable:universal-admission:1.0.0";
export const UNIVERSAL_ADMISSION_KIND = "programmable-universal-admission";
export const MAX_UNIVERSAL_ADMISSION_BYTES = 256 * 1024;
export const MAX_UNIVERSAL_ADMISSION_NODES = 4096;

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const OBJECT_ID = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!\.git(?:\/|$))[^\\\u0000\r\n]+$/u;
const STATUS = new Set(["declared", "not-applicable", "unknown"]);
const ROUTES = new Set(["none", "programmable-ethereum-mainnet", "other"]);
const STAGES = new Set(["proposal", "prototype", "launch-request"]);
const VALUE_KINDS = new Set(["none", "swap", "fee", "reward", "custody", "other"]);
const EVIDENCE_KINDS = new Set(["source", "test", "observed", "external", "self-reported"]);

export class UniversalAdmissionError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "UniversalAdmissionError";
    this.code = code;
    this.path = options?.path ?? null;
  }
}

/**
 * Parse and validate the cheap, project-agnostic front door. This contract
 * intentionally does not execute source, perform network calls, classify a
 * project type, or claim safety/approval. It only rejects malformed or
 * internally dishonest transport and returns a reviewability status.
 */
export function validateUniversalAdmissionBytes(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(bytes ?? []);
  if (buffer.length < 2 || buffer.length > MAX_UNIVERSAL_ADMISSION_BYTES) {
    fail("UNIVERSAL_ADMISSION_SIZE_INVALID", "Universal admission bytes exceed the closed 256 KiB boundary.");
  }
  let source;
  let parsed;
  try {
    source = decoder.decode(buffer);
    parsed = parseBoundedLosslessJson(source);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_JSON_INVALID", "Admission bytes must be duplicate-free UTF-8 JSON.", { cause: error });
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_JSON_INVALID", "Admission bytes must be valid JSON.", { cause: error });
  }
  if (canonicalJson(parsed) !== canonicalJson(value)) {
    fail("UNIVERSAL_ADMISSION_JSON_NUMBER_INVALID", "Admission JSON numbers must use the supported canonical representation.");
  }
  const canonicalBytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  if (!buffer.equals(canonicalBytes)) {
    fail("UNIVERSAL_ADMISSION_JSON_NONCANONICAL", "Admission bytes must be compact canonical JSON followed by one LF.");
  }
  return validateUniversalAdmission(value, { bytes: buffer });
}

export function validateUniversalAdmission(value, options = {}) {
  const canonicalBytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  let bytes = canonicalBytes;
  if (options.bytes !== undefined) {
    try {
      bytes = Buffer.from(options.bytes);
    } catch (error) {
      fail("UNIVERSAL_ADMISSION_BYTES_INVALID", "Admission bytes must be a byte sequence.", { cause: error });
    }
    if (!bytes.equals(canonicalBytes)) {
      fail("UNIVERSAL_ADMISSION_BYTES_MISMATCH", "Admission result bytes must be the canonical bytes of the validated value.");
    }
  }
  countNodes(value);
  object(value, "$", ["$schema", "application", "attestation", "disclosure", "kind", "schemaVersion", "source"]);
  exact(value.$schema, UNIVERSAL_ADMISSION_SCHEMA_ID, "$.$schema");
  exact(value.kind, UNIVERSAL_ADMISSION_KIND, "$.kind");
  exact(value.schemaVersion, UNIVERSAL_ADMISSION_SCHEMA_VERSION, "$.schemaVersion");

  object(value.application, "$.application", ["id", "projectLabel", "requestedRoute", "revision", "stage"]);
  id(value.application.id, "$.application.id");
  text(value.application.projectLabel, "$.application.projectLabel", 1, 160);
  boundedDecimal(value.application.revision, "$.application.revision", 31);
  enumValue(value.application.stage, STAGES, "$.application.stage");
  enumValue(value.application.requestedRoute, ROUTES, "$.application.requestedRoute");

  object(value.source, "$.source", ["commit", "packageSha256", "path", "repositoryUrl", "tree"], ["repositoryId"]);
  text(value.source.repositoryUrl, "$.source.repositoryUrl", 12, 2048);
  if (!value.source.repositoryUrl.startsWith("https://") || /[\s\u0000\r\n]/u.test(value.source.repositoryUrl)) {
    failAt("UNIVERSAL_ADMISSION_SOURCE_URL_INVALID", "Source repository URL must be public HTTPS.", "$.source.repositoryUrl");
  }
  if (value.source.repositoryId !== undefined) {
    text(value.source.repositoryId, "$.source.repositoryId", 1, 32);
    if (!/^[0-9]+$/u.test(value.source.repositoryId)) failAt("UNIVERSAL_ADMISSION_SOURCE_ID_INVALID", "Source repositoryId must be decimal.", "$.source.repositoryId");
  }
  objectId(value.source.commit, "$.source.commit");
  objectId(value.source.tree, "$.source.tree");
  safePath(value.source.path, "$.source.path");
  sha256(value.source.packageSha256, "$.source.packageSha256");

  object(value.attestation, "$.attestation", ["candidateCodeExecuted", "externalWritesPerformed", "noApprovalClaim", "noSafetyGuaranteeClaim", "publicDataOnly", "unknownsExplicit"]);
  for (const key of ["candidateCodeExecuted", "externalWritesPerformed"]) exact(value.attestation[key], false, `$.attestation.${key}`);
  for (const key of ["noApprovalClaim", "noSafetyGuaranteeClaim", "publicDataOnly", "unknownsExplicit"]) exact(value.attestation[key], true, `$.attestation.${key}`);

  object(value.disclosure, "$.disclosure", ["dependencies", "executionSurfaces", "privileges", "valueFlows"], ["evidence"]);
  list(value.disclosure.executionSurfaces, "$.disclosure.executionSurfaces", 1, 32);
  list(value.disclosure.valueFlows, "$.disclosure.valueFlows", 1, 32);
  list(value.disclosure.privileges, "$.disclosure.privileges", 1, 32);
  list(value.disclosure.dependencies, "$.disclosure.dependencies", 1, 32);
  uniqueIds(value.disclosure.executionSurfaces, "$.disclosure.executionSurfaces");
  uniqueIds(value.disclosure.valueFlows, "$.disclosure.valueFlows");
  uniqueIds(value.disclosure.privileges, "$.disclosure.privileges");
  uniqueIds(value.disclosure.dependencies, "$.disclosure.dependencies");
  value.disclosure.executionSurfaces.forEach((entry, index) => validateSurface(entry, `$.disclosure.executionSurfaces[${index}]`));
  value.disclosure.valueFlows.forEach((entry, index) => validateValueFlow(entry, `$.disclosure.valueFlows[${index}]`));
  value.disclosure.privileges.forEach((entry, index) => validatePrivilege(entry, `$.disclosure.privileges[${index}]`));
  value.disclosure.dependencies.forEach((entry, index) => validateDependency(entry, `$.disclosure.dependencies[${index}]`));
  if (value.disclosure.evidence !== undefined) {
    list(value.disclosure.evidence, "$.disclosure.evidence", 0, 64);
    uniqueIds(value.disclosure.evidence, "$.disclosure.evidence");
    value.disclosure.evidence.forEach((entry, index) => validateEvidence(entry, `$.disclosure.evidence[${index}]`));
  }

  const unknownCount = countUnknowns(value.disclosure);
  const route = value.application.requestedRoute;
  const routeStatus = route === "programmable-ethereum-mainnet"
    ? "platform-route-pending"
    : route === "other" ? "external-route-disclosed" : "not-selected";
  const status = unknownCount > 0 || route === "programmable-ethereum-mainnet"
    ? "ADMITTED_FOR_REVIEW_ANALYSIS_PENDING"
    : "ADMITTED_FOR_REVIEW";
  const report = {
    kind: "programmable-universal-admission-result",
    schemaVersion: UNIVERSAL_ADMISSION_SCHEMA_VERSION,
    status,
    reviewState: unknownCount > 0 ? "analysis_pending" : "ready_for_review",
    routeStatus,
    unknownCount,
    sourceDigest: sha256Bytes(bytes),
    authority: {
      candidateCodeExecuted: false,
      externalWritesPerformed: false,
      independentAudit: false,
      launchAuthorized: false,
      approvalGranted: false
    },
    findings: route === "programmable-ethereum-mainnet"
      ? [{ code: "PLATFORM_ROUTE_REVIEW_REQUIRED", severity: "advisory", message: "The Programmable Ethereum-mainnet commercial route is selected; its current policy is checked only in a later route/launch review." }]
      : []
  };
  return Object.freeze({ ...report, authority: Object.freeze(report.authority), findings: Object.freeze(report.findings) });
}

export function digestUniversalAdmission(value) {
  return `sha256:${crypto.createHash("sha256").update(Buffer.from(`${canonicalJson(value)}\n`, "utf8")).digest("hex")}`;
}

function validateSurface(value, location) {
  object(value, location, ["id", "kind", "sourceRefs", "status", "summary"]);
  id(value.id, `${location}.id`); label(value.kind, `${location}.kind`); enumValue(value.status, STATUS, `${location}.status`); text(value.summary, `${location}.summary`, 1, 1000); sourceRefs(value.sourceRefs, `${location}.sourceRefs`);
}

function validateValueFlow(value, location) {
  object(value, location, ["basis", "from", "id", "kind", "sourceRefs", "status", "to"]);
  id(value.id, `${location}.id`); enumValue(value.kind, VALUE_KINDS, `${location}.kind`); enumValue(value.status, STATUS, `${location}.status`);
  text(value.from, `${location}.from`, 1, 160); text(value.to, `${location}.to`, 1, 160); text(value.basis, `${location}.basis`, 1, 320); sourceRefs(value.sourceRefs, `${location}.sourceRefs`);
  if (value.kind === "none" && value.status === "declared" && value.from !== "none" && value.to !== "none") failAt("UNIVERSAL_ADMISSION_NONE_FLOW_INVALID", "A declared no-flow entry must use from/to=none.", location);
}

function validatePrivilege(value, location) {
  object(value, location, ["id", "kind", "sourceRefs", "status", "summary"]);
  id(value.id, `${location}.id`); label(value.kind, `${location}.kind`); enumValue(value.status, STATUS, `${location}.status`); text(value.summary, `${location}.summary`, 1, 600); sourceRefs(value.sourceRefs, `${location}.sourceRefs`);
}

function validateDependency(value, location) {
  object(value, location, ["failureMode", "id", "kind", "sourceRefs", "status"]);
  id(value.id, `${location}.id`); label(value.kind, `${location}.kind`); enumValue(value.status, STATUS, `${location}.status`); text(value.failureMode, `${location}.failureMode`, 1, 600); sourceRefs(value.sourceRefs, `${location}.sourceRefs`);
}

function validateEvidence(value, location) {
  object(value, location, ["id", "kind", "ref", "status"], ["sha256"]);
  id(value.id, `${location}.id`); enumValue(value.kind, EVIDENCE_KINDS, `${location}.kind`); enumValue(value.status, new Set(["declared", "observed", "independently-verified", "unknown"]), `${location}.status`); text(value.ref, `${location}.ref`, 1, 512);
  if (value.sha256 !== undefined) sha256(value.sha256, `${location}.sha256`);
}

function sourceRefs(value, location) {
  list(value, location, 0, 16);
  const seen = new Set();
  for (const [index, entry] of value.entries()) { safePath(entry, `${location}[${index}]`); if (seen.has(entry)) failAt("UNIVERSAL_ADMISSION_DUPLICATE_REF", "Source references must be unique.", location); seen.add(entry); }
}

function uniqueIds(listValue, location) {
  const seen = new Set();
  for (const [index, entry] of listValue.entries()) { if (typeof entry?.id !== "string") failAt("UNIVERSAL_ADMISSION_ID_INVALID", "Each disclosure entry needs an id.", `${location}[${index}].id`); if (seen.has(entry.id)) failAt("UNIVERSAL_ADMISSION_DUPLICATE_ID", "Disclosure ids must be unique within a section.", `${location}[${index}].id`); seen.add(entry.id); }
}

function countUnknowns(disclosure) {
  return [disclosure.executionSurfaces, disclosure.valueFlows, disclosure.privileges, disclosure.dependencies].flat().filter(({ status }) => status === "unknown").length;
}

function countNodes(value) {
  let count = 0;
  const stack = [value];
  while (stack.length) {
    const current = stack.pop(); count += 1;
    if (count > MAX_UNIVERSAL_ADMISSION_NODES) fail("UNIVERSAL_ADMISSION_NODE_LIMIT", "Admission JSON exceeds the bounded node budget.");
    if (Array.isArray(current)) stack.push(...current);
    else if (current && typeof current === "object") stack.push(...Object.values(current));
  }
}

function object(value, location, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) failAt("UNIVERSAL_ADMISSION_OBJECT_INVALID", "Expected an object.", location);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) failAt("UNIVERSAL_ADMISSION_FIELD_INVALID", `Unexpected field ${key}.`, `${location}.${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) failAt("UNIVERSAL_ADMISSION_FIELD_MISSING", `Missing field ${key}.`, `${location}.${key}`);
}
function exact(value, expected, location) { if (value !== expected) failAt("UNIVERSAL_ADMISSION_ASSERTION_INVALID", `Expected ${String(expected)}.`, location); }
function enumValue(value, allowed, location) { if (typeof value !== "string" || !allowed.has(value)) failAt("UNIVERSAL_ADMISSION_ENUM_INVALID", "Value is outside the closed status vocabulary.", location); }
function text(value, location, minimum, maximum) { if (typeof value !== "string" || value.length < minimum || value.length > maximum || /[\u0000\r\n]/u.test(value)) failAt("UNIVERSAL_ADMISSION_TEXT_INVALID", "Text is outside its bounded printable range.", location); }
function label(value, location) { text(value, location, 1, 120); if (!/^[^\s]+(?:\s+[^\s]+)*$/u.test(value)) failAt("UNIVERSAL_ADMISSION_LABEL_INVALID", "Label must contain visible text.", location); }
function id(value, location) { if (typeof value !== "string" || !ID.test(value) || value.length > 80) failAt("UNIVERSAL_ADMISSION_ID_INVALID", "Identifier is not a bounded slug.", location); }
function boundedDecimal(value, location, maximumLength) { if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value) || value.length > maximumLength) failAt("UNIVERSAL_ADMISSION_REVISION_INVALID", "Revision must be a bounded positive decimal string.", location); }
function objectId(value, location) { if (typeof value !== "string" || !OBJECT_ID.test(value)) failAt("UNIVERSAL_ADMISSION_OBJECT_ID_INVALID", "Expected a lowercase 40-character Git object id.", location); }
function sha256(value, location) { if (typeof value !== "string" || !SHA256.test(value)) failAt("UNIVERSAL_ADMISSION_SHA256_INVALID", "Expected a sha256: digest.", location); }
function safePath(value, location) { text(value, location, 1, 256); if (!SAFE_PATH.test(value)) failAt("UNIVERSAL_ADMISSION_PATH_INVALID", "Path traversal, absolute paths, and control characters are forbidden.", location); }
function list(value, location, minimum, maximum) { if (!Array.isArray(value) || value.length < minimum || value.length > maximum) failAt("UNIVERSAL_ADMISSION_LIST_INVALID", `Expected an array with ${minimum}..${maximum} entries.`, location); }
function fail(code, message, options) { throw new UniversalAdmissionError(code, message, options); }
function failAt(code, message, location) { throw new UniversalAdmissionError(code, message, { path: location }); }
