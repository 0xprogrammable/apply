import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "../scripts/test/schema-validator/node_modules/ajv/dist/2020.js";
import {
  DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE,
  MAX_UNIVERSAL_ADMISSION_CAS_OBJECT_BYTES,
  UniversalAdmissionProtocolError,
  canonicalProtocolBytes,
  deriveJobId,
  deriveLeaseId,
  derivePrincipalBinding,
  deriveRevisionKey,
  deriveUniversalAdmissionIdempotencyKey,
  deriveUniversalAdmissionProtocolBindings,
  deriveUniversalAdmissionRequestKey,
  deriveUniversalAdmissionRevisionBinding,
  deterministicRetryDelayMs,
  digestProtocolValue,
  inertProtocolAuthority,
  parseUniversalAdmissionWorkerResultBytes,
  validateAuthenticatedPrincipalContext,
  validateUniversalAdmissionEventReceipt,
  validateUniversalAdmissionRequestBinding,
  validateUniversalAdmissionReceiptChain,
  validateUniversalAdmissionRuntimePolicy,
  validateUniversalAdmissionSnapshot,
  validateUniversalAdmissionWorkerResult
} from "../scripts/universal-admission-protocol-core.mjs";
import {
  DEFAULT_TEST_RUNTIME_POLICY,
  UniversalAdmissionMemoryStore
} from "./helpers/universal-admission-memory-store.mjs";
import {
  admissionBytes,
  commandId,
  hostileByteInput,
  principalContext,
  registerUniversalAdmissionStoreConformance,
  requestBinding,
  workerContext,
  workerResult
} from "./helpers/universal-admission-store-conformance.mjs";

const root = path.resolve(".");

registerUniversalAdmissionStoreConformance({
  createStore: (options) => new UniversalAdmissionMemoryStore(options),
  label: "reference memory store"
});

