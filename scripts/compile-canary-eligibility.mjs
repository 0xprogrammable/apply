#!/usr/bin/env node

import {
  CanaryEligibilityError,
  compileCanaryEligibilityEnvelope,
  readCanonicalCanaryEligibilityCommandFile,
  readCanaryEligibilityApplicationFile,
  readCanaryEligibilityAuthorityPublicKeyFile,
  readWorkflowCanaryResultFile
} from "./canary-eligibility-core.mjs";
import {
  canonicalJson,
  LaunchPolicyError,
  readTrustedLaunchPolicyFromGit
} from "./launch-policy-core.mjs";

const USAGE = "Usage: node scripts/compile-canary-eligibility.mjs --signed-command <canonical-json> --application <canonical-json> --workflow-canary-result <canonical-json> --trusted-authority-public-key <ed25519-public-pem> --trusted-policy-repository-root <protected-checkout> --expected-policy-base-commit <40-hex>";

try {
  const options = parseArguments(process.argv.slice(2));
  const trustedPolicyRecord = readTrustedLaunchPolicyFromGit({
    repositoryRoot: options.trustedPolicyRepositoryRoot,
    expectedBaseCommit: options.expectedPolicyBaseCommit
  });
  const envelope = compileCanaryEligibilityEnvelope({
    signedCommand: readCanonicalCanaryEligibilityCommandFile(options.signedCommand),
    applicationBytes: readCanaryEligibilityApplicationFile(options.application),
    decisionBytes: readWorkflowCanaryResultFile(options.workflowCanaryResult),
    trustedAuthorityPublicKey: readCanaryEligibilityAuthorityPublicKeyFile(options.trustedAuthorityPublicKey),
    trustedPolicyRecord,
    now: new Date()
  });
  process.stdout.write(`${canonicalJson(envelope)}\n`);
} catch (error) {
  const known = error instanceof CanaryEligibilityError || error instanceof LaunchPolicyError;
  const code = known ? error.code : "CANARY_ELIGIBILITY_COMPILER_FAILED";
  const message = String(error?.message ?? "Canary eligibility compilation failed.").slice(0, 1000);
  process.stderr.write(`${canonicalJson({ code, error: message, status: "rejected" })}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  if (args.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  const allowed = new Set([
    "--application",
    "--expected-policy-base-commit",
    "--signed-command",
    "--trusted-authority-public-key",
    "--trusted-policy-repository-root",
    "--workflow-canary-result"
  ]);
  if (args.length !== allowed.size * 2) throw new CanaryEligibilityError("CANARY_ARGUMENTS_INVALID", USAGE);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || values.has(name) || typeof value !== "string" || value.length < 1 || value.startsWith("--")) {
      throw new CanaryEligibilityError("CANARY_ARGUMENTS_INVALID", USAGE);
    }
    values.set(name, value);
  }
  if (values.size !== allowed.size) throw new CanaryEligibilityError("CANARY_ARGUMENTS_INVALID", USAGE);
  return {
    application: values.get("--application"),
    expectedPolicyBaseCommit: values.get("--expected-policy-base-commit"),
    signedCommand: values.get("--signed-command"),
    trustedAuthorityPublicKey: values.get("--trusted-authority-public-key"),
    trustedPolicyRepositoryRoot: values.get("--trusted-policy-repository-root"),
    workflowCanaryResult: values.get("--workflow-canary-result")
  };
}
