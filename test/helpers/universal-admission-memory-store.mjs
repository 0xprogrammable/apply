import { types } from "node:util";

import {
  DEFAULT_UNIVERSAL_ADMISSION_RUNTIME_POLICY,
  DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE,
  MAX_UNIVERSAL_ADMISSION_CAS_OBJECT_BYTES,
  MIN_UNIVERSAL_ADMISSION_DURABLE_RESPONSE_RESERVATION_BYTES,
  UniversalAdmissionProtocolError,
  buildUniversalAdmissionEventReceipt,
  buildUniversalAdmissionSnapshot,
  canonicalProtocolBytes,
  deriveLeaseId,
  derivePrincipalBinding,
  deriveUniversalAdmissionDurableCommandEffectKeys,
  deriveUniversalAdmissionDurableCommandRequestBinding,
  deriveUniversalAdmissionIdempotencyKey,
  deriveUniversalAdmissionProtocolBindings,
  deriveUniversalAdmissionRequestKey,
  deriveUniversalAdmissionRevisionBinding,
  deriveWorkerBinding,
  deterministicRetryDelayMs,
  digestProtocolValue,
  digestUniversalAdmissionRuntimePolicy,
  inertProtocolAuthority,
  isUniversalAdmissionDurableCommandFailureCode,
  parseUniversalAdmissionWorkerResultBytes,
  snapshotLeafDigest,
  snapshotShardDigest,
  validateUniversalAdmissionFailure,
  validateUniversalAdmissionEventReceipt,
  validateUniversalAdmissionReceiptChain,
  validateUniversalAdmissionCommandId,
  validateUniversalAdmissionDurableCommandFailure,
  validateUniversalAdmissionRequestBinding,
  validateUniversalAdmissionRuntimePolicy,
  validateUniversalAdmissionServiceAudience,
  validateUniversalAdmissionSnapshot
} from "../../scripts/universal-admission-protocol-core.mjs";
import { validateUniversalAdmissionBytes } from "../../scripts/universal-admission-core.mjs";
import { sha256Bytes } from "../../vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs";

export const DEFAULT_TEST_RUNTIME_POLICY = DEFAULT_UNIVERSAL_ADMISSION_RUNTIME_POLICY;

const SAFE_MEDIA_TYPES = new Set([
  "public-evidence",
  "universal-admission-envelope",
  "universal-admission-event-receipt",
  "universal-admission-snapshot",
  "universal-admission-worker-result"
]);
const RESERVED_MEDIA_TYPE_BY_KIND = Object.freeze({
  "programmable-universal-admission": "universal-admission-envelope",
  "programmable-universal-admission-event-receipt": "universal-admission-event-receipt",
  "programmable-universal-admission-snapshot": "universal-admission-snapshot",
  "programmable-universal-admission-worker-result": "universal-admission-worker-result"
});
const ROOT_UINT8_ARRAY = Uint8Array;
const ROOT_TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(ROOT_UINT8_ARRAY.prototype);
const INTRINSIC_TYPED_ARRAY_BUFFER = Function.prototype.call.bind(
  Object.getOwnPropertyDescriptor(ROOT_TYPED_ARRAY_PROTOTYPE, "buffer").get
);
const INTRINSIC_TYPED_ARRAY_BYTE_OFFSET = Function.prototype.call.bind(
  Object.getOwnPropertyDescriptor(ROOT_TYPED_ARRAY_PROTOTYPE, "byteOffset").get
);
const INTRINSIC_TYPED_ARRAY_BYTE_LENGTH = Function.prototype.call.bind(
  Object.getOwnPropertyDescriptor(ROOT_TYPED_ARRAY_PROTOTYPE, "byteLength").get
);

/**
 * Deterministic single-process conformance fixture. It models the required
 * atomic protocol transitions, but intentionally provides no persistence,
 * authentication, multi-node clock, or production throughput evidence.
 */
export class UniversalAdmissionMemoryStore {
  constructor({ nowMs = "1000000", policy = DEFAULT_TEST_RUNTIME_POLICY, serviceAudience = DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE } = {}) {
    this.policy = validateUniversalAdmissionRuntimePolicy(structuredClone(policy));
    this.capacityPolicySha256 = digestUniversalAdmissionRuntimePolicy(this.policy);
    this.serviceAudience = validateServiceAudience(serviceAudience);
    this.now = parseDecimal(nowMs, "nowMs");
    this.objects = new Map();
    this.objectGenerations = new Map();
    this.revisions = new Map();
    this.jobs = new Map();
    this.tenants = new Map();
    this.applications = new Map();
    this.receipts = new Map();
    this.requests = new Map();
    this.durableCommands = new Map();
    this.enqueueLedger = new Map();
    this.snapshots = new Map();
    this.snapshotHead = null;
    this.global = { claimOrdinal: 0n, durableCommandBytes: 0n, durableCommands: 0n, leased: 0n, outstanding: 0n };
  }

  setNowMs(value) {
    const next = parseDecimal(value, "nowMs");
    if (next < this.now) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_CLOCK_INVALID", "Fixture clock cannot move backwards.");
    this.now = next;
    return String(this.now);
  }

  advanceTime(deltaMs) {
    this.now += parseDecimal(deltaMs, "deltaMs");
    return String(this.now);
  }

  async putObjectIfAbsent({ bytes, mediaType = "public-evidence" }) {
    if (mediaType !== "public-evidence") {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_RESERVED_MEDIA_FORBIDDEN", "Public CAS writes accept only public-evidence media.");
    }
    return this.#putObjectIfAbsent({ bytes, mediaType });
  }

  async testOnlyPutReservedObjectIfAbsent({ bytes, mediaType }) {
    if (mediaType === "public-evidence" || !SAFE_MEDIA_TYPES.has(mediaType)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_RESERVED_MEDIA_FORBIDDEN", "The test-only reserved writer requires a reserved protocol media type.");
    }
    const buffer = snapshotFixtureBytes(bytes, "Reserved CAS object");
    validateReservedProtocolObject(buffer, mediaType);
    return this.#putObjectIfAbsent({ bytes: buffer, mediaType });
  }