test("protocol schemas are strict, closed, and accept only inert canonical records", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validatePolicy = ajv.compile(readJson("intake/schemas/universal-admission-runtime-policy-v1.schema.json"));
  const validateReceipt = ajv.compile(readJson("intake/schemas/universal-admission-event-receipt-v1.schema.json"));
  const validateResult = ajv.compile(readJson("intake/schemas/universal-admission-worker-result-v1.schema.json"));
  const validateSnapshot = ajv.compile(readJson("intake/schemas/universal-admission-snapshot-v1.schema.json"));
  assert.equal(validatePolicy(DEFAULT_TEST_RUNTIME_POLICY), true, JSON.stringify(validatePolicy.errors));

  const maximumProtocolDecimal = "9".repeat(18);
  const firstDecimalOverflow = `1${"0".repeat(18)}`;
  const maximumPolicy = structuredClone(DEFAULT_TEST_RUNTIME_POLICY);
  for (const [key, value] of Object.entries(maximumPolicy)) {
    if (/^[0-9]+$/u.test(value)) maximumPolicy[key] = maximumProtocolDecimal;
  }
  Object.assign(maximumPolicy, {
    leaseDurationMs: "1",
    maxAttempts: "1",
    maxDurableCommands: "1",
    maxLeaseDurationMs: "1",
    maxLeaseRenewals: "0",
    maxRedrives: "0",
    maxTenantReplayRecords: "1",
    retryBaseMs: "1",
    retryMaxMs: "1"
  });
  assert.equal(validatePolicy(maximumPolicy), true, JSON.stringify(validatePolicy.errors));
  assert.doesNotThrow(() => validateUniversalAdmissionRuntimePolicy(maximumPolicy));
  const overflowPolicy = { ...maximumPolicy, fixedWindowMs: firstDecimalOverflow };
  assert.equal(validatePolicy(overflowPolicy), false);
  assert.throws(
    () => validateUniversalAdmissionRuntimePolicy(overflowPolicy),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_DECIMAL_INVALID")
  );

  const store = new UniversalAdmissionMemoryStore();
  const submission = await store.submit({
    bytes: admissionBytes(),
    principalContext: principalContext(),
    ...requestBinding("schema-request")
  });
  const receipt = store.readReceipt(submission.receiptSha256);
  assert.equal(validateReceipt(receipt), true, JSON.stringify(validateReceipt.errors));
  assert.equal(receipt.job.revisionBindingSha256, submission.revisionBindingSha256);
  const maximumIngressReceipt = structuredClone(receipt);
  maximumIngressReceipt.request.authenticatedRequestByteLength = "266304";
  assert.equal(validateReceipt(maximumIngressReceipt), true, JSON.stringify(validateReceipt.errors));
  assert.doesNotThrow(() => validateUniversalAdmissionEventReceipt(maximumIngressReceipt));
  const overflowIngressReceipt = structuredClone(receipt);
  overflowIngressReceipt.request.authenticatedRequestByteLength = "266305";
  assert.equal(validateReceipt(overflowIngressReceipt), false);
  assert.throws(
    () => validateUniversalAdmissionEventReceipt(overflowIngressReceipt),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_REQUEST_INVALID")
  );
  const requestPolicyTamper = structuredClone(receipt);
  requestPolicyTamper.request.expectedCapacityPolicySha256 = digestProtocolValue({ policy: "tampered" });
  assert.equal(validateReceipt(requestPolicyTamper), true, JSON.stringify(validateReceipt.errors));
  assert.throws(
    () => validateUniversalAdmissionEventReceipt(requestPolicyTamper),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_INVALID")
  );
  let eventTypeReads = 0;
  const getterReceipt = structuredClone(receipt);
  Object.defineProperty(getterReceipt, "eventType", {
    configurable: true,
    enumerable: true,
    get() {
      eventTypeReads += 1;
      return eventTypeReads === 1 ? "queued" : "dead-lettered";
    }
  });
  assert.equal(validateUniversalAdmissionEventReceipt(getterReceipt).eventType, "queued");
  assert.equal(eventTypeReads, 1);
  for (const counter of ["attempt", "cycle", "fenceToken"]) {
    const tamperedInitialCounter = structuredClone(receipt);
    tamperedInitialCounter.job[counter] = "1";
    assert.equal(validateReceipt(tamperedInitialCounter), false);
    assert.throws(
      () => validateUniversalAdmissionEventReceipt(tamperedInitialCounter),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_INVALID")
    );
  }
  const maximumReceipt = structuredClone(receipt);
  maximumReceipt.occurredAtMs = maximumProtocolDecimal;
  maximumReceipt.job.availableAtMs = maximumProtocolDecimal;
  maximumReceipt.job.revisionBindingSha256 = deriveUniversalAdmissionRevisionBinding({
    bindings: { ...maximumReceipt.job, audience: maximumReceipt.serviceAudience },
    createdAtMs: maximumReceipt.occurredAtMs,
    creatorPrincipalBindingSha256: maximumReceipt.principalBindingSha256
  }).revisionBindingSha256;
  assert.equal(validateReceipt(maximumReceipt), true, JSON.stringify(validateReceipt.errors));
  assert.doesNotThrow(() => validateUniversalAdmissionEventReceipt(maximumReceipt));
  const overflowReceipt = structuredClone(maximumReceipt);
  overflowReceipt.occurredAtMs = firstDecimalOverflow;
  assert.equal(validateReceipt(overflowReceipt), false);
  assert.throws(
    () => validateUniversalAdmissionEventReceipt(overflowReceipt),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_DECIMAL_INVALID")
  );

  const maximumApplicationRevision = "9".repeat(31);
  const firstApplicationRevisionOverflow = `1${"0".repeat(31)}`;
  const maximumRevisionReceipt = structuredClone(receipt);
  maximumRevisionReceipt.job.revision = maximumApplicationRevision;
  maximumRevisionReceipt.job.revisionKey = deriveRevisionKey({
    applicationId: maximumRevisionReceipt.job.applicationId,
    audience: maximumRevisionReceipt.serviceAudience,
    revision: maximumApplicationRevision,
    tenantId: maximumRevisionReceipt.job.tenantId
  });
  maximumRevisionReceipt.job.jobId = deriveJobId({
    admissionDigest: maximumRevisionReceipt.job.admissionDigest,
    revisionKey: maximumRevisionReceipt.job.revisionKey
  });
  maximumRevisionReceipt.job.revisionBindingSha256 = deriveUniversalAdmissionRevisionBinding({
    bindings: { ...maximumRevisionReceipt.job, audience: maximumRevisionReceipt.serviceAudience },
    createdAtMs: maximumRevisionReceipt.occurredAtMs,
    creatorPrincipalBindingSha256: maximumRevisionReceipt.principalBindingSha256
  }).revisionBindingSha256;
  assert.equal(validateReceipt(maximumRevisionReceipt), true, JSON.stringify(validateReceipt.errors));
  assert.doesNotThrow(() => validateUniversalAdmissionEventReceipt(maximumRevisionReceipt));
  assert.doesNotThrow(() => deriveRevisionKey({ applicationId: "max-revision", audience: DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE, revision: maximumApplicationRevision, tenantId: "tenant-a" }));
  const overflowRevisionReceipt = structuredClone(maximumRevisionReceipt);
  overflowRevisionReceipt.job.revision = firstApplicationRevisionOverflow;
  assert.equal(validateReceipt(overflowRevisionReceipt), false);
  assert.throws(
    () => validateUniversalAdmissionEventReceipt(overflowRevisionReceipt),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_APPLICATION_REVISION_INVALID")
  );
  assert.throws(
    () => deriveRevisionKey({ applicationId: "max-revision", audience: DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE, revision: firstApplicationRevisionOverflow, tenantId: "tenant-a" }),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_APPLICATION_REVISION_INVALID")
  );
  const arbitraryRevisionBinding = structuredClone(receipt);
  arbitraryRevisionBinding.job.revisionBindingSha256 = digestProtocolValue({ arbitrary: true });
  assert.equal(validateReceipt(arbitraryRevisionBinding), true, JSON.stringify(validateReceipt.errors));
  assert.throws(
    () => validateUniversalAdmissionEventReceipt(arbitraryRevisionBinding),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_REVISION_BINDING_MISMATCH")
  );
  const unsafeReceipt = structuredClone(receipt);
  unsafeReceipt.authority.approvalGranted = true;
  assert.equal(validateReceipt(unsafeReceipt), false);

  const worker = workerContext();
  const claim = await store.claim({ commandId: commandId("schema-claim"), workerContext: worker });
  const claimReceipt = store.readReceipt(claim.receiptSha256);
  assert.equal(validateReceipt(claimReceipt), true, JSON.stringify(validateReceipt.errors));
  const zeroClaimFence = structuredClone(claimReceipt);
  zeroClaimFence.job.fenceToken = "0";
  assert.equal(validateReceipt(zeroClaimFence), false);
  assert.throws(
    () => validateUniversalAdmissionEventReceipt(zeroClaimFence),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_LEASE_INVALID")
  );
  const mismatchedLeaseFence = structuredClone(claimReceipt);
  mismatchedLeaseFence.lease.fenceToken = "2";
  assert.equal(validateReceipt(mismatchedLeaseFence), true, JSON.stringify(validateReceipt.errors));
  assert.throws(
    () => validateUniversalAdmissionEventReceipt(mismatchedLeaseFence),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_LEASE_INVALID")
  );
  const maximumClaimOrdinalReceipt = structuredClone(claimReceipt);
  maximumClaimOrdinalReceipt.lease.claimOrdinal = maximumProtocolDecimal;
  maximumClaimOrdinalReceipt.lease.leaseId = deriveLeaseId({
    claimedAtMs: maximumClaimOrdinalReceipt.lease.claimedAtMs,
    claimOrdinal: maximumClaimOrdinalReceipt.lease.claimOrdinal,
    cycle: maximumClaimOrdinalReceipt.job.cycle,
    fenceToken: maximumClaimOrdinalReceipt.job.fenceToken,
    jobId: maximumClaimOrdinalReceipt.job.jobId,
    workerBindingSha256: maximumClaimOrdinalReceipt.workerBindingSha256
  });
  assert.equal(validateReceipt(maximumClaimOrdinalReceipt), true, JSON.stringify(validateReceipt.errors));
  assert.doesNotThrow(() => validateUniversalAdmissionEventReceipt(maximumClaimOrdinalReceipt));
  const overflowClaimOrdinalReceipt = structuredClone(maximumClaimOrdinalReceipt);
  overflowClaimOrdinalReceipt.lease.claimOrdinal = firstDecimalOverflow;
  assert.equal(validateReceipt(overflowClaimOrdinalReceipt), false);
  assert.throws(
    () => validateUniversalAdmissionEventReceipt(overflowClaimOrdinalReceipt),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_DECIMAL_INVALID")
  );
  const report = await store.putObjectIfAbsent({ bytes: Buffer.from("report\n") });
  const artifact = await store.putObjectIfAbsent({ bytes: Buffer.from("artifact\n") });
  const result = workerResult({ artifact, claim, report, worker });
  assert.equal(validateResult(result), true, JSON.stringify(validateResult.errors));
  for (const effect of ["candidateCodeExecuted", "sandboxed"]) {
    const executionClaim = structuredClone(result);
    executionClaim.effects[effect] = true;
    assert.equal(validateResult(executionClaim), false);
    assert.throws(
      () => validateUniversalAdmissionWorkerResult(executionClaim),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ASSERTION_INVALID")
    );
  }
  const maximumResult = structuredClone(result);
  maximumResult.binding.cycle = maximumProtocolDecimal;
  assert.equal(validateResult(maximumResult), true, JSON.stringify(validateResult.errors));
  assert.doesNotThrow(() => validateUniversalAdmissionWorkerResult(maximumResult));
  const overflowResult = structuredClone(maximumResult);
  overflowResult.binding.cycle = firstDecimalOverflow;
  assert.equal(validateResult(overflowResult), false);
  assert.throws(
    () => validateUniversalAdmissionWorkerResult(overflowResult),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_DECIMAL_INVALID")
  );
  const authorityClaim = structuredClone(result);
  authorityClaim.authority.launchAuthorized = true;
  assert.equal(validateResult(authorityClaim), false);

  const completed = await store.complete({ commandId: commandId("schema-complete"), jobId: submission.jobId, resultBytes: canonicalProtocolBytes(result), workerContext: worker });
  assert.equal(validateReceipt(store.readReceipt(completed.receiptSha256)), true, JSON.stringify(validateReceipt.errors));

  const snapshot = await store.snapshot({ commandId: commandId("schema-snapshot") });
  assert.equal(snapshot.manifest.recordScope, "gc-control-v1");
  assert.equal(validateSnapshot(snapshot.manifest), true, JSON.stringify(validateSnapshot.errors));
  const maximumSnapshot = structuredClone(snapshot.manifest);
  maximumSnapshot.createdAtMs = maximumProtocolDecimal;
  assert.equal(validateSnapshot(maximumSnapshot), true, JSON.stringify(validateSnapshot.errors));
  assert.doesNotThrow(() => validateUniversalAdmissionSnapshot(maximumSnapshot));
  const overflowSnapshot = structuredClone(maximumSnapshot);
  overflowSnapshot.createdAtMs = firstDecimalOverflow;
  assert.equal(validateSnapshot(overflowSnapshot), false);
  assert.throws(
    () => validateUniversalAdmissionSnapshot(overflowSnapshot),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_DECIMAL_INVALID")
  );
});

