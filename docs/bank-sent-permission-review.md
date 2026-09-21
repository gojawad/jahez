# Bank-Sent Portal Permission Review

Date: 2026-09-21. Base: dbb82c626cd4690b008575cedfab74a757fbd534.
Status: SQL 60 applied successfully to the live database on 2026-09-21 following
explicit user approval. Frontend deployment verification is pending. No employee
permission assignment has been performed for this change.

## Scope

- Add `bsgt.bank_sent.view` to the existing employee permission editor.
- It is not included in employee presets, legacy relations fallback, or dependency
  grants. Administrators retain their existing full access.
- The bank-sent tab and relations-page shortcut require this independent key.
- A reader can filter, inspect and preview/print/download sent-file documents using
  the existing UI. No new edit, signing, dispatch, archive or reopen permission.
- SQL 60 adds a catalog entry and SELECT-only RLS policies. Its definer helpers
  validate the active authenticated employee, feature permission, BSGT company,
  sent status and non-archived trade file. Related shipment access requires a link.
- Approved operations revisions must be linked to a permitted sent file. Storage
  reads require registered paths in that file; there is no client-asset bucket grant.
- Extend only the existing `bsgt_internal_package` read gate with file-scoped access;
  fail transactionally if its installed definition is not recognized. Existing API
  preview requests continue using the caller JWT, including Storage downloads.
- Other previously granted roles/permissions retain their existing data scope.
  Removing this checkbox does not revoke data access separately granted by finance,
  management or relations permissions. It removes this independent portal access.

## Changed Files

- `permissions.js`: independent read permission, picked up by the existing editor.
- `bsgt-workspace.js`: independent tab authorization, no relations fallback.
- `index.html`: guarded shortcut and cache-version updates for changed scripts.
- `supabase/60_bsgt_bank_sent_permission.sql`: additive catalog/RLS/read-RPC changes.
- Tests: workspace helpers, permissions helpers, permissions browser, relations
  browser, operations SQL runner and new bank-sent permission SQL suite.

## Verification

Passed locally:

- JavaScript syntax, including both inline index scripts; `git diff --check`.
- `test/permissions.test.js`: 45 checks.
- `test/permissions-browser.test.js`: admin assigns new checkbox while retaining
  existing assignment; no unintended relations dependency; viewer boundary.
- `test/bsgt-workspace.test.js` and `test/bsgt-workspace-browser.test.js`.
- `test/bsgt-bank-sent.test.js`: filters, ordering, page boundaries, multi-client files.
- `test/bsgt-relations-browser.test.js`: bank-sent-only reader, direct route,
  full updated PDF preview, no signing/send/reopen, permission revocation; existing
  relations signing, admin return, pagination and compact layout regression.
- `test/bsgt-operations-revisions-sql.cjs`: existing 43-59 workflow tests plus 60
  applied twice without data/grant changes. Uses the actual feature helper and
  permission-save RPC, authenticated RLS, RPC denial, registered Storage reads,
  blocked arbitrary/client-asset objects, read-only enforcement, denied drafts,
  returned/archived/other-company files, revocation and inactive users.
- `test/bsgt-finance-cad-browser.test.js`.
- `test/smoke.test.js`: 29 checks.
- Internal documents, trade-file preview and QR signed-package API tests: 9 passed.
- `test/employee-dashboard-browser.test.js`: all five roles passed.

Known failure, not suppressed or modified:

- `test/employee-dashboard.test.js` fails its old static regex expecting
  `sb.from('shipments').select('*').order('updated_at'...)`. The same assertion
  fails against `git show HEAD:index.html` at the unchanged base commit. This is
  separate from the bank-sent permission change; browser dashboard tests pass.
- An initial new permissions-browser assertion raced with the existing editor's
  post-save rerender/collapse. The test now waits for that state and reopens the
  permission panel; the rerun passes without changing application behavior.

## Activation and Rollback

Source backup (created before editing):
`E:/jahez-backups/relations-reopen-20260920/before-bank-sent-permissions-dbb82c6.zip`.

1. Obtain explicit approval before running SQL 60 on a live database or deploying.
2. Prefer a staging run with real Supabase JWT/PostgREST/Storage before production.
   PGlite and mocked browser/API tests do not substitute for live integration.
3. Before SQL, save the installed `pg_get_functiondef` for
   `public.bsgt_internal_package(uuid)`, current `pg_policies` on affected tables,
   and the feature catalog/employee assignment rows in a secure database backup.
4. Apply only SQL 60 after verifying prerequisites 39, 43-45 and 50. No SQL 58 or
   Letters migrations are needed. SQL 60 is transactional, idempotent, does not
   rewrite business data and assigns no employees automatically.
5. Deploy the scoped frontend change. In employee management, select the employee,
   open permissions, enable the new bank-sent view permission under BSGT and save.
   Have the employee reload/sign in again to refresh the existing permission cache.
6. Verify an authorized read-only employee can open sent files and print PDFs, and
   an unassigned employee cannot enter the portal or use the new data scope.

Rollback, if required: restore the saved read-RPC definition, remove only the nine
new `bank_sent_*_read` SELECT policies, then remove the two new helper functions.
Keep employee assignment/catalog records for audit rather than deleting them.
Restore only the three changed frontend files from the identified release backup
through normal reviewed deployment. Do not reset the worktree, rewrite business
records, revert unrelated work or apply SQL 58. Restoring the old frontend also
restores its previous automatic relations-to-bank-sent tab visibility.

No existing signature, QR, file order, workflow stage or storage object was changed.

## Production Activation

- The user explicitly approved SQL 60 and deployment after the local test report.
- Saved the installed read-RPC definition, 59 existing policies and assignment
  baseline in `E:/jahez-backups/relations-reopen-20260920/before-sql60-production-20260921.csv`.
  Baseline: 10 trade files, 44 shipments, 87 permission rows, no new-key assignments.
- Supabase SQL Editor reported `Success. No rows returned` for the SQL 60 transaction.
- Post-apply verification: 9 new SELECT-only policies, catalog key and patched RPC
  present, anonymous helper execution denied, all 59 old policies unchanged;
  counts remain 10 trade files, 44 shipments and 87 employee permission rows.
  New-key employee assignments remain zero.
- Re-ran the operations/59/60 SQL suites, permissions (45), workspace helpers and
  smoke (29) before deployment; all passed.
- Live inspection also found the pre-existing `shipmentfiles_read` Storage policy
  permits active users to read the `shipment-files` bucket. SQL 60 does not create
  or broaden that rule, and it is deliberately not changed in this scoped release.
  The local isolated new-scope tests do not prove that older broad Storage grants
  are absent in production. Tightening that legacy rule is a separate security
  workstream requiring regression review and approval.
- No real employee account was granted access for testing; post-assignment live
  employee JWT/Storage testing remains necessary for the selected accounts.
