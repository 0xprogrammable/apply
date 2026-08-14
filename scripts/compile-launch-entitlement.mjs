#!/usr/bin/env node

import {
  canonicalJson
} from "./verify-public-hook-application-core.mjs";
import {
  compileLaunchEntitlementEnvelope,
  LaunchEntitlementError,
  readCanonicalSignedCommandFile,
  readTrustedAuthorityPublicKeyFile
} from "./acceptance-entitlement-core.mjs";
import { readTrustedLaunchPolicyFromGit } from "./launch-policy-core.mjs";

const USAGE = "Usage: node scripts/compile-launch-entitlement.mjs --signed-command <canonical-json> --package-directory <six-file-directory> --launch-plan-file <exact-source-json> --trusted-authority-public-key <ed25519-public-pem> --trusted-policy-repository-root <protected-checkout> --expected-policy-base-commit <40-hex>";

try {
  const options = parseArguments(process.argv.slice(2));
  const signedCommand = readCanonicalSignedCommandFile(options.signedCommand);
  const trustedAuthorityPublicKey = readTrustedAuthorityPublicKeyFile(options.trustedAuthorityPublicKey);
  const trustedPolicyRecord = readTrustedLaunchPolicyFromGit({
    repositoryRoot: options.trustedPolicyRepositoryRoot,
    expectedBaseCommit: options.expectedPolicyBaseCommit
  });
  const envelope = compileLaunchEntitlementEnvelope({
    signedCommand,
    packageDirectory: options.packageDirectory,
    launchPlanFile: options.launchPlanFile,
    trustedAuthorityPublicKey,
    trustedPolicyRecord
  });
  process.stdout.write(`${canonicalJson(envelope)}\n`);
} catch (error) {
  const code = error instanceof LaunchEntitlementError ? error.code : "ENTITLEMENT_COMPILER_FAILED";
  const message = error instanceof Error ? error.message : "Launch entitlement compilation failed.";
  process.stderr.write(`${canonicalJson({ code, error: message, status: "rejected" })}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  if (args.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  const allowed = new Set([
    "--launch-plan-file",
    "--package-directory",
    "--signed-command",
    "--trusted-authority-public-key",
    "--trusted-policy-repository-root",
    "--expected-policy-base-commit"
  ]);
  if (args.length !== 12) throw new LaunchEntitlementError("ARGUMENTS_INVALID", USAGE);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || values.has(name) || typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new LaunchEntitlementError("ARGUMENTS_INVALID", USAGE);
    }
    values.set(name, value);
  }
  if (values.size !== allowed.size) throw new LaunchEntitlementError("ARGUMENTS_INVALID", USAGE);
  return {
    launchPlanFile: values.get("--launch-plan-file"),
    packageDirectory: values.get("--package-directory"),
    signedCommand: values.get("--signed-command"),
    trustedAuthorityPublicKey: values.get("--trusted-authority-public-key"),
    trustedPolicyRepositoryRoot: values.get("--trusted-policy-repository-root"),
    expectedPolicyBaseCommit: values.get("--expected-policy-base-commit")
  };
}
