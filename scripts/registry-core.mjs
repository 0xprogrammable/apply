import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

export const REGISTRY_SCHEMA_VERSION = "1.0.0";
export const PROGRAMMABLE_FEE_OWNER = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
export const PROJECT_STATUSES = Object.freeze([
  "accepted",
  "available",
  "candidate",
  "deployed",
  "design",
  "retired",
  "suspended"
]);

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_PROJECT_BYTES = 128 * 1024;
const MAX_ACCEPTANCE_BYTES = 64 * 1024;
const MAX_RECORDS = 10_000;
const MAX_JSON_DEPTH = 128;
const MAX_JSON_NODES = 2_000_000;
const CONTROL_OR_BIDI = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const OPAQUE_ID = /^[1-9][0-9]{0,63}$/u;
const GITHUB_URI = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u;
const decoder = new TextDecoder("utf-8", { fatal: true });

export class RegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
  }
}

export function loadRegistry({ repositoryRoot }) {
  const root = path.resolve(repositoryRoot);
  const config = readJsonFile(path.join(root, "registry/config.json"), MAX_CONFIG_BYTES, "registry config");
  validateConfig(config);
  const projects = config.projectPaths.map((relativePath) => {
    const absolutePath = resolveInside(root, relativePath);
    const bytes = readRegularFile(absolutePath, MAX_PROJECT_BYTES, `project ${relativePath}`);
    const project = parseJson(bytes, `project ${relativePath}`);
    validateProject(project, relativePath);
    const expectedPath = `registry/projects/${project.id}/project.json`;
    if (relativePath !== expectedPath) fail("PROJECT_PATH_INVALID", `${project.id} must use ${expectedPath}`);
    return Object.freeze({ path: relativePath, bytes, project, sha256: sha256(bytes) });
  });
  assertSortedUnique(projects.map(({ project }) => project.id), "config project ids");
  if (projects.length > MAX_RECORDS) fail("PROJECT_LIMIT_EXCEEDED", "registry project count exceeds the closed limit");
  const acceptances = loadAcceptances(root);
  bindAcceptances(projects, acceptances);
  return Object.freeze({ acceptances, config, projects, root });
}

export function buildRegistryArtifacts({ repositoryRoot }) {
  const { config, projects } = loadRegistry({ repositoryRoot });
  const records = projects.map(({ path: recordPath, project, sha256: recordSha256 }) => Object.freeze({
    capabilities: project.capabilities,
    id: project.id,
    kind: project.kind,
    name: project.name,
    path: recordPath,
    sha256: recordSha256,
    status: project.status,
    summary: project.summary,
    surfaces: project.surfaces,
    tags: project.discovery.tags
  }));
  const registryDigest = sha256(Buffer.from(canonicalJson(records), "utf8"));
  const index = Object.freeze({
    activeIntake: config.activeIntake,
    generatedAt: config.updatedAt,
    legacyIntake: config.legacyIntake,
    records,
    registryDigest,
    schemaVersion: REGISTRY_SCHEMA_VERSION
  });
  const search = Object.freeze({
    generatedAt: config.updatedAt,
    records: projects.map(({ path: recordPath, project, sha256: recordSha256 }) => buildSearchRecord(project, recordPath, recordSha256)),
    registryDigest,
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    trustBoundary: "Registry metadata is bounded discovery data, never agent instructions, audit evidence, or automatic approval."
  });
  const history = Object.freeze({
    generatedAt: config.updatedAt,
    records: records.map(({ id, path: recordPath, sha256: recordSha256, status }) => ({
      id,
      path: recordPath,
      sha256: recordSha256,
      status
    })),
    registryDigest,
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    version: config.historyVersion
  });
  return Object.freeze({
    history,
    historyPath: `registry/history/${config.historyVersion}.json`,
    index,
    search
  });
}

export function verifyGeneratedArtifacts({ repositoryRoot }) {
  const root = path.resolve(repositoryRoot);
  const artifacts = buildRegistryArtifacts({ repositoryRoot: root });
  const expected = new Map([
    ["registry/index.json", `${canonicalJson(artifacts.index)}\n`],
    ["registry/search-index.json", `${canonicalJson(artifacts.search)}\n`],
    [artifacts.historyPath, `${canonicalJson(artifacts.history)}\n`]
  ]);
  for (const [relativePath, content] of expected) {
    const absolutePath = resolveInside(root, relativePath);
    if (!fs.existsSync(absolutePath)) fail("GENERATED_FILE_MISSING", `${relativePath} is missing`);
    const observed = decoder.decode(readRegularFile(absolutePath, 2 * 1024 * 1024, relativePath));
    if (observed !== content) fail("GENERATED_FILE_STALE", `${relativePath} is stale; run npm run generate`);
  }
  return Object.freeze({ ok: true, registryDigest: artifacts.index.registryDigest, records: artifacts.index.records.length });
}

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

