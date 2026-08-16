import path from "node:path";
import { TextDecoder } from "node:util";
import { canonicalJson, validateAgainstSchema } from "../vendor/programmable-v4-hook-builder/scripts/submission-core.mjs";
import { parseBoundedStrictJsonBytes } from "../vendor/programmable-v4-hook-builder/scripts/strict-json-core.mjs";
import {
  PROGRAMMABLE_FEE_V2,
  deriveOpenWorldV2FeeApplicability as deriveLegacySelectedFeeApplicability,
  sha256Bytes
} from "../vendor/programmable-v4-hook-builder/scripts/open-world-v2-core.mjs";
import {
  SOURCE_CLOSURE_MANIFEST_SCHEMA_ID,
  SOURCE_CLOSURE_MANIFEST_VERSION,
  compareUtf8,
  createFindingAdder,
  finalizeReport,
  gitObjectPattern,
  githubRepositoryPattern,
  isObject,
  positiveDecimalPattern,
  publicPrApplicationV3RequiredReviewKinds,
  readJson,
  safeRepositoryPath,
  sha256Pattern
} from "./verify-public-application-v3-shared.mjs";
import {
  findingsHavePrivacyHold,
  privacySafeReport,
  scanPublicPrApplicationV3ArtifactBytes,
  validatePublicApplicationText
} from "../vendor/programmable-v4-hook-builder/scripts/public-pr-application-v3-privacy.mjs";
import { validateSourceClosure } from "../vendor/programmable-v4-hook-builder/scripts/public-pr-application-v3-source-validation.mjs";
import {
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS
} from "../vendor/programmable-v4-hook-builder/scripts/open-world-v2-contracts.mjs";
import { isRepositorySchemaBinding } from "../vendor/programmable-v4-hook-builder/scripts/open-world-v2-package-io.mjs";
import { generatePublicPrApplicationV3 } from "./verify-public-application-v3-generation.mjs";
import {
  validateCurrentOpenWorldV2Package,
  validateLegacyFeeV2OpenWorldV2Package
} from "./verify-open-world-v2-package.mjs";

const applicationSchema = readJson(
  new URL("../intake/schemas/public-pr-application-v3.schema.json", import.meta.url)
);
const openWorldSecurityV1Bytes = Buffer.from(`${canonicalJson(readJson(
  new URL("../vendor/programmable-v4-hook-builder/references/open-world-security-v1.schema.json", import.meta.url)
))}\n`, "utf8");
const APPLICATION_V3_ROOT_FILE = "application.v3.json";
const MAXIMUM_APPLICATION_V3_FILE_BYTES = 4 * 1024 * 1024;
const MAXIMUM_APPLICATION_V3_MANIFEST_BYTES = 256 * 1024;
const MAXIMUM_APPLICATION_V3_PACKAGE_BYTES = 12 * 1024 * 1024;
const MAXIMUM_APPLICATION_V3_PACKAGE_FILES = 100;
const APPLICATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export {
  PUBLIC_PR_APPLICATION_V3_BASE_REQUIRED_REVIEW_KINDS,
  PUBLIC_PR_APPLICATION_V3_REQUIRED_REVIEW_KINDS,
  publicPrApplicationV3RequiredReviewKinds
} from "./verify-public-application-v3-shared.mjs";

export class PublicApplicationV3IntakeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicApplicationV3IntakeError";
    this.code = code;
  }
}

function rejectApplicationV3(code, message) {
  throw new PublicApplicationV3IntakeError(code, message);
}

export function deriveApplicationV3FeeApplicabilityFromSubmissionV2(submission) {
  const feeV2Selected = submission?.programmableFee !== undefined
    || submission?.supportingPackage?.feePolicySchema !== undefined;
  return feeV2Selected ? deriveLegacySelectedFeeApplicability(submission) : "not-selected";
}

export function validatePublicApplicationV3SubmissionV2Bytes({
  application,
  submissionBytes,
  sourceArtifacts,
  packageFiles
}) {
  if (
    !(submissionBytes instanceof Uint8Array)
    || !isObject(application?.policyBindings)
    || !(sourceArtifacts instanceof Map)
    || !(packageFiles instanceof Map)
  ) {
    rejectApplicationV3("APPLICATION_V3_SUBMISSION_INVALID", "Application V3 Submission V2 validation received malformed inputs.");
  }
  const bytes = Buffer.from(submissionBytes);
  if (sha256Bytes(bytes) !== application.policyBindings.submissionSha256) {
    rejectApplicationV3("APPLICATION_V3_SUBMISSION_MISMATCH", "Application V3 must bind the exact Submission V2 byte digest.");
  }
  let submission;
  try {
    submission = parseBoundedStrictJsonBytes(bytes, {
      maxSourceBytes: MAXIMUM_APPLICATION_V3_FILE_BYTES,
      maxDepth: 256,
      maxNodes: 250_000,
      maxNumberCharacters: MAXIMUM_APPLICATION_V3_FILE_BYTES
    });
  } catch (error) {
    rejectApplicationV3(error?.code ?? "APPLICATION_V3_SUBMISSION_INVALID", "The bound Submission V2 artifact is not bounded strict JSON.");
  }
  let source;
  try {
    source = strictUtf8.decode(bytes);
  } catch {
    rejectApplicationV3("APPLICATION_V3_SUBMISSION_INVALID", "The bound Submission V2 artifact is not valid UTF-8.");
  }
  if (source !== `${canonicalJson(submission)}\n`) {
    rejectApplicationV3("APPLICATION_V3_SUBMISSION_INVALID", "The bound Submission V2 artifact must be canonical JSON followed by one LF.");
  }
  const packageValidation = validateCompleteSubmissionV2Package({
    application,
    submission,
    submissionBytes: bytes,
    sourceArtifacts,
    packageFiles
  });
  const feeApplicability = packageValidation.feeApplicability;
  if (application.policyBindings.feeApplicability !== feeApplicability) {
    rejectApplicationV3(
      "APPLICATION_V3_FEE_APPLICABILITY_MISMATCH",
      "Application V3 feeApplicability must equal the state derived from exact Submission V2 bytes."
    );
  }
  return Object.freeze({ feeApplicability, submission, artifactCount: packageValidation.artifactCount });
}

/**
 * Validate one already-hydrated immutable Application V3 revision package.
 * Applicant bytes remain inert: this function performs bounded parsing,
 * schema/semantic checks, digest checks, and privacy scanning only.
 */
