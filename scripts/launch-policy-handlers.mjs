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

export const RULE_HANDLERS = Object.freeze({
  "authenticated-application-v1": declaredEvidenceHandler,
  "declared-evidence-v1": declaredEvidenceHandler,
  "disclosure-v1": declaredEvidenceHandler,
  "exact-public-source-v1": declaredEvidenceHandler,
  "exact-source-v1": declaredEvidenceHandler,
  "hidden-namespace-v1": declaredEvidenceHandler,
  "no-public-routing-v1": declaredEvidenceHandler,
  "no-real-user-funds-v1": declaredEvidenceHandler,
  "reproducible-inert-artifact-v1": declaredEvidenceHandler,
  "v4-identity-permissions-v1": declaredEvidenceHandler
});
