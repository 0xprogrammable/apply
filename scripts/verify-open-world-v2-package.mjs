import { createOpenWorldV2ValidationRuntime } from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";
import { validateOpenWorldV2Intent } from "./verify-open-world-v2-validation-intent.mjs";
import { validateOpenWorldV2Graph } from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";
import { finalizeOpenWorldV2Validation } from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";
import { validateOpenWorldV2Intake } from "./verify-open-world-v2-validation-intake.mjs";
import { validateOpenWorldV2Fee } from "./verify-open-world-v2-validation-fee.mjs";

export function validateCurrentOpenWorldV2Package(options = {}) {
  return validateOpenWorldV2PackageWithProfile(options, "current-central-policy-consumer");
}

export function validateLegacyFeeV2OpenWorldV2Package(options = {}) {
  return validateOpenWorldV2PackageWithProfile(options, "frozen-legacy-fee-v2");
}

function validateOpenWorldV2PackageWithProfile(options, validationProfile) {
  const context = createOpenWorldV2ValidationRuntime(options);
  context.validationProfile = validationProfile;
  const earlyReport = validateOpenWorldV2Intake(context);
  if (earlyReport !== null) return reportForSelectedSubmission(earlyReport, options.submission);
  if (validationProfile === "frozen-legacy-fee-v2" && options.submission?.standardVersion !== "2.0.0") {
    context.add("blocker", "FROZEN_LEGACY_SUBMISSION_VERSION_REQUIRED", "$", "The frozen legacy Fee V2 entrypoint accepts only exact Submission 2.0 bytes.");
  }
  validateOpenWorldV2Intent(context);
  validateOpenWorldV2Graph(context);
  validateOpenWorldV2Fee(context);
  return reportForSelectedSubmission(finalizeOpenWorldV2Validation(context), options.submission);
}

function reportForSelectedSubmission(report, submission) {
  const acceptedVersion = new Set(["2.0.0", "2.1.0"]).has(submission?.standardVersion)
    ? submission.standardVersion
    : report.standardVersion;
  return Object.freeze({ ...report, standardVersion: acceptedVersion });
}
