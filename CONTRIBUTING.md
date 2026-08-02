# Contributing

There are two intentionally separate contribution paths.

## Application pull requests

Use the released Programmable v4 Builder. An application pull request changes exactly one generated six-file directory
under `submissions/<application-id>/`. Do not add project source, workflows, registry records, vendored code, or policy
changes. The complete project stays in the builder-controlled public repository bound by numeric repository id, commit,
tree, and evidence digests.

An intake pass proves only that the public record is structurally valid and bound to reachable source. It is not
acceptance, an audit, deployment approval, provider support, availability, or Uniswap endorsement.

## Registry maintenance

Maintainers use a separate pull request for schemas, project records, generated indexes, documentation, workflows,
tests, or the pinned Builder validation dependency. Run `npm test` and include the exact source evidence for every status
or deployment claim.

Never hand-edit generated indexes. Change a source project record, then run `npm run generate`. Existing history files
are append-only and must never be rewritten.

## Security

Do not publish an unpatched vulnerability, credential, wallet secret, private RPC, personal data, or exploit in a pull
request or issue. Follow [SECURITY.md](SECURITY.md).
