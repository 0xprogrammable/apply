import crypto from "node:crypto";

import {
  canonicalJson,
  PUBLIC_BETA_DISCLAIMER
} from "../../scripts/verify-public-hook-application-core.mjs";

export const FIXTURE_BUILDER_USER_ID = "9007199254740993";
export const FIXTURE_PRIMARY = Object.freeze({
  repositoryUri: "https://github.com/alice/example-hook",
  numericRepositoryId: "123456789",
  revisionObjectId: "a".repeat(40),
  treeObjectId: "b".repeat(40)
});

export function makeAcceptancePackageFixture({
  applicationId = "example-hook",
  applicationRevision = 1,
  launchPlanPath = "launch/launch-plan.json"
} = {}) {
  const submissionPath = `submissions/${applicationId}/submission.json`;
  const feeSourcePath = "src/ProgrammableFeeHook.sol";
  const feeTestPath = "test/ProgrammableFeeHook.t.sol";
  const primary = {
    ...FIXTURE_PRIMARY,
    sourcePaths: ["compatibility-report.json", launchPlanPath, submissionPath].sort(compareUtf8),
    contractPaths: ["src/ExampleHook.sol", feeSourcePath, feeTestPath].sort(compareUtf8),
    githubActionsRunIds: []
  };
  const programmableFee = makeProgrammableFee({ feeSourcePath, feeTestPath });
  const submissionBytes = sourceSubmissionBytes(applicationId, programmableFee);
  const submissionSha256 = sha256(submissionBytes);
  const files = new Map([
    ["PROPOSAL.md", Buffer.from("# Proposal\nA bounded public application for an exact external GitHub source revision.\n")],
    ["THREAT_MODEL.md", Buffer.from("# Threat model\nPoolManager authority, value conservation, custody, exits, and failure paths require review.\n")],
    ["TEST_PLAN.md", Buffer.from("# Test plan\nRun builder-owned unit, fuzz, invariant, static-analysis, and integration evidence.\n")]
  ]);
  const sourceProjection = {
    numericRepositoryId: primary.numericRepositoryId,
    revisionObjectId: primary.revisionObjectId,
    treeObjectId: primary.treeObjectId
  };
  const evidenceBytes = Buffer.from("exact builder-owned compatibility evidence for the declared source revision\n");
  const evidenceIndex = {
    schemaVersion: 1,
    applicationId,
    source: sourceProjection,
    attestation: "builder-declared-untrusted",
    evidence: [
      {
        id: "unit-tests",
        kind: "unit",
        status: "passed",
        scope: "Builder-owned unit checks for the exact declared source revision.",
        url: `${primary.repositoryUri}/blob/${primary.revisionObjectId}/compatibility-report.json`,
        sha256: sha256(evidenceBytes)
      },
      {
        id: "zz-programmable-fee-submission",
        kind: "static-analysis",
        status: "passed",
        scope: "Exact source submission used by trusted intake to recompute the mandatory Programmable fee projection.",
        url: `${primary.repositoryUri}/blob/${primary.revisionObjectId}/${submissionPath}`,
        sha256: submissionSha256
      }
    ]
  };
  const compatibility = {
    schemaVersion: 1,
    applicationId,
    source: sourceProjection,
    result: "architecture-review-required",
    findings: [],
    disclaimer: PUBLIC_BETA_DISCLAIMER
  };
  files.set("compatibility-report.json", jsonBytes(compatibility));
  files.set("evidence-index.json", jsonBytes(evidenceIndex));
  const application = {
    schemaVersion: 2,
    applicationId,
    applicationRevision,
    stage: "proposal",
    title: "Example external hook application",
    summary: "A public GitHub source binding with a bounded central review package.",
    builder: {
      githubUserId: FIXTURE_BUILDER_USER_ID,
      githubLogin: "alice",
      contact: "https://github.com/alice"
    },
    builderTemplate: {
      schemaVersion: "1.0.0",
      source: "manual",
      templateSelection: null
    },
    source: {
      schemaVersion: "1.0.0",
      primary,
      companions: []
    },
    companionClosure: [],
    programmableFee: {
      ...programmableFee,
      submissionBinding: {
        path: submissionPath,
        sha256: submissionSha256
      }
    },
    reviewPackage: reviewRecords(files),
    declarations: {
      publicInformationAcknowledged: true,
      noSecretsDeclared: true,
      noApprovalClaim: true,
      noUniswapEndorsementClaim: true
    }
  };
  files.set("application.json", jsonBytes(application));
  const launchPlanBytes = jsonBytes({
    applicationId,
    primaryRevisionObjectId: primary.revisionObjectId,
    schemaVersion: "programmable.fixture-launch-plan.v1"
  });
  return { application, files, launchPlanBytes, launchPlanPath, primary };
}

