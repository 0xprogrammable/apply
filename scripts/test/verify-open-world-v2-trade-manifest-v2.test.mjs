import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  validateTradeCapabilityManifestV2,
  validateTradeResultPairV2,
  validateTradeTestResultV2
} from "../verify-open-world-v2-trade-manifest-v2.mjs";
import { createApplicationV3TestPackage } from "./application-v3-package-fixture.mjs";

const SCHEMA_PATH = new URL("../../intake/schemas/trade-capability-manifest-v2.schema.json", import.meta.url);

test("Trade Manifest V2 is policy-neutral and validates a complete generic tradable route", () => {
  const fixture = tradableFixture();
  const { manifest } = fixture;
  assert.equal(Object.hasOwn(manifest.feeBehavior, "programmableFeeV2"), false);
  assert.equal(manifest.$schema, "urn:programmable:trade-capability-manifest:2.0.0");
  assert.equal(manifest.contract.id, "trade-capability-manifest-v2");
  assert.deepEqual(validateTradeCapabilityManifestV2(manifest, {
    applicationId: manifest.applicationId,
    marketRef: manifest.marketRef,
    routeType: manifest.route.type
  }), []);

  const schemaSource = fs.readFileSync(SCHEMA_PATH, "utf8");
  assert.equal(schemaSource.includes("programmableFeeV2"), false);
  assert.equal(schemaSource.includes("0x4957f49620AFf3Adbbe8195a4f633E49cc93376c"), false);
  assert.equal(schemaSource.includes("minimumPlatformRateHundredthsOfBip"), false);
});

test("all bound V2 quote and execution results validate and retain same-mode parity", () => {
  const { files, manifest } = tradableFixture();
  for (const declaration of manifest.testEvidence.quoteTests) {
    const result = readJson(files, declaration.resultArtifactPath);
    assert.deepEqual(validateTradeTestResultV2(result, { manifest, test: declaration }), [], declaration.id);
  }
  for (const declaration of manifest.testEvidence.executionTests) {
    const result = readJson(files, declaration.resultArtifactPath);
    assert.deepEqual(validateTradeTestResultV2(result, { manifest, test: declaration }), [], declaration.id);
  }

  const quoteTest = manifest.testEvidence.quoteTests[0];
  const executionTest = manifest.testEvidence.executionTests.find(({ modeRef, scenario }) => (
    modeRef === quoteTest.modeRef && scenario === "successful-swap"
  ));
  assert.deepEqual(validateTradeResultPairV2(
    readJson(files, quoteTest.resultArtifactPath),
    readJson(files, executionTest.resultArtifactPath),
    { manifest, quoteTest, executionTest }
  ), []);
});

test("Trade Manifest V2 rejects branded-policy smuggling and result substitution", () => {
  const { files, manifest } = tradableFixture();
  const branded = structuredClone(manifest);
  branded.feeBehavior.programmableFeeV2 = { applicability: "applicable" };
  assert.ok(validateTradeCapabilityManifestV2(branded).some(({ code }) => (
    code === "TRADE_CAPABILITY_MANIFEST_SCHEMA_INVALID"
  )));

  const declaration = manifest.testEvidence.quoteTests[0];
  const substituted = readJson(files, declaration.resultArtifactPath);
  substituted.identity.marketRef = "other-market";
  assert.ok(validateTradeTestResultV2(substituted, { manifest, test: declaration }).some(({ code }) => (
    code === "TRADE_TEST_RESULT_BINDING_MISMATCH"
  )));
});

function tradableFixture() {
  const sourcePackage = createApplicationV3TestPackage({
    applicationContractVersion: "3.2.0",
    marketMode: "tradable",
    requestedRoute: "other"
  }).sourcePackage;
  const market = sourcePackage.submission.tradeCapability.markets[0];
  return {
    files: sourcePackage.files,
    manifest: readJson(sourcePackage.files, market.manifest.path)
  };
}

function readJson(files, relativePath) {
  return JSON.parse(files.get(relativePath));
}
