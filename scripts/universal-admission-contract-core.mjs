import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder, types } from "node:util";

import { parseBoundedLosslessJson } from "../vendor/programmable-applicant-validator/scripts/github-public-source-lossless-json.mjs";
import { canonicalJson } from "../vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs";

export const UNIVERSAL_ADMISSION_CONTRACT_PATH = ".programmable/universal-admission-contract.v1.json";
export const UNIVERSAL_ADMISSION_CONTRACT_CORE_PATH = "scripts/universal-admission-contract-core.mjs";
export const UNIVERSAL_ADMISSION_CONTRACT_PUBLISHER_PATH = "scripts/universal-admission-contract.mjs";
export const UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH = "intake/schemas/universal-admission-contract-v1.schema.json";
export const UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID = "urn:programmable:universal-admission-contract:1.0.0";
export const UNIVERSAL_ADMISSION_CONTRACT_KIND = "programmable-universal-admission-contract";
export const UNIVERSAL_ADMISSION_CONTRACT_VERSION = "1.0.0";

export const UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_BINDINGS = Object.freeze([
  Object.freeze({
    id: "admission",
    path: "intake/schemas/universal-admission-v1.schema.json",
    schemaId: "urn:programmable:universal-admission:1.0.0"
  }),
  Object.freeze({
    id: "command",
    path: "intake/schemas/universal-admission-command-v1.schema.json",
    schemaId: "urn:programmable:universal-admission-command:1.0.0"
  }),
  Object.freeze({
    id: "event-receipt",
    path: "intake/schemas/universal-admission-event-receipt-v1.schema.json",
    schemaId: "urn:programmable:universal-admission-event-receipt:1.0.0"
  }),
  Object.freeze({
    id: "runtime-policy",
    path: "intake/schemas/universal-admission-runtime-policy-v1.schema.json",
    schemaId: "urn:programmable:universal-admission-runtime-policy:1.0.0"
  }),
  Object.freeze({
    id: "snapshot",
    path: "intake/schemas/universal-admission-snapshot-v1.schema.json",
    schemaId: "urn:programmable:universal-admission-snapshot:1.0.0"
  }),
  Object.freeze({
    id: "transport-receipt",
    path: "intake/schemas/authenticated-admission-transport-receipt-v1.schema.json",
    schemaId: "urn:programmable:authenticated-admission-transport-receipt:1.0.0"
  }),
  Object.freeze({
    id: "trust",
    path: "intake/schemas/universal-admission-trust-v1.schema.json",
    schemaId: "urn:programmable:universal-admission-trust:1.0.0"
  }),
  Object.freeze({
    id: "worker-result",
    path: "intake/schemas/universal-admission-worker-result-v1.schema.json",
    schemaId: "urn:programmable:universal-admission-worker-result:1.0.0"
  })
]);

export const UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS = Object.freeze([
  "scripts/universal-admission-command-core.mjs",
  "scripts/universal-admission-core.mjs",
  "scripts/universal-admission-protocol-core.mjs",
  "scripts/universal-admission-service-core.mjs",
  "scripts/universal-admission-sqlite-store.mjs",
  "scripts/universal-admission-sqlite.mjs",
  "vendor/programmable-applicant-validator/scripts/github-public-source-lossless-json.mjs",
  "vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs"
]);

const MAXIMUM_CONTRACT_BYTES = 256 * 1024;
const MAXIMUM_BOUND_ARTIFACT_BYTES = 4 * 1024 * 1024;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
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
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
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

export class UniversalAdmissionContractError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "UniversalAdmissionContractError";
    this.code = code;
  }
}

export function canonicalUniversalAdmissionContractBytes(contract) {
  const validated = validateUniversalAdmissionContractV1(contract);
  return Buffer.from(`${canonicalJson(validated)}\n`, "utf8");
}

