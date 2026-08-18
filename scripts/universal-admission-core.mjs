import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder, types } from "node:util";

import {
  canonicalJson,
  sha256Bytes
} from "../vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs";
import {
  parseBoundedLosslessJson
} from "../vendor/programmable-applicant-validator/scripts/github-public-source-lossless-json.mjs";

export const UNIVERSAL_ADMISSION_SCHEMA_VERSION = "1.0.0";
export const UNIVERSAL_ADMISSION_SCHEMA_ID = "urn:programmable:universal-admission:1.0.0";
export const UNIVERSAL_ADMISSION_KIND = "programmable-universal-admission";
export const MAX_UNIVERSAL_ADMISSION_BYTES = 256 * 1024;
export const MAX_UNIVERSAL_ADMISSION_NODES = 4096;
export const MAX_UNIVERSAL_ADMISSION_ACTOR_BYTES = 64;
export const MAX_UNIVERSAL_ADMISSION_QUEUE_RECORD_BYTES = 4096;
export const MAX_UNIVERSAL_ADMISSION_QUEUE_ROOT_BYTES = 3072;

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength").get;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;
const OBJECT_ID = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)\.[gG][iI][tT](?:\/|$))[^\\\u0000\r\n]+$/u;
const PUBLIC_REPOSITORY_URL = /^https:\/\/[A-Za-z0-9.-]+(?:\/[^\s\u0000\r\n?#]*)?$/u;
const LABEL = /^[^\s\u0000\r\n]+(?:[ \t]+[^\s\u0000\r\n]+)*$/u;
const STATUS = new Set(["declared", "not-applicable", "unknown"]);
const ROUTES = new Set(["none", "programmable-ethereum-mainnet", "other"]);
const STAGES = new Set(["proposal", "prototype", "launch-request"]);
const VALUE_KINDS = new Set(["none", "swap", "fee", "reward", "custody", "other"]);
const EVIDENCE_KINDS = new Set(["source", "test", "observed", "external", "self-reported"]);
const ACTOR_ID = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u;
const QUEUE_RECORD_KIND = "programmable-universal-admission-queue-record";
const QUEUE_RECEIPT_KIND = "programmable-universal-admission-queue-receipt";
const QUEUE_LAYOUT_VERSION = "v1";
const QUEUE_FILE_MODE = 0o600;
const QUEUE_DIRECTORY_MODE = 0o700;
const MAX_UNIVERSAL_ADMISSION_STAGING_FILES = 256;
const STAGING_FILE = /^[0-9]{1,20}\.[0-9a-f]{24}\.tmp$/u;

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
  const buffer = boundedByteCopy(
    bytes,
    MAX_UNIVERSAL_ADMISSION_BYTES,
    "UNIVERSAL_ADMISSION_SIZE_INVALID",
    "Universal admission bytes exceed the closed 256 KiB boundary."
  );
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
  value = snapshotPlainAdmissionData(value);
  const suppliedBytes = snapshotAdmissionValidationBytes(options);
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
  let repositoryUrl;
  try {
    repositoryUrl = new URL(value.source.repositoryUrl);
  } catch {
    repositoryUrl = null;
  }
  if (
    repositoryUrl === null
    || !PUBLIC_REPOSITORY_URL.test(value.source.repositoryUrl)
    || repositoryUrl.protocol !== "https:"
    || repositoryUrl.hostname.length === 0
    || !/^[A-Za-z0-9.-]+$/u.test(repositoryUrl.hostname)
    || repositoryUrl.port.length > 0
    || repositoryUrl.username.length > 0
    || repositoryUrl.password.length > 0
    || repositoryUrl.search.length > 0
    || repositoryUrl.hash.length > 0
    || /[\s\u0000\r\n]/u.test(value.source.repositoryUrl)
  ) {
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

  const canonicalBytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  if (canonicalBytes.length < 2 || canonicalBytes.length > MAX_UNIVERSAL_ADMISSION_BYTES) {
    fail("UNIVERSAL_ADMISSION_SIZE_INVALID", "Universal admission bytes exceed the closed 256 KiB boundary.");
  }
  let bytes = canonicalBytes;
  if (suppliedBytes !== undefined) {
    bytes = suppliedBytes;
    if (!bytes.equals(canonicalBytes)) {
      fail("UNIVERSAL_ADMISSION_BYTES_MISMATCH", "Admission result bytes must be the canonical bytes of the validated value.");
    }
  }

  const unknownCount = countUnknowns(value.disclosure);
  const route = value.application.requestedRoute;
  const routeStatus = route === "programmable-ethereum-mainnet"
    ? "platform-route-pending"
    : route === "other" ? "external-route-disclosed" : "not-selected";
  const analysisPending = unknownCount > 0 || route === "programmable-ethereum-mainnet";
  const status = analysisPending
    ? "ADMITTED_FOR_REVIEW_ANALYSIS_PENDING"
    : "ADMITTED_FOR_REVIEW";
  const report = {
    kind: "programmable-universal-admission-result",
    schemaVersion: UNIVERSAL_ADMISSION_SCHEMA_VERSION,
    status,
    reviewState: analysisPending ? "analysis_pending" : "ready_for_review",
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

function snapshotAdmissionValidationBytes(options) {
  if (options === undefined) return undefined;
  if (options === null || typeof options !== "object" || Array.isArray(options) || types.isProxy(options)) {
    fail("UNIVERSAL_ADMISSION_BYTES_INVALID", "Admission validation options must be a plain data object.");
  }
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(options);
    keys = Reflect.ownKeys(options);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_BYTES_INVALID", "Admission validation options could not be inspected.", { cause: error });
  }
  if (prototype !== Object.prototype || keys.some((key) => typeof key !== "string" || key !== "bytes")) {
    fail("UNIVERSAL_ADMISSION_BYTES_INVALID", "Admission validation options contain unsupported fields.");
  }
  if (!Object.hasOwn(options, "bytes")) return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(options, "bytes");
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_BYTES_INVALID", "Admission byte option could not be inspected.", { cause: error });
  }
  if (
    descriptor === undefined
    || descriptor.get !== undefined
    || descriptor.set !== undefined
    || !Object.hasOwn(descriptor, "value")
  ) {
    fail("UNIVERSAL_ADMISSION_BYTES_INVALID", "Admission bytes must be one bounded data property.");
  }
  return boundedByteCopy(
    descriptor.value,
    MAX_UNIVERSAL_ADMISSION_BYTES,
    "UNIVERSAL_ADMISSION_BYTES_INVALID",
    "Admission bytes must be one bounded data property."
  );
}

function snapshotPlainAdmissionData(input) {
  const ancestors = new WeakSet();
  let nodes = 0;

  const visit = (value, location, depth) => {
    nodes += 1;
    if (nodes > MAX_UNIVERSAL_ADMISSION_NODES || depth > 64) {
      failAt("UNIVERSAL_ADMISSION_NODE_LIMIT", "Admission data exceeds its closed structural boundary.", location);
    }
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || types.isProxy(value)) {
      failAt("UNIVERSAL_ADMISSION_OBJECT_INVALID", "Admission validation accepts only plain JSON data.", location);
    }
    if (ancestors.has(value)) {
      failAt("UNIVERSAL_ADMISSION_OBJECT_INVALID", "Admission validation rejects cyclic object graphs.", location);
    }
    ancestors.add(value);
    if (Array.isArray(value) && value.length > MAX_UNIVERSAL_ADMISSION_NODES) {
      failAt("UNIVERSAL_ADMISSION_NODE_LIMIT", "Admission array exceeds its closed entry boundary.", location);
    }

    let keys;
    let prototype;
    try {
      keys = Reflect.ownKeys(value);
      prototype = Object.getPrototypeOf(value);
    } catch (error) {
      fail("UNIVERSAL_ADMISSION_OBJECT_INVALID", "Admission data could not be inspected as plain data.", { cause: error, path: location });
    }

    if (Array.isArray(value)) {
      if (prototype !== Array.prototype || keys.some((key) => typeof key !== "string")) {
        failAt("UNIVERSAL_ADMISSION_OBJECT_INVALID", "Admission arrays must be ordinary dense arrays.", location);
      }
      const allowedKeys = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
      if (keys.length !== allowedKeys.size || keys.some((key) => !allowedKeys.has(key))) {
        failAt("UNIVERSAL_ADMISSION_OBJECT_INVALID", "Admission arrays must be dense and contain no hidden fields.", location);
      }
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined
          || descriptor.enumerable !== true
          || descriptor.get !== undefined
          || descriptor.set !== undefined
          || !Object.hasOwn(descriptor, "value")
        ) {
          failAt("UNIVERSAL_ADMISSION_OBJECT_INVALID", "Admission arrays reject accessors and sparse entries.", `${location}[${index}]`);
        }
        output.push(visit(descriptor.value, `${location}[${index}]`, depth + 1));
      }
      ancestors.delete(value);
      return output;
    }

    if ((prototype !== Object.prototype && prototype !== null) || keys.some((key) => typeof key !== "string")) {
      failAt("UNIVERSAL_ADMISSION_OBJECT_INVALID", "Admission objects must be ordinary string-keyed data.", location);
    }
    const output = {};
    for (const key of keys) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch (error) {
        fail("UNIVERSAL_ADMISSION_OBJECT_INVALID", "Admission field could not be inspected as plain data.", { cause: error, path: `${location}.${key}` });
      }
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || descriptor.get !== undefined
        || descriptor.set !== undefined
        || !Object.hasOwn(descriptor, "value")
      ) {
        failAt("UNIVERSAL_ADMISSION_OBJECT_INVALID", "Admission objects reject accessors and hidden fields.", `${location}.${key}`);
      }
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: visit(descriptor.value, `${location}.${key}`, depth + 1),
        writable: true
      });
    }
    ancestors.delete(value);
    return output;
  };

  return visit(input, "$", 0);
}

