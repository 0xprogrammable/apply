import { Buffer } from "node:buffer";
import { types } from "node:util";

import {
  canonicalJson,
  sha256Bytes
} from "../vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs";
import {
  MAX_UNIVERSAL_ADMISSION_COMMAND_BYTES,
  authenticatedPrincipalContextFromCommandVerification,
  verifyUniversalAdmissionEnqueueCommand
} from "./universal-admission-command-core.mjs";
import { MAX_UNIVERSAL_ADMISSION_BYTES } from "./universal-admission-core.mjs";
import {
  canonicalProtocolBytes,
  deriveJobId,
  derivePrincipalBinding,
  deriveRevisionKey,
  deriveUniversalAdmissionIdempotencyKey,
  deriveUniversalAdmissionRevisionBinding,
  deriveUniversalAdmissionProtocolBindings,
  MAX_UNIVERSAL_ADMISSION_AUTHENTICATED_REQUEST_BYTES,
  UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
  validateUniversalAdmissionEventReceipt
} from "./universal-admission-protocol-core.mjs";

export const AUTHENTICATED_ADMISSION_TRANSPORT_RECEIPT_SCHEMA_ID = "urn:programmable:authenticated-admission-transport-receipt:1.0.0";
export const AUTHENTICATED_ADMISSION_TRANSPORT_RECEIPT_VERSION = "1.0.0";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REQUEST_ID = /^[0-9a-f]{32}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,30}$/u;
const AUDIENCE = /^urn:programmable:submit-launch:universal-admission:[a-z0-9]+(?:-[a-z0-9]+)*:v1$/u;
const CANONICAL_TIMESTAMP = /^(?:[0-9]{4})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/u;
const AUTHENTICATION_ASSURANCES = new Set(["configured-subject-key", "gateway-key"]);
const AUTHENTICATION_ROLES = new Set(["applicant-submitter", "tenant-ingress"]);
const SUBMISSION_STATUSES = new Set(["DUPLICATE", "QUEUED"]);
const ED25519_SIGNATURE_BYTE_LENGTH = 64;
const MAX_TRANSPORT_SNAPSHOT_BYTES = 512 * 1024;
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

export class AuthenticatedAdmissionServiceError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "AuthenticatedAdmissionServiceError";
    this.code = code;
    this.path = options?.path ?? null;
  }
}

/**
 * Verify a signed public enqueue command and submit only its provenance-sealed
 * principal to a queue-store capability. The returned object is an honest
 * trusted-service readback, not an independently verifiable service-signed
 * proof. No signature, trust snapshot, command bytes, or other credential-like
 * material reaches the store.
 */
