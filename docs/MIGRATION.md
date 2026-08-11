# Legacy intake migration

The first Submit a Launch release starts in `prelaunch`. The released Hookbuilder continues to use its existing central target
until a matching Hookbuilder release activates this repository.

Application pull request `0xprogrammable/programmable#62` remains on its original review thread. It is recorded in
`registry/config.json` as a continuing legacy pull request and is never silently copied, renumbered, closed, or claimed
as accepted. A Builder status client may read that original thread with the Builder version that created it.

Activation requires all of the following:

1. this repository is public at the exact tested commit;
2. the protected branch requires `Node 20`, `Node 22`, and `public-intake` before merge;
3. a released Hookbuilder version targets `0xprogrammable/submit-launch`;
4. the vendored intake validator matches that Builder's application contract; and
5. `docs/builder/intake-status.json` and `registry/config.json` are changed together from `prelaunch` to `open`.

If activation fails, intake stays closed and existing legacy review threads remain untouched.
