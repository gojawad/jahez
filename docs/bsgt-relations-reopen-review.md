# BSGT Relations Signing Reopen - Limited Release

Date: 2026-09-20. User explicitly approved production SQL 59 and the limited UI release; full staging verification is deferred.

## Scope

- Admin-only return of a dispatched trade file to commercial relations for optional signing/stamping.
- SQL 59 is standalone after existing SQL 57. SQL 58 and Letters are excluded.
- Installation adds one guarded RPC and grants; it does not return files or rewrite existing records.
- UI lists every linked shipment and requires a reason before returning the whole file atomically.
- Keeps management approval, revision number, source data, existing signatures, operations revision pointers and QR tokens.
- Existing QR resolution continues using signed operations documents. Previously downloaded PDFs and documents already sent to a bank cannot change automatically; staff must retrieve the updated file and follow the normal resending procedure.
- Legacy files without approved operations revisions are rejected rather than silently rewritten.

## Changed Files

- `supabase/59_bsgt_reopen_relations_signing.sql`: admin/active-user checks, stale-state checks, file/shipment locks, complete before-state audit and atomic stage transition.
- `bsgt-revision-workflow.js`: admin return button, confirmation/reason form and refresh.
- `index.html`: relations render hook and script cache version only.
- `test/bsgt-relations-reopen-sql.cjs`: SQL security, repeat returns, CAD/collection flows and preservation tests.
- `test/bsgt-operations-revisions-sql.cjs`: runs the new SQL test suite.
- `test/bsgt-relations-browser.test.js`: visibility, cancel, required reason, RPC payload and post-return behavior.

## Verification

- SQL 57 regression + SQL 59 tests: passed (PGlite).
- Relations browser and finance CAD browser: passed (local browser fixtures).
- Internal documents, trade-file preview and QR signed package: 9 passed.
- Permissions: 44 passed. Smoke: 29 passed.
- JavaScript syntax, 2 inline scripts and git diff checks: passed.
- Initial browser assertion expected a UUID where the UI intentionally shows a shipment operation number; corrected the fixture assertion and reran successfully.
- Initial Windows smoke run failed a literal newline check; normalized index.html line endings without changing assertions and reran successfully.
- Production SQL editor reported successful SQL 59 installation. Read-only verification confirmed security-definer, anon execute denied, authenticated entry protected by the admin check and absence of the deferred correction RPC.
- Installed function compact-body MD5 matches local SQL: `316af8801cfb30b280938421294c7f3a` (only CRLF/LF differs).
- An initial editor paste produced a syntax error before installation; the successful installation used a fresh standalone editor.
- No real trade file was returned as a test. Full Supabase staging end-to-end verification remains deferred by explicit user approval.

## Isolation and Rollback

- Release baseline: `878813c995b70a855495a205fdb755e476bd9bcc`.
- Source backup: `E:/jahez-backups/relations-reopen-20260920/before-878813c.zip`.
- Isolated worktree: `E:/jahez-relations-reopen-release`; parallel worktrees were not staged or reverted.
- UI rollback: redeploy the baseline using the existing deployment workflow. The additive RPC can remain unused; revoke its authenticated execute permission separately if disabling it is necessary.
- Do not automatically reverse actual user return/signing actions during code rollback. Their prior file/shipment states are recorded in activity_log for controlled review.