export function parseUniversalAdmissionContractBytesV1(bytes) {
  const buffer = boundedByteCopy(bytes, MAXIMUM_CONTRACT_BYTES, "UNIVERSAL_ADMISSION_CONTRACT_BYTES_INVALID");
  let source;
  let value;
  try {
    source = UTF8_DECODER.decode(buffer);
    parseBoundedLosslessJson(source);
    value = JSON.parse(source);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_JSON_INVALID", "Universal Admission contract must be bounded duplicate-free UTF-8 JSON.", error);
  }
  const contract = validateUniversalAdmissionContractV1(value);
  if (!buffer.equals(Buffer.from(`${canonicalJson(contract)}\n`, "utf8"))) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_NONCANONICAL", "Universal Admission contract must be canonical JSON followed by exactly one LF.");
  }
  return Object.freeze({
    contract,
    sha256: digestBytes(buffer)
  });
}

export function buildUniversalAdmissionContractV1({ repositoryRoot } = {}) {
  const root = requireRepositoryRoot(repositoryRoot);
  const contractSchema = artifactBinding(root, UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH);
  verifySchemaId(contractSchema.bytes, UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID, UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH);
  const contractCore = artifactBinding(root, UNIVERSAL_ADMISSION_CONTRACT_CORE_PATH);
  const contractPublisher = artifactBinding(root, UNIVERSAL_ADMISSION_CONTRACT_PUBLISHER_PATH);
  const schemas = UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_BINDINGS.map(({ id, path: schemaPath, schemaId }) => {
    const binding = artifactBinding(root, schemaPath);
    verifySchemaId(binding.bytes, schemaId, schemaPath);
    return Object.freeze({ id, path: schemaPath, schemaId, sha256: binding.sha256 });
  });
  const referenceArtifacts = UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS.map((artifactPath) => {
    const binding = artifactBinding(root, artifactPath);
    return Object.freeze({ path: artifactPath, sha256: binding.sha256 });
  });

  return validateUniversalAdmissionContractV1({
    $schema: UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID,
    authority: inertAuthority(),
    contractCore: {
      path: UNIVERSAL_ADMISSION_CONTRACT_CORE_PATH,
      sha256: contractCore.sha256
    },
    contractPublisher: {
      path: UNIVERSAL_ADMISSION_CONTRACT_PUBLISHER_PATH,
      sha256: contractPublisher.sha256
    },
    contractSchema: {
      path: UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH,
      sha256: contractSchema.sha256
    },
    deployment: {
      audience: null,
      enabled: false,
      endpoint: null,
      state: "reference-only-disabled",
      trustSnapshot: null
    },
    kind: UNIVERSAL_ADMISSION_CONTRACT_KIND,
    minimumClientProtocolVersion: "1.0.0",
    publicDataOnly: true,
    referenceImplementation: {
      artifacts: referenceArtifacts,
      distributed: false,
      enabled: false,
      kind: "node-sqlite-single-host-v1",
      referenceOnly: true,
      topology: "single-host-single-writer"
    },
    schemas,
    schemaVersion: UNIVERSAL_ADMISSION_CONTRACT_VERSION,
    transport: {
      authentication: "detached-ed25519",
      id: "authenticated-admission-queue-v1",
      operation: "enqueue"
    },
    trustedRepository: {
      defaultBranch: "main",
      numericId: "1320171831"
    }
  });
}

