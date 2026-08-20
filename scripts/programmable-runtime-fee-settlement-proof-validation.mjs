import crypto from "node:crypto";
import path from "node:path";
import { TextDecoder } from "node:util";

import { parseBoundedLosslessJson } from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";
import {
  canonicalFeeConformanceReceiptBytesV1,
  validateFeeConformanceReceiptV1
} from "../vendor/programmable-v4-hook-builder/scripts/fee-conformance-receipt-v1-core.mjs";

export const PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_PROOF_SCHEMA_ID =
  "urn:programmable:runtime-fee-settlement-observation-assertion-v1:1.0.0";
export const PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_PROOF_VERSION = "1.0.0";
export const PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_PROOF_KIND =
  "programmable-runtime-fee-settlement-observation-assertion";
export const PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_PROOF_STATUS = "analysis-pending";
export const PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_PROOF_REASON_CODE =
  "runtime-fee-verifier-trust-root-unavailable";
export const PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_PROOF_ASSURANCE =
  "protected-accounting-assertion-not-finality-or-settlement-proof";
export const PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_VERIFICATION_PROFILE =
  "ethereum-finalized-fee-settlement-v1";
export const PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_OBSERVER_ID =
  "programmable-protected-runtime-fee-observer-v1";
export const PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_FINALITY_MODE =
  "ethereum-consensus-finalized";
export const PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_OBSERVATION_SCOPE =
  "one-fee-scope-one-asset-one-inclusive-finalized-range";

const BUNDLE_ROOT = "platform-evidence/runtime-fee-settlement/bundles";
const TREASURY = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
const BASIS = "gross-canonical-pool-volume";
const HUNDREDTHS_OF_BIP = 1000;
const RATE_DENOMINATOR = 1_000_000;
export const MAXIMUM_RUNTIME_FEE_SETTLEMENT_PROOF_BYTES = 2 * 1024 * 1024;
export const MAXIMUM_RUNTIME_FEE_SETTLEMENT_BUNDLE_BYTES = 16 * 1024 * 1024;
const MAXIMUM_EVENTS = 4096;
const UINT256_MAX = (1n << 256n) - 1n;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
export const RUNTIME_FEE_SETTLEMENT_SHA1 = /^(?!0{40}$)[0-9a-f]{40}$/u;
const SHA256 = /^sha256:(?!0{64}$)[0-9a-f]{64}$/u;
const BYTES32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9A-Fa-f]{40}$/u;
const ZERO_ADDRESS = "0x" + "0".repeat(40);
const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,77}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const GITHUB_URI = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[A-Za-z0-9._/-]+$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

const LIMIT_KEYS = [
  "applicantAssertionAccepted",
  "auditClaim",
  "continuousMonitoringClaim",
  "coverage",
  "currentLiquidityClaim",
  "currentTradabilityClaim",
  "fundsAuthority",
  "futureCollectionClaim",
  "futureSettlementClaim",
  "launchAuthority",
  "providerAssertionAccepted",
  "registryWriteAuthority",
  "safetyClaim",
  "sellabilityClaim",
  "terminalSupportClaim"
];

const canonicalJson = canonicalRuntimeFeeSettlementJsonV1;
const deepFreeze = deepFreezeRuntimeFeeSettlementV1;
const exactKeys = requireExactRuntimeFeeSettlementKeysV1;
const fail = failRuntimeFeeSettlementV1;
const isObject = isRuntimeFeeSettlementObjectV1;
const parseCanonicalJsonBytes = parseCanonicalRuntimeFeeSettlementJsonBytesV1;
const requireObject = requireRuntimeFeeSettlementObjectV1;
const safePath = isSafeRuntimeFeeSettlementPathV1;
const sha256 = runtimeFeeSettlementSha256V1;

export class ProgrammableRuntimeFeeSettlementProofError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "ProgrammableRuntimeFeeSettlementProofError";
    this.code = code;
  }
}

export function parseProgrammableRuntimeFeeSettlementProofBytesV1(bytes) {
  const buffer = toBoundedBuffer(bytes, MAXIMUM_RUNTIME_FEE_SETTLEMENT_PROOF_BYTES, "RUNTIME_FEE_PROOF_SIZE_INVALID");
  const proof = parseCanonicalJsonBytes(
    buffer,
    "RUNTIME_FEE_PROOF_JSON_INVALID",
    "RUNTIME_FEE_PROOF_JSON_NONCANONICAL"
  );
  validateProgrammableRuntimeFeeSettlementProofV1(proof);
  deepFreeze(proof);
  return Object.freeze({
    bytes: buffer,
    proof,
    sha256: sha256(buffer)
  });
}