export function validatePublicApplicationV3PackageFiles({
  applicationId,
  applicationRevision,
  packageFiles,
  expectedBuilderLogin,
  expectedBuilderUserId
}) {
  if (
    !APPLICATION_ID_PATTERN.test(applicationId ?? "")
    || !positiveDecimalPattern.test(applicationRevision ?? "")
    || !(packageFiles instanceof Map)
    || packageFiles.size < 1
    || packageFiles.size > MAXIMUM_APPLICATION_V3_PACKAGE_FILES
  ) {
    rejectApplicationV3("APPLICATION_V3_PACKAGE_INVALID", "The immutable Application V3 package identity or file set is malformed.");
  }
  const applicationBytes = packageFiles.get(APPLICATION_V3_ROOT_FILE);
  if (!(applicationBytes instanceof Uint8Array) || applicationBytes.length > MAXIMUM_APPLICATION_V3_MANIFEST_BYTES) {
    rejectApplicationV3("APPLICATION_V3_ROOT_INVALID", "application.v3.json is missing or exceeds its trusted byte limit.");
  }
  const normalizedFiles = new Map();
  let totalBytes = 0;
  for (const [filePath, value] of packageFiles) {
    if (!safeRepositoryPath(filePath) || !(value instanceof Uint8Array)) {
      rejectApplicationV3("APPLICATION_V3_PACKAGE_PATH_INVALID", "An Application V3 package file has an unsafe path or byte representation.");
    }
    const bytes = Buffer.from(value);
    const maximumBytes = filePath === APPLICATION_V3_ROOT_FILE
      ? MAXIMUM_APPLICATION_V3_MANIFEST_BYTES
      : MAXIMUM_APPLICATION_V3_FILE_BYTES;
    if (bytes.length < 1 || bytes.length > maximumBytes) {
      rejectApplicationV3("APPLICATION_V3_PACKAGE_FILE_TOO_LARGE", "An Application V3 package file exceeds its trusted byte limit.");
    }
    totalBytes += bytes.length;
    if (totalBytes > MAXIMUM_APPLICATION_V3_PACKAGE_BYTES) {
      rejectApplicationV3("APPLICATION_V3_PACKAGE_TOO_LARGE", "The Application V3 package exceeds its trusted aggregate byte limit.");
    }
    normalizedFiles.set(filePath, bytes);
  }

  const application = parseCanonicalApplicationV3Json(applicationBytes, APPLICATION_V3_ROOT_FILE, MAXIMUM_APPLICATION_V3_MANIFEST_BYTES);
  const report = validatePublicPrApplicationV3(application);
  if (report.valid !== true) {
    const first = report.findings.find(({ severity }) => severity === "blocker");
    const error = new PublicApplicationV3IntakeError(
      first?.code ?? "APPLICATION_V3_CONTRACT_INVALID",
      first?.message ?? "application.v3.json does not satisfy the accepted V3.1 contract."
    );
    error.report = report;
    throw error;
  }
  if (
    application.contract?.id !== "public-pr-application-v3"
    || application.contract?.version !== "3.1.0"
    || application.schemaVersion !== 3
    || application.applicationId !== applicationId
    || application.applicationRevision !== applicationRevision
  ) {
    rejectApplicationV3("APPLICATION_V3_PATH_BINDING_MISMATCH", "Application V3 identity and revision must match the immutable central path.");
  }
  if (String(application.builder?.githubUserId) !== String(expectedBuilderUserId)) {
    rejectApplicationV3("BUILDER_ID_PR_AUTHOR_MISMATCH", "Application V3 builder id must equal the authenticated pull-request author id.");
  }
  if (
    typeof expectedBuilderLogin !== "string"
    || application.builder?.githubLogin?.toLowerCase() !== expectedBuilderLogin.toLowerCase()
  ) {
    rejectApplicationV3("BUILDER_LOGIN_PR_AUTHOR_MISMATCH", "Application V3 builder login must identify the authenticated pull-request author.");
  }

  const applicationRecords = application.reviewPackage.records
    .filter((record) => record.source === "application-package")
    .map((record) => ({
      path: record.path,
      mediaType: record.mediaType,
      byteLength: record.byteLength,
      sha256: record.sha256
    }));
  const expectedPaths = [APPLICATION_V3_ROOT_FILE, ...applicationRecords.map(({ path: filePath }) => filePath)]
    .sort(compareUtf8);
  const observedPaths = [...normalizedFiles.keys()].sort(compareUtf8);
  if (
    new Set(expectedPaths).size !== expectedPaths.length
    || canonicalJson(expectedPaths) !== canonicalJson(observedPaths)
  ) {
    rejectApplicationV3("APPLICATION_V3_PACKAGE_NOT_CLOSED", "The revision directory must contain exactly application.v3.json and its bound application-package records.");
  }
  for (const record of applicationRecords) {
    const bytes = normalizedFiles.get(record.path);
    if (
      bytes.length !== record.byteLength
      || sha256Bytes(bytes) !== record.sha256
    ) {
      rejectApplicationV3("APPLICATION_V3_PACKAGE_DIGEST_MISMATCH", "An application-package record differs from its exact byte binding.");
    }
    if (record.mediaType === "application/json" || record.mediaType === "application/schema+json") {
      parseCanonicalApplicationV3Json(bytes, record.path, MAXIMUM_APPLICATION_V3_FILE_BYTES);
    }
    const privacy = scanPublicPrApplicationV3ArtifactBytes({
      bytes,
      path: record.path,
      mediaType: record.mediaType
    });
    if (privacy.valid !== true) {
      rejectApplicationV3("APPLICATION_PUBLIC_ARTIFACT_SENSITIVE", "An application-package artifact contains blocked public data.");
    }
  }
  validateMaterializedApplicationV3Package({ application, normalizedFiles });
  if (
    application.reviewState.status !== "unreviewed"
    || application.reviewState.inheritedApproval !== false
    || application.reviewState.acceptancePath !== null
    || application.reviewState.acceptanceSha256 !== null
    || application.declarations.noApprovalClaim !== true
    || application.declarations.noInheritedApproval !== true
  ) {
    rejectApplicationV3("APPLICATION_V3_AUTHORITY_INVALID", "Application V3 intake cannot claim review, acceptance, or approval authority.");
  }
  return Object.freeze({ application, applicationRecords: Object.freeze(applicationRecords), report, totalBytes });
}

function validateMaterializedApplicationV3Package({ application, normalizedFiles }) {
  const recordsByPath = new Map(application.reviewPackage.records
    .filter(({ source }) => source === "application-package")
    .map((record) => [record.path, { ...record, bytes: normalizedFiles.get(record.path) }]));
  const securitySchemaPath = application.securityBindings?.securityAssessmentSchemaPath;
  const securitySchemaRecord = recordsByPath.get(securitySchemaPath);
  if (
    securitySchemaPath !== "security-assessment-v1.schema.json"
    || securitySchemaRecord?.mediaType !== "application/schema+json"
    || !Buffer.from(securitySchemaRecord?.bytes ?? []).equals(openWorldSecurityV1Bytes)
  ) {
    rejectApplicationV3("APPLICATION_V3_MATERIALIZATION_INVALID", "The package does not contain the exact trusted Application V3 security schema bytes.");
  }
  const readApplicationJson = (artifactPath, label) => {
    const record = recordsByPath.get(artifactPath);
    if (record?.mediaType !== "application/json" || !(record.bytes instanceof Uint8Array)) {
      rejectApplicationV3("APPLICATION_V3_MATERIALIZATION_INVALID", `${label} is not one exact application-package JSON artifact.`);
    }
    return { document: parseCanonicalApplicationV3Json(record.bytes, label, MAXIMUM_APPLICATION_V3_FILE_BYTES), record };
  };
  const { document: securityAssessment } = readApplicationJson(
    application.securityBindings?.securityAssessmentPath,
    "source-assessed security assessment"
  );
  const persistedReports = application.source?.verificationReports;
  if (!Array.isArray(persistedReports) || persistedReports.length === 0) {
    rejectApplicationV3("APPLICATION_V3_MATERIALIZATION_INVALID", "The package has no persisted source-verification reports.");
  }
  const sourceCoverage = persistedReports.map((binding) => {
    const { document: verificationReport, record } = readApplicationJson(
      binding?.reportPath,
      `source-verification report for ${binding?.repositoryRef ?? "unknown repository"}`
    );
    if (record.sha256 !== binding.reportSha256 || record.byteLength !== binding.reportByteLength) {
      rejectApplicationV3("APPLICATION_V3_MATERIALIZATION_INVALID", "A source-verification report differs from its persisted byte binding.");
    }
    return {
      repositoryRef: binding.repositoryRef,
      revisionObjectId: binding.revisionObjectId,
      treeObjectId: binding.treeObjectId,
      sourceClosureMode: binding.sourceClosureMode,
      sourcePaths: binding.sourcePaths,
      sourcePathsSha256: binding.sourcePathsSha256,
      manifestPath: binding.manifestPath,
      manifestSha256: binding.manifestSha256,
      manifestByteLength: binding.manifestByteLength,
      closureSha256: binding.closureSha256,
      verificationReportPath: binding.reportPath,
      verificationReportSha256: binding.reportSha256,
      verificationReportByteLength: binding.reportByteLength,
      verificationReport
    };
  });
  const securityEvidenceBindings = [...collectApplicationV3EvidenceRefs(securityAssessment)]
    .sort(compareUtf8)
    .map((evidenceRef) => {
      const matches = application.reviewPackage.records.filter(({ path: recordPath }) => recordPath === evidenceRef);
      if (matches.length !== 1) {
        rejectApplicationV3("APPLICATION_V3_MATERIALIZATION_INVALID", "A security evidence reference does not resolve to exactly one review-package record.");
      }
      const [record] = matches;
      return {
        evidenceRef,
        kind: record.kind,
        path: record.path,
        repositoryRef: record.repositoryRef,
        sha256: record.sha256,
        source: record.source
      };
    });
  const generated = generatePublicPrApplicationV3({
    application,
    securityAssessment,
    sourceCoverage,
    securityEvidenceBindings
  });
  if (
    generated.materializationAllowed !== true
    || generated.report?.valid !== true
    || canonicalJson(generated.application) !== canonicalJson(application)
  ) {
    rejectApplicationV3(
      "APPLICATION_V3_MATERIALIZATION_INVALID",
      "The package is not the exact output of the trusted source-verified Application V3 materializer."
    );
  }
}

