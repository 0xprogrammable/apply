#!/usr/bin/env node

import process from "node:process";

import {
  verifyWorkflowCanary,
  WorkflowCanaryError
} from "./workflow-canary-core.mjs";
import { canonicalJson } from "./launch-policy-core.mjs";

const valueOptions = new Map([
  ["--base-root", "baseRoot"],
  ["--candidate-root", "candidateRoot"],
  ["--expected-base-commit", "expectedBaseCommit"],
  ["--expected-base-repository", "expectedBaseRepository"],
  ["--expected-base-repository-id", "expectedBaseRepositoryId"],
  ["--expected-builder-login", "expectedBuilderLogin"],
  ["--expected-builder-user-id", "expectedBuilderUserId"],
  ["--expected-candidate-commit", "expectedCandidateCommit"],
  ["--expected-head-repository", "expectedHeadRepository"],
  ["--expected-head-repository-id", "expectedHeadRepositoryId"],
  ["--expected-merge-commit", "expectedMergeCommit"],
  ["--pull-request-number", "pullRequestNumber"]
]);

try {
  const options = parseArguments(process.argv.slice(2));
  const result = await verifyWorkflowCanary(options);
  // Verification has already semantically revalidated the embedded decision
  // against the exact protected policy record.
  process.stdout.write(`${canonicalJson(result)}\n`);
} catch (error) {
  const known = error instanceof WorkflowCanaryError;
  const kind = known ? error.kind : "system";
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    result: kind === "candidate" ? "invalid-workflow-canary" : "system-blocked",
    code: known ? error.code : "UNEXPECTED_CANARY_FAILURE",
    message: known ? error.message : "The protected workflow-canary validator failed unexpectedly."
  })}\n`);
  process.exitCode = kind === "candidate" ? 1 : 2;
}

function parseArguments(args) {
  if (args.length === 1 && new Set(["--help", "help"]).has(args[0])) {
    process.stdout.write("Usage: verify-workflow-canary.mjs with the authenticated pull-request identity options documented in docs/WORKFLOW_CANARY.md\n");
    process.exit(0);
  }
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const key = valueOptions.get(option);
    if (!key) throw new WorkflowCanaryError("CANARY_CLI_ARGUMENT_INVALID", "Protected canary CLI received an unsupported argument.", { kind: "system" });
    if (Object.hasOwn(parsed, key)) throw new WorkflowCanaryError("CANARY_CLI_ARGUMENT_DUPLICATE", "Protected canary CLI option was repeated.", { kind: "system" });
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new WorkflowCanaryError("CANARY_CLI_VALUE_MISSING", "Protected canary CLI option is missing its value.", { kind: "system" });
    parsed[key] = value;
    index += 1;
  }
  if (Object.keys(parsed).length !== valueOptions.size) {
    throw new WorkflowCanaryError("CANARY_CLI_ARGUMENT_MISSING", "Protected canary CLI requires the complete authenticated pull-request identity.", { kind: "system" });
  }
  return parsed;
}
