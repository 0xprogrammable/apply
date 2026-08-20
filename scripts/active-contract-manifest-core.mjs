const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const ENCODED_SEPARATOR_PATTERN = /%2f|%5c/iu;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:\//iu;
const CONTRACT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export const ACTIVE_CONTRACT_MANIFEST_V1 = manifestContract({
  maximumArtifacts: 16,
  maximumArtifactsPerRole: 4,
  schemaVersion: "1.0.0"
});

export const ACTIVE_CONTRACT_MANIFEST_V2 = manifestContract({
  maximumArtifacts: 128,
  maximumArtifactsPerRole: 32,
  schemaVersion: "2.0.0"
});

export function validateActiveContractManifest(value, options = {}) {
  if (!isPlainObject(value)) throw new TypeError("active contract manifest must be an object");
  if (
    value.$schema === ACTIVE_CONTRACT_MANIFEST_V1.schema
    && value.schemaVersion === ACTIVE_CONTRACT_MANIFEST_V1.schemaVersion
  ) {
    return validateManifest(value, options, ACTIVE_CONTRACT_MANIFEST_V1);
  }
  if (
    value.$schema === ACTIVE_CONTRACT_MANIFEST_V2.schema
    && value.schemaVersion === ACTIVE_CONTRACT_MANIFEST_V2.schemaVersion
  ) {
    return validateManifest(value, options, ACTIVE_CONTRACT_MANIFEST_V2);
  }
  throw new TypeError("active contract manifest version is unsupported");
}

export function validateActiveContractManifestV1(value, options = {}) {
  return validateManifest(value, options, ACTIVE_CONTRACT_MANIFEST_V1);
}

export function validateActiveContractManifestV2(value, options = {}) {
  return validateManifest(value, options, ACTIVE_CONTRACT_MANIFEST_V2);
}

function manifestContract({ maximumArtifacts, maximumArtifactsPerRole, schemaVersion }) {
  return Object.freeze({
    schema: `urn:programmable:active-contract-manifest:${schemaVersion}`,
    schemaVersion,
    kind: "programmable-active-contract",
    roles: Object.freeze(["workflow", "validator", "package", "policy"]),
    maximumArtifactsPerRole,
    maximumArtifacts
  });
}

function validateManifest(value, options, contract) {
  if (!isPlainObject(value)) throw new TypeError("active contract manifest must be an object");
  const { defaultBranch } = options;
  assertExactKeys(
    value,
    ["$schema", "schemaVersion", "kind", "contractId", "defaultBranch", "artifacts"],
    "active contract manifest"
  );
  if (value.$schema !== contract.schema) {
    throw new TypeError("active contract manifest $schema is unsupported");
  }
  if (value.schemaVersion !== contract.schemaVersion) {
    throw new TypeError("active contract manifest schemaVersion is unsupported");
  }
  if (value.kind !== contract.kind) {
    throw new TypeError("active contract manifest kind is unsupported");
  }
  if (!CONTRACT_ID.test(value.contractId ?? "") || value.contractId.length > 128) {
    throw new TypeError("active contract manifest contractId must be a bounded lowercase slug");
  }
  const normalizedBranch = normalizeDefaultBranch(value.defaultBranch, contract);
  if (defaultBranch !== undefined && normalizedBranch !== defaultBranch) {
    throw new TypeError("active contract manifest defaultBranch does not match the repository default branch");
  }
  if (!isPlainObject(value.artifacts)) throw new TypeError("active contract manifest artifacts must be an object");
  assertExactKeys(value.artifacts, contract.roles, "active contract manifest artifacts");

  const paths = new Set();
  let artifactCount = 0;
  const artifacts = {};
  for (const role of contract.roles) {
    const records = value.artifacts[role];
    if (
      !Array.isArray(records)
      || records.length === 0
      || records.length > contract.maximumArtifactsPerRole
    ) {
      const maximum = contract === ACTIVE_CONTRACT_MANIFEST_V1
        ? "four"
        : String(contract.maximumArtifactsPerRole);
      throw new TypeError(`active contract manifest ${role} must contain between one and ${maximum} artifacts`);
    }
    artifacts[role] = records.map((record, index) => {
      if (!isPlainObject(record)) throw new TypeError(`active contract manifest ${role}[${index}] must be an object`);
      assertExactKeys(record, ["path", "sha256"], `active contract manifest ${role}[${index}]`);
      const artifactPath = normalizeRepositoryPath(record.path, `${role}[${index}].path`);
      if (paths.has(artifactPath)) throw new TypeError("active contract manifest artifact paths must be unique");
      paths.add(artifactPath);
      if (!SHA256.test(record.sha256 ?? "")) {
        throw new TypeError(`active contract manifest ${role}[${index}].sha256 is invalid`);
      }
      artifactCount += 1;
      return Object.freeze({ path: artifactPath, sha256: record.sha256 });
    });
    Object.freeze(artifacts[role]);
  }
  if (artifactCount > contract.maximumArtifacts) {
    throw new TypeError("active contract manifest contains too many artifacts");
  }
  return deepFreeze({
    $schema: value.$schema,
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    contractId: value.contractId,
    defaultBranch: normalizedBranch,
    artifacts
  });
}

function normalizeRepositoryPath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || Buffer.byteLength(value, "utf8") > 1024
    || value.normalize("NFC") !== value
    || hasUnpairedSurrogate(value)
    || value.startsWith("/")
    || WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
    || value.endsWith("/")
    || value.includes("\\")
    || CONTROL_OR_BIDI_PATTERN.test(value)
    || ENCODED_SEPARATOR_PATTERN.test(value)
  ) {
    throw new TypeError(`${label} must be a canonical bounded repository path`);
  }
  const segments = value.split("/");
  if (
    segments.length > 24
    || segments.some((segment) => (
      segment.length === 0
      || segment === "."
      || segment === ".."
      || segment.toLowerCase() === ".git"
    ))
  ) {
    throw new TypeError(`${label} must be a canonical bounded repository path`);
  }
  return value;
}

function normalizeDefaultBranch(value, contract) {
  const length = contract === ACTIVE_CONTRACT_MANIFEST_V2
    ? [...(typeof value === "string" ? value : "")].length
    : value?.length;
  if (
    typeof value !== "string"
    || value.length === 0
    || length > 255
    || CONTROL_OR_BIDI_PATTERN.test(value)
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("//")
    || value.includes("..")
    || /[\\ ~^:?*[\]]/u.test(value)
    || value.endsWith(".")
    || value.endsWith(".lock")
  ) {
    throw new TypeError("repository default branch is invalid");
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  if (!sameKeys(value, expected)) throw new TypeError(`${label} has unexpected fields`);
}

function sameKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function hasUnpairedSurrogate(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return true;
  }
  return false;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