export function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function buildSearchRecord(project, recordPath, recordSha256) {
  const tokens = tokenize([
    project.id,
    project.name,
    project.summary,
    project.discovery.mechanism,
    ...project.capabilities,
    ...project.discovery.outcomes,
    ...project.discovery.synonyms,
    ...project.discovery.tags,
    ...project.surfaces
  ].join(" "));
  return Object.freeze({
    capabilities: project.capabilities,
    id: project.id,
    kind: project.kind,
    mechanism: project.discovery.mechanism,
    name: project.name,
    outcomes: project.discovery.outcomes,
    path: recordPath,
    sha256: recordSha256,
    status: project.status,
    summary: project.summary,
    surfaces: project.surfaces,
    tags: project.discovery.tags,
    tokens
  });
}

function validateConfig(value) {
  exactKeys(value, ["activeIntake", "historyVersion", "legacyIntake", "projectPaths", "schemaVersion", "updatedAt"], "registry config");
  if (value.schemaVersion !== REGISTRY_SCHEMA_VERSION) fail("CONFIG_INVALID", "registry config schemaVersion is unsupported");
  if (!/^1\.[0-9]+\.[0-9]+$/u.test(value.historyVersion ?? "")) fail("CONFIG_INVALID", "historyVersion must be a v1 semantic version");
  requireTimestamp(value.updatedAt, "registry config updatedAt");
  exactKeys(value.activeIntake, ["baseBranch", "directory", "repository", "state"], "activeIntake");
  if (value.activeIntake.baseBranch !== "main" || value.activeIntake.directory !== "submissions" || value.activeIntake.repository !== "0xprogrammable/submit-launch") {
    fail("CONFIG_INVALID", "active intake identity is not canonical");
  }
  if (!new Set(["prelaunch", "open", "paused-new", "paused-all"]).has(value.activeIntake.state)) fail("CONFIG_INVALID", "active intake state is invalid");
  if (!Array.isArray(value.projectPaths) || value.projectPaths.length < 1 || value.projectPaths.length > MAX_RECORDS) fail("CONFIG_INVALID", "projectPaths is invalid");
  assertSortedUnique(value.projectPaths, "projectPaths");
  if (!Array.isArray(value.legacyIntake) || value.legacyIntake.length > 8) fail("CONFIG_INVALID", "legacyIntake is invalid");
  for (const record of value.legacyIntake) {
    exactKeys(record, ["baseBranch", "continuingPullRequests", "repository"], "legacy intake record");
    requireText(record.baseBranch, "legacy base branch", 255);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(record.repository ?? "")) fail("CONFIG_INVALID", "legacy repository is invalid");
    if (!Array.isArray(record.continuingPullRequests) || record.continuingPullRequests.length > 64) fail("CONFIG_INVALID", "legacy pull requests are invalid");
    assertSortedUnique(record.continuingPullRequests, "legacy pull requests", { numeric: true });
  }
}

