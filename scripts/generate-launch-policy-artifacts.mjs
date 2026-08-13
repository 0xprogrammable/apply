#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validateActiveContractManifestV1 } from "../vendor/programmable-v4-hook-builder/scripts/resolve-contract-validation.mjs";
import {
  canonicalJson,
  parseLaunchPolicyBytes,
  renderLaunchPolicyMarkdown
} from "./launch-policy-core.mjs";

const POLICY_PATH = "policy/launch-policy.v1.json";
const RENDERED_POLICY_PATH = "docs/LAUNCH_POLICY.md";
const ACTIVE_CONTRACT_PATH = ".programmable/active-contract.json";
const MAXIMUM_ARTIFACT_BYTES = 2 * 1024 * 1024;
const ROLE_PATHS = Object.freeze({
  workflow: Object.freeze([".github/workflows/verify-hook-builder.yml"]),
  validator: Object.freeze(["scripts/verify-public-hook-application.mjs"]),
  package: Object.freeze(["vendor/programmable-v4-hook-builder/references/public-pr-application.schema.json"]),
  policy: Object.freeze([POLICY_PATH])
});
const GENERATED_PATHS = Object.freeze([RENDERED_POLICY_PATH, ACTIVE_CONTRACT_PATH]);

export class LaunchPolicyArtifactError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "LaunchPolicyArtifactError";
    this.code = code;
  }
}

export function readRepositoryLaunchPolicy(options) {
  const repositoryRoot = requireRepositoryRootOptions(options);
  return parseLaunchPolicyBytes(readRegularFile(repositoryRoot, POLICY_PATH, 512 * 1024));
}

export function buildLaunchPolicyArtifacts(options) {
  const repositoryRoot = requireRepositoryRootOptions(options);
  return buildArtifactState(repositoryRoot).artifacts;
}

function buildArtifactState(repositoryRoot) {
  const policyRecord = readRepositoryLaunchPolicy({ repositoryRoot });
  const activeContract = validateActiveContractManifestV1({
    $schema: "urn:programmable:active-contract-manifest:1.0.0",
    schemaVersion: "1.0.0",
    kind: "programmable-active-contract",
    contractId: "submit-launch",
    defaultBranch: "main",
    artifacts: Object.fromEntries(Object.entries(ROLE_PATHS).map(([role, paths]) => [
      role,
      paths.map((relativePath) => ({
        path: relativePath,
        sha256: digestBytes(readRegularFile(repositoryRoot, relativePath, MAXIMUM_ARTIFACT_BYTES))
      }))
    ]))
  }, { defaultBranch: "main" });

  return {
    artifacts: new Map([
      [RENDERED_POLICY_PATH, renderLaunchPolicyMarkdown(policyRecord)],
      [ACTIVE_CONTRACT_PATH, `${canonicalJson(activeContract)}\n`]
    ]),
    policyRecord
  };
}

export function verifyLaunchPolicyArtifacts(options) {
  const repositoryRoot = requireRepositoryRootOptions(options);
  const { artifacts: expectedArtifacts, policyRecord } = buildArtifactState(repositoryRoot);
  for (const [relativePath, expected] of expectedArtifacts) {
    let observed;
    try {
      observed = readRegularFile(repositoryRoot, relativePath, MAXIMUM_ARTIFACT_BYTES).toString("utf8");
    } catch (error) {
      if (error instanceof LaunchPolicyArtifactError) {
        throw new LaunchPolicyArtifactError(
          "LAUNCH_POLICY_ARTIFACT_STALE",
          `Generated launch-policy artifact ${relativePath} is missing or invalid. Run npm run policy:generate.`,
          { cause: error }
        );
      }
      throw error;
    }
    if (observed !== expected) {
      throw new LaunchPolicyArtifactError(
        "LAUNCH_POLICY_ARTIFACT_STALE",
        `Generated launch-policy artifact ${relativePath} is stale. Run npm run policy:generate.`
      );
    }
  }
  return Object.freeze({
    activeContractPath: ACTIVE_CONTRACT_PATH,
    policyPath: POLICY_PATH,
    policySha256: policyRecord.sha256,
    renderedPolicyPath: RENDERED_POLICY_PATH
  });
}

export function writeLaunchPolicyArtifacts(options) {
  const repositoryRoot = requireRepositoryRootOptions(options);
  const artifacts = buildLaunchPolicyArtifacts({ repositoryRoot });
  for (const [relativePath, source] of artifacts) {
    writeGeneratedFile(repositoryRoot, relativePath, source);
  }
  return verifyLaunchPolicyArtifacts({ repositoryRoot });
}

