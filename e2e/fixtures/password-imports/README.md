# Password import fixtures

Synthetic CSV exports in the native format of each vendor's password
manager, for exercising the importer's parser branches in e2e tests.

Derived from real exports (one of each vendor) with every piece of PII
scrubbed:

- Real emails and personal identifiers replaced with `test*@example.com`
  and `testuser-*`.
- Real names replaced with `Test User`.
- Vendor GUIDs replaced with zero-padded synthetic UUIDs.
- The 1Password CSV's recovery-key note replaced with a placeholder.
- The Firefox Accounts `scopedKeys` JSON blob replaced with non-real
  key material (so the row still exercises the "skip chrome:// URL"
  branch without shipping live key material).

Row counts and format quirks (trailing commas, unquoted vs. quoted,
Firefox's outer double-quotes everywhere) are preserved so the parsers
hit the same edge cases they would on real exports.

Do not commit real exports — the originals live in
`/Users/davidneto/keykeykey/passwords/` on the author's machine and are
ignored.
