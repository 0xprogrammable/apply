# Review and promotion lifecycle

The public lifecycle is deliberately non-automatic.

| State | Evidence | Meaning |
| --- | --- | --- |
| Prepared | Local six-file package | No GitHub action occurred |
| Submitted | Draft application pull request | Public review thread exists |
| Intake passed | Trusted check is green | Package shape and exact public evidence passed known checks |
| Changes requested | GitHub review state | Builder must update the exact application revision |
| Accepted | Maintainer acceptance record | One exact source revision may be promoted |
| Deployed | Deployment evidence | Contracts or services were deployed; not automatically available |
| Available | Platform release evidence | Programmable currently exposes the project |
| Suspended or retired | Maintainer lifecycle record | Availability is intentionally restricted or ended |

An application merge does not synthesize an acceptance record. Promotion is a separate maintainer pull request that
adds an append-only acceptance record, updates or adds the full project record, advances the Registry history version,
and regenerates the indexes.

Acceptance is not an independent audit, deployment authorization, provider guarantee, Uniswap endorsement, or promise
of future availability. Those claims require their own attributable evidence.
