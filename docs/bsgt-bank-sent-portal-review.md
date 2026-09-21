# BSGT Bank-Sent Portal

## Approved Compact Layout Follow-up

On 2026-09-21 the user approved the compact-table mockup. The large cards were replaced with one semantic row per file, a compact heading/summary, and smaller filter spacing. Every filter remains. Client, bank, sending timestamp, document mode and revision remain visible; native expandable shipment cells retain every linked shipment number. Mobile reflows into dense labeled rows without horizontal overflow. The existing file-opening, latest-PDF, print/download and admin-return handlers are unchanged. No API, database, permissions or QR changes.

Source rollback archive: `E:/jahez-backups/relations-reopen-20260920/before-compact-table-8bb3159.zip`. Baseline: `8bb31592b21920c6ef3591114b394a9bc0ee2462`. The browser suite verifies ten table rows, compact desktop height, expanding two linked shipments, filters, 253-record server pagination, updated PDF and return flow; desktop/mobile screenshots are in `E:/jahez-backups/bank-sent-compact-review/`. Filters unit tests, smoke (29), permissions (44), and CAD browser regression passed. Assets have a new cache version for existing sessions after refresh.

Date: 2026-09-21. Scope: independent navigation and presentation of files currently sent to the collecting bank. No SQL, API, storage, invoice, document-generation or QR changes.

## Implementation

- Added `bankSent` to the existing workspace navigation. All existing sections remain, including the operation center. Direct hash route and reload use the existing router.
- Uses the existing `bsgt.relations.view` permission (including its legacy mapping); no new grants or permission expansion. Reopen remains SQL 59's active-admin-only operation.
- Moved the sent-file list out of the relations working queue into its own portal. Relations retains a navigation link and its existing internal hooks.
- Filter by collecting bank, linked shipment client, inclusive send-date range, and text search over file/shipment/invoice/bill numbers. Newest-first default and optional oldest-first ordering.
- Ten files per display page, page numbers, previous/next, result count, reset and refresh. Summary cards count filtered files, distinct shipments, banks and clients; no mixed-currency financial totals.
- Company-scoped, RLS-protected table reads, archive filtering and explicit selected columns. All authorized sent-file pages are read in batches of 250, with link/shipment ID batches of 50; no first-page-only filtering. On read failure the list reports the error rather than claiming a complete empty result.
- Existing relations detail, updated PDF, preview/print/download, event history and admin reopen flow are reused. Returning a file navigates to relations; it disappears from the current sent list. No file returns automatically.
- New styles are scoped to `#bsgtBankSent`, responsive, keyboard accessible and reduced-motion aware. Existing typography/brand colors are preserved.

## Tests

- Filter/order/summary unit tests, multi-client files, missing dates/data and pagination boundaries: passed.
- Workspace permission/router unit tests and full workspace browser suite: passed.
- Full relations browser workflow: passed, including direct-route reload, 13-file display pagination, combined filters, empty results, reset, 390px layout, updated signed PDF retrieval and admin return from the new tab.
- 253-file fixture: second server batch fetched; final record searchable. Failed refresh and successful retry verified. No stale list after failure.
- Finance CAD browser: passed. Smoke: 29 passed. Permissions: 44 passed.
- SQL 57/59 regression fixtures: passed (local PGlite, no production SQL executed).
- Internal document, preview, signature preservation and QR tests: 9 passed.
- JS syntax, two inline scripts, and diff whitespace checks: passed.
- Existing workspace browser count assertion initially expected seven tabs; updated to eight while asserting every original label remains. A new multi-record fixture initially made a single-element wait ambiguous; changed waits to the first card and reran successfully. No failing test was suppressed.
- Desktop/mobile screenshots reviewed from synthetic test data: `E:/jahez-backups/bank-sent-portal-review/`.

## Limits and Release Safety

- Client filters use current authorized shipment details, not a bank receipt or evidence of physical delivery. The status means the existing system recorded sending.
- Filters run over the complete authorized sent-file index in memory; fetching can become slower for very large histories. A future server-side joined search endpoint could optimize this without changing the UI contract. Failures are surfaced, never silently truncated.
- Baseline `c5f14713bd2f50b5f7759e1da72bab1e81161cca`; source backup `E:/jahez-backups/relations-reopen-20260920/before-bank-sent-portal-c5f1471.zip`.
- Isolated branch `codex/bank-sent-portal`. Parallel worktrees were not changed. Rollback is redeploying the baseline, with no data rollback or SQL required.
- User approved publishing after completion. Production verification checks deployment status, health commit and shipped assets; synthetic test files are never inserted into production.
