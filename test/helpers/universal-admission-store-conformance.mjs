import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalJson,
  sha256Bytes
} from "../../vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs";
import {
  DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE,
  MAX_UNIVERSAL_ADMISSION_CAS_OBJECT_BYTES,
  canonicalProtocolBytes,
  deriveWorkerBinding,
  digestProtocolValue,
  digestUniversalAdmissionRuntimePolicy,
  inertProtocolAuthority,
  validateUniversalAdmissionEventReceipt,
  validateUniversalAdmissionReceiptChain
} from "../../scripts/universal-admission-protocol-core.mjs";
import { DEFAULT_TEST_RUNTIME_POLICY } from "./universal-admission-memory-store.mjs";

export function registerUniversalAdmissionStoreConformance({ createStore, label = "store" }) {
  test(`${label}: concurrent idempotency, anti-equivocation, and quota counters are atomic`, async () => {
    const store = createStore();
    const bytes = admissionBytes();
    const context = principalContext("tenant-a", "alice");
    const replayRequest = requestBinding("replay");
    const results = await Promise.all(Array.from({ length: 32 }, () => store.submit({ bytes, principalContext: context, ...replayRequest })));
    assert.equal(results.filter(({ status }) => status === "QUEUED").length, 32);
    assert.equal(new Set(results.map(({ receiptSha256 }) => receiptSha256)).size, 1);
    assert.equal(new Set(results.map(({ revisionBindingSha256 }) => revisionBindingSha256)).size, 1);
    assert.equal(new Set(results.map((result) => digestProtocolValue(result))).size, 1);
    assert.deepEqual(results[0].authority, inertProtocolAuthority());
    assert.equal(sha256Bytes(canonicalProtocolBytes(results[0].eventReceipt)), results[0].receiptSha256);
    assert.deepEqual(validateUniversalAdmissionEventReceipt(results[0].eventReceipt), results[0].eventReceipt);
    const tamperedReceipt = structuredClone(results[0].eventReceipt);
    tamperedReceipt.job.revisionBindingSha256 = digestProtocolValue({ tampered: true });
    assert.notEqual(sha256Bytes(canonicalProtocolBytes(tamperedReceipt)), results[0].receiptSha256);
    assert.throws(
      () => validateUniversalAdmissionEventReceipt(tamperedReceipt),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_REVISION_BINDING_MISMATCH")
    );
    assert.deepEqual(store.inspectCounters().global, { leased: "0", outstanding: "1" });

    const duplicates = await Promise.all(Array.from(
      { length: 16 },
      (_, index) => store.submit({ bytes, principalContext: context, ...requestBinding(`duplicate-${index}`) })
    ));
    assert.deepEqual(duplicates.map(({ status }) => status), Array(16).fill("DUPLICATE"));
    assert.equal(new Set(duplicates.map(({ receiptSha256 }) => receiptSha256)).size, 1);

    await assert.rejects(
      store.submit({ ...replayRequest, bytes, principalContext: context, requestDigest: digestProtocolValue({ changed: true }) }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_REQUEST_REPLAY_CONFLICT")
    );
    await assert.rejects(
      store.submit({ bytes, principalContext: principalContext("tenant-a", "mallory"), ...replayRequest }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_REQUEST_PRINCIPAL_MISMATCH")
    );

    const equivocationRequest = requestBinding("equivocation");
    await assert.rejects(
      store.submit({ bytes: admissionBytes({ projectLabel: "Conflicting bytes" }), principalContext: context, ...equivocationRequest }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_REVISION_EQUIVOCATION")
    );
    const afterEquivocation = store.inspectCounters();
    await assert.rejects(
      store.submit({ bytes: admissionBytes({ projectLabel: "Conflicting bytes" }), principalContext: context, ...equivocationRequest }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_REVISION_EQUIVOCATION")
    );
    assert.deepEqual(store.inspectCounters(), afterEquivocation);
    assert.deepEqual(store.inspectCounters().global, { leased: "0", outstanding: "1" });
    assert.equal(store.assertConsistent(), true);
  });

  test(`${label}: authenticated duplicate ingress is byte-accounted, replay-neutral, bounded, and expires deterministically`, async () => {
    const policy = runtimePolicy({
      maxTenantAuthenticatedRequestBytesPerWindow: "531999",
      maxTenantAuthenticatedRequestsPerWindow: "3"
    });
    const store = createStore({ policy });
    const bytes = admissionBytes({ applicationId: "large-duplicate" });
    const principal = principalContext();
    const firstRequest = requestBinding("large-duplicate-1", policy, "266000");
    const first = await store.submit({ bytes, principalContext: principal, ...firstRequest });
    assert.equal(first.status, "QUEUED");
    const replays = await Promise.all(Array.from({ length: 16 }, () => store.submit({ bytes, principalContext: principal, ...firstRequest })));
    assert.equal(new Set(replays.map((value) => digestProtocolValue(value))).size, 1);
    assert.equal(store.inspectCounters().tenants["tenant-a"].authenticatedRequests, "1");
    assert.equal(store.inspectCounters().tenants["tenant-a"].authenticatedRequestBytes, "266000");

    const second = await store.submit({
      bytes,
      principalContext: principal,
      ...requestBinding("large-duplicate-2", policy, "265999")
    });
    assert.equal(second.status, "DUPLICATE");
    await assert.rejects(
      store.submit({ bytes, principalContext: principal, ...requestBinding("large-duplicate-3", policy, "1") }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_AUTHENTICATED_REQUEST_RATE_LIMITED")
    );
    assert.equal(store.inspectCounters().global.outstanding, "1");
    assert.equal(store.inspectCounters().tenants["tenant-a"].windowJobs, "1");
    assert.equal(store.inspectCounters().tenants["tenant-a"].authenticatedRequests, "2");

    store.advanceTime(policy.commandReplayRetentionMs);
    const afterExpiry = await store.submit({
      bytes,
      principalContext: principal,
      ...requestBinding("large-duplicate-after-expiry", policy, "266000")
    });
    assert.equal(afterExpiry.status, "DUPLICATE");
    assert.equal(store.inspectCounters().tenants["tenant-a"].replayRecords, "1");
    assert.equal(store.inspectCounters().tenants["tenant-a"].authenticatedRequests, "1");
    assert.equal(store.assertConsistent(), true);
  });

  test(`${label}: policy and audience preconditions reject before replay rows, quotas, or CAS mutation`, async () => {
    const store = createStore();
    const bytes = admissionBytes({ applicationId: "precondition-job" });
    const baseline = store.inspectCounters();
    const request = requestBinding("bad-policy");
    await assert.rejects(
      store.submit({ ...request, bytes, expectedCapacityPolicySha256: digestProtocolValue({ policy: "other" }), principalContext: principalContext() }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_CAPACITY_POLICY_MISMATCH")
    );
    assert.deepEqual(store.inspectCounters(), baseline);
    assert.equal(store.readObject(sha256Bytes(bytes)), null);

    const foreignAudience = "urn:programmable:submit-launch:universal-admission:foreign:v1";
    await assert.rejects(
      store.submit({ bytes, principalContext: principalContext("tenant-a", "alice", foreignAudience), ...requestBinding("foreign-audience") }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_AUDIENCE_MISMATCH")
    );
    assert.deepEqual(store.inspectCounters(), baseline);
    await assert.rejects(
      store.claim({ commandId: commandId("foreign-worker"), workerContext: workerContext("worker-one", "1", foreignAudience) }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_AUDIENCE_MISMATCH")
    );
    assert.deepEqual(store.inspectCounters(), baseline);
    assert.equal(store.assertConsistent(), true);
  });

  test(`${label}: fixed-window and outstanding quotas reject atomically without charging duplicates`, async () => {
    const policy = runtimePolicy({
      maxApplicationOutstanding: "2",
      maxGlobalLeased: "3",
      maxGlobalOutstanding: "3",
      maxTenantNewJobsPerWindow: "2",
      maxTenantOutstanding: "2"
    });
    const store = createStore({ policy });
    const context = principalContext("tenant-a", "alice");
    const first = await store.submit({ bytes: admissionBytes({ applicationId: "quota-one" }), principalContext: context, ...requestBinding("quota-one", policy) });
    const second = await store.submit({ bytes: admissionBytes({ applicationId: "quota-two" }), principalContext: context, ...requestBinding("quota-two", policy) });
    assert.equal(first.status, "QUEUED");
    assert.equal(second.status, "QUEUED");
    const duplicate = await store.submit({ bytes: admissionBytes({ applicationId: "quota-one" }), principalContext: context, ...requestBinding("quota-one-duplicate", policy) });
    assert.equal(duplicate.status, "DUPLICATE");
    await assert.rejects(
      store.submit({ bytes: admissionBytes({ applicationId: "quota-three" }), principalContext: context, ...requestBinding("quota-three", policy) }),
      (error) => error.code === "UNIVERSAL_ADMISSION_PROTOCOL_TENANT_RATE_LIMITED" && error.retryable === true && error.retryAfterMs !== null
    );
    assert.equal(store.inspectCounters().tenants["tenant-a"].windowJobs, "2");
    assert.equal(store.assertConsistent(), true);
  });

  test(`${label}: application, tenant, and global outstanding backpressure remain independent`, async () => {
    const applicationPolicy = runtimePolicy({ maxApplicationOutstanding: "1" });
    const applicationStore = createStore({ policy: applicationPolicy });
    await applicationStore.submit({ bytes: admissionBytes({ applicationId: "one-app", revision: "1" }), principalContext: principalContext(), ...requestBinding("app-one", applicationPolicy) });
    await assert.rejects(
      applicationStore.submit({ bytes: admissionBytes({ applicationId: "one-app", revision: "2" }), principalContext: principalContext(), ...requestBinding("app-two", applicationPolicy) }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_APPLICATION_BACKPRESSURE")
    );

    const tenantPolicy = runtimePolicy({ maxApplicationOutstanding: "1", maxTenantLeased: "1", maxTenantOutstanding: "1" });
    const tenantStore = createStore({ policy: tenantPolicy });
    await tenantStore.submit({ bytes: admissionBytes({ applicationId: "tenant-one" }), principalContext: principalContext(), ...requestBinding("tenant-one", tenantPolicy) });
    await assert.rejects(
      tenantStore.submit({ bytes: admissionBytes({ applicationId: "tenant-two" }), principalContext: principalContext(), ...requestBinding("tenant-two", tenantPolicy) }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_TENANT_BACKPRESSURE")
    );

    const globalPolicy = runtimePolicy({
      maxApplicationOutstanding: "1",
      maxGlobalLeased: "1",
      maxGlobalOutstanding: "1",
      maxTenantLeased: "1",
      maxTenantOutstanding: "1"
    });
    const globalStore = createStore({ policy: globalPolicy });
    await globalStore.submit({ bytes: admissionBytes({ applicationId: "global-one" }), principalContext: principalContext("tenant-a", "alice"), ...requestBinding("global-one", globalPolicy) });
    await assert.rejects(
      globalStore.submit({ bytes: admissionBytes({ applicationId: "global-two" }), principalContext: principalContext("tenant-b", "bob"), ...requestBinding("global-two", globalPolicy) }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_GLOBAL_BACKPRESSURE")
    );
    assert.equal(applicationStore.assertConsistent(), true);
    assert.equal(tenantStore.assertConsistent(), true);
    assert.equal(globalStore.assertConsistent(), true);
  });

  test(`${label}: fair claims rotate tenants while preserving FIFO inside each tenant`, async () => {
    const store = createStore();
    for (const applicationId of ["alpha-one", "alpha-two", "alpha-three"]) {
      await store.submit({ bytes: admissionBytes({ applicationId }), principalContext: principalContext("tenant-a", "alice"), ...requestBinding(applicationId) });
    }
    await store.submit({ bytes: admissionBytes({ applicationId: "beta-one" }), principalContext: principalContext("tenant-b", "bob"), ...requestBinding("beta-one") });
    await store.submit({ bytes: admissionBytes({ applicationId: "gamma-one" }), principalContext: principalContext("tenant-c", "carol"), ...requestBinding("gamma-one") });
    const worker = workerContext("worker-one", "1");
    const claims = [];
    for (let index = 0; index < 4; index += 1) claims.push(await store.claim({ commandId: commandId(`fair-claim-${index}`), workerContext: worker }));
    assert.deepEqual(claims.map(({ status }) => status), ["LEASED", "LEASED", "LEASED", "LEASED"]);
    assert.deepEqual(claims.map(({ lease }) => lease.claimOrdinal), ["1", "2", "3", "4"]);
    assert.deepEqual(claims.map(({ jobId }) => store.readJob(jobId).tenantId), ["tenant-a", "tenant-b", "tenant-c", "tenant-a"]);
    assert.equal(store.readJob(claims[0].jobId).applicationId, "alpha-one");
    assert.equal(store.readJob(claims[3].jobId).applicationId, "alpha-two");
    assert.equal(store.assertConsistent(), true);
  });

  test(`${label}: durable mutation replay binds the exact command preimage and immutable receipt effect`, async () => {
    const store = createStore();
    const worker = workerContext("durable-binding-worker", "1");
    for (const applicationId of ["durable-binding-a", "durable-binding-b"]) {
      await store.submit({
        bytes: admissionBytes({ applicationId }),
        principalContext: principalContext(),
        ...requestBinding(applicationId)
      });
    }
    const firstClaim = await store.claim({ commandId: commandId("durable-binding-claim-a"), workerContext: worker });
    const secondClaim = await store.claim({ commandId: commandId("durable-binding-claim-b"), workerContext: worker });
    const firstCommandId = commandId("durable-binding-renew-a");
    const secondCommandId = commandId("durable-binding-renew-b");
    const firstRenewal = await store.renew({
      commandId: firstCommandId,
      fenceToken: firstClaim.lease.fenceToken,
      jobId: firstClaim.jobId,
      leaseId: firstClaim.lease.leaseId,
      workerContext: worker
    });
    const secondRenewal = await store.renew({
      commandId: secondCommandId,
      fenceToken: secondClaim.lease.fenceToken,
      jobId: secondClaim.jobId,
      leaseId: secondClaim.lease.leaseId,
      workerContext: worker
    });
    assert.equal(store.readReceipt(firstRenewal.receiptSha256).job.jobId, firstClaim.jobId);
    assert.equal(store.readReceipt(secondRenewal.receiptSha256).job.jobId, secondClaim.jobId);
    assert.deepEqual(await store.renew({
      commandId: firstCommandId,
      fenceToken: firstClaim.lease.fenceToken,
      jobId: firstClaim.jobId,
      leaseId: firstClaim.lease.leaseId,
      workerContext: worker
    }), firstRenewal);
    assert.deepEqual(await store.renew({
      commandId: secondCommandId,
      fenceToken: secondClaim.lease.fenceToken,
      jobId: secondClaim.jobId,
      leaseId: secondClaim.lease.leaseId,
      workerContext: worker
    }), secondRenewal);
    assert.equal(store.assertConsistent(), true);
  });

  test(`${label}: mutating command values are normalized exactly once before replay binding and state transition`, async () => {
    const store = createStore();
    await store.submit({
      bytes: admissionBytes({ applicationId: "single-snapshot-command" }),
      principalContext: principalContext(),
      ...requestBinding("single-snapshot-command")
    });
    const worker = workerContext("single-snapshot-worker", "1");
    const claim = await store.claim({ commandId: commandId("single-snapshot-claim"), workerContext: worker });
    let conversions = 0;
    const fenceToken = {
      toString() {
        conversions += 1;
        return conversions === 1 ? claim.lease.fenceToken : String(BigInt(claim.lease.fenceToken) + 1n);
      }
    };
    const renewal = await store.renew({
      commandId: commandId("single-snapshot-renew"),
      fenceToken,
      jobId: claim.jobId,
      leaseId: claim.lease.leaseId,
      workerContext: worker
    });
    assert.equal(conversions, 1);
    assert.equal(store.readReceipt(renewal.receiptSha256).lease.fenceToken, claim.lease.fenceToken);
    assert.equal(store.assertConsistent(), true);
  });

  test(`${label}: every mutation requires a command id and durable NO_WORK/snapshot replay is bounded`, async () => {
    const worker = workerContext();
    const principal = principalContext();
    const failure = { code: "TEST_FAILURE", detailsSha256: digestProtocolValue({ failure: true }), retryable: false };
    const missingCommandStore = createStore();
    for (const operation of [
      () => missingCommandStore.claim({ workerContext: worker }),
      () => missingCommandStore.renew({ fenceToken: "1", jobId: digestProtocolValue({ job: 1 }), leaseId: digestProtocolValue({ lease: 1 }), workerContext: worker }),
      () => missingCommandStore.fail({ failure, fenceToken: "1", jobId: digestProtocolValue({ job: 2 }), leaseId: digestProtocolValue({ lease: 2 }), workerContext: worker }),
      () => missingCommandStore.complete({ jobId: digestProtocolValue({ job: 3 }), resultBytes: Buffer.from("{}\n"), workerContext: worker }),
      () => missingCommandStore.redrive({ expectedReceiptSha256: digestProtocolValue({ receipt: 1 }), jobId: digestProtocolValue({ job: 4 }), principalContext: principal }),
      () => missingCommandStore.reapExpired(),
      () => missingCommandStore.snapshot(),
      () => missingCommandStore.gc({ commandId: null, snapshotSha256: digestProtocolValue({ snapshot: 1 }) })
    ]) {
      await assert.rejects(operation(), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_COMMAND_ID_REQUIRED"));
    }
    assert.deepEqual(missingCommandStore.inspectCounters().durable, { bytes: "0", commands: "0" });

    const policy = runtimePolicy({
      maxDurableCommandBytes: "65536",
      maxDurableCommands: "2",
      maxTenantReplayBytes: "1024",
      maxTenantReplayRecords: "2"
    });
    const store = createStore({ policy });
    const noWorkCommand = commandId("bounded-no-work");
    const noWork = await store.claim({ commandId: noWorkCommand, workerContext: worker });
    assert.equal(noWork.status, "NO_WORK");
    assert.deepEqual(await store.claim({ commandId: noWorkCommand, workerContext: worker }), noWork);
    const snapshotCommand = commandId("bounded-snapshot");
    const snapshot = await store.snapshot({ commandId: snapshotCommand });
    assert.deepEqual(await store.snapshot({ commandId: snapshotCommand }), snapshot);
    await assert.rejects(
      store.claim({ commandId: commandId("bounded-overflow"), workerContext: worker }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_DURABLE_COMMAND_CAPACITY")
    );
    assert.equal(store.inspectCounters().durable.commands, "2");
    store.advanceTime(policy.commandReplayRetentionMs);
    assert.equal((await store.claim({ commandId: commandId("bounded-after-expiry"), workerContext: worker })).status, "NO_WORK");
    assert.equal(store.inspectCounters().durable.commands, "1");
    assert.equal(store.assertConsistent(), true);
  });

  test(`${label}: lease expiry, fencing, deterministic retry, DLQ, and redrive are closed`, async () => {
    const store = createStore();
    const submission = await store.submit({ bytes: admissionBytes({ applicationId: "retry-job" }), principalContext: principalContext("tenant-a", "alice"), ...requestBinding("retry-job") });
    const workerOne = workerContext("worker-one", "1");
    const workerTwo = workerContext("worker-two", "2");
    const firstClaimCommand = commandId("retry-claim-1");
    const first = await store.claim({ commandId: firstClaimCommand, workerContext: workerOne });
    assert.deepEqual(await store.claim({ commandId: firstClaimCommand, workerContext: workerOne }), first);
    assert.equal(store.readJob(first.jobId).attempt, "1");
    assert.equal(store.listJobReceipts(first.jobId).length, 2);
    const claimedReceipt = store.readReceipt(first.receiptSha256);
    const mismatchedFenceReceipt = structuredClone(claimedReceipt);
    mismatchedFenceReceipt.lease.fenceToken = String(BigInt(mismatchedFenceReceipt.lease.fenceToken) + 1n);
    assert.throws(
      () => validateUniversalAdmissionEventReceipt(mismatchedFenceReceipt),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_LEASE_INVALID")
    );
    const forgedLeaseReceipt = structuredClone(claimedReceipt);
    forgedLeaseReceipt.lease.leaseId = digestProtocolValue({ forged: "lease" });
    assert.throws(
      () => validateUniversalAdmissionEventReceipt(forgedLeaseReceipt),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_LEASE_INVALID")
    );
    const renewed = await store.renew({
      commandId: commandId("retry-renew-1"),
      fenceToken: first.lease.fenceToken,
      jobId: first.jobId,
      leaseId: first.lease.leaseId,
      workerContext: workerOne
    });
    assert.equal(renewed.lease.renewals, "1");
    store.setNowMs(renewed.lease.expiresAtMs);
    const reaped = await store.reapExpired({ commandId: commandId("retry-reap-1") });
    assert.equal(reaped.results[0].status, "RETRY_WAIT");
    const retryAt = store.readJob(first.jobId).availableAtMs;
    assert.equal((await store.claim({ commandId: commandId("retry-no-work"), workerContext: workerTwo })).status, "NO_WORK");
    store.setNowMs(retryAt);
    const second = await store.claim({ commandId: commandId("retry-claim-2"), workerContext: workerTwo });
    assert.equal(BigInt(second.lease.fenceToken) > BigInt(first.lease.fenceToken), true);
    await assert.rejects(
      store.renew({ commandId: commandId("retry-stale-renew"), fenceToken: first.lease.fenceToken, jobId: first.jobId, leaseId: first.lease.leaseId, workerContext: workerOne }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_STALE_FENCE")
    );
    const failure = { code: "SOURCE_UNAVAILABLE", detailsSha256: digestProtocolValue({ reason: "test" }), retryable: true };
    const secondFailure = await store.fail({ commandId: commandId("retry-fail-2"), failure, fenceToken: second.lease.fenceToken, jobId: second.jobId, leaseId: second.lease.leaseId, workerContext: workerTwo });
    assert.equal(secondFailure.status, "RETRY_WAIT");
    store.setNowMs(secondFailure.availableAtMs);
    const third = await store.claim({ commandId: commandId("retry-claim-3"), workerContext: workerTwo });
    const dead = await store.fail({ commandId: commandId("retry-fail-3"), failure, fenceToken: third.lease.fenceToken, jobId: third.jobId, leaseId: third.lease.leaseId, workerContext: workerTwo });
    assert.equal(dead.status, "DEAD_LETTERED");
    const redriven = await store.redrive({
      commandId: commandId("retry-redrive-1"),
      expectedReceiptSha256: dead.receiptSha256,
      jobId: submission.jobId,
      principalContext: principalContext("tenant-a", "alice")
    });
    assert.equal(redriven.status, "QUEUED");
    assert.equal(store.readJob(submission.jobId).cycle, "1");
    assert.equal(store.readJob(submission.jobId).attempt, "0");
    const chain = store.listJobReceipts(submission.jobId);
    const currentJob = currentJobForChain(store, submission.jobId);
    assert.equal(validateUniversalAdmissionReceiptChain(chain, currentJob), true);
    const renewedIndex = chain.findIndex(({ eventType }) => eventType === "lease-renewed");
    const renewedTamper = structuredClone(chain);
    renewedTamper[renewedIndex].lease.expiresAtMs = String(BigInt(renewedTamper[renewedIndex].lease.expiresAtMs) + 1n);
    assert.doesNotThrow(() => validateUniversalAdmissionEventReceipt(renewedTamper[renewedIndex]));
    assert.throws(
      () => validateUniversalAdmissionReceiptChain(renewedTamper, currentJob),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID")
    );
    const noOpRenewalChain = structuredClone(chain);
    noOpRenewalChain[renewedIndex].lease.expiresAtMs = noOpRenewalChain[renewedIndex - 1].lease.expiresAtMs;
    noOpRenewalChain[renewedIndex + 1].lease.expiresAtMs = noOpRenewalChain[renewedIndex - 1].lease.expiresAtMs;
    const noOpHead = relinkReceiptChain(noOpRenewalChain);
    assert.doesNotThrow(() => validateUniversalAdmissionEventReceipt(noOpRenewalChain[renewedIndex]));
    assert.throws(
      () => validateUniversalAdmissionReceiptChain(noOpRenewalChain, { ...currentJob, lastReceiptSha256: noOpHead }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID")
    );
    const policyTamper = structuredClone(chain);
    const claimIndex = policyTamper.findIndex(({ eventType }) => eventType === "lease-claimed");
    policyTamper[claimIndex].capacityPolicySha256 = digestProtocolValue({ policy: "tampered" });
    assert.doesNotThrow(() => validateUniversalAdmissionEventReceipt(policyTamper[claimIndex]));
    assert.throws(
      () => validateUniversalAdmissionReceiptChain(policyTamper, currentJob),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID")
    );
    assert.throws(
      () => validateUniversalAdmissionReceiptChain(chain, { ...currentJob, redrives: "0" }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID")
    );
    const limitedPolicy = { ...store.policy, maxAttempts: "1" };
    const limitedPolicySha256 = digestUniversalAdmissionRuntimePolicy(limitedPolicy);
    const overLimitChain = structuredClone(chain);
    for (const receipt of overLimitChain) receipt.capacityPolicySha256 = limitedPolicySha256;
    overLimitChain[0].request.expectedCapacityPolicySha256 = limitedPolicySha256;
    assert.throws(
      () => validateUniversalAdmissionReceiptChain(overLimitChain, {
        ...currentJob,
        capacityPolicySha256: limitedPolicySha256,
        runtimePolicy: limitedPolicy
      }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RECEIPT_CHAIN_INVALID")
    );
    assert.equal(store.assertConsistent(), true);
  });

  test(`${label}: dead-letter payload retention closes redrive exactly and makes payloads collectible`, async () => {
    const policy = runtimePolicy({
      deadLetterPayloadRetentionMs: "5000",
      maxAttempts: "1",
      maxRedrives: "1"
    });
    const store = createStore({ policy });
    const submission = await store.submit({
      bytes: admissionBytes({ applicationId: "expired-dlq" }),
      principalContext: principalContext(),
      ...requestBinding("expired-dlq", policy)
    });
    const worker = workerContext();
    const claim = await store.claim({ commandId: commandId("expired-dlq-claim"), workerContext: worker });
    const dead = await store.fail({
      commandId: commandId("expired-dlq-fail"),
      failure: { code: "PERMANENT_TEST_FAILURE", detailsSha256: digestProtocolValue({ permanent: true }), retryable: false },
      fenceToken: claim.lease.fenceToken,
      jobId: claim.jobId,
      leaseId: claim.lease.leaseId,
      workerContext: worker
    });
    store.advanceTime(policy.deadLetterPayloadRetentionMs);
    const redriveRequest = {
      commandId: commandId("expired-dlq-redrive"),
      expectedReceiptSha256: dead.receiptSha256,
      jobId: submission.jobId,
      principalContext: principalContext()
    };
    await assert.rejects(store.redrive(redriveRequest), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_REDRIVE_WINDOW_EXPIRED"));
    const afterFirstFailure = store.inspectCounters();
    await assert.rejects(store.redrive(redriveRequest), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_REDRIVE_WINDOW_EXPIRED"));
    assert.deepEqual(store.inspectCounters(), afterFirstFailure);
    const snapshot = await store.snapshot({ commandId: commandId("expired-dlq-snapshot") });
    const gc = await store.gc({ commandId: commandId("expired-dlq-gc"), snapshotSha256: snapshot.snapshotSha256 });
    assert.equal(gc.done, true);
    assert.equal(gc.deletedCount, "1");
    assert.equal(store.readObject(submission.admissionDigest), null);
    assert.equal(store.assertConsistent(), true);
  });

  test(`${label}: applicant redrive replay is tenant-bounded and exact failure replay is neutral`, async () => {
    const policy = runtimePolicy({ maxTenantReplayRecords: "3" });
    const store = createStore({ policy });
    const principal = principalContext();
    const submission = await store.submit({
      bytes: admissionBytes({ applicationId: "redrive-spam" }),
      principalContext: principal,
      ...requestBinding("redrive-spam-submit", policy)
    });
    const worker = workerContext();
    const claim = await store.claim({ commandId: commandId("redrive-spam-claim"), workerContext: worker });
    await store.fail({
      commandId: commandId("redrive-spam-fail"),
      failure: { code: "PERMANENT_SPAM_TEST", detailsSha256: digestProtocolValue({ permanent: true }), retryable: false },
      fenceToken: claim.lease.fenceToken,
      jobId: claim.jobId,
      leaseId: claim.lease.leaseId,
      workerContext: worker
    });
    const forgedReceiptSha256 = digestProtocolValue({ forged: "receipt" });
    const firstInvalid = {
      commandId: commandId("redrive-spam-invalid-1"),
      expectedReceiptSha256: forgedReceiptSha256,
      jobId: submission.jobId,
      principalContext: principal
    };
    await assert.rejects(store.redrive(firstInvalid), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_DLQ_REDRIVE_CONFLICT"));
    const afterFirst = store.inspectCounters();
    await assert.rejects(store.redrive(firstInvalid), hasCode("UNIVERSAL_ADMISSION_PROTOCOL_DLQ_REDRIVE_CONFLICT"));
    assert.deepEqual(store.inspectCounters(), afterFirst);
    await assert.rejects(
      store.redrive({ ...firstInvalid, commandId: commandId("redrive-spam-invalid-2") }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_DLQ_REDRIVE_CONFLICT")
    );
    await assert.rejects(
      store.redrive({ ...firstInvalid, commandId: commandId("redrive-spam-invalid-3") }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_TENANT_REPLAY_CAPACITY")
    );
    assert.equal(store.inspectCounters().tenants["tenant-a"].replayRecords, "3");
    assert.equal(store.assertConsistent(), true);
  });

  test(`${label}: completion binds the exact worker, lease, artifacts, result, and inert receipt`, async () => {
    const store = createStore();
    const submission = await store.submit({ bytes: admissionBytes({ applicationId: "complete-job" }), principalContext: principalContext("tenant-a", "alice"), ...requestBinding("complete-job") });
    const worker = workerContext("worker-one", "1");
    const claim = await store.claim({ commandId: commandId("complete-claim"), workerContext: worker });
    const report = await store.putObjectIfAbsent({ bytes: Buffer.from("public report\n"), mediaType: "public-evidence" });
    const artifact = await store.putObjectIfAbsent({ bytes: Buffer.from("public artifact\n"), mediaType: "public-evidence" });
    const result = workerResult({ artifact, claim, report, worker });
    const reservedAliasResult = workerResult({ artifact, claim, report: { digest: submission.admissionDigest }, worker });
    await assert.rejects(
      store.complete({ commandId: commandId("complete-reserved-report"), jobId: submission.jobId, resultBytes: canonicalProtocolBytes(reservedAliasResult), workerContext: worker }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_ARTIFACT_MISSING")
    );
    assert.equal(store.readJob(submission.jobId).state, "leased");
    const completionCommand = commandId("complete-once");
    const completions = await Promise.all([
      store.complete({ commandId: completionCommand, jobId: submission.jobId, resultBytes: canonicalProtocolBytes(result), workerContext: worker }),
      store.complete({ commandId: completionCommand, jobId: submission.jobId, resultBytes: canonicalProtocolBytes(result), workerContext: worker })
    ]);
    assert.equal(new Set(completions.map((value) => digestProtocolValue(value))).size, 1);
    const completed = completions[0];
    await assert.rejects(
      store.complete({ commandId: commandId("complete-after-terminal"), jobId: submission.jobId, resultBytes: canonicalProtocolBytes(result), workerContext: worker }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_JOB_STATE_CONFLICT")
    );
    assert.equal(completed.status, "PROCESSING_COMPLETED");
    assert.equal(store.readJob(submission.jobId).state, "processing-completed");
    const receipt = store.readReceipt(completed.receiptSha256);
    assert.equal(receipt.eventType, "processing-completed");
    assert.deepEqual(receipt.authority, inertProtocolAuthority());
    assert.deepEqual(store.inspectCounters().global, { leased: "0", outstanding: "0" });
    assert.equal(store.assertConsistent(), true);
  });

  test(`${label}: snapshots are immutable and GC rechecks live references and generations`, async () => {
    const store = createStore();
    const orphanBytes = Buffer.from("orphan\n");
    const orphan = await store.putObjectIfAbsent({ bytes: orphanBytes, mediaType: "public-evidence" });
    const futureBytes = admissionBytes({ applicationId: "future-job" });
    const future = await store.testOnlyPutReservedObjectIfAbsent({ bytes: futureBytes, mediaType: "universal-admission-envelope" });
    const live = await store.submit({ bytes: admissionBytes({ applicationId: "live-job" }), principalContext: principalContext("tenant-a", "alice"), ...requestBinding("live-a") });
    store.advanceTime(DEFAULT_TEST_RUNTIME_POLICY.orphanRetentionMs);
    const snapshots = await Promise.all([
      store.snapshot({ commandId: commandId("snapshot-a") }),
      store.snapshot({ commandId: commandId("snapshot-b") })
    ]);
    const genesisSnapshots = snapshots.filter(({ manifest }) => manifest.previousSnapshotSha256 === null);
    assert.equal(genesisSnapshots.length, 1);
    const snapshot = snapshots.find(({ manifest }) => manifest.previousSnapshotSha256 !== null);
    assert.equal(snapshot.manifest.previousSnapshotSha256, genesisSnapshots[0].snapshotSha256);
    assert.notEqual(snapshot.snapshotSha256, genesisSnapshots[0].snapshotSha256);
    const futureSubmission = await store.submit({ bytes: futureBytes, principalContext: principalContext("tenant-c", "carol"), ...requestBinding("future-live") });
    assert.equal(futureSubmission.admissionDigest, future.digest);
    const sameEnvelopeOtherTenant = await store.submit({ bytes: admissionBytes({ applicationId: "live-job" }), principalContext: principalContext("tenant-b", "bob"), ...requestBinding("live-b") });
    assert.equal(sameEnvelopeOtherTenant.admissionDigest, live.admissionDigest);
    const collected = await store.gc({ commandId: commandId("gc-a"), snapshotSha256: snapshot.snapshotSha256 });
    assert.equal(collected.done, true);
    assert.equal(store.readObject(orphan.digest), null);
    assert.notEqual(store.readObject(future.digest), null);
    assert.notEqual(store.readObject(live.admissionDigest), null);
    const rehydrated = await store.putObjectIfAbsent({ bytes: orphanBytes, mediaType: "public-evidence" });
    assert.equal(rehydrated.generation, "2");
    const staleGc = await store.gc({ commandId: commandId("gc-b"), snapshotSha256: snapshot.snapshotSha256 });
    assert.deepEqual(staleGc, { deletedCount: "0", done: true, remainingCount: "0", snapshotSha256: snapshot.snapshotSha256 });
    assert.notEqual(store.readObject(orphan.digest), null);
    assert.notEqual(store.readObject(snapshot.snapshotSha256), null);
    assert.equal(store.assertConsistent(), true);

    const left = createStore();
    const right = createStore();
    for (const candidate of [left, right]) {
      await candidate.putObjectIfAbsent({ bytes: Buffer.from("same logical orphan\n"), mediaType: "public-evidence" });
      candidate.advanceTime(DEFAULT_TEST_RUNTIME_POLICY.orphanRetentionMs);
    }
    const leftSnapshot = await left.snapshot({ commandId: commandId("logical-snapshot") });
    const rightSnapshot = await right.snapshot({ commandId: commandId("logical-snapshot") });
    assert.deepEqual(leftSnapshot.manifest, rightSnapshot.manifest);
    assert.equal(leftSnapshot.snapshotSha256, rightSnapshot.snapshotSha256);

    const batched = createStore();
    const batchedObjects = [];
    for (const value of ["batch-a\n", "batch-b\n", "batch-c\n"]) {
      batchedObjects.push(await batched.putObjectIfAbsent({ bytes: Buffer.from(value), mediaType: "public-evidence" }));
    }
    batched.advanceTime(DEFAULT_TEST_RUNTIME_POLICY.orphanRetentionMs);
    const batchedSnapshot = await batched.snapshot({ commandId: commandId("batch-snapshot") });
    await assert.rejects(
      batched.gc({ commandId: commandId("batch-forged-cursor"), cursor: 999999, limit: 1, snapshotSha256: batchedSnapshot.snapshotSha256 }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_FIELD_SET_INVALID")
    );
    const batches = [];
    for (let index = 0; index < 3; index += 1) {
      batches.push(await batched.gc({ commandId: commandId(`batch-gc-${index}`), limit: 1, snapshotSha256: batchedSnapshot.snapshotSha256 }));
    }
    assert.deepEqual(batches.map(({ deletedCount, done, remainingCount }) => ({ deletedCount, done, remainingCount })), [
      { deletedCount: "1", done: false, remainingCount: "2" },
      { deletedCount: "1", done: false, remainingCount: "1" },
      { deletedCount: "1", done: true, remainingCount: "0" }
    ]);
    assert.deepEqual(batchedObjects.map(({ digest }) => batched.readObject(digest)), [null, null, null]);
    assert.equal(batched.assertConsistent(), true);
  });

  test(`${label}: reserved CAS media aliases fail closed and reused receipts gain their exact live reference`, async () => {
    const bytes = admissionBytes({ applicationId: "receipt-preseed" });
    const context = principalContext("tenant-a", "alice");
    const request = requestBinding("receipt-preseed");
    const source = createStore();
    const sourceSubmission = await source.submit({ bytes, principalContext: context, ...request });
    const receiptBytes = source.readObject(sourceSubmission.receiptSha256);

    const aliasStore = createStore();
    await assert.rejects(
      aliasStore.putObjectIfAbsent({ bytes: receiptBytes, mediaType: "universal-admission-event-receipt" }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_RESERVED_MEDIA_FORBIDDEN")
    );
    let aliasRejectedAtWrite = false;
    try {
      await aliasStore.putObjectIfAbsent({ bytes: receiptBytes, mediaType: "public-evidence" });
    } catch (error) {
      assert.equal(error.code, "UNIVERSAL_ADMISSION_PROTOCOL_CAS_MEDIA_TYPE_CONFLICT");
      aliasRejectedAtWrite = true;
    }
    if (!aliasRejectedAtWrite) {
      await assert.rejects(
        aliasStore.submit({ bytes, principalContext: context, ...request }),
        hasCode("UNIVERSAL_ADMISSION_PROTOCOL_CAS_MEDIA_TYPE_CONFLICT")
      );
    }
    assert.deepEqual(aliasStore.inspectCounters().global, { leased: "0", outstanding: "0" });
    assert.equal(aliasStore.assertConsistent(), true);

    const emptyWithLyingLength = new Uint8Array(0);
    Object.defineProperty(emptyWithLyingLength, "byteLength", { get: () => 1 });
    await assert.rejects(
      aliasStore.putObjectIfAbsent({ bytes: emptyWithLyingLength, mediaType: "public-evidence" }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID")
    );
    const oversizedWithLyingLength = new Uint8Array(MAX_UNIVERSAL_ADMISSION_CAS_OBJECT_BYTES + 1);
    Object.defineProperty(oversizedWithLyingLength, "byteLength", { get: () => 1 });
    await assert.rejects(
      aliasStore.putObjectIfAbsent({ bytes: oversizedWithLyingLength, mediaType: "public-evidence" }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID")
    );
    let proxyReads = 0;
    const proxiedBytes = new Proxy(new Uint8Array([1]), {
      get(target, key, receiver) {
        proxyReads += 1;
        return Reflect.get(target, key, receiver);
      }
    });
    await assert.rejects(
      aliasStore.putObjectIfAbsent({ bytes: proxiedBytes, mediaType: "public-evidence" }),
      hasCode("UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID")
    );
    assert.equal(proxyReads, 0);

    const arbitraryReservedBytes = canonicalProtocolBytes({ kind: "programmable-universal-admission-event-receipt" });
    await assert.rejects(
      aliasStore.testOnlyPutReservedObjectIfAbsent({ bytes: arbitraryReservedBytes, mediaType: "universal-admission-event-receipt" }),
      (error) => new Set([
        "UNIVERSAL_ADMISSION_PROTOCOL_FIELD_SET_INVALID",
        "UNIVERSAL_ADMISSION_PROTOCOL_OBJECT_INVALID"
      ]).has(error?.code)
    );
    assert.equal(aliasStore.readObject(sha256Bytes(arbitraryReservedBytes)), null);

    const reuseStore = createStore();
    const preseed = await reuseStore.testOnlyPutReservedObjectIfAbsent({ bytes: receiptBytes, mediaType: "universal-admission-event-receipt" });
    assert.equal(preseed.created, true);
    const submission = await reuseStore.submit({ bytes, principalContext: context, ...request });
    assert.equal(submission.receiptSha256, preseed.digest);
    const snapshot = await reuseStore.snapshot({ commandId: commandId("reuse-snapshot") });
    assert.equal(snapshot.manifest.recordScope, "gc-control-v1");
    assert.equal(snapshot.manifest.totals.liveObjectReferences, "1");
    assert.equal(reuseStore.assertConsistent(), true);
  });

  test(`${label}: byte-bearing mutations ignore caller-owned typed-array hooks`, async () => {
    const store = createStore();
    const evidenceInput = hostileByteInput(Buffer.from("hostile public evidence\n"));
    const evidence = await store.putObjectIfAbsent({ bytes: evidenceInput.bytes, mediaType: "public-evidence" });
    assert.equal(evidenceInput.readCount(), 0);
    assert.equal(evidence.digest, sha256Bytes(Buffer.from("hostile public evidence\n")));

    const admissionSource = admissionBytes({ applicationId: "hostile-byte-input" });
    const admissionInput = hostileByteInput(admissionSource);
    const submission = await store.submit({
      bytes: admissionInput.bytes,
      principalContext: principalContext(),
      ...requestBinding("hostile-byte-input")
    });
    assert.equal(admissionInput.readCount(), 0);
    assert.equal(submission.admissionDigest, sha256Bytes(admissionSource));

    const worker = workerContext("hostile-byte-worker", "1");
    const claim = await store.claim({ commandId: commandId("hostile-byte-claim"), workerContext: worker });
    const report = await store.putObjectIfAbsent({ bytes: Buffer.from("hostile result report\n") });
    const artifact = await store.putObjectIfAbsent({ bytes: Buffer.from("hostile result artifact\n") });
    const resultSource = canonicalProtocolBytes(workerResult({ artifact, claim, report, worker }));
    const resultInput = hostileByteInput(resultSource);
    const completed = await store.complete({
      commandId: commandId("hostile-byte-complete"),
      jobId: submission.jobId,
      resultBytes: resultInput.bytes,
      workerContext: worker
    });
    assert.equal(resultInput.readCount(), 0);
    assert.equal(completed.status, "PROCESSING_COMPLETED");
    assert.equal(store.assertConsistent(), true);
  });
}

export function admissionBytes({
  applicationId = "minecraft-hook",
  projectLabel = "A universal programmable project",
  revision = "1",
  sourceCommit = "a"
} = {}) {
  const value = {
    $schema: "urn:programmable:universal-admission:1.0.0",
    application: {
      id: applicationId,
      projectLabel,
      requestedRoute: "none",
      revision,
      stage: "proposal"
    },
    attestation: {
      candidateCodeExecuted: false,
      externalWritesPerformed: false,
      noApprovalClaim: true,
      noSafetyGuaranteeClaim: true,
      publicDataOnly: true,
      unknownsExplicit: true
    },
    disclosure: {
      dependencies: [{
        failureMode: "No external dependency is claimed.",
        id: "none",
        kind: "other",
        sourceRefs: ["README.md"],
        status: "declared"
      }],
      evidence: [],
      executionSurfaces: [{
        id: "project",
        kind: "programmable project",
        sourceRefs: ["README.md"],
        status: "declared",
        summary: "The exact public source is submitted for later independent review."
      }],
      privileges: [{
        id: "none",
        kind: "other",
        sourceRefs: ["README.md"],
        status: "not-applicable",
        summary: "No privilege is claimed at this stage."
      }],
      valueFlows: [{
        basis: "No value flow is claimed at this stage.",
        from: "none",
        id: "none",
        kind: "none",
        sourceRefs: ["README.md"],
        status: "declared",
        to: "none"
      }]
    },
    kind: "programmable-universal-admission",
    schemaVersion: "1.0.0",
    source: {
      commit: sourceCommit.repeat(40),
      packageSha256: `sha256:${"c".repeat(64)}`,
      path: "admission/application.json",
      repositoryUrl: "https://example.com/public/project",
      tree: "b".repeat(40)
    }
  };
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

export function principalContext(tenantId = "tenant-a", subjectId = "alice", audience = DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE) {
  return {
    authenticated: true,
    audience,
    authorityId: "test-auth",
    kind: "programmable-authenticated-principal-context",
    schemaVersion: "1.0.0",
    subjectId,
    tenantId
  };
}

export function workerContext(workerId = "worker-one", implementationSeed = "1", audience = DEFAULT_UNIVERSAL_ADMISSION_SERVICE_AUDIENCE) {
  return {
    authenticated: true,
    audience,
    authorityId: "test-workers",
    implementationSha256: `sha256:${implementationSeed.repeat(64)}`,
    kind: "programmable-authenticated-worker-context",
    schemaVersion: "1.0.0",
    workerId
  };
}

export function runtimePolicy(overrides = {}) {
  return { ...structuredClone(DEFAULT_TEST_RUNTIME_POLICY), ...overrides };
}

export function requestBinding(seed = "request-one", policy = DEFAULT_TEST_RUNTIME_POLICY, authenticatedRequestByteLength = "4096") {
  const digest = digestProtocolValue({
    command: seed,
    kind: "test-signed-enqueue-command",
    schemaVersion: "1.0.0"
  });
  return {
    authenticatedRequestByteLength,
    expectedCapacityPolicySha256: digestUniversalAdmissionRuntimePolicy(policy),
    requestDigest: digest,
    requestId: digest.slice("sha256:".length, "sha256:".length + 32)
  };
}

export function workerResult({ artifact, claim, report, worker }) {
  const { workerBindingSha256 } = deriveWorkerBinding(worker);
  return {
    $schema: "urn:programmable:universal-admission-worker-result:1.0.0",
    artifacts: [{ byteLength: artifact.byteLength, id: "evidence", kind: "public-evidence", sha256: artifact.digest }],
    authority: inertProtocolAuthority(),
    binding: {
      admissionDigest: claim.admissionDigest,
      attempt: "1",
      cycle: "0",
      fenceToken: claim.lease.fenceToken,
      jobId: claim.jobId,
      leaseId: claim.lease.leaseId,
      revisionBindingSha256: claim.revisionBindingSha256,
      revisionKey: claim.revisionKey
    },
    effects: {
      candidateCodeExecuted: false,
      externalNetworkAccessed: false,
      externalWritesPerformed: false,
      sandboxed: false
    },
    kind: "programmable-universal-admission-worker-result",
    publicDataOnly: true,
    reportSha256: report.digest,
    reviewState: "ready_for_review",
    schemaVersion: "1.0.0",
    worker: {
      implementationSha256: worker.implementationSha256,
      workerBindingSha256
    }
  };
}

export function commandId(seed = "command-one") {
  return digestProtocolValue({ kind: "test-universal-admission-command-id", seed }).slice(7, 39);
}

export function hostileByteInput(source) {
  class HostileUint8Array extends Uint8Array {}
  const stableSource = Buffer.from(source);
  const bytes = new HostileUint8Array(stableSource.length);
  bytes.set(stableSource);
  let reads = 0;
  const rejectCallerPropertyRead = () => {
    reads += 1;
    throw new Error("caller-owned typed-array property was read");
  };
  for (const property of ["buffer", "byteLength", "byteOffset", "constructor", "length", "valueOf", Symbol.iterator, Symbol.toStringTag]) {
    Object.defineProperty(bytes, property, {
      configurable: true,
      get: rejectCallerPropertyRead
    });
  }
  return { bytes, readCount: () => reads };
}

function currentJobForChain(store, jobId) {
  return {
    ...store.readJob(jobId),
    capacityPolicySha256: store.capacityPolicySha256,
    runtimePolicy: store.policy,
    serviceAudience: store.serviceAudience
  };
}

function relinkReceiptChain(receipts) {
  for (let index = 1; index < receipts.length; index += 1) {
    receipts[index].previousReceiptSha256 = sha256Bytes(canonicalProtocolBytes(receipts[index - 1]));
  }
  return sha256Bytes(canonicalProtocolBytes(receipts.at(-1)));
}

function hasCode(code) {
  return (error) => error?.code === code;
}