function collectApplicationV3EvidenceRefs(value) {
  const refs = new Set();
  const stack = [value];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    visited += 1;
    if (visited > 250_000 || stack.length > 250_000) {
      rejectApplicationV3("APPLICATION_V3_MATERIALIZATION_INVALID", "The security assessment exceeds the bounded evidence-reference scan.");
    }
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) stack.push(current[index]);
    } else if (isObject(current)) {
      for (const [key, child] of Object.entries(current)) {
        if (key === "evidenceRefs" && Array.isArray(child)) {
          for (const ref of child) if (typeof ref === "string") refs.add(ref);
        } else {
          stack.push(child);
        }
      }
    }
  }
  return refs;
}

function validateCompleteSubmissionV2Package({
  application,
  submission,
  submissionBytes,
  sourceArtifacts,
  packageFiles
}) {
  const policy = application.policyBindings;
  const repositoryRef = policy.submissionRepositoryRef;
  const submissionPath = policy.submissionPath;
  if (
    submission?.$schema !== "urn:programmable:v4-hook-submission:2.0.0"
    || submission?.schemaVersion !== 2
    || submission?.standardVersion !== "2.0.0"
    || submission?.applicationId !== application.applicationId
    || submission?.stage !== application.stage
    || typeof repositoryRef !== "string"
    || !safeRepositoryPath(submissionPath ?? "")
  ) {
    rejectApplicationV3("APPLICATION_V3_SUBMISSION_INVALID", "The bound source artifact is not the exact Submission V2 contract for this application.");
  }
  const packageDirectory = path.posix.dirname(submissionPath);
  const resolveArtifactPath = (relativePath) => {
    if (!safeRepositoryPath(relativePath ?? "") || path.posix.isAbsolute(relativePath)) {
      rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "The V2 package contains an unsafe artifact path.");
    }
    const resolved = packageDirectory === "."
      ? relativePath
      : path.posix.join(packageDirectory, relativePath);
    const relativeResolved = path.posix.relative(packageDirectory, resolved);
    if (
      !safeRepositoryPath(resolved)
      || relativeResolved === ".."
      || relativeResolved.startsWith("../")
      || path.posix.isAbsolute(relativeResolved)
    ) {
      rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "A V2 artifact escapes its package directory.");
    }
    return resolved;
  };
  const parseExactJson = (bytes, label) => parseCanonicalApplicationV3Json(
    bytes,
    label,
    MAXIMUM_APPLICATION_V3_FILE_BYTES
  );
  const boundArtifacts = [];
  const requireReviewRecord = ({ kind, artifactPath, bytes, source, artifactRepositoryRef }) => {
    const matches = application.reviewPackage.records.filter((record) => (
      record.kind === kind
      && record.source === source
      && record.repositoryRef === artifactRepositoryRef
      && record.path === artifactPath
      && record.sha256 === sha256Bytes(bytes)
      && record.byteLength === bytes.length
    ));
    if (matches.length !== 1) {
      rejectApplicationV3("APPLICATION_V2_REVIEW_BINDING_MISMATCH", "Every consumed V2 artifact must have one exact review-package byte binding.");
    }
  };
  const readSourceBinding = (binding, kind, label) => {
    if (
      !isObject(binding)
      || typeof binding.path !== "string"
      || !sha256Pattern.test(binding.sha256 ?? "")
      || !Number.isSafeInteger(binding.byteLength)
      || binding.byteLength < 1
    ) {
      rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", `The V2 ${label} binding is incomplete.`);
    }
    const repositoryPath = resolveArtifactPath(binding.path);
    const bytes = sourceArtifacts.get(`${repositoryRef}\0${repositoryPath}`);
    if (
      !(bytes instanceof Uint8Array)
      || bytes.length !== binding.byteLength
      || sha256Bytes(bytes) !== binding.sha256
    ) {
      rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", `The exact V2 ${label} bytes differ from their content binding.`);
    }
    const normalized = Buffer.from(bytes);
    requireReviewRecord({
      kind,
      artifactPath: repositoryPath,
      bytes: normalized,
      source: "source-repository",
      artifactRepositoryRef: repositoryRef
    });
    const artifact = { kind, repositoryPath, packagePath: binding.path, bytes: normalized };
    boundArtifacts.push(artifact);
    return { ...artifact, value: parseExactJson(normalized, `V2 ${label}`) };
  };
  const readTradeBinding = (binding, kind, label) => {
    if (
      !isObject(binding)
      || typeof binding.path !== "string"
      || !sha256Pattern.test(binding.sha256 ?? "")
      || !Number.isSafeInteger(binding.byteLength)
      || binding.byteLength < 1
    ) {
      rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", `The V2 ${label} binding is incomplete.`);
    }
    const repositoryPath = resolveArtifactPath(binding.path);
    const packagePath = path.posix.relative(packageDirectory, repositoryPath);
    const bytes = packageFiles.get(packagePath);
    if (
      !safeRepositoryPath(packagePath)
      || !(bytes instanceof Uint8Array)
      || bytes.length !== binding.byteLength
      || sha256Bytes(bytes) !== binding.sha256
    ) {
      rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", `The exact V2 ${label} mirror differs from its source binding.`);
    }
    const normalized = Buffer.from(bytes);
    requireReviewRecord({
      kind,
      artifactPath: packagePath,
      bytes: normalized,
      source: "application-package",
      artifactRepositoryRef: null
    });
    const artifact = { kind, repositoryPath, packagePath, bytes: normalized };
    boundArtifacts.push(artifact);
    return { ...artifact, value: parseExactJson(normalized, `V2 ${label}`) };
  };
  const readTradeResult = (relativePath, label) => {
    const repositoryPath = resolveArtifactPath(relativePath);
    const packagePath = path.posix.relative(packageDirectory, repositoryPath);
    const matches = application.reviewPackage.records.filter((record) => (
      record.kind === "trade-test-result"
      && record.source === "application-package"
      && record.repositoryRef === null
      && record.path === packagePath
    ));
    const bytes = packageFiles.get(packagePath);
    if (
      !safeRepositoryPath(packagePath)
      || matches.length !== 1
      || !(bytes instanceof Uint8Array)
      || bytes.length !== matches[0].byteLength
      || sha256Bytes(bytes) !== matches[0].sha256
    ) {
      rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", `The exact V2 ${label} mirror is missing or differs from its review binding.`);
    }
    const normalized = Buffer.from(bytes);
    boundArtifacts.push({ kind: "trade-test-result", repositoryPath, packagePath, bytes: normalized });
    return { value: parseExactJson(normalized, `V2 ${label}`), bytes: normalized };
  };

  requireReviewRecord({
    kind: "submission",
    artifactPath: submissionPath,
    bytes: submissionBytes,
    source: "source-repository",
    artifactRepositoryRef: repositoryRef
  });
  boundArtifacts.push({ kind: "submission", repositoryPath: submissionPath, packagePath: "submission.v2.json", bytes: submissionBytes });

  const records = {};
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_ARTIFACTS)) {
    const artifact = readSourceBinding(submission.intentPackage?.[key], spec.artifactType, spec.artifactType);
    records[key] = { value: artifact.value, bytes: artifact.bytes };
  }
  const supportingRecords = {};
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS)) {
    const binding = submission.supportingPackage?.[key];
    if (key === "feePolicySchema" && binding === undefined) continue;
    if (key === "securityAssessment" && binding === null) continue;
    const artifact = readSourceBinding(binding, spec.artifactType, spec.artifactType);
    supportingRecords[key] = { value: artifact.value, bytes: artifact.bytes };
  }
  const feePolicyBinding = submission.supportingPackage?.feePolicy;
  if (feePolicyBinding !== null && feePolicyBinding !== undefined) {
    const spec = OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS.feePolicy;
    const artifact = readSourceBinding(feePolicyBinding, spec.artifactType, spec.artifactType);
    supportingRecords.feePolicy = { value: artifact.value, bytes: artifact.bytes };
  }
  const scopeArtifacts = submission.programmableFee?.conformance?.scopeArtifacts;
  if (Array.isArray(scopeArtifacts) && scopeArtifacts.length > 0) {
    supportingRecords.feeConformance = scopeArtifacts.map((artifact, index) => {
      const entry = { feeScopeRef: artifact?.feeScopeRef };
      for (const key of ["receipt", "vectorSet"]) {
        const binding = artifact?.[key];
        const resolved = readSourceBinding(binding, binding?.artifactType, `fee conformance ${key} ${index + 1}`);
        entry[key] = { value: resolved.value, bytes: resolved.bytes };
      }
      return entry;
    });
  }
  const tradeMarkets = submission.tradeCapability?.markets;
  if (Array.isArray(tradeMarkets) && tradeMarkets.length > 0) {
    const consumed = new Set();
    supportingRecords.tradeCapabilities = tradeMarkets.map((market, index) => {
      const manifestBinding = market?.manifest;
      const manifest = readTradeBinding(manifestBinding, manifestBinding?.artifactType, `trade capability manifest ${index + 1}`);
      consumed.add(manifest.packagePath);
      const entry = {
        marketRef: market?.marketRef,
        manifest: { value: manifest.value, bytes: manifest.bytes },
        quoteResults: [],
        executionResults: []
      };
      for (const [testsKey, recordsKey] of [["quoteTests", "quoteResults"], ["executionTests", "executionResults"]]) {
        const tests = manifest.value?.testEvidence?.[testsKey];
        if (!Array.isArray(tests)) continue;
        entry[recordsKey] = tests.map((test, testIndex) => {
          const resultPath = test?.resultArtifactPath;
          if (consumed.has(resultPath)) {
            rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "Each V2 trade test must own one distinct result artifact path.");
          }
          consumed.add(resultPath);
          const result = readTradeResult(resultPath, `trade ${testsKey} result ${testIndex + 1}`);
          return { testId: test?.id, result: { value: result.value, bytes: result.bytes } };
        });
      }
      return entry;
    });
  }
  const extensionSchemaBytes = {};
  for (const extensionPath of collectSubmissionV2ExtensionSchemaPaths({ submission, records, supportingRecords })) {
    const repositoryPath = resolveArtifactPath(extensionPath);
    const bytes = sourceArtifacts.get(`${repositoryRef}\0${repositoryPath}`);
    if (!(bytes instanceof Uint8Array)) {
      rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "One exact V2 extension schema is missing from the pinned source package.");
    }
    const normalized = Buffer.from(bytes);
    parseExactJson(normalized, "V2 extension schema");
    extensionSchemaBytes[extensionPath] = normalized;
    if (!boundArtifacts.some((artifact) => artifact.repositoryPath === repositoryPath)) {
      requireReviewRecord({
        kind: "extension-schema",
        artifactPath: repositoryPath,
        bytes: normalized,
        source: "source-repository",
        artifactRepositoryRef: repositoryRef
      });
      boundArtifacts.push({ kind: "extension-schema", repositoryPath, packagePath: extensionPath, bytes: normalized });
    }
  }
  const feeV2Selected = submission.programmableFee !== undefined
    || submission.supportingPackage?.feePolicySchema !== undefined;
  const validateSourcePackage = feeV2Selected
    ? validateLegacyFeeV2OpenWorldV2Package
    : validateCurrentOpenWorldV2Package;
  const report = validateSourcePackage({
    submission,
    submissionBytes,
    records,
    supportingRecords,
    extensionSchemaBytes
  });
  if (report?.valid !== true) {
    rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "The complete exact Submission V2 source package failed its authoritative validator.");
  }
  const feeApplicability = deriveApplicationV3FeeApplicabilityFromSubmissionV2(submission);
  const schemaArtifact = boundArtifacts.find(({ kind }) => kind === "fee-policy-schema");
  const schemaTuple = [
    policy.feePolicySchemaRepositoryRef,
    policy.feePolicySchemaPath,
    policy.feePolicySchemaSha256
  ];
  if (feeV2Selected && (
    schemaTuple[0] !== repositoryRef
    || schemaTuple[1] !== schemaArtifact?.repositoryPath
    || schemaTuple[2] !== sha256Bytes(schemaArtifact?.bytes ?? Buffer.alloc(0))
  )) {
    rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "Application V3 differs from the exact selected Fee V2 schema binding.");
  } else if (!feeV2Selected && (schemaArtifact !== undefined || schemaTuple.some((value) => value !== null))) {
    rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "An unselected Fee V2 contract must not fabricate a schema binding.");
  }
  const feeArtifacts = boundArtifacts.filter(({ kind }) => kind === "fee-policy");
  const instanceTuple = [
    policy.feePolicyInstanceRepositoryRef,
    policy.feePolicyInstancePath,
    policy.feePolicyInstanceSha256
  ];
  if (feeApplicability === "applicable") {
    if (
      feeArtifacts.length !== 1
      || instanceTuple[0] !== repositoryRef
      || instanceTuple[1] !== feeArtifacts[0].repositoryPath
      || instanceTuple[2] !== sha256Bytes(feeArtifacts[0].bytes)
    ) {
      rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "Application V3 differs from the exact applicable Fee V2 instance binding.");
    }
  } else if (
    (feePolicyBinding !== null && feePolicyBinding !== undefined)
    || feeArtifacts.length !== 0
    || instanceTuple.some((value) => value !== null)
  ) {
    rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "A non-applicable, unresolved, or unselected fee state carries a forbidden policy instance.");
  }
  return Object.freeze({ feeApplicability, artifactCount: boundArtifacts.length });
}