export async function submitAuthenticatedUniversalAdmission({
  admissionBytes,
  commandBytes,
  expectedCapacityPolicySha256,
  signature,
  trustSnapshot,
  store,
  now = new Date()
}) {
  // Authentication and all signed target checks intentionally happen before
  // even accepting a store capability. Invalid traffic cannot touch storage.
  const stableAdmissionBytes = snapshotAdmissionBytes(admissionBytes);
  const stableCommandBytes = snapshotCommandBytes(commandBytes);
  const verification = verifyUniversalAdmissionEnqueueCommand({
    admissionBytes: stableAdmissionBytes,
    commandBytes: stableCommandBytes,
    now,
    signature,
    trustSnapshot
  });
  const authenticatedRequestByteLength = String(
    stableAdmissionBytes.byteLength
    + stableCommandBytes.byteLength
    + decodedVerifiedSignatureByteLength(signature)
  );
  const principalContext = authenticatedPrincipalContextFromCommandVerification(verification);
  const bindings = deriveUniversalAdmissionProtocolBindings({
    bytes: stableAdmissionBytes,
    principalContext
  });
  validateExpectedCapacityPolicyDigest(expectedCapacityPolicySha256);
  validateVerificationProtocolBinding({
    bindings,
    expectedCapacityPolicySha256,
    verification
  });
  const capability = captureQueueStoreCapability(store);

  const storeResponseCandidate = await Reflect.apply(capability.submit, store, [{
    authenticatedRequestByteLength,
    bytes: stableAdmissionBytes,
    expectedCapacityPolicySha256,
    principalContext,
    requestDigest: verification.commandDigest,
    requestId: verification.requestId
  }]);
  const storeResponse = snapshotPlainTransportData(storeResponseCandidate, {
    code: "AUTHENTICATED_ADMISSION_STORE_RESPONSE_SNAPSHOT_INVALID",
    label: "Queue store response"
  });
  const submission = validateStoreSubmission(storeResponse, { bindings, verification });
  const event = validateDurableQueueEvent(submission.eventReceipt, {
    authenticatedRequestByteLength,
    bindings,
    expectedCapacityPolicySha256,
    submission,
    verification
  });

  return validateAuthenticatedAdmissionTransportReceipt({
    $schema: AUTHENTICATED_ADMISSION_TRANSPORT_RECEIPT_SCHEMA_ID,
    admission: {
      applicationId: bindings.applicationId,
      digest: bindings.admissionDigest,
      revision: bindings.revision
    },
    authentication: {
      assurance: verification.authentication.assurance,
      audience: verification.authentication.audience,
      keyId: verification.authentication.keyId,
      keyRecordDigest: verification.authentication.keyRecordDigest,
      method: verification.authentication.authenticationMethod,
      role: verification.authentication.role,
      signerAuthenticated: true,
      subjectId: verification.authentication.subjectId,
      tenantId: verification.authentication.tenantId,
      trustEpoch: verification.authentication.trustEpoch,
      trustSnapshotDigest: verification.authentication.trustSnapshotDigest,
      verifiedAt: verification.authentication.verifiedAt
    },
    authority: inertTransportAuthority(),
    effects: {
      candidateCodeExecuted: false,
      credentialsPersisted: false,
      queueStoreSubmitInvoked: true
    },
    independentlyVerifiable: false,
    kind: "programmable-authenticated-admission-transport-receipt",
    publicDataOnly: true,
    queue: {
      eventIndex: event.eventIndex,
      eventPrincipalBindingDigest: event.principalBindingSha256,
      eventReceiptDigest: submission.receiptSha256,
      eventType: event.eventType,
      idempotencyKey: submission.idempotencyKey,
      jobId: submission.jobId,
      protectedExpectedPolicyDigest: expectedCapacityPolicySha256,
      requestPrincipalBindingDigest: submission.principalBindingSha256,
      revisionBindingDigest: event.job.revisionBindingSha256,
      revisionKey: submission.revisionKey
    },
    request: {
      authenticatedRequestByteLength,
      commandDigest: verification.commandDigest,
      requestId: verification.requestId,
      signedCapacityPolicyDigest: verification.target.capacityPolicySha256
    },
    schemaVersion: AUTHENTICATED_ADMISSION_TRANSPORT_RECEIPT_VERSION,
    status: submission.status,
    verificationScope: "trusted-service-readback"
  });
}

export function canonicalAuthenticatedAdmissionTransportReceiptBytes(value) {
  const receipt = validateAuthenticatedAdmissionTransportReceipt(value);
  return Buffer.from(`${canonicalJson(receipt)}\n`, "utf8");
}

