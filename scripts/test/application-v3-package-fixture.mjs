import fs from "node:fs";

import { canonicalJson } from "../../vendor/programmable-v4-hook-builder/scripts/submission-core.mjs";
import {
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
  architectureSnapshotSha256,
  sha256Bytes
} from "../../vendor/programmable-v4-hook-builder/scripts/open-world-v2-core.mjs";
import {
  createApplicableOpenWorldV2PrototypeFixture,
  createNoMarketOpenWorldV2PrototypeFixture
} from "../../vendor/programmable-v4-hook-builder/scripts/test/open-world-v2-prototype-fixture.mjs";
import {
  PUBLIC_PR_APPLICATION_V3_BASE_REQUIRED_REVIEW_KINDS
} from "../verify-public-application-v3-core.mjs";

const EXAMPLE_PATH = new URL("./fixtures/public-pr-application-v3.1.example.json", import.meta.url);
const SECURITY_SCHEMA_PATH = new URL(
  "../../vendor/programmable-v4-hook-builder/references/open-world-security-v1.schema.json",
  import.meta.url
);

export function createApplicationV3TestPackage({
  feeMode = "not-selected",
  stage = "prototype",
  applicationId = "legacy-open-world-example",
  applicationRevision = "1",
  lineage = { kind: "new", previous: null },
  builderGithubUserId = "424242",
  builderGithubLogin = "alice",
  sourceRepositoryUri = "https://github.com/alice/example-hook",
  sourceNumericRepositoryId = "123456789",
  sourceRevisionObjectId = "a".repeat(40),
  sourceTreeObjectId = "b".repeat(40)
} = {}) {
  if (!new Set(["proposal", "prototype"]).has(stage)) throw new TypeError("test fixture stage must be proposal or prototype");
  if (stage === "proposal" && feeMode !== "not-selected") throw new TypeError("proposal test fixture supports only the policy-neutral not-selected path");
  const sourcePackage = feeMode === "selected"
    ? createApplicableOpenWorldV2PrototypeFixture(applicationId)
    : stage === "proposal"
      ? createFeeUnselectedV2ProposalFixture(applicationId)
      : createFeeUnselectedV2PrototypeFixture(applicationId);
  const application = JSON.parse(fs.readFileSync(EXAMPLE_PATH, "utf8"));
  const sourcePackageDirectory = `submissions/${applicationId}`;
  const submissionPath = `${sourcePackageDirectory}/submission.v2.json`;
  const applicationPackageFiles = new Map();
  const sourceFiles = new Map();
  const reviewRecords = [];
  const artifactKinds = classifySourcePackageArtifacts(sourcePackage);

  for (const [packagePath, bytes] of sourcePackage.files) {
    const kind = artifactKinds.get(packagePath) ?? "extension-schema";
    if (kind === "trade-capability-manifest" || kind === "trade-test-result") {
      applicationPackageFiles.set(packagePath, Buffer.from(bytes));
      reviewRecords.push(reviewRecord({ kind, path: packagePath, bytes, source: "application-package", repositoryRef: null }));
    } else {
      const repositoryPath = `${sourcePackageDirectory}/${packagePath}`;
      sourceFiles.set(repositoryPath, Buffer.from(bytes));
      reviewRecords.push(reviewRecord({ kind, path: repositoryPath, bytes, source: "source-repository", repositoryRef: "primary" }));
    }
  }

  Object.assign(application, {
    applicationId,
    applicationRevision,
    stage,
    lineage: structuredClone(lineage)
  });
  Object.assign(application.builder, {
    githubUserId: builderGithubUserId,
    githubLogin: builderGithubLogin,
    contact: `https://github.com/${builderGithubLogin}`
  });
  Object.assign(application.source.primary, {
    numericRepositoryId: sourceNumericRepositoryId,
    repositoryUri: sourceRepositoryUri,
    revisionObjectId: sourceRevisionObjectId,
    treeObjectId: sourceTreeObjectId,
    sourceClosureMode: "inline",
    sourcePaths: [...sourceFiles.keys()].sort(compareUtf8),
    sourceManifest: null,
    contractPaths: [],
    githubActionsRunIds: []
  });
  application.source.companions = [];
  application.intentCapture = {
    ...application.intentCapture,
    captureStatus: "captured-verbatim-public-safe",
    originalIdeaDisplayExcerpt: "Build the exact owner-confirmed complete project.",
    agentInterpretationStatus: "owner-confirmed",
    facts: application.intentCapture.facts.map((fact) => ({
      ...fact,
      provenance: "owner-stated",
      confirmationStatus: "confirmed"
    })),
    unresolvedMaterialDecisions: [],
    ideaSourcePath: `${sourcePackageDirectory}/${sourcePackage.submission.intentPackage.ideaSource.path}`,
    ideaSourceRepositoryRef: "primary",
    ideaSourceSha256: sourcePackage.submission.intentPackage.ideaSource.sha256
  };
  application.fidelity = {
    schemaVersion: "1.0.0",
    status: "complete",
    reasonCode: null,
    requirementBindings: []
  };

  const submissionBytes = sourcePackage.files.get("submission.v2.json");
  const policy = application.policyBindings;
  Object.assign(policy, {
    submissionPath,
    submissionRepositoryRef: "primary",
    submissionSha256: sha256Bytes(submissionBytes)
  });
  if (feeMode === "selected") {
    const fee = sourcePackage.submission.programmableFee;
    const schemaBinding = sourcePackage.submission.supportingPackage.feePolicySchema;
    const instanceBinding = sourcePackage.submission.supportingPackage.feePolicy;
    Object.assign(policy, {
      feePolicySchemaId: schemaBinding.schemaId,
      programmableFeePolicyId: fee.policyId,
      programmableFeePolicyVersion: fee.policyVersion,
      programmableFeePolicyHashPreimage: fee.policyHashPreimage,
      programmableFeePolicyHash: fee.policyHash,
      feeApplicability: sourcePackage.feeApplicability,
      feePolicySchemaPath: `${sourcePackageDirectory}/${schemaBinding.path}`,
      feePolicySchemaRepositoryRef: "primary",
      feePolicySchemaSha256: schemaBinding.sha256,
      feePolicyInstancePath: `${sourcePackageDirectory}/${instanceBinding.path}`,
      feePolicyInstanceRepositoryRef: "primary",
      feePolicyInstanceSha256: instanceBinding.sha256
    });
  } else {
    Object.assign(policy, {
      feePolicySchemaId: null,
      programmableFeePolicyId: null,
      programmableFeePolicyVersion: null,
      programmableFeePolicyHashPreimage: null,
      programmableFeePolicyHash: null,
      feeApplicability: "not-selected",
      feePolicySchemaPath: null,
      feePolicySchemaRepositoryRef: null,
      feePolicySchemaSha256: null,
      feePolicyInstancePath: null,
      feePolicyInstanceRepositoryRef: null,
      feePolicyInstanceSha256: null
    });
  }

  const sourcePathsSha256 = sha256Bytes(jsonBytes(application.source.primary.sourcePaths));
  const closureSha256 = sha256Bytes(Buffer.from(
    `test-inline-source-closure-v1\n${canonicalJson(application.source.primary.sourcePaths)}\n`,
    "utf8"
  ));
  const reportPath = "source-closure-verification.primary.json";
  const verificationReport = {
    status: "VERIFIED",
    sourceClosureVerified: true,
    readOnly: true,
    networkAccessed: false,
    candidateCodeExecuted: false,
    dependencyPointerCoverage: dependencyPointerCoverage(),
    sourceBinding: {
      repositoryRef: "primary",
      revisionObjectId: sourceRevisionObjectId,
      treeObjectId: sourceTreeObjectId,
      sourceClosureMode: "inline",
      sourcePaths: [...application.source.primary.sourcePaths],
      sourcePathsSha256,
      closureSha256
    }
  };
  const verificationReportBytes = jsonBytes(verificationReport);
  const verificationReportSha256 = sha256Bytes(verificationReportBytes);
  const persistedCoverage = {
    repositoryRef: "primary",
    revisionObjectId: sourceRevisionObjectId,
    treeObjectId: sourceTreeObjectId,
    sourceClosureMode: "inline",
    sourcePaths: [...application.source.primary.sourcePaths],
    sourcePathsSha256,
    manifestPath: null,
    manifestSha256: null,
    manifestByteLength: null,
    closureSha256,
    reportPath,
    reportSha256: verificationReportSha256,
    reportByteLength: verificationReportBytes.length,
    result: "VERIFIED"
  };
  application.source.verificationReports = [structuredClone(persistedCoverage)];
  const securityAssessment = {
    schemaVersion: "open-world-security-v1",
    subject: {
      id: applicationId,
      revision: sourceRevisionObjectId,
      stage
    },
    assessment: {
      state: "source-assessed",
      reasonCode: null,
      evidenceRefs: [reportPath],
      sourceCoverage: {
        primaryRepositoryRef: "primary",
        repositories: [structuredClone(persistedCoverage)]
      }
    },
    layers: {
      source: {
        evidenceRefs: [reportPath],
        customProfiles: []
      }
    },
    extensions: []
  };
  const securitySchema = JSON.parse(fs.readFileSync(SECURITY_SCHEMA_PATH, "utf8"));
  const securitySchemaBytes = jsonBytes(securitySchema);
  const securityAssessmentBytes = jsonBytes(securityAssessment);
  Object.assign(application.securityBindings, {
    securityAssessmentSchemaPath: "security-assessment-v1.schema.json",
    securityAssessmentSchemaRepositoryRef: null,
    securityAssessmentSchemaSha256: sha256Bytes(securitySchemaBytes),
    securityAssessmentSchemaByteLength: securitySchemaBytes.length,
    securityAssessmentPath: "security-assessment.v1.json",
    securityAssessmentRepositoryRef: null,
    securityAssessmentSha256: sha256Bytes(securityAssessmentBytes),
    securityAssessmentByteLength: securityAssessmentBytes.length
  });

  for (const [kind, filePath, mediaType, bytes] of [
    ["proposal", "PROPOSAL.md", "text/markdown", Buffer.from("# Proposal\n\nExact public review artifact.\n")],
    ["test-plan", "TEST_PLAN.md", "text/markdown", Buffer.from("# Test plan\n\nExact public review artifact.\n")],
    ["threat-model", "THREAT_MODEL.md", "text/markdown", Buffer.from("# Threat model\n\nExact public review artifact.\n")],
    ["compatibility-report", "compatibility-report.json", "application/json", jsonBytes(stage === "proposal"
      ? { result: "architecture-review-required", schemaVersion: 3 }
      : {})],
    ["evidence-index", "evidence-index.json", "application/json", jsonBytes({})],
    ["security-assessment-schema", "security-assessment-v1.schema.json", "application/schema+json", securitySchemaBytes],
    ["security-assessment", "security-assessment.v1.json", "application/json", securityAssessmentBytes],
    ["source-closure-verification", reportPath, "application/json", verificationReportBytes]
  ]) {
    applicationPackageFiles.set(filePath, bytes);
    reviewRecords.push(reviewRecord({ kind, path: filePath, mediaType, bytes, source: "application-package", repositoryRef: null }));
  }
  application.reviewPackage.requiredKinds = [
    ...PUBLIC_PR_APPLICATION_V3_BASE_REQUIRED_REVIEW_KINDS.slice(0, 9),
    ...(feeMode === "selected" ? ["fee-policy-schema"] : []),
    ...PUBLIC_PR_APPLICATION_V3_BASE_REQUIRED_REVIEW_KINDS.slice(9)
  ];
  application.reviewPackage.records = reviewRecords.sort((left, right) => (
    compareUtf8(`${left.source}:${left.repositoryRef ?? ""}:${left.path}:${left.kind}`, `${right.source}:${right.repositoryRef ?? ""}:${right.path}:${right.kind}`)
  ));
  applicationPackageFiles.set("application.v3.json", jsonBytes(application));
  return { application, applicationPackageFiles, sourceFiles, sourcePackage, securityAssessment, verificationReport };
}

