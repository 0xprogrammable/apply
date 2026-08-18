import crypto from "node:crypto";
import { TextDecoder, types } from "node:util";

import {
  canonicalJson,
  sha256Bytes
} from "../vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs";
import {
  parseBoundedLosslessJson
} from "../vendor/programmable-applicant-validator/scripts/github-public-source-lossless-json.mjs";
import {
  MAX_UNIVERSAL_ADMISSION_BYTES,
  validateUniversalAdmissionBytes
} from "./universal-admission-core.mjs";

export const UNIVERSAL_ADMISSION_COMMAND_SCHEMA_ID = "urn:programmable:universal-admission-command:1.0.0";
export const UNIVERSAL_ADMISSION_COMMAND_SCHEMA_VERSION = "1.0.0";
export const UNIVERSAL_ADMISSION_COMMAND_KIND = "programmable-universal-admission-command";
export const UNIVERSAL_ADMISSION_COMMAND_OPERATION = "enqueue";
export const UNIVERSAL_ADMISSION_COMMAND_SIGNATURE_ALGORITHM = "Ed25519";
export const UNIVERSAL_ADMISSION_TRUST_SCHEMA_ID = "urn:programmable:universal-admission-trust:1.0.0";
export const UNIVERSAL_ADMISSION_TRUST_KIND = "programmable-universal-admission-trust";
export const UNIVERSAL_ADMISSION_TRUST_SCHEMA_VERSION = "1.0.0";
export const UNIVERSAL_ADMISSION_PRODUCTION_AUDIENCE = "urn:programmable:submit-launch:universal-admission:production:v1";
export const MAX_UNIVERSAL_ADMISSION_COMMAND_BYTES = 4 * 1024;
export const MAX_UNIVERSAL_ADMISSION_COMMAND_NODES = 128;
export const MAX_UNIVERSAL_ADMISSION_TRUST_BYTES = 1024 * 1024;
export const MAX_UNIVERSAL_ADMISSION_TRUST_KEYS = 2048;
// Seven snapshot nodes plus the maximum 17-node key shape (two roles and
// revokedAt). This keeps the runtime boundary exactly aligned with maxItems.
export const MAX_UNIVERSAL_ADMISSION_TRUST_NODES = 7 + (MAX_UNIVERSAL_ADMISSION_TRUST_KEYS * 17);
export const MAX_UNIVERSAL_ADMISSION_COMMAND_LIFETIME_MS = 5 * 60 * 1000;
export const MAX_UNIVERSAL_ADMISSION_COMMAND_CLOCK_SKEW_MS = 30 * 1000;

const SIGNING_DOMAIN = Buffer.from("Programmable Universal Admission Command V1\n", "utf8");
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength").get;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const KEY_ID = SHA256;
const REQUEST_ID = /^[0-9a-f]{32}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REVISION = /^[1-9][0-9]{0,30}$/u;
const AUDIENCE = /^urn:programmable:submit-launch:universal-admission:[a-z0-9]+(?:-[a-z0-9]+)*:v1$/u;
const CANONICAL_TIMESTAMP = /^(?:[0-9]{4})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/u;
const JWK_X = /^[A-Za-z0-9_-]{43}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const ROLES = new Set(["applicant-submitter", "tenant-ingress"]);
const trustedSnapshotMetadata = new WeakMap();
const verifiedReceiptPrincipalContexts = new WeakMap();

export class UniversalAdmissionCommandError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "UniversalAdmissionCommandError";
    this.code = code;
    this.path = options?.path ?? null;
  }
}

/**
 * Produce the only command representation accepted by the verifier. The
 * detached signature is not part of these bytes.
 */
export function canonicalUniversalAdmissionCommandBytes(command) {
  const snapshot = snapshotPlainCommandData(command);
  validateCommand(snapshot);
  const bytes = Buffer.from(`${canonicalJson(snapshot)}\n`, "utf8");
  if (bytes.length < 2 || bytes.length > MAX_UNIVERSAL_ADMISSION_COMMAND_BYTES) {
    fail("UNIVERSAL_ADMISSION_COMMAND_SIZE_INVALID", "Universal Admission command exceeds its closed 4 KiB boundary.");
  }
  return bytes;
}