export function validateAuthenticatedAdmissionTransportReceipt(value) {
  value = snapshotPlainTransportData(value, {
    code: "AUTHENTICATED_ADMISSION_RECEIPT_INVALID",
    label: "Authenticated transport readback"
  });
  object(value, "$", [
    "$schema", "admission", "authentication", "authority", "effects",
    "independentlyVerifiable", "kind", "publicDataOnly", "queue", "request",
    "schemaVersion", "status", "verificationScope"
  ]);
  exact(value.$schema, AUTHENTICATED_ADMISSION_TRANSPORT_RECEIPT_SCHEMA_ID, "$.$schema");
  exact(value.kind, "programmable-authenticated-admission-transport-receipt", "$.kind");
  exact(value.schemaVersion, AUTHENTICATED_ADMISSION_TRANSPORT_RECEIPT_VERSION, "$.schemaVersion");
  exact(value.publicDataOnly, true, "$.publicDataOnly");
  exact(value.independentlyVerifiable, false, "$.independentlyVerifiable");
  exact(value.verificationScope, "trusted-service-readback", "$.verificationScope");
  enumValue(value.status, SUBMISSION_STATUSES, "$.status");

  object(value.admission, "$.admission", ["applicationId", "digest", "revision"]);
  slug(value.admission.applicationId, 80, "$.admission.applicationId");
  digest(value.admission.digest, "$.admission.digest");
  positiveDecimal(value.admission.revision, "$.admission.revision");

  object(value.authentication, "$.authentication", [
    "assurance", "audience", "keyId", "keyRecordDigest", "method", "role",
    "signerAuthenticated", "subjectId", "tenantId", "trustEpoch",
    "trustSnapshotDigest", "verifiedAt"
  ]);
  enumValue(value.authentication.assurance, AUTHENTICATION_ASSURANCES, "$.authentication.assurance");
  pattern(value.authentication.audience, AUDIENCE, 160, "$.authentication.audience");
  digest(value.authentication.keyId, "$.authentication.keyId");
  digest(value.authentication.keyRecordDigest, "$.authentication.keyRecordDigest");
  exact(value.authentication.method, "Ed25519", "$.authentication.method");
  enumValue(value.authentication.role, AUTHENTICATION_ROLES, "$.authentication.role");
  exact(value.authentication.signerAuthenticated, true, "$.authentication.signerAuthenticated");
  slug(value.authentication.subjectId, 80, "$.authentication.subjectId");
  slug(value.authentication.tenantId, 64, "$.authentication.tenantId");
  positiveDecimal(value.authentication.trustEpoch, "$.authentication.trustEpoch");
  digest(value.authentication.trustSnapshotDigest, "$.authentication.trustSnapshotDigest");
  canonicalTimestamp(value.authentication.verifiedAt, "$.authentication.verifiedAt");

  object(value.request, "$.request", [
    "authenticatedRequestByteLength", "commandDigest", "requestId", "signedCapacityPolicyDigest"
  ]);
  authenticatedRequestByteLength(value.request.authenticatedRequestByteLength, "$.request.authenticatedRequestByteLength");
  digest(value.request.commandDigest, "$.request.commandDigest");
  pattern(value.request.requestId, REQUEST_ID, 32, "$.request.requestId");
  digest(value.request.signedCapacityPolicyDigest, "$.request.signedCapacityPolicyDigest");

  object(value.queue, "$.queue", [
    "eventIndex", "eventPrincipalBindingDigest", "eventReceiptDigest", "eventType",
    "idempotencyKey", "jobId", "protectedExpectedPolicyDigest",
    "requestPrincipalBindingDigest", "revisionBindingDigest", "revisionKey"
  ]);
  for (const key of [
    "eventPrincipalBindingDigest", "eventReceiptDigest", "idempotencyKey",
    "jobId", "protectedExpectedPolicyDigest", "requestPrincipalBindingDigest",
    "revisionBindingDigest", "revisionKey"
  ]) digest(value.queue[key], `$.queue.${key}`);
  exact(value.queue.eventIndex, "1", "$.queue.eventIndex");
  exact(value.queue.eventType, "queued", "$.queue.eventType");
  if (value.request.signedCapacityPolicyDigest !== value.queue.protectedExpectedPolicyDigest) {
    fail("AUTHENTICATED_ADMISSION_RECEIPT_INVALID", "Signed and protected capacity-policy digests must be identical.", { path: "$.request.signedCapacityPolicyDigest" });
  }
  const expectedRevisionKey = deriveRevisionKey({
    applicationId: value.admission.applicationId,
    audience: value.authentication.audience,
    revision: value.admission.revision,
    tenantId: value.authentication.tenantId
  });
  const expectedJobId = deriveJobId({
    admissionDigest: value.admission.digest,
    revisionKey: expectedRevisionKey
  });
  const expectedIdempotencyKey = deriveUniversalAdmissionIdempotencyKey({
    admissionDigest: value.admission.digest,
    audience: value.authentication.audience,
    tenantId: value.authentication.tenantId
  });
  const expectedPrincipal = derivePrincipalBinding({
    authenticated: true,
    audience: value.authentication.audience,
    authorityId: value.authentication.keyId,
    kind: "programmable-authenticated-principal-context",
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    subjectId: value.authentication.subjectId,
    tenantId: value.authentication.tenantId
  });
  if (
    value.queue.revisionKey !== expectedRevisionKey
    || value.queue.jobId !== expectedJobId
    || value.queue.idempotencyKey !== expectedIdempotencyKey
    || value.queue.requestPrincipalBindingDigest !== expectedPrincipal.principalBindingSha256
    || (value.status === "QUEUED" && value.queue.eventPrincipalBindingDigest !== expectedPrincipal.principalBindingSha256)
  ) {
    fail("AUTHENTICATED_ADMISSION_RECEIPT_INVALID", "Queue identities do not bind the exact authenticated admission domain.", { path: "$.queue" });
  }
  if (
    (value.authentication.role === "tenant-ingress" && value.authentication.assurance !== "gateway-key")
    || (value.authentication.role === "applicant-submitter" && value.authentication.assurance !== "configured-subject-key")
  ) {
    fail("AUTHENTICATED_ADMISSION_RECEIPT_INVALID", "Authentication role and assurance do not match.", { path: "$.authentication.assurance" });
  }

  object(value.effects, "$.effects", [
    "candidateCodeExecuted", "credentialsPersisted", "queueStoreSubmitInvoked"
  ]);
  exact(value.effects.candidateCodeExecuted, false, "$.effects.candidateCodeExecuted");
  exact(value.effects.credentialsPersisted, false, "$.effects.credentialsPersisted");
  exact(value.effects.queueStoreSubmitInvoked, true, "$.effects.queueStoreSubmitInvoked");
  validateTransportAuthority(value.authority, "$.authority");
  return deepFreeze(structuredClone(value));
}