export function validateProgrammableRuntimeFeeSettlementProofV1(proof) {
  requireObject(proof, "proof");
  exactKeys(proof, [
    "$schema",
    "assurance",
    "bindings",
    "evidence",
    "kind",
    "limits",
    "proofId",
    "range",
    "reasonCode",
    "runtime",
    "schemaVersion",
    "settlement",
    "status",
    "subject"
  ], "proof");
  if (
    proof.$schema !== PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_PROOF_SCHEMA_ID
    || proof.schemaVersion !== PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_PROOF_VERSION
    || proof.kind !== PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_PROOF_KIND
    || proof.status !== PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_PROOF_STATUS
    || proof.reasonCode !== PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_PROOF_REASON_CODE
    || proof.assurance !== PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_PROOF_ASSURANCE
    || !validSlug(proof.proofId)
  ) {
    fail("RUNTIME_FEE_PROOF_IDENTITY_INVALID", "Runtime fee settlement observation assertion identity is invalid.");
  }

  validateSubject(proof.subject);
  validateBindings(proof.bindings, proof.subject);
  validateRuntime(proof.runtime, proof);
  validateRange(proof.range, proof.runtime);
  validateSettlement(proof.settlement, proof.runtime, proof.range, proof.bindings.feeConformance);
  validateEvidence(proof.evidence);
  validateLimits(proof.limits);
  validateEmbeddedFeeConformance(proof);
  return true;
}

export function canonicalProgrammableRuntimeFeeSettlementProofJsonV1(value) {
  return canonicalJson(value);
}

export function digestProgrammableRuntimeFeeSettlementProofBytesV1(bytes) {
  return sha256(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []));
}

function validateSubject(subject) {
  requireObject(subject, "proof.subject");
  exactKeys(subject, ["applicationId", "applicationRevision", "projectId"], "proof.subject");
  if (
    !validSlug(subject.applicationId)
    || !validSlug(subject.projectId)
    || !Number.isSafeInteger(subject.applicationRevision)
    || subject.applicationRevision < 1
    || subject.applicationRevision > 1_000_000
  ) {
    fail("RUNTIME_FEE_PROOF_SUBJECT_INVALID", "Runtime fee proof subject is invalid.");
  }
}

function validateBindings(bindings, subject) {
  requireObject(bindings, "proof.bindings");
  exactKeys(bindings, ["application", "feeConformance", "promotion", "source"], "proof.bindings");

  const application = bindings.application;
  requireObject(application, "proof.bindings.application");
  exactKeys(application, ["applicationId", "applicationRevision", "applicationSha256", "packageSha256"], "proof.bindings.application");
  if (
    application.applicationId !== subject.applicationId
    || subject.projectId !== subject.applicationId
    || application.applicationRevision !== subject.applicationRevision
    || !SHA256.test(application.applicationSha256 ?? "")
    || !SHA256.test(application.packageSha256 ?? "")
  ) {
    fail("RUNTIME_FEE_PROOF_APPLICATION_BINDING_INVALID", "Runtime fee proof application binding is invalid.");
  }

  const source = bindings.source;
  requireObject(source, "proof.bindings.source");
  exactKeys(source, ["commit", "configurationHash", "numericRepositoryId", "repository", "tree"], "proof.bindings.source");
  if (
    !RUNTIME_FEE_SETTLEMENT_SHA1.test(source.commit ?? "")
    || !RUNTIME_FEE_SETTLEMENT_SHA1.test(source.tree ?? "")
    || !SHA256.test(source.configurationHash ?? "")
    || !/^[1-9][0-9]{0,63}$/u.test(source.numericRepositoryId ?? "")
    || !GITHUB_URI.test(source.repository ?? "")
  ) {
    fail("RUNTIME_FEE_PROOF_SOURCE_BINDING_INVALID", "Runtime fee proof source binding is invalid.");
  }

  const promotion = bindings.promotion;
  requireObject(promotion, "proof.bindings.promotion");
  exactKeys(promotion, ["launchReadinessDecisionSha256", "path", "routerPromotionEvidenceSha256", "sha256"], "proof.bindings.promotion");
  if (
    !safePath(promotion.path)
    || promotion.path !== "registry/promotions/" + subject.projectId + "/" + path.posix.basename(promotion.path)
    || !/^registry\/promotions\/[a-z0-9]+(?:-[a-z0-9]+)*\/0x[0-9a-f]{64}\.json$/u.test(promotion.path)
    || ![promotion.launchReadinessDecisionSha256, promotion.routerPromotionEvidenceSha256, promotion.sha256]
      .every((value) => SHA256.test(value ?? ""))
  ) {
    fail("RUNTIME_FEE_PROOF_PROMOTION_BINDING_INVALID", "Runtime fee proof promotion binding is invalid.");
  }

  validateFeeConformanceBinding(bindings.feeConformance);
}

