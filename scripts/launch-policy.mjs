#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildLaunchPolicyBinding,
  canonicalJson,
  LaunchPolicyError,
  parseLaunchPolicyBytes,
  readTrustedLaunchPolicyFromGit,
  renderLaunchPolicyMarkdown,
  rulesForProfile,
  selectLaunchPolicyProfile
} from "./launch-policy-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = "policy/launch-policy.v1.json";
const POLICY_ABSOLUTE_PATH = path.join(root, POLICY_PATH);
const MAXIMUM_POLICY_BYTES = 512 * 1024;

class LaunchPolicyCliError extends Error {
  constructor(code, message, exitCode = 2, options) {
    super(message, options);
    this.name = "LaunchPolicyCliError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function readOwnedPolicy() {
  let status;
  try {
    status = fs.lstatSync(POLICY_ABSOLUTE_PATH);
  } catch (error) {
    throw new LaunchPolicyCliError(
      "LAUNCH_POLICY_IO_FAILED",
      `The fixed repository policy ${POLICY_PATH} is unavailable.`,
      2,
      { cause: error }
    );
  }
  if (!status.isFile() || status.isSymbolicLink() || status.size < 2 || status.size > MAXIMUM_POLICY_BYTES) {
    throw new LaunchPolicyCliError(
      "LAUNCH_POLICY_IO_FAILED",
      `The fixed repository policy ${POLICY_PATH} must be a bounded regular file.`
    );
  }
  let bytes;
  try {
    bytes = fs.readFileSync(POLICY_ABSOLUTE_PATH);
  } catch (error) {
    throw new LaunchPolicyCliError(
      "LAUNCH_POLICY_IO_FAILED",
      `The fixed repository policy ${POLICY_PATH} could not be read.`,
      2,
      { cause: error }
    );
  }
  if (bytes.length !== status.size) {
    throw new LaunchPolicyCliError(
      "LAUNCH_POLICY_IO_FAILED",
      `The fixed repository policy ${POLICY_PATH} changed while it was read.`
    );
  }
  return parseLaunchPolicyBytes(bytes);
}

function policySummary(record) {
  return Object.freeze({
    id: record.policy.policyId,
    path: POLICY_PATH,
    sha256: record.sha256,
    version: record.policy.policyVersion
  });
}

function parseProfileCommand(arguments_, command) {
  if (arguments_.length !== 3 || arguments_[0] !== command || arguments_[1] !== "--profile") {
    throw usageError();
  }
  const profileId = arguments_[2];
  if (typeof profileId !== "string" || profileId.length < 1 || profileId.length > 64) throw usageError();
  return profileId;
}

function exactHeadCommit() {
  let result;
  try {
    result = childProcess.spawnSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env },
      shell: false
    });
  } catch (error) {
    throw new LaunchPolicyCliError(
      "LAUNCH_POLICY_GIT_FAILED",
      "The exact repository HEAD could not be resolved.",
      2,
      { cause: error }
    );
  }
  const commit = result.status === 0 ? result.stdout.trim() : "";
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new LaunchPolicyCliError(
      "LAUNCH_POLICY_GIT_FAILED",
      "The exact repository HEAD could not be resolved."
    );
  }
  return commit;
}

function currentTrustedRecord() {
  const owned = readOwnedPolicy();
  const trusted = readTrustedLaunchPolicyFromGit({
    repositoryRoot: root,
    expectedBaseCommit: exactHeadCommit()
  });
  if (!owned.bytes.equals(trusted.bytes) || owned.sha256 !== trusted.sha256) {
    throw new LaunchPolicyCliError(
      "LAUNCH_POLICY_WORKTREE_DRIFT",
      "The fixed working-tree policy differs from the exact Git HEAD policy; commit or restore it before requesting a binding."
    );
  }
  return trusted;
}

function usageError() {
  return new LaunchPolicyCliError(
    "LAUNCH_POLICY_CLI_USAGE_INVALID",
    "Usage: node scripts/launch-policy.mjs requirements --profile <id> | binding --profile <id> | validate-policy | render | help"
  );
}

function helpResult() {
  return {
    commands: [
      "requirements --profile <id>",
      "binding --profile <id>",
      "validate-policy",
      "render"
    ],
    fixedPolicyPath: POLICY_PATH,
    schemaVersion: "programmable.launch-policy-cli-help.v1"
  };
}

function evaluateCommand(arguments_) {
  if (arguments_.length === 0 || (arguments_.length === 1 && new Set(["--help", "help"]).has(arguments_[0]))) {
    return helpResult();
  }

  if (arguments_[0] === "requirements") {
    const profileId = parseProfileCommand(arguments_, "requirements");
    const record = readOwnedPolicy();
    const profile = selectLaunchPolicyProfile(record.policy, profileId);
    return {
      policy: policySummary(record),
      profile,
      rules: rulesForProfile(record.policy, profileId),
      schemaVersion: "programmable.launch-policy-requirements.v1"
    };
  }

  if (arguments_[0] === "binding") {
    const profileId = parseProfileCommand(arguments_, "binding");
    return buildLaunchPolicyBinding(currentTrustedRecord(), profileId);
  }

  if (arguments_[0] === "validate-policy") {
    if (arguments_.length !== 1) throw usageError();
    const record = readOwnedPolicy();
    return {
      policy: policySummary(record),
      result: "valid",
      schemaVersion: "programmable.launch-policy-validation.v1"
    };
  }

  if (arguments_[0] === "render") {
    if (arguments_.length !== 1) throw usageError();
    const record = readOwnedPolicy();
    return {
      markdown: renderLaunchPolicyMarkdown(record),
      policy: policySummary(record),
      schemaVersion: "programmable.launch-policy-render.v1"
    };
  }

  throw usageError();
}

function exitCodeFor(error) {
  if (error instanceof LaunchPolicyCliError) return error.exitCode;
  if (!(error instanceof LaunchPolicyError)) return 2;
  if (
    error.code === "LAUNCH_POLICY_GIT_IDENTITY_INVALID"
    || error.code === "LAUNCH_POLICY_GIT_OBJECT_INVALID"
    || error.code === "LAUNCH_POLICY_READER_ARGUMENTS_INVALID"
    || error.code === "LAUNCH_POLICY_TRUST_INVALID"
    || error.code === "LAUNCH_POLICY_BINDING_SOURCE_INVALID"
  ) return 2;
  return 1;
}

try {
  const result = evaluateCommand(process.argv.slice(2));
  process.stdout.write(`${canonicalJson(result)}\n`);
} catch (error) {
  const code = typeof error?.code === "string" ? error.code : "LAUNCH_POLICY_CLI_FAILED";
  const message = String(error?.message ?? "Launch-policy command failed.").slice(0, 1000);
  process.stderr.write(`${canonicalJson({ error: { code, message }, ok: false })}\n`);
  process.exitCode = exitCodeFor(error);
}