function captureQueueStoreCapability(store) {
  if (
    store === null
    || typeof store !== "object"
    || Array.isArray(store)
    || types.isProxy(store)
    || hasThenCapability(store)
  ) {
    fail("AUTHENTICATED_ADMISSION_STORE_CAPABILITY_INVALID", "Queue store must be a non-thenable object capability.");
  }
  const submit = dataMethod(store, "submit");
  return Object.freeze({ submit });
}

function hasThenCapability(target) {
  let cursor = target;
  while (cursor !== null) {
    if (types.isProxy(cursor)) {
      fail("AUTHENTICATED_ADMISSION_STORE_CAPABILITY_INVALID", "Queue store prototype chain must not contain proxies.");
    }
    let descriptor;
    let next;
    try {
      descriptor = Object.getOwnPropertyDescriptor(cursor, "then");
      next = Object.getPrototypeOf(cursor);
    } catch (error) {
      fail("AUTHENTICATED_ADMISSION_STORE_CAPABILITY_INVALID", "Queue store thenability could not be inspected.", { cause: error });
    }
    if (descriptor !== undefined) return true;
    cursor = next;
  }
  return false;
}

function snapshotAdmissionBytes(value) {
  return snapshotBoundedUint8Array(value, {
    label: "Admission",
    maximumByteLength: MAX_UNIVERSAL_ADMISSION_BYTES
  });
}

function snapshotCommandBytes(value) {
  return snapshotBoundedUint8Array(value, {
    label: "Command",
    maximumByteLength: MAX_UNIVERSAL_ADMISSION_COMMAND_BYTES
  });
}

function snapshotBoundedUint8Array(value, { label, maximumByteLength }) {
  // Node's native brand/proxy checks and the prebound root %TypedArray%
  // accessors inspect internal slots without consulting caller-owned
  // `buffer`, `byteOffset`, `byteLength`, `length`, iterator, or valueOf
  // properties. The size boundary is therefore established before copying.
  if (
    value === null
    || typeof value !== "object"
    || types.isProxy(value)
    || !types.isUint8Array(value)
  ) {
    fail("AUTHENTICATED_ADMISSION_INPUT_INVALID", `${label} must be supplied as one non-proxy bounded byte sequence.`);
  }
  const before = rootUint8ArrayRegion(value, label);
  if (before.byteLength < 2 || before.byteLength > maximumByteLength) {
    fail("AUTHENTICATED_ADMISSION_INPUT_INVALID", `${label} exceeds its closed byte boundary.`);
  }

  let snapshot;
  try {
    const safeView = new ROOT_UINT8_ARRAY(before.buffer, before.byteOffset, before.byteLength);
    snapshot = Buffer.from(safeView);
  } catch (error) {
    fail("AUTHENTICATED_ADMISSION_INPUT_INVALID", `${label} bytes could not be snapshotted exactly once.`, { cause: error });
  }
  const after = rootUint8ArrayRegion(value, label);
  if (
    after.buffer !== before.buffer
    || after.byteOffset !== before.byteOffset
    || after.byteLength !== before.byteLength
    || snapshot.byteLength !== before.byteLength
  ) {
    fail("AUTHENTICATED_ADMISSION_INPUT_INVALID", `${label} backing region changed while it was being snapshotted.`);
  }
  return snapshot;
}