function collectSubmissionV2ExtensionSchemaPaths(value) {
  const paths = new Set();
  const stack = [value];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    visited += 1;
    if (visited > 250_000 || stack.length > 250_000) {
      rejectApplicationV3("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "The V2 package exceeds the bounded extension-schema discovery window.");
    }
    if (Array.isArray(current)) {
      for (const entry of current) stack.push(entry);
    } else if (isObject(current)) {
      if (isRepositorySchemaBinding(current)) paths.add(current.path);
      for (const entry of Object.values(current)) stack.push(entry);
    }
  }
  return [...paths].sort(compareUtf8);
}

function parseCanonicalApplicationV3Json(bytes, label, maximumBytes) {
  let document;
  try {
    document = parseBoundedStrictJsonBytes(bytes, {
      maxSourceBytes: maximumBytes,
      maxDepth: 256,
      maxNodes: 250_000,
      maxNumberCharacters: maximumBytes
    });
  } catch (error) {
    rejectApplicationV3(error?.code ?? "APPLICATION_V3_JSON_INVALID", `${label} is not bounded strict UTF-8 JSON.`);
  }
  let source;
  try {
    source = strictUtf8.decode(bytes);
  } catch {
    rejectApplicationV3("APPLICATION_V3_JSON_UTF8_INVALID", `${label} is not valid UTF-8.`);
  }
  if (source !== `${canonicalJson(document)}\n`) {
    rejectApplicationV3("APPLICATION_V3_JSON_NOT_CANONICAL", `${label} must be canonical JSON followed by one LF.`);
  }
  return document;
}