test("principal and request contexts are out-of-band, secret-free, exact, and tenant scoped", () => {
  const principal = principalContext("tenant-a", "public-subject-1");
  const checked = validateAuthenticatedPrincipalContext(principal);
  const binding = derivePrincipalBinding(checked);
  assert.deepEqual(Object.keys(binding).sort(), ["audience", "authorityId", "principalBindingSha256", "tenantId"]);
  assert.equal(JSON.stringify(binding).includes("public-subject-1"), false);
  assert.throws(
    () => validateAuthenticatedPrincipalContext({ ...principal, authenticated: false }),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_PRINCIPAL_UNAUTHENTICATED")
  );
  assert.throws(
    () => validateAuthenticatedPrincipalContext({ ...principal, token: "secret" }),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_FIELD_SET_INVALID")
  );

  const request = requestBinding("signed-request-1");
  assert.deepEqual(validateUniversalAdmissionRequestBinding(request), request);
  assert.throws(
    () => validateUniversalAdmissionRequestBinding({ ...request, signature: "not-stored" }),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_FIELD_SET_INVALID")
  );
  assert.notEqual(
    deriveUniversalAdmissionRequestKey({ audience: principal.audience, requestId: request.requestId, tenantId: "tenant-a" }),
    deriveUniversalAdmissionRequestKey({ audience: principal.audience, requestId: request.requestId, tenantId: "tenant-b" })
  );
  assert.notEqual(
    deriveUniversalAdmissionRequestKey({ audience: principal.audience, requestId: request.requestId, tenantId: "tenant-a" }),
    deriveUniversalAdmissionRequestKey({ audience: "urn:programmable:submit-launch:universal-admission:staging:v1", requestId: request.requestId, tenantId: "tenant-a" })
  );
  const admissionDigest = digestProtocolValue({ admission: "same" });
  assert.notEqual(
    deriveUniversalAdmissionIdempotencyKey({ admissionDigest, audience: principal.audience, tenantId: "tenant-a" }),
    deriveUniversalAdmissionIdempotencyKey({ admissionDigest, audience: principal.audience, tenantId: "tenant-b" })
  );
});

