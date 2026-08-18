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
  if (earlyReport !== null) return earlyReport;
  validateOpenWorldV2Intent(context);
  validateOpenWorldV2Graph(context);
  validateOpenWorldV2Fee(context);
  return finalizeOpenWorldV2Validation(context);
}