export function derivePublicPrApplicationV3PreviousBinding({
  application,
  applicationSha256,
  packageSha256
}) {
  const source = application?.source?.primary;
  const policy = application?.policyBindings;
  const submissionStandard = application?.contract?.submissionStandard;
  if (
    application?.contract?.id !== "public-pr-application-v3"
    || application?.contract?.version !== "3.1.0"
    || application?.schemaVersion !== 3
    || !positiveDecimalPattern.test(application?.applicationRevision ?? "")
    || !sha256Pattern.test(applicationSha256 ?? "")
    || !sha256Pattern.test(packageSha256 ?? "")
    || typeof submissionStandard !== "string"
    || !isObject(source)
    || !isObject(policy)
  ) {
    throw new TypeError("immutable predecessor does not satisfy the derivable public-pr-application-v3 lineage contract");
  }
  return Object.freeze({
    applicationContract: application.contract.id,
    applicationSchemaVersion: application.schemaVersion,
    applicationRevision: application.applicationRevision,
    applicationSha256,
    packageSha256,
    sourceNumericRepositoryId: source.numericRepositoryId,
    sourceCommit: source.revisionObjectId,
    sourceTree: source.treeObjectId,
    submissionSchemaId: `urn:programmable:v4-hook-submission:${submissionStandard}`,
    submissionStandard,
    submissionPath: policy.submissionPath,
    submissionSha256: policy.submissionSha256,
    feePolicyId: policy.programmableFeePolicyId,
    feePolicyVersion: policy.programmableFeePolicyVersion,
    feeApplicability: policy.feeApplicability,
    feePolicyInstanceSha256: policy.feePolicyInstanceSha256
  });
}

/**
 * Project the exact added-only path set that one Application V3 pull request
 * would expose. This is intentionally transport-independent so Registry CI can
 * enforce the same uniqueness and review-window invariant as the client.
 */
export function projectPublicPrApplicationV3DiffPaths({
  priorPaths,
  currentPaths,
  maxFiles = 3000
}) {
  if (
    !Array.isArray(priorPaths)
    || !Array.isArray(currentPaths)
    || !Number.isSafeInteger(maxFiles)
    || maxFiles < 1
  ) {
    throw new TypeError("Application V3 diff projection inputs are invalid");
  }
  const combined = [...priorPaths, ...currentPaths];
  if (combined.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new TypeError("Application V3 diff projection contains an invalid path");
  }
  if (new Set(combined).size !== combined.length) {
    const error = new TypeError("Application V3 diff projection contains a duplicate or overlapping path");
    error.code = "APPLICATION_V3_DIFF_PATH_COLLISION";
    throw error;
  }
  if (combined.length > maxFiles) {
    const error = new RangeError("Application V3 diff projection exceeds the exact review window");
    error.code = "APPLICATION_V3_DIFF_REVIEW_BUDGET_EXCEEDED";
    error.projectedFileCount = combined.length;
    error.maxFiles = maxFiles;
    throw error;
  }
  return Object.freeze([...combined].sort(compareUtf8));
}

export function validatePublicPrApplicationV3(application, { schema = applicationSchema } = {}) {
  const findings = [];
  const seen = new Set();
  const add = createFindingAdder(findings, seen);

  for (const finding of validateAgainstSchema(application, schema)) {
    const toolingTransport = finding.path.includes(".sourcePaths") && finding.code === "SCHEMA_MAX_ITEMS";
    add(
      "blocker",
      finding.code,
      finding.path,
      finding.message,
      toolingTransport
        ? "Use the content-addressed sourceManifest mode or split the tooling review; the product idea remains eligible."
        : "Make the application match the closed public-pr-application-v3 contract.",
      toolingTransport ? "tooling-transport" : "application-contract"
    );
  }

  if (!isObject(application)) {
    return applicationReport(findings);
  }

  validatePublicApplicationText(application, add);
  validateLineage(application.lineage, application.applicationRevision, add);
  validateIntentAndFidelity(application.intentCapture, application.fidelity, add);
  validatePolicyBindings(application.policyBindings, application.stage, add);
  validateReviewPackage(application.reviewPackage, application.policyBindings, application.stage, application.intentCapture, add);
  validateSecurityBindings(application.securityBindings, application.reviewPackage, add);
  validateReviewState(application.reviewState, application.declarations, add);
  validateSourceClosure(
    application.source,
    application.policyBindings,
    application.securityBindings,
    application.intentCapture,
    application.reviewPackage,
    add
  );

  return applicationReport(findings);
}