  #putObjectIfAbsent({ bytes, mediaType }) {
    const buffer = snapshotFixtureBytes(bytes, "CAS object");
    if (!SAFE_MEDIA_TYPES.has(mediaType)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", "CAS media type is outside the fixture contract.");
    }
    const requiredMediaType = reservedMediaTypeForBytes(buffer);
    if (requiredMediaType !== null && mediaType !== requiredMediaType) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_CAS_MEDIA_TYPE_CONFLICT", `Reserved ${requiredMediaType} bytes cannot be stored as ${mediaType}.`);
    }
    const digest = sha256Bytes(buffer);
    const existing = this.objects.get(digest);
    if (existing) {
      if (!existing.bytes.equals(buffer)) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_CAS_CONFLICT", "Existing CAS bytes differ at the same digest.");
      if (existing.mediaType !== mediaType) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_CAS_MEDIA_TYPE_CONFLICT", "Existing CAS media type differs for the same digest.");
      return freeze({ created: false, digest, generation: String(existing.generation), byteLength: String(buffer.length) });
    }
    const generation = (this.objectGenerations.get(digest) ?? 0n) + 1n;
    this.objectGenerations.set(digest, generation);
    this.objects.set(digest, {
      bytes: buffer,
      createdAtMs: this.now,
      generation,
      mediaType,
      refs: new Set()
    });
    return freeze({ created: true, digest, generation: String(generation), byteLength: String(buffer.length) });
  }

  async submit({ authenticatedRequestByteLength, bytes, expectedCapacityPolicySha256, principalContext, requestDigest, requestId }) {
    if (expectedCapacityPolicySha256 !== this.capacityPolicySha256) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_CAPACITY_POLICY_MISMATCH", "Submit precondition does not match the store runtime policy digest.");
    }
    const stableBytes = snapshotFixtureBytes(bytes, "Authenticated admission envelope");
    const request = validateUniversalAdmissionRequestBinding({ authenticatedRequestByteLength, expectedCapacityPolicySha256, requestDigest, requestId });
    const bindings = deriveUniversalAdmissionProtocolBindings({ bytes: stableBytes, principalContext });
    this.#assertServiceAudience(bindings.audience);
    const requestKey = deriveUniversalAdmissionRequestKey({
      audience: bindings.audience,
      requestId: request.requestId,
      tenantId: bindings.tenantId
    });
    this.#expireDurableCommands();
    const existingRequest = this.#requestRecord({
      admissionDigest: bindings.admissionDigest,
      principalBindingSha256: bindings.principal.principalBindingSha256,
      request,
      requestKey
    });
    if (existingRequest?.outcome === "success") return freeze(existingRequest.result);
    if (existingRequest?.outcome === "failure") throwStoredProtocolFailure(existingRequest.failure);

    const tenant = this.#tenant(bindings.tenantId);
    this.#resetWindow(tenant);
    if (existingRequest === null) {
      this.#assertAuthenticatedRequestReservation({ byteLength: BigInt(request.authenticatedRequestByteLength), tenant });
      this.#reserveAuthenticatedRequest({ bindings, request, requestKey, tenant });
    }
    const reservedState = this.#captureState();
    try {
      return this.#submitReserved({ bindings, bytes: stableBytes, request, requestKey, tenant });
    } catch (error) {
      this.#restoreState(reservedState);
      if (error instanceof UniversalAdmissionProtocolError) {
        this.#storeRequestFailure({ error, requestKey });
      }
      throw error;
    }
  }

  async claim({ commandId = null, workerContext }) {
    const worker = deriveWorkerBinding(workerContext);
    this.#assertServiceAudience(worker.audience);
    return this.#runDurableCommand({
      actorKey: worker.workerBindingSha256,
      commandId,
      commandKind: "claim",
      requestValue: { worker }
    }, () => this.#claim(worker));
  }

  #claim(worker) {
    if (this.global.leased >= BigInt(this.policy.maxGlobalLeased)) {
      return freeze({ status: "NO_WORK", reason: "GLOBAL_LEASE_CAPACITY" });
    }
    const jobsByTenant = new Map();
    for (const job of this.jobs.values()) {
      if (!(job.state === "queued" || (job.state === "retry-wait" && job.availableAtMs <= this.now))) continue;
      const tenant = this.#tenant(job.tenantId);
      if (tenant.leased >= BigInt(this.policy.maxTenantLeased)) continue;
      if (!jobsByTenant.has(job.tenantId)) jobsByTenant.set(job.tenantId, []);
      jobsByTenant.get(job.tenantId).push(job);
    }
    const eligibleTenants = [...jobsByTenant.keys()].sort((left, right) => {
      const leftOrdinal = this.#tenant(left).lastClaimOrdinal;
      const rightOrdinal = this.#tenant(right).lastClaimOrdinal;
      if (leftOrdinal !== rightOrdinal) return leftOrdinal < rightOrdinal ? -1 : 1;
      return compareUtf8(left, right);
    });
    if (eligibleTenants.length === 0) return freeze({ status: "NO_WORK", reason: "NO_ELIGIBLE_JOB" });

    const tenantId = eligibleTenants[0];
    const candidates = jobsByTenant.get(tenantId).sort(compareJobs);
    const job = candidates[0];
    const tenant = this.#tenant(tenantId);
    const priorState = job.state;
    this.global.claimOrdinal += 1n;
    this.global.leased += 1n;
    tenant.lastClaimOrdinal = this.global.claimOrdinal;
    tenant.leased += 1n;
    job.attempt += 1n;
    job.fenceToken += 1n;
    job.state = "leased";
    const claimedAtMs = String(this.now);
    const fenceToken = String(job.fenceToken);
    const leaseId = deriveLeaseId({
      claimedAtMs,
      claimOrdinal: String(this.global.claimOrdinal),
      cycle: String(job.cycle),
      fenceToken,
      jobId: job.jobId,
      workerBindingSha256: worker.workerBindingSha256
    });
    job.lease = {
      claimedAtMs,
      claimOrdinal: String(this.global.claimOrdinal),
      expiresAtMs: String(this.now + BigInt(this.policy.leaseDurationMs)),
      fenceToken,
      leaseId,
      renewals: "0",
      workerBindingSha256: worker.workerBindingSha256
    };
    const receipt = this.#appendReceipt(job, {
      eventType: "lease-claimed",
      failure: null,
      lease: job.lease,
      principalBindingSha256: null,
      result: null,
      transition: { from: priorState, to: "leased" },
      workerBindingSha256: worker.workerBindingSha256
    });
    const object = this.objects.get(job.admissionDigest);
    if (!object) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_CAS_CONFLICT", "Claimed admission envelope is absent from CAS.");
    return freeze({
      admissionDigest: job.admissionDigest,
      envelopeBytes: Buffer.from(object.bytes),
      jobId: job.jobId,
      lease: structuredClone(job.lease),
      receiptSha256: receipt.receiptSha256,
      revisionBindingSha256: job.revisionBindingSha256,
      revisionKey: job.revisionKey,
      status: "LEASED"
    });
  }

  async renew({ commandId = null, fenceToken, jobId, leaseId, workerContext }) {
    const worker = deriveWorkerBinding(workerContext);
    this.#assertServiceAudience(worker.audience);
    const stableFenceToken = normalizeFixtureDecimal(fenceToken, "fenceToken");
    const stableJobId = normalizeFixtureDigest(jobId, "jobId");
    const stableLeaseId = normalizeFixtureDigest(leaseId, "leaseId");
    return this.#runDurableCommand({
      actorKey: worker.workerBindingSha256,
      commandId,
      commandKind: "renew",
      requestValue: { fenceToken: stableFenceToken, jobId: stableJobId, leaseId: stableLeaseId, worker }
    }, () => this.#renew({ fenceToken: stableFenceToken, jobId: stableJobId, leaseId: stableLeaseId, worker }));
  }

  #renew({ fenceToken, jobId, leaseId, worker }) {
    const job = this.#job(jobId);
    this.#assertLease(job, { fenceToken, leaseId, workerBindingSha256: worker.workerBindingSha256 });
    const renewals = BigInt(job.lease.renewals);
    if (renewals >= BigInt(this.policy.maxLeaseRenewals)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_LEASE_RENEWAL_LIMIT", "Lease renewal limit is exhausted.");
    }
    const maximumExpiry = BigInt(job.lease.claimedAtMs) + BigInt(this.policy.maxLeaseDurationMs);
    const requestedExpiry = BigInt(job.lease.expiresAtMs) + BigInt(this.policy.leaseDurationMs);
    const nextExpiry = requestedExpiry < maximumExpiry ? requestedExpiry : maximumExpiry;
    if (nextExpiry <= BigInt(job.lease.expiresAtMs)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_LEASE_RENEWAL_LIMIT", "Lease reached its maximum cumulative duration.");
    }
    job.lease = { ...job.lease, expiresAtMs: String(nextExpiry), renewals: String(renewals + 1n) };
    const receipt = this.#appendReceipt(job, {
      eventType: "lease-renewed",
      failure: null,
      lease: job.lease,
      principalBindingSha256: null,
      result: null,
      transition: { from: "leased", to: "leased" },
      workerBindingSha256: worker.workerBindingSha256
    });
    return freeze({ lease: structuredClone(job.lease), receiptSha256: receipt.receiptSha256, status: "LEASED" });
  }

  async fail({ commandId = null, failure, fenceToken, jobId, leaseId, workerContext }) {
    const worker = deriveWorkerBinding(workerContext);
    this.#assertServiceAudience(worker.audience);
    const checkedFailure = validateUniversalAdmissionFailure(failure);
    const stableFenceToken = normalizeFixtureDecimal(fenceToken, "fenceToken");
    const stableJobId = normalizeFixtureDigest(jobId, "jobId");
    const stableLeaseId = normalizeFixtureDigest(leaseId, "leaseId");
    return this.#runDurableCommand({
      actorKey: worker.workerBindingSha256,
      commandId,
      commandKind: "fail",
      requestValue: { failure: checkedFailure, fenceToken: stableFenceToken, jobId: stableJobId, leaseId: stableLeaseId, worker }
    }, () => this.#fail({ failure: checkedFailure, fenceToken: stableFenceToken, jobId: stableJobId, leaseId: stableLeaseId, worker }));
  }

  #fail({ failure, fenceToken, jobId, leaseId, worker }) {
    if (failure.code === "LEASE_EXPIRED") {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_FAILURE_CODE_RESERVED", "LEASE_EXPIRED is reserved for the authenticated system reaper.");
    }
    const job = this.#job(jobId);
    this.#assertLease(job, { fenceToken, leaseId, workerBindingSha256: worker.workerBindingSha256 });
    return this.#settleFailure(job, failure, { allowExpired: false });
  }

  async reapExpired({ commandId = null, limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_LIMIT_INVALID", "Reaper limit must be 1..1000.");
    }
    return this.#runDurableCommand({
      actorKey: "system:lease-reaper",
      commandId,
      commandKind: "reap-expired",
      requestValue: { limit }
    }, () => this.#reapExpired(limit));
  }

  #reapExpired(limit) {
    const expired = [...this.jobs.values()]
      .filter((job) => job.state === "leased" && BigInt(job.lease.expiresAtMs) <= this.now)
      .sort((left, right) => {
        const leftExpiry = BigInt(left.lease.expiresAtMs);
        const rightExpiry = BigInt(right.lease.expiresAtMs);
        if (leftExpiry !== rightExpiry) return leftExpiry < rightExpiry ? -1 : 1;
        return compareUtf8(left.jobId, right.jobId);
      })
      .slice(0, limit);
    const results = [];
    for (const job of expired) {
      results.push(this.#settleFailure(job, {
        code: "LEASE_EXPIRED",
        detailsSha256: digestProtocolValue({ jobId: job.jobId, leaseId: job.lease.leaseId }),
        retryable: true
      }, { allowExpired: true }));
    }
    return freeze({ processed: String(results.length), results });
  }

  async redrive({ commandId = null, expectedReceiptSha256, jobId, principalContext }) {
    const principal = derivePrincipalBinding(principalContext);
    this.#assertServiceAudience(principal.audience);
    const stableExpectedReceiptSha256 = normalizeFixtureDigest(expectedReceiptSha256, "expectedReceiptSha256");
    const stableJobId = normalizeFixtureDigest(jobId, "jobId");
    return this.#runDurableCommand({
      actorKey: principal.principalBindingSha256,
      commandId,
      commandKind: "redrive",
      requestValue: { expectedReceiptSha256: stableExpectedReceiptSha256, jobId: stableJobId, principal },
      tenantId: principal.tenantId
    }, () => this.#redrive({ expectedReceiptSha256: stableExpectedReceiptSha256, jobId: stableJobId, principal }));
  }

  #redrive({ expectedReceiptSha256, jobId, principal }) {
    const job = this.#job(jobId);
    if (principal.tenantId !== job.tenantId) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_PRINCIPAL_TENANT_MISMATCH", "Principal tenant does not own this job.");
    if (job.state !== "dead-lettered") protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_JOB_STATE_CONFLICT", "Only a dead-lettered job can be redriven.");
    if (job.terminalAtMs === null || this.now - job.terminalAtMs >= BigInt(this.policy.deadLetterPayloadRetentionMs)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_REDRIVE_WINDOW_EXPIRED", "Dead-letter redrive window has expired.");
    }
    if (job.headReceiptSha256 !== expectedReceiptSha256) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_DLQ_REDRIVE_CONFLICT", "DLQ head receipt changed before redrive.");
    if (job.redrives >= BigInt(this.policy.maxRedrives)) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_DLQ_REDRIVE_LIMIT", "DLQ redrive limit is exhausted.");
    const tenant = this.#tenant(job.tenantId);
    const application = this.#application(job.tenantId, job.applicationId);
    const object = this.objects.get(job.admissionDigest);
    if (!object) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_CAS_CONFLICT", "Dead-lettered admission payload is absent from CAS.");
    this.#resetWindow(tenant);
    this.#assertSubmitCapacity({ application, byteLength: BigInt(object.bytes.length), tenant });
    job.cycle += 1n;
    job.attempt = 0n;
    job.redrives += 1n;
    job.state = "queued";
    job.availableAtMs = this.now;
    job.terminalAtMs = null;
    tenant.nextEnqueueOrdinal += 1n;
    job.enqueueOrdinal = tenant.nextEnqueueOrdinal;
    this.#addObjectRef(job.admissionDigest, `${job.jobId}:admission`);
    this.#consumeSubmitCapacity({ application, byteLength: BigInt(object.bytes.length), tenant });
    const receipt = this.#appendReceipt(job, {
      eventType: "dead-letter-redriven",
      failure: null,
      lease: null,
      principalBindingSha256: principal.principalBindingSha256,
      result: null,
      transition: { from: "dead-lettered", to: "queued" },
      workerBindingSha256: null
    });
    this.#recordEnqueue(job, receipt);
    return freeze({ jobId: job.jobId, receiptSha256: receipt.receiptSha256, status: "QUEUED" });
  }

  async complete({ commandId = null, jobId, resultBytes, workerContext }) {
    const worker = deriveWorkerBinding(workerContext);
    this.#assertServiceAudience(worker.audience);
    const stableJobId = normalizeFixtureDigest(jobId, "jobId");
    const stableResultBytes = snapshotFixtureBytes(resultBytes, "Worker result");
    return this.#runDurableCommand({
      actorKey: worker.workerBindingSha256,
      commandId,
      commandKind: "complete",
      requestValue: { jobId: stableJobId, resultSha256: sha256Bytes(stableResultBytes), worker }
    }, () => this.#complete({ jobId: stableJobId, resultBytes: stableResultBytes, worker }));
  }

  #complete({ jobId, resultBytes, worker }) {
    const result = parseUniversalAdmissionWorkerResultBytes(resultBytes);
    const job = this.#job(jobId);
    this.#assertLease(job, {
      fenceToken: result.binding.fenceToken,
      leaseId: result.binding.leaseId,
      workerBindingSha256: worker.workerBindingSha256
    });
    const expected = {
      admissionDigest: job.admissionDigest,
      attempt: String(job.attempt),
      cycle: String(job.cycle),
      fenceToken: String(job.fenceToken),
      jobId: job.jobId,
      leaseId: job.lease.leaseId,
      revisionBindingSha256: job.revisionBindingSha256,
      revisionKey: job.revisionKey
    };
    if (digestProtocolValue(result.binding) !== digestProtocolValue(expected)
      || result.worker.workerBindingSha256 !== worker.workerBindingSha256
      || result.worker.implementationSha256 !== worker.implementationSha256) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_RESULT_BINDING_MISMATCH", "Worker result does not bind the current exact job lease.");
    }
    for (const digest of new Set([result.reportSha256, ...result.artifacts.map((artifact) => artifact.sha256)])) {
      if (this.objects.get(digest)?.mediaType !== "public-evidence") {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ARTIFACT_MISSING", `Worker result public evidence ${digest} is absent from CAS.`);
      }
    }
    for (const artifact of result.artifacts) {
      if (BigInt(this.objects.get(artifact.sha256).bytes.length) !== BigInt(artifact.byteLength)) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_RESULT_BINDING_MISMATCH", `Worker result artifact ${artifact.id} byte length does not match CAS.`);
      }
    }
    const resultObject = this.#putObjectIfAbsent({ bytes: resultBytes, mediaType: "universal-admission-worker-result" });
    this.#assertLease(job, {
      fenceToken: result.binding.fenceToken,
      leaseId: result.binding.leaseId,
      workerBindingSha256: worker.workerBindingSha256
    });
    const oldLease = structuredClone(job.lease);
    job.state = "processing-completed";
    job.terminalAtMs = this.now;
    job.resultSha256 = resultObject.digest;
    job.completionBindings = {
      artifacts: structuredClone(result.artifacts),
      reportSha256: result.reportSha256
    };
    this.#releaseOutstanding(job);
    this.#addObjectRef(resultObject.digest, `${job.jobId}:result`);
    this.#addObjectRef(result.reportSha256, `${job.jobId}:report`);
    for (const artifact of result.artifacts) this.#addObjectRef(artifact.sha256, `${job.jobId}:artifact:${artifact.id}`);
    const receipt = this.#appendReceipt(job, {
      eventType: "processing-completed",
      failure: null,
      lease: oldLease,
      principalBindingSha256: null,
      result: {
        artifactsSha256: digestProtocolValue(result.artifacts),
        reportSha256: result.reportSha256,
        resultSha256: resultObject.digest,
        reviewState: result.reviewState
      },
      transition: { from: "leased", to: "processing-completed" },
      workerBindingSha256: worker.workerBindingSha256
    });
    job.lease = null;
    return freeze({ jobId: job.jobId, receiptSha256: receipt.receiptSha256, resultSha256: resultObject.digest, status: "PROCESSING_COMPLETED" });
  }

  async snapshot({ commandId = null } = {}) {
    return this.#runDurableCommand({
      actorKey: "system:snapshot",
      commandId,
      commandKind: "snapshot",
      requestValue: {}
    }, () => this.#snapshot());
  }

  #snapshot() {
    const records = this.#snapshotRecords();
    const leavesByPrefix = new Map();
    for (const record of records) {
      const recordSha256 = digestProtocolValue(record.value);
      const keyDigest = digestProtocolValue({ key: record.key });
      const prefix = keyDigest.slice(7, 9);
      const leaf = snapshotLeafDigest({ key: record.key, recordSha256 });
      if (!leavesByPrefix.has(prefix)) leavesByPrefix.set(prefix, []);
      leavesByPrefix.get(prefix).push({ key: record.key, leaf });
    }
    const shards = [...leavesByPrefix.entries()]
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([prefix, entries]) => {
        entries.sort((left, right) => compareUtf8(left.key, right.key));
        return {
          prefix,
          recordCount: String(entries.length),
          rootSha256: snapshotShardDigest({ leafDigests: entries.map(({ leaf }) => leaf), prefix })
        };
      });
    const candidates = this.#gcCandidates();
    const cutSha256 = digestProtocolValue(records);
    const gcCandidatesSha256 = digestProtocolValue(candidates.map(({ digest, generation, reason }) => ({ digest, generation: String(generation), reason })));
    const liveObjectReferences = records
      .filter((record) => record.key.startsWith("object/"))
      .reduce((total, record) => total + record.value.references.length, 0);
    const manifest = buildUniversalAdmissionSnapshot({
      createdAtMs: String(this.now),
      cutSha256,
      gcCandidatesSha256,
      previousSnapshotSha256: this.snapshotHead,
      serviceAudience: this.serviceAudience,
      shards,
      totals: {
        gcCandidates: String(candidates.length),
        liveObjectReferences: String(liveObjectReferences),
        records: String(records.length)
      }
    });
    const bytes = canonicalProtocolBytes(manifest);
    const object = this.#putObjectIfAbsent({ bytes, mediaType: "universal-admission-snapshot" });
    this.snapshots.set(object.digest, { candidates, gcProcessedCount: 0, manifest, records });
    this.snapshotHead = object.digest;
    return freeze({ manifest, snapshotSha256: object.digest });
  }

  async gc(input) {
    const stableInput = snapshotFixturePlainObject(input, "GC request");
    if (!Object.hasOwn(stableInput, "commandId")
      || !Object.hasOwn(stableInput, "snapshotSha256")
      || Object.keys(stableInput).some((key) => !new Set(["commandId", "limit", "snapshotSha256"]).has(key))) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_FIELD_SET_INVALID", "GC request fields do not match the closed provider-neutral contract.");
    }
    const { commandId, limit = 1000 } = stableInput;
    const snapshotSha256 = normalizeFixtureDigest(stableInput.snapshotSha256, "snapshotSha256");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_LIMIT_INVALID", "GC limit must be 1..1000.");
    }
    return this.#runDurableCommand({
      actorKey: "system:gc",
      commandId,
      commandKind: "gc",
      requestValue: { limit, snapshotSha256 }
    }, () => this.#gc({ limit, snapshotSha256 }));
  }

  #gc({ limit, snapshotSha256 }) {
    const snapshot = this.snapshots.get(snapshotSha256);
    if (!snapshot) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_SNAPSHOT_INVALID", "GC requires an existing committed snapshot.");
    validateUniversalAdmissionSnapshot(snapshot.manifest);
    let deletedCount = 0;
    const start = snapshot.gcProcessedCount;
    const batch = snapshot.candidates.slice(start, start + limit);
    for (const candidate of batch) {
      const object = this.objects.get(candidate.digest);
      if (!object) {
        continue;
      }
      if (object.generation !== candidate.generation) {
        continue;
      }
      if (!this.#currentlyGcEligible(candidate.digest, candidate.reason)) {
        continue;
      }
      this.objects.delete(candidate.digest);
      deletedCount += 1;
    }
    snapshot.gcProcessedCount += batch.length;
    const remainingCount = snapshot.candidates.length - snapshot.gcProcessedCount;
    return freeze({
      deletedCount: String(deletedCount),
      done: remainingCount === 0,
      remainingCount: String(remainingCount),
      snapshotSha256
    });
  }

  readJob(jobId) {
    return this.jobs.has(jobId) ? freeze(this.#publicJob(this.jobs.get(jobId))) : null;
  }

  readReceipt(receiptSha256) {
    const value = this.receipts.get(receiptSha256);
    return value ? freeze(structuredClone(value)) : null;
  }

  listJobReceipts(jobId) {
    const job = this.#job(jobId);
    return freeze(job.receiptDigests.map((receiptSha256) => this.receipts.get(receiptSha256)));
  }

  readObject(digest) {
    const object = this.objects.get(digest);
    return object ? Buffer.from(object.bytes) : null;
  }

  inspectCounters() {
    return freeze({
      applications: Object.fromEntries([...this.applications].map(([key, value]) => [key, String(value.outstanding)])),
      durable: { bytes: String(this.global.durableCommandBytes), commands: String(this.global.durableCommands) },
      global: { leased: String(this.global.leased), outstanding: String(this.global.outstanding) },
      tenants: Object.fromEntries([...this.tenants].map(([key, value]) => [key, {
        authenticatedRequestBytes: String(value.authenticatedRequestBytes),
        authenticatedRequests: String(value.authenticatedRequests),
        leased: String(value.leased),
        outstanding: String(value.outstanding),
        replayBytes: String(value.replayBytes),
        replayRecords: String(value.replayRecords),
        windowBytes: String(value.windowBytes),
        windowJobs: String(value.windowJobs)
      }]))
    });
  }

  assertConsistent() {
    let outstanding = 0n;
    let leased = 0n;
    let maximumClaimOrdinal = 0n;
    const claimOrdinals = new Set();
    const tenants = new Map();
    const tenantLeases = new Map();
    const tenantEnqueueOrdinals = new Map();
    const tenantLastClaimOrdinals = new Map();
    const applications = new Map();
    const expectedObjectReferences = new Map();
    const observedEnqueueLedger = new Map();
    for (const job of this.jobs.values()) {
      const active = new Set(["queued", "retry-wait", "leased"]).has(job.state);
      if (active) {
        outstanding += 1n;
        tenants.set(job.tenantId, (tenants.get(job.tenantId) ?? 0n) + 1n);
        const key = applicationKey(job.tenantId, job.applicationId);
        applications.set(key, (applications.get(key) ?? 0n) + 1n);
      }
      if (job.state === "leased") {
        leased += 1n;
        tenantLeases.set(job.tenantId, (tenantLeases.get(job.tenantId) ?? 0n) + 1n);
      }
      let previous = null;
      for (let index = 0; index < job.receiptDigests.length; index += 1) {
        const receiptDigest = job.receiptDigests[index];
        const receipt = this.receipts.get(receiptDigest);
        validateUniversalAdmissionEventReceipt(receipt);
        if (receipt.eventIndex !== String(index + 1) || receipt.previousReceiptSha256 !== previous) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Receipt chain is not contiguous.");
        }
        if (receipt.eventType === "lease-claimed") {
          const claimOrdinal = BigInt(receipt.lease.claimOrdinal);
          if (claimOrdinals.has(receipt.lease.claimOrdinal)) {
            protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Lease claim ordinals are not globally unique.");
          }
          claimOrdinals.add(receipt.lease.claimOrdinal);
          if (claimOrdinal > maximumClaimOrdinal) maximumClaimOrdinal = claimOrdinal;
          const tenantMaximum = tenantLastClaimOrdinals.get(job.tenantId) ?? 0n;
          if (claimOrdinal > tenantMaximum) tenantLastClaimOrdinals.set(job.tenantId, claimOrdinal);
        }
        if (new Set(["queued", "retry-scheduled", "dead-letter-redriven"]).has(receipt.eventType)) {
          if (!tenantEnqueueOrdinals.has(job.tenantId)) tenantEnqueueOrdinals.set(job.tenantId, new Set());
          const ordinals = tenantEnqueueOrdinals.get(job.tenantId);
          if (ordinals.has(receipt.job.enqueueOrdinal)) {
            protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Tenant enqueue ordinals are not unique across immutable queue events.");
          }
          ordinals.add(receipt.job.enqueueOrdinal);
          observedEnqueueLedger.set(`${job.tenantId}\u0000${receipt.job.enqueueOrdinal}`, {
            eventIndex: receipt.eventIndex,
            eventType: receipt.eventType,
            jobId: job.jobId,
            receiptSha256: receiptDigest
          });
        }
        const bytes = canonicalProtocolBytes(receipt);
        if (sha256Bytes(bytes) !== receiptDigest || !this.objects.get(receiptDigest)?.bytes.equals(bytes)) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Receipt bytes differ from their immutable digest.");
        }
        if (!this.objects.get(receiptDigest).refs.has(`${job.jobId}:receipt:${index + 1}`)) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Receipt CAS object lacks its exact immutable job reference.");
        }
        expectedObjectReferences.set(`${job.jobId}:receipt:${index + 1}`, receiptDigest);
        previous = receiptDigest;
      }
      if (previous !== job.headReceiptSha256) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Job receipt head is inconsistent.");
      try {
        validateUniversalAdmissionReceiptChain(
          job.receiptDigests.map((receiptSha256) => this.receipts.get(receiptSha256)),
          {
            ...this.#publicJob(job),
            capacityPolicySha256: this.capacityPolicySha256,
            resultSha256: job.resultSha256,
            runtimePolicy: this.policy,
            serviceAudience: this.serviceAudience
          }
        );
      } catch (cause) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Job receipt chain differs from its immutable endpoints or state.", { cause });
      }
      const revision = this.revisions.get(job.revisionKey);
      if (!revision || revision.jobId !== job.jobId || revision.revisionBindingSha256 !== job.revisionBindingSha256) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Job revision anti-equivocation record is absent or inconsistent.");
      }
      const terminalRetentionActive = job.terminalAtMs !== null && (
        (job.state === "dead-lettered" && this.now - job.terminalAtMs < BigInt(this.policy.deadLetterPayloadRetentionMs))
        || (job.state === "processing-completed" && this.now - job.terminalAtMs < BigInt(this.policy.terminalPayloadRetentionMs))
      );
      expectedObjectReferences.set(`${job.jobId}:admission`, job.admissionDigest);
      if (job.state === "processing-completed") {
        if (!job.completionBindings) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Completed job lacks immutable result reference descriptors.");
        }
        expectedObjectReferences.set(`${job.jobId}:result`, job.resultSha256);
        expectedObjectReferences.set(`${job.jobId}:report`, job.completionBindings.reportSha256);
        for (const artifact of job.completionBindings.artifacts) {
          expectedObjectReferences.set(`${job.jobId}:artifact:${artifact.id}`, artifact.sha256);
        }
      } else if (job.completionBindings !== null) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Non-completed job retains completion reference descriptors.");
      }
      if (active || terminalRetentionActive) {
        const admissionObject = this.objects.get(job.admissionDigest);
        if (!admissionObject
          || admissionObject.mediaType !== "universal-admission-envelope"
          || admissionObject.generation !== job.objectGeneration
          || !admissionObject.refs.has(`${job.jobId}:admission`)) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Non-expired job admission CAS media, generation, or exact reference is absent.");
        }
      }
      if (job.state === "processing-completed" && terminalRetentionActive) {
        const resultObject = this.objects.get(job.resultSha256);
        if (!resultObject
          || resultObject.mediaType !== "universal-admission-worker-result"
          || !resultObject.refs.has(`${job.jobId}:result`)) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Completed job worker-result CAS object or exact reference is absent.");
        }
        const result = parseUniversalAdmissionWorkerResultBytes(resultObject.bytes);
        const terminalReceipt = this.receipts.get(job.headReceiptSha256);
        if (terminalReceipt.result.resultSha256 !== job.resultSha256
          || terminalReceipt.result.reportSha256 !== result.reportSha256
          || terminalReceipt.result.artifactsSha256 !== digestProtocolValue(result.artifacts)
          || job.completionBindings.reportSha256 !== result.reportSha256
          || digestProtocolValue(job.completionBindings.artifacts) !== digestProtocolValue(result.artifacts)) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Completed job worker result differs from its terminal receipt.");
        }
        const reportObject = this.objects.get(result.reportSha256);
        if (!reportObject || reportObject.mediaType !== "public-evidence" || !reportObject.refs.has(`${job.jobId}:report`)) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Completed job report CAS object or exact reference is absent.");
        }
        for (const artifact of result.artifacts) {
          const artifactObject = this.objects.get(artifact.sha256);
          if (!artifactObject
            || artifactObject.mediaType !== "public-evidence"
            || BigInt(artifactObject.bytes.length) !== BigInt(artifact.byteLength)
            || !artifactObject.refs.has(`${job.jobId}:artifact:${artifact.id}`)) {
            protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Completed job artifact bytes or exact reference are absent.");
          }
        }
      }
    }
    if (outstanding !== this.global.outstanding
      || leased !== this.global.leased
      || maximumClaimOrdinal !== this.global.claimOrdinal
      || BigInt(claimOrdinals.size) !== this.global.claimOrdinal) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Global counters or contiguous claim ordinals differ from immutable job state.");
    }
    for (const [tenantId, state] of this.tenants) {
      if (state.outstanding !== (tenants.get(tenantId) ?? 0n)) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Tenant outstanding counter differs from job state.");
      if (state.leased !== (tenantLeases.get(tenantId) ?? 0n)) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Tenant leased counter differs from job state.");
      if (state.lastClaimOrdinal !== (tenantLastClaimOrdinals.get(tenantId) ?? 0n)) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Tenant fairness head differs from immutable lease claims.");
      const enqueueOrdinals = tenantEnqueueOrdinals.get(tenantId) ?? new Set();
      let maximumEnqueueOrdinal = 0n;
      for (const value of enqueueOrdinals) if (BigInt(value) > maximumEnqueueOrdinal) maximumEnqueueOrdinal = BigInt(value);
      if (BigInt(enqueueOrdinals.size) !== state.nextEnqueueOrdinal || maximumEnqueueOrdinal !== state.nextEnqueueOrdinal) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Tenant enqueue head differs from contiguous immutable queue events.");
      }
    }
    for (const [key, state] of this.applications) {
      if (state.outstanding !== (applications.get(key) ?? 0n)) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Application outstanding counter differs from job state.");
    }
    if (this.enqueueLedger.size !== observedEnqueueLedger.size) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable enqueue ledger length differs from immutable queue events.");
    }
    for (const [key, observed] of observedEnqueueLedger) {
      const stored = this.enqueueLedger.get(key);
      if (!stored || digestProtocolValue(stored) !== digestProtocolValue(observed)) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable enqueue ledger differs from its exact immutable queue event.");
      }
    }
    for (const [revisionKey, revision] of this.revisions) {
      const job = this.jobs.get(revision.jobId);
      const firstReceipt = job ? this.receipts.get(job.firstReceiptSha256) : null;
      if (!job || !firstReceipt || firstReceipt.eventType !== "queued"
        || job.revisionKey !== revisionKey
        || revision.admissionDigest !== job.admissionDigest
        || revision.applicationId !== job.applicationId
        || revision.revision !== job.revision
        || revision.tenantId !== job.tenantId
        || revision.firstReceiptSha256 !== job.firstReceiptSha256) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Revision anti-equivocation record differs from its immutable job and first receipt.");
      }
      const derived = deriveUniversalAdmissionRevisionBinding({
        bindings: {
          admissionDigest: job.admissionDigest,
          applicationId: job.applicationId,
          audience: this.serviceAudience,
          jobId: job.jobId,
          revision: job.revision,
          revisionKey: job.revisionKey,
          tenantId: job.tenantId
        },
        createdAtMs: firstReceipt.occurredAtMs,
        creatorPrincipalBindingSha256: firstReceipt.principalBindingSha256
      });
      if (derived.revisionBindingSha256 !== revision.revisionBindingSha256
        || Object.keys(derived.revisionBinding).some((key) => revision[key] !== derived.revisionBinding[key])) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Revision anti-equivocation binding preimage is inconsistent.");
      }
    }
    for (const [digest, object] of this.objects) {
      if (sha256Bytes(object.bytes) !== digest
        || object.bytes.length < 1
        || object.bytes.length > MAX_UNIVERSAL_ADMISSION_CAS_OBJECT_BYTES
        || object.generation < 1n
        || this.objectGenerations.get(digest) !== object.generation
        || !SAFE_MEDIA_TYPES.has(object.mediaType)) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "CAS digest, generation, or media metadata is inconsistent.");
      }
      const reservedMediaType = reservedMediaTypeForBytes(object.bytes);
      if ((reservedMediaType !== null && reservedMediaType !== object.mediaType)
        || (object.mediaType !== "public-evidence" && reservedMediaType !== object.mediaType)) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "CAS reserved media identity is inconsistent.");
      }
      if (object.mediaType !== "public-evidence") validateReservedProtocolObject(object.bytes, object.mediaType);
      for (const reference of object.refs) {
        if (expectedObjectReferences.get(reference) !== digest) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "CAS object retains a forged, unexpected, or digest-divergent job reference.");
        }
      }
    }
    const durableCommands = BigInt(this.requests.size + this.durableCommands.size);
    let durableCommandBytes = 0n;
    for (const record of [...this.requests.values(), ...this.durableCommands.values()]) durableCommandBytes += record.responseByteLength;
    if (durableCommands !== this.global.durableCommands || durableCommandBytes !== this.global.durableCommandBytes) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable command counters differ from replay state.");
    }
    for (const [commandKey, record] of this.durableCommands) this.#assertDurableCommandRecord(commandKey, record);
    for (const [requestKey, record] of this.requests) this.#assertAuthenticatedRequestRecord(requestKey, record);
    for (const [tenantId, tenant] of this.tenants) {
      const records = [...this.requests.values(), ...this.durableCommands.values()].filter((record) => record.tenantId === tenantId);
      const replayBytes = records.reduce((total, record) => total + record.responseByteLength, 0n);
      if (tenant.replayRecords !== BigInt(records.length) || tenant.replayBytes !== replayBytes) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Tenant replay counters differ from request state.");
      }
    }
    return true;
  }

  #runDurableCommand({ actorKey, commandId, commandKind, requestValue, tenantId = null }, operation) {
    const checkedCommandId = validateUniversalAdmissionCommandId(commandId);
    const requestBinding = deriveUniversalAdmissionDurableCommandRequestBinding({
      actorKey,
      commandId: checkedCommandId,
      commandKind,
      requestValue,
      serviceAudience: this.serviceAudience
    });
    this.#expireDurableCommands();
    const { commandKey, requestSha256 } = requestBinding;
    const existing = this.durableCommands.get(commandKey);
    if (existing) {
      this.#assertDurableCommandRecord(commandKey, existing);
      if (existing.requestSha256 !== requestSha256
        || digestProtocolValue(existing.requestValue) !== digestProtocolValue(requestBinding.requestValue)) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_REPLAY_CONFLICT", "Command id is already bound to different operation input.");
      }
      if (existing.outcome === "failure") throwStoredProtocolFailure(existing.failure);
      return freeze(existing.result);
    }
    if (this.global.durableCommands + 1n > BigInt(this.policy.maxDurableCommands)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_CAPACITY", "Durable command replay capacity is exhausted.", {
        retryable: true,
        retryAfterMs: this.#durableRetryAfterMs()
      });
    }
    const tenant = tenantId === null ? null : this.#tenant(tenantId);
    if (tenant !== null && tenant.replayRecords + 1n > BigInt(this.policy.maxTenantReplayRecords)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_TENANT_REPLAY_CAPACITY", "Tenant command replay record capacity is exhausted.", {
        retryable: true,
        retryAfterMs: this.#tenantReplayRetryAfterMs(tenant)
      });
    }
    const minimumResponseBytes = BigInt(MIN_UNIVERSAL_ADMISSION_DURABLE_RESPONSE_RESERVATION_BYTES);
    if (tenant !== null && tenant.replayBytes + minimumResponseBytes > BigInt(this.policy.maxTenantReplayBytes)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_TENANT_REPLAY_BYTE_CAPACITY", "Tenant command replay byte capacity is exhausted.", {
        retryable: true,
        retryAfterMs: this.#tenantReplayRetryAfterMs(tenant)
      });
    }
    if (this.global.durableCommandBytes + minimumResponseBytes > BigInt(this.policy.maxDurableCommandBytes)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY", "Durable command response byte capacity is exhausted.", {
        retryable: true,
        retryAfterMs: this.#durableRetryAfterMs()
      });
    }
    const before = this.#captureState();
    try {
      const result = operation();
      const responseByteLength = BigInt(durableResponseBytes(result).length);
      if (tenant !== null && tenant.replayBytes + responseByteLength > BigInt(this.policy.maxTenantReplayBytes)) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_TENANT_REPLAY_BYTE_CAPACITY", "Tenant command replay byte capacity is exhausted.", {
          retryable: true,
          retryAfterMs: this.#tenantReplayRetryAfterMs(tenant)
        });
      }
      if (this.global.durableCommandBytes + responseByteLength > BigInt(this.policy.maxDurableCommandBytes)) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY", "Durable command response byte capacity is exhausted.", {
          retryable: true,
          retryAfterMs: this.#durableRetryAfterMs()
        });
      }
      this.durableCommands.set(commandKey, {
        actorKey,
        commandId: checkedCommandId,
        commandKind,
        createdAtMs: this.now,
        effectKeys: deriveUniversalAdmissionDurableCommandEffectKeys({
          commandKind,
          requestValue: requestBinding.requestValue,
          response: result
        }),
        expiresAtMs: this.now + BigInt(this.policy.commandReplayRetentionMs),
        outcome: "success",
        requestSha256,
        requestValue: cloneFixtureValue(requestBinding.requestValue),
        responseByteLength,
        result: cloneFixtureValue(result),
        resultSha256: digestProtocolValue(durableJsonValue(result)),
        tenantId
      });
      this.global.durableCommands += 1n;
      this.global.durableCommandBytes += responseByteLength;
      if (tenant !== null) {
        tenant.replayRecords += 1n;
        tenant.replayBytes += responseByteLength;
      }
      return freeze(result);
    } catch (error) {
      this.#restoreState(before);
      if (error instanceof UniversalAdmissionProtocolError) {
        if (isUniversalAdmissionDurableCommandFailureCode({ commandKind, code: error.code })) {
          this.#storeDurableCommandFailure({
            commandId: checkedCommandId,
            commandKey,
            commandKind,
            error,
            actorKey,
            requestSha256,
            requestValue: requestBinding.requestValue,
            tenantId
          });
        }
      }
      throw error;
    }
  }

  #assertDurableCommandRecord(commandKey, record) {
    try {
      const binding = deriveUniversalAdmissionDurableCommandRequestBinding({
        actorKey: record.actorKey,
        commandId: record.commandId,
        commandKind: record.commandKind,
        requestValue: record.requestValue,
        serviceAudience: this.serviceAudience
      });
      if (binding.commandKey !== commandKey
        || binding.requestSha256 !== record.requestSha256
        || record.expiresAtMs !== record.createdAtMs + BigInt(this.policy.commandReplayRetentionMs)) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable command key, request preimage, or retention is inconsistent.");
      }
      const workerKinds = new Set(["claim", "complete", "fail", "renew"]);
      if (workerKinds.has(record.commandKind)) {
        if (record.tenantId !== null || record.requestValue.worker?.workerBindingSha256 !== record.actorKey) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable worker command actor binding is inconsistent.");
        }
      } else if (record.commandKind === "redrive") {
        if (record.tenantId === null
          || record.requestValue.principal?.principalBindingSha256 !== record.actorKey
          || record.requestValue.principal?.tenantId !== record.tenantId) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable applicant redrive actor binding is inconsistent.");
        }
      } else {
        const expectedSystemActor = {
          gc: "system:gc",
          "reap-expired": "system:lease-reaper",
          snapshot: "system:snapshot"
        }[record.commandKind];
        if (expectedSystemActor !== record.actorKey || record.tenantId !== null) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable system command actor binding is inconsistent.");
        }
      }
      const outcome = record.outcome === "success" ? record.result : record.failure;
      if (!new Set(["success", "failure"]).has(record.outcome) || !outcome) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable command outcome is invalid.");
      }
      const outcomeBytes = durableResponseBytes(outcome);
      if (record.responseByteLength !== BigInt(outcomeBytes.length)
        || record.resultSha256 !== digestProtocolValue(durableJsonValue(outcome))) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable command response bytes or digest are inconsistent.");
      }
      const expectedEffectKeys = record.outcome === "success"
        ? deriveUniversalAdmissionDurableCommandEffectKeys({
          commandKind: record.commandKind,
          requestValue: record.requestValue,
          response: record.result
        })
        : emptyDurableCommandEffectKeys();
      if (digestProtocolValue(expectedEffectKeys) !== digestProtocolValue(record.effectKeys)) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable command effect keys differ from its exact request and response.");
      }
      if (record.outcome === "success") this.#assertDurableCommandSuccess(record);
      else validateUniversalAdmissionDurableCommandFailure({ commandKind: record.commandKind, failure: record.failure });
    } catch (cause) {
      if (cause instanceof UniversalAdmissionProtocolError
        && cause.code === "UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION") throw cause;
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable command replay row is not self-consistent.", { cause });
    }
  }

  #assertAuthenticatedRequestRecord(requestKey, record) {
    try {
      const request = validateUniversalAdmissionRequestBinding({
        authenticatedRequestByteLength: record.authenticatedRequestByteLength,
        expectedCapacityPolicySha256: record.expectedCapacityPolicySha256,
        requestDigest: record.requestDigest,
        requestId: record.requestId
      });
      normalizeFixtureDigest(record.admissionDigest, "request admissionDigest");
      normalizeFixtureDigest(record.principalBindingSha256, "request principalBindingSha256");
      const expectedRequestKey = deriveUniversalAdmissionRequestKey({
        audience: this.serviceAudience,
        requestId: record.requestId,
        tenantId: record.tenantId
      });
      if (expectedRequestKey !== requestKey
        || request.expectedCapacityPolicySha256 !== this.capacityPolicySha256
        || record.expiresAtMs !== record.createdAtMs + BigInt(this.policy.commandReplayRetentionMs)) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Authenticated request key, policy, or retention is inconsistent.");
      }
      const outcome = record.outcome === "success" ? record.result : record.failure;
      if (!new Set(["success", "failure"]).has(record.outcome) || !outcome) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Authenticated request outcome is invalid.");
      }
      const outcomeBytes = durableResponseBytes(outcome);
      if (record.responseByteLength !== BigInt(outcomeBytes.length)
        || record.resultSha256 !== digestProtocolValue(durableJsonValue(outcome))) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Authenticated request response bytes or digest are inconsistent.");
      }
      if (record.outcome === "failure") {
        if (record.result !== null) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Failed authenticated request retains a success response.");
        assertStoredProtocolFailure(record.failure);
        return;
      }
      const response = record.result;
      if (!isExactFixtureObject(response, ["admissionDigest", "authority", "eventReceipt", "idempotencyKey", "jobId", "principalBindingSha256", "receiptSha256", "requestDigest", "requestId", "revisionBindingSha256", "revisionKey", "status", "tenantId"])
        || !new Set(["DUPLICATE", "QUEUED"]).has(response.status)
        || response.requestId !== record.requestId
        || response.requestDigest !== record.requestDigest
        || response.tenantId !== record.tenantId
        || response.principalBindingSha256 !== record.principalBindingSha256
        || response.admissionDigest !== record.admissionDigest
        || digestProtocolValue(response.authority) !== digestProtocolValue(inertProtocolAuthority())) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Authenticated request success response has an invalid closed identity.");
      }
      const receipt = this.#durableEffectReceipt(response.receiptSha256, response.jobId, ["queued"]);
      if (sha256Bytes(canonicalProtocolBytes(response.eventReceipt)) !== response.receiptSha256
        || digestProtocolValue(response.eventReceipt) !== digestProtocolValue(receipt)
        || receipt.job.admissionDigest !== response.admissionDigest
        || receipt.job.tenantId !== response.tenantId
        || receipt.job.revisionBindingSha256 !== response.revisionBindingSha256
        || receipt.job.revisionKey !== response.revisionKey
        || receipt.idempotencyKey !== response.idempotencyKey) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Authenticated request response differs from its immutable initial receipt.");
      }
      const isInitialRequest = receipt.request.requestId === response.requestId
        && receipt.request.requestDigest === response.requestDigest
        && receipt.request.authenticatedRequestByteLength === record.authenticatedRequestByteLength
        && receipt.request.expectedCapacityPolicySha256 === record.expectedCapacityPolicySha256
        && receipt.principalBindingSha256 === response.principalBindingSha256;
      if ((response.status === "QUEUED") !== isInitialRequest) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Authenticated request status does not distinguish the initial request from a duplicate.");
      }
    } catch (cause) {
      if (cause instanceof UniversalAdmissionProtocolError
        && cause.code === "UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION") throw cause;
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Authenticated request replay row is not self-consistent.", { cause });
    }
  }

  #assertDurableCommandSuccess(record) {
    const response = record.result;
    const request = record.requestValue;
    if (record.commandKind === "claim") {
      if (isExactFixtureObject(response, ["reason", "status"])
        && response.status === "NO_WORK"
        && new Set(["GLOBAL_LEASE_CAPACITY", "NO_ELIGIBLE_JOB"]).has(response.reason)) return;
      if (!isExactFixtureObject(response, ["admissionDigest", "envelopeBytes", "jobId", "lease", "receiptSha256", "revisionBindingSha256", "revisionKey", "status"])
        || response.status !== "LEASED"
        || !(response.envelopeBytes instanceof Uint8Array)
        || sha256Bytes(response.envelopeBytes) !== response.admissionDigest) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable claim response has an invalid closed payload.");
      }
      const receipt = this.#durableEffectReceipt(response.receiptSha256, response.jobId, ["lease-claimed"]);
      if (receipt.workerBindingSha256 !== record.actorKey
        || digestProtocolValue(receipt.lease) !== digestProtocolValue(response.lease)
        || receipt.job.admissionDigest !== response.admissionDigest
        || receipt.job.revisionBindingSha256 !== response.revisionBindingSha256
        || receipt.job.revisionKey !== response.revisionKey) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable claim response differs from its immutable receipt effect.");
      }
      return;
    }
    if (record.commandKind === "renew") {
      if (!isExactFixtureObject(response, ["lease", "receiptSha256", "status"]) || response.status !== "LEASED") {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable renewal response has an invalid closed payload.");
      }
      const receipt = this.#durableEffectReceipt(response.receiptSha256, request.jobId, ["lease-renewed"]);
      if (receipt.workerBindingSha256 !== record.actorKey
        || request.leaseId !== receipt.lease.leaseId
        || request.fenceToken !== receipt.lease.fenceToken
        || digestProtocolValue(receipt.lease) !== digestProtocolValue(response.lease)) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable renewal response differs from its exact command and receipt effect.");
      }
      return;
    }
    if (record.commandKind === "fail") {
      const retry = isExactFixtureObject(response, ["availableAtMs", "jobId", "receiptSha256", "status"]) && response.status === "RETRY_WAIT";
      const dead = isExactFixtureObject(response, ["jobId", "receiptSha256", "status"]) && response.status === "DEAD_LETTERED";
      if (!retry && !dead) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable failure response has an invalid closed payload.");
      const receipt = this.#durableEffectReceipt(response.receiptSha256, request.jobId, [retry ? "retry-scheduled" : "dead-lettered"]);
      if (response.jobId !== request.jobId
        || receipt.workerBindingSha256 !== record.actorKey
        || request.leaseId !== receipt.lease.leaseId
        || request.fenceToken !== receipt.lease.fenceToken
        || digestProtocolValue(request.failure) !== digestProtocolValue(receipt.failure)
        || (retry && response.availableAtMs !== receipt.job.availableAtMs)
        || receipt.failure.code === "LEASE_EXPIRED") {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable failure response differs from its exact command and receipt effect.");
      }
      return;
    }
    if (record.commandKind === "reap-expired") {
      if (!isExactFixtureObject(response, ["processed", "results"])
        || !Array.isArray(response.results)
        || response.processed !== String(response.results.length)
        || response.results.length > request.limit) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable reaper response has an invalid closed batch.");
      }
      const receipts = new Set();
      const jobs = new Set();
      for (const result of response.results) {
        const retry = isExactFixtureObject(result, ["availableAtMs", "jobId", "receiptSha256", "status"]) && result.status === "RETRY_WAIT";
        const dead = isExactFixtureObject(result, ["jobId", "receiptSha256", "status"]) && result.status === "DEAD_LETTERED";
        if (!retry && !dead) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable reaper result has an invalid shape.");
        const receipt = this.#durableEffectReceipt(result.receiptSha256, result.jobId, [retry ? "retry-scheduled" : "dead-lettered"]);
        if (receipt.failure.code !== "LEASE_EXPIRED"
          || receipt.failure.retryable !== true
          || receipt.failure.detailsSha256 !== digestProtocolValue({ jobId: receipt.job.jobId, leaseId: receipt.lease.leaseId })
          || receipts.has(result.receiptSha256)
          || jobs.has(result.jobId)) {
          protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable reaper result differs from its unique immutable receipt effect.");
        }
        receipts.add(result.receiptSha256);
        jobs.add(result.jobId);
      }
      return;
    }
    if (record.commandKind === "redrive") {
      if (!isExactFixtureObject(response, ["jobId", "receiptSha256", "status"])
        || response.status !== "QUEUED" || response.jobId !== request.jobId) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable redrive response has an invalid closed payload.");
      }
      const receipt = this.#durableEffectReceipt(response.receiptSha256, request.jobId, ["dead-letter-redriven"]);
      if (receipt.principalBindingSha256 !== record.actorKey
        || receipt.previousReceiptSha256 !== request.expectedReceiptSha256
        || receipt.job.tenantId !== record.tenantId) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable redrive response differs from its exact command and receipt effect.");
      }
      return;
    }
    if (record.commandKind === "complete") {
      if (!isExactFixtureObject(response, ["jobId", "receiptSha256", "resultSha256", "status"])
        || response.status !== "PROCESSING_COMPLETED"
        || response.jobId !== request.jobId
        || response.resultSha256 !== request.resultSha256) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable completion response has an invalid closed payload.");
      }
      const receipt = this.#durableEffectReceipt(response.receiptSha256, request.jobId, ["processing-completed"]);
      if (receipt.workerBindingSha256 !== record.actorKey || receipt.result.resultSha256 !== response.resultSha256) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable completion response differs from its exact command and receipt effect.");
      }
      return;
    }
    if (record.commandKind === "snapshot") {
      if (!isExactFixtureObject(response, ["manifest", "snapshotSha256"])) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable snapshot response has an invalid closed payload.");
      }
      const snapshot = this.snapshots.get(response.snapshotSha256);
      if (!snapshot
        || sha256Bytes(canonicalProtocolBytes(response.manifest)) !== response.snapshotSha256
        || digestProtocolValue(snapshot.manifest) !== digestProtocolValue(response.manifest)) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable snapshot response differs from its immutable manifest effect.");
      }
      return;
    }
    if (record.commandKind === "gc") {
      if (!isExactFixtureObject(response, ["deletedCount", "done", "remainingCount", "snapshotSha256"])
        || response.snapshotSha256 !== request.snapshotSha256
        || !this.snapshots.has(response.snapshotSha256)
        || typeof response.done !== "boolean"
        || response.done !== (response.remainingCount === "0")) {
        protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable GC response differs from its exact snapshot command effect.");
      }
      parseDecimal(response.deletedCount, "durable GC deletedCount");
      parseDecimal(response.remainingCount, "durable GC remainingCount");
      return;
    }
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable command kind has no closed success-effect validator.");
  }

  #durableEffectReceipt(receiptSha256, jobId, eventTypes) {
    const receipt = this.receipts.get(receiptSha256);
    const job = this.jobs.get(jobId);
    const object = this.objects.get(receiptSha256);
    if (!receipt || !job || !object
      || receipt.job.jobId !== jobId
      || !job.receiptDigests.includes(receiptSha256)
      || !eventTypes.includes(receipt.eventType)
      || sha256Bytes(canonicalProtocolBytes(receipt)) !== receiptSha256
      || !object.bytes.equals(canonicalProtocolBytes(receipt))) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Durable response references a missing or different immutable receipt effect.");
    }
    return receipt;
  }

  #requestRecord({ admissionDigest, principalBindingSha256, request, requestKey }) {
    const existing = this.requests.get(requestKey);
    if (!existing) return null;
    if (existing.requestDigest !== request.requestDigest
      || existing.authenticatedRequestByteLength !== request.authenticatedRequestByteLength
      || existing.expectedCapacityPolicySha256 !== request.expectedCapacityPolicySha256
      || existing.admissionDigest !== admissionDigest) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_REQUEST_REPLAY_CONFLICT", "Authenticated request id is already bound to a different command digest.");
    }
    if (existing.principalBindingSha256 !== principalBindingSha256) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_REQUEST_PRINCIPAL_MISMATCH", "Authenticated request id belongs to a different principal binding.");
    }
    return existing;
  }

  #assertAuthenticatedRequestReservation({ byteLength, tenant }) {
    const retryAfterMs = String(tenant.windowStartMs + BigInt(this.policy.fixedWindowMs) - this.now);
    if (tenant.authenticatedRequests + 1n > BigInt(this.policy.maxTenantAuthenticatedRequestsPerWindow)
      || tenant.authenticatedRequestBytes + byteLength > BigInt(this.policy.maxTenantAuthenticatedRequestBytesPerWindow)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_AUTHENTICATED_REQUEST_RATE_LIMITED", "Tenant authenticated ingress budget is exhausted.", { retryable: true, retryAfterMs });
    }
    if (tenant.replayRecords + 1n > BigInt(this.policy.maxTenantReplayRecords)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_TENANT_REPLAY_CAPACITY", "Tenant request replay record capacity is exhausted.", {
        retryable: true,
        retryAfterMs: this.#tenantReplayRetryAfterMs(tenant)
      });
    }
    if (this.global.durableCommands + 1n > BigInt(this.policy.maxDurableCommands)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_CAPACITY", "Durable command replay capacity is exhausted.", {
        retryable: true,
        retryAfterMs: this.#durableRetryAfterMs()
      });
    }
    const minimumResponseBytes = BigInt(MIN_UNIVERSAL_ADMISSION_DURABLE_RESPONSE_RESERVATION_BYTES);
    if (tenant.replayBytes + minimumResponseBytes > BigInt(this.policy.maxTenantReplayBytes)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_TENANT_REPLAY_BYTE_CAPACITY", "Tenant request replay byte capacity is exhausted.", {
        retryable: true,
        retryAfterMs: this.#tenantReplayRetryAfterMs(tenant)
      });
    }
    if (this.global.durableCommandBytes + minimumResponseBytes > BigInt(this.policy.maxDurableCommandBytes)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY", "Durable command response byte capacity is exhausted.", {
        retryable: true,
        retryAfterMs: this.#durableRetryAfterMs()
      });
    }
  }

  #reserveAuthenticatedRequest({ bindings, request, requestKey, tenant }) {
    tenant.authenticatedRequests += 1n;
    tenant.authenticatedRequestBytes += BigInt(request.authenticatedRequestByteLength);
    tenant.replayRecords += 1n;
    this.global.durableCommands += 1n;
    this.requests.set(requestKey, {
      admissionDigest: bindings.admissionDigest,
      authenticatedRequestByteLength: request.authenticatedRequestByteLength,
      createdAtMs: this.now,
      expiresAtMs: this.now + BigInt(this.policy.commandReplayRetentionMs),
      expectedCapacityPolicySha256: request.expectedCapacityPolicySha256,
      principalBindingSha256: bindings.principal.principalBindingSha256,
      outcome: "pending",
      requestDigest: request.requestDigest,
      requestId: request.requestId,
      responseByteLength: 0n,
      result: null,
      resultSha256: null,
      tenantId: bindings.tenantId
    });
  }

  #assertRequestResultCapacity({ response, tenant }) {
    const responseByteLength = BigInt(durableResponseBytes(response).length);
    if (tenant.replayBytes + responseByteLength > BigInt(this.policy.maxTenantReplayBytes)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_TENANT_REPLAY_BYTE_CAPACITY", "Tenant request replay byte capacity is exhausted.", {
        retryable: true,
        retryAfterMs: this.#tenantReplayRetryAfterMs(tenant)
      });
    }
    if (this.global.durableCommandBytes + responseByteLength > BigInt(this.policy.maxDurableCommandBytes)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_BYTE_CAPACITY", "Durable command response byte capacity is exhausted.", {
        retryable: true,
        retryAfterMs: this.#durableRetryAfterMs()
      });
    }
    return responseByteLength;
  }

  #storeRequestResult({ requestKey, response, tenant }) {
    const record = this.requests.get(requestKey);
    if (!record) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Reserved authenticated request replay row is absent.");
    if (record.outcome === "success") return freeze(record.result);
    if (record.outcome === "failure") throwStoredProtocolFailure(record.failure);
    const responseByteLength = this.#assertRequestResultCapacity({ response, tenant });
    record.result = cloneFixtureValue(response);
    record.resultSha256 = digestProtocolValue(durableJsonValue(response));
    record.responseByteLength = responseByteLength;
    record.outcome = "success";
    tenant.replayBytes += responseByteLength;
    this.global.durableCommandBytes += responseByteLength;
    return freeze(response);
  }

  #storeRequestFailure({ error, requestKey }) {
    const record = this.requests.get(requestKey);
    if (!record) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Reserved authenticated request replay row is absent after protocol failure.");
    if (record.outcome !== "pending") return;
    const failure = storedProtocolFailure(error);
    const responseByteLength = BigInt(durableResponseBytes(failure).length);
    if (responseByteLength > BigInt(MIN_UNIVERSAL_ADMISSION_DURABLE_RESPONSE_RESERVATION_BYTES)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Stored protocol failure exceeds its bounded reservation.");
    }
    const tenant = this.#tenant(record.tenantId);
    if (tenant.replayBytes + responseByteLength > BigInt(this.policy.maxTenantReplayBytes)
      || this.global.durableCommandBytes + responseByteLength > BigInt(this.policy.maxDurableCommandBytes)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Reserved protocol failure no longer fits replay byte capacity.");
    }
    record.failure = failure;
    record.outcome = "failure";
    record.responseByteLength = responseByteLength;
    record.resultSha256 = digestProtocolValue(failure);
    tenant.replayBytes += responseByteLength;
    this.global.durableCommandBytes += responseByteLength;
  }

  #storeDurableCommandFailure({ actorKey, commandId, commandKey, commandKind, error, requestSha256, requestValue, tenantId }) {
    const failure = validateUniversalAdmissionDurableCommandFailure({
      commandKind,
      failure: storedProtocolFailure(error)
    });
    const responseByteLength = BigInt(durableResponseBytes(failure).length);
    const tenant = tenantId === null ? null : this.#tenant(tenantId);
    if (responseByteLength > BigInt(MIN_UNIVERSAL_ADMISSION_DURABLE_RESPONSE_RESERVATION_BYTES)
      || this.global.durableCommandBytes + responseByteLength > BigInt(this.policy.maxDurableCommandBytes)
      || (tenant !== null && tenant.replayBytes + responseByteLength > BigInt(this.policy.maxTenantReplayBytes))) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Reserved durable command failure no longer fits replay byte capacity.");
    }
    this.durableCommands.set(commandKey, {
      actorKey,
      commandId,
      commandKind,
      createdAtMs: this.now,
      effectKeys: emptyDurableCommandEffectKeys(),
      expiresAtMs: this.now + BigInt(this.policy.commandReplayRetentionMs),
      failure,
      outcome: "failure",
      requestSha256,
      requestValue: cloneFixtureValue(requestValue),
      responseByteLength,
      result: null,
      resultSha256: digestProtocolValue(failure),
      tenantId
    });
    this.global.durableCommands += 1n;
    this.global.durableCommandBytes += responseByteLength;
    if (tenant !== null) {
      tenant.replayRecords += 1n;
      tenant.replayBytes += responseByteLength;
    }
  }

  #expireDurableCommands() {
    for (const [requestKey, record] of this.requests) {
      if (record.expiresAtMs > this.now) continue;
      const tenant = this.tenants.get(record.tenantId);
      if (tenant) {
        tenant.replayRecords -= 1n;
        tenant.replayBytes -= record.responseByteLength;
      }
      this.global.durableCommands -= 1n;
      this.global.durableCommandBytes -= record.responseByteLength;
      this.requests.delete(requestKey);
    }
    for (const [commandKey, record] of this.durableCommands) {
      if (record.expiresAtMs > this.now) continue;
      if (record.tenantId !== null) {
        const tenant = this.tenants.get(record.tenantId);
        if (tenant) {
          tenant.replayRecords -= 1n;
          tenant.replayBytes -= record.responseByteLength;
        }
      }
      this.global.durableCommands -= 1n;
      this.global.durableCommandBytes -= record.responseByteLength;
      this.durableCommands.delete(commandKey);
    }
  }

  #tenantReplayRetryAfterMs(tenant) {
    let next = null;
    for (const record of [...this.requests.values(), ...this.durableCommands.values()]) {
      if (record.tenantId !== this.#tenantIdForState(tenant)) continue;
      next = next === null || record.expiresAtMs < next ? record.expiresAtMs : next;
    }
    return String((next ?? (this.now + BigInt(this.policy.commandReplayRetentionMs))) - this.now);
  }

  #tenantIdForState(tenant) {
    for (const [tenantId, state] of this.tenants) if (state === tenant) return tenantId;
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Tenant replay state is detached from its key.");
  }

  #durableRetryAfterMs() {
    let next = null;
    for (const record of [...this.requests.values(), ...this.durableCommands.values()]) {
      next = next === null || record.expiresAtMs < next ? record.expiresAtMs : next;
    }
    return String((next ?? (this.now + BigInt(this.policy.commandReplayRetentionMs))) - this.now);
  }

  #captureState() {
    return {
      applications: cloneFixtureValue(this.applications),
      durableCommands: cloneFixtureValue(this.durableCommands),
      enqueueLedger: cloneFixtureValue(this.enqueueLedger),
      global: cloneFixtureValue(this.global),
      jobs: cloneFixtureValue(this.jobs),
      objectGenerations: cloneFixtureValue(this.objectGenerations),
      objects: cloneFixtureValue(this.objects),
      receipts: cloneFixtureValue(this.receipts),
      requests: cloneFixtureValue(this.requests),
      revisions: cloneFixtureValue(this.revisions),
      snapshotHead: this.snapshotHead,
      snapshots: cloneFixtureValue(this.snapshots),
      tenants: cloneFixtureValue(this.tenants)
    };
  }

  #restoreState(state) {
    this.applications = state.applications;
    this.durableCommands = state.durableCommands;
    this.enqueueLedger = state.enqueueLedger;
    this.global = state.global;
    this.jobs = state.jobs;
    this.objectGenerations = state.objectGenerations;
    this.objects = state.objects;
    this.receipts = state.receipts;
    this.requests = state.requests;
    this.revisions = state.revisions;
    this.snapshotHead = state.snapshotHead;
    this.snapshots = state.snapshots;
    this.tenants = state.tenants;
  }

  #existingRevisionResult(revision, bindings, request) {
    if (revision.admissionDigest !== bindings.admissionDigest) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_REVISION_EQUIVOCATION", "Tenant/application/revision is already bound to a different admission digest.");
    }
    const job = this.#job(revision.jobId);
    return this.#submissionResponse({ bindings, job, receiptSha256: revision.firstReceiptSha256, request, status: "DUPLICATE" });
  }

  #submitReserved({ bindings, bytes, request, requestKey, tenant }) {
    const existingRevision = this.revisions.get(bindings.revisionKey);
    if (existingRevision) {
      const response = this.#existingRevisionResult(existingRevision, bindings, request);
      this.#assertRequestResultCapacity({ response, tenant });
      return this.#storeRequestResult({ requestKey, response, tenant });
    }

    const application = this.#application(bindings.tenantId, bindings.applicationId);
    const byteLength = BigInt(bindings.envelopeByteLength);
    this.#assertSubmitCapacity({ application, byteLength, tenant });
    const object = this.#putObjectIfAbsent({ bytes, mediaType: "universal-admission-envelope" });
    const { revisionBinding, revisionBindingSha256 } = deriveUniversalAdmissionRevisionBinding({
      bindings,
      createdAtMs: String(this.now),
      creatorPrincipalBindingSha256: bindings.principal.principalBindingSha256
    });
    const nextEnqueueOrdinal = tenant.nextEnqueueOrdinal + 1n;
    const job = {
      admissionDigest: bindings.admissionDigest,
      applicationId: bindings.applicationId,
      attempt: 0n,
      availableAtMs: this.now,
      completionBindings: null,
      cycle: 0n,
      enqueueOrdinal: nextEnqueueOrdinal,
      eventIndex: 0n,
      fenceToken: 0n,
      firstReceiptSha256: null,
      headReceiptSha256: null,
      jobId: bindings.jobId,
      lease: null,
      objectGeneration: BigInt(object.generation),
      receiptDigests: [],
      redrives: 0n,
      resultSha256: null,
      revision: bindings.revision,
      revisionBindingSha256,
      revisionKey: bindings.revisionKey,
      state: "queued",
      tenantId: bindings.tenantId,
      terminalAtMs: null
    };
    const preparedReceipt = this.#prepareReceipt(job, {
      eventType: "queued",
      failure: null,
      lease: null,
      principalBindingSha256: bindings.principal.principalBindingSha256,
      request,
      result: null,
      transition: { from: null, to: "queued" },
      workerBindingSha256: null
    });
    const response = this.#submissionResponse({
      bindings,
      eventReceipt: preparedReceipt.receipt,
      job,
      receiptSha256: preparedReceipt.receiptSha256,
      request,
      status: "QUEUED"
    });
    this.#assertRequestResultCapacity({ response, tenant });
    const receipt = this.#commitPreparedReceipt(job, preparedReceipt);
    job.firstReceiptSha256 = receipt.receiptSha256;
    this.#recordEnqueue(job, receipt);
    tenant.nextEnqueueOrdinal = nextEnqueueOrdinal;
    this.jobs.set(job.jobId, job);
    this.#addObjectRef(job.admissionDigest, `${job.jobId}:admission`);
    this.#consumeSubmitCapacity({ application, byteLength, tenant });
    this.revisions.set(bindings.revisionKey, {
      ...revisionBinding,
      firstReceiptSha256: receipt.receiptSha256,
      jobId: job.jobId,
      revisionBindingSha256
    });
    return this.#storeRequestResult({ requestKey, response, tenant });
  }

  #submissionResponse({ bindings, eventReceipt = null, job, receiptSha256, request, status }) {
    const immutableEventReceipt = eventReceipt ?? this.receipts.get(receiptSha256);
    if (!immutableEventReceipt) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Submission receipt is absent from the immutable receipt store.");
    return freeze({
      admissionDigest: bindings.admissionDigest,
      authority: inertProtocolAuthority(),
      eventReceipt: immutableEventReceipt,
      idempotencyKey: bindings.idempotencyKey,
      jobId: job.jobId,
      principalBindingSha256: bindings.principal.principalBindingSha256,
      receiptSha256,
      requestDigest: request.requestDigest,
      requestId: request.requestId,
      revisionBindingSha256: job.revisionBindingSha256,
      revisionKey: job.revisionKey,
      status,
      tenantId: job.tenantId
    });
  }

  #appendReceipt(job, event) {
    return this.#commitPreparedReceipt(job, this.#prepareReceipt(job, event));
  }

  #recordEnqueue(job, receipt) {
    const key = `${job.tenantId}\u0000${job.enqueueOrdinal}`;
    if (this.enqueueLedger.has(key)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Tenant enqueue ordinal already has a durable event binding.");
    }
    this.enqueueLedger.set(key, {
      eventIndex: receipt.receipt.eventIndex,
      eventType: receipt.receipt.eventType,
      jobId: job.jobId,
      receiptSha256: receipt.receiptSha256
    });
  }

  #prepareReceipt(job, event) {
    const nextEventIndex = job.eventIndex + 1n;
    const receipt = buildUniversalAdmissionEventReceipt({
      capacityPolicySha256: this.capacityPolicySha256,
      eventIndex: String(nextEventIndex),
      eventType: event.eventType,
      failure: event.failure,
      idempotencyKey: deriveIdempotencyKeyFromJob(job, this.serviceAudience),
      job: {
        admissionDigest: job.admissionDigest,
        applicationId: job.applicationId,
        attempt: String(job.attempt),
        availableAtMs: String(job.availableAtMs),
        cycle: String(job.cycle),
        enqueueOrdinal: String(job.enqueueOrdinal),
        fenceToken: String(job.fenceToken),
        jobId: job.jobId,
        revision: job.revision,
        revisionBindingSha256: job.revisionBindingSha256,
        revisionKey: job.revisionKey,
        tenantId: job.tenantId
      },
      lease: event.lease === null ? null : structuredClone(event.lease),
      occurredAtMs: String(this.now),
      previousReceiptSha256: job.headReceiptSha256,
      principalBindingSha256: event.principalBindingSha256,
      request: event.request ?? null,
      result: event.result,
      serviceAudience: this.serviceAudience,
      transition: event.transition,
      workerBindingSha256: event.workerBindingSha256
    });
    const bytes = canonicalProtocolBytes(receipt);
    return { bytes, nextEventIndex, receipt, receiptSha256: sha256Bytes(bytes) };
  }

  #commitPreparedReceipt(job, prepared) {
    const { bytes, nextEventIndex, receipt, receiptSha256 } = prepared;
    const stored = this.#putObjectIfAbsent({ bytes, mediaType: "universal-admission-event-receipt" });
    if (stored.digest !== receiptSha256) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Prepared receipt digest changed during CAS commit.");
    this.objects.get(receiptSha256).refs.add(`${job.jobId}:receipt:${nextEventIndex}`);
    job.eventIndex = nextEventIndex;
    this.receipts.set(receiptSha256, receipt);
    job.receiptDigests.push(receiptSha256);
    job.headReceiptSha256 = receiptSha256;
    return { receipt, receiptSha256 };
  }

  #assertLease(job, { fenceToken, leaseId, workerBindingSha256 }, { allowExpired = false } = {}) {
    if (job.state !== "leased" || job.lease === null) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_JOB_STATE_CONFLICT", "Job has no live lease.");
    if (String(fenceToken) !== String(job.fenceToken) || String(fenceToken) !== job.lease.fenceToken) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_STALE_FENCE", "Lease fence is stale.");
    if (leaseId !== job.lease.leaseId) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_LEASE_NOT_FOUND", "Lease id does not match the current lease.");
    if (workerBindingSha256 !== job.lease.workerBindingSha256) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_LEASE_OWNER_MISMATCH", "Lease belongs to another authenticated worker.");
    if (!allowExpired && this.now >= BigInt(job.lease.expiresAtMs)) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_LEASE_EXPIRED", "Lease expired before this mutation.");
  }

  #settleFailure(job, failureValue, { allowExpired }) {
    const failure = validateUniversalAdmissionFailure(failureValue);
    this.#assertLease(job, {
      fenceToken: job.lease.fenceToken,
      leaseId: job.lease.leaseId,
      workerBindingSha256: job.lease.workerBindingSha256
    }, { allowExpired });
    const oldLease = structuredClone(job.lease);
    const workerBindingSha256 = oldLease.workerBindingSha256;
    const retry = failure.retryable && job.attempt < BigInt(this.policy.maxAttempts);
    if (retry) {
      const delay = BigInt(deterministicRetryDelayMs({
        attempt: String(job.attempt),
        cycle: String(job.cycle),
        jobId: job.jobId,
        policy: this.policy
      }));
      job.state = "retry-wait";
      job.availableAtMs = this.now + delay;
      const tenant = this.#tenant(job.tenantId);
      tenant.nextEnqueueOrdinal += 1n;
      job.enqueueOrdinal = tenant.nextEnqueueOrdinal;
      tenant.leased -= 1n;
      this.global.leased -= 1n;
      const receipt = this.#appendReceipt(job, {
        eventType: "retry-scheduled",
        failure,
        lease: oldLease,
        principalBindingSha256: null,
        result: null,
        transition: { from: "leased", to: "retry-wait" },
        workerBindingSha256
      });
      this.#recordEnqueue(job, receipt);
      job.lease = null;
      return freeze({ availableAtMs: String(job.availableAtMs), jobId: job.jobId, receiptSha256: receipt.receiptSha256, status: "RETRY_WAIT" });
    }
    job.state = "dead-lettered";
    job.terminalAtMs = this.now;
    this.#releaseOutstanding(job);
    const receipt = this.#appendReceipt(job, {
      eventType: "dead-lettered",
      failure,
      lease: oldLease,
      principalBindingSha256: null,
      result: null,
      transition: { from: "leased", to: "dead-lettered" },
      workerBindingSha256
    });
    job.lease = null;
    return freeze({ jobId: job.jobId, receiptSha256: receipt.receiptSha256, status: "DEAD_LETTERED" });
  }

  #releaseOutstanding(job) {
    const tenant = this.#tenant(job.tenantId);
    const application = this.#application(job.tenantId, job.applicationId);
    tenant.leased -= 1n;
    tenant.outstanding -= 1n;
    application.outstanding -= 1n;
    this.global.leased -= 1n;
    this.global.outstanding -= 1n;
  }

  #assertServiceAudience(audience) {
    if (audience !== this.serviceAudience) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_AUDIENCE_MISMATCH", "Authenticated principal or worker audience does not match the store audience.");
    }
  }

  #tenant(tenantId) {
    if (!this.tenants.has(tenantId)) {
      this.tenants.set(tenantId, {
        authenticatedRequestBytes: 0n,
        authenticatedRequests: 0n,
        lastClaimOrdinal: 0n,
        leased: 0n,
        nextEnqueueOrdinal: 0n,
        outstanding: 0n,
        replayBytes: 0n,
        replayRecords: 0n,
        windowBytes: 0n,
        windowJobs: 0n,
        windowStartMs: this.#windowStart()
      });
    }
    return this.tenants.get(tenantId);
  }

  #application(tenantId, applicationId) {
    const key = applicationKey(tenantId, applicationId);
    if (!this.applications.has(key)) this.applications.set(key, { outstanding: 0n });
    return this.applications.get(key);
  }

  #windowStart() {
    const size = BigInt(this.policy.fixedWindowMs);
    return (this.now / size) * size;
  }

  #resetWindow(tenant) {
    const start = this.#windowStart();
    if (tenant.windowStartMs !== start) {
      tenant.windowStartMs = start;
      tenant.authenticatedRequestBytes = 0n;
      tenant.authenticatedRequests = 0n;
      tenant.windowBytes = 0n;
      tenant.windowJobs = 0n;
    }
  }

  #assertSubmitCapacity({ application, byteLength, tenant }) {
    const retryAfterMs = String(tenant.windowStartMs + BigInt(this.policy.fixedWindowMs) - this.now);
    if (tenant.windowJobs + 1n > BigInt(this.policy.maxTenantNewJobsPerWindow)
      || tenant.windowBytes + byteLength > BigInt(this.policy.maxTenantNewBytesPerWindow)) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_TENANT_RATE_LIMITED", "Tenant fixed-window admission budget is exhausted.", { retryable: true, retryAfterMs });
    }
    if (application.outstanding + 1n > BigInt(this.policy.maxApplicationOutstanding)) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_APPLICATION_BACKPRESSURE", "Application outstanding capacity is exhausted.", { retryable: true });
    if (tenant.outstanding + 1n > BigInt(this.policy.maxTenantOutstanding)) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_TENANT_BACKPRESSURE", "Tenant outstanding capacity is exhausted.", { retryable: true });
    if (this.global.outstanding + 1n > BigInt(this.policy.maxGlobalOutstanding)) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_GLOBAL_BACKPRESSURE", "Global outstanding capacity is exhausted.", { retryable: true });
  }

  #consumeSubmitCapacity({ application, byteLength, tenant }) {
    application.outstanding += 1n;
    tenant.outstanding += 1n;
    tenant.windowJobs += 1n;
    tenant.windowBytes += byteLength;
    this.global.outstanding += 1n;
  }

  #addObjectRef(digest, reference) {
    const object = this.objects.get(digest);
    if (!object) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_CAS_CONFLICT", "Referenced CAS object is missing.");
    object.refs.add(reference);
  }

  #job(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_JOB_NOT_FOUND", "Admission job does not exist.");
    return job;
  }

  #publicJob(job) {
    return {
      admissionDigest: job.admissionDigest,
      applicationId: job.applicationId,
      attempt: String(job.attempt),
      availableAtMs: String(job.availableAtMs),
      cycle: String(job.cycle),
      enqueueOrdinal: String(job.enqueueOrdinal),
      fenceToken: String(job.fenceToken),
      firstReceiptSha256: job.firstReceiptSha256,
      headReceiptSha256: job.headReceiptSha256,
      jobId: job.jobId,
      lease: job.lease === null ? null : structuredClone(job.lease),
      redrives: String(job.redrives),
      resultSha256: job.resultSha256,
      revision: job.revision,
      revisionBindingSha256: job.revisionBindingSha256,
      revisionKey: job.revisionKey,
      state: job.state,
      tenantId: job.tenantId,
      terminalAtMs: job.terminalAtMs === null ? null : String(job.terminalAtMs)
    };
  }

  #snapshotRecords() {
    const records = [];
    for (const [key, job] of [...this.jobs].sort(([left], [right]) => compareUtf8(left, right))) {
      records.push({
        key: `job/${key}`,
        value: {
          jobId: job.jobId,
          state: job.state,
          terminalAtMs: job.terminalAtMs === null ? null : String(job.terminalAtMs)
        }
      });
    }
    for (const [digest, object] of [...this.objects].sort(([left], [right]) => compareUtf8(left, right))) {
      if (object.mediaType === "universal-admission-event-receipt" || object.mediaType === "universal-admission-snapshot") continue;
      records.push({
        key: `object/${digest}`,
        value: {
          createdAtMs: String(object.createdAtMs),
          digest,
          generation: String(object.generation),
          mediaType: object.mediaType,
          references: [...object.refs].sort(compareUtf8)
        }
      });
    }
    return records;
  }

  #gcCandidates() {
    const result = [];
    for (const [digest, object] of this.objects) {
      if (object.mediaType === "universal-admission-event-receipt" || object.mediaType === "universal-admission-snapshot") continue;
      if (object.refs.size === 0 && this.now - object.createdAtMs >= BigInt(this.policy.orphanRetentionMs)) {
        result.push({ digest, generation: object.generation, reason: "orphan" });
        continue;
      }
      if (object.refs.size > 0 && this.#allRefsExpiredTerminal(object)) {
        result.push({ digest, generation: object.generation, reason: "terminal-payload" });
      }
    }
    return result.sort((left, right) => compareUtf8(left.digest, right.digest));
  }

  #allRefsExpiredTerminal(object) {
    for (const reference of object.refs) {
      const job = this.#jobFromReference(reference);
      if (!job || job.terminalAtMs === null) return false;
      const retentionMs = job.state === "processing-completed"
        ? BigInt(this.policy.terminalPayloadRetentionMs)
        : job.state === "dead-lettered"
          ? BigInt(this.policy.deadLetterPayloadRetentionMs)
          : null;
      if (retentionMs === null || this.now - job.terminalAtMs < retentionMs) return false;
    }
    return true;
  }

  #currentlyGcEligible(digest, reason) {
    const object = this.objects.get(digest);
    if (!object) return false;
    if (reason === "orphan") return object.refs.size === 0 && this.now - object.createdAtMs >= BigInt(this.policy.orphanRetentionMs);
    if (reason !== "terminal-payload" || !this.#allRefsExpiredTerminal(object)) return false;
    for (const reference of [...object.refs]) object.refs.delete(reference);
    return object.refs.size === 0;
  }

  #jobFromReference(reference) {
    for (const jobId of this.jobs.keys()) if (reference.startsWith(`${jobId}:`)) return this.jobs.get(jobId);
    return null;
  }

}

