import crypto from "node:crypto";
import { types } from "node:util";

import {
  canonicalJson,
  sha256Bytes
} from "../vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs";
import {
  MAX_UNIVERSAL_ADMISSION_BYTES,
  validateUniversalAdmissionBytes
} from "./universal-admission-core.mjs";
import {
  MAX_UNIVERSAL_ADMISSION_COMMAND_BYTES,
  MAX_UNIVERSAL_ADMISSION_COMMAND_CLOCK_SKEW_MS,
  MAX_UNIVERSAL_ADMISSION_COMMAND_LIFETIME_MS
} from "./universal-admission-command-core.mjs";

export const UNIVERSAL_ADMISSION_PROTOCOL_VERSION = "1.0.0";
export const UNIVERSAL_ADMISSION_RUNTIME_POLICY_SCHEMA_ID = "urn:programmable:universal-admission-runtime-policy:1.0.0";
export const UNIVERSAL_ADMISSION_EVENT_RECEIPT_SCHEMA_ID = "urn:programmable:universal-admission-event-receipt:1.0.0";
export const UNIVERSAL_ADMISSION_WORKER_RESULT_SCHEMA_ID = "urn:programmable:universal-admission-worker-result:1.0.0";
export const UNIVERSAL_ADMISSION_SNAPSHOT_SCHEMA_ID = "urn:programmable:universal-admission-snapshot:1.0.0";
export const DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE = "urn:programmable:submit-launch:universal-admission:reference:v1";
export const MAX_UNIVERSAL_ADMISSION_AUTHENTICATED_REQUEST_BYTES = MAX_UNIVERSAL_ADMISSION_BYTES
  + MAX_UNIVERSAL_ADMISSION_COMMAND_BYTES
  + 64;
export const MIN_UNIVERSAL_ADMISSION_DURABLE_RESPONSE_RESERVATION_BYTES = 512;
export const MAX_UNIVERSAL_ADMISSION_RECEIPT_CHAIN_EVENTS = 10000;
export const MAX_UNIVERSAL_ADMISSION_DURABLE_COMMAND_REQUEST_BYTES = 65536;
export const MAX_UNIVERSAL_ADMISSION_CAS_OBJECT_BYTES = 256 * 1024;
export const DEFAULT_UNIVERSAL_ADMISSION_RUNTIME_POLICY = Object.freeze({
  $schema: UNIVERSAL_ADMISSION_RUNTIME_POLICY_SCHEMA_ID,
  commandReplayRetentionMs: "86400000",
  deadLetterPayloadRetentionMs: "86400000",
  fixedWindowMs: "60000",
  kind: "programmable-universal-admission-runtime-policy",
  leaseDurationMs: "10000",
  maxApplicationOutstanding: "8",
  maxAttempts: "3",
  maxDurableCommandBytes: "16777216",
  maxDurableCommands: "4096",
  maxGlobalLeased: "8",
  maxGlobalOutstanding: "64",
  maxLeaseDurationMs: "30000",
  maxLeaseRenewals: "2",
  maxRedrives: "2",
  maxTenantAuthenticatedRequestBytesPerWindow: "4194304",
  maxTenantAuthenticatedRequestsPerWindow: "64",
  maxTenantLeased: "2",
  maxTenantNewBytesPerWindow: "1048576",
  maxTenantNewJobsPerWindow: "16",
  maxTenantOutstanding: "16",
  maxTenantReplayBytes: "4194304",
  maxTenantReplayRecords: "256",
  orphanRetentionMs: "5000",
  retryBaseMs: "1000",
  retryMaxMs: "8000",
  schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
  terminalPayloadRetentionMs: "10000"
});

export const UNIVERSAL_ADMISSION_JOB_STATES = Object.freeze([
  "queued",
  "leased",
  "retry-wait",
  "dead-lettered",
  "processing-completed"
]);
export const UNIVERSAL_ADMISSION_EVENT_TYPES = Object.freeze([
  "queued",
  "lease-claimed",
  "lease-renewed",
  "retry-scheduled",
  "dead-lettered",
  "dead-letter-redriven",
  "processing-completed"
]);
export const UNIVERSAL_ADMISSION_DURABLE_COMMAND_KINDS = Object.freeze([
  "claim",
  "complete",
  "fail",
  "gc",
  "reap-expired",
  "redrive",
  "renew",
  "snapshot",
  "submit"
]);
export const UNIVERSAL_ADMISSION_DURABLE_COMMAND_FAILURE_CODES = Object.freeze({
  claim: Object.freeze([
    "UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY"
  ]),
  complete: Object.freeze([
    "UNIVERSAL_ADMISSION_PROTOCOL_ARTIFACT_MISSING",
    "UNIVERSAL_ADMISSION_PROTOCOL_ARTIFACT_SIZE_MISMATCH",
    "UNIVERSAL_ADMISSION_PROTOCOL_ASSERTION_INVALID",
    "UNIVERSAL_ADMISSION_PROTOCOL_BOOLEAN_INVALID",
    "UNIVERSAL_ADMISSION_PROTOCOL_DECIMAL_INVALID",
    "UNIVERSAL_ADMISSION_PROTOCOL_DIGEST_INVALID",
    "UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY",
    "UNIVERSAL_ADMISSION_PROTOCOL_ENUM_INVALID",
    "UNIVERSAL_ADMISSION_PROTOCOL_FIELD_SET_INVALID",
    "UNIVERSAL_ADMISSION_PROTOCOL_ID_INVALID",
    "UNIVERSAL_ADMISSION_PROTOCOL_JOB_NOT_FOUND",
    "UNIVERSAL_ADMISSION_PROTOCOL_JOB_STATE_CONFLICT",
    "UNIVERSAL_ADMISSION_PROTOCOL_LEASE_EXPIRED",
    "UNIVERSAL_ADMISSION_PROTOCOL_LEASE_NOT_FOUND",
    "UNIVERSAL_ADMISSION_PROTOCOL_LEASE_OWNER_MISMATCH",
    "UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID",
    "UNIVERSAL_ADMISSION_PROTOCOL_RESULT_BINDING_MISMATCH",
    "UNIVERSAL_ADMISSION_PROTOCOL_STALE_FENCE",
    "UNIVERSAL_ADMISSION_PROTOCOL_WORKER_RESULT_INVALID"
  ]),
  fail: Object.freeze([
    "UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY",
    "UNIVERSAL_ADMISSION_PROTOCOL_FAILURE_CODE_RESERVED",
    "UNIVERSAL_ADMISSION_PROTOCOL_JOB_NOT_FOUND",
    "UNIVERSAL_ADMISSION_PROTOCOL_JOB_STATE_CONFLICT",
    "UNIVERSAL_ADMISSION_PROTOCOL_LEASE_EXPIRED",
    "UNIVERSAL_ADMISSION_PROTOCOL_LEASE_NOT_FOUND",
    "UNIVERSAL_ADMISSION_PROTOCOL_LEASE_OWNER_MISMATCH",
    "UNIVERSAL_ADMISSION_PROTOCOL_STALE_FENCE"
  ]),
  gc: Object.freeze([
    "UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY",
    "UNIVERSAL_ADMISSION_PROTOCOL_SNAPSHOT_INVALID"
  ]),
  "reap-expired": Object.freeze([
    "UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY"
  ]),
  redrive: Object.freeze([
    "UNIVERSAL_ADMISSION_PROTOCOL_APPLICATION_BACKPRESSURE",
    "UNIVERSAL_ADMISSION_PROTOCOL_DLQ_REDRIVE_CONFLICT",
    "UNIVERSAL_ADMISSION_PROTOCOL_DLQ_REDRIVE_LIMIT",
    "UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY",
    "UNIVERSAL_ADMISSION_PROTOCOL_GLOBAL_BACKPRESSURE",
    "UNIVERSAL_ADMISSION_PROTOCOL_JOB_NOT_FOUND",
    "UNIVERSAL_ADMISSION_PROTOCOL_JOB_STATE_CONFLICT",
    "UNIVERSAL_ADMISSION_PROTOCOL_PRINCIPAL_TENANT_MISMATCH",
    "UNIVERSAL_ADMISSION_PROTOCOL_REDRIVE_WINDOW_EXPIRED",
    "UNIVERSAL_ADMISSION_PROTOCOL_TENANT_BACKPRESSURE",
    "UNIVERSAL_ADMISSION_PROTOCOL_TENANT_RATE_LIMITED",
    "UNIVERSAL_ADMISSION_PROTOCOL_TENANT_REPLAY_BYTE_CAPACITY"
  ]),
  renew: Object.freeze([
    "UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY",
    "UNIVERSAL_ADMISSION_PROTOCOL_JOB_NOT_FOUND",
    "UNIVERSAL_ADMISSION_PROTOCOL_JOB_STATE_CONFLICT",
    "UNIVERSAL_ADMISSION_PROTOCOL_LEASE_EXPIRED",
    "UNIVERSAL_ADMISSION_PROTOCOL_LEASE_NOT_FOUND",
    "UNIVERSAL_ADMISSION_PROTOCOL_LEASE_OWNER_MISMATCH",
    "UNIVERSAL_ADMISSION_PROTOCOL_LEASE_RENEWAL_LIMIT",
    "UNIVERSAL_ADMISSION_PROTOCOL_STALE_FENCE"
  ]),
  snapshot: Object.freeze([
    "UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY"
  ]),
  submit: Object.freeze([
    "UNIVERSAL_ADMISSION_PROTOCOL_APPLICATION_BACKPRESSURE",
    "UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY",
    "UNIVERSAL_ADMISSION_PROTOCOL_GLOBAL_BACKPRESSURE",
    "UNIVERSAL_ADMISSION_PROTOCOL_REVISION_EQUIVOCATION",
    "UNIVERSAL_ADMISSION_PROTOCOL_TENANT_BACKPRESSURE",
    "UNIVERSAL_ADMISSION_PROTOCOL_TENANT_RATE_LIMITED",
    "UNIVERSAL_ADMISSION_PROTOCOL_TENANT_REPLAY_BYTE_CAPACITY"
  ])
});

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ID = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,17})$/u;
const APPLICATION_REVISION = /^[1-9][0-9]{0,30}$/u;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{1,79}$/u;
const REQUEST_ID = /^[0-9a-f]{32}$/u;
const MAX_PROTOCOL_DECIMAL = 999_999_999_999_999_999n;
const AUTHORITY_KEYS = Object.freeze([
  "admissionDecisionGranted",
  "approvalGranted",
  "auditCompleted",
  "deploymentPerformed",
  "fundMovementAuthorized",
  "fundMovementPerformed",
  "independentAudit",
  "launchAuthorized",
  "repositoryOwnershipProven",
  "reviewCompleted",
  "safetyCertified",
  "safetyGuaranteed"
]);
const POLICY_LIMIT_KEYS = Object.freeze([
  "commandReplayRetentionMs",
  "deadLetterPayloadRetentionMs",
  "fixedWindowMs",
  "leaseDurationMs",
  "maxApplicationOutstanding",
  "maxAttempts",
  "maxDurableCommandBytes",
  "maxDurableCommands",
  "maxGlobalLeased",
  "maxGlobalOutstanding",
  "maxLeaseDurationMs",
  "maxLeaseRenewals",
  "maxRedrives",
  "maxTenantAuthenticatedRequestBytesPerWindow",
  "maxTenantAuthenticatedRequestsPerWindow",
  "maxTenantLeased",
  "maxTenantNewBytesPerWindow",
  "maxTenantNewJobsPerWindow",
  "maxTenantOutstanding",
  "maxTenantReplayBytes",
  "maxTenantReplayRecords",
  "orphanRetentionMs",
  "retryBaseMs",
  "retryMaxMs",
  "terminalPayloadRetentionMs"
]);
const JOB_STATES = new Set(UNIVERSAL_ADMISSION_JOB_STATES);
const EVENT_TYPES = new Set(UNIVERSAL_ADMISSION_EVENT_TYPES);
const DURABLE_COMMAND_KINDS = new Set(UNIVERSAL_ADMISSION_DURABLE_COMMAND_KINDS);
const DURABLE_COMMAND_FAILURE_CODES = Object.freeze(Object.fromEntries(
  Object.entries(UNIVERSAL_ADMISSION_DURABLE_COMMAND_FAILURE_CODES)
    .map(([kind, codes]) => [kind, new Set(codes)])
));
const RETRYABLE_DURABLE_COMMAND_FAILURE_CODES = new Set([
  "UNIVERSAL_ADMISSION_PROTOCOL_APPLICATION_BACKPRESSURE",
  "UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY",
  "UNIVERSAL_ADMISSION_PROTOCOL_GLOBAL_BACKPRESSURE",
  "UNIVERSAL_ADMISSION_PROTOCOL_TENANT_BACKPRESSURE",
  "UNIVERSAL_ADMISSION_PROTOCOL_TENANT_RATE_LIMITED",
  "UNIVERSAL_ADMISSION_PROTOCOL_TENANT_REPLAY_BYTE_CAPACITY"
]);
const REVIEW_STATES = new Set(["analysis_pending", "ready_for_review"]);
const ROOT_UINT8_ARRAY = Uint8Array;
const ROOT_TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(ROOT_UINT8_ARRAY.prototype);
const ROOT_TYPED_ARRAY_BUFFER = Function.prototype.call.bind(
  Object.getOwnPropertyDescriptor(ROOT_TYPED_ARRAY_PROTOTYPE, "buffer").get
);
const ROOT_TYPED_ARRAY_BYTE_OFFSET = Function.prototype.call.bind(
  Object.getOwnPropertyDescriptor(ROOT_TYPED_ARRAY_PROTOTYPE, "byteOffset").get
);
const ROOT_TYPED_ARRAY_BYTE_LENGTH = Function.prototype.call.bind(
  Object.getOwnPropertyDescriptor(ROOT_TYPED_ARRAY_PROTOTYPE, "byteLength").get
);