function validateLineage(lineage, applicationRevision, add) {
  if (!isObject(lineage)) return;
  if (!positiveDecimalPattern.test(applicationRevision ?? "")) {
    add("blocker", "APPLICATION_REVISION_INVALID", "$.applicationRevision", "Application revision must be one canonical positive decimal string.", "Emit the exact decimal revision without Number coercion, leading zeroes, exponents, or a numeric cap.", "lineage");
    return;
  }
  if (lineage.kind === "new" && lineage.previous !== null) {
    add("blocker", "APPLICATION_LINEAGE_NEW_HAS_PREVIOUS", "$.lineage.previous", "A new application cannot claim a previous application.", "Set previous to null or select the exact update lineage.", "lineage");
  }
  if (lineage.kind === "new" && applicationRevision !== "1") {
    add("blocker", "APPLICATION_LINEAGE_NEW_REVISION_INVALID", "$.applicationRevision", "A new application starts at canonical revision 1.", "Use revision \"1\"; later changes increment from exact lineage.", "lineage");
  }
  if (lineage.kind !== "new" && !isObject(lineage.previous)) {
    add("blocker", "APPLICATION_LINEAGE_PREVIOUS_MISSING", "$.lineage.previous", "An update, migration, or recheck must bind its exact previous application.", "Add the immutable previous application, package, source, submission, and historical fee projection bindings.", "lineage");
    return;
  }
  if (lineage.kind !== "new") {
    const previousContract = lineage.previous?.applicationContract;
    const previousSchemaVersion = lineage.previous?.applicationSchemaVersion;
    if (
      !new Set(["public-pr-application-v2", "public-pr-application-v3"]).has(previousContract)
      || (previousContract === "public-pr-application-v2" && previousSchemaVersion !== 2)
      || (previousContract === "public-pr-application-v3" && previousSchemaVersion !== 3)
    ) {
      add("blocker", "APPLICATION_LINEAGE_PREVIOUS_CONTRACT_INVALID", "$.lineage.previous.applicationContract", "Previous application contract and schema version must select one exact supported V2 or V3 lineage shape.", "Use an authenticated public-pr-application-v2 schema migration or the complete derived public-pr-application-v3 predecessor binding.", "lineage");
    }
    const previousRevision = lineage.previous?.applicationRevision;
    if (!positiveDecimalPattern.test(previousRevision ?? "")) {
      add("blocker", "APPLICATION_LINEAGE_PREVIOUS_REVISION_INVALID", "$.lineage.previous.applicationRevision", "Previous application revision must be one canonical positive decimal string.", "Preserve the exact historical decimal revision without Number coercion.", "lineage");
    } else if (applicationRevision !== incrementCanonicalDecimal(previousRevision)) {
      add("blocker", "APPLICATION_LINEAGE_REVISION_SEQUENCE_INVALID", "$.applicationRevision", "Application revision must be exactly the prior canonical decimal revision plus one.", "Increment the exact decimal string with arbitrary-precision semantics and regenerate all revision-bound evidence.", "lineage");
    }
    const previousFeeApplicability = lineage.previous?.feeApplicability;
    const previousFeeIdentity = [
      lineage.previous?.feePolicyId,
      lineage.previous?.feePolicyVersion
    ];
    if (
      previousFeeApplicability === "not-selected"
      && (
        previousFeeIdentity.some((value) => value !== null)
        || lineage.previous?.feePolicyInstanceSha256 !== null
      )
    ) {
      add("blocker", "APPLICATION_LINEAGE_PREVIOUS_FEE_NOT_SELECTED_INVALID", "$.lineage.previous", "A predecessor that did not select Fee V2 must preserve null fee identity and instance fields.", "Preserve the exact all-null historical fee projection for not-selected lineage.", "lineage");
    }
  }
}

function incrementCanonicalDecimal(value) {
  const digits = [...value];
  let carry = 1;
  for (let index = digits.length - 1; index >= 0 && carry === 1; index -= 1) {
    if (digits[index] === "9") {
      digits[index] = "0";
    } else {
      digits[index] = String(Number(digits[index]) + 1);
      carry = 0;
    }
  }
  if (carry === 1) digits.unshift("1");
  return digits.join("");
}

function validateIntentAndFidelity(intent, fidelity, add) {
  if (!isObject(intent)) return;
  const facts = Array.isArray(intent.facts) ? intent.facts : [];
  const factIds = new Set();
  for (const [index, fact] of facts.entries()) {
    if (!isObject(fact)) continue;
    if (factIds.has(fact.id)) {
      add("blocker", "APPLICATION_INTENT_FACT_ID_DUPLICATE", `$.intentCapture.facts[${index}].id`, "Intent fact IDs must be unique.", "Merge duplicate facts or assign distinct stable IDs.", "intent-provenance");
    }
    factIds.add(fact.id);
    if (["legacy-declared", "agent-derived"].includes(fact.provenance) && fact.confirmationStatus !== "unconfirmed") {
      add("blocker", "APPLICATION_DERIVED_FACT_CONFIRMATION_INVALID", `$.intentCapture.facts[${index}].confirmationStatus`, "Legacy or agent-derived prose cannot inherit or invent owner confirmation.", "Keep the fact unconfirmed until the owner supplies a new, attributable confirmation.", "intent-provenance");
    }
  }

  if (intent.captureStatus === "captured-verbatim-public-safe") {
    if (intent.originalIdeaDisplayExcerpt !== null && (typeof intent.originalIdeaDisplayExcerpt !== "string" || intent.originalIdeaDisplayExcerpt.trim().length === 0)) {
      add("blocker", "APPLICATION_IDEA_DISPLAY_EXCERPT_INVALID", "$.intentCapture.originalIdeaDisplayExcerpt", "The optional non-normative display excerpt must be null or non-empty text.", "Keep the content-addressed idea-source artifact as the sole normative intent truth.", "intent-privacy");
    }
  } else if (intent.captureStatus === "redacted-sensitive") {
    if (intent.originalIdeaDisplayExcerpt !== null || intent.agentInterpretationStatus !== "unconfirmed") {
      add("blocker", "APPLICATION_REDACTED_INTENT_STATE_INVALID", "$.intentCapture", "Redacted intent must keep its display excerpt null and agent interpretation unconfirmed.", "Remove sensitive prose and keep derived facts unconfirmed.", "intent-privacy");
    }
  } else if (intent.captureStatus === "unavailable-legacy") {
    if (intent.originalIdeaDisplayExcerpt !== null || intent.agentInterpretationStatus !== "unconfirmed") {
      add("blocker", "APPLICATION_LEGACY_INTENT_STATE_INVALID", "$.intentCapture", "Unavailable legacy intent must keep its display excerpt null and remain unconfirmed.", "Recapture the owner intent in a new revision; never infer confirmation from legacy prose.", "intent-provenance");
    }
    if (facts.some((fact) => fact?.confirmationStatus !== "unconfirmed")) {
      add("blocker", "APPLICATION_LEGACY_FACT_CONFIRMATION_INVALID", "$.intentCapture.facts", "Every unavailable-legacy fact must remain unconfirmed.", "Recapture owner intent before confirming any migrated fact.", "intent-provenance");
    }
    if (
      !isObject(fidelity)
      || fidelity.status !== "unassessed"
      || fidelity.reasonCode !== "ORIGINAL_INTENT_UNAVAILABLE"
      || !Array.isArray(fidelity.requirementBindings)
      || fidelity.requirementBindings.length !== 0
    ) {
      add("blocker", "APPLICATION_LEGACY_FIDELITY_INVALID", "$.fidelity", "Fidelity must remain unassessed when original owner intent is unavailable.", "Recapture and confirm intent before creating requirement bindings or a fidelity result.", "intent-fidelity");
    }
  }
}