export function digestUniversalAdmission(value) {
  return validateUniversalAdmission(value).sourceDigest;
}

/**
 * Store one already-public canonical envelope in a local content-addressed
 * object store and create one immutable queue marker. The envelope is fully
 * validated before the queue root is inspected or changed. Actor ids are
 * bounded public attribution labels supplied by a trusted ingress; they are
 * never treated as authenticated identities.
 */
export function enqueueUniversalAdmissionBytes({ actorId, bytes, queueRoot }) {
  const envelopeBytes = boundedByteCopy(
    bytes,
    MAX_UNIVERSAL_ADMISSION_BYTES,
    "UNIVERSAL_ADMISSION_SIZE_INVALID",
    "Universal admission bytes exceed the closed 256 KiB boundary."
  );
  const admission = validateUniversalAdmissionBytes(envelopeBytes);
  const boundedActorId = validateQueueActorId(actorId);
  const root = resolveQueueRoot(queueRoot);
  const paths = deriveUniversalAdmissionQueuePaths({ digest: admission.sourceDigest, queueRoot: root });

  const objectDirectory = ensureSecureQueueDirectory(root, paths.objectDirectoryParts);
  const queueDirectory = ensureSecureQueueDirectory(root, paths.queueDirectoryParts);
  assertSecureQueueDirectory(root);

  const objectResult = createImmutableFile({
    bytes: envelopeBytes,
    filePath: path.join(objectDirectory, paths.fileName),
    maximumBytes: MAX_UNIVERSAL_ADMISSION_BYTES,
    mismatchCode: "UNIVERSAL_ADMISSION_QUEUE_CAS_CONFLICT"
  });

  const record = queueRecord({ actorId: boundedActorId, digest: admission.sourceDigest, paths });
  const recordBytes = Buffer.from(`${canonicalJson(record)}\n`, "utf8");
  if (recordBytes.length > MAX_UNIVERSAL_ADMISSION_QUEUE_RECORD_BYTES) {
    fail("UNIVERSAL_ADMISSION_QUEUE_RECORD_SIZE_INVALID", "Queue record exceeds its closed byte boundary.");
  }
  const queueResult = createImmutableFile({
    bytes: recordBytes,
    filePath: path.join(queueDirectory, paths.fileName),
    maximumBytes: MAX_UNIVERSAL_ADMISSION_QUEUE_RECORD_BYTES,
    mismatchCode: null
  });

  const storedRecordBytes = queueResult.storedBytes;
  const storedRecord = validateStoredQueueRecord(storedRecordBytes, { digest: admission.sourceDigest, paths });

  return Object.freeze({
    kind: QUEUE_RECEIPT_KIND,
    schemaVersion: UNIVERSAL_ADMISSION_SCHEMA_VERSION,
    status: queueResult.created ? "QUEUED" : "DUPLICATE",
    idempotencyKey: admission.sourceDigest,
    admissionDigest: admission.sourceDigest,
    caller: Object.freeze({ actorId: boundedActorId, authenticated: false }),
    firstWriter: Object.freeze({ actorId: storedRecord.actor.actorId, authenticated: false }),
    storage: Object.freeze({ objectPath: paths.objectRelativePath, queuePath: paths.queueRelativePath }),
    publicDataOnly: true,
    effects: queueEffects(),
    authority: inertQueueAuthority(),
    integrity: Object.freeze({
      canonicalEnvelopeValidated: true,
      casObjectCreated: objectResult.created,
      queueRecordDigest: sha256Bytes(storedRecordBytes)
    })
  });
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

export function deriveUniversalAdmissionQueuePaths({ digest, queueRoot }) {
  if (typeof digest !== "string" || !SHA256.test(digest)) {
    fail("UNIVERSAL_ADMISSION_QUEUE_DIGEST_INVALID", "Queue digest must be a lowercase sha256 digest.");
  }
  const root = typeof queueRoot === "string" ? queueRoot : "";
  if (Buffer.byteLength(root, "utf8") < 1 || Buffer.byteLength(root, "utf8") > MAX_UNIVERSAL_ADMISSION_QUEUE_ROOT_BYTES) {
    fail("UNIVERSAL_ADMISSION_QUEUE_ROOT_INVALID", "Queue root is outside its closed byte boundary.");
  }
  const hex = digest.slice("sha256:".length);
  const shardA = hex.slice(0, 2);
  const shardB = hex.slice(2, 4);
  const fileName = `${hex}.json`;
  const objectDirectoryParts = Object.freeze([QUEUE_LAYOUT_VERSION, "objects", "sha256", shardA, shardB]);
  const queueDirectoryParts = Object.freeze([QUEUE_LAYOUT_VERSION, "queue", shardA, shardB]);
  return Object.freeze({
    fileName,
    objectDirectoryParts,
    queueDirectoryParts,
    objectRelativePath: objectDirectoryParts.concat(fileName).join("/"),
    queueRelativePath: queueDirectoryParts.concat(fileName).join("/")
  });
}

function queueRecord({ actorId, digest, paths }) {
  return {
    kind: QUEUE_RECORD_KIND,
    schemaVersion: UNIVERSAL_ADMISSION_SCHEMA_VERSION,
    state: "queued",
    idempotencyKey: digest,
    admissionDigest: digest,
    actor: { actorId, authenticated: false },
    storage: { objectPath: paths.objectRelativePath, queuePath: paths.queueRelativePath },
    publicDataOnly: true,
    effects: queueEffects(),
    authority: inertQueueAuthority()
  };
}

function queueEffects() {
  return Object.freeze({
    candidateCodeExecuted: false,
    externalNetworkAccessed: false,
    localFilesystemWritesPerformed: true,
    remoteWritesPerformed: false
  });
}

function inertQueueAuthority() {
  return Object.freeze({
    admissionDecisionGranted: false,
    approvalGranted: false,
    independentAudit: false,
    launchAuthorized: false,
    reviewCompleted: false
  });
}

function validateQueueActorId(value) {
  if (
    typeof value !== "string"
    || Buffer.byteLength(value, "utf8") < 1
    || Buffer.byteLength(value, "utf8") > MAX_UNIVERSAL_ADMISSION_ACTOR_BYTES
    || !ACTOR_ID.test(value)
  ) {
    fail("UNIVERSAL_ADMISSION_QUEUE_ACTOR_INVALID", "Actor id must be a bounded lowercase public attribution label supplied by trusted ingress.");
  }
  return value;
}

function resolveQueueRoot(queueRoot) {
  if (typeof queueRoot !== "string" || !path.isAbsolute(queueRoot)) {
    fail("UNIVERSAL_ADMISSION_QUEUE_ROOT_INVALID", "Queue root must be an existing absolute owner-controlled directory.");
  }
  if (Buffer.byteLength(queueRoot, "utf8") > MAX_UNIVERSAL_ADMISSION_QUEUE_ROOT_BYTES) {
    fail("UNIVERSAL_ADMISSION_QUEUE_ROOT_INVALID", "Queue root is outside its closed byte boundary.");
  }
  let rootStat;
  try {
    rootStat = fs.lstatSync(queueRoot);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_QUEUE_ROOT_INVALID", "Queue root must be an existing absolute owner-controlled directory.", { cause: error });
  }
  if (rootStat.isSymbolicLink()) {
    fail("UNIVERSAL_ADMISSION_QUEUE_ROOT_SYMLINK", "Queue root must not be a symbolic link.");
  }
  assertPrivateDirectoryStat(rootStat, "UNIVERSAL_ADMISSION_QUEUE_ROOT_INVALID");
  let realRoot;
  try {
    realRoot = fs.realpathSync.native(queueRoot);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_QUEUE_ROOT_INVALID", "Queue root could not be resolved.", { cause: error });
  }
  if (Buffer.byteLength(realRoot, "utf8") > MAX_UNIVERSAL_ADMISSION_QUEUE_ROOT_BYTES) {
    fail("UNIVERSAL_ADMISSION_QUEUE_ROOT_INVALID", "Resolved queue root is outside its closed byte boundary.");
  }
  assertSecureQueueDirectory(realRoot);
  return realRoot;
}

function ensureSecureQueueDirectory(root, relativeParts) {
  let current = root;
  for (const part of relativeParts) {
    current = path.join(current, part);
    let created = false;
    try {
      fs.mkdirSync(current, { mode: QUEUE_DIRECTORY_MODE });
      created = true;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        fail("UNIVERSAL_ADMISSION_QUEUE_DIRECTORY_INVALID", "Queue shard directory could not be created.", { cause: error });
      }
    }
    assertSecureQueueDirectory(current);
    if (created) fsyncDirectory(path.dirname(current));
  }
  return current;
}