function validateProject(project, relativePath) {
  exactKeys(project, ["capabilities", "chains", "discovery", "economics", "hook", "id", "kind", "name", "provenance", "relations", "review", "schemaVersion", "source", "status", "statusUpdatedAt", "summary", "surfaces", "warnings"], relativePath);
  if (project.schemaVersion !== REGISTRY_SCHEMA_VERSION || !SLUG.test(project.id ?? "")) fail("PROJECT_INVALID", `${relativePath} has an invalid identity`);
  if (!PROJECT_STATUSES.includes(project.status)) fail("PROJECT_INVALID", `${project.id} has an invalid status`);
  if (!new Set(["launch-model", "hook-project", "application-game", "application-service", "composite"]).has(project.kind)) fail("PROJECT_INVALID", `${project.id} has an invalid kind`);
  requireText(project.name, `${project.id}.name`, 160);
  requireText(project.summary, `${project.id}.summary`, 1000);
  requireTimestamp(project.statusUpdatedAt, `${project.id}.statusUpdatedAt`);
  for (const [label, values, limit] of [
    ["capabilities", project.capabilities, 64],
    ["surfaces", project.surfaces, 32]
  ]) validateSlugSet(values, `${project.id}.${label}`, limit);
  validateTextSet(project.warnings, `${project.id}.warnings`, 32, false);

  exactKeys(project.discovery, ["mechanism", "outcomes", "synonyms", "tags"], `${project.id}.discovery`);
  requireText(project.discovery.mechanism, `${project.id}.discovery.mechanism`, 1000);
  validateTextSet(project.discovery.outcomes, `${project.id}.discovery.outcomes`, 32, false);
  validateTextSet(project.discovery.synonyms, `${project.id}.discovery.synonyms`, 32, true);
  validateSlugSet(project.discovery.tags, `${project.id}.discovery.tags`, 32);

  exactKeys(project.economics, ["programmableFee", "summary"], `${project.id}.economics`);
  requireText(project.economics.summary, `${project.id}.economics.summary`, 1000);
  exactKeys(project.economics.programmableFee, ["claimOwner", "inclusiveBps", "policyId", "required"], `${project.id}.programmableFee`);
  if (project.economics.programmableFee.claimOwner !== PROGRAMMABLE_FEE_OWNER || project.economics.programmableFee.inclusiveBps !== 10 || project.economics.programmableFee.required !== true || project.economics.programmableFee.policyId !== "programmable-volume-fee-v1") {
    fail("PROJECT_FEE_POLICY_INVALID", `${project.id} does not preserve the mandatory Programmable fee identity`);
  }

  exactKeys(project.hook, ["beforeSwapReturnDelta", "canonicalPoolRequired", "contractNames", "permissions", "upgradeability", "used"], `${project.id}.hook`);
  if (![true, false, null].includes(project.hook.used) || ![true, false, null].includes(project.hook.beforeSwapReturnDelta) || typeof project.hook.canonicalPoolRequired !== "boolean") fail("PROJECT_INVALID", `${project.id} has invalid hook state`);
  validateTextSet(project.hook.contractNames, `${project.id}.hook.contractNames`, 32, true);
  validateSlugSet(project.hook.permissions, `${project.id}.hook.permissions`, 14);
  if (!new Set(["none", "immutable-factory", "upgradeable", "unknown"]).has(project.hook.upgradeability)) fail("PROJECT_INVALID", `${project.id} has invalid upgradeability`);

  if (!Array.isArray(project.chains) || project.chains.length < 1 || project.chains.length > 16) fail("PROJECT_INVALID", `${project.id}.chains is invalid`);
  const chainIds = [];
  for (const chain of project.chains) {
    exactKeys(chain, ["chainId", "deploymentEvidence", "network", "state"], `${project.id}.chain`);
    if (!Number.isSafeInteger(chain.chainId) || chain.chainId < 1) fail("PROJECT_INVALID", `${project.id} has an invalid chain id`);
    chainIds.push(chain.chainId);
    requireText(chain.network, `${project.id}.chain.network`, 160);
    if (chain.deploymentEvidence !== null) requireHttpsUri(chain.deploymentEvidence, `${project.id}.chain.deploymentEvidence`);
    if (!new Set(["proposed", "declared-addresses", "deployed", "source-verified", "lifecycle-verified", "available"]).has(chain.state)) fail("PROJECT_INVALID", `${project.id} has an invalid chain state`);
  }
  assertSortedUnique(chainIds, `${project.id}.chainIds`, { numeric: true });

  exactKeys(project.source, ["manifestPath", "numericRepositoryId", "repositoryUri", "revisionObjectId", "treeObjectId"], `${project.id}.source`);
  if (!GITHUB_URI.test(project.source.repositoryUri ?? "") || !OPAQUE_ID.test(project.source.numericRepositoryId ?? "") || !SHA1.test(project.source.revisionObjectId ?? "") || !SHA1.test(project.source.treeObjectId ?? "") || !/^[A-Za-z0-9._/-]{1,512}$/u.test(project.source.manifestPath ?? "") || project.source.manifestPath.includes("..")) fail("PROJECT_INVALID", `${project.id} has an invalid exact source identity`);

  exactKeys(project.provenance, ["importedFrom", "observedAt", "recordClass"], `${project.id}.provenance`);
  requireHttpsUri(project.provenance.importedFrom, `${project.id}.provenance.importedFrom`);
  requireTimestamp(project.provenance.observedAt, `${project.id}.provenance.observedAt`);
  if (!new Set(["legacy-platform-record", "maintainer-acceptance"]).has(project.provenance.recordClass)) fail("PROJECT_INVALID", `${project.id} has invalid provenance`);

  exactKeys(project.review, ["acceptancePath", "applicationPullRequest", "independentAudit", "limitations", "state"], `${project.id}.review`);
  if (project.review.acceptancePath !== null && !/^registry\/acceptances\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*\.json$/u.test(project.review.acceptancePath)) fail("PROJECT_INVALID", `${project.id} has an invalid acceptance path`);
  if (project.review.applicationPullRequest !== null) requireHttpsUri(project.review.applicationPullRequest, `${project.id}.review.applicationPullRequest`);
  if (typeof project.review.independentAudit !== "boolean" || !new Set(["legacy-record", "pending", "changes-requested", "accepted", "suspended", "retired"]).has(project.review.state)) fail("PROJECT_INVALID", `${project.id} has invalid review state`);
  validateTextSet(project.review.limitations, `${project.id}.review.limitations`, 32, false);

  exactKeys(project.relations, ["similarTo", "supersededBy", "supersedes"], `${project.id}.relations`);
  validateSlugSet(project.relations.similarTo, `${project.id}.relations.similarTo`, 32);
  validateSlugSet(project.relations.supersedes, `${project.id}.relations.supersedes`, 32);
  if (project.relations.supersededBy !== null && !SLUG.test(project.relations.supersededBy)) fail("PROJECT_INVALID", `${project.id} has invalid supersession`);
  for (const related of [...project.relations.similarTo, ...project.relations.supersedes, project.relations.supersededBy].filter(Boolean)) {
    if (related === project.id) fail("PROJECT_INVALID", `${project.id} cannot relate to itself`);
  }
}

