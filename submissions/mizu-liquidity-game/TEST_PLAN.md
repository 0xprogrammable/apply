# Test plan

Candidate code was not executed by the portable Builder. A secret-free isolated local developer check ran formatting, 7 JavaScript tests, 31 Foundry tests including fuzz/invariants, and bytecode-size reporting successfully. Those results are local development evidence only; an independently configured sandbox must reproduce and bind results to the exact source commit.

Declared checks cover flat buys, bounded size-aware sells, 2-hour/24-hour decay, depth/capacity units, split equivalence, Fee V2 remainders, all four swap quadrants, stale witnesses, partial fills, callback authentication, exact-code protocol-owner provenance, treasury-only price/deadline-bounded compounding, permanent-liquidity accounting and fee allocation.

External review must add:

- fuzzing around zero depth, capacity fractions, approximation branches, `int128` bounds and fee remainders;
- stateful same-block splits, waits, buys/sells, JIT liquidity, price movement, claims and compounds;
- both quote orientations, native ETH, full-range tick crossing and flash/JIT attacks;
- proof that no callable path decreases/transfers protocol principal and no unrecorded protocol owner can enter the factory path;
- MIZU/quote solvency and unmatched-balance behavior;
- Universal Router/Permit2 quote-execution parity, multihop, gas/size, static analysis and fixed-block Ethereum fork tests;
- both CREATE2 preimages, exact-code POL provenance, immutable bindings and runtime configuration receipts.

Required external commands remain fresh-install format/build/unit/fuzz/invariant/static-analysis runs. A skipped, local or unauthenticated result is not a pass, audit or deployment receipt.