export class UniversalAdmissionProtocolError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "UniversalAdmissionProtocolError";
    this.code = code;
    this.path = options?.path ?? null;
    this.retryable = options?.retryable ?? false;
    this.retryAfterMs = options?.retryAfterMs ?? null;
  }
}

export function canonicalProtocolBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

export function digestProtocolValue(value) {
  return sha256Bytes(canonicalProtocolBytes(value));
}

export function inertProtocolAuthority() {
  return Object.freeze(Object.fromEntries(AUTHORITY_KEYS.map((key) => [key, false])));
}

export function validateAuthenticatedPrincipalContext(input) {
  const value = snapshotProtocolInput(input, "$principal");
  plainObject(value, "$principal");
  exactKeys(value, ["authenticated", "audience", "authorityId", "kind", "schemaVersion", "subjectId", "tenantId"], "$principal");
  exact(value.kind, "programmable-authenticated-principal-context", "$principal.kind");
  exact(value.schemaVersion, UNIVERSAL_ADMISSION_PROTOCOL_VERSION, "$principal.schemaVersion");
  if (value.authenticated !== true) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_PRINCIPAL_UNAUTHENTICATED", "Principal context must come from an authenticated ingress adapter.", { path: "$principal.authenticated" });
  }
  safeId(value.authorityId, "$principal.authorityId", 80);
  safeId(value.audience, "$principal.audience", 160);
  safeId(value.tenantId, "$principal.tenantId", 128);
  safeId(value.subjectId, "$principal.subjectId", 192);
  return deepFreeze(value);
}

export function derivePrincipalBinding(value) {
  const principal = validateAuthenticatedPrincipalContext(value);
  const bindingValue = {
    audience: principal.audience,
    authorityId: principal.authorityId,
    kind: "programmable-universal-admission-principal-binding",
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    subjectId: principal.subjectId,
    tenantId: principal.tenantId
  };
  return Object.freeze({
    audience: principal.audience,
    authorityId: principal.authorityId,
    tenantId: principal.tenantId,
    principalBindingSha256: digestProtocolValue(bindingValue)
  });
}

export function validateUniversalAdmissionRequestBinding(input) {
  const value = snapshotProtocolInput(input, "$request");
  plainObject(value, "$request");
  exactKeys(value, ["authenticatedRequestByteLength", "expectedCapacityPolicySha256", "requestDigest", "requestId"], "$request");
  if (typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_REQUEST_INVALID", "Request id must be the signed command's lowercase 128-bit identifier.", { path: "$request.requestId" });
  }
  digest(value.expectedCapacityPolicySha256, "$request.expectedCapacityPolicySha256");
  digest(value.requestDigest, "$request.requestDigest");
  const authenticatedRequestByteLength = positiveDecimal(value.authenticatedRequestByteLength, "$request.authenticatedRequestByteLength");
  if (authenticatedRequestByteLength > BigInt(MAX_UNIVERSAL_ADMISSION_AUTHENTICATED_REQUEST_BYTES)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_REQUEST_INVALID", "Authenticated ingress byte length exceeds the closed admission, command, and signature boundary.", { path: "$request.authenticatedRequestByteLength" });
  }
  return deepFreeze(value);
}

export function validateUniversalAdmissionCommandId(value, location = "$commandId") {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_ID_REQUIRED", "Mutating queue commands require a lowercase 128-bit command id.", { path: location });
  }
  return value;
}

export function isUniversalAdmissionDurableCommandFailureCode({ commandKind, code }) {
  return typeof commandKind === "string"
    && typeof code === "string"
    && DURABLE_COMMAND_FAILURE_CODES[commandKind]?.has(code) === true;
}

export function validateUniversalAdmissionDurableCommandFailure(input) {
  const value = snapshotProtocolInput(input, "$durableCommandFailure");
  exactKeys(value, ["commandKind", "failure"], "$durableCommandFailure");
  enumValue(value.commandKind, DURABLE_COMMAND_KINDS, "$durableCommandFailure.commandKind");
  plainObject(value.failure, "$durableCommandFailure.failure");
  exactKeys(value.failure, ["code", "path", "retryAfterMs", "retryable"], "$durableCommandFailure.failure");
  if (!isUniversalAdmissionDurableCommandFailureCode({ commandKind: value.commandKind, code: value.failure.code })) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_FAILURE_INVALID", "Durable command failure code is outside the closed vocabulary for this command kind.", { path: "$durableCommandFailure.failure.code" });
  }
  const expectedRetryable = RETRYABLE_DURABLE_COMMAND_FAILURE_CODES.has(value.failure.code);
  if (value.failure.retryable !== expectedRetryable) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_FAILURE_INVALID", "Durable command failure retryability differs from its closed failure code.", { path: "$durableCommandFailure.failure.retryable" });
  }
  if (value.failure.path !== null
    && (typeof value.failure.path !== "string"
      || Buffer.byteLength(value.failure.path, "utf8") > 512
      || /[\u0000\r\n]/u.test(value.failure.path))) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_FAILURE_INVALID", "Durable command failure path is outside the bounded diagnostic syntax.", { path: "$durableCommandFailure.failure.path" });
  }
  if (value.failure.retryAfterMs !== null) {
    decimal(value.failure.retryAfterMs, "$durableCommandFailure.failure.retryAfterMs", { allowZero: true });
  }
  if (!value.failure.retryable && value.failure.retryAfterMs !== null) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_FAILURE_INVALID", "A non-retryable durable command failure cannot carry a retry delay.", { path: "$durableCommandFailure.failure.retryAfterMs" });
  }
  return deepFreeze(value.failure);
}