test("revision keys are tenant scoped and runtime relationships fail closed", () => {
  const left = deriveRevisionKey({ applicationId: "same-app", audience: DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE, revision: "1", tenantId: "tenant-a" });
  const right = deriveRevisionKey({ applicationId: "same-app", audience: DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE, revision: "1", tenantId: "tenant-b" });
  assert.notEqual(left, right);
  assert.equal(deriveRevisionKey({ applicationId: "same-app", audience: DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE, revision: "1", tenantId: "tenant-a" }), left);

  assert.throws(
    () => validateUniversalAdmissionRuntimePolicy({ ...DEFAULT_TEST_RUNTIME_POLICY, maxApplicationOutstanding: "17" }),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID")
  );
  assert.throws(
    () => validateUniversalAdmissionRuntimePolicy({ ...DEFAULT_TEST_RUNTIME_POLICY, maxLeaseDurationMs: "9999" }),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID")
  );
  const signedHorizonBoundary = {
    ...DEFAULT_TEST_RUNTIME_POLICY,
    commandReplayRetentionMs: "330000",
    leaseDurationMs: "1000",
    maxAttempts: "1",
    maxLeaseDurationMs: "1000",
    maxLeaseRenewals: "0",
    maxRedrives: "0",
    retryBaseMs: "1",
    retryMaxMs: "1"
  };
  assert.doesNotThrow(() => validateUniversalAdmissionRuntimePolicy(signedHorizonBoundary));
  assert.throws(
    () => validateUniversalAdmissionRuntimePolicy({ ...signedHorizonBoundary, commandReplayRetentionMs: "329999" }),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID")
  );
  assert.throws(
    () => validateUniversalAdmissionRuntimePolicy({ ...signedHorizonBoundary, fixedWindowMs: "330001" }),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RUNTIME_POLICY_INVALID")
  );
});