export function writeUniversalAdmissionContractV1({ repositoryRoot } = {}) {
  const root = requireRepositoryRoot(repositoryRoot);
  const contract = buildUniversalAdmissionContractV1({ repositoryRoot: root });
  const bytes = canonicalUniversalAdmissionContractBytes(contract);
  const destination = resolveRepositoryPath(root, UNIVERSAL_ADMISSION_CONTRACT_PATH);
  const directory = path.dirname(destination);
  let directoryStatus;
  let destinationStatus;
  try {
    directoryStatus = fs.lstatSync(directory);
    destinationStatus = fs.lstatSync(destination);
  } catch (error) {
    if (error?.code !== "ENOENT" || directoryStatus === undefined) {
      fail("UNIVERSAL_ADMISSION_CONTRACT_WRITE_INVALID", "Universal Admission contract destination is unavailable.", error);
    }
    destinationStatus = null;
  }
  if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink()) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_WRITE_INVALID", "Universal Admission contract parent must be a real directory.");
  }
  if (destinationStatus !== null && (!destinationStatus.isFile() || destinationStatus.isSymbolicLink())) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_WRITE_INVALID", "Universal Admission contract destination must be absent or a regular non-symlink file.");
  }

  const temporaryPath = path.join(
    directory,
    `.universal-admission-contract.v1.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`
  );
  let descriptor;
  let renamed = false;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW ?? 0),
      0o644
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const written = fs.fstatSync(descriptor, { bigint: true });
    if (!written.isFile() || written.size !== BigInt(bytes.length)) {
      fail("UNIVERSAL_ADMISSION_CONTRACT_WRITE_INVALID", "Universal Admission contract temporary write was incomplete.");
    }
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, destination);
    renamed = true;
  } catch (error) {
    if (error instanceof UniversalAdmissionContractError) throw error;
    fail("UNIVERSAL_ADMISSION_CONTRACT_WRITE_INVALID", "Universal Admission contract could not be written atomically.", error);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (!renamed) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return deepFreeze({
    bytesWritten: bytes.length,
    contract,
    path: UNIVERSAL_ADMISSION_CONTRACT_PATH,
    sha256: digestBytes(bytes)
  });
}

export function verifyUniversalAdmissionContractV1({ repositoryRoot } = {}) {
  const root = requireRepositoryRoot(repositoryRoot);
  const expected = buildUniversalAdmissionContractV1({ repositoryRoot: root });
  const contractPath = resolveRepositoryPath(root, UNIVERSAL_ADMISSION_CONTRACT_PATH);
  const parsed = parseUniversalAdmissionContractBytesV1(
    readRegularFile(contractPath, MAXIMUM_CONTRACT_BYTES, "UNIVERSAL_ADMISSION_CONTRACT_FILE_INVALID")
  );
  if (canonicalJson(parsed.contract) !== canonicalJson(expected)) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_STALE", "Published Universal Admission contract does not bind the current protected schema and reference bytes.");
  }
  return deepFreeze({
    authority: parsed.contract.authority,
    contractCore: parsed.contract.contractCore,
    contractPublisher: parsed.contract.contractPublisher,
    contractSchema: parsed.contract.contractSchema,
    deployment: parsed.contract.deployment,
    kind: parsed.contract.kind,
    minimumClientProtocolVersion: parsed.contract.minimumClientProtocolVersion,
    path: UNIVERSAL_ADMISSION_CONTRACT_PATH,
    publicDataOnly: parsed.contract.publicDataOnly,
    referenceImplementation: parsed.contract.referenceImplementation,
    schemas: parsed.contract.schemas,
    schemaVersion: parsed.contract.schemaVersion,
    sha256: parsed.sha256,
    transport: parsed.contract.transport,
    trustedRepository: parsed.contract.trustedRepository
  });
}