export function deriveUniversalAdmissionDurableCommandRequestBinding(input) {
  const value = snapshotProtocolInput(input, "$durableCommand");
  exactKeys(value, ["actorKey", "commandId", "commandKind", "requestValue", "serviceAudience"], "$durableCommand");
  safeId(value.actorKey, "$durableCommand.actorKey", 192);
  validateUniversalAdmissionCommandId(value.commandId, "$durableCommand.commandId");
  enumValue(value.commandKind, DURABLE_COMMAND_KINDS, "$durableCommand.commandKind");
  validateBoundedProtocolJson(value.requestValue, "$durableCommand.requestValue");
  validateUniversalAdmissionServiceAudience(value.serviceAudience, "$durableCommand.serviceAudience");
  const requestPreimage = {
    actorKey: value.actorKey,
    commandId: value.commandId,
    commandKind: value.commandKind,
    kind: "programmable-universal-admission-durable-command-request",
    request: value.requestValue,
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    serviceAudience: value.serviceAudience
  };
  if (canonicalProtocolBytes(requestPreimage).length > MAX_UNIVERSAL_ADMISSION_DURABLE_COMMAND_REQUEST_BYTES) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_REQUEST_INVALID", "Durable command request preimage exceeds the bounded protocol limit.", { path: "$durableCommand.requestValue" });
  }
  const commandKey = digestProtocolValue({
    actorKey: value.actorKey,
    commandId: value.commandId,
    kind: "programmable-universal-admission-durable-command-key",
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    serviceAudience: value.serviceAudience
  });
  return deepFreeze({
    commandKey,
    requestPreimage,
    requestSha256: digestProtocolValue(requestPreimage),
    requestValue: value.requestValue
  });
}

export function deriveUniversalAdmissionDurableCommandEffectKeys(input) {
  const value = snapshotProtocolInput(input, "$durableCommandEffect");
  exactKeys(value, ["commandKind", "requestValue", "response"], "$durableCommandEffect");
  enumValue(value.commandKind, DURABLE_COMMAND_KINDS, "$durableCommandEffect.commandKind");
  plainObject(value.requestValue, "$durableCommandEffect.requestValue");
  plainObject(value.response, "$durableCommandEffect.response");
  const jobIds = [];
  const receiptSha256s = [];
  const resultSha256s = [];
  const snapshotSha256s = [];
  const addDigest = (target, candidate, location) => {
    digest(candidate, location);
    target.push(candidate);
  };
  const addReceiptResult = (result, location, { requestJobId = null } = {}) => {
    plainObject(result, location);
    if (requestJobId !== null) addDigest(jobIds, requestJobId, "$durableCommandEffect.requestValue.jobId");
    else if (Object.hasOwn(result, "jobId")) addDigest(jobIds, result.jobId, `${location}.jobId`);
    if (Object.hasOwn(result, "receiptSha256")) addDigest(receiptSha256s, result.receiptSha256, `${location}.receiptSha256`);
    if (Object.hasOwn(result, "resultSha256")) addDigest(resultSha256s, result.resultSha256, `${location}.resultSha256`);
  };

  if (value.commandKind === "submit") {
    addReceiptResult(value.response, "$durableCommandEffect.response");
  } else if (value.commandKind === "claim") {
    if (value.response.status !== "NO_WORK") addReceiptResult(value.response, "$durableCommandEffect.response");
  } else if (new Set(["renew", "fail", "redrive", "complete"]).has(value.commandKind)) {
    addReceiptResult(value.response, "$durableCommandEffect.response", { requestJobId: value.requestValue.jobId });
  } else if (value.commandKind === "reap-expired") {
    if (!Array.isArray(value.response.results) || value.response.results.length > 1000) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_EFFECT_INVALID", "Reaper effect must contain at most 1000 receipt results.", { path: "$durableCommandEffect.response.results" });
    }
    for (const [index, result] of value.response.results.entries()) addReceiptResult(result, `$durableCommandEffect.response.results[${index}]`);
  } else if (value.commandKind === "snapshot") {
    addDigest(snapshotSha256s, value.response.snapshotSha256, "$durableCommandEffect.response.snapshotSha256");
  } else if (value.commandKind === "gc") {
    addDigest(snapshotSha256s, value.requestValue.snapshotSha256, "$durableCommandEffect.requestValue.snapshotSha256");
    addDigest(snapshotSha256s, value.response.snapshotSha256, "$durableCommandEffect.response.snapshotSha256");
  }
  return deepFreeze({
    jobIds: sortedUniqueDigests(jobIds),
    receiptSha256s: sortedUniqueDigests(receiptSha256s),
    resultSha256s: sortedUniqueDigests(resultSha256s),
    snapshotSha256s: sortedUniqueDigests(snapshotSha256s)
  });
}

export function validateUniversalAdmissionServiceAudience(value, location = "$serviceAudience") {
  safeId(value, location, 160);
  return value;
}

export function deriveUniversalAdmissionRequestKey({ audience, requestId, tenantId }) {
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_REQUEST_INVALID", "Request id must be the signed command's lowercase 128-bit identifier.", { path: "$request.requestId" });
  }
  safeId(audience, "$request.audience", 160);
  safeId(tenantId, "$request.tenantId", 128);
  return digestProtocolValue({
    audience,
    kind: "programmable-universal-admission-request-key",
    requestId,
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    tenantId
  });
}

export function deriveUniversalAdmissionIdempotencyKey({ admissionDigest, audience, tenantId }) {
  digest(admissionDigest, "$idempotency.admissionDigest");
  safeId(audience, "$idempotency.audience", 160);
  safeId(tenantId, "$idempotency.tenantId", 128);
  return digestProtocolValue({
    admissionDigest,
    audience,
    kind: "programmable-universal-admission-idempotency-key",
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    tenantId
  });
}

export function validateAuthenticatedWorkerContext(input) {
  const value = snapshotProtocolInput(input, "$worker");
  plainObject(value, "$worker");
  exactKeys(value, ["authenticated", "audience", "authorityId", "implementationSha256", "kind", "schemaVersion", "workerId"], "$worker");
  exact(value.kind, "programmable-authenticated-worker-context", "$worker.kind");
  exact(value.schemaVersion, UNIVERSAL_ADMISSION_PROTOCOL_VERSION, "$worker.schemaVersion");
  if (value.authenticated !== true) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_WORKER_UNAUTHENTICATED", "Worker context must come from an authenticated worker adapter.", { path: "$worker.authenticated" });
  }
  safeId(value.authorityId, "$worker.authorityId", 80);
  safeId(value.audience, "$worker.audience", 160);
  safeId(value.workerId, "$worker.workerId", 128);
  digest(value.implementationSha256, "$worker.implementationSha256");
  return deepFreeze(value);
}

export function deriveWorkerBinding(value) {
  const worker = validateAuthenticatedWorkerContext(value);
  const bindingValue = {
    audience: worker.audience,
    authorityId: worker.authorityId,
    implementationSha256: worker.implementationSha256,
    kind: "programmable-universal-admission-worker-binding",
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    workerId: worker.workerId
  };
  return Object.freeze({
    audience: worker.audience,
    authorityId: worker.authorityId,
    implementationSha256: worker.implementationSha256,
    workerBindingSha256: digestProtocolValue(bindingValue),
    workerId: worker.workerId
  });
}

export function deriveRevisionKey({ applicationId, audience, revision, tenantId }) {
  slug(applicationId, "$revision.applicationId", 80);
  safeId(audience, "$revision.audience", 160);
  applicationRevision(revision, "$revision.revision");
  safeId(tenantId, "$revision.tenantId", 128);
  return digestProtocolValue({
    applicationId,
    audience,
    kind: "programmable-universal-admission-revision-key",
    revision,
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    tenantId
  });
}

export function deriveUniversalAdmissionRevisionBinding(input) {
  const value = snapshotProtocolInput(input, "$revisionBindingInput");
  plainObject(value, "$revisionBindingInput");
  exactKeys(value, ["bindings", "createdAtMs", "creatorPrincipalBindingSha256"], "$revisionBindingInput");
  plainObject(value.bindings, "$revisionBindingInput.bindings");
  timestamp(value.createdAtMs, "$revisionBindingInput.createdAtMs");
  digest(value.creatorPrincipalBindingSha256, "$revisionBindingInput.creatorPrincipalBindingSha256");
  const expectedRevisionKey = deriveRevisionKey({
    applicationId: value.bindings.applicationId,
    audience: value.bindings.audience,
    revision: value.bindings.revision,
    tenantId: value.bindings.tenantId
  });
  if (value.bindings.revisionKey !== expectedRevisionKey) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_REVISION_BINDING_MISMATCH", "Revision key does not bind the exact tenant, application, and revision.", { path: "$revisionBindingInput.bindings.revisionKey" });
  }
  const expectedJobId = deriveJobId({
    admissionDigest: value.bindings.admissionDigest,
    revisionKey: expectedRevisionKey
  });
  if (value.bindings.jobId !== expectedJobId) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_REVISION_BINDING_MISMATCH", "Job id does not bind the exact admission digest and revision key.", { path: "$revisionBindingInput.bindings.jobId" });
  }
  const revisionBinding = {
    admissionDigest: value.bindings.admissionDigest,
    applicationId: value.bindings.applicationId,
    audience: value.bindings.audience,
    createdAtMs: value.createdAtMs,
    creatorPrincipalBindingSha256: value.creatorPrincipalBindingSha256,
    kind: "programmable-universal-admission-revision-binding",
    revision: value.bindings.revision,
    revisionKey: expectedRevisionKey,
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    tenantId: value.bindings.tenantId
  };
  return deepFreeze({
    revisionBinding,
    revisionBindingSha256: digestProtocolValue(revisionBinding)
  });
}

