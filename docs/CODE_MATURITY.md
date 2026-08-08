# Code maturity assessment

Assessment date: 2026-08-08. Scale: 0 absent, 1 initial, 2 developing, 3 established, 4 strong. This is a maintainer
self-assessment, not an independent audit.

| Category | Score | Current evidence | Remaining gap |
| --- | ---: | --- | --- |
| Arithmetic and precision | 4 | Registry values use safe integers; the mandatory 10 bps identity is exact and tested | Economic correctness of submitted projects remains outside Registry arithmetic |
| Auditing and observability | 3 | Exact source, record hashes, immutable history, deterministic review receipts, CI receipts, and public review threads | No independent Apply audit yet |
| Authentication and access control | 3 | Candidate identity binds to GitHub's immutable user id; intake authority is read-only; protected `main` checks are enforced | Initial acceptance authority remains one maintainer |
| Complexity management | 3 | Closed schemas, bounded files, generated indexes, separate application and maintenance paths, and one small dependency-free public review engine | The vendored intake validator is intentionally large and needs continued differential testing |
| Decentralization and governance | 1 | Decisions are public and append-only | Initial acceptance authority is one maintainer; no independent quorum is established |
| Documentation | 4 | Architecture, discovery, open review rules, schemas, migration, contribution, support, and security contracts are explicit | Operational runbooks must stay synchronized with future website integration |
| Ordering and race resistance | 4 | PR merge parents, base/head commits, repository ids, trees, and stale-base behavior are bound and tested | External GitHub availability remains a dependency |
| Low-level and unsafe operations | 4 | Blobless bounded Git handling, disabled hooks/filters/submodules, byte/time/process limits, and no candidate execution under privileged CI | OS resource hard stops retain one Linux-only test path |
| Testing and verification | 4 | Deterministic registry and decision tests plus the complete trusted intake adversarial suite | Hidden mutation corpora, production runner evidence, and an independent penetration review remain outstanding |

The repository release has public CI and protected-main evidence. New application intake remains in prelaunch until a
matching Hookbuilder release targets this repository and an end-to-end application canary passes against the released
contract. Local green checks alone do not prove those external states.