function rootUint8ArrayRegion(value, label) {
  try {
    const buffer = ROOT_TYPED_ARRAY_BUFFER(value);
    const byteOffset = ROOT_TYPED_ARRAY_BYTE_OFFSET(value);
    const byteLength = ROOT_TYPED_ARRAY_BYTE_LENGTH(value);
    if (
      !Number.isSafeInteger(byteOffset)
      || byteOffset < 0
      || !Number.isSafeInteger(byteLength)
      || byteLength < 0
    ) {
      fail("AUTHENTICATED_ADMISSION_INPUT_INVALID", `${label} has an invalid backing byte region.`);
    }
    return { buffer, byteLength, byteOffset };
  } catch (error) {
    if (error instanceof AuthenticatedAdmissionServiceError) throw error;
    fail("AUTHENTICATED_ADMISSION_INPUT_INVALID", `${label} backing byte region could not be inspected.`, { cause: error });
  }
}

function decodedVerifiedSignatureByteLength(signature) {
  // The command verifier has already required canonical unpadded base64url and
  // a decoded Ed25519 signature of exactly 64 bytes. Recomputing this public
  // byte count cannot reinterpret caller-controlled mutable state.
  const byteLength = Buffer.from(signature, "base64url").byteLength;
  if (byteLength !== ED25519_SIGNATURE_BYTE_LENGTH) {
    fail("AUTHENTICATED_ADMISSION_INPUT_INVALID", "Verified Ed25519 signature length changed unexpectedly.");
  }
  return byteLength;
}

function snapshotPlainTransportData(value, { code, label }) {
  const seen = new WeakSet();
  let nodes = 0;
  let observedStringBytes = 0;

  const accountString = (current, location) => {
    observedStringBytes += Buffer.byteLength(current, "utf8");
    if (observedStringBytes > MAX_TRANSPORT_SNAPSHOT_BYTES) {
      fail(code, `${label} exceeds its closed byte boundary.`, { path: location });
    }
  };

  const visit = (current, location, depth) => {
    nodes += 1;
    if (nodes > 2048 || depth > 32) {
      fail(code, `${label} exceeds its closed structural boundary.`, { path: location });
    }
    if (typeof current === "string") {
      accountString(current, location);
      return current;
    }
    if (current === null || typeof current === "boolean") return current;
    if (typeof current !== "object" || Array.isArray(current) || types.isProxy(current)) {
      fail(code, `${label} must contain only plain JSON object data.`, { path: location });
    }
    if (seen.has(current)) {
      fail(code, `${label} must not contain cycles or shared mutable object aliases.`, { path: location });
    }
    seen.add(current);

    let prototype;
    let keys;
    try {
      prototype = Object.getPrototypeOf(current);
      keys = Reflect.ownKeys(current);
    } catch (error) {
      fail(code, `${label} could not be inspected as plain data.`, { cause: error, path: location });
    }
    if (prototype !== Object.prototype || keys.some((key) => typeof key !== "string")) {
      fail(code, `${label} must contain only ordinary string-keyed objects.`, { path: location });
    }

    const result = {};
    for (const key of keys) {
      accountString(key, location);
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key);
      } catch (error) {
        fail(code, `${label} field could not be inspected as plain data.`, { cause: error, path: `${location}.${key}` });
      }
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || descriptor.get !== undefined
        || descriptor.set !== undefined
        || !Object.hasOwn(descriptor, "value")
      ) {
        fail(code, `${label} must not contain accessors or hidden fields.`, { path: `${location}.${key}` });
      }
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: visit(descriptor.value, `${location}.${key}`, depth + 1),
        writable: true
      });
    }
    return result;
  };

  const snapshot = visit(value, "$transport", 0);
  let byteLength;
  try {
    byteLength = Buffer.byteLength(`${canonicalJson(snapshot)}\n`, "utf8");
  } catch (error) {
    fail(code, `${label} is not canonical public JSON data.`, { cause: error });
  }
  if (byteLength > MAX_TRANSPORT_SNAPSHOT_BYTES) {
    fail(code, `${label} exceeds its closed 512 KiB byte boundary.`);
  }
  return snapshot;
}