function compareJobs(left, right) {
  if (left.availableAtMs !== right.availableAtMs) return left.availableAtMs < right.availableAtMs ? -1 : 1;
  if (left.enqueueOrdinal !== right.enqueueOrdinal) return left.enqueueOrdinal < right.enqueueOrdinal ? -1 : 1;
  return compareUtf8(left.jobId, right.jobId);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function applicationKey(tenantId, applicationId) {
  return `${tenantId}\u0000${applicationId}`;
}

function validateServiceAudience(value) {
  return validateUniversalAdmissionServiceAudience(value, "$store.serviceAudience");
}

function validateReservedProtocolObject(bytes, mediaType) {
  const detectedMediaType = reservedMediaTypeForBytes(bytes);
  if (detectedMediaType !== mediaType) {
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_CAS_MEDIA_TYPE_CONFLICT", "Reserved protocol bytes do not match their declared media type.");
  }
  if (mediaType === "universal-admission-envelope") {
    validateUniversalAdmissionBytes(bytes);
    return;
  }
  if (mediaType === "universal-admission-worker-result") {
    parseUniversalAdmissionWorkerResultBytes(bytes);
    return;
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", "Reserved protocol bytes must contain canonical JSON.", { cause });
  }
  if (!canonicalProtocolBytes(value).equals(bytes)) {
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", "Reserved protocol bytes must contain canonical JSON followed by one LF.");
  }
  if (mediaType === "universal-admission-event-receipt") {
    validateUniversalAdmissionEventReceipt(value);
    return;
  }
  if (mediaType === "universal-admission-snapshot") {
    validateUniversalAdmissionSnapshot(value);
    return;
  }
  protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_RESERVED_MEDIA_FORBIDDEN", "Unknown reserved protocol media type.");
}

function deriveIdempotencyKeyFromJob(job, audience) {
  return deriveUniversalAdmissionIdempotencyKey({
    admissionDigest: job.admissionDigest,
    audience,
    tenantId: job.tenantId
  });
}

function durableResponseBytes(value) {
  return canonicalProtocolBytes(durableJsonValue(value));
}

function storedProtocolFailure(error) {
  return {
    code: error.code,
    path: error.path,
    retryable: error.retryable,
    retryAfterMs: error.retryAfterMs
  };
}

function assertStoredProtocolFailure(value) {
  if (!isExactFixtureObject(value, ["code", "path", "retryAfterMs", "retryable"])
    || typeof value.code !== "string"
    || (value.path !== null && typeof value.path !== "string")
    || (value.retryAfterMs !== null && typeof value.retryAfterMs !== "string")
    || typeof value.retryable !== "boolean") {
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION", "Stored durable protocol failure has an invalid closed shape.");
  }
}

function emptyDurableCommandEffectKeys() {
  return { jobIds: [], receiptSha256s: [], resultSha256s: [], snapshotSha256s: [] };
}

function isExactFixtureObject(value, keys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && digestProtocolValue(Object.keys(value).sort(compareUtf8)) === digestProtocolValue([...keys].sort(compareUtf8));
}

function throwStoredProtocolFailure(failure) {
  throw new UniversalAdmissionProtocolError(failure.code, `Durable replay of ${failure.code}.`, {
    path: failure.path,
    retryable: failure.retryable,
    retryAfterMs: failure.retryAfterMs
  });
}

function durableJsonValue(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { $bytesBase64url: Buffer.from(value).toString("base64url") };
  }
  if (typeof value === "bigint") return { $bigint: String(value) };
  if (Array.isArray(value)) return value.map(durableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, durableJsonValue(nested)]));
  }
  return value;
}