function assertSecureQueueDirectory(directoryPath) {
  let stat;
  try {
    stat = fs.lstatSync(directoryPath);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_QUEUE_DIRECTORY_INVALID", "Queue directory could not be inspected.", { cause: error });
  }
  if (stat.isSymbolicLink()) {
    fail("UNIVERSAL_ADMISSION_QUEUE_DIRECTORY_SYMLINK", "Queue directories must not be symbolic links.");
  }
  assertPrivateDirectoryStat(stat, "UNIVERSAL_ADMISSION_QUEUE_DIRECTORY_INVALID");
}

function assertPrivateDirectoryStat(stat, code) {
  const ownUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!stat.isDirectory() || (stat.mode & 0o022) !== 0 || (ownUid !== null && stat.uid !== ownUid)) {
    fail(code, "Queue directories must be owner-controlled and not group/world writable.");
  }
}

function createImmutableFile({ bytes, filePath, maximumBytes, mismatchCode }) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maximumBytes) {
    fail("UNIVERSAL_ADMISSION_QUEUE_FILE_SIZE_INVALID", "Queue file bytes are outside their closed boundary.");
  }
  const directoryPath = path.dirname(filePath);
  assertSecureQueueDirectory(directoryPath);
  const stagingRoot = ensureSecureChildDirectory(directoryPath, ".staging");
  const stagingDirectory = ensureSecureChildDirectory(stagingRoot, path.basename(filePath));
  const temporaryPath = path.join(
    stagingDirectory,
    `${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`
  );
  let descriptor = null;
  let created = false;
  let temporaryPresent = false;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollowFlag(),
      QUEUE_FILE_MODE
    );
    temporaryPresent = true;
    fs.writeFileSync(descriptor, bytes);
    fs.fchmodSync(descriptor, 0o400);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    try {
      fs.linkSync(temporaryPath, filePath);
      created = true;
      try {
        fs.unlinkSync(temporaryPath);
        temporaryPresent = false;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        temporaryPresent = false;
      }
      fsyncDirectory(stagingDirectory);
      fsyncDirectory(directoryPath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_QUEUE_WRITE_FAILED", "Immutable queue file creation failed closed.", { cause: error });
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    if (temporaryPresent) {
      try {
        fs.unlinkSync(temporaryPath);
        temporaryPresent = false;
        fsyncDirectory(stagingDirectory);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          fail("UNIVERSAL_ADMISSION_QUEUE_WRITE_FAILED", "Immutable queue temporary file cleanup failed closed.", { cause: error });
        }
      }
    }
  }

  recoverOrphanedTemporaryLink({ filePath, maximumBytes, stagingDirectory });
  const stored = readBoundedRegularFile(filePath, maximumBytes, "UNIVERSAL_ADMISSION_QUEUE_FILE_INVALID");
  if (mismatchCode !== null && !stored.equals(bytes)) {
    fail(mismatchCode, "Existing content-addressed object bytes do not match their digest path.");
  }
  return Object.freeze({ created, filePath, storedBytes: stored });
}

