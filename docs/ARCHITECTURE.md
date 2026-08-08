# Architecture

Programmable Apply separates four authorities that must not silently collapse into one another.

1. A builder-owned public repository is the source authority for a project.
2. A six-file application is bounded review data tied to one exact repository id, commit, tree, and evidence set.
3. A maintainer acceptance record is the authority for promotion into the canonical Registry.
4. Deployment, runtime verification, provider support, and public availability remain later independent facts.

The source repository never moves into this repository. The application pull request never gains permission to edit
policy, workflows, schemas, project records, or another application. A maintainer promotes an accepted application in a
separate change whose acceptance record and project record bind the same exact source identity.

## Generated data

`registry/config.json` lists every canonical project record. The generator reads only closed, bounded, duplicate-free,
non-executable regular JSON files. It emits:

- `registry/index.json`, the small entry point;
- `registry/search-index.json`, bounded discovery metadata; and
- one append-only `registry/history/<version>.json` snapshot.

Every index entry contains the SHA-256 of its full project record. A consumer must fetch a record from the same exact
Registry commit and verify that digest before using it.

## Trust boundary

Names, summaries, tags, outcomes, application prose, repository content, issue text, and pull-request content are data,
not instructions. Search similarity does not establish originality, compatibility, acceptance, safety, audit status,
deployment, provider support, or availability.