function requireRepositoryRootOptions(options) {
  if (!isPlainObject(options) || !sameKeys(options, ["repositoryRoot"])) {
    throw new LaunchPolicyArtifactError(
      "LAUNCH_POLICY_ARTIFACT_ARGUMENTS_INVALID",
      "Launch-policy artifact operations accept only repositoryRoot."
    );
  }
  const { repositoryRoot } = options;
  if (typeof repositoryRoot !== "string" || !path.isAbsolute(repositoryRoot)) {
    throw new LaunchPolicyArtifactError(
      "LAUNCH_POLICY_ARTIFACT_ARGUMENTS_INVALID",
      "Launch-policy repositoryRoot must be an absolute path."
    );
  }
  let status;
  try {
    status = fs.lstatSync(repositoryRoot);
  } catch (error) {
    throw new LaunchPolicyArtifactError(
      "LAUNCH_POLICY_ARTIFACT_IO",
      "Launch-policy repository root is unavailable.",
      { cause: error }
    );
  }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new LaunchPolicyArtifactError(
      "LAUNCH_POLICY_ARTIFACT_IO",
      "Launch-policy repository root must be a regular directory."
    );
  }
  return repositoryRoot;
}

function readRegularFile(repositoryRoot, relativePath, maximumBytes) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  let status;
  try {
    status = fs.lstatSync(absolutePath);
  } catch (error) {
    throw new LaunchPolicyArtifactError(
      "LAUNCH_POLICY_ARTIFACT_IO",
      `Required repository file ${relativePath} is unavailable.`,
      { cause: error }
    );
  }
  if (!status.isFile() || status.isSymbolicLink() || status.size < 1 || status.size > maximumBytes) {
    throw new LaunchPolicyArtifactError(
      "LAUNCH_POLICY_ARTIFACT_IO",
      `Required repository file ${relativePath} must be a bounded regular file.`
    );
  }
  let descriptor;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | noFollow);
    const openedStatus = fs.fstatSync(descriptor);
    if (
      !openedStatus.isFile()
      || openedStatus.size < 1
      || openedStatus.size > maximumBytes
      || openedStatus.dev !== status.dev
      || openedStatus.ino !== status.ino
    ) {
      throw new LaunchPolicyArtifactError(
        "LAUNCH_POLICY_ARTIFACT_IO",
        `Required repository file ${relativePath} changed while it was read.`
      );
    }
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length !== openedStatus.size) {
      throw new LaunchPolicyArtifactError(
        "LAUNCH_POLICY_ARTIFACT_IO",
        `Required repository file ${relativePath} changed while it was read.`
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof LaunchPolicyArtifactError) throw error;
    throw new LaunchPolicyArtifactError(
      "LAUNCH_POLICY_ARTIFACT_IO",
      `Required repository file ${relativePath} could not be read.`,
      { cause: error }
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeGeneratedFile(repositoryRoot, relativePath, source) {
  if (!GENERATED_PATHS.includes(relativePath)) {
    throw new LaunchPolicyArtifactError(
      "LAUNCH_POLICY_ARTIFACT_PATH_INVALID",
      "The launch-policy generator attempted to write outside its fixed artifact set."
    );
  }
  const parent = path.dirname(relativePath);
  ensureRegularDirectory(repositoryRoot, parent);
  const absolutePath = path.join(repositoryRoot, relativePath);
  if (fs.existsSync(absolutePath)) {
    const status = fs.lstatSync(absolutePath);
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new LaunchPolicyArtifactError(
        "LAUNCH_POLICY_ARTIFACT_IO",
        `Generated artifact target ${relativePath} must be a regular file.`
      );
    }
  }
  const temporaryPath = `${absolutePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporaryPath, source, { encoding: "utf8", flag: "wx", mode: 0o644 });
    fs.renameSync(temporaryPath, absolutePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    if (error instanceof LaunchPolicyArtifactError) throw error;
    throw new LaunchPolicyArtifactError(
      "LAUNCH_POLICY_ARTIFACT_IO",
      `Generated artifact ${relativePath} could not be written.`,
      { cause: error }
    );
  }
}

function ensureRegularDirectory(repositoryRoot, relativeDirectory) {
  let current = repositoryRoot;
  for (const segment of relativeDirectory.split("/").filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current, { mode: 0o755 });
      continue;
    }
    const status = fs.lstatSync(current);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new LaunchPolicyArtifactError(
        "LAUNCH_POLICY_ARTIFACT_IO",
        `Generated artifact parent ${relativeDirectory} must be a regular directory.`
      );
    }
  }
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameKeys(value, expected) {
  return isPlainObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 1 || !new Set(["--check", "--write"]).has(arguments_[0])) {
    throw new LaunchPolicyArtifactError(
      "LAUNCH_POLICY_GENERATOR_USAGE_INVALID",
      "Usage: node scripts/generate-launch-policy-artifacts.mjs --check|--write"
    );
  }
  const result = arguments_[0] === "--write"
    ? writeLaunchPolicyArtifacts({ repositoryRoot: root })
    : verifyLaunchPolicyArtifacts({ repositoryRoot: root });
  process.stdout.write(`${canonicalJson({ ...result, mode: arguments_[0].slice(2), ok: true })}\n`);
}

const isEntrypoint = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    const code = typeof error?.code === "string" ? error.code : "LAUNCH_POLICY_GENERATOR_FAILED";
    const message = String(error?.message ?? "Launch-policy artifact generation failed.").slice(0, 1000);
    process.stderr.write(`${canonicalJson({ error: { code, message }, ok: false })}\n`);
    process.exitCode = 1;
  });
}