function validateVerificationProtocolBinding({
  bindings,
  expectedCapacityPolicySha256,
  verification
}) {
  const expected = {
    admissionDigest: bindings.admissionDigest,
    applicationId: bindings.applicationId,
    capacityPolicySha256: expectedCapacityPolicySha256,
    revision: bindings.revision
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (verification.target[key] !== expectedValue) {
      fail("AUTHENTICATED_ADMISSION_VERIFICATION_BINDING_INVALID", `Verified target ${key} differs from the queue protocol binding.`);
    }
  }
  const verifiedPrincipal = derivePrincipalBinding({
    authenticated: true,
    audience: verification.authentication.audience,
    authorityId: verification.authentication.keyId,
    kind: "programmable-authenticated-principal-context",
    schemaVersion: UNIVERSAL_ADMISSION_PROTOCOL_VERSION,
    subjectId: verification.authentication.subjectId,
    tenantId: verification.authentication.tenantId
  });
  if (
    verification.authentication.tenantId !== bindings.tenantId
    || verification.authentication.keyId !== bindings.principal.authorityId
    || verification.authentication.audience !== bindings.audience
    || verification.authentication.audience !== bindings.principal.audience
    || verifiedPrincipal.principalBindingSha256 !== bindings.principal.principalBindingSha256
  ) {
    fail("AUTHENTICATED_ADMISSION_VERIFICATION_BINDING_INVALID", "Verified principal differs from the queue protocol binding.");
  }
}

function validateExpectedCapacityPolicyDigest(value) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail("AUTHENTICATED_ADMISSION_CAPACITY_POLICY_PIN_INVALID", "A protected expected capacity-policy digest is required before queue submission.");
  }
}

function dataMethod(target, name) {
  let cursor = target;
  while (cursor !== null) {
    if (types.isProxy(cursor)) {
      fail("AUTHENTICATED_ADMISSION_STORE_CAPABILITY_INVALID", `Queue store ${name} prototype chain must not contain proxies.`);
    }
    let descriptor;
    let next;
    try {
      descriptor = Object.getOwnPropertyDescriptor(cursor, name);
      next = Object.getPrototypeOf(cursor);
    } catch (error) {
      fail("AUTHENTICATED_ADMISSION_STORE_CAPABILITY_INVALID", `Queue store ${name} capability could not be inspected.`, { cause: error });
    }
    if (descriptor !== undefined) {
      if (
        descriptor.get !== undefined
        || descriptor.set !== undefined
        || typeof descriptor.value !== "function"
        || types.isProxy(descriptor.value)
      ) {
        fail("AUTHENTICATED_ADMISSION_STORE_CAPABILITY_INVALID", `Queue store ${name} must be a data-method capability.`);
      }
      return descriptor.value;
    }
    cursor = next;
  }
  fail("AUTHENTICATED_ADMISSION_STORE_CAPABILITY_INVALID", `Queue store is missing the ${name} capability.`);
}