function createFeeUnselectedV2PrototypeFixture(applicationId) {
  const original = createNoMarketOpenWorldV2PrototypeFixture(applicationId);
  const submission = structuredClone(original.submission);
  const files = new Map([...original.files].map(([filePath, bytes]) => [filePath, Buffer.from(bytes)]));
  delete submission.programmableFee;
  delete submission.supportingPackage.feePolicy;
  delete submission.supportingPackage.feePolicySchema;
  submission.authorities = submission.authorities.filter(({ id }) => id !== "programmable-fee-owner");
  files.delete("fee-policy-v2.schema.json");
  files.delete("fee-policy.v2.json");
  const intentFidelity = JSON.parse(files.get(OPEN_WORLD_V2_ARTIFACTS.intentFidelity.file));
  intentFidelity.inputDigests.architectureSnapshotSha256 = architectureSnapshotSha256(submission);
  const intentFidelityBytes = jsonBytes(intentFidelity);
  files.set(OPEN_WORLD_V2_ARTIFACTS.intentFidelity.file, intentFidelityBytes);
  submission.intentPackage.intentFidelity = artifactBinding(OPEN_WORLD_V2_ARTIFACTS.intentFidelity, intentFidelityBytes);
  files.set("submission.v2.json", jsonBytes(submission));
  return Object.freeze({ submission, files, feeApplicability: "not-selected" });
}