test("retry jitter is deterministic, bounded, and domain separated by job/cycle/attempt", () => {
  const jobId = digestProtocolValue({ job: "one" });
  const first = deterministicRetryDelayMs({ attempt: "1", cycle: "0", jobId, policy: DEFAULT_TEST_RUNTIME_POLICY });
  const repeated = deterministicRetryDelayMs({ attempt: "1", cycle: "0", jobId, policy: DEFAULT_TEST_RUNTIME_POLICY });
  const later = deterministicRetryDelayMs({ attempt: "2", cycle: "0", jobId, policy: DEFAULT_TEST_RUNTIME_POLICY });
  assert.equal(first, repeated);
  assert.equal(BigInt(first) >= BigInt(DEFAULT_TEST_RUNTIME_POLICY.retryBaseMs) / 2n, true);
  assert.equal(BigInt(first) <= BigInt(DEFAULT_TEST_RUNTIME_POLICY.retryBaseMs), true);
  assert.notEqual(first, later);
});

test("worker completion rejects result or worker substitution before terminal mutation", async () => {
  const store = new UniversalAdmissionMemoryStore();
  const submission = await store.submit({
    bytes: admissionBytes({ applicationId: "binding-job" }),
    principalContext: principalContext(),
    ...requestBinding("binding-request")
  });
  const worker = workerContext("worker-one", "1");
  const claim = await store.claim({ commandId: commandId("binding-claim"), workerContext: worker });
  const report = await store.putObjectIfAbsent({ bytes: Buffer.from("report\n") });
  const artifact = await store.putObjectIfAbsent({ bytes: Buffer.from("artifact\n") });
  const result = workerResult({ artifact, claim, report, worker });
  result.binding.revisionKey = digestProtocolValue({ substituted: true });
  await assert.rejects(
    store.complete({ commandId: commandId("binding-complete"), jobId: submission.jobId, resultBytes: canonicalProtocolBytes(result), workerContext: worker }),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RESULT_BINDING_MISMATCH")
  );
  assert.equal(store.readJob(submission.jobId).state, "leased");
  assert.equal(store.assertConsistent(), true);
});

test("memory durable replay rejects fully swapped same-worker renewal responses", async () => {
  const store = new UniversalAdmissionMemoryStore();
  const worker = workerContext("renewal-swap-worker", "1");
  for (const applicationId of ["renewal-swap-a", "renewal-swap-b"]) {
    await store.submit({
      bytes: admissionBytes({ applicationId }),
      principalContext: principalContext(),
      ...requestBinding(applicationId)
    });
  }
  const firstClaim = await store.claim({ commandId: commandId("renewal-swap-claim-a"), workerContext: worker });
  const secondClaim = await store.claim({ commandId: commandId("renewal-swap-claim-b"), workerContext: worker });
  const firstCommandId = commandId("renewal-swap-command-a");
  const secondCommandId = commandId("renewal-swap-command-b");
  await store.renew({
    commandId: firstCommandId,
    fenceToken: firstClaim.lease.fenceToken,
    jobId: firstClaim.jobId,
    leaseId: firstClaim.lease.leaseId,
    workerContext: worker
  });
  await store.renew({
    commandId: secondCommandId,
    fenceToken: secondClaim.lease.fenceToken,
    jobId: secondClaim.jobId,
    leaseId: secondClaim.lease.leaseId,
    workerContext: worker
  });
  const firstRecord = [...store.durableCommands.values()].find(({ commandId: value }) => value === firstCommandId);
  const secondRecord = [...store.durableCommands.values()].find(({ commandId: value }) => value === secondCommandId);
  for (const key of ["effectKeys", "responseByteLength", "result", "resultSha256"]) {
    const first = structuredClone(firstRecord[key]);
    firstRecord[key] = structuredClone(secondRecord[key]);
    secondRecord[key] = first;
  }
  assert.throws(() => store.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));
  await assert.rejects(
    store.renew({
      commandId: firstCommandId,
      fenceToken: firstClaim.lease.fenceToken,
      jobId: firstClaim.jobId,
      leaseId: firstClaim.lease.leaseId,
      workerContext: worker
    }),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION")
  );
});

