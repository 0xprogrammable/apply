function declaredEvidenceHandler({ evidence, rule }) {
  const missingEvidence = rule.evidence.filter((evidenceId) => !evidencePassed(evidence?.[evidenceId]));
  return Object.freeze({
    passed: missingEvidence.length === 0,
    missingEvidence: Object.freeze(missingEvidence),
    message: missingEvidence.length === 0
      ? "All policy-declared evidence is present and passed."
      : `Missing passed evidence: ${missingEvidence.join(", ")}.`
  });
}

function evidencePassed(value) {
  return value === true || value?.status === "passed";
}

function exactEvidenceHandler({ evidence, rule }, parameterKeys) {
  const [evidenceId] = rule.evidence;
  const value = evidence?.[evidenceId];
  const expectedKeys = [...parameterKeys, "status"].sort();
  const observedKeys = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  const passed = observedKeys.length === expectedKeys.length
    && observedKeys.every((key, index) => key === expectedKeys[index])
    && value.status === "passed"
    && parameterKeys.every((key) => value[key] === rule.parameters?.[key]);
  return Object.freeze({
    passed,
    missingEvidence: Object.freeze(passed ? [] : [evidenceId]),
    message: passed
      ? `Policy evidence ${evidenceId} exactly matches the current rule.`
      : `Policy evidence ${evidenceId} is missing or does not exactly match the current rule.`
  });
}

function ethereumTreasuryTenBpsHandler(context) {
  return exactEvidenceHandler(context, ["basis", "chainId", "hundredthsOfBip", "network", "treasury"]);
}

const COMMON_RULE_HANDLERS = Object.freeze({
  "authenticated-application-v1": declaredEvidenceHandler,
  "declared-evidence-v1": declaredEvidenceHandler,
  "disclosure-v1": declaredEvidenceHandler,
  "exact-public-source-v1": declaredEvidenceHandler,
  "exact-source-v1": declaredEvidenceHandler,
  "hidden-namespace-v1": declaredEvidenceHandler,
  "no-public-routing-v1": declaredEvidenceHandler,
  "no-real-user-funds-v1": declaredEvidenceHandler,
  "v4-identity-permissions-v1": declaredEvidenceHandler
});

const RULE_HANDLERS_BY_POLICY_VERSION = Object.freeze({
  "1.0.0": Object.freeze({
    ...COMMON_RULE_HANDLERS,
    "reproducible-inert-artifact-v1": declaredEvidenceHandler
  }),
  "1.1.0": Object.freeze({
    ...COMMON_RULE_HANDLERS,
    "reproducible-inert-application-record-v1": declaredEvidenceHandler
  }),
  "1.2.0": Object.freeze({
    "ethereum-treasury-10-bps-v1": ethereumTreasuryTenBpsHandler
  })
});

export function ruleHandlersForPolicyVersion(policyVersion) {
  return RULE_HANDLERS_BY_POLICY_VERSION[policyVersion] ?? Object.freeze({});
}