function cloneFixtureValue(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof Map) return new Map([...value].map(([key, nested]) => [key, cloneFixtureValue(nested)]));
  if (value instanceof Set) return new Set([...value].map(cloneFixtureValue));
  if (Array.isArray(value)) return value.map(cloneFixtureValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneFixtureValue(nested)]));
  }
  return value;
}

function snapshotFixtureBytes(value, label) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !types.isUint8Array(value)) {
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", `${label} must be a non-proxy Uint8Array byte sequence.`);
  }
  const before = intrinsicFixtureByteRegion(value, label);
  if (before.byteLength < 1 || before.byteLength > MAX_UNIVERSAL_ADMISSION_CAS_OBJECT_BYTES) {
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", `${label} must contain 1..${MAX_UNIVERSAL_ADMISSION_CAS_OBJECT_BYTES} bytes.`);
  }
  let bytes;
  try {
    const safeView = new ROOT_UINT8_ARRAY(before.buffer, before.byteOffset, before.byteLength);
    bytes = Buffer.from(safeView);
  } catch (cause) {
    if (cause instanceof UniversalAdmissionProtocolError) throw cause;
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", `${label} could not be snapshotted.`, { cause });
  }
  const after = intrinsicFixtureByteRegion(value, label);
  if (after.buffer !== before.buffer
    || after.byteOffset !== before.byteOffset
    || after.byteLength !== before.byteLength
    || bytes.length !== before.byteLength) {
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", `${label} backing region changed while being snapshotted.`);
  }
  return bytes;
}