function validateFeeConformanceBinding(binding) {
  requireObject(binding, "proof.bindings.feeConformance");
  exactKeys(binding, [
    "assurance",
    "collectionProfile",
    "contractId",
    "feeScopeId",
    "implementation",
    "marketRef",
    "path",
    "poolId",
    "quoteCurrency",
    "receiptBytes",
    "receiptSha256",
    "vectorSetSha256"
  ], "proof.bindings.feeConformance");
  if (
    binding.assurance !== "structural-only-not-audit-deployment-or-approval"
    || binding.contractId !== "fee-conformance-receipt-v1"
    || !validSlug(binding.feeScopeId)
    || !validSlug(binding.marketRef)
    || !new Set(["standard-amm", "sync-custom-zero-amm", "async-fill-batch", "custom-reviewed"]).has(binding.collectionProfile)
    || !safePath(binding.path)
    || !BYTES32.test(binding.poolId ?? "")
    || !ADDRESS.test(binding.quoteCurrency ?? "")
    || !SHA256.test(binding.receiptSha256 ?? "")
    || !SHA256.test(binding.vectorSetSha256 ?? "")
  ) {
    fail("RUNTIME_FEE_PROOF_CONFORMANCE_BINDING_INVALID", "Fee Conformance V1 binding is invalid.");
  }
  validateCanonicalBytesBinding(binding.receiptBytes, "proof.bindings.feeConformance.receiptBytes", 512 * 1024);

  const implementation = binding.implementation;
  requireObject(implementation, "proof.bindings.feeConformance.implementation");
  exactKeys(implementation, ["artifactRef", "artifactSha256", "path", "revisionObjectId", "sourceRef", "treeObjectId"], "proof.bindings.feeConformance.implementation");
  if (
    !validSlug(implementation.artifactRef)
    || !validSlug(implementation.sourceRef)
    || !SHA256.test(implementation.artifactSha256 ?? "")
    || !safePath(implementation.path)
    || !RUNTIME_FEE_SETTLEMENT_SHA1.test(implementation.revisionObjectId ?? "")
    || !RUNTIME_FEE_SETTLEMENT_SHA1.test(implementation.treeObjectId ?? "")
  ) {
    fail("RUNTIME_FEE_PROOF_CONFORMANCE_BINDING_INVALID", "Fee Conformance implementation binding is invalid.");
  }
}

function validateRuntime(runtime, proof) {
  requireObject(runtime, "proof.runtime");
  exactKeys(runtime, [
    "activationBlockHash",
    "activationBlockNumber",
    "activationTransactionHash",
    "activationTransactionIndex",
    "chainId",
    "feeDeploymentBindingSha256",
    "feeRuntimeAddress",
    "feeRuntimeCodeHash",
    "genesisHash",
    "launchId",
    "launchKind",
    "launchTransactionHash",
    "poolId",
    "poolManager",
    "reviewedImplementationArtifactSha256",
    "routerAddress",
    "routerRuntimeCodeHash",
    "runtimeClosureSha256",
    "runtimeVerifierSha256",
    "treasury"
  ], "proof.runtime");
  if (
    runtime.chainId !== 1
    || runtime.treasury !== TREASURY
    || ![1, 2].includes(runtime.launchKind)
    || ![runtime.genesisHash, runtime.launchId, runtime.poolId, runtime.feeRuntimeCodeHash, runtime.routerRuntimeCodeHash, runtime.activationBlockHash, runtime.activationTransactionHash, runtime.launchTransactionHash]
      .every((value) => BYTES32.test(value ?? ""))
    || ![runtime.feeRuntimeAddress, runtime.poolManager, runtime.routerAddress].every(validNonzeroAddress)
    || ![runtime.feeDeploymentBindingSha256, runtime.reviewedImplementationArtifactSha256, runtime.runtimeClosureSha256, runtime.runtimeVerifierSha256]
      .every((value) => SHA256.test(value ?? ""))
    || !POSITIVE_DECIMAL.test(runtime.activationBlockNumber ?? "")
    || !DECIMAL.test(runtime.activationTransactionIndex ?? "")
    || runtime.reviewedImplementationArtifactSha256 !== proof.bindings.feeConformance.implementation.artifactSha256
    || runtime.launchId.toLowerCase() !== path.posix.basename(proof.bindings.promotion.path, ".json")
  ) {
    fail("RUNTIME_FEE_PROOF_RUNTIME_BINDING_INVALID", "Reviewed deployment and runtime identity is invalid or inconsistent.");
  }
}