function validatePolicyBindings(policy, stage, add) {
  if (!isObject(policy)) return;
  const feeV2Selected = policy.feeApplicability !== "not-selected";
  const feeIdentity = {
    feePolicySchemaId: PROGRAMMABLE_FEE_V2.policySchemaId,
    programmableFeePolicyId: PROGRAMMABLE_FEE_V2.policyId,
    programmableFeePolicyVersion: PROGRAMMABLE_FEE_V2.policyVersion,
    programmableFeePolicyHashPreimage: PROGRAMMABLE_FEE_V2.policyHashPreimage,
    programmableFeePolicyHash: PROGRAMMABLE_FEE_V2.policyHash
  };
  const feeSchemaFields = [
    "feePolicySchemaPath",
    "feePolicySchemaRepositoryRef",
    "feePolicySchemaSha256"
  ];
  if (!feeV2Selected) {
    for (const field of [...Object.keys(feeIdentity), ...feeSchemaFields]) {
      if (policy[field] !== null) {
        add("blocker", "APPLICATION_FEE_NOT_SELECTED_BINDING_INVALID", `$.policyBindings.${field}`, "A Submission V2 that does not select legacy Fee V2 must not fabricate a fee identity or schema binding.", "Set every Fee V2 identity, schema, and instance field to null.", "fee-policy");
      }
    }
  } else {
    for (const [field, expected] of Object.entries(feeIdentity)) {
      if (policy[field] !== expected) {
        add("blocker", "APPLICATION_FEE_V2_BINDING_INVALID", `$.policyBindings.${field}`, "Applications that select legacy Fee V2 must bind its exact active policy identity; Fee V1 is historical lineage only.", "Use the exact versioned Fee V2 constants and preserve older policy data only under lineage.previous.", "fee-policy");
      }
    }
    for (const field of feeSchemaFields) {
      if (policy[field] === null) {
        add("blocker", "APPLICATION_FEE_V2_SCHEMA_BINDING_MISSING", `$.policyBindings.${field}`, "A selected legacy Fee V2 contract requires the exact schema path, repository, and digest tuple.", "Bind the exact Fee V2 schema selected by Submission V2.", "fee-policy");
      }
    }
  }
  const instanceFields = [
    policy.feePolicyInstancePath,
    policy.feePolicyInstanceRepositoryRef,
    policy.feePolicyInstanceSha256
  ];
  if (stage === "proposal" && !new Set(["unresolved", "not-selected"]).has(policy.feeApplicability)) {
    add("blocker", "APPLICATION_PROPOSAL_FEE_APPLICABILITY_INVALID", "$.policyBindings.feeApplicability", "A proposal may keep selected Fee V2 applicability unresolved or explicitly record that Fee V2 was not selected.", "Use unresolved for selected legacy Fee V2 or not-selected with the all-null fee tuple.", "fee-policy-role-separation");
  }
  if (stage === "prototype" && policy.feeApplicability === "unresolved") {
    add("blocker", "APPLICATION_PROTOTYPE_FEE_APPLICABILITY_UNRESOLVED", "$.policyBindings.feeApplicability", "A prototype cannot leave Fee applicability unresolved.", "Revalidate the exact bound V2 source package and select applicable or exact zero-scope not-applicable.", "fee-policy-role-separation");
  }
  if (policy.feeApplicability === "applicable" && instanceFields.some((value) => value === null)) {
    add("blocker", "APPLICATION_PROTOTYPE_FEE_INSTANCE_REQUIRED", "$.policyBindings", "An applicable prototype must bind one real scoped Fee V2 policy instance.", "Create fee-policy.v2.json with exact scopes and bind its repository, path, and hash.", "fee-policy-role-separation");
  }
  if (policy.feeApplicability !== "applicable" && instanceFields.some((value) => value !== null)) {
    const code = policy.feeApplicability === "not-applicable"
      ? "APPLICATION_FEE_NOT_APPLICABLE_INSTANCE_FORBIDDEN"
      : "APPLICATION_PROPOSAL_FEE_INSTANCE_FORBIDDEN";
    add("blocker", code, "$.policyBindings", "A non-applicable or unresolved Fee state cannot carry a scoped Fee V2 instance binding.", "Keep all feePolicyInstance fields null unless the exact bound V2 package derives applicable.", "fee-policy-role-separation");
  }
  if (policy.feePolicySchemaPath === policy.feePolicyInstancePath && policy.feePolicyInstancePath !== null) {
    add("blocker", "APPLICATION_FEE_SCHEMA_INSTANCE_ROLE_COLLISION", "$.policyBindings", "Fee policy schema and scoped instance cannot share one path.", "Use fee-policy-v2.schema.json for schema bytes and fee-policy.v2.json for the real instance.", "fee-policy-role-separation");
  }
}

function validateReviewPackage(reviewPackage, policy, stage, intent, add) {
  if (!isObject(reviewPackage)) return;
  const feeV2Selected = policy?.feeApplicability !== "not-selected";
  const requiredReviewKinds = publicPrApplicationV3RequiredReviewKinds({ feeV2Selected });
  if (canonicalJson(reviewPackage.requiredKinds) !== canonicalJson(requiredReviewKinds)) {
    add("blocker", "APPLICATION_REVIEW_REQUIRED_KINDS_INVALID", "$.reviewPackage.requiredKinds", "The semantic review-kind contract is missing, reordered, or expanded as if optional records were mandatory.", "Use the exact required-kind list; add novel evidence as extra open records.", "review-package");
  }
  const records = Array.isArray(reviewPackage.records) ? reviewPackage.records : [];
  const kinds = new Set(records.map((record) => record?.kind));
  for (const kind of requiredReviewKinds) {
    if (!kinds.has(kind)) {
      add("blocker", "APPLICATION_REVIEW_RECORD_KIND_MISSING", "$.reviewPackage.records", `Required semantic review record ${kind} is missing.`, "Bind at least one exact record of every required semantic kind.", "review-package", { requiredKind: kind });
    }
  }
  const recordIdentities = new Set();
  for (const [index, record] of records.entries()) {
    if (!isObject(record)) continue;
    const identity = `${record.source}:${record.repositoryRef ?? "application-package"}:${record.path}`;
    if (recordIdentities.has(identity)) {
      add("blocker", "APPLICATION_REVIEW_RECORD_DUPLICATE", `$.reviewPackage.records[${index}]`, "A review package path is bound more than once for the same source.", "Keep one content-addressed record per source and path.", "review-package");
    }
    recordIdentities.add(identity);
    if (!Number.isSafeInteger(record.byteLength) || record.byteLength < 1) {
      add("blocker", "APPLICATION_REVIEW_RECORD_SIZE_INVALID", `$.reviewPackage.records[${index}].byteLength`, "Review record byteLength must be one positive safe integer.", "Bind the exact byte length without losing integer precision.", "review-package");
    }
  }
  if (isObject(intent)) {
    const ideaSourceRecord = records.find((record) => (
      record?.kind === "idea-source"
      && record?.source === "source-repository"
      && record?.repositoryRef === intent.ideaSourceRepositoryRef
      && record?.path === intent.ideaSourcePath
      && record?.sha256 === intent.ideaSourceSha256
    ));
    if (!ideaSourceRecord) {
      add("blocker", "APPLICATION_IDEA_SOURCE_REVIEW_BINDING_MISMATCH", "$.reviewPackage.records", "Normative idea-source path and hash do not match an exact review record.", "Bind intentCapture to the same content-addressed idea-source artifact used by review.", "intent-provenance");
    }
  }
  if (isObject(policy)) {
    const feeSchemaRecords = records.filter((record) => record?.kind === "fee-policy-schema");
    const feeSchemaRecord = feeSchemaRecords.find((record) => (
      record?.kind === "fee-policy-schema"
      && record?.source === "source-repository"
      && record?.repositoryRef === policy.feePolicySchemaRepositoryRef
      && record?.path === policy.feePolicySchemaPath
      && record?.sha256 === policy.feePolicySchemaSha256
    ));
    if (feeV2Selected && !feeSchemaRecord) {
      add("blocker", "APPLICATION_FEE_SCHEMA_REVIEW_BINDING_MISMATCH", "$.reviewPackage.records", "The Fee V2 schema path and hash do not match a source-repository fee-policy-schema record.", "Bind the same exact immutable schema bytes in policyBindings and reviewPackage.records.", "fee-policy-role-separation");
    } else if (!feeV2Selected && feeSchemaRecords.length !== 0) {
      add("blocker", "APPLICATION_FEE_NOT_SELECTED_SCHEMA_RECORD_FORBIDDEN", "$.reviewPackage.records", "A Submission V2 that does not select legacy Fee V2 cannot carry a fee-policy-schema review record.", "Remove every Fee V2 schema record from the not-selected application.", "fee-policy-role-separation");
    }
    const feeInstanceRecords = records.filter((record) => record?.kind === "fee-policy");
    if (stage === "prototype" && policy.feeApplicability === "applicable") {
      const matchingFeeInstanceRecords = feeInstanceRecords.filter((record) => (
        record?.kind === "fee-policy"
        && record?.source === "source-repository"
        && record?.repositoryRef === policy.feePolicyInstanceRepositoryRef
        && record?.path === policy.feePolicyInstancePath
        && record?.sha256 === policy.feePolicyInstanceSha256
      ));
      if (feeInstanceRecords.length !== 1 || matchingFeeInstanceRecords.length !== 1) {
        add("blocker", "APPLICATION_FEE_INSTANCE_REVIEW_BINDING_MISMATCH", "$.reviewPackage.records", "The prototype Fee V2 instance does not match an exact source-repository fee-policy record.", "Bind the real scoped fee-policy.v2.json instance, never the schema bytes.", "fee-policy-role-separation");
      }
    } else if (feeInstanceRecords.length !== 0) {
      const code = policy.feeApplicability === "not-applicable"
        ? "APPLICATION_FEE_NOT_APPLICABLE_REVIEW_RECORD_FORBIDDEN"
        : "APPLICATION_FEE_UNRESOLVED_REVIEW_RECORD_FORBIDDEN";
      add("blocker", code, "$.reviewPackage.records", "A non-applicable or unresolved Fee state cannot carry a fee-policy review record.", "Remove every fee-policy record unless the exact bound V2 package derives applicable.", "fee-policy-role-separation");
    }
  }
}

