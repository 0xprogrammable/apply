# Review and promotion lifecycle

The public lifecycle separates deterministic review from launch authority. The current public policy and preview engine
are documented in [Open Review Standard v1](OPEN_REVIEW_STANDARD.md).

| State | Evidence | Meaning |
| --- | --- | --- |
| Prepared | Local six-file package | No GitHub action occurred |
| Submitted | Draft application pull request | Public review thread exists |
| Intake passed | Trusted check is green | Package shape and exact public evidence passed known checks |
| Changes requested | GitHub review state | Builder must update the exact application revision |
| Review ready | Public checker decision | Critical evidence is closed for one exact revision; no launch right exists yet |
| Accepted | Maintainer acceptance record | One exact source revision may be promoted |
| Deployed | Deployment evidence | Contracts or services were deployed; not automatically available |
| Available | Platform release evidence | Programmable currently exposes the project |
| Suspended or retired | Maintainer lifecycle record | Availability is intentionally restricted or ended |

An application merge does not synthesize an acceptance record. For the current six-file application contract, an
accepted exact revision can instead be compiled into the separate, signed
[launch-entitlement bridge v1](ACCEPTANCE_ENTITLEMENT_BRIDGE_V1.md). That envelope still does not issue a launch
permit, deploy code, or publish a Registry record. Registry promotion remains a separate maintainer action after
finalized launch evidence exists.

Acceptance is not an independent audit, deployment authorization, provider guarantee, Uniswap endorsement, or promise
of future availability. Those claims require their own attributable evidence.