export function deriveJobId({ admissionDigest, revisionKey }) {
  digest(admissionDigest, "$job.admissionDigest");
  digest(revisionKey, "$job.revisionKey");
  return digestProtocolValue({
    admissionDigest,
    kind: "programmable-universal-admission-job-key",
    revisionKey,
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION
  });
}

export function deriveUniversalAdmissionProtocolBindings({ bytes, principalContext }) {
  const envelopeBytes = snapshotBoundedProtocolBytes(bytes, {
    code: "UNIVERSAL_ADMISSION_PROTOCOL_ENVELOPE_INVALID",
    label: "Envelope",
    maximumByteLength: MAX_UNIVERSAL_ADMISSION_BYTES,
    minimumByteLength: 2
  });
  const admissionResult = validateUniversalAdmissionBytes(envelopeBytes);
  const envelope = JSON.parse(envelopeBytes.toString("utf8"));
  const principal = derivePrincipalBinding(principalContext);
  const revisionKey = deriveRevisionKey({
    applicationId: envelope.application.id,
    audience: principal.audience,
    revision: envelope.application.revision,
    tenantId: principal.tenantId
  });
  const jobId = deriveJobId({ admissionDigest: admissionResult.sourceDigest, revisionKey });
  const idempotencyKey = deriveUniversalAdmissionIdempotencyKey({
    admissionDigest: admissionResult.sourceDigest,
    audience: principal.audience,
    tenantId: principal.tenantId
  });
  return deepFreeze({
    admissionDigest: admissionResult.sourceDigest,
    admissionResult,
    applicationId: envelope.application.id,
    audience: principal.audience,
    envelopeByteLength: String(envelopeBytes.length),
    idempotencyKey,
    jobId,
    principal,
    revision: envelope.application.revision,
    revisionKey,
    tenantId: principal.tenantId
  });
}

export function validateUniversalAdmissionRuntimePolicy(input) {
  const value = snapshotProtocolInput(input, "$policy");
  plainObject(value, "$policy");
  exactKeys(value, ["$schema", "kind", ...POLICY_LIMIT_KEYS, "schemaVersion"], "$policy");
  exact(value.$schema, UNIVERSAL_ADMISSION_RUNTIME_POLICY_SCHEMA_ID, "$policy.$schema");
  exact(value.kind, "programmable-universal-admission-runtime-policy", "$policy.kind");
  exact(value.schemaVersion, UNIVERSAL_ADMISSION_PROTOCOL_VERSION, "$policy.schemaVersion");
  const limits = Object.create(null);
  for (const key of POLICY_LIMIT_KEYS) {
    limits[key] = decimal(value[key], `$policy.${key}`, {
      allowZero: new Set(["maxLeaseRenewals", "maxRedrives"]).has(key)
    });
  }
  atMost(limits.maxApplicationOutstanding, limits.maxTenantOutstanding, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "maxApplicationOutstanding must not exceed maxTenantOutstanding.");
  atMost(limits.maxTenantOutstanding, limits.maxGlobalOutstanding, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "maxTenantOutstanding must not exceed maxGlobalOutstanding.");
  atMost(limits.maxTenantLeased, limits.maxTenantOutstanding, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "maxTenantLeased must not exceed maxTenantOutstanding.");
  atMost(limits.maxTenantLeased, limits.maxGlobalLeased, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "maxTenantLeased must not exceed maxGlobalLeased.");
  atMost(limits.maxGlobalLeased, limits.maxGlobalOutstanding, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "maxGlobalLeased must not exceed maxGlobalOutstanding.");
  atMost(limits.leaseDurationMs, limits.maxLeaseDurationMs, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "leaseDurationMs must not exceed maxLeaseDurationMs.");
  atMost(limits.retryBaseMs, limits.retryMaxMs, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "retryBaseMs must not exceed retryMaxMs.");
  atMost(limits.fixedWindowMs, limits.commandReplayRetentionMs, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "commandReplayRetentionMs must not be shorter than the authenticated ingress fixed window.");
  atMost(limits.maxTenantReplayRecords, limits.maxDurableCommands, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "maxTenantReplayRecords must not exceed maxDurableCommands.");
  atMost(limits.maxTenantReplayBytes, limits.maxDurableCommandBytes, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "maxTenantReplayBytes must not exceed maxDurableCommandBytes.");
  atMost(limits.maxTenantReplayRecords * BigInt(MIN_UNIVERSAL_ADMISSION_DURABLE_RESPONSE_RESERVATION_BYTES), limits.maxTenantReplayBytes, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "maxTenantReplayBytes must reserve a bounded failure response for every tenant replay row.");
  atMost(limits.maxDurableCommands * BigInt(MIN_UNIVERSAL_ADMISSION_DURABLE_RESPONSE_RESERVATION_BYTES), limits.maxDurableCommandBytes, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "maxDurableCommandBytes must reserve a bounded failure response for every durable command row.");
  const maximumReceiptChainEvents = 1n
    + ((limits.maxRedrives + 1n) * limits.maxAttempts * (2n + limits.maxLeaseRenewals))
    + limits.maxRedrives;
  atMost(maximumReceiptChainEvents, BigInt(MAX_UNIVERSAL_ADMISSION_RECEIPT_CHAIN_EVENTS), "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "Runtime retry, redrive, and renewal limits exceed the bounded receipt-chain event cap.");
  const minimumCommandReplayRetentionMs = (limits.maxRedrives + 1n)
    * limits.maxAttempts
    * (limits.maxLeaseDurationMs + limits.retryMaxMs);
  const signedCommandHorizonMs = BigInt(MAX_UNIVERSAL_ADMISSION_COMMAND_LIFETIME_MS + MAX_UNIVERSAL_ADMISSION_COMMAND_CLOCK_SKEW_MS);
  const requiredCommandReplayRetentionMs = minimumCommandReplayRetentionMs > signedCommandHorizonMs
    ? minimumCommandReplayRetentionMs
    : signedCommandHorizonMs;
  atMost(requiredCommandReplayRetentionMs, limits.commandReplayRetentionMs, "UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID", "commandReplayRetentionMs must cover both signed-command and worker lifecycle horizons.");
  return deepFreeze(value);
}

export function digestUniversalAdmissionRuntimePolicy(value) {
  return digestProtocolValue(validateUniversalAdmissionRuntimePolicy(value));
}

export function deterministicRetryDelayMs({ attempt, cycle, jobId, policy }) {
  const checkedPolicy = validateUniversalAdmissionRuntimePolicy(policy);
  const attemptValue = positiveDecimal(attempt, "$retry.attempt");
  const cycleValue = decimal(cycle, "$retry.cycle", { allowZero: true });
  digest(jobId, "$retry.jobId");
  const base = decimal(checkedPolicy.retryBaseMs, "$policy.retryBaseMs");
  const maximum = decimal(checkedPolicy.retryMaxMs, "$policy.retryMaxMs");
  const exponent = attemptValue - 1n;
  const unbounded = exponent > 62n ? maximum : base * (1n << exponent);
  const cap = unbounded < maximum ? unbounded : maximum;
  const floor = cap / 2n;
  const width = cap - floor + 1n;
  const seed = canonicalProtocolBytes({
    attempt: String(attemptValue),
    cycle: String(cycleValue),
    jobId,
    kind: "programmable-universal-admission-retry-seed",
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION
  });
  const random = crypto.createHash("sha256").update(seed).digest().readBigUInt64BE(0);
  return String(floor + (random % width));
}

export function deriveLeaseId({ claimedAtMs, claimOrdinal, cycle, fenceToken, jobId, workerBindingSha256 }) {
  timestamp(claimedAtMs, "$lease.claimedAtMs");
  positiveDecimal(claimOrdinal, "$lease.claimOrdinal");
  decimal(cycle, "$lease.cycle", { allowZero: true });
  positiveDecimal(fenceToken, "$lease.fenceToken");
  digest(jobId, "$lease.jobId");
  digest(workerBindingSha256, "$lease.workerBindingSha256");
  return digestProtocolValue({
    claimedAtMs,
    claimOrdinal,
    cycle,
    fenceToken,
    jobId,
    kind: "programmable-universal-admission-lease",
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    workerBindingSha256
  });
}

export function validateUniversalAdmissionFailure(input) {
  const value = snapshotProtocolInput(input, "$failure");
  plainObject(value, "$failure");
  exactKeys(value, ["code", "detailsSha256", "retryable"], "$failure");
  if (typeof value.code !== "string" || !FAILURE_CODE.test(value.code)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_FAILURE_INVALID", "Failure code must use the closed uppercase transport-code syntax.", { path: "$failure.code" });
  }
  digest(value.detailsSha256, "$failure.detailsSha256");
  boolean(value.retryable, "$failure.retryable");
  return deepFreeze(value);
}

export function validateUniversalAdmissionWorkerResult(input) {
  const value = snapshotProtocolInput(input, "$result");
  plainObject(value, "$result");
  exactKeys(value, ["$schema", "artifacts", "authority", "binding", "effects", "kind", "publicDataOnly", "reportSha256", "reviewState", "schemaVersion", "worker"], "$result");
  exact(value.$schema, UNIVERSAL_ADMISSION_WORKER_RESULT_SCHEMA_ID, "$result.$schema");
  exact(value.kind, "programmable-universal-admission-worker-result", "$result.kind");
  exact(value.schemaVersion, UNIVERSAL_ADMISSION_PROTOCOL_VERSION, "$result.schemaVersion");
  exact(value.publicDataOnly, true, "$result.publicDataOnly");
  enumValue(value.reviewState, REVIEW_STATES, "$result.reviewState");
  digest(value.reportSha256, "$result.reportSha256");

  plainObject(value.binding, "$result.binding");
  exactKeys(value.binding, ["admissionDigest", "attempt", "cycle", "fenceToken", "jobId", "leaseId", "revisionBindingSha256", "revisionKey"], "$result.binding");
  for (const key of ["admissionDigest", "jobId", "leaseId", "revisionBindingSha256", "revisionKey"]) digest(value.binding[key], `$result.binding.${key}`);
  positiveDecimal(value.binding.attempt, "$result.binding.attempt");
  decimal(value.binding.cycle, "$result.binding.cycle", { allowZero: true });
  positiveDecimal(value.binding.fenceToken, "$result.binding.fenceToken");

  plainObject(value.worker, "$result.worker");
  exactKeys(value.worker, ["implementationSha256", "workerBindingSha256"], "$result.worker");
  digest(value.worker.implementationSha256, "$result.worker.implementationSha256");
  digest(value.worker.workerBindingSha256, "$result.worker.workerBindingSha256");

  plainObject(value.effects, "$result.effects");
  exactKeys(value.effects, ["candidateCodeExecuted", "externalNetworkAccessed", "externalWritesPerformed", "sandboxed"], "$result.effects");
  for (const key of ["candidateCodeExecuted", "externalNetworkAccessed", "externalWritesPerformed", "sandboxed"]) boolean(value.effects[key], `$result.effects.${key}`);
  exact(value.effects.candidateCodeExecuted, false, "$result.effects.candidateCodeExecuted");
  exact(value.effects.externalWritesPerformed, false, "$result.effects.externalWritesPerformed");
  exact(value.effects.sandboxed, false, "$result.effects.sandboxed");

  authority(value.authority, "$result.authority");
  if (!Array.isArray(value.artifacts) || value.artifacts.length > 32) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_WORKER_RESULT_INVALID", "Worker result artifacts must be a bounded array.", { path: "$result.artifacts" });
  }
  const ids = new Set();
  for (const [index, artifact] of value.artifacts.entries()) {
    const location = `$result.artifacts[${index}]`;
    plainObject(artifact, location);
    exactKeys(artifact, ["byteLength", "id", "kind", "sha256"], location);
    slug(artifact.id, `${location}.id`, 80);
    safeId(artifact.kind, `${location}.kind`, 80);
    positiveDecimal(artifact.byteLength, `${location}.byteLength`);
    digest(artifact.sha256, `${location}.sha256`);
    if (ids.has(artifact.id)) fail("UNIVERSAL_ADMISSION_PROTOCOL_WORKER_RESULT_INVALID", "Artifact ids must be unique.", { path: `${location}.id` });
    ids.add(artifact.id);
  }
  return deepFreeze(value);
}