function validateRange(range, runtime) {
  requireObject(range, "proof.range");
  exactKeys(range, [
    "claimedCanonicalFinalized",
    "finalityMode",
    "finalizedAtBlock",
    "finalizedAtBlockHash",
    "fromBlock",
    "fromBlockHash",
    "fromDeployment",
    "previousProofSha256",
    "toBlock",
    "toBlockHash"
  ], "proof.range");
  if (
    range.claimedCanonicalFinalized !== true
    || range.fromDeployment !== true
    || range.finalityMode !== PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_FINALITY_MODE
    || range.previousProofSha256 !== null
    || ![range.fromBlock, range.toBlock, range.finalizedAtBlock].every((value) => POSITIVE_DECIMAL.test(value ?? ""))
    || ![range.fromBlockHash, range.toBlockHash, range.finalizedAtBlockHash].every((value) => BYTES32.test(value ?? ""))
    || range.fromBlock !== runtime.activationBlockNumber
    || range.fromBlockHash !== runtime.activationBlockHash
  ) {
    fail("RUNTIME_FEE_PROOF_RANGE_INVALID", "The assertion must describe one initial inclusive claimed range beginning at fee activation.");
  }
  const from = uint256(range.fromBlock, "proof.range.fromBlock");
  const to = uint256(range.toBlock, "proof.range.toBlock");
  const finalizedAt = uint256(range.finalizedAtBlock, "proof.range.finalizedAtBlock");
  if (to < from || finalizedAt < to) {
    fail("RUNTIME_FEE_PROOF_RANGE_INVALID", "Runtime fee proof block range or finality checkpoint is inverted.");
  }
}

function validateSettlement(settlement, runtime, range, conformance) {
  requireObject(settlement, "proof.settlement");
  exactKeys(settlement, [
    "asset",
    "basis",
    "closingLiabilityAtomic",
    "closingRemainderNumerator",
    "executionCount",
    "executions",
    "expectedFeeAtomic",
    "feeScopeId",
    "grossCanonicalVolumeAtomic",
    "hundredthsOfBip",
    "openingLiabilityAtomic",
    "openingRemainderNumerator",
    "rateDenominator",
    "settledTreasuryAtomic",
    "settlementCount",
    "settlements"
  ], "proof.settlement");
  if (
    settlement.basis !== BASIS
    || settlement.hundredthsOfBip !== HUNDREDTHS_OF_BIP
    || settlement.rateDenominator !== RATE_DENOMINATOR
    || settlement.feeScopeId !== conformance.feeScopeId
    || settlement.openingLiabilityAtomic !== "0"
    || settlement.closingLiabilityAtomic !== "0"
    || settlement.openingRemainderNumerator !== "0"
  ) {
    fail("RUNTIME_FEE_PROOF_ACCOUNTING_INVALID", "Runtime fee settlement parameters or initial activation state are invalid.");
  }
  validateAsset(settlement.asset);
  if (settlement.asset.address.toLowerCase() !== conformance.quoteCurrency.toLowerCase()) {
    fail("RUNTIME_FEE_PROOF_ASSET_MISMATCH", "Runtime settlement asset does not match the exact Fee Conformance quote asset.");
  }

  const gross = uint256(settlement.grossCanonicalVolumeAtomic, "proof.settlement.grossCanonicalVolumeAtomic", true);
  const expected = uint256(settlement.expectedFeeAtomic, "proof.settlement.expectedFeeAtomic", true);
  const settled = uint256(settlement.settledTreasuryAtomic, "proof.settlement.settledTreasuryAtomic", true);
  const openingRemainder = uint256(settlement.openingRemainderNumerator, "proof.settlement.openingRemainderNumerator");
  const closingRemainder = uint256(settlement.closingRemainderNumerator, "proof.settlement.closingRemainderNumerator");
  const openingLiability = uint256(settlement.openingLiabilityAtomic, "proof.settlement.openingLiabilityAtomic");
  const closingLiability = uint256(settlement.closingLiabilityAtomic, "proof.settlement.closingLiabilityAtomic");
  if (
    openingRemainder >= BigInt(RATE_DENOMINATOR)
    || closingRemainder >= BigInt(RATE_DENOMINATOR)
    || openingRemainder + (gross * BigInt(HUNDREDTHS_OF_BIP))
      !== (expected * BigInt(RATE_DENOMINATOR)) + closingRemainder
    || openingLiability + expected !== settled + closingLiability
  ) {
    fail("RUNTIME_FEE_PROOF_ACCOUNTING_INVALID", "Gross volume, carry remainder, expected fee, and settled treasury amount do not reconcile exactly.");
  }

  if (
    !Array.isArray(settlement.executions)
    || settlement.executions.length < 1
    || settlement.executions.length > MAXIMUM_EVENTS
    || !Array.isArray(settlement.settlements)
    || settlement.settlements.length < 1
    || settlement.settlements.length > MAXIMUM_EVENTS
    || settlement.executionCount !== String(settlement.executions.length)
    || settlement.settlementCount !== String(settlement.settlements.length)
  ) {
    fail("RUNTIME_FEE_PROOF_EVENT_SET_INVALID", "Runtime fee proof requires bounded nonempty execution and settlement event sets with exact counts.");
  }
  const executionTotals = validateExecutions(settlement.executions, runtime, range, settlement);
  const settlementTotal = validateSettlements(settlement.settlements, runtime, range, settlement);
  if (
    executionTotals.gross !== gross
    || executionTotals.expected !== expected
    || executionTotals.closingRemainder !== closingRemainder
    || settlementTotal !== settled
  ) {
    fail("RUNTIME_FEE_PROOF_ACCOUNTING_INVALID", "Event-level accounting does not match the exact range summary.");
  }
}