function loadAcceptances(root) {
  const acceptanceRoot = path.join(root, "registry/acceptances");
  let rootStatus;
  try {
    rootStatus = fs.lstatSync(acceptanceRoot);
  } catch {
    fail("ACCEPTANCE_DIRECTORY_INVALID", "registry/acceptances is missing");
  }
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) fail("ACCEPTANCE_DIRECTORY_INVALID", "registry/acceptances must be a regular directory");
  const records = [];
  for (const entry of fs.readdirSync(acceptanceRoot, { withFileTypes: true }).sort((left, right) => compareUtf8(left.name, right.name))) {
    if (entry.name === "README.md" && entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink() || !SLUG.test(entry.name)) fail("ACCEPTANCE_PATH_INVALID", "acceptance directories must use canonical project ids");
    const directory = path.join(acceptanceRoot, entry.name);
    for (const file of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareUtf8(left.name, right.name))) {
      if (!file.isFile() || file.isSymbolicLink() || !/^[a-z0-9][a-z0-9.-]*\.json$/u.test(file.name)) fail("ACCEPTANCE_PATH_INVALID", "acceptance records must be canonical regular JSON files");
      const relativePath = `registry/acceptances/${entry.name}/${file.name}`;
      const bytes = readRegularFile(path.join(directory, file.name), MAX_ACCEPTANCE_BYTES, relativePath);
      const acceptance = parseJson(bytes, relativePath);
      validateAcceptance(acceptance, relativePath, entry.name);
      records.push(Object.freeze({ acceptance, bytes, path: relativePath, sha256: sha256(bytes) }));
      if (records.length > MAX_RECORDS) fail("ACCEPTANCE_LIMIT_EXCEEDED", "acceptance record count exceeds the closed limit");
    }
  }
  assertSortedUnique(records.map(({ path: recordPath }) => recordPath), "acceptance paths");
  return Object.freeze(records);
}

