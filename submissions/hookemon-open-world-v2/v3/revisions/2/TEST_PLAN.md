# Test plan

Executed against exact current source commit `04c6ac3442cb7081ea3dd960fc76fa29dba49ece` unless a runtime commit is stated explicitly:

- GitHub Actions run `32341726719` passed website lint/build/tests and contract/automation formatting, checks, tests, build, contract-size, gas-snapshot, and invariant verification.
- `pnpm check`, `pnpm test`, and `pnpm build` passed locally. The covered suites included 120 of 120 Solidity tests, 386 of 386 operator tests, and 89 of 89 website tests.
- The official local source-closure verifier returned `VERIFIED` for 418 entries, 13 contract-role paths, one proof role, and zero findings.
- A bounded signed Sepolia canary completed against runtime source commit `0d44fe1ccf654c3e712d7c48839af6d5288b82aa`. It confirmed 20 of 20 unique transactions, seven runtime code hashes, one buy, one sell, project and Programmable fee accrual, a project fee claim, a signed reward-root commit, three proportional reward payments totalling 1000000 units, consumed funding, and replay rejection.
- Direct read-only Sepolia replay confirmed chain ID 11155111, all 20 receipts, final fee counters, final reward counters, and a zero distributor balance.
- The production website build was exercised locally with a clearly marked test-only dashboard and cycle fixture. It rendered network, snapshot, pool, timer/cycle, pack/card, and reward data and completed the UI flow with zero new browser errors. This is website E2E evidence, not a claim that the injected fixture was live onchain dashboard data.
- Operator pause, resume, pack-option, cycle, settlement, and authorization paths are covered by automated tests. A local `/operator` request correctly failed closed with HTTP 401 when Cloudflare Access credentials were absent.

The public Sepolia transaction links and the bounded receipt summary are documented in source Draft PR #39. The local machine-readable receipt remains ignored private test state and contains no signing secret.

The Mainnet fork suite was explicitly excluded from local acceptance. No mainnet RPC, wallet signature, deployment, transaction, listing, liquidity action, or fund movement is part of this plan.

Still required before any production claim: independent security and architecture review, production provider and signer review, deployed production bytecode verification, real Cloudflare Access deployment verification, real external Collector purchase coverage where applicable, economic review, and explicit deployment and launch authorization.