export function validateUniversalAdmissionContractV1(value) {
  value = snapshotPlainContractData(value);
  object(value, "$", [
    "$schema",
    "authority",
    "contractCore",
    "contractPublisher",
    "contractSchema",
    "deployment",
    "kind",
    "minimumClientProtocolVersion",
    "publicDataOnly",
    "referenceImplementation",
    "schemas",
    "schemaVersion",
    "transport",
    "trustedRepository"
  ]);
  exact(value.$schema, UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID, "$.$schema");
  exact(value.kind, UNIVERSAL_ADMISSION_CONTRACT_KIND, "$.kind");
  exact(value.schemaVersion, UNIVERSAL_ADMISSION_CONTRACT_VERSION, "$.schemaVersion");
  exact(value.minimumClientProtocolVersion, "1.0.0", "$.minimumClientProtocolVersion");
  exact(value.publicDataOnly, true, "$.publicDataOnly");

  artifact(value.contractCore, "$.contractCore", {
    path: UNIVERSAL_ADMISSION_CONTRACT_CORE_PATH
  });

  artifact(value.contractPublisher, "$.contractPublisher", {
    path: UNIVERSAL_ADMISSION_CONTRACT_PUBLISHER_PATH
  });

  artifact(value.contractSchema, "$.contractSchema", {
    path: UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH
  });

  object(value.trustedRepository, "$.trustedRepository", ["defaultBranch", "numericId"]);
  exact(value.trustedRepository.defaultBranch, "main", "$.trustedRepository.defaultBranch");
  exact(value.trustedRepository.numericId, "1320171831", "$.trustedRepository.numericId");

  object(value.transport, "$.transport", ["authentication", "id", "operation"]);
  exact(value.transport.authentication, "detached-ed25519", "$.transport.authentication");
  exact(value.transport.id, "authenticated-admission-queue-v1", "$.transport.id");
  exact(value.transport.operation, "enqueue", "$.transport.operation");

  object(value.deployment, "$.deployment", ["audience", "enabled", "endpoint", "state", "trustSnapshot"]);
  exact(value.deployment.audience, null, "$.deployment.audience");
  exact(value.deployment.enabled, false, "$.deployment.enabled");
  exact(value.deployment.endpoint, null, "$.deployment.endpoint");
  exact(value.deployment.state, "reference-only-disabled", "$.deployment.state");
  exact(value.deployment.trustSnapshot, null, "$.deployment.trustSnapshot");

  if (!Array.isArray(value.schemas) || value.schemas.length !== UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_BINDINGS.length) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", "$.schemas must contain the exact closed schema binding set.");
  }
  for (const [index, expected] of UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_BINDINGS.entries()) {
    const observed = value.schemas[index];
    object(observed, `$.schemas[${index}]`, ["id", "path", "schemaId", "sha256"]);
    exact(observed.id, expected.id, `$.schemas[${index}].id`);
    exact(observed.path, expected.path, `$.schemas[${index}].path`);
    exact(observed.schemaId, expected.schemaId, `$.schemas[${index}].schemaId`);
    digest(observed.sha256, `$.schemas[${index}].sha256`);
  }

  object(value.referenceImplementation, "$.referenceImplementation", [
    "artifacts", "distributed", "enabled", "kind", "referenceOnly", "topology"
  ]);
  exact(value.referenceImplementation.distributed, false, "$.referenceImplementation.distributed");
  exact(value.referenceImplementation.enabled, false, "$.referenceImplementation.enabled");
  exact(value.referenceImplementation.kind, "node-sqlite-single-host-v1", "$.referenceImplementation.kind");
  exact(value.referenceImplementation.referenceOnly, true, "$.referenceImplementation.referenceOnly");
  exact(value.referenceImplementation.topology, "single-host-single-writer", "$.referenceImplementation.topology");
  if (
    !Array.isArray(value.referenceImplementation.artifacts)
    || value.referenceImplementation.artifacts.length !== UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS.length
  ) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", "$.referenceImplementation.artifacts must contain the exact closed reference artifact set.");
  }
  for (const [index, expectedPath] of UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS.entries()) {
    artifact(value.referenceImplementation.artifacts[index], `$.referenceImplementation.artifacts[${index}]`, { path: expectedPath });
  }

  object(value.authority, "$.authority", AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) exact(value.authority[key], false, `$.authority.${key}`);
  return deepFreeze(value);
}

function inertAuthority() {
  return Object.fromEntries(AUTHORITY_KEYS.map((key) => [key, false]));
}

function verifySchemaId(bytes, expectedSchemaId, schemaPath) {
  let value;
  try {
    const source = UTF8_DECODER.decode(bytes);
    parseBoundedLosslessJson(source);
    value = JSON.parse(source);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_INVALID", `${schemaPath} is not duplicate-free UTF-8 JSON.`, error);
  }
  if (value?.$id !== expectedSchemaId) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID_MISMATCH", `${schemaPath} does not publish the expected schema id.`);
  }
}

function artifactBinding(repositoryRoot, relativePath) {
  const bytes = readRegularFile(
    resolveRepositoryPath(repositoryRoot, relativePath),
    MAXIMUM_BOUND_ARTIFACT_BYTES,
    "UNIVERSAL_ADMISSION_CONTRACT_ARTIFACT_INVALID"
  );
  return Object.freeze({ bytes, sha256: digestBytes(bytes) });
}