function ensureSecureChildDirectory(parentPath, name) {
  const childPath = path.join(parentPath, name);
  let created = false;
  try {
    fs.mkdirSync(childPath, { mode: QUEUE_DIRECTORY_MODE });
    created = true;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      fail("UNIVERSAL_ADMISSION_QUEUE_DIRECTORY_INVALID", "Queue staging directory could not be created.", { cause: error });
    }
  }
  assertSecureQueueDirectory(childPath);
  if (created) fsyncDirectory(parentPath);
  return childPath;
}

function recoverOrphanedTemporaryLink({ filePath, maximumBytes, stagingDirectory }) {
  let target;
  try {
    target = fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    fail("UNIVERSAL_ADMISSION_QUEUE_FILE_INVALID", "Queue target could not be inspected for bounded crash recovery.", { cause: error });
  }
  if (target.nlink === 1n) return;
  if (!isRecoverablePublishedSnapshot(target, maximumBytes)) {
    fail("UNIVERSAL_ADMISSION_QUEUE_FILE_INVALID", "Queue target has an unsafe link state.");
  }

  let match = null;
  for (const entry of readBoundedStagingEntries(stagingDirectory)) {
    if (!STAGING_FILE.test(entry.name) || !entry.isFile()) {
      fail("UNIVERSAL_ADMISSION_QUEUE_STAGING_INVALID", "Queue staging directory contains an unexpected entry.");
    }
    const candidatePath = path.join(stagingDirectory, entry.name);
    let candidate;
    try {
      candidate = fs.lstatSync(candidatePath, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      fail("UNIVERSAL_ADMISSION_QUEUE_STAGING_INVALID", "Queue staging entry could not be inspected.", { cause: error });
    }
    if (!sameInode(target, candidate)) continue;
    if (match !== null || !sameRecoverablePublishedSnapshot(target, candidate)) {
      fail("UNIVERSAL_ADMISSION_QUEUE_STAGING_INVALID", "Queue target does not have one exact recoverable staging link.");
    }
    match = candidatePath;
  }
  if (match === null) {
    let settled;
    try {
      settled = fs.lstatSync(filePath, { bigint: true });
    } catch (error) {
      fail("UNIVERSAL_ADMISSION_QUEUE_FILE_INVALID", "Queue target disappeared during bounded crash recovery.", { cause: error });
    }
    if (isSafeQueueFileSnapshot(settled, maximumBytes)) return;
    fail("UNIVERSAL_ADMISSION_QUEUE_FILE_INVALID", "Queue target hardlink is not owned by its bounded staging directory.");
  }
  try {
    fs.unlinkSync(match);
    fsyncDirectory(stagingDirectory);
    fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      fail("UNIVERSAL_ADMISSION_QUEUE_WRITE_FAILED", "Orphaned queue staging link could not be recovered.", { cause: error });
    }
  }
  const recovered = fs.lstatSync(filePath, { bigint: true });
  if (!isSafeQueueFileSnapshot(recovered, maximumBytes)) {
    fail("UNIVERSAL_ADMISSION_QUEUE_FILE_INVALID", "Recovered queue target did not settle to one immutable link.");
  }
}