function createFeeUnselectedV2ProposalFixture(applicationId) {
  const original = createFeeUnselectedV2PrototypeFixture(applicationId);
  const submission = structuredClone(original.submission);
  const files = new Map([...original.files].map(([filePath, bytes]) => [filePath, Buffer.from(bytes)]));
  submission.stage = "proposal";
  submission.project.summary = {
    language: "en",
    text: "A custom tradable project whose exact route architecture remains unresolved for review."
  };
  submission.tradeCapability = {
    applicability: "unresolved",
    facetEntryRef: "routing-trade-capability",
    markets: []
  };
  const intentFidelity = JSON.parse(files.get(OPEN_WORLD_V2_ARTIFACTS.intentFidelity.file));
  intentFidelity.inputDigests.architectureSnapshotSha256 = architectureSnapshotSha256(submission);
  const intentFidelityBytes = jsonBytes(intentFidelity);
  files.set(OPEN_WORLD_V2_ARTIFACTS.intentFidelity.file, intentFidelityBytes);
  submission.intentPackage.intentFidelity = artifactBinding(OPEN_WORLD_V2_ARTIFACTS.intentFidelity, intentFidelityBytes);
  files.set("submission.v2.json", jsonBytes(submission));
  return Object.freeze({ submission, files, feeApplicability: "not-selected" });
}