function validateStoreSubmission(value, { bindings, verification }) {
  object(value, "$storeResponse", [
    "admissionDigest", "authority", "eventReceipt", "idempotencyKey", "jobId",
    "principalBindingSha256", "receiptSha256", "requestDigest", "requestId",
    "revisionBindingSha256", "revisionKey", "status", "tenantId"
  ]);
  enumValue(value.status, SUBMISSION_STATUSES, "$storeResponse.status");
  for (const key of [
    "admissionDigest", "idempotencyKey", "jobId", "principalBindingSha256",
    "receiptSha256", "requestDigest", "revisionBindingSha256", "revisionKey"
  ]) digest(value[key], `$storeResponse.${key}`);
  pattern(value.requestId, REQUEST_ID, 32, "$storeResponse.requestId");
  slug(value.tenantId, 64, "$storeResponse.tenantId");
  validateProtocolAuthority(value.authority, "$storeResponse.authority");

  const expected = {
    admissionDigest: bindings.admissionDigest,
    idempotencyKey: bindings.idempotencyKey,
    jobId: bindings.jobId,
    principalBindingSha256: bindings.principal.principalBindingSha256,
    requestDigest: verification.commandDigest,
    requestId: verification.requestId,
    revisionKey: bindings.revisionKey,
    tenantId: bindings.tenantId
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      fail("AUTHENTICATED_ADMISSION_STORE_RESPONSE_BINDING_INVALID", `Queue store response ${key} does not match the authenticated request.`, { path: `$storeResponse.${key}` });
    }
  }
  return deepFreeze(structuredClone(value));
}

function validateDurableQueueEvent(value, {
  authenticatedRequestByteLength,
  bindings,
  expectedCapacityPolicySha256,
  submission,
  verification
}) {
  if (Buffer.byteLength(`${canonicalJson(value)}\n`, "utf8") > 256 * 1024) {
    fail("AUTHENTICATED_ADMISSION_EVENT_RECEIPT_SNAPSHOT_INVALID", "Queue event receipt exceeds its closed 256 KiB boundary.");
  }
  let event;
  try {
    event = validateUniversalAdmissionEventReceipt(value);
  } catch (error) {
    fail("AUTHENTICATED_ADMISSION_EVENT_RECEIPT_INVALID", "Queue store did not return a valid immutable event receipt.", { cause: error });
  }
  if (sha256Bytes(canonicalProtocolBytes(event)) !== submission.receiptSha256) {
    fail("AUTHENTICATED_ADMISSION_EVENT_RECEIPT_DIGEST_MISMATCH", "Queue event bytes do not match the store response receipt digest.");
  }
  if (event.capacityPolicySha256 !== expectedCapacityPolicySha256) {
    fail("AUTHENTICATED_ADMISSION_CAPACITY_POLICY_MISMATCH", "Queue event capacity policy differs from the protected expected digest.", { path: "$event.capacityPolicySha256" });
  }
  if (
    event.serviceAudience !== bindings.audience
    || event.idempotencyKey !== bindings.idempotencyKey
    || submission.idempotencyKey !== bindings.idempotencyKey
  ) {
    fail("AUTHENTICATED_ADMISSION_EVENT_RECEIPT_BINDING_INVALID", "Queue event audience or idempotency binding differs from the authenticated service domain.");
  }
  const expectedJob = {
    admissionDigest: bindings.admissionDigest,
    applicationId: bindings.applicationId,
    jobId: bindings.jobId,
    revision: bindings.revision,
    revisionKey: bindings.revisionKey,
    tenantId: bindings.tenantId
  };
  for (const [key, expectedValue] of Object.entries(expectedJob)) {
    if (event.job[key] !== expectedValue) {
      fail("AUTHENTICATED_ADMISSION_EVENT_RECEIPT_BINDING_INVALID", `Queue event ${key} does not match the authenticated admission.`, { path: `$event.job.${key}` });
    }
  }
  const expectedRevisionBindingDigest = deriveUniversalAdmissionRevisionBinding({
    bindings: {
      admissionDigest: bindings.admissionDigest,
      applicationId: bindings.applicationId,
      audience: bindings.audience,
      jobId: bindings.jobId,
      revision: bindings.revision,
      revisionKey: bindings.revisionKey,
      tenantId: bindings.tenantId
    },
    createdAtMs: event.occurredAtMs,
    creatorPrincipalBindingSha256: event.principalBindingSha256
  }).revisionBindingSha256;
  if (
    event.job.revisionBindingSha256 !== expectedRevisionBindingDigest
    || submission.revisionBindingSha256 !== expectedRevisionBindingDigest
  ) {
    fail("AUTHENTICATED_ADMISSION_EVENT_RECEIPT_BINDING_INVALID", "Queue revision binding does not match its authenticated immutable preimage.", { path: "$event.job.revisionBindingSha256" });
  }
  if (
    event.eventType !== "queued"
    || event.eventIndex !== "1"
    || event.job.attempt !== "0"
    || event.job.availableAtMs !== event.occurredAtMs
    || event.job.cycle !== "0"
    || event.job.fenceToken !== "0"
    || event.transition.from !== null
    || event.transition.to !== "queued"
    || event.failure !== null
    || event.lease !== null
    || event.result !== null
    || event.workerBindingSha256 !== null
  ) {
    fail("AUTHENTICATED_ADMISSION_EVENT_RECEIPT_STATE_INVALID", "Submission response must reference the immutable initial queued event.");
  }
  if (event.request === null) {
    fail("AUTHENTICATED_ADMISSION_EVENT_RECEIPT_BINDING_INVALID", "Initial queued event must retain its authenticated request binding.", { path: "$event.request" });
  }
  if (event.request.expectedCapacityPolicySha256 !== expectedCapacityPolicySha256) {
    fail("AUTHENTICATED_ADMISSION_EVENT_RECEIPT_BINDING_INVALID", "Initial queued event does not retain the signed capacity-policy precondition.", { path: "$event.request.expectedCapacityPolicySha256" });
  }
  if (submission.status === "QUEUED") {
    if (
      event.request.authenticatedRequestByteLength !== authenticatedRequestByteLength
      || event.request.requestDigest !== verification.commandDigest
      || event.request.requestId !== verification.requestId
      || event.principalBindingSha256 !== bindings.principal.principalBindingSha256
    ) {
      fail("AUTHENTICATED_ADMISSION_EVENT_RECEIPT_BINDING_INVALID", "New queue event does not match the authenticated command and principal.");
    }
  }
  return event;
}