function artifact(value, location, { path: expectedPath }) {
  object(value, location, ["path", "sha256"]);
  exact(value.path, expectedPath, `${location}.path`);
  digest(value.sha256, `${location}.sha256`);
}

function snapshotPlainContractData(value) {
  const seen = new WeakSet();
  let nodes = 0;

  const visit = (current, location, depth) => {
    nodes += 1;
    if (nodes > 4096 || depth > 32) {
      fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} exceeds the closed contract structure boundary.`);
    }
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current !== "object" || types.isProxy(current)) {
      fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must contain only inert JSON data.`);
    }
    if (seen.has(current)) {
      fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must not contain cycles or shared mutable aliases.`);
    }
    seen.add(current);

    if (Array.isArray(current)) return snapshotArray(current, location, depth, visit);
    return snapshotObject(current, location, depth, visit);
  };

  const snapshot = visit(value, "$", 0);
  let byteLength;
  try {
    byteLength = Buffer.byteLength(`${canonicalJson(snapshot)}\n`, "utf8");
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", "Contract data is not canonical public JSON.", error);
  }
  if (byteLength > MAXIMUM_CONTRACT_BYTES) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", "Contract data exceeds the closed byte boundary.");
  }
  return snapshot;
}

function snapshotObject(value, location, depth, visit) {
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} could not be inspected as inert data.`, error);
  }
  if (
    (prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== "string")
  ) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must be a plain string-keyed object.`);
  }

  const snapshot = {};
  for (const key of keys) {
    const descriptor = dataDescriptor(value, key, `${location}.${key}`);
    if (descriptor.enumerable !== true) {
      fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location}.${key} must not be hidden.`);
    }
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: visit(descriptor.value, `${location}.${key}`, depth + 1),
      writable: true
    });
  }
  return snapshot;
}