export function parseUniversalAdmissionCommandBytes(bytes) {
  const snapshot = snapshotCommandBytes(bytes);
  return parseUniversalAdmissionCommandSnapshot(snapshot);
}

function parseUniversalAdmissionCommandSnapshot(snapshot) {
  const value = parseCanonicalSnapshot({
    bytes: snapshot,
    maximumBytes: MAX_UNIVERSAL_ADMISSION_COMMAND_BYTES,
    maximumNodes: MAX_UNIVERSAL_ADMISSION_COMMAND_NODES,
    prefix: "UNIVERSAL_ADMISSION_COMMAND"
  });
  validateCommand(value);
  return deepFreeze(value);
}

export function universalAdmissionCommandSigningBytes(commandBytes) {
  const snapshot = snapshotCommandBytes(commandBytes);
  parseUniversalAdmissionCommandSnapshot(snapshot);
  return Buffer.concat([SIGNING_DOMAIN, snapshot]);
}

/**
 * Derive the immutable id used by a protected trust record. The digest is of
 * the raw 32-byte Ed25519 public key, not of caller-shaped metadata.
 */
export function universalAdmissionPublicKeyId(publicKey) {
  const { rawPublicKey } = normalizePublicKey(publicKey, "UNIVERSAL_ADMISSION_TRUST_KEY_INVALID");
  return sha256Bytes(rawPublicKey);
}

/**
 * Convert only an exact receipt object returned by this module into the small
 * authenticated-principal context accepted by the outer queue service.
 * Receipt-shaped caller data and structured clones have no provenance.
 */
export function authenticatedPrincipalContextFromCommandVerification(receipt) {
  const context = verifiedReceiptPrincipalContexts.get(receipt);
  if (context === undefined) {
    fail("UNIVERSAL_ADMISSION_COMMAND_RECEIPT_PROVENANCE_INVALID", "Authenticated principal context requires the exact verified receipt object.");
  }
  return context;
}

/**
 * Compile a canonical, public-only trust snapshot against an exact protected
 * digest and monotonic epoch. The returned object carries module-private
 * provenance; caller-shaped objects cannot be used by the verifier.
 */
export function compileUniversalAdmissionTrustSnapshotBytes({
  bytes,
  expectedAudience,
  expectedDigest,
  minimumEpoch
}) {
  validateAudience(expectedAudience, "UNIVERSAL_ADMISSION_TRUST_AUDIENCE_INVALID", "$.audience");
  digest(expectedDigest, "UNIVERSAL_ADMISSION_TRUST_PIN_INVALID", "$.expectedDigest");
  positiveDecimal(minimumEpoch, 31, "UNIVERSAL_ADMISSION_TRUST_EPOCH_INVALID", "$.minimumEpoch");

  const trustBytes = boundedByteCopy(
    bytes,
    MAX_UNIVERSAL_ADMISSION_TRUST_BYTES,
    "UNIVERSAL_ADMISSION_TRUST_SIZE_INVALID",
    "Trust snapshot exceeds its closed 1 MiB boundary."
  );
  const observedDigest = sha256Bytes(trustBytes);
  if (observedDigest !== expectedDigest) {
    fail("UNIVERSAL_ADMISSION_TRUST_DIGEST_MISMATCH", "Trust snapshot bytes do not match the protected digest pin.");
  }
  const value = parseCanonicalSnapshot({
    bytes: trustBytes,
    maximumBytes: MAX_UNIVERSAL_ADMISSION_TRUST_BYTES,
    maximumNodes: MAX_UNIVERSAL_ADMISSION_TRUST_NODES,
    prefix: "UNIVERSAL_ADMISSION_TRUST"
  });
  validateTrustSnapshot(value);
  if (value.audience !== expectedAudience) {
    failAt("UNIVERSAL_ADMISSION_TRUST_AUDIENCE_INVALID", "Trust snapshot audience does not match the protected service audience.", "$.audience");
  }
  if (BigInt(value.epoch) < BigInt(minimumEpoch)) {
    failAt("UNIVERSAL_ADMISSION_TRUST_EPOCH_ROLLBACK", "Trust snapshot epoch is below the protected monotonic floor.", "$.epoch");
  }

  const keys = new Map();
  let previousKeyId = null;
  for (const [index, record] of value.keys.entries()) {
    const location = `$.keys[${index}]`;
    const compiled = compileTrustKey(record, location);
    if (previousKeyId !== null && previousKeyId >= compiled.keyId) {
      failAt("UNIVERSAL_ADMISSION_TRUST_KEY_ORDER_INVALID", "Trust keys must be unique and strictly sorted by keyId.", `${location}.keyId`);
    }
    previousKeyId = compiled.keyId;
    keys.set(compiled.keyId, compiled);
  }

  const snapshot = deepFreeze({
    kind: "programmable-universal-admission-compiled-trust",
    schemaVersion: UNIVERSAL_ADMISSION_TRUST_SCHEMA_VERSION,
    audience: value.audience,
    epoch: value.epoch,
    digest: observedDigest,
    keyCount: keys.size,
    publicDataOnly: true
  });
  trustedSnapshotMetadata.set(snapshot, Object.freeze({ keys }));
  return snapshot;
}