function classifySourcePackageArtifacts(sourcePackage) {
  const kinds = new Map([["submission.v2.json", "submission"]]);
  for (const binding of Object.values(sourcePackage.submission.intentPackage ?? {})) {
    if (binding?.path) kinds.set(binding.path, binding.artifactType);
  }
  for (const binding of Object.values(sourcePackage.submission.supportingPackage ?? {})) {
    if (binding?.path) kinds.set(binding.path, binding.artifactType);
  }
  for (const artifact of sourcePackage.submission.programmableFee?.conformance?.scopeArtifacts ?? []) {
    for (const binding of [artifact.receipt, artifact.vectorSet]) if (binding?.path) kinds.set(binding.path, binding.artifactType);
  }
  for (const market of sourcePackage.submission.tradeCapability?.markets ?? []) {
    if (market.manifest?.path) {
      kinds.set(market.manifest.path, "trade-capability-manifest");
      const manifest = JSON.parse(sourcePackage.files.get(market.manifest.path));
      for (const test of [...(manifest.testEvidence?.quoteTests ?? []), ...(manifest.testEvidence?.executionTests ?? [])]) {
        kinds.set(test.resultArtifactPath, "trade-test-result");
      }
    }
  }
  return kinds;
}

function reviewRecord({ kind, path, mediaType = "application/json", bytes, source, repositoryRef }) {
  return {
    kind,
    path,
    mediaType,
    byteLength: bytes.length,
    sha256: sha256Bytes(bytes),
    source,
    repositoryRef
  };
}

function artifactBinding(spec, bytes) {
  return {
    artifactType: spec.artifactType,
    schemaId: spec.schemaId,
    path: spec.file,
    sha256: sha256Bytes(bytes),
    byteLength: bytes.length
  };
}

function dependencyPointerCoverage() {
  return {
    schemaVersion: "1.0.0",
    pointerCount: 0,
    pointerRecordsSha256: `sha256:${"0".repeat(64)}`,
    sourceCriticalDereferenceState: "NONE",
    counts: {
      symlink: 0,
      gitlink: 0,
      gitLfs: 0,
      internalVerified: 0,
      targetVerified: 0,
      unresolved: 0,
      sourceCritical: 0,
      runtimeAssetDelegated: 0,
      unclassified: 0
    }
  };
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
