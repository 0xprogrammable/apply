# Code maturity assessment

Assessment date: 2026-08-02. Scale: 0 absent, 1 initial, 2 developing, 3 established, 4 strong. This is a maintainer
self-assessment, not an independent audit.

| Category | Score | Current evidence | Remaining gap |
| --- | ---: | --- | --- |
| Arithmetic and precision | 4 | Registry values use safe integers; the mandatory 10 bps identity is exact and tested | Economic correctness of submitted projects remains outside Registry arithmetic |
| Auditing and observability | 3 | Exact source, record hashes, immutable history, CI receipts, and public review threads | No independent Registry audit yet |
| Authentication and access control | 3 | Candidate identity binds to GitHub's immutable user id; intake authority is read-only | Remote branch protection must be verified after publication |
| Complexity management | 3 | Closed schemas, bounded files, generated indexes, separate application and maintenance paths | The vendored intake validator is intentionally large and needs continued differential testing |
| Decentralization and governance | 1 | Decisions are public and append-only | Initial acceptance authority is one maintainer; no independent quorum is established |
| Documentation | 4 | Architecture, discovery, review, migration, contribution, support, and security contracts are explicit | Operational runbooks must stay synchronized with future website integration |
| Ordering and race resistance | 4 | PR merge parents, base/head commits, repository ids, trees, and stale-base behavior are bound and tested | External GitHub availability remains a dependency |
| Low-level and unsafe operations | 4 | Blobless bounded Git handling, disabled hooks/filters/submodules, byte/time/process limits, and no candidate execution under privileged CI | OS resource hard stops retain one Linux-only test path |
| Testing and verification | 4 | Deterministic registry tests plus the complete trusted intake adversarial suite | Model-backed agent evals and an independent penetration review remain outstanding |

The practical release blockers are remote CI proof, protected-main enforcement, fresh-clone verification, and the
matching Builder activation. Local green checks alone do not prove those external states.