function validateAcceptance(acceptance, relativePath, projectId) {
  exactKeys(acceptance, ["acceptedAt", "acceptedBy", "application", "conditions", "decision", "projectRecordPath", "schemaVersion", "source"], relativePath);
  if (acceptance.schemaVersion !== REGISTRY_SCHEMA_VERSION || acceptance.decision !== "accepted-for-registry-promotion") fail("ACCEPTANCE_INVALID", `${relativePath} has an unsupported decision contract`);
  requireTimestamp(acceptance.acceptedAt, `${relativePath}.acceptedAt`);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(acceptance.acceptedBy ?? "")) fail("ACCEPTANCE_INVALID", `${relativePath} has an invalid maintainer identity`);
  if (acceptance.projectRecordPath !== `registry/projects/${projectId}/project.json`) fail("ACCEPTANCE_INVALID", `${relativePath} points to the wrong project record`);
  validateTextSet(acceptance.conditions, `${relativePath}.conditions`, 32, false);

  exactKeys(acceptance.application, ["applicationId", "applicationRevision", "packageDigest", "pullRequest"], `${relativePath}.application`);
  if (acceptance.application.applicationId !== projectId || !Number.isSafeInteger(acceptance.application.applicationRevision) || acceptance.application.applicationRevision < 1 || !/^sha256:[0-9a-f]{64}$/u.test(acceptance.application.packageDigest ?? "") || !/^https:\/\/github\.com\/0xprogrammable\/submit-launch\/pull\/[1-9][0-9]{0,19}$/u.test(acceptance.application.pullRequest ?? "")) {
    fail("ACCEPTANCE_INVALID", `${relativePath} has an invalid application binding`);
  }
  exactKeys(acceptance.source, ["numericRepositoryId", "repositoryUri", "revisionObjectId", "treeObjectId"], `${relativePath}.source`);
  if (!GITHUB_URI.test(acceptance.source.repositoryUri ?? "") || !OPAQUE_ID.test(acceptance.source.numericRepositoryId ?? "") || !SHA1.test(acceptance.source.revisionObjectId ?? "") || !SHA1.test(acceptance.source.treeObjectId ?? "")) fail("ACCEPTANCE_INVALID", `${relativePath} has an invalid source binding`);
}

function bindAcceptances(projects, acceptances) {
  const byPath = new Map(acceptances.map((record) => [record.path, record]));
  const projectIds = new Set(projects.map(({ project }) => project.id));
  for (const { acceptance, path: acceptancePath } of acceptances) {
    if (!projectIds.has(acceptance.application.applicationId)) fail("ACCEPTANCE_ORPHANED", `${acceptancePath} has no project record`);
  }
  for (const { project } of projects) {
    const acceptancePath = project.review.acceptancePath;
    if (acceptancePath === null) {
      if (project.review.state === "accepted") fail("ACCEPTANCE_BINDING_MISSING", `${project.id} is accepted without an acceptance record`);
      continue;
    }
    const record = byPath.get(acceptancePath);
    if (!record) fail("ACCEPTANCE_BINDING_MISSING", `${project.id} points to a missing acceptance record`);
    const source = record.acceptance.source;
    if (
      source.repositoryUri !== project.source.repositoryUri
      || source.numericRepositoryId !== project.source.numericRepositoryId
      || source.revisionObjectId !== project.source.revisionObjectId
      || source.treeObjectId !== project.source.treeObjectId
    ) fail("ACCEPTANCE_SOURCE_MISMATCH", `${project.id} does not match its accepted exact source`);
    if (!new Set(["accepted", "suspended", "retired"]).has(project.review.state) || !new Set(["accepted", "deployed", "available", "suspended", "retired"]).has(project.status)) fail("ACCEPTANCE_STATE_INVALID", `${project.id} has an acceptance record in an incompatible state`);
  }
}

function readJsonFile(filePath, maximumBytes, label) {
  return parseJson(readRegularFile(filePath, maximumBytes, label), label);
}

function parseJson(bytes, label) {
  try {
    return parseStrictJson(decoder.decode(bytes), label);
  } catch {
    fail("JSON_INVALID", `${label} is not closed lossless JSON`);
  }
}