/**
 * Authenticate and bind one enqueue command. This function performs no queue,
 * filesystem, network, approval, review, or launch action.
 */
export function verifyUniversalAdmissionEnqueueCommand({
  admissionBytes,
  commandBytes,
  now = new Date(),
  signature,
  trustSnapshot
}) {
  const trust = trustedSnapshotMetadata.get(trustSnapshot);
  if (trust === undefined) {
    fail("UNIVERSAL_ADMISSION_TRUST_PROVENANCE_INVALID", "Verifier requires a compiled protected trust snapshot.");
  }
  const instant = normalizeNow(now);
  const canonicalCommandBytes = snapshotCommandBytes(commandBytes);
  const command = parseUniversalAdmissionCommandSnapshot(canonicalCommandBytes);
  const signatureBytes = decodeSignature(signature);
  const key = trust.keys.get(command.principal.keyId);
  if (key === undefined) {
    failAt("UNIVERSAL_ADMISSION_COMMAND_KEY_UNKNOWN", "Command keyId is absent from the protected trust snapshot.", "$.principal.keyId");
  }

  const signingBytes = Buffer.concat([SIGNING_DOMAIN, canonicalCommandBytes]);
  if (!crypto.verify(null, signingBytes, key.publicKey, signatureBytes)) {
    fail("UNIVERSAL_ADMISSION_COMMAND_SIGNATURE_INVALID", "Detached Ed25519 command signature is invalid.");
  }
  if (command.audience !== trustSnapshot.audience) {
    failAt("UNIVERSAL_ADMISSION_COMMAND_AUDIENCE_FORBIDDEN", "Signed command audience does not match the protected service audience.", "$.audience");
  }
  if (command.principal.tenantId !== key.tenantId) {
    failAt("UNIVERSAL_ADMISSION_COMMAND_TENANT_FORBIDDEN", "Signed tenant is not authorized by the protected key record.", "$.principal.tenantId");
  }
  if (command.principal.subjectId !== key.subjectId) {
    failAt("UNIVERSAL_ADMISSION_COMMAND_SUBJECT_FORBIDDEN", "Signed subject is not authorized by the protected key record.", "$.principal.subjectId");
  }
  if (!key.roles.has(command.principal.role)) {
    failAt("UNIVERSAL_ADMISSION_COMMAND_ROLE_FORBIDDEN", "Signed role is not authorized by the protected key record.", "$.principal.role");
  }
  if (!key.operations.has(command.operation)) {
    failAt("UNIVERSAL_ADMISSION_COMMAND_OPERATION_FORBIDDEN", "Signed operation is not authorized by the protected key record.", "$.operation");
  }

  const issuedAtMs = canonicalTimestamp(command.issuedAt, "UNIVERSAL_ADMISSION_COMMAND_TIME_INVALID", "$.issuedAt");
  const expiresAtMs = canonicalTimestamp(command.expiresAt, "UNIVERSAL_ADMISSION_COMMAND_TIME_INVALID", "$.expiresAt");
  if (expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > MAX_UNIVERSAL_ADMISSION_COMMAND_LIFETIME_MS) {
    fail("UNIVERSAL_ADMISSION_COMMAND_LIFETIME_INVALID", "Command lifetime must be positive and no longer than five minutes.");
  }
  if (issuedAtMs > instant.ms + MAX_UNIVERSAL_ADMISSION_COMMAND_CLOCK_SKEW_MS) {
    failAt("UNIVERSAL_ADMISSION_COMMAND_NOT_YET_VALID", "Command issuedAt is too far in the future.", "$.issuedAt");
  }
  if (expiresAtMs <= instant.ms) {
    failAt("UNIVERSAL_ADMISSION_COMMAND_EXPIRED", "Command expiry has passed.", "$.expiresAt");
  }
  if (key.revokedAtMs !== null && instant.ms >= key.revokedAtMs) {
    failAt("UNIVERSAL_ADMISSION_COMMAND_KEY_REVOKED", "Protected trust record revocation is effective.", "$.principal.keyId");
  }
  if (
    instant.ms < key.notBeforeMs
    || instant.ms >= key.notAfterMs
    || issuedAtMs < key.notBeforeMs
    || issuedAtMs >= key.notAfterMs
  ) {
    failAt("UNIVERSAL_ADMISSION_COMMAND_KEY_NOT_ACTIVE", "Protected trust key is not active for this command and verification instant.", "$.principal.keyId");
  }

  const boundedAdmissionBytes = boundedByteCopy(
    admissionBytes,
    MAX_UNIVERSAL_ADMISSION_BYTES,
    "UNIVERSAL_ADMISSION_COMMAND_ADMISSION_SIZE_INVALID",
    "Admission envelope exceeds its closed 256 KiB boundary."
  );
  let admissionResult;
  try {
    admissionResult = validateUniversalAdmissionBytes(boundedAdmissionBytes);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_COMMAND_ADMISSION_INVALID", "Admission envelope failed the existing canonical Universal Admission contract.", { cause: error });
  }
  if (admissionResult.sourceDigest !== command.target.admissionDigest) {
    failAt("UNIVERSAL_ADMISSION_COMMAND_ADMISSION_DIGEST_MISMATCH", "Admission bytes do not match the signed target digest.", "$.target.admissionDigest");
  }
  const admission = JSON.parse(decoder.decode(boundedAdmissionBytes));
  if (
    admission.application.id !== command.target.applicationId
    || admission.application.revision !== command.target.revision
  ) {
    fail("UNIVERSAL_ADMISSION_COMMAND_APPLICATION_BINDING_MISMATCH", "Admission application id or revision does not match the signed target.");
  }

  const receipt = deepFreeze({
    kind: "programmable-universal-admission-command-verification-receipt",
    schemaVersion: UNIVERSAL_ADMISSION_COMMAND_SCHEMA_VERSION,
    status: "AUTHENTICATED_FOR_ENQUEUE",
    operation: UNIVERSAL_ADMISSION_COMMAND_OPERATION,
    requestId: command.requestId,
    commandDigest: sha256Bytes(signingBytes),
    target: structuredClone(command.target),
    authentication: {
      signerAuthenticated: true,
      authenticationMethod: UNIVERSAL_ADMISSION_COMMAND_SIGNATURE_ALGORITHM,
      assurance: command.principal.role === "tenant-ingress" ? "gateway-key" : "configured-subject-key",
      audience: trustSnapshot.audience,
      tenantId: key.tenantId,
      subjectId: key.subjectId,
      role: command.principal.role,
      keyId: key.keyId,
      trustEpoch: trustSnapshot.epoch,
      trustSnapshotDigest: trustSnapshot.digest,
      keyRecordDigest: key.recordDigest,
      verifiedAt: instant.canonical
    },
    publicDataOnly: true,
    effects: {
      candidateCodeExecuted: false,
      externalNetworkAccessed: false,
      localFilesystemWritesPerformed: false,
      remoteWritesPerformed: false
    },
    authority: {
      admissionDecisionGranted: false,
      approvalGranted: false,
      independentAudit: false,
      launchAuthorized: false,
      repositoryOwnershipProven: false,
      reviewCompleted: false,
      safetyGuaranteed: false
    }
  });
  const principalContext = deepFreeze({
    kind: "programmable-authenticated-principal-context",
    schemaVersion: UNIVERSAL_ADMISSION_COMMAND_SCHEMA_VERSION,
    authenticated: true,
    authorityId: key.keyId,
    audience: trustSnapshot.audience,
    tenantId: key.tenantId,
    subjectId: key.subjectId
  });
  verifiedReceiptPrincipalContexts.set(receipt, principalContext);
  return receipt;
}

