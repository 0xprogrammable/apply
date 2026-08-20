# Test plan

Applicant-supplied local evidence was rerun from the exact source commit and tree bound by this revision.

- Pinned npm and Git dependencies were materialized, then Forge formatting and the offline multi-compiler build passed with Solidity 0.8.26 and 0.8.17.
- Six focused launch and fee-quadrant tests passed.
- Eight local simulated Universal Router quote and execution quadrant tests passed; these are not fork evidence.
- The specified-native partial-fill rejection test passed and verified that fee accounting and pool state do not persist after the wrapped revert.
- Four math tests passed with 2,000 fuzz runs for each fuzz target.
- Two accounting invariants passed with 256 runs, 16,384 calls per invariant and zero reverts.
- The model manifest passed and Submission V2 validated as REVIEW_REQUIRED.

All results remain applicant-supplied and independently unverified. No RPC fork, chain deployment, transaction, signature, approval or production action was performed.