export function parseUniversalAdmissionWorkerResultBytes(bytes) {
  const buffer = snapshotBoundedProtocolBytes(bytes, {
    code: "UNIVERSAL_ADMISSION_PROTOCOL_WORKER_RESULT_INVALID",
    label: "Worker result",
    maximumByteLength: MAX_UNIVERSAL_ADMISSION_CAS_OBJECT_BYTES,
    minimumByteLength: 2
  });
  let value;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_WORKER_RESULT_INVALID", "Worker result must be valid UTF-8 JSON.", { cause: error });
  }
  if (!canonicalProtocolBytes(value).equals(buffer)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_WORKER_RESULT_INVALID", "Worker result must use canonical JSON bytes followed by one LF.");
  }
  return validateUniversalAdmissionWorkerResult(value);
}

export function buildUniversalAdmissionEventReceipt(value) {
  const fields = snapshotProtocolInput(value, "$receiptInput");
  const receipt = {
    $schema: UNIVERSAL_ADMISSION_EVENT_RECEIPT_SCHEMA_ID,
    kind: "programmable-universal-admission-event-receipt",
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    ...fields,
    authority: inertProtocolAuthority()
  };
  return validateUniversalAdmissionEventReceipt(receipt);
}

export function validateUniversalAdmissionEventReceipt(input) {
  const value = snapshotProtocolInput(input, "$receipt");
  plainObject(value, "$receipt");
  exactKeys(value, ["$schema", "authority", "capacityPolicySha256", "eventIndex", "eventType", "failure", "idempotencyKey", "job", "kind", "lease", "occurredAtMs", "previousReceiptSha256", "principalBindingSha256", "request", "result", "schemaVersion", "serviceAudience", "transition", "workerBindingSha256"], "$receipt");
  exact(value.$schema, UNIVERSAL_ADMISSION_EVENT_RECEIPT_SCHEMA_ID, "$receipt.$schema");
  exact(value.kind, "programmable-universal-admission-event-receipt", "$receipt.kind");
  exact(value.schemaVersion, UNIVERSAL_ADMISSION_PROTOCOL_VERSION, "$receipt.schemaVersion");
  enumValue(value.eventType, EVENT_TYPES, "$receipt.eventType");
  positiveDecimal(value.eventIndex, "$receipt.eventIndex");
  nullableDigest(value.previousReceiptSha256, "$receipt.previousReceiptSha256");
  timestamp(value.occurredAtMs, "$receipt.occurredAtMs");
  digest(value.capacityPolicySha256, "$receipt.capacityPolicySha256");
  digest(value.idempotencyKey, "$receipt.idempotencyKey");
  safeId(value.serviceAudience, "$receipt.serviceAudience", 160);
  nullableDigest(value.principalBindingSha256, "$receipt.principalBindingSha256");
  nullableDigest(value.workerBindingSha256, "$receipt.workerBindingSha256");
  if (value.request !== null) validateUniversalAdmissionRequestBinding(value.request);
  authority(value.authority, "$receipt.authority");

  plainObject(value.job, "$receipt.job");
  exactKeys(value.job, ["admissionDigest", "applicationId", "attempt", "availableAtMs", "cycle", "enqueueOrdinal", "fenceToken", "jobId", "revision", "revisionBindingSha256", "revisionKey", "tenantId"], "$receipt.job");
  for (const key of ["admissionDigest", "jobId", "revisionBindingSha256", "revisionKey"]) digest(value.job[key], `$receipt.job.${key}`);
  slug(value.job.applicationId, "$receipt.job.applicationId", 80);
  safeId(value.job.tenantId, "$receipt.job.tenantId", 128);
  applicationRevision(value.job.revision, "$receipt.job.revision");
  decimal(value.job.attempt, "$receipt.job.attempt", { allowZero: true });
  timestamp(value.job.availableAtMs, "$receipt.job.availableAtMs");
  decimal(value.job.cycle, "$receipt.job.cycle", { allowZero: true });
  positiveDecimal(value.job.enqueueOrdinal, "$receipt.job.enqueueOrdinal");
  decimal(value.job.fenceToken, "$receipt.job.fenceToken", { allowZero: true });
  const expectedRevisionKey = deriveRevisionKey({
    applicationId: value.job.applicationId,
    audience: value.serviceAudience,
    revision: value.job.revision,
    tenantId: value.job.tenantId
  });
  if (value.job.revisionKey !== expectedRevisionKey
    || value.job.jobId !== deriveJobId({ admissionDigest: value.job.admissionDigest, revisionKey: expectedRevisionKey })) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_REVISION_BINDING_MISMATCH", "Receipt job identity does not bind the exact admission revision.", { path: "$receipt.job" });
  }
  if (value.idempotencyKey !== deriveUniversalAdmissionIdempotencyKey({ admissionDigest: value.job.admissionDigest, audience: value.serviceAudience, tenantId: value.job.tenantId })) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_INVALID", "Receipt idempotency key does not bind the exact tenant and admission digest.", { path: "$receipt.idempotencyKey" });
  }

  plainObject(value.transition, "$receipt.transition");
  exactKeys(value.transition, ["from", "to"], "$receipt.transition");
  if (value.transition.from !== null) enumValue(value.transition.from, JOB_STATES, "$receipt.transition.from");
  enumValue(value.transition.to, JOB_STATES, "$receipt.transition.to");

  if (value.lease !== null) validateLease(value.lease, "$receipt.lease");
  if (value.failure !== null) validateUniversalAdmissionFailure(value.failure);
  if (value.result !== null) validateReceiptResult(value.result);
  validateReceiptBranch(value);
  if (value.lease !== null) {
    if (value.job.attempt === "0" || value.job.fenceToken === "0" || value.lease.fenceToken !== value.job.fenceToken) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_LEASE_INVALID", "Lease events require positive matching job attempt and fence counters.", { path: "$receipt.lease.fenceToken" });
    }
    const expectedLeaseId = deriveLeaseId({
      claimedAtMs: value.lease.claimedAtMs,
      claimOrdinal: value.lease.claimOrdinal,
      cycle: value.job.cycle,
      fenceToken: value.job.fenceToken,
      jobId: value.job.jobId,
      workerBindingSha256: value.lease.workerBindingSha256
    });
    if (value.lease.leaseId !== expectedLeaseId) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_LEASE_INVALID", "Lease id does not bind the receipt job, fence, cycle, claim time, and worker.", { path: "$receipt.lease.leaseId" });
    }
  }
  if (value.eventType === "queued") {
    if (value.request.expectedCapacityPolicySha256 !== value.capacityPolicySha256) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_INVALID", "Initial receipt request policy precondition differs from the committed capacity policy.", { path: "$receipt.request.expectedCapacityPolicySha256" });
    }
    const derived = deriveUniversalAdmissionRevisionBinding({
      bindings: { ...value.job, audience: value.serviceAudience },
      createdAtMs: value.occurredAtMs,
      creatorPrincipalBindingSha256: value.principalBindingSha256
    });
    if (value.job.revisionBindingSha256 !== derived.revisionBindingSha256) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_REVISION_BINDING_MISMATCH", "Initial receipt does not bind the exact immutable revision record.", { path: "$receipt.job.revisionBindingSha256" });
    }
  }
  return deepFreeze(value);
}