function parseStrictJson(source, label) {
  let cursor = 0;
  let nodes = 0;

  const invalid = (message) => {
    throw new SyntaxError(`${label}: ${message}`);
  };
  const skipWhitespace = () => {
    while (cursor < source.length && /[\u0009\u000a\u000d\u0020]/u.test(source[cursor])) cursor += 1;
  };
  const parseString = () => {
    if (source[cursor] !== "\"") invalid("expected string");
    const start = cursor;
    cursor += 1;
    let escaped = false;
    while (cursor < source.length) {
      const character = source[cursor];
      if (!escaped && character === "\"") {
        cursor += 1;
        const value = JSON.parse(source.slice(start, cursor));
        if (hasLoneSurrogate(value)) invalid("lone surrogate in string");
        return value;
      }
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      cursor += 1;
    }
    invalid("unterminated string");
  };
  const parseValue = (depth) => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) invalid("structure exceeds bounds");
    skipWhitespace();
    const character = source[cursor];
    if (character === "{") {
      cursor += 1;
      skipWhitespace();
      const output = {};
      const keys = new Set();
      if (source[cursor] === "}") {
        cursor += 1;
        return output;
      }
      while (cursor < source.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) invalid(`duplicate object key ${JSON.stringify(key)}`);
        keys.add(key);
        skipWhitespace();
        if (source[cursor] !== ":") invalid("expected colon");
        cursor += 1;
        output[key] = parseValue(depth + 1);
        skipWhitespace();
        if (source[cursor] === "}") {
          cursor += 1;
          return output;
        }
        if (source[cursor] !== ",") invalid("expected comma");
        cursor += 1;
      }
      invalid("unterminated object");
    }
    if (character === "[") {
      cursor += 1;
      skipWhitespace();
      const output = [];
      if (source[cursor] === "]") {
        cursor += 1;
        return output;
      }
      while (cursor < source.length) {
        output.push(parseValue(depth + 1));
        skipWhitespace();
        if (source[cursor] === "]") {
          cursor += 1;
          return output;
        }
        if (source[cursor] !== ",") invalid("expected comma");
        cursor += 1;
      }
      invalid("unterminated array");
    }
    if (character === "\"") return parseString();
    for (const [token, value] of [["true", true], ["false", false], ["null", null]]) {
      if (source.startsWith(token, cursor)) {
        cursor += token.length;
        return value;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(source.slice(cursor));
    if (number) {
      cursor += number[0].length;
      const value = Number(number[0]);
      if (!Number.isSafeInteger(value)) invalid("only safe integers are supported");
      return value;
    }
    invalid("unexpected token");
  };

  const parsed = parseValue(0);
  skipWhitespace();
  if (cursor !== source.length) invalid("trailing data");
  return parsed;
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function readRegularFile(filePath, maximumBytes, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    fail("FILE_MISSING", `${label} is missing`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) !== 0 || stat.size < 2 || stat.size > maximumBytes) fail("FILE_INVALID", `${label} must be a bounded non-executable regular file`);
  return fs.readFileSync(filePath);
}

function resolveInside(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.startsWith("/") || relativePath.includes("\\") || relativePath.split("/").some((part) => part === "" || part === "." || part === "..")) fail("PATH_INVALID", "registry path is not canonical");
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) fail("PATH_INVALID", "registry path escapes the repository");
  return resolved;
}

function exactKeys(value, keys, label) {
  if (!isPlainObject(value) || !arraysEqual(Object.keys(value).sort(compareUtf8), [...keys].sort(compareUtf8))) fail("SHAPE_INVALID", `${label} has an unexpected shape`);
}

function validateSlugSet(values, label, maximum) {
  if (!Array.isArray(values) || values.length > maximum || values.some((value) => typeof value !== "string" || !SLUG.test(value))) fail("SET_INVALID", `${label} is invalid`);
  assertSortedUnique(values, label);
}

function validateTextSet(values, label, maximum, sorted) {
  if (!Array.isArray(values) || values.length > maximum) fail("SET_INVALID", `${label} is invalid`);
  values.forEach((value, index) => requireText(value, `${label}[${index}]`, 1000));
  if (new Set(values).size !== values.length) fail("SET_INVALID", `${label} contains duplicates`);
  if (sorted) assertSortedUnique(values, label);
}

function assertSortedUnique(values, label, { numeric = false } = {}) {
  if (!Array.isArray(values) || new Set(values).size !== values.length) fail("SET_INVALID", `${label} contains duplicates`);
  const expected = [...values].sort(numeric ? ((a, b) => a - b) : compareUtf8);
  if (!arraysEqual(values, expected)) fail("SET_INVALID", `${label} must be sorted`);
}

function requireText(value, label, maximum) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || value.trim() !== value || CONTROL_OR_BIDI.test(value)) fail("TEXT_INVALID", `${label} is invalid`);
}

function requireTimestamp(value, label) {
  requireText(value, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) || Number.isNaN(Date.parse(value))) fail("TIMESTAMP_INVALID", `${label} must be canonical UTC`);
}

function requireHttpsUri(value, label) {
  requireText(value, label, 2048);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("URI_INVALID", `${label} is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "") fail("URI_INVALID", `${label} must be a clean HTTPS URI`);
}

function tokenize(value) {
  return [...new Set(value.normalize("NFKD").toLowerCase().replace(/\p{Mark}+/gu, "").split(/[^a-z0-9]+/u).filter((token) => token.length >= 2 && token.length <= 64))].sort(compareUtf8).slice(0, 512);
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, sortJson(value[key])]));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(String(left), "utf8"), Buffer.from(String(right), "utf8"));
}

function fail(code, message) {
  throw new RegistryError(code, message);
}