function inertTransportAuthority() {
  return Object.freeze(Object.fromEntries(AUTHORITY_KEYS.map((key) => [key, false])));
}

function validateTransportAuthority(value, location) {
  object(value, location, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) exact(value[key], false, `${location}.${key}`);
}

function validateProtocolAuthority(value, location) {
  object(value, location, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) exact(value[key], false, `${location}.${key}`);
}

function object(value, location, required) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("AUTHENTICATED_ADMISSION_RECEIPT_INVALID", "Expected a closed object.", { path: location });
  }
  const keys = Object.keys(value);
  if (keys.length !== required.length || required.some((key) => !Object.hasOwn(value, key))) {
    fail("AUTHENTICATED_ADMISSION_RECEIPT_INVALID", "Object has a missing or unexpected field.", { path: location });
  }
}

function exact(value, expected, location) {
  if (value !== expected) {
    fail("AUTHENTICATED_ADMISSION_RECEIPT_INVALID", `Expected ${String(expected)}.`, { path: location });
  }
}

function enumValue(value, allowed, location) {
  if (typeof value !== "string" || !allowed.has(value)) {
    fail("AUTHENTICATED_ADMISSION_RECEIPT_INVALID", "String is outside the closed vocabulary.", { path: location });
  }
}

function pattern(value, expression, maximumBytes, location) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maximumBytes || !expression.test(value)) {
    fail("AUTHENTICATED_ADMISSION_RECEIPT_INVALID", "String is outside its closed canonical format.", { path: location });
  }
}

function digest(value, location) {
  pattern(value, DIGEST, 71, location);
}

function slug(value, maximumBytes, location) {
  pattern(value, SLUG, maximumBytes, location);
}

function positiveDecimal(value, location) {
  pattern(value, POSITIVE_DECIMAL, 31, location);
}

function authenticatedRequestByteLength(value, location) {
  positiveDecimal(value, location);
  if (BigInt(value) > BigInt(MAX_UNIVERSAL_ADMISSION_AUTHENTICATED_REQUEST_BYTES)) {
    fail("AUTHENTICATED_ADMISSION_RECEIPT_INVALID", "Authenticated ingress byte length exceeds its closed boundary.", { path: location });
  }
}

function canonicalTimestamp(value, location) {
  pattern(value, CANONICAL_TIMESTAMP, 20, location);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().replace(".000Z", "Z") !== value) {
    fail("AUTHENTICATED_ADMISSION_RECEIPT_INVALID", "Timestamp must be a real canonical UTC instant.", { path: location });
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, message, options) {
  throw new AuthenticatedAdmissionServiceError(code, message, options);
}