test("durable command failures use a command-specific closed vocabulary", async () => {
  const store = new UniversalAdmissionMemoryStore();
  const worker = workerContext("failure-vocabulary-worker", "1");
  const missingJobId = digestProtocolValue({ job: "failure-vocabulary-missing" });
  const missingLeaseId = digestProtocolValue({ lease: "failure-vocabulary-missing" });
  const durableCommandId = commandId("failure-vocabulary-renew");
  const request = {
    commandId: durableCommandId,
    fenceToken: "1",
    jobId: missingJobId,
    leaseId: missingLeaseId,
    workerContext: worker
  };
  await assert.rejects(store.renew(request), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_JOB_NOT_FOUND"));
  await assert.rejects(store.renew(request), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_JOB_NOT_FOUND"));

  const record = [...store.durableCommands.values()].find(({ commandId: value }) => value === durableCommandId);
  const originalResponseByteLength = record.responseByteLength;
  record.failure = { ...record.failure, code: "UNIVERSAL_ADMISSION_PROTOCOL_SNAPSHOT_INVALID" };
  record.resultSha256 = digestProtocolValue(record.failure);
  record.responseByteLength = BigInt(canonicalProtocolBytes(record.failure).length);
  store.global.durableCommandBytes += record.responseByteLength - originalResponseByteLength;
  assert.throws(() => store.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));
  await assert.rejects(store.renew(request), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));
});

test("protocol byte parsers use only intrinsic Uint8Array state", async () => {
  const principal = principalContext();
  const admissionSource = admissionBytes({ applicationId: "intrinsic-protocol-bytes" });
  const hostileAdmission = hostileByteInput(admissionSource);
  const bindings = deriveUniversalAdmissionProtocolBindings({
    bytes: hostileAdmission.bytes,
    principalContext: principal
  });
  assert.equal(bindings.admissionDigest, digestProtocolValue(JSON.parse(admissionSource.toString("utf8"))));
  assert.equal(hostileAdmission.readCount(), 0);

  const store = new UniversalAdmissionMemoryStore();
  await store.submit({
    bytes: admissionSource,
    principalContext: principal,
    ...requestBinding("intrinsic-protocol-bytes")
  });
  const worker = workerContext("intrinsic-parser-worker", "1");
  const claim = await store.claim({ commandId: commandId("intrinsic-parser-claim"), workerContext: worker });
  const report = await store.putObjectIfAbsent({ bytes: Buffer.from("intrinsic parser report\n") });
  const artifact = await store.putObjectIfAbsent({ bytes: Buffer.from("intrinsic parser artifact\n") });
  const resultSource = canonicalProtocolBytes(workerResult({ artifact, claim, report, worker }));
  const hostileResult = hostileByteInput(resultSource);
  const result = parseUniversalAdmissionWorkerResultBytes(hostileResult.bytes);
  assert.equal(result.binding.jobId, claim.jobId);
  assert.equal(hostileResult.readCount(), 0);

  const oversized = hostileByteInput(new Uint8Array(MAX_UNIVERSAL_ADMISSION_CAS_OBJECT_BYTES + 1));
  assert.throws(
    () => parseUniversalAdmissionWorkerResultBytes(oversized.bytes),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_WORKER_RESULT_INVALID")
  );
  assert.equal(oversized.readCount(), 0);

  let proxyReads = 0;
  const proxy = new Proxy(new Uint8Array(admissionSource), {
    get(target, property, receiver) {
      proxyReads += 1;
      return Reflect.get(target, property, receiver);
    }
  });
  assert.throws(
    () => deriveUniversalAdmissionProtocolBindings({ bytes: proxy, principalContext: principal }),
    hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ENVELOPE_INVALID")
  );
  assert.equal(proxyReads, 0);
});