function validateSecurityBindings(security, reviewPackage, add) {
  if (!isObject(security)) return;
  if (security.securityAssessmentSchemaId !== "urn:programmable:open-world-security:1.0.0") {
    add("blocker", "APPLICATION_SECURITY_SCHEMA_ID_INVALID", "$.securityBindings.securityAssessmentSchemaId", "Security assessment must bind the stable open-world security schema URN.", "Use urn:programmable:open-world-security:1.0.0 and exact schema bytes.", "security-role-separation");
  }
  if (security.securityAssessmentSchemaPath === security.securityAssessmentPath) {
    add("blocker", "APPLICATION_SECURITY_SCHEMA_INSTANCE_ROLE_COLLISION", "$.securityBindings", "Security schema and assessment instance cannot share one path.", "Use security-assessment-v1.schema.json for schema bytes and security-assessment.v1.json for the instance.", "security-role-separation");
  }
  const records = Array.isArray(reviewPackage?.records) ? reviewPackage.records : [];
  const schemaRecord = records.find((record) => (
    record?.kind === "security-assessment-schema"
    && record?.source === "application-package"
    && record?.repositoryRef === null
    && record?.path === security.securityAssessmentSchemaPath
    && record?.sha256 === security.securityAssessmentSchemaSha256
    && record?.byteLength === security.securityAssessmentSchemaByteLength
  ));
  if (!schemaRecord) {
    add("blocker", "APPLICATION_SECURITY_SCHEMA_REVIEW_BINDING_MISMATCH", "$.reviewPackage.records", "Security schema path, hash, and byte length do not match one application-package schema record.", "Bind the exact stable schema bytes in the derived application package.", "security-role-separation");
  }
  const assessmentRecord = records.find((record) => (
    record?.kind === "security-assessment"
    && record?.source === "application-package"
    && record?.repositoryRef === null
    && record?.path === security.securityAssessmentPath
    && record?.sha256 === security.securityAssessmentSha256
    && record?.byteLength === security.securityAssessmentByteLength
  ));
  if (!assessmentRecord) {
    add("blocker", "APPLICATION_SECURITY_ASSESSMENT_REVIEW_BINDING_MISMATCH", "$.reviewPackage.records", "Derived security assessment path and hash do not match one application-package security-assessment record.", "Create the assessment only after pinning source, then bind its exact application-package bytes with repositoryRef null.", "security-role-separation");
  }
  if (security.securityAssessmentRepositoryRef !== null) {
    add("blocker", "APPLICATION_SECURITY_ASSESSMENT_SELF_REFERENCE_FORBIDDEN", "$.securityBindings.securityAssessmentRepositoryRef", "A source-assessed instance cannot live in the source commit whose identity it contains.", "Keep the stable schema in source, but materialize the derived assessment in the application package with repositoryRef null.", "security-role-separation");
  }
  if (security.securityAssessmentSchemaRepositoryRef !== null) {
    add("blocker", "APPLICATION_SECURITY_SCHEMA_SOURCE_BINDING_FORBIDDEN", "$.securityBindings.securityAssessmentSchemaRepositoryRef", "The security schema used for the derived assessment must travel in the same application package, not claim membership in the pinned source closure.", "Bind the exact bundled schema bytes with repositoryRef null.", "security-role-separation");
  }
}

function validateReviewState(reviewState, declarations, add) {
  if (
    !isObject(reviewState)
    || reviewState.status !== "unreviewed"
    || reviewState.inheritedApproval !== false
    || reviewState.acceptancePath !== null
    || reviewState.acceptanceSha256 !== null
  ) {
    add("blocker", "APPLICATION_REVIEW_STATE_INVALID", "$.reviewState", "A submitted v3 application must be unreviewed and cannot inherit or invent acceptance.", "Reset review state; only maintainers create a separate acceptance after review.", "approval-boundary");
  }
  if (
    !isObject(declarations)
    || declarations.noApprovalClaim !== true
    || declarations.noInheritedApproval !== true
    || declarations.historicalEvidencePreserved !== true
  ) {
    add("blocker", "APPLICATION_APPROVAL_DECLARATION_INVALID", "$.declarations", "The application must disclaim approval, forbid inherited approval, and preserve historical evidence.", "Restore all approval-boundary declarations to true.", "approval-boundary");
  }
}


function applicationReport(findings) {
  const privacyHeld = findingsHavePrivacyHold(findings);
  const report = finalizeReport("public-pr-application-v3-validation", findings, {
    applicationContract: "public-pr-application-v3",
    ideaEligibility: "ELIGIBLE_FOR_REVIEW",
    publicApplicationEligibility: privacyHeld ? "HELD_FOR_PRIVACY_REDACTION" : "ELIGIBLE_FOR_REVIEW",
    approvalGranted: false
  });
  const statusReport = {
    ...report,
    status: privacyHeld ? "HELD_FOR_PRIVACY_REDACTION" : report.status
  };
  return privacyHeld ? privacySafeReport(statusReport) : statusReport;
}