function validateAsset(asset) {
  requireObject(asset, "proof.settlement.asset");
  exactKeys(asset, ["address", "kind"], "proof.settlement.asset");
  if (!new Set(["erc20", "native"]).has(asset.kind) || !ADDRESS.test(asset.address ?? "")) {
    fail("RUNTIME_FEE_PROOF_ASSET_MISMATCH", "Settlement asset identity is invalid.");
  }
  const isZeroAddress = asset.address.toLowerCase() === ZERO_ADDRESS;
  if ((asset.kind === "native") !== isZeroAddress) {
    fail("RUNTIME_FEE_PROOF_ASSET_MISMATCH", "Native ETH and ERC-20 asset identities cannot be aliased.");
  }
}

function validateExecutions(executions, runtime, range, settlement) {
  let gross = 0n;
  let expected = 0n;
  let remainder = uint256(settlement.openingRemainderNumerator, "proof.settlement.openingRemainderNumerator");
  let previousOrder = null;
  const eventKeys = new Set();
  for (const [index, execution] of executions.entries()) {
    const label = "proof.settlement.executions[" + index + "]";
    requireObject(execution, label);
    exactKeys(execution, [
      "blockHash",
      "blockNumber",
      "evidenceSha256",
      "expectedFeeAtomic",
      "grossCanonicalVolumeAtomic",
      "logIndex",
      "poolId",
      "remainderAfterNumerator",
      "remainderBeforeNumerator",
      "runtimeAddress",
      "transactionHash",
      "transactionIndex"
    ], label);
    validateEventLocation(execution, label, range);
    if (
      execution.poolId !== runtime.poolId
      || execution.runtimeAddress !== runtime.feeRuntimeAddress
      || !SHA256.test(execution.evidenceSha256 ?? "")
    ) {
      fail("RUNTIME_FEE_PROOF_RUNTIME_BINDING_INVALID", label + " is not emitted by the exact reviewed fee runtime and pool.");
    }
    const eventGross = uint256(execution.grossCanonicalVolumeAtomic, label + ".grossCanonicalVolumeAtomic", true);
    const eventExpected = uint256(execution.expectedFeeAtomic, label + ".expectedFeeAtomic");
    const before = uint256(execution.remainderBeforeNumerator, label + ".remainderBeforeNumerator");
    const after = uint256(execution.remainderAfterNumerator, label + ".remainderAfterNumerator");
    if (
      before !== remainder
      || before >= BigInt(RATE_DENOMINATOR)
      || after >= BigInt(RATE_DENOMINATOR)
      || before + (eventGross * BigInt(HUNDREDTHS_OF_BIP))
        !== (eventExpected * BigInt(RATE_DENOMINATOR)) + after
    ) {
      fail("RUNTIME_FEE_PROOF_ROUNDING_INVALID", label + " resets or miscomputes the exact lifetime carry remainder.");
    }
    const order = eventOrder(execution);
    if (previousOrder !== null && compareEventOrder(previousOrder, order) >= 0) {
      fail("RUNTIME_FEE_PROOF_EVENT_ORDER_INVALID", "Execution evidence must use unique canonical chain order.");
    }
    const key = eventKey(execution);
    if (eventKeys.has(key)) fail("RUNTIME_FEE_PROOF_EVENT_DUPLICATE", "Execution evidence cannot be reused.");
    eventKeys.add(key);
    previousOrder = order;
    remainder = after;
    gross += eventGross;
    expected += eventExpected;
    assertUint256(gross, label + " gross sum");
    assertUint256(expected, label + " expected fee sum");
  }
  return { closingRemainder: remainder, expected, gross };
}

function validateSettlements(settlements, runtime, range, settlement) {
  let total = 0n;
  let previousOrder = null;
  const eventKeys = new Set();
  for (const [index, observed] of settlements.entries()) {
    const label = "proof.settlement.settlements[" + index + "]";
    requireObject(observed, label);
    exactKeys(observed, [
      "amountAtomic",
      "assetAddress",
      "balanceDeltaEvidenceSha256",
      "blockHash",
      "blockNumber",
      "evidenceSha256",
      "logOrTraceIndex",
      "runtimeAddress",
      "transactionHash",
      "transactionIndex",
      "treasury"
    ], label);
    const location = {
      ...observed,
      logIndex: observed.logOrTraceIndex
    };
    validateEventLocation(location, label, range);
    if (
      observed.assetAddress.toLowerCase() !== settlement.asset.address.toLowerCase()
      || observed.treasury !== runtime.treasury
      || observed.runtimeAddress !== runtime.feeRuntimeAddress
      || !SHA256.test(observed.balanceDeltaEvidenceSha256 ?? "")
      || !SHA256.test(observed.evidenceSha256 ?? "")
    ) {
      fail("RUNTIME_FEE_PROOF_SETTLEMENT_INVALID", label + " is not an actual same-asset treasury receipt caused by the reviewed fee runtime.");
    }
    const amount = uint256(observed.amountAtomic, label + ".amountAtomic", true);
    const order = eventOrder(location);
    if (previousOrder !== null && compareEventOrder(previousOrder, order) >= 0) {
      fail("RUNTIME_FEE_PROOF_EVENT_ORDER_INVALID", "Settlement evidence must use unique canonical chain order.");
    }
    const key = eventKey(location);
    if (eventKeys.has(key)) fail("RUNTIME_FEE_PROOF_EVENT_DUPLICATE", "Settlement evidence cannot be reused.");
    eventKeys.add(key);
    previousOrder = order;
    total += amount;
    assertUint256(total, label + " settlement sum");
  }
  return total;
}

