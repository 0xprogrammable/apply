# Acceptance records

An acceptance record is written only by a Programmable maintainer after review. It binds the exact application PR,
application revision, package digest, public source repository id, commit, tree, conditions, and promoted project
record. Passing CI or merging an application record does not create this decision automatically.

Records are append-only. Suspension, retirement, or supersession uses a later maintainer record and never rewrites the
historical acceptance.
