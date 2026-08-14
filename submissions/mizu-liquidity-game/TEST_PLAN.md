# Test plan

No candidate code was executed in the portable Builder process. The repository declares the following checks for an independently configured sandbox bound to the exact source commit.

## Declared coverage

- Pure math: buy/sell spread, surge bounds, scale crossing, 30/60-minute decay, split-versus-aggregate rounding, and overflow boundaries.
- Token: fixed supply, zero holder rejection, and absence of post-construction mint authority.
- Hook configuration: permission mask, CREATE2 address bits, one-pool registration, wrong PoolId, and direct callback rejection.
- Swap integration: both directions and both exactness modes, exact-output witnesses, stale-witness rejection, specified-quote partial-fill rollback, dust, and maximum delta bounds.
- Accounting: non-additive 10 bps Programmable split, project share, independent lifetime remainders, custody conservation, claim authorization, arbitrary nonzero claim recipients, and claim rollback.
- Liquidity game: add/remove range actions leave Mizu activity and liabilities unchanged.
- Stateful properties: bounded selected rate, monotone decay, activity no greater than cumulative gross flow, liability backing, and atomic failures.
- Factory: field mutation, occupied CREATE2 address, atomic rollback, runtime configuration hash, and receipt reconciliation.

## Required external commands

```sh
npm ci --ignore-scripts
forge fmt --check
forge build
node --test test/js/*.test.mjs
forge test -vvv
```

External review must additionally run fuzz/invariant campaigns, Slither or equivalent static analysis, compiler-known-bug review, gas and bytecode-size checks, fixed-block Ethereum fork tests, Universal Router/Permit2 quote-execution parity, native ETH and ERC-20 quote variants, multihop behavior, and CREATE2 preimage verification.

Every result must record the source commit and tree, dependency closure, tool versions, command, environment policy, fixture or block identity, seeds, exit status, and output digest. A skipped, local, or unauthenticated result is not a pass, audit, deployment receipt, or provider-support statement.