function readBoundedStagingEntries(stagingDirectory) {
  const entries = [];
  let directory = null;
  try {
    assertSecureQueueDirectory(stagingDirectory);
    directory = fs.opendirSync(stagingDirectory);
    while (true) {
      const entry = directory.readSync();
      if (entry === null) break;
      entries.push(entry);
      if (entries.length > MAX_UNIVERSAL_ADMISSION_STAGING_FILES) {
        fail("UNIVERSAL_ADMISSION_QUEUE_STAGING_LIMIT", "Per-digest staging directory exceeds its closed entry limit.");
      }
    }
    return entries;
  } catch (error) {
    if (error instanceof UniversalAdmissionError) throw error;
    fail("UNIVERSAL_ADMISSION_QUEUE_STAGING_INVALID", "Queue staging directory could not be read safely.", { cause: error });
  } finally {
    if (directory !== null) {
      try { directory.closeSync(); } catch {}
    }
  }
}

function isRecoverablePublishedSnapshot(snapshot, maximumBytes) {
  const ownUid = typeof process.getuid === "function" ? BigInt(process.getuid()) : snapshot.uid;
  return snapshot.isFile()
    && snapshot.uid === ownUid
    && snapshot.nlink === 2n
    && (snapshot.mode & 0o111n) === 0n
    && (snapshot.mode & 0o222n) === 0n
    && snapshot.size >= 1n
    && snapshot.size <= BigInt(maximumBytes);
}