export function validateUniversalAdmissionReceiptChain(receiptsInput, currentJobInput) {
  let receipts;
  let currentJob;
  try {
    receipts = structuredClone(receiptsInput);
    currentJob = structuredClone(currentJobInput);
  } catch (cause) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Receipt chain inputs could not be snapshotted.", { cause });
  }
  if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > MAX_UNIVERSAL_ADMISSION_RECEIPT_CHAIN_EVENTS) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", `Receipt chain must contain 1..${MAX_UNIVERSAL_ADMISSION_RECEIPT_CHAIN_EVENTS} immutable events.`);
  }
  plainObject(currentJob, "$currentJob");
  const runtimePolicy = validateUniversalAdmissionRuntimePolicy(currentJob.runtimePolicy);
  const checked = receipts.map((receipt) => validateUniversalAdmissionEventReceipt(receipt));
  const first = checked[0];
  const firstDigest = sha256Bytes(canonicalProtocolBytes(first));
  if (first.eventType !== "queued" || first.job.availableAtMs !== first.occurredAtMs) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Receipt chain must begin with the immutable queued event.", { path: "$receipts[0].eventType" });
  }
  if (digestUniversalAdmissionRuntimePolicy(runtimePolicy) !== first.capacityPolicySha256) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Receipt chain capacity policy digest differs from the supplied runtime policy.", { path: "$currentJob.runtimePolicy" });
  }
  const immutableJobKeys = [
    "admissionDigest",
    "applicationId",
    "jobId",
    "revision",
    "revisionBindingSha256",
    "revisionKey",
    "tenantId"
  ];
  let lastClaimOrdinal = 0n;
  let previous = null;
  let previousDigest = null;
  for (const [index, receipt] of checked.entries()) {
    if (BigInt(receipt.job.attempt) > BigInt(runtimePolicy.maxAttempts)
      || BigInt(receipt.job.cycle) > BigInt(runtimePolicy.maxRedrives)
      || (receipt.lease !== null && BigInt(receipt.lease.renewals) > BigInt(runtimePolicy.maxLeaseRenewals))) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Receipt counters exceed the committed runtime policy.", { path: `$receipts[${index}].job` });
    }
    if (receipt.eventIndex !== String(index + 1) || receipt.previousReceiptSha256 !== previousDigest) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Receipt indexes and previous-digest links must be contiguous.", { path: `$receipts[${index}]` });
    }
    if (receipt.eventType === "lease-claimed") {
      const claimOrdinal = BigInt(receipt.lease.claimOrdinal);
      if (claimOrdinal <= lastClaimOrdinal) {
        fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Lease claim ordinals must increase across every job retry cycle.", { path: `$receipts[${index}].lease.claimOrdinal` });
      }
      lastClaimOrdinal = claimOrdinal;
    }
    if (receipt.serviceAudience !== first.serviceAudience
      || receipt.capacityPolicySha256 !== first.capacityPolicySha256
      || receipt.idempotencyKey !== first.idempotencyKey
      || immutableJobKeys.some((key) => receipt.job[key] !== first.job[key])) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Receipt chain immutable admission bindings changed.", { path: `$receipts[${index}]` });
    }
    if (previous !== null) {
      if (BigInt(receipt.occurredAtMs) < BigInt(previous.occurredAtMs)) {
        fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Receipt occurrence times must be monotonic.", { path: `$receipts[${index}].occurredAtMs` });
      }
      if (receipt.transition.from !== previous.transition.to) {
        fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Receipt transition does not continue the prior state.", { path: `$receipts[${index}].transition.from` });
      }
      validateReceiptCounterProgression(previous, receipt, index, runtimePolicy);
    }
    previous = receipt;
    previousDigest = sha256Bytes(canonicalProtocolBytes(receipt));
  }

  const last = checked.at(-1);
  for (const key of immutableJobKeys) {
    if (String(currentJob[key]) !== last.job[key]) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Current job immutable identity differs from its receipt chain.", { path: `$currentJob.${key}` });
    }
  }
  if (currentJob.serviceAudience !== last.serviceAudience
    || currentJob.capacityPolicySha256 !== last.capacityPolicySha256
    || currentJob.firstReceiptSha256 !== firstDigest
    || String(currentJob.attempt) !== last.job.attempt
    || String(currentJob.availableAtMs) !== last.job.availableAtMs
    || String(currentJob.cycle) !== last.job.cycle
    || String(currentJob.enqueueOrdinal) !== last.job.enqueueOrdinal
    || String(currentJob.fenceToken) !== last.job.fenceToken
    || String(currentJob.redrives) !== last.job.cycle
    || currentJob.state !== last.transition.to
    || currentJob.headReceiptSha256 !== previousDigest) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Current job counters, state, policy, audience, or receipt endpoints differ from its chain.", { path: "$currentJob" });
  }
  const expectedIdempotencyKey = deriveUniversalAdmissionIdempotencyKey({
    admissionDigest: currentJob.admissionDigest,
    audience: currentJob.serviceAudience,
    tenantId: currentJob.tenantId
  });
  if (last.idempotencyKey !== expectedIdempotencyKey) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Receipt chain idempotency key differs from current job identity.");
  }
  const currentLease = currentJob.lease ?? null;
  if (last.transition.to === "leased") {
    if (canonicalJson(currentLease) !== canonicalJson(last.lease)) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Current lease differs from the latest lease receipt.", { path: "$currentJob.lease" });
    }
  } else if (currentLease !== null) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Non-leased current job retains a live lease.", { path: "$currentJob.lease" });
  }
  const terminal = new Set(["dead-lettered", "processing-completed"]);
  if (terminal.has(last.transition.to)) {
    if (String(currentJob.terminalAtMs) !== last.occurredAtMs) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Terminal job time differs from its terminal receipt.", { path: "$currentJob.terminalAtMs" });
    }
  } else if (currentJob.terminalAtMs !== null) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Non-terminal current job retains a terminal timestamp.", { path: "$currentJob.terminalAtMs" });
  }
  if (last.eventType === "processing-completed") {
    if (currentJob.resultSha256 !== last.result.resultSha256) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Completed job result differs from its terminal receipt.", { path: "$currentJob.resultSha256" });
    }
  } else if (currentJob.resultSha256 !== null) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Non-completed current job retains a result digest.", { path: "$currentJob.resultSha256" });
  }
  return true;
}