function validateEventLocation(event, label, range) {
  if (
    !POSITIVE_DECIMAL.test(event.blockNumber ?? "")
    || !DECIMAL.test(event.transactionIndex ?? "")
    || !DECIMAL.test(event.logIndex ?? "")
    || !BYTES32.test(event.blockHash ?? "")
    || !BYTES32.test(event.transactionHash ?? "")
  ) {
    fail("RUNTIME_FEE_PROOF_EVENT_SET_INVALID", label + " has an invalid transaction/log/block locator.");
  }
  const block = uint256(event.blockNumber, label + ".blockNumber");
  if (block < uint256(range.fromBlock, "proof.range.fromBlock") || block > uint256(range.toBlock, "proof.range.toBlock")) {
    fail("RUNTIME_FEE_PROOF_EVENT_RANGE_INVALID", label + " falls outside the exact inclusive observation range.");
  }
  if (event.blockNumber === range.fromBlock && event.blockHash !== range.fromBlockHash) {
    fail("RUNTIME_FEE_PROOF_EVENT_RANGE_INVALID", label + " does not match the bound first block hash.");
  }
  if (event.blockNumber === range.toBlock && event.blockHash !== range.toBlockHash) {
    fail("RUNTIME_FEE_PROOF_EVENT_RANGE_INVALID", label + " does not match the bound final block hash.");
  }
}

function validateEvidence(evidence) {
  requireObject(evidence, "proof.evidence");
  exactKeys(evidence, [
    "applicantControlled",
    "bundle",
    "claimedCompleteHeaderChain",
    "claimedCompleteReceiptSet",
    "claimedConsensusFinality",
    "claimedReceiptRootsRecomputed",
    "claimedRuntimeClosureCheckedEveryFeeRelevantBlock",
    "finalityCheckpointSha256",
    "headerChainSha256",
    "observerConfigurationSha256",
    "observerId",
    "receiptSetSha256",
    "runtimeStateProofSha256",
    "verificationProfile"
  ], "proof.evidence");
  if (
    evidence.verificationProfile !== PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_VERIFICATION_PROFILE
    || evidence.observerId !== PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_OBSERVER_ID
    || evidence.applicantControlled !== false
    || evidence.claimedCompleteHeaderChain !== true
    || evidence.claimedCompleteReceiptSet !== true
    || evidence.claimedConsensusFinality !== true
    || evidence.claimedReceiptRootsRecomputed !== true
    || evidence.claimedRuntimeClosureCheckedEveryFeeRelevantBlock !== true
    || ![
      evidence.finalityCheckpointSha256,
      evidence.headerChainSha256,
      evidence.observerConfigurationSha256,
      evidence.receiptSetSha256,
      evidence.runtimeStateProofSha256
    ].every((value) => SHA256.test(value ?? ""))
  ) {
    fail("RUNTIME_FEE_PROOF_PROVENANCE_INVALID", "Claimed finality, receipt completeness, runtime-state, or observer provenance fields are structurally invalid.");
  }
  const bundle = evidence.bundle;
  requireObject(bundle, "proof.evidence.bundle");
  exactKeys(bundle, ["byteLength", "gitBlobOid", "mediaType", "path", "sha256"], "proof.evidence.bundle");
  if (
    !Number.isSafeInteger(bundle.byteLength)
    || bundle.byteLength < 2
    || bundle.byteLength > MAXIMUM_RUNTIME_FEE_SETTLEMENT_BUNDLE_BYTES
    || bundle.mediaType !== "application/json"
    || !SHA256.test(bundle.sha256 ?? "")
    || !RUNTIME_FEE_SETTLEMENT_SHA1.test(bundle.gitBlobOid ?? "")
    || bundle.path !== BUNDLE_ROOT + "/" + bundle.sha256.slice("sha256:".length) + ".json"
  ) {
    fail("RUNTIME_FEE_PROOF_BUNDLE_INVALID", "Protected evidence bundle binding is invalid.");
  }
}