function validateCommand(value) {
  object(value, "$", [
    "$schema", "audience", "expiresAt", "issuedAt", "kind", "operation", "principal",
    "requestId", "schemaVersion", "signatureAlgorithm", "target"
  ]);
  exact(value.$schema, UNIVERSAL_ADMISSION_COMMAND_SCHEMA_ID, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.$schema");
  exact(value.kind, UNIVERSAL_ADMISSION_COMMAND_KIND, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.kind");
  exact(value.schemaVersion, UNIVERSAL_ADMISSION_COMMAND_SCHEMA_VERSION, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.schemaVersion");
  exact(value.signatureAlgorithm, UNIVERSAL_ADMISSION_COMMAND_SIGNATURE_ALGORITHM, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.signatureAlgorithm");
  exact(value.operation, UNIVERSAL_ADMISSION_COMMAND_OPERATION, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.operation");
  validateAudience(value.audience, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.audience");
  pattern(value.requestId, REQUEST_ID, 32, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.requestId");
  canonicalTimestamp(value.issuedAt, "UNIVERSAL_ADMISSION_COMMAND_TIME_INVALID", "$.issuedAt");
  canonicalTimestamp(value.expiresAt, "UNIVERSAL_ADMISSION_COMMAND_TIME_INVALID", "$.expiresAt");

  object(value.principal, "$.principal", ["keyId", "role", "subjectId", "tenantId"]);
  pattern(value.principal.keyId, KEY_ID, 71, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.principal.keyId");
  slug(value.principal.tenantId, 64, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.principal.tenantId");
  slug(value.principal.subjectId, 80, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.principal.subjectId");
  if (typeof value.principal.role !== "string" || !ROLES.has(value.principal.role)) {
    failAt("UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "Command role is outside the closed enqueue-role vocabulary.", "$.principal.role");
  }

  object(value.target, "$.target", ["admissionDigest", "applicationId", "capacityPolicySha256", "revision"]);
  digest(value.target.admissionDigest, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.target.admissionDigest");
  slug(value.target.applicationId, 80, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.target.applicationId");
  digest(value.target.capacityPolicySha256, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.target.capacityPolicySha256");
  pattern(value.target.revision, REVISION, 31, "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "$.target.revision");
}

function validateTrustSnapshot(value) {
  object(value, "$", ["$schema", "audience", "epoch", "keys", "kind", "schemaVersion"]);
  exact(value.$schema, UNIVERSAL_ADMISSION_TRUST_SCHEMA_ID, "UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID", "$.$schema");
  exact(value.kind, UNIVERSAL_ADMISSION_TRUST_KIND, "UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID", "$.kind");
  exact(value.schemaVersion, UNIVERSAL_ADMISSION_TRUST_SCHEMA_VERSION, "UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID", "$.schemaVersion");
  validateAudience(value.audience, "UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID", "$.audience");
  positiveDecimal(value.epoch, 31, "UNIVERSAL_ADMISSION_TRUST_EPOCH_INVALID", "$.epoch");
  if (!Array.isArray(value.keys) || value.keys.length < 1 || value.keys.length > MAX_UNIVERSAL_ADMISSION_TRUST_KEYS) {
    failAt("UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID", "Trust snapshot must contain 1..2048 public key records.", "$.keys");
  }
}

function compileTrustKey(record, location) {
  object(record, location, [
    "algorithm", "keyId", "notAfter", "notBefore", "operations", "publicKey", "roles", "subjectId", "tenantId"
  ], ["revokedAt"]);
  exact(record.algorithm, UNIVERSAL_ADMISSION_COMMAND_SIGNATURE_ALGORITHM, "UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID", `${location}.algorithm`);
  pattern(record.keyId, KEY_ID, 71, "UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID", `${location}.keyId`);
  slug(record.tenantId, 64, "UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID", `${location}.tenantId`);
  slug(record.subjectId, 80, "UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID", `${location}.subjectId`);
  const roles = sortedClosedList(record.roles, ROLES, 1, 2, "UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID", `${location}.roles`);
  const operations = sortedClosedList(record.operations, new Set([UNIVERSAL_ADMISSION_COMMAND_OPERATION]), 1, 1, "UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID", `${location}.operations`);
  const notBeforeMs = canonicalTimestamp(record.notBefore, "UNIVERSAL_ADMISSION_TRUST_TIME_INVALID", `${location}.notBefore`);
  const notAfterMs = canonicalTimestamp(record.notAfter, "UNIVERSAL_ADMISSION_TRUST_TIME_INVALID", `${location}.notAfter`);
  if (notAfterMs <= notBeforeMs) {
    failAt("UNIVERSAL_ADMISSION_TRUST_TIME_INVALID", "Trust key notAfter must be later than notBefore.", `${location}.notAfter`);
  }
  const revokedAtMs = record.revokedAt === undefined
    ? null
    : canonicalTimestamp(record.revokedAt, "UNIVERSAL_ADMISSION_TRUST_TIME_INVALID", `${location}.revokedAt`);

  object(record.publicKey, `${location}.publicKey`, ["crv", "kty", "x"]);
  exact(record.publicKey.kty, "OKP", "UNIVERSAL_ADMISSION_TRUST_KEY_INVALID", `${location}.publicKey.kty`);
  exact(record.publicKey.crv, "Ed25519", "UNIVERSAL_ADMISSION_TRUST_KEY_INVALID", `${location}.publicKey.crv`);
  pattern(record.publicKey.x, JWK_X, 43, "UNIVERSAL_ADMISSION_TRUST_KEY_INVALID", `${location}.publicKey.x`);
  const { publicKey, rawPublicKey } = normalizePublicKey(record.publicKey, "UNIVERSAL_ADMISSION_TRUST_KEY_INVALID");
  const derivedKeyId = sha256Bytes(rawPublicKey);
  if (derivedKeyId !== record.keyId) {
    failAt("UNIVERSAL_ADMISSION_TRUST_KEY_ID_INVALID", "Trust keyId does not match the raw Ed25519 public key.", `${location}.keyId`);
  }

  return Object.freeze({
    keyId: record.keyId,
    tenantId: record.tenantId,
    subjectId: record.subjectId,
    roles: new Set(roles),
    operations: new Set(operations),
    notBeforeMs,
    notAfterMs,
    revokedAtMs,
    publicKey,
    recordDigest: sha256Bytes(Buffer.from(`${canonicalJson(record)}\n`, "utf8"))
  });
}

function normalizePublicKey(value, code) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "d")) {
    fail(code, "Protected trust material must contain a public Ed25519 key only.");
  }
  let publicKey;
  try {
    publicKey = value instanceof crypto.KeyObject
      ? value
      : crypto.createPublicKey({ key: value, format: "jwk" });
  } catch (error) {
    fail(code, "Protected trust material contains an invalid Ed25519 public key.", { cause: error });
  }
  if (publicKey.type !== "public" || publicKey.asymmetricKeyType !== "ed25519") {
    fail(code, "Protected trust material must contain an Ed25519 public key.");
  }
  let jwk;
  try {
    jwk = publicKey.export({ format: "jwk" });
  } catch (error) {
    fail(code, "Ed25519 public key could not be exported for immutable key-id derivation.", { cause: error });
  }
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    fail(code, "Protected trust material is not a canonical Ed25519 JWK.");
  }
  const rawPublicKey = decodeBase64Url(jwk.x, 32, code, "Ed25519 public key x must be canonical unpadded base64url.");
  return { publicKey, rawPublicKey };
}

function decodeSignature(value) {
  if (typeof value !== "string" || !SIGNATURE.test(value)) {
    fail("UNIVERSAL_ADMISSION_COMMAND_SIGNATURE_ENCODING_INVALID", "Detached Ed25519 signature must be canonical unpadded base64url.");
  }
  return decodeBase64Url(value, 64, "UNIVERSAL_ADMISSION_COMMAND_SIGNATURE_ENCODING_INVALID", "Detached Ed25519 signature must contain exactly 64 bytes.");
}

function decodeBase64Url(value, expectedBytes, code, message) {
  let bytes;
  try {
    bytes = Buffer.from(value, "base64url");
  } catch (error) {
    fail(code, message, { cause: error });
  }
  if (bytes.length !== expectedBytes || bytes.toString("base64url") !== value) {
    fail(code, message);
  }
  return bytes;
}

function parseCanonicalSnapshot({ bytes, maximumBytes, maximumNodes, prefix }) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > maximumBytes) {
    fail(`${prefix}_SIZE_INVALID`, "Canonical JSON bytes exceed their closed boundary.");
  }
  let source;
  let lossless;
  let value;
  try {
    source = decoder.decode(bytes);
    lossless = parseBoundedLosslessJson(source);
    value = JSON.parse(source);
  } catch (error) {
    fail(`${prefix}_JSON_INVALID`, "Bytes must be duplicate-free UTF-8 JSON.", { cause: error });
  }
  if (canonicalJson(lossless) !== canonicalJson(value)) {
    fail(`${prefix}_JSON_INVALID`, "JSON numbers use an unsupported representation.");
  }
  const expected = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  if (!bytes.equals(expected)) {
    fail(`${prefix}_JSON_NONCANONICAL`, "JSON bytes must be compact canonical JSON followed by one LF.");
  }
  countNodes(value, maximumNodes, `${prefix}_NODE_LIMIT`);
  return value;
}

function snapshotCommandBytes(value) {
  return boundedByteCopy(
    value,
    MAX_UNIVERSAL_ADMISSION_COMMAND_BYTES,
    "UNIVERSAL_ADMISSION_COMMAND_SIZE_INVALID",
    "Universal Admission command exceeds its closed 4 KiB boundary."
  );
}

function snapshotPlainCommandData(value) {
  const seen = new WeakSet();
  let nodes = 0;

  const visit = (current, location, depth) => {
    nodes += 1;
    if (nodes > MAX_UNIVERSAL_ADMISSION_COMMAND_NODES || depth > 16) {
      fail("UNIVERSAL_ADMISSION_COMMAND_NODE_LIMIT", "Command object exceeds its closed structural boundary.", { path: location });
    }
    if (typeof current === "string" || typeof current === "boolean" || current === null) return current;
    if (typeof current !== "object" || Array.isArray(current) || types.isProxy(current)) {
      fail("UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "Command builder accepts only plain JSON object data.", { path: location });
    }
    if (seen.has(current)) {
      fail("UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "Command builder rejects cycles and shared mutable aliases.", { path: location });
    }
    seen.add(current);

    let keys;
    let prototype;
    try {
      keys = Reflect.ownKeys(current);
      prototype = Object.getPrototypeOf(current);
    } catch (error) {
      fail("UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "Command object could not be inspected as plain data.", { cause: error, path: location });
    }
    if (prototype !== Object.prototype || keys.some((key) => typeof key !== "string")) {
      fail("UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "Command builder accepts only ordinary string-keyed objects.", { path: location });
    }

    const output = {};
    for (const key of keys) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key);
      } catch (error) {
        fail("UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "Command field could not be inspected as plain data.", { cause: error, path: `${location}.${key}` });
      }
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || descriptor.get !== undefined
        || descriptor.set !== undefined
        || !Object.hasOwn(descriptor, "value")
      ) {
        fail("UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID", "Command builder rejects accessors and hidden fields.", { path: `${location}.${key}` });
      }
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: visit(descriptor.value, `${location}.${key}`, depth + 1),
        writable: true
      });
    }
    return output;
  };

  return visit(value, "$", 0);
}

function boundedByteCopy(value, maximumBytes, code, message) {
  if (!(value instanceof Uint8Array) || types.isProxy(value)) fail(code, message);
  let arrayBuffer;
  let byteLength;
  let byteOffset;
  try {
    arrayBuffer = Reflect.apply(typedArrayBuffer, value, []);
    byteLength = Reflect.apply(typedArrayByteLength, value, []);
    byteOffset = Reflect.apply(typedArrayByteOffset, value, []);
  } catch (error) {
    fail(code, message, { cause: error });
  }
  if (byteLength < 2 || byteLength > maximumBytes) fail(code, message);
  let snapshot;
  try {
    snapshot = Buffer.from(new Uint8Array(arrayBuffer, byteOffset, byteLength));
  } catch (error) {
    fail(code, message, { cause: error });
  }
  if (snapshot.length !== byteLength || snapshot.length < 2 || snapshot.length > maximumBytes) fail(code, message);
  return snapshot;
}

function countNodes(value, maximum, code) {
  let count = 0;
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    count += 1;
    if (count > maximum) fail(code, "JSON exceeds its closed node boundary.");
    if (Array.isArray(current)) {
      for (const entry of current) stack.push(entry);
    } else if (current !== null && typeof current === "object") {
      for (const key of Object.keys(current)) stack.push(current[key]);
    }
  }
}

function normalizeNow(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    fail("UNIVERSAL_ADMISSION_COMMAND_CLOCK_INVALID", "Verifier clock must be a valid Date.");
  }
  const ms = value.getTime();
  const canonical = new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
  return { ms, canonical };
}

function canonicalTimestamp(value, code, location) {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP.test(value)) {
    failAt(code, "Timestamp must be canonical UTC ISO-8601 with whole seconds.", location);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().replace(".000Z", "Z") !== value) {
    failAt(code, "Timestamp must be a real canonical UTC instant.", location);
  }
  return parsed.getTime();
}

function validateAudience(value, code, location) {
  pattern(value, AUDIENCE, 160, code, location);
}

function sortedClosedList(value, allowed, minimum, maximum, code, location) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    failAt(code, "Array is outside its closed entry boundary.", location);
  }
  let previous = null;
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || !allowed.has(entry)) {
      failAt(code, "Array entry is outside the closed vocabulary.", `${location}[${index}]`);
    }
    if (previous !== null && previous >= entry) {
      failAt(code, "Array entries must be unique and strictly sorted.", `${location}[${index}]`);
    }
    previous = entry;
  }
  return value;
}

function object(value, location, required, optional = []) {
  const code = location.startsWith("$.keys") || required.includes("keys")
    ? "UNIVERSAL_ADMISSION_TRUST_SCHEMA_INVALID"
    : "UNIVERSAL_ADMISSION_COMMAND_SCHEMA_INVALID";
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    failAt(code, "Expected a closed object.", location);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      failAt(code, `Unexpected field ${key}.`, `${location}.${key}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      failAt(code, `Missing field ${key}.`, `${location}.${key}`);
    }
  }
}

function exact(value, expected, code, location) {
  if (value !== expected) failAt(code, `Expected ${expected}.`, location);
}

function pattern(value, expression, maximumBytes, code, location) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maximumBytes || !expression.test(value)) {
    failAt(code, "String is outside its closed canonical format.", location);
  }
}

function slug(value, maximumBytes, code, location) {
  pattern(value, SLUG, maximumBytes, code, location);
}

function digest(value, code, location) {
  pattern(value, SHA256, 71, code, location);
}

function positiveDecimal(value, maximumLength, code, location) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value) || value.length > maximumLength) {
    failAt(code, "Expected a bounded positive decimal string.", location);
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, message, options) {
  throw new UniversalAdmissionCommandError(code, message, options);
}

function failAt(code, message, location) {
  throw new UniversalAdmissionCommandError(code, message, { path: location });
}
