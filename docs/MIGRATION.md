# Legacy intake migration

The version 1 review schemas retain their original `0xprogrammable/apply` schema identifiers for backward compatibility. These identifiers are stable protocol names, not the current repository location. New repository links and intake records use `0xprogrammable/submit-launch`. A future schema identifier change requires a new schema version and explicit migration coverage.

Submit a Launch 1.3.0 activates the stable Hookbuilder 0.4.2 bridge. The bridge preserves Submission 1.5.0 and intake
status schema 2 while binding the canonical `0xprogrammable/submit-launch` repository and numeric repository ID.

Application pull request `0xprogrammable/programmable#62` remains on its original review thread. It is recorded in
`registry/config.json` as a continuing legacy pull request and is never silently copied, renumbered, closed, or claimed
as accepted. A Builder status client may read that original thread with the Builder version that created it.

Hookbuilder application pull requests `#10`, `#11`, `#12`, `#14`, `#15`, `#18`, `#19`, and `#20` also remain on their
original Hookbuilder review threads. They are recorded as legacy intake and are never copied or renumbered here.

The activation is valid only while all of the following remain true:

1. this repository is public at the exact tested commit;
2. the protected branch requires `Node 20`, `Node 22`, and `public-intake` before merge;
3. released Hookbuilder 0.4.2 targets `0xprogrammable/submit-launch` with Submission 1.5.0;
4. the vendored intake validator and receipt match that exact Builder release; and
5. `docs/builder/intake-status.json` and `registry/config.json` both report `open`.

If that binding fails, intake must return to a closed state. Existing legacy review threads remain untouched.