function validateReceiptCounterProgression(previous, current, index, runtimePolicy) {
  const previousAttempt = BigInt(previous.job.attempt);
  const previousAvailableAtMs = BigInt(previous.job.availableAtMs);
  const previousCycle = BigInt(previous.job.cycle);
  const previousEnqueueOrdinal = BigInt(previous.job.enqueueOrdinal);
  const previousFence = BigInt(previous.job.fenceToken);
  const attempt = BigInt(current.job.attempt);
  const availableAtMs = BigInt(current.job.availableAtMs);
  const cycle = BigInt(current.job.cycle);
  const enqueueOrdinal = BigInt(current.job.enqueueOrdinal);
  const fence = BigInt(current.job.fenceToken);
  let valid = false;
  if (current.eventType === "lease-claimed") {
    valid = attempt === previousAttempt + 1n
      && availableAtMs === previousAvailableAtMs
      && cycle === previousCycle
      && enqueueOrdinal === previousEnqueueOrdinal
      && fence === previousFence + 1n
      && BigInt(current.occurredAtMs) >= previousAvailableAtMs
      && current.lease.claimedAtMs === current.occurredAtMs
      && current.lease.renewals === "0"
      && BigInt(current.lease.expiresAtMs) === BigInt(current.occurredAtMs) + BigInt(runtimePolicy.leaseDurationMs);
  } else if (current.eventType === "dead-letter-redriven") {
    valid = attempt === 0n
      && availableAtMs === BigInt(current.occurredAtMs)
      && cycle === previousCycle + 1n
      && enqueueOrdinal > previousEnqueueOrdinal
      && fence === previousFence
      && BigInt(current.occurredAtMs) < BigInt(previous.occurredAtMs) + BigInt(runtimePolicy.deadLetterPayloadRetentionMs);
  } else if (current.eventType === "retry-scheduled") {
    valid = attempt === previousAttempt
      && availableAtMs === BigInt(current.occurredAtMs) + BigInt(deterministicRetryDelayMs({
        attempt: current.job.attempt,
        cycle: current.job.cycle,
        jobId: current.job.jobId,
        policy: runtimePolicy
      }))
      && cycle === previousCycle
      && enqueueOrdinal > previousEnqueueOrdinal
      && fence === previousFence
      && current.failure.retryable === true
      && attempt < BigInt(runtimePolicy.maxAttempts);
  } else {
    valid = attempt === previousAttempt
      && availableAtMs === previousAvailableAtMs
      && cycle === previousCycle
      && enqueueOrdinal === previousEnqueueOrdinal
      && fence === previousFence;
  }
  if (!valid) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Receipt attempt, cycle, or fence counters do not follow the event transition.", { path: `$receipts[${index}].job` });
  }
  if (current.eventType === "dead-lettered"
    && current.failure.retryable === true
    && attempt < BigInt(runtimePolicy.maxAttempts)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Retryable failure was dead-lettered before exhausting the committed attempt policy.", { path: `$receipts[${index}].failure` });
  }
  if (current.eventType === "lease-renewed") {
    const sameLeaseIdentity = current.lease.claimedAtMs === previous.lease.claimedAtMs
      && current.lease.fenceToken === previous.lease.fenceToken
      && current.lease.leaseId === previous.lease.leaseId
      && current.lease.workerBindingSha256 === previous.lease.workerBindingSha256
      && current.workerBindingSha256 === previous.workerBindingSha256;
    const maximumExpiry = BigInt(current.lease.claimedAtMs) + BigInt(runtimePolicy.maxLeaseDurationMs);
    const expectedExpiry = BigInt(previous.lease.expiresAtMs) + BigInt(runtimePolicy.leaseDurationMs) < maximumExpiry
      ? BigInt(previous.lease.expiresAtMs) + BigInt(runtimePolicy.leaseDurationMs)
      : maximumExpiry;
    if (!sameLeaseIdentity
      || BigInt(current.lease.renewals) !== BigInt(previous.lease.renewals) + 1n
      || BigInt(current.lease.expiresAtMs) <= BigInt(previous.lease.expiresAtMs)
      || BigInt(current.lease.expiresAtMs) !== expectedExpiry
      || BigInt(current.occurredAtMs) >= BigInt(previous.lease.expiresAtMs)) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Lease renewal does not continue the exact live lease with bounded increasing expiry.", { path: `$receipts[${index}].lease` });
    }
  }
  if (new Set(["retry-scheduled", "dead-lettered", "processing-completed"]).has(current.eventType)) {
    const occurredAtMs = BigInt(current.occurredAtMs);
    const leaseExpiresAtMs = BigInt(previous.lease.expiresAtMs);
    const expiredReap = current.eventType !== "processing-completed"
      && current.failure.code === "LEASE_EXPIRED"
      && current.failure.retryable === true
      && current.failure.detailsSha256 === digestProtocolValue({ jobId: current.job.jobId, leaseId: current.lease.leaseId });
    const settlementTimeValid = expiredReap ? occurredAtMs >= leaseExpiresAtMs : occurredAtMs < leaseExpiresAtMs;
    if (canonicalJson(current.lease) !== canonicalJson(previous.lease)
      || current.workerBindingSha256 !== previous.workerBindingSha256
      || BigInt(current.occurredAtMs) < BigInt(previous.lease.claimedAtMs)
      || !settlementTimeValid) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID", "Lease settlement does not carry the exact immediately prior live lease.", { path: `$receipts[${index}].lease` });
    }
  }
}

export function buildUniversalAdmissionSnapshot(value) {
  const fields = snapshotProtocolInput(value, "$snapshotInput");
  const snapshot = {
    $schema: UNIVERSAL_ADMISSION_SNAPSHOT_SCHEMA_ID,
    kind: "programmable-universal-admission-snapshot",
    recordScope: "gc-control-v1",
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    ...fields,
    authority: inertProtocolAuthority()
  };
  return validateUniversalAdmissionSnapshot(snapshot);
}

export function validateUniversalAdmissionSnapshot(input) {
  const value = snapshotProtocolInput(input, "$snapshot");
  plainObject(value, "$snapshot");
  exactKeys(value, ["$schema", "authority", "createdAtMs", "cutSha256", "gcCandidatesSha256", "kind", "previousSnapshotSha256", "recordScope", "schemaVersion", "serviceAudience", "shards", "totals"], "$snapshot");
  exact(value.$schema, UNIVERSAL_ADMISSION_SNAPSHOT_SCHEMA_ID, "$snapshot.$schema");
  exact(value.kind, "programmable-universal-admission-snapshot", "$snapshot.kind");
  exact(value.recordScope, "gc-control-v1", "$snapshot.recordScope");
  safeId(value.serviceAudience, "$snapshot.serviceAudience", 160);
  exact(value.schemaVersion, UNIVERSAL_ADMISSION_PROTOCOL_VERSION, "$snapshot.schemaVersion");
  timestamp(value.createdAtMs, "$snapshot.createdAtMs");
  digest(value.cutSha256, "$snapshot.cutSha256");
  digest(value.gcCandidatesSha256, "$snapshot.gcCandidatesSha256");
  nullableDigest(value.previousSnapshotSha256, "$snapshot.previousSnapshotSha256");
  authority(value.authority, "$snapshot.authority");
  if (!Array.isArray(value.shards) || value.shards.length > 256) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_SNAPSHOT_INVALID", "Snapshot shards must be a bounded array.", { path: "$snapshot.shards" });
  }
  let previous = null;
  for (const [index, shard] of value.shards.entries()) {
    const location = `$snapshot.shards[${index}]`;
    plainObject(shard, location);
    exactKeys(shard, ["prefix", "recordCount", "rootSha256"], location);
    if (typeof shard.prefix !== "string" || !/^[0-9a-f]{2}$/u.test(shard.prefix) || (previous !== null && shard.prefix <= previous)) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_SNAPSHOT_INVALID", "Snapshot shard prefixes must be unique and sorted.", { path: `${location}.prefix` });
    }
    previous = shard.prefix;
    positiveDecimal(shard.recordCount, `${location}.recordCount`);
    digest(shard.rootSha256, `${location}.rootSha256`);
  }
  plainObject(value.totals, "$snapshot.totals");
  exactKeys(value.totals, ["gcCandidates", "liveObjectReferences", "records"], "$snapshot.totals");
  for (const key of ["gcCandidates", "liveObjectReferences", "records"]) decimal(value.totals[key], `$snapshot.totals.${key}`, { allowZero: true });
  return deepFreeze(value);
}

export function snapshotLeafDigest({ key, recordSha256 }) {
  if (typeof key !== "string" || Buffer.byteLength(key, "utf8") < 1 || Buffer.byteLength(key, "utf8") > 512 || /[\u0000\r\n]/u.test(key)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_SNAPSHOT_INVALID", "Snapshot record key is invalid.");
  }
  digest(recordSha256, "$snapshot.recordSha256");
  return sha256DomainBytes("ua-v1-leaf", [Buffer.from(key, "utf8"), Buffer.from(recordSha256.slice(7), "hex")]);
}

export function snapshotShardDigest({ leafDigests, prefix }) {
  if (typeof prefix !== "string" || !/^[0-9a-f]{2}$/u.test(prefix)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_SNAPSHOT_INVALID", "Snapshot shard prefix is invalid.");
  }
  if (!Array.isArray(leafDigests) || leafDigests.length < 1) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_SNAPSHOT_INVALID", "Snapshot shard requires at least one leaf.");
  }
  const raw = leafDigests.map((entry) => {
    digest(entry, "$snapshot.leafDigest");
    return Buffer.from(entry.slice(7), "hex");
  });
  return sha256DomainBytes("ua-v1-shard", [Buffer.from(prefix, "ascii"), ...raw]);
}

function validateLease(value, location) {
  plainObject(value, location);
  exactKeys(value, ["claimedAtMs", "claimOrdinal", "expiresAtMs", "fenceToken", "leaseId", "renewals", "workerBindingSha256"], location);
  timestamp(value.claimedAtMs, `${location}.claimedAtMs`);
  positiveDecimal(value.claimOrdinal, `${location}.claimOrdinal`);
  timestamp(value.expiresAtMs, `${location}.expiresAtMs`);
  if (BigInt(value.expiresAtMs) <= BigInt(value.claimedAtMs)) fail("UNIVERSAL_ADMISSION_PROTOCOL_LEASE_INVALID", "Lease expiry must follow claim time.", { path: `${location}.expiresAtMs` });
  positiveDecimal(value.fenceToken, `${location}.fenceToken`);
  digest(value.leaseId, `${location}.leaseId`);
  decimal(value.renewals, `${location}.renewals`, { allowZero: true });
  digest(value.workerBindingSha256, `${location}.workerBindingSha256`);
}

function validateReceiptResult(value) {
  plainObject(value, "$receipt.result");
  exactKeys(value, ["artifactsSha256", "reportSha256", "resultSha256", "reviewState"], "$receipt.result");
  digest(value.artifactsSha256, "$receipt.result.artifactsSha256");
  digest(value.reportSha256, "$receipt.result.reportSha256");
  digest(value.resultSha256, "$receipt.result.resultSha256");
  enumValue(value.reviewState, REVIEW_STATES, "$receipt.result.reviewState");
}