function intrinsicFixtureByteRegion(value, label) {
  try {
    const buffer = INTRINSIC_TYPED_ARRAY_BUFFER(value);
    const byteOffset = INTRINSIC_TYPED_ARRAY_BYTE_OFFSET(value);
    const byteLength = INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(value);
    if (!Number.isSafeInteger(byteOffset) || byteOffset < 0
      || !Number.isSafeInteger(byteLength) || byteLength < 0) {
      protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", `${label} has an invalid intrinsic byte region.`);
    }
    return { buffer, byteLength, byteOffset };
  } catch (cause) {
    if (cause instanceof UniversalAdmissionProtocolError) throw cause;
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", `${label} intrinsic byte region could not be inspected.`, { cause });
  }
}

function snapshotFixturePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", `${label} must be a plain object.`);
  }
  try {
    return structuredClone(value);
  } catch (cause) {
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID", `${label} could not be snapshotted.`, { cause });
  }
}

function normalizeFixtureDecimal(value, label) {
  let stable;
  try {
    stable = String(value);
  } catch (cause) {
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_DECIMAL_INVALID", `${label} could not be normalized.`, { cause });
  }
  parseDecimal(stable, label);
  return stable;
}

function normalizeFixtureDigest(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_DIGEST_INVALID", `${label} must be a lowercase sha256 digest.`);
  }
  return value;
}

function reservedMediaTypeForBytes(bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  return Object.hasOwn(RESERVED_MEDIA_TYPE_BY_KIND, value?.kind) ? RESERVED_MEDIA_TYPE_BY_KIND[value.kind] : null;
}

function parseDecimal(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) protocolFail("UNIVERSAL_ADMISSION_PROTOCOL_DECIMAL_INVALID", `${label} must be a decimal string.`);
  return BigInt(value);
}

function freeze(value) {
  return deepFreezeFixtureValue(structuredClone(value));
}

function deepFreezeFixtureValue(value) {
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  for (const nested of Object.values(value)) deepFreezeFixtureValue(nested);
  return Object.freeze(value);
}

function protocolFail(code, message, options) {
  throw new UniversalAdmissionProtocolError(code, message, options);
}