test("memory audit rejects missing CAS generations and exact terminal payload references", async () => {
  const store = new UniversalAdmissionMemoryStore();
  const submission = await store.submit({
    bytes: admissionBytes({ applicationId: "cas-audit-job" }),
    principalContext: principalContext(),
    ...requestBinding("cas-audit-submit")
  });
  const worker = workerContext();
  const claim = await store.claim({ commandId: commandId("cas-audit-claim"), workerContext: worker });
  const report = await store.putObjectIfAbsent({ bytes: Buffer.from("audit report\n") });
  const artifact = await store.putObjectIfAbsent({ bytes: Buffer.from("audit artifact\n") });
  const result = workerResult({ artifact, claim, report, worker });
  await store.complete({
    commandId: commandId("cas-audit-complete"),
    jobId: submission.jobId,
    resultBytes: canonicalProtocolBytes(result),
    workerContext: worker
  });
  assert.equal(store.assertConsistent(), true);

  const admissionObject = store.objects.get(submission.admissionDigest);
  const admissionReference = `${submission.jobId}:admission`;
  admissionObject.refs.delete(admissionReference);
  assert.throws(() => store.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));
  admissionObject.refs.add(admissionReference);
  admissionObject.generation += 1n;
  assert.throws(() => store.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));
  admissionObject.generation -= 1n;

  const artifactObject = store.objects.get(artifact.digest);
  const artifactReference = `${submission.jobId}:artifact:evidence`;
  artifactObject.refs.delete(artifactReference);
  assert.throws(() => store.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));
  artifactObject.refs.add(artifactReference);
  artifactObject.refs.add(admissionReference);
  assert.throws(() => store.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));
  artifactObject.refs.delete(admissionReference);
  const revision = store.revisions.get(submission.revisionKey);
  const originalApplicationId = revision.applicationId;
  revision.applicationId = "tampered-revision";
  assert.throws(() => store.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));
  revision.applicationId = originalApplicationId;
  assert.equal(store.assertConsistent(), true);
  const tenantState = store.tenants.get("tenant-a");
  const originalLastClaimOrdinal = tenantState.lastClaimOrdinal;
  tenantState.lastClaimOrdinal += 1n;
  assert.throws(() => store.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));
  tenantState.lastClaimOrdinal = originalLastClaimOrdinal;
  assert.equal(store.assertConsistent(), true);
  const originalNextEnqueueOrdinal = tenantState.nextEnqueueOrdinal;
  tenantState.nextEnqueueOrdinal += 1n;
  assert.throws(() => store.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));
  tenantState.nextEnqueueOrdinal = originalNextEnqueueOrdinal;
  assert.equal(store.assertConsistent(), true);
  const authenticatedRequestRecord = [...store.requests.values()][0];
  const originalRequestResult = structuredClone(authenticatedRequestRecord.result);
  const originalRequestResultSha256 = authenticatedRequestRecord.resultSha256;
  const originalRequestResponseByteLength = authenticatedRequestRecord.responseByteLength;
  authenticatedRequestRecord.result.status = "DUPLICATE";
  authenticatedRequestRecord.resultSha256 = digestProtocolValue(authenticatedRequestRecord.result);
  authenticatedRequestRecord.responseByteLength = BigInt(canonicalProtocolBytes(authenticatedRequestRecord.result).length);
  const forgedRequestByteDelta = authenticatedRequestRecord.responseByteLength - originalRequestResponseByteLength;
  store.global.durableCommandBytes += forgedRequestByteDelta;
  tenantState.replayBytes += forgedRequestByteDelta;
  assert.throws(() => store.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));
  authenticatedRequestRecord.result = originalRequestResult;
  authenticatedRequestRecord.resultSha256 = originalRequestResultSha256;
  authenticatedRequestRecord.responseByteLength = originalRequestResponseByteLength;
  store.global.durableCommandBytes -= forgedRequestByteDelta;
  tenantState.replayBytes -= forgedRequestByteDelta;
  assert.equal(store.assertConsistent(), true);

  const swapStore = new UniversalAdmissionMemoryStore();
  const firstSwapSubmission = await swapStore.submit({
    bytes: admissionBytes({ applicationId: "first-receipt-swap-a" }),
    principalContext: principalContext(),
    ...requestBinding("first-receipt-swap-a")
  });
  const secondSwapSubmission = await swapStore.submit({
    bytes: admissionBytes({ applicationId: "first-receipt-swap-b" }),
    principalContext: principalContext(),
    ...requestBinding("first-receipt-swap-b")
  });
  const firstSwapJob = swapStore.jobs.get(firstSwapSubmission.jobId);
  const firstSwapRevision = swapStore.revisions.get(firstSwapSubmission.revisionKey);
  firstSwapJob.firstReceiptSha256 = secondSwapSubmission.receiptSha256;
  firstSwapRevision.firstReceiptSha256 = secondSwapSubmission.receiptSha256;
  assert.throws(() => swapStore.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));

  const enqueueSwapStore = new UniversalAdmissionMemoryStore();
  const enqueueSwapA = await enqueueSwapStore.submit({
    bytes: admissionBytes({ applicationId: "enqueue-swap-a" }),
    principalContext: principalContext(),
    ...requestBinding("enqueue-swap-a")
  });
  const enqueueSwapB = await enqueueSwapStore.submit({
    bytes: admissionBytes({ applicationId: "enqueue-swap-b" }),
    principalContext: principalContext(),
    ...requestBinding("enqueue-swap-b")
  });
  await rewriteQueuedEnqueueOrdinal(enqueueSwapStore, enqueueSwapA, "2");
  await rewriteQueuedEnqueueOrdinal(enqueueSwapStore, enqueueSwapB, "1");
  assert.throws(() => enqueueSwapStore.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));

  const dlqStore = new UniversalAdmissionMemoryStore();
  const dlqSubmission = await dlqStore.submit({
    bytes: admissionBytes({ applicationId: "dlq-cas-audit" }),
    principalContext: principalContext(),
    ...requestBinding("dlq-cas-audit")
  });
  const dlqClaim = await dlqStore.claim({ commandId: commandId("dlq-cas-claim"), workerContext: worker });
  await dlqStore.fail({
    commandId: commandId("dlq-cas-fail"),
    failure: { code: "PERMANENT_AUDIT_FAILURE", detailsSha256: digestProtocolValue({ dlq: true }), retryable: false },
    fenceToken: dlqClaim.lease.fenceToken,
    jobId: dlqClaim.jobId,
    leaseId: dlqClaim.lease.leaseId,
    workerContext: worker
  });
  const dlqObject = dlqStore.objects.get(dlqSubmission.admissionDigest);
  const dlqReference = `${dlqSubmission.jobId}:admission`;
  dlqObject.refs.delete(dlqReference);
  assert.throws(() => dlqStore.assertConsistent(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ATOMICITY_VIOLATION"));
  dlqObject.refs.add(dlqReference);
  assert.equal(dlqStore.assertConsistent(), true);
});