function validateReceiptBranch(value) {
  const present = (entry) => entry !== null;
  const expected = {
    "queued": { from: null, to: "queued", principal: true, request: true, worker: false, lease: false, failure: false, result: false },
    "lease-claimed": { from: new Set(["queued", "retry-wait"]), to: "leased", principal: false, request: false, worker: true, lease: true, failure: false, result: false },
    "lease-renewed": { from: "leased", to: "leased", principal: false, request: false, worker: true, lease: true, failure: false, result: false },
    "retry-scheduled": { from: "leased", to: "retry-wait", principal: false, request: false, worker: true, lease: true, failure: true, result: false },
    "dead-lettered": { from: "leased", to: "dead-lettered", principal: false, request: false, worker: true, lease: true, failure: true, result: false },
    "dead-letter-redriven": { from: "dead-lettered", to: "queued", principal: true, request: false, worker: false, lease: false, failure: false, result: false },
    "processing-completed": { from: "leased", to: "processing-completed", principal: false, request: false, worker: true, lease: true, failure: false, result: true }
  }[value.eventType];
  const fromMatches = expected.from instanceof Set ? expected.from.has(value.transition.from) : expected.from === value.transition.from;
  if (!fromMatches || value.transition.to !== expected.to
    || present(value.principalBindingSha256) !== expected.principal
    || present(value.request) !== expected.request
    || present(value.workerBindingSha256) !== expected.worker
    || present(value.lease) !== expected.lease
    || present(value.failure) !== expected.failure
    || present(value.result) !== expected.result) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_INVALID", "Receipt fields do not match the event transition.");
  }
  if (value.eventType === "queued"
    && (value.job.attempt !== "0" || value.job.cycle !== "0" || value.job.fenceToken !== "0")) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_INVALID", "Initial queued receipt counters must start at zero.", { path: "$receipt.job" });
  }
  if (value.lease !== null && value.workerBindingSha256 !== value.lease.workerBindingSha256) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_INVALID", "Receipt worker and lease bindings differ.");
  }
  if (value.previousReceiptSha256 === null && value.eventIndex !== "1") {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_INVALID", "Only the first receipt may omit its previous receipt digest.");
  }
  if (value.previousReceiptSha256 !== null && value.eventIndex === "1") {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_INVALID", "The first receipt cannot name a previous receipt digest.");
  }
}

function authority(value, location) {
  plainObject(value, location);
  exactKeys(value, AUTHORITY_KEYS, location);
  for (const key of AUTHORITY_KEYS) exact(value[key], false, `${location}.${key}`);
}

function sha256DomainBytes(domain, chunks) {
  const hash = crypto.createHash("sha256");
  hash.update(Buffer.from(`${domain}\0`, "utf8"));
  for (const chunk of chunks) {
    hash.update(chunk);
    hash.update(Buffer.from([0]));
  }
  return `sha256:${hash.digest("hex")}`;
}

function plainObject(value, location) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", "Expected a plain object.", { path: location });
  }
}

function snapshotProtocolInput(value, location) {
  plainObject(value, location);
  try {
    return structuredClone(value);
  } catch (cause) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", "Protocol input could not be snapshotted.", { cause, path: location });
  }
}

function snapshotBoundedProtocolBytes(value, { code, label, maximumByteLength, minimumByteLength }) {
  // Native brand/proxy checks and prebound root %TypedArray% accessors avoid
  // consulting caller-owned getters, iterators, constructors, or valueOf.
  // Establish the byte boundary before the only copy, then verify that the
  // intrinsic backing region did not change during that copy.
  if (value === null
    || typeof value !== "object"
    || types.isProxy(value)
    || !types.isUint8Array(value)) {
    fail(code, `${label} must be supplied as one non-proxy bounded byte sequence.`);
  }
  const before = intrinsicProtocolByteRegion(value, { code, label });
  if (before.byteLength < minimumByteLength || before.byteLength > maximumByteLength) {
    fail(code, `${label} is outside its closed byte boundary.`);
  }
  let snapshot;
  try {
    const safeView = new ROOT_UINT8_ARRAY(before.buffer, before.byteOffset, before.byteLength);
    snapshot = Buffer.from(safeView);
  } catch (cause) {
    fail(code, `${label} bytes could not be snapshotted exactly once.`, { cause });
  }
  const after = intrinsicProtocolByteRegion(value, { code, label });
  if (after.buffer !== before.buffer
    || after.byteOffset !== before.byteOffset
    || after.byteLength !== before.byteLength
    || snapshot.byteLength !== before.byteLength) {
    fail(code, `${label} backing region changed while it was being snapshotted.`);
  }
  return snapshot;
}

function intrinsicProtocolByteRegion(value, { code, label }) {
  try {
    const buffer = ROOT_TYPED_ARRAY_BUFFER(value);
    const byteOffset = ROOT_TYPED_ARRAY_BYTE_OFFSET(value);
    const byteLength = ROOT_TYPED_ARRAY_BYTE_LENGTH(value);
    if (!Number.isSafeInteger(byteOffset)
      || byteOffset < 0
      || !Number.isSafeInteger(byteLength)
      || byteLength < 0) {
      fail(code, `${label} has an invalid intrinsic byte region.`);
    }
    return { buffer, byteLength, byteOffset };
  } catch (cause) {
    if (cause instanceof UniversalAdmissionProtocolError) throw cause;
    fail(code, `${label} intrinsic byte region could not be inspected.`, { cause });
  }
}

function validateBoundedProtocolJson(value, location, depth = 0) {
  if (depth > 16) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_REQUEST_INVALID", "Durable command request nesting exceeds the closed protocol limit.", { path: location });
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > 16384 || /[\u0000]/u.test(value)) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_REQUEST_INVALID", "Durable command request string is outside the closed protocol limit.", { path: location });
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_REQUEST_INVALID", "Durable command request numbers must be safe integers.", { path: location });
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 1000) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_REQUEST_INVALID", "Durable command request array exceeds the closed protocol limit.", { path: location });
    }
    for (const [index, child] of value.entries()) validateBoundedProtocolJson(child, `${location}[${index}]`, depth + 1);
    return;
  }
  plainObject(value, location);
  const entries = Object.entries(value);
  if (entries.length > 128) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_REQUEST_INVALID", "Durable command request object has too many fields.", { path: location });
  }
  for (const [key, child] of entries) {
    if (Buffer.byteLength(key, "utf8") < 1 || Buffer.byteLength(key, "utf8") > 128 || /[\u0000\r\n]/u.test(key)) {
      fail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_REQUEST_INVALID", "Durable command request field name is invalid.", { path: location });
    }
    validateBoundedProtocolJson(child, `${location}.${key}`, depth + 1);
  }
}

function sortedUniqueDigests(values) {
  return [...new Set(values)].sort(compareUtf8);
}

function exactKeys(value, expected, location) {
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_FIELD_SET_INVALID", "Object fields do not match the closed protocol contract.", { path: location });
  }
}

function exact(value, expected, location) {
  if (value !== expected) fail("UNIVERSAL_ADMISSION_PROTOCOL_ASSERTION_INVALID", `Expected ${String(expected)}.`, { path: location });
}

function safeId(value, location, maximum) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || !SAFE_ID.test(value)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_ID_INVALID", "Identifier is outside the closed lowercase protocol syntax.", { path: location });
  }
}

function slug(value, location, maximum) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || !SLUG.test(value)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_ID_INVALID", "Identifier is outside the closed slug syntax.", { path: location });
  }
}

function digest(value, location) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_DIGEST_INVALID", "Expected a lowercase sha256 digest.", { path: location });
  }
}

function nullableDigest(value, location) {
  if (value !== null) digest(value, location);
}

function boolean(value, location) {
  if (typeof value !== "boolean") fail("UNIVERSAL_ADMISSION_PROTOCOL_BOOLEAN_INVALID", "Expected a boolean.", { path: location });
}

function enumValue(value, allowed, location) {
  if (typeof value !== "string" || !allowed.has(value)) fail("UNIVERSAL_ADMISSION_PROTOCOL_ENUM_INVALID", "Value is outside the closed protocol vocabulary.", { path: location });
}

function decimal(value, location, { allowZero = false } = {}) {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_DECIMAL_INVALID", "Expected a canonical non-negative decimal string.", { path: location });
  }
  const parsed = BigInt(value);
  if ((!allowZero && parsed === 0n) || parsed > MAX_PROTOCOL_DECIMAL) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_DECIMAL_INVALID", "Decimal value is outside the supported 18-digit protocol range.", { path: location });
  }
  return parsed;
}

function applicationRevision(value, location) {
  if (typeof value !== "string" || !APPLICATION_REVISION.test(value)) {
    fail("UNIVERSAL_ADMISSION_PROTOCOL_APPLICATION_REVISION_INVALID", "Application revision must be a canonical positive decimal with at most 31 digits.", { path: location });
  }
  return value;
}

function positiveDecimal(value, location) {
  return decimal(value, location, { allowZero: false });
}

function timestamp(value, location) {
  return decimal(value, location, { allowZero: true });
}

function atMost(left, right, code, message) {
  if (left > right) fail(code, message);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function fail(code, message, options) {
  throw new UniversalAdmissionProtocolError(code, message, options);
}