function snapshotArray(value, location, depth, visit) {
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} could not be inspected as an inert array.`, error);
  }
  if (prototype !== Array.prototype || keys.some((key) => typeof key !== "string")) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must be an ordinary array.`);
  }
  const lengthDescriptor = dataDescriptor(value, "length", `${location}.length`);
  if (
    !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
    || lengthDescriptor.value > 4096
  ) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} exceeds the dense-array boundary.`);
  }
  const expectedKeys = Array.from({ length: lengthDescriptor.value }, (_, index) => String(index));
  if (
    keys.length !== expectedKeys.length + 1
    || keys[keys.length - 1] !== "length"
    || expectedKeys.some((key, index) => keys[index] !== key)
  ) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must be a dense array without hidden fields.`);
  }

  const snapshot = [];
  for (const key of expectedKeys) {
    const descriptor = dataDescriptor(value, key, `${location}[${key}]`);
    if (descriptor.enumerable !== true) {
      fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location}[${key}] must be enumerable data.`);
    }
    snapshot.push(visit(descriptor.value, `${location}[${key}]`, depth + 1));
  }
  return snapshot;
}

function dataDescriptor(value, key, location) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} could not be inspected as inert data.`, error);
  }
  if (
    descriptor === undefined
    || descriptor.get !== undefined
    || descriptor.set !== undefined
    || !Object.hasOwn(descriptor, "value")
  ) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must be an inert data property.`);
  }
  return descriptor;
}

function requireRepositoryRoot(repositoryRoot) {
  if (typeof repositoryRoot !== "string" || !path.isAbsolute(repositoryRoot)) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_ARGUMENTS_INVALID", "repositoryRoot must be an absolute path.");
  }
  let status;
  try {
    status = fs.lstatSync(repositoryRoot);
  } catch (error) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_ARGUMENTS_INVALID", "repositoryRoot is unavailable.", error);
  }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_ARGUMENTS_INVALID", "repositoryRoot must be a real directory.");
  }
  return path.resolve(repositoryRoot);
}

function resolveRepositoryPath(repositoryRoot, relativePath) {
  if (
    typeof relativePath !== "string"
    || relativePath.length < 1
    || relativePath.length > 512
    || relativePath.includes("\\")
    || relativePath.includes("\0")
    || relativePath.includes("\n")
    || relativePath.includes("\r")
    || path.posix.normalize(relativePath) !== relativePath
    || path.posix.isAbsolute(relativePath)
    || relativePath === "."
    || relativePath.startsWith("../")
    || relativePath === ".git"
    || relativePath.startsWith(".git/")
  ) fail("UNIVERSAL_ADMISSION_CONTRACT_PATH_INVALID", `${relativePath} is not a safe repository-relative path.`);
  const resolved = path.resolve(repositoryRoot, ...relativePath.split("/"));
  if (!resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_PATH_INVALID", `${relativePath} escapes the repository root.`);
  }
  return resolved;
}

function readRegularFile(absolutePath, maximumBytes, code) {
  let before;
  try {
    before = fs.lstatSync(absolutePath, { bigint: true });
  } catch (error) {
    fail(code, `${absolutePath} is unavailable.`, error);
  }
  if (
    !before.isFile()
    || before.isSymbolicLink()
    || before.size < 1n
    || before.size > BigInt(maximumBytes)
  ) {
    fail(code, `${absolutePath} must be a bounded regular non-symlink file.`);
  }
  let descriptor;
  try {
    descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileSnapshot(before, opened)) fail(code, `${absolutePath} changed while it was opened.`);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (BigInt(bytes.length) !== opened.size || !sameFileSnapshot(opened, after)) {
      fail(code, `${absolutePath} changed while it was read.`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof UniversalAdmissionContractError) throw error;
    fail(code, `${absolutePath} could not be read.`, error);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function sameFileSnapshot(left, right) {
  return left.isFile()
    && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function boundedByteCopy(value, maximumBytes, code) {
  // Native proxy/brand checks and the prebound root %TypedArray% accessors
  // inspect internal slots without consulting caller-owned properties.
  if (
    value === null
    || typeof value !== "object"
    || types.isProxy(value)
    || !types.isUint8Array(value)
  ) {
    fail(code, "Input must be one non-proxy bounded byte sequence.");
  }
  const before = rootUint8ArrayRegion(value, code);
  if (before.byteLength < 2 || before.byteLength > maximumBytes) {
    fail(code, "Input exceeds its closed byte boundary.");
  }

  let snapshot;
  try {
    const safeView = new ROOT_UINT8_ARRAY(before.buffer, before.byteOffset, before.byteLength);
    snapshot = Buffer.from(safeView);
  } catch (error) {
    fail(code, "Input bytes could not be snapshotted exactly once.", error);
  }
  const after = rootUint8ArrayRegion(value, code);
  if (
    after.buffer !== before.buffer
    || after.byteOffset !== before.byteOffset
    || after.byteLength !== before.byteLength
    || snapshot.byteLength !== before.byteLength
    || snapshot.byteLength < 2
    || snapshot.byteLength > maximumBytes
  ) {
    fail(code, "Input backing region changed while it was being snapshotted.");
  }
  return snapshot;
}

function rootUint8ArrayRegion(value, code) {
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
      fail(code, "Input has an invalid backing byte region.");
    }
    return { buffer, byteLength, byteOffset };
  } catch (error) {
    if (error instanceof UniversalAdmissionContractError) throw error;
    fail(code, "Input backing byte region could not be inspected.", error);
  }
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function digest(value, location) {
  if (!SHA256.test(value ?? "")) fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must be a lowercase SHA-256 binding.`);
}

function object(value, location, expectedKeys) {
  if (!isPlainObject(value)) fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must be a plain object.`);
  const observed = Object.keys(value).sort(compareUtf8);
  const expected = [...expectedKeys].sort(compareUtf8);
  if (observed.length !== expected.length || observed.some((key, index) => key !== expected[index])) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must contain the exact closed key set.`);
  }
}

function exact(observed, expected, location) {
  if (observed !== expected) fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must equal ${JSON.stringify(expected)}.`);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function fail(code, message, cause) {
  throw new UniversalAdmissionContractError(code, message, cause === undefined ? undefined : { cause });
}