function validateLimits(limits) {
  requireObject(limits, "proof.limits");
  exactKeys(limits, LIMIT_KEYS, "proof.limits");
  if (
    limits.coverage !== PROGRAMMABLE_RUNTIME_FEE_SETTLEMENT_OBSERVATION_SCOPE
    || LIMIT_KEYS.filter((key) => key !== "coverage").some((key) => limits[key] !== false)
  ) {
    fail("RUNTIME_FEE_PROOF_AUTHORITY_INVALID", "A structural observation assertion cannot claim authority, safety, monitoring, or future payment.");
  }
}

function validateEmbeddedFeeConformance(proof) {
  const binding = proof.bindings.feeConformance;
  const receiptBytes = decodeCanonicalBytesBinding(
    binding.receiptBytes,
    "RUNTIME_FEE_PROOF_CONFORMANCE_BINDING_INVALID"
  );
  if (sha256(receiptBytes) !== binding.receiptSha256) {
    fail("RUNTIME_FEE_PROOF_CONFORMANCE_BINDING_INVALID", "Embedded Fee Conformance receipt digest does not match its exact bytes.");
  }
  const receipt = parseCanonicalJsonBytes(
    receiptBytes,
    "RUNTIME_FEE_PROOF_CONFORMANCE_BINDING_INVALID",
    "RUNTIME_FEE_PROOF_CONFORMANCE_BINDING_INVALID"
  );
  const errors = validateFeeConformanceReceiptV1(receipt);
  if (errors.length > 0 || !receiptBytes.equals(canonicalFeeConformanceReceiptBytesV1(receipt))) {
    fail("RUNTIME_FEE_PROOF_CONFORMANCE_BINDING_INVALID", "Embedded Fee Conformance receipt is not the canonical validated V1 receipt.");
  }
  const { source } = proof.bindings;
  const implementation = binding.implementation;
  if (
    receipt.applicationId !== proof.subject.applicationId
    || receipt.assurance !== binding.assurance
    || receipt.contract?.id !== binding.contractId
    || receipt.scope?.feeScopeId !== binding.feeScopeId
    || receipt.scope?.marketRef !== binding.marketRef
    || receipt.scope?.chainId !== String(proof.runtime.chainId)
    || receipt.scope?.poolId !== binding.poolId
    || receipt.scope?.poolId !== proof.runtime.poolId
    || receipt.scope?.quoteCurrency.toLowerCase() !== binding.quoteCurrency.toLowerCase()
    || receipt.scope?.collectionProfile !== binding.collectionProfile
    || receipt.vectorSet?.sha256 !== binding.vectorSetSha256
    || canonicalJson(receipt.implementation) !== canonicalJson(implementation)
    || implementation.revisionObjectId !== source.commit
    || implementation.treeObjectId !== source.tree
  ) {
    fail("RUNTIME_FEE_PROOF_CONFORMANCE_BINDING_INVALID", "Fee Conformance receipt does not match the exact application, source, implementation, pool, or asset scope.");
  }
}

export function validatePromotionBinding(proof, promotion) {
  requireObject(promotion, "promotion");
  exactKeys(promotion, [
    "acceptance",
    "application",
    "authority",
    "componentProofs",
    "economics",
    "evidence",
    "launch",
    "lookups",
    "manifest",
    "observation",
    "policy",
    "projectId",
    "routePlan",
    "schemaVersion",
    "source",
    "verifiedAt"
  ], "promotion");
  const { application, promotion: promotionBinding, source } = proof.bindings;
  const runtime = proof.runtime;
  if (
    promotion.schemaVersion !== "1.0.0"
    || promotion.projectId !== proof.subject.projectId
    || promotion.application?.applicationId !== application.applicationId
    || promotion.application?.applicationRevision !== application.applicationRevision
    || promotion.application?.applicationSha256 !== application.applicationSha256
    || promotion.application?.packageDigest !== application.packageSha256
    || promotion.source?.commit !== source.commit
    || promotion.source?.tree !== source.tree
    || promotion.source?.configurationHash !== source.configurationHash
    || promotion.source?.numericRepositoryId !== source.numericRepositoryId
    || promotion.source?.repository !== source.repository
    || promotion.economics?.basis !== BASIS
    || promotion.economics?.hundredthsOfBip !== HUNDREDTHS_OF_BIP
    || promotion.economics?.treasury !== TREASURY
    || promotion.policy?.launchReadinessDecisionSha256 !== promotionBinding.launchReadinessDecisionSha256
    || promotion.evidence?.promotionSha256 !== promotionBinding.routerPromotionEvidenceSha256
    || promotion.launch?.launchId !== runtime.launchId
    || promotion.launch?.launchKind !== runtime.launchKind
    || promotion.launch?.poolId !== runtime.poolId
    || promotion.launch?.poolManager !== runtime.poolManager
    || promotion.manifest?.routerAddress !== runtime.routerAddress
    || promotion.manifest?.runtimeCodeHash !== runtime.routerRuntimeCodeHash
    || promotion.observation?.transactionHash !== runtime.launchTransactionHash
  ) {
    fail("RUNTIME_FEE_PROOF_PROMOTION_MISMATCH", "Runtime fee proof tuple does not match the exact protected Router promotion record.");
  }
}