function makeProgrammableFee({ feeSourcePath, feeTestPath }) {
  return {
    policyId: "programmable-volume-fee-v1",
    policyVersion: "1.1.0",
    poolScope: "canonical-launch-pool-key",
    rates: {
      unit: "hundredths-of-bip",
      selectedHundredthsOfBip: 30000,
      minimumEffectiveHundredthsOfBip: 1000,
      effectiveHundredthsOfBip: 30000,
      platformHundredthsOfBip: 1000,
      projectHundredthsOfBip: 29000,
      formula: "effective=max(selected,1000);platform=1000;project=effective-1000",
      lpFeeExcluded: true
    },
    basis: {
      volume: "gross-quote-side-swap-volume",
      quoteAsset: "canonical-pool-quote-asset"
    },
    ownership: {
      owner: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
      immutable: true,
      claimAuthority: "owner-only",
      claimAvailability: "anytime",
      claimDestinationPolicy: "owner-or-owner-selected-per-claim",
      storedMutableRecipient: false,
      builderCanMutate: false,
      projectCanMutate: false,
      administratorCanMutate: false
    },
    collection: {
      status: "implemented",
      integration: "canonical-pool-hook",
      enforcement: "non-bypassable",
      hookFeeMechanismBinding: "hook.feeMechanism",
      supportedSwapModes: [
        "zeroForOne-exactInput",
        "zeroForOne-exactOutput",
        "oneForZero-exactInput",
        "oneForZero-exactOutput"
      ],
      swapModePaths: {
        zeroForOneExactInput: "after-swap-return-delta",
        zeroForOneExactOutput: "after-swap-return-delta",
        oneForZeroExactInput: "after-swap-return-delta",
        oneForZeroExactOutput: "after-swap-return-delta"
      },
      selfCallPolicy: "same-pool-swap-forbidden"
    },
    accounting: {
      accrualMode: "claimable-liability",
      liabilityKeyDimensions: ["poolId", "currency", "owner"],
      crossPoolNetting: false,
      roundingPolicy: "cumulative-independent-platform-project-remainders",
      remainderScope: "canonical-pool-lifetime",
      claimResetsRemainders: false,
      minimumGrossQuoteUnits: 1000,
      fragmentationResistant: true,
      valueFlowId: "programmable-volume-fee",
      collectionEvent: "ProgrammableFeeAccrued(bytes32,address,uint256)",
      claimEvent: "ProgrammableFeeClaimed(address,address,uint256)"
    },
    evidence: {
      sourcePaths: [feeSourcePath],
      testPaths: [feeTestPath]
    }
  };
}

function sourceSubmissionBytes(applicationId, programmableFee) {
  return jsonBytes({
    builderTemplate: {
      schemaVersion: "1.0.0",
      source: "manual",
      templateSelection: null
    },
    model: { id: applicationId },
    programmableFee,
    schemaVersion: 1,
    standardVersion: "1.5.0"
  });
}

function reviewRecords(files) {
  return [...files.entries()]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([fileName, bytes]) => ({
      path: fileName,
      sha256: sha256(bytes),
      byteLength: bytes.length
    }));
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
