# Legacy intake migration

The first Registry release starts in `prelaunch`. The released Builder continues to use its existing central target
until a matching Builder release activates this repository.

Application pull request `0xprogrammable/programmable#62` remains on its original review thread. It is recorded in
`registry/config.json` as a continuing legacy pull request and is never silently copied, renumbered, closed, or claimed
as accepted. A Builder status client may read that original thread with the Builder version that created it.

Activation requires all of the following:

1. this repository is public at the exact tested commit;
2. protected-branch checks are enforced;
3. a released Builder version targets `0xprogrammable/programmable-registry`;
4. the vendored intake validator matches that Builder's application contract; and
5. `docs/builder/intake-status.json` and `registry/config.json` are changed together from `prelaunch` to `open`.

If activation fails, intake stays closed and existing legacy review threads remain untouched.