function validateCanonicalBytesBinding(binding, label, maximumBytes) {
  requireObject(binding, label);
  exactKeys(binding, ["base64", "byteLength"], label);
  if (
    !Number.isSafeInteger(binding.byteLength)
    || binding.byteLength < 2
    || binding.byteLength > maximumBytes
    || typeof binding.base64 !== "string"
    || binding.base64.length < 4
    || binding.base64.length > Math.ceil(maximumBytes / 3) * 4
    || !BASE64.test(binding.base64)
  ) {
    fail("RUNTIME_FEE_PROOF_CONFORMANCE_BINDING_INVALID", label + " is not a bounded canonical byte binding.");
  }
  const bytes = Buffer.from(binding.base64, "base64");
  if (bytes.length !== binding.byteLength || bytes.toString("base64") !== binding.base64) {
    fail("RUNTIME_FEE_PROOF_CONFORMANCE_BINDING_INVALID", label + " does not use exact canonical base64 bytes.");
  }
}

function decodeCanonicalBytesBinding(binding, code) {
  try {
    return Buffer.from(binding.base64, "base64");
  } catch (error) {
    fail(code, "Embedded canonical bytes could not be decoded.", error);
  }
}

export function parseCanonicalRuntimeFeeSettlementJsonBytesV1(bytes, invalidCode, noncanonicalCode) {
  let source;
  let value;
  try {
    source = decoder.decode(bytes);
    parseBoundedLosslessJson(source);
    value = JSON.parse(source);
  } catch (error) {
    fail(invalidCode, "Evidence must be duplicate-free lossless UTF-8 JSON.", error);
  }
  if (!bytes.equals(Buffer.from(canonicalJson(value) + "\n", "utf8"))) {
    fail(noncanonicalCode, "Evidence JSON must be canonical and followed by one LF.");
  }
  return value;
}

function eventOrder(value) {
  return [
    uint256(value.blockNumber, "event.blockNumber"),
    uint256(value.transactionIndex, "event.transactionIndex"),
    uint256(value.logIndex, "event.logIndex")
  ];
}

function compareEventOrder(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function eventKey(value) {
  return value.blockHash + ":" + value.transactionHash + ":" + value.transactionIndex + ":" + value.logIndex;
}

function uint256(value, label, positive = false) {
  if (!(positive ? POSITIVE_DECIMAL : DECIMAL).test(value ?? "")) {
    fail("RUNTIME_FEE_PROOF_INTEGER_INVALID", label + " must be one canonical base-10 uint256.");
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) {
    fail("RUNTIME_FEE_PROOF_INTEGER_INVALID", label + " exceeds uint256.");
  }
  return parsed;
}

function assertUint256(value, label) {
  if (value < 0n || value > UINT256_MAX) {
    fail("RUNTIME_FEE_PROOF_INTEGER_INVALID", label + " exceeds uint256.");
  }
}

function validSlug(value) {
  return typeof value === "string" && value.length <= 160 && SLUG.test(value);
}

function validNonzeroAddress(value) {
  return ADDRESS.test(value ?? "") && value.toLowerCase() !== ZERO_ADDRESS;
}

export function isSafeRuntimeFeeSettlementPathV1(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 512 && SAFE_PATH.test(value);
}

function toBoundedBuffer(bytes, maximumBytes, code) {
  const buffer = Buffer.isBuffer(bytes)
    ? Buffer.from(bytes)
    : bytes instanceof Uint8Array
      ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : Buffer.from(bytes ?? []);
  if (buffer.length < 2 || buffer.length > maximumBytes) {
    fail(code, "Runtime fee settlement evidence exceeds its closed byte boundary.");
  }
  return Buffer.from(buffer);
}

export function runtimeFeeSettlementSha256V1(bytes) {
  return "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
}

export function canonicalRuntimeFeeSettlementJsonV1(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort(compareUtf8).map((key) => [key, sortJson(value[key])])
  );
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function requireExactRuntimeFeeSettlementKeysV1(value, expected, label, code = "RUNTIME_FEE_PROOF_FIELDS_INVALID") {
  if (!isObject(value) || canonicalJson(Object.keys(value).sort(compareUtf8)) !== canonicalJson([...expected].sort(compareUtf8))) {
    fail(code, label + " must contain exactly the supported fields.");
  }
}

export function requireRuntimeFeeSettlementObjectV1(value, label, code = "RUNTIME_FEE_PROOF_FIELDS_INVALID") {
  if (!isObject(value)) fail(code, label + " must be an ordinary object.");
}

export function isRuntimeFeeSettlementObjectV1(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function deepFreezeRuntimeFeeSettlementV1(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function failRuntimeFeeSettlementV1(code, message, cause) {
  throw new ProgrammableRuntimeFeeSettlementProofError(code, message, cause ? { cause } : undefined);
}