test("memory submit snapshots caller bytes once before deriving and storing admission identity", async () => {
  const store = new UniversalAdmissionMemoryStore();
  const original = admissionBytes({ applicationId: "stable-input" });
  const mutable = Buffer.from(original);
  const submissionPromise = store.submit({
    bytes: mutable,
    principalContext: principalContext(),
    ...requestBinding("stable-input")
  });
  mutable.fill(0);
  const submission = await submissionPromise;
  assert.deepEqual(store.readObject(submission.admissionDigest), original);
  assert.equal(store.assertConsistent(), true);
});

test("the reference store is explicitly a test-only non-production fixture", () => {
  const source = fs.readFileSync(path.join(root, "test/helpers/universal-admission-memory-store.mjs"), "utf8");
  assert.match(source, /single-process conformance fixture/u);
  assert.match(source, /no persistence,/u);
  assert.equal(source.includes("production throughput evidence"), true);
  assert.deepEqual(inertProtocolAuthority(), {
    admissionDecisionGranted: false,
    approvalGranted: false,
    auditCompleted: false,
    deploymentPerformed: false,
    fundMovementAuthorized: false,
    fundMovementPerformed: false,
    independentAudit: false,
    launchAuthorized: false,
    repositoryOwnershipProven: false,
    reviewCompleted: false,
    safetyCertified: false,
    safetyGuaranteed: false
  });
});

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

async function rewriteQueuedEnqueueOrdinal(store, submission, enqueueOrdinal) {
  const job = store.jobs.get(submission.jobId);
  const oldReceiptSha256 = job.firstReceiptSha256;
  const receipt = structuredClone(store.receipts.get(oldReceiptSha256));
  receipt.job.enqueueOrdinal = enqueueOrdinal;
  const bytes = canonicalProtocolBytes(receipt);
  const stored = await store.testOnlyPutReservedObjectIfAbsent({
    bytes,
    mediaType: "universal-admission-event-receipt"
  });
  store.objects.get(stored.digest).refs.add(`${job.jobId}:receipt:1`);
  store.objects.delete(oldReceiptSha256);
  store.receipts.delete(oldReceiptSha256);
  store.receipts.set(stored.digest, receipt);
  job.enqueueOrdinal = BigInt(enqueueOrdinal);
  job.firstReceiptSha256 = stored.digest;
  job.headReceiptSha256 = stored.digest;
  job.receiptDigests = [stored.digest];
  store.revisions.get(submission.revisionKey).firstReceiptSha256 = stored.digest;
}

function hasCode(code) {
  return (error) => error instanceof UniversalAdmissionProtocolError && error.code === code;
}