function sameRecoverablePublishedSnapshot(left, right) {
  return sameInode(left, right)
    && left.uid === right.uid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size;
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function readBoundedRegularFile(filePath, maximumBytes, code) {
  let descriptor = null;
  try {
    const initial = fs.lstatSync(filePath, { bigint: true });
    if (!isSafeQueueFileSnapshot(initial, maximumBytes)) {
      fail(code, "Queue target must be one bounded, non-executable, read-only, singly linked regular file.");
    }
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollowFlag() | nonblockingFlag() | closeOnExecFlag());
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileSnapshot(initial, before) || !isSafeQueueFileSnapshot(before, maximumBytes)) {
      fail(code, "Queue target changed before its bounded read.");
    }
    const bytes = readBoundedDescriptor(descriptor, maximumBytes, code);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileSnapshot(before, after) || !isSafeQueueFileSnapshot(after, maximumBytes) || BigInt(bytes.length) !== after.size) {
      fail(code, "Queue target changed during its bounded read.");
    }
    return Buffer.from(bytes);
  } catch (error) {
    if (error instanceof UniversalAdmissionError) throw error;
    fail(code, "Queue target could not be read without following links.", { cause: error });
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function isSafeQueueFileSnapshot(snapshot, maximumBytes) {
  return snapshot.isFile()
    && snapshot.nlink === 1n
    && (snapshot.mode & 0o111n) === 0n
    && (snapshot.mode & 0o222n) === 0n
    && snapshot.size >= 1n
    && snapshot.size <= BigInt(maximumBytes);
}

function readBoundedDescriptor(descriptor, maximumBytes, code) {
  const buffer = Buffer.allocUnsafe(maximumBytes + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const count = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
    if (count === 0) break;
    offset += count;
  }
  if (offset > maximumBytes) {
    fail(code, "Queue target exceeded its byte limit during the bounded read.");
  }
  return buffer.subarray(0, offset);
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function validateStoredQueueRecord(bytes, { digest, paths }) {
  let textValue;
  let value;
  try {
    textValue = decoder.decode(bytes);
    value = JSON.parse(textValue);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_QUEUE_RECORD_INVALID", "Stored queue record must be canonical UTF-8 JSON.", { cause: error });
  }
  if (!Buffer.from(`${canonicalJson(value)}\n`, "utf8").equals(bytes)) {
    fail("UNIVERSAL_ADMISSION_QUEUE_RECORD_INVALID", "Stored queue record must be canonical UTF-8 JSON.");
  }
  const expectedKeys = ["actor", "admissionDigest", "authority", "effects", "idempotencyKey", "kind", "publicDataOnly", "schemaVersion", "state", "storage"];
  if (!value || typeof value !== "object" || Array.isArray(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(expectedKeys)) {
    fail("UNIVERSAL_ADMISSION_QUEUE_RECORD_INVALID", "Stored queue record has an unexpected shape.");
  }
  const expected = queueRecord({ actorId: validateQueueActorId(value.actor?.actorId), digest, paths });
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail("UNIVERSAL_ADMISSION_QUEUE_RECORD_INVALID", "Stored queue record does not bind the expected digest and shard paths.");
  }
  return value;
}

function fsyncDirectory(directoryPath) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY | directoryFlag() | noFollowFlag());
    fs.fsyncSync(descriptor);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_QUEUE_WRITE_FAILED", "Queue directory durability sync failed closed.", { cause: error });
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function noFollowFlag() {
  return Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
}

function nonblockingFlag() {
  return Number.isInteger(fs.constants.O_NONBLOCK) ? fs.constants.O_NONBLOCK : 0;
}

function closeOnExecFlag() {
  return Number.isInteger(fs.constants.O_CLOEXEC) ? fs.constants.O_CLOEXEC : 0;
}

function directoryFlag() {
  return Number.isInteger(fs.constants.O_DIRECTORY) ? fs.constants.O_DIRECTORY : 0;
}

function validateSurface(value, location) {
  object(value, location, ["id", "kind", "sourceRefs", "status", "summary"]);
  id(value.id, `${location}.id`); label(value.kind, `${location}.kind`); enumValue(value.status, STATUS, `${location}.status`); text(value.summary, `${location}.summary`, 1, 1000); sourceRefs(value.sourceRefs, `${location}.sourceRefs`);
}

function validateValueFlow(value, location) {
  object(value, location, ["basis", "from", "id", "kind", "sourceRefs", "status", "to"]);
  id(value.id, `${location}.id`); enumValue(value.kind, VALUE_KINDS, `${location}.kind`); enumValue(value.status, STATUS, `${location}.status`);
  text(value.from, `${location}.from`, 1, 160); text(value.to, `${location}.to`, 1, 160); text(value.basis, `${location}.basis`, 1, 320); sourceRefs(value.sourceRefs, `${location}.sourceRefs`);
  if (value.kind === "none" && value.status === "declared" && (value.from !== "none" || value.to !== "none")) failAt("UNIVERSAL_ADMISSION_NONE_FLOW_INVALID", "A declared no-flow entry must use from/to=none.", location);
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
    if (Array.isArray(current)) {
      if (current.length + stack.length + count > MAX_UNIVERSAL_ADMISSION_NODES) fail("UNIVERSAL_ADMISSION_NODE_LIMIT", "Admission JSON exceeds the bounded node budget.");
      for (let index = 0; index < current.length; index += 1) stack.push(current[index]);
    } else if (current && typeof current === "object") {
      for (const key in current) {
        if (!Object.hasOwn(current, key)) continue;
        if (stack.length + count >= MAX_UNIVERSAL_ADMISSION_NODES) fail("UNIVERSAL_ADMISSION_NODE_LIMIT", "Admission JSON exceeds the bounded node budget.");
        stack.push(current[key]);
      }
    }
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
function text(value, location, minimum, maximum) { const length = typeof value === "string" ? Array.from(value).length : 0; if (typeof value !== "string" || length < minimum || length > maximum || /[\u0000\r\n]/u.test(value)) failAt("UNIVERSAL_ADMISSION_TEXT_INVALID", "Text is outside its bounded printable range.", location); }
function label(value, location) { text(value, location, 1, 120); if (!LABEL.test(value)) failAt("UNIVERSAL_ADMISSION_LABEL_INVALID", "Label must contain visible text without leading or trailing whitespace.", location); }
function id(value, location) { if (typeof value !== "string" || !ID.test(value) || value.length > 80) failAt("UNIVERSAL_ADMISSION_ID_INVALID", "Identifier is not a bounded slug.", location); }
function boundedDecimal(value, location, maximumLength) { if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value) || value.length > maximumLength) failAt("UNIVERSAL_ADMISSION_REVISION_INVALID", "Revision must be a bounded positive decimal string.", location); }
function objectId(value, location) { if (typeof value !== "string" || !OBJECT_ID.test(value)) failAt("UNIVERSAL_ADMISSION_OBJECT_ID_INVALID", "Expected a lowercase 40-character Git object id.", location); }
function sha256(value, location) { if (typeof value !== "string" || !SHA256.test(value)) failAt("UNIVERSAL_ADMISSION_SHA256_INVALID", "Expected a sha256: digest.", location); }
function safePath(value, location) { text(value, location, 1, 256); if (!SAFE_PATH.test(value)) failAt("UNIVERSAL_ADMISSION_PATH_INVALID", "Path traversal, absolute paths, and control characters are forbidden.", location); }
function list(value, location, minimum, maximum) { if (!Array.isArray(value) || value.length < minimum || value.length > maximum) failAt("UNIVERSAL_ADMISSION_LIST_INVALID", `Expected an array with ${minimum}..${maximum} entries.`, location); }
function fail(code, message, options) { throw new UniversalAdmissionError(code, message, options); }
function failAt(code, message, location) { throw new UniversalAdmissionError(code, message, { path: location }); }
