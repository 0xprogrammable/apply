# Contributing

There are three intentionally separate contribution paths. Keep each pull request to one path.

## Application pull requests

Use the released [Hookbuilder](https://github.com/0xprogrammable/hookbuilder). An application pull request changes
exactly one generated six-file directory
under `submissions/<application-id>/`. Do not add project source, workflows, registry records, vendored code, or policy
changes. The complete project stays in the applicant-owned public repository bound by numeric repository id, commit,
tree, and evidence digests.

An intake pass proves only that the public record is structurally valid and bound to reachable source. It is not
acceptance, an audit, deployment approval, provider support, availability, or Uniswap endorsement.

## Apply repository maintenance

Maintainers use a separate pull request for schemas, project records, generated indexes, documentation, workflows,
tests, or the pinned Builder validation dependency. Run `npm test` and include the exact source evidence for every status
or deployment claim.

Never hand-edit generated indexes. Change a source project record, then run `npm run generate`. Existing history files
are append-only and must never be rewritten.

## Review standard maintenance

Changes to `review/`, its schemas or its decision semantics require a separate maintainer pull request, public regression
fixtures for both unusual legitimate behavior and proven failures, and a version change when existing inputs could
receive a different decision. A model score or private assertion is never sufficient test evidence.

## Security

Do not publish an unpatched vulnerability, credential, wallet secret, private RPC, personal data, or exploit in a pull
request or issue. Follow [SECURITY.md](SECURITY.md).
