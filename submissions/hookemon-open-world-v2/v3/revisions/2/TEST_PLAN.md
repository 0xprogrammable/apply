# Test plan

Executed against exact source commit `6f6f122b8c2f6a3cee0376038fcffbef886beecb`:

- Official Submission V2 validation passed with zero blockers and four expected proposal review holds.
- `forge test --root . --no-match-contract HookemonMainnetForkTest` passed 116 of 116 tests, including invariant, fuzz, hook-accounting, launch, vault, CCTP, lifecycle, and deployment-plan suites.
- `pnpm check` passed for all applicable workspace packages.
- `pnpm build` passed, including the Solidity build.
- GitHub Actions run `32184148013` is bound to the exact source commit and must be read back as successful before external Draft creation.

The Mainnet fork suite was explicitly excluded from the local acceptance command. No mainnet RPC, wallet signature, deployment, transaction, listing, liquidity action, or fund movement is part of this plan.

Still required before any later prototype or production claim:

- Independently review the source closure, threat model, Fee V2 decision, market and routing decision, and external provider architecture.
- Execute signed end-to-end flows only on approved testnets after test credentials, test funds, deployment receipts, and Devnet accounts exist.
- Verify deployed testnet bytecode against the reviewed source and preserve transaction receipts.
- Re-run tests, lint, type checks, build, size checks, invariants, and provider failure-path tests after every source change.
- Obtain an independent security review and explicit deployment and launch authorization in separate later gates.
