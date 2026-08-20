import {
  canonicalJson,
  isObject,
  sha256Bytes,
  validateExtensionInstance
} from "../vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs";
import { bundledSchemas } from "./verify-open-world-v2-contracts.mjs";

const UINT256_MAX = (1n << 256n) - 1n;
const QUADRANTS = Object.freeze([
  "zero-for-one:exact-input",
  "zero-for-one:exact-output",
  "one-for-zero:exact-input",
  "one-for-zero:exact-output"
]);
const resultSchemas = Object.freeze({
  "trade-quote-test-result-v2": Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:programmable:internal:trade-quote-test-result-v2-validator",
    $ref: "#/$defs/quoteTestResult",
    $defs: bundledSchemas.tradeCapabilityManifestV2.$defs
  }),
  "trade-execution-test-result-v2": Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:programmable:internal:trade-execution-test-result-v2-validator",
    $ref: "#/$defs/executionTestResult",
    $defs: bundledSchemas.tradeCapabilityManifestV2.$defs
  })
});

export function tradeCapabilityManifestSha256V2(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

export function tradeTestResultSha256V2(value) {
  if (!isObject(value)) return null;
  const preimage = { ...value };
  delete preimage.contentSha256;
  return sha256Bytes(Buffer.from(canonicalJson(preimage), "utf8"));
}

export function validateTradeCapabilityManifestV2(manifest, expected = {}) {
  const findings = schemaFindings(
    manifest,
    bundledSchemas.tradeCapabilityManifestV2,
    "TRADE_CAPABILITY_MANIFEST_SCHEMA_INVALID"
  );
  if (findings.length > 0) return sortFindings(findings);
  const add = findingAdder(findings);

  for (const [field, observed] of [
    ["applicationId", manifest.applicationId],
    ["marketRef", manifest.marketRef],
    ["routeType", manifest.route.type]
  ]) {
    if (expected[field] !== undefined && expected[field] !== observed) {
      add("TRADE_MANIFEST_EXPECTED_BINDING_MISMATCH", field === "routeType" ? "$.route.type" : `$.${field}`, "Trade manifest identity does not match its selected market binding.", { field, expected: expected[field], observed });
    }
  }
  if (expected.manifestSha256 !== undefined && expected.manifestSha256 !== tradeCapabilityManifestSha256V2(manifest)) {
    add("TRADE_MANIFEST_DIGEST_MISMATCH", "$", "Trade manifest canonical bytes do not match the expected digest.");
  }

  for (const [value, valuePath, allowZero] of [
    [manifest.chain.chainId, "$.chain.chainId", false],
    [manifest.chain.referenceBlock.number, "$.chain.referenceBlock.number", true],
    [manifest.chain.referenceBlock.timestamp, "$.chain.referenceBlock.timestamp", false]
  ]) validateUint256(value, valuePath, allowZero, add);
  if (manifest.poolKey.currency0 >= manifest.poolKey.currency1) {
    add("TRADE_POOL_KEY_CURRENCY_ORDER_INVALID", "$.poolKey", "PoolKey currencies must use canonical ascending address order.");
  }

  const dependencies = new Map();
  for (const [index, dependency] of manifest.dependencies.entries.entries()) {
    if (dependencies.has(dependency.id)) add("TRADE_DEPENDENCY_ID_DUPLICATE", `$.dependencies.entries[${index}].id`, "Dependency ids must be unique.", { id: dependency.id });
    dependencies.set(dependency.id, dependency);
  }
  validateRouteDependencies(manifest.route, dependencies, add);

  const modes = new Map();
  const quadrants = new Set();
  const fundingIds = new Set(manifest.route.fundingProfiles.map(({ id }) => id));
  let supportedModes = 0;
  for (const [index, mode] of manifest.capabilities.modeMatrix.entries()) {
    const modePath = `$.capabilities.modeMatrix[${index}]`;
    const quadrant = `${mode.direction}:${mode.amountMode}`;
    if (modes.has(mode.id)) add("TRADE_MODE_MATRIX_INVALID", `${modePath}.id`, "Mode ids must be unique.", { id: mode.id });
    if (quadrants.has(quadrant)) add("TRADE_MODE_MATRIX_INVALID", modePath, "Every direction and exactness quadrant must occur exactly once.", { quadrant });
    if (!fundingIds.has(mode.fundingProfileRef)) add("TRADE_FUNDING_PROFILE_MISSING", `${modePath}.fundingProfileRef`, "Mode references an undeclared funding profile.");
    modes.set(mode.id, mode);
    quadrants.add(quadrant);
    if (mode.support === "supported") supportedModes += 1;
  }
  if (supportedModes === 0 || QUADRANTS.some((quadrant) => !quadrants.has(quadrant))) {
    add("TRADE_MODE_MATRIX_INVALID", "$.capabilities.modeMatrix", "A tradable route must enumerate all four quadrants and support at least one mode.");
  }
  if (!(manifest.slippage.minimumBps <= manifest.slippage.defaultBps
    && manifest.slippage.defaultBps <= manifest.slippage.maximumBps)) {
    add("TRADE_SLIPPAGE_POLICY_INVALID", "$.slippage", "Slippage bounds must satisfy minimum <= default <= maximum.");
  }

  const feeComponentIds = new Set();
  for (const [index, component] of manifest.feeBehavior.components.entries()) {
    const componentPath = `$.feeBehavior.components[${index}]`;
    if (feeComponentIds.has(component.id)) add("TRADE_FEE_COMPONENT_DUPLICATE", `${componentPath}.id`, "Declared fee component ids must be unique.", { id: component.id });
    feeComponentIds.add(component.id);
    if ((component.calculation === "fixed-pips") !== (component.ratePips !== null)) add("TRADE_FEE_COMPONENT_INVALID", componentPath, "Only fixed-pips components carry ratePips, and every fixed-pips component must carry it.");
    if ((component.currencyRole === "route-defined") !== (component.routeDefinedCurrency !== null)) add("TRADE_FEE_COMPONENT_INVALID", componentPath, "Only route-defined currency components carry routeDefinedCurrency, and every such component must carry it.");
    if (component.kind === "v4-lp" && (component.currencyRole !== "input-currency" || component.chargeBase !== "input-amount")) add("TRADE_FEE_COMPONENT_INVALID", componentPath, "A v4 LP fee must be charged against the input amount in the input currency.");
  }

  validateTestDeclarations(manifest, modes, add);
  return sortFindings(findings);
}

export function validateTradeTestResultV2(result, { manifest, test } = {}) {
  const schema = resultSchemas[result?.contract];
  const findings = schema === undefined
    ? [finding("TRADE_TEST_RESULT_SCHEMA_INVALID", "$.contract", "Trade test result must select one exact V2 result contract.")]
    : schemaFindings(result, schema, "TRADE_TEST_RESULT_SCHEMA_INVALID");
  if (findings.length > 0 || !isObject(manifest) || !isObject(test)) return sortFindings(findings);
  const add = findingAdder(findings);
  for (const [observed, expected, valuePath] of [
    [result.identity.applicationId, manifest.applicationId, "$.identity.applicationId"],
    [result.identity.marketRef, manifest.marketRef, "$.identity.marketRef"],
    [result.identity.testId, test.id, "$.identity.testId"],
    [result.identity.commandId, test.commandId, "$.identity.commandId"],
    [result.context.manifestSha256, tradeCapabilityManifestSha256V2(manifest), "$.context.manifestSha256"],
    [result.context.sourceTestSha256, test.testSourceArtifact.sha256, "$.context.sourceTestSha256"],
    [result.context.chain.chainId, manifest.chain.chainId, "$.context.chain.chainId"],
    [result.context.poolKeySha256, tradeCapabilityManifestSha256V2(manifest.poolKey), "$.context.poolKeySha256"],
    [result.context.fee.feeBehaviorSha256, tradeCapabilityManifestSha256V2(manifest.feeBehavior), "$.context.fee.feeBehaviorSha256"],
    [result.context.fee.quotedFeesSha256, tradeCapabilityManifestSha256V2(result.context.fee.amounts), "$.context.fee.quotedFeesSha256"],
    [result.contentSha256, tradeTestResultSha256V2(result), "$.contentSha256"]
  ]) if (observed !== expected) add("TRADE_TEST_RESULT_BINDING_MISMATCH", valuePath, "Trade test result differs from its exact V2 manifest or test binding.", { expected, observed });
  if (canonicalJson(result.context.poolKey) !== canonicalJson(manifest.poolKey)) add("TRADE_POOL_KEY_PARITY_MISMATCH", "$.context.poolKey", "Trade result PoolKey differs from its manifest.");
  const mode = manifest.capabilities.modeMatrix.find(({ id }) => id === test.modeRef);
  if (!mode || canonicalJson(result.context.mode) !== canonicalJson({ id: mode.id, direction: mode.direction, amountMode: mode.amountMode, fundingProfileRef: mode.fundingProfileRef })) add("TRADE_EVIDENCE_MODE_UNDECLARED", "$.context.mode", "Trade result mode differs from its declaration.");
  validateFeeAmounts(result.context.fee.amounts, manifest.feeBehavior.components, add);
  if (result.contract === "trade-execution-test-result-v2") {
    const expectedOutcome = test.expectedOutcome === "swap-succeeds" ? "swap-succeeded" : "reverted-before-effects";
    if (result.scenario !== test.scenario || result.outcome !== expectedOutcome || result.observation.revertDataSha256 !== test.expectedRevertDataSha256) add("TRADE_EXECUTION_DECLARATION_MISMATCH", "$", "Execution scenario, outcome, and revert binding must equal the exact test declaration.");
  }
  return sortFindings(findings);
}

export function validateTradeResultPairV2(quote, execution, { manifest, quoteTest, executionTest } = {}) {
  const findings = [];
  const add = findingAdder(findings);
  if (!isObject(quote) || !isObject(execution) || !isObject(manifest) || !isObject(quoteTest) || !isObject(executionTest)) {
    add("TRADE_RESULT_PAIR_INVALID", "$", "Quote/execution parity requires both exact V2 result records and their declarations.");
    return findings;
  }
  for (const [left, right, valuePath] of [
    [quote.context.manifestSha256, execution.context.manifestSha256, "$.context.manifestSha256"],
    [quote.context.poolKeySha256, execution.context.poolKeySha256, "$.context.poolKeySha256"],
    [quote.context.mode.id, execution.context.mode.id, "$.context.mode.id"],
    [quote.context.request.fundingProfileRef, execution.context.request.fundingProfileRef, "$.context.request.fundingProfileRef"],
    [quote.context.fee.feeBehaviorSha256, execution.context.fee.feeBehaviorSha256, "$.context.fee.feeBehaviorSha256"]
  ]) if (left !== right) add("TRADE_QUOTE_EXECUTION_PARITY_MISMATCH", valuePath, "Quote and execution evidence do not bind the same declared route request.", { quote: left, execution: right });
  if (quoteTest.modeRef !== executionTest.modeRef) add("TRADE_QUOTE_EXECUTION_PARITY_MISMATCH", "$.identity.testId", "Paired quote and execution declarations must exercise the same mode.");
  return sortFindings(findings);
}

function validateRouteDependencies(route, dependencies, add) {
  const bind = (endpoint, role, valuePath) => {
    if (dependencies.get(endpoint?.sourceDependencyRef)?.role !== role) add("TRADE_ENDPOINT_DEPENDENCY_MISMATCH", `${valuePath}.sourceDependencyRef`, `Endpoint must bind one ${role} dependency.`);
  };
  if (route.type === "standard-uniswap-v4") {
    bind(route.router, "universal-router", "$.route.router");
    bind(route.quoter, "v4-quoter", "$.route.quoter");
  } else {
    bind(route.adapter, "trade-integration", "$.route.adapter");
    if (route.transport !== null) {
      bind(route.router, "universal-router", "$.route.router");
      bind(route.quoter, "v4-quoter", "$.route.quoter");
    }
  }
}

function validateTestDeclarations(manifest, modes, add) {
  const ids = new Set();
  const commands = new Set();
  const resultPaths = new Set();
  for (const [testsKey, tests] of [["quoteTests", manifest.testEvidence.quoteTests], ["executionTests", manifest.testEvidence.executionTests]]) {
    for (const [index, declaration] of tests.entries()) {
      const valuePath = `$.testEvidence.${testsKey}[${index}]`;
      if (ids.has(declaration.id)) add("TRADE_TEST_ID_DUPLICATE", `${valuePath}.id`, "Trade test ids must be globally unique.");
      if (commands.has(declaration.commandId)) add("TRADE_COMMAND_REUSED", `${valuePath}.commandId`, "A command id may author only one result.");
      if (resultPaths.has(declaration.resultArtifactPath)) add("TRADE_RESULT_PATH_REUSED", `${valuePath}.resultArtifactPath`, "Every trade result must use a distinct artifact path.");
      ids.add(declaration.id);
      commands.add(declaration.commandId);
      resultPaths.add(declaration.resultArtifactPath);
      const mode = modes.get(declaration.modeRef);
      if (!mode) add("TRADE_EVIDENCE_MODE_UNDECLARED", `${valuePath}.modeRef`, "Trade test references an undeclared mode.");
      if (declaration.chainId !== manifest.chain.chainId) add("TRADE_CHAIN_CONTEXT_MISMATCH", `${valuePath}.chainId`, "Trade test chainId must match the manifest.");
      if (testsKey === "executionTests" && declaration.scenario === "successful-swap" && mode?.support !== "supported") add("TRADE_TEST_SCENARIO_MODE_MISMATCH", `${valuePath}.scenario`, "Successful swap evidence must exercise a supported mode.");
      if (testsKey === "executionTests" && declaration.scenario === "unsupported-mode-pre-effects-revert" && mode?.support !== "unsupported") add("TRADE_TEST_SCENARIO_MODE_MISMATCH", `${valuePath}.scenario`, "Unsupported-mode rejection must exercise an unsupported mode.");
    }
  }
  const quotes = new Set(manifest.testEvidence.quoteTests.map(({ modeRef }) => modeRef));
  const executions = new Set(manifest.testEvidence.executionTests.filter(({ scenario }) => scenario === "successful-swap").map(({ modeRef }) => modeRef));
  for (const mode of modes.values()) if (mode.support === "supported" && (!quotes.has(mode.id) || !executions.has(mode.id))) add("TRADE_TEST_COVERAGE_MISSING", "$.testEvidence", "Every supported mode requires quote and successful execution evidence.", { modeId: mode.id });
}

function validateFeeAmounts(amounts, components, add) {
  const policyIds = new Set(components.map(({ id }) => id));
  const rows = new Map();
  const totals = new Map();
  for (const [index, row] of amounts.components.entries()) {
    if (rows.has(row.componentRef)) add("TRADE_FEE_RECONCILIATION_FAILED", `$.context.fee.amounts.components[${index}].componentRef`, "A declared fee component occurs more than once.");
    rows.set(row.componentRef, row);
    totals.set(row.currency, (totals.get(row.currency) ?? 0n) + BigInt(row.amount));
  }
  if (rows.size !== policyIds.size || [...policyIds].some((id) => !rows.has(id))) add("TRADE_FEE_RECONCILIATION_FAILED", "$.context.fee.amounts.components", "Fee evidence must cover the exact declared component set.");
  const reported = new Map(amounts.totalsByCurrency.map(({ currency, amount }) => [currency, BigInt(amount)]));
  if (reported.size !== amounts.totalsByCurrency.length || totals.size !== reported.size || [...totals].some(([currency, amount]) => reported.get(currency) !== amount)) add("TRADE_FEE_RECONCILIATION_FAILED", "$.context.fee.amounts.totalsByCurrency", "Reported fee totals must equal the sum of declared component amounts.");
}

function validateUint256(value, valuePath, allowZero, add) {
  try {
    const parsed = BigInt(value);
    if ((!allowZero && parsed === 0n) || parsed > UINT256_MAX) add("TRADE_UINT256_OUT_OF_RANGE", valuePath, "Value is outside the canonical uint256 range.");
  } catch {
    add("TRADE_UINT256_OUT_OF_RANGE", valuePath, "Value is not a canonical uint256 decimal string.");
  }
}

function schemaFindings(value, schema, code) {
  return validateExtensionInstance(value, schema, { trustedSchema: true }).map((issue) => finding(code, issue.path, issue.message, { schemaCode: issue.code }));
}

function findingAdder(findings) {
  const seen = new Set(findings.map(({ code, path }) => `${code}:${path}`));
  return (code, valuePath, message, details = {}) => {
    const key = `${code}:${valuePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding(code, valuePath, message, details));
  };
}

function finding(code, valuePath, message, details = {}) {
  return { severity: "blocker", code, path: valuePath, message, details };
}

function sortFindings(findings) {
  return findings.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
}
