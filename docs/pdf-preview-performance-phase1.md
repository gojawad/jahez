# PDF Preview Performance - Phase 1

Date: 2026-09-21. User authorized deployment after reviewing local results.
Deployment completion is recorded separately in the release receipt.

## Scope and rollback

- Starting commit: `715eb015a057b375404fc6fe0141cfc301b923cb`.
- Before release, fast-forwarded to the already-live financial-center update
  `18a7096d4c96e0fc2d959d5bf8698e5fb9cf0619`. No overlapping files; its changes
  are retained unchanged. Immediate pre-release source archive:
  `E:/jahez-backups/relations-reopen-20260920/before-pdf-preview-release-18a7096.zip`.
- Clean-worktree source archive created before changes:
  `E:/jahez-backups/relations-reopen-20260920/before-pdf-preview-715eb01.zip`.
- No migration, database writes, Storage writes, permission changes or changes to
  the public QR handlers, original documents, signing logic, templates or UI.
- Runtime fallback: set `BSGT_PREVIEW_OPTIMIZATIONS=0` and restart the application.
  This bypasses the merge cache and downloads sequentially. Existing authorization
  and size limits remain enforced. Source rollback should be a scoped reverse
  patch/revert of these changes only, never a worktree reset.

## Changes

- `api/bsgt-trade-file-bundle.js`: download batches of at most three documents,
  retain source order regardless of completion order, and reuse merged PDF output
  only when the authenticated scope, metadata and every source content hash match.
- `api/bsgt-preview-cache.js`: process-local LRU output cache, two-minute validity,
  16 entries, 32 MiB total PDF bytes, 8 MiB maximum per cached PDF. No tokens are
  stored. Expired entries are pruned on the next cache access. Restart clears it.
- `api/bsgt-trade-file-preview.js`: scope cache keys using a hash of the Supabase
  endpoint and caller authorization; enforce a shared 64 MiB streamed download
  budget across parallel requests, in addition to the existing bundle limits.
- `test/bsgt-preview-cache.test.js`: cache bounds, expiry, buffer isolation,
  bounded concurrency, ordering, failures, invalidation and synthetic timing.
- `test/bsgt-trade-file-preview.test.js`: warm-cache authorization regression.

## Security and freshness

Every request still reads current records through RLS and downloads every selected
source with the caller JWT. A cached PDF is never a fallback for denied Storage,
missing metadata, corrupt input or a failed download. The API still responds with
`Cache-Control: no-store`. Content changes at an unchanged path invalidate reuse,
as do signature/revision/source selection changes. Current mode substitutes signed
copies in place; historical mode retains its existing layout. Both keep the
existing source deduplication and 500-page limit.

Freshness is checked when opening/reopening a preview; an already-open PDF is not
live-reloaded. Concurrent edits during a request retain the existing snapshot/race
limitations. This change does not introduce transactional cross-file reads.

## Verification

Commands use `NODE_PATH=E:/jahez/node_modules` where needed.

- Syntax checks on all five changed/new JavaScript files: passed.
- `git diff --check`: passed (Git reports existing LF/CRLF conversion warnings).
- `node --test test/bsgt-preview-cache.test.js test/bsgt-trade-file-preview.test.js test/bsgt-internal-documents.test.js test/qr-signed-package.test.js`:
  14 passed, 0 failed.
- `node test/smoke.test.js`: 29 passed, including real Chromium PDF generation,
  QR route, protected API and static-file boundaries.
- `node test/permissions.test.js`: 45 passed.
- `node test/bsgt-relations-browser.test.js`: passed.
- `node test/bsgt-workspace-browser.test.js`: passed.
- `node test/bsgt-finance-cad-browser.test.js`: passed.
- `node test/bsgt-bank-sent.test.js`: passed.
- `node test/employee-dashboard-browser.test.js`: all five roles passed (admin,
  editor, staff, viewer and BSGT user).

Release recheck after integrating the already-live `18a7096`:
- All 14 preview/signing/QR tests and 45 permission checks passed again.
- Financial ledger Phase 2 browser test passed.
- Raw smoke run failed its literal LF-only login-code string assertion because
  the upstream `index.html` contains CRLF (including in the Git archive). A
  disposable archive-based verification copy with only line endings normalized
  passed all 29 smoke checks. Neither production HTML nor the smoke test was
  changed to work around this unrelated formatting-sensitive assertion.

An initial new test incorrectly expected deduplication across different buckets
with the same path. The assertion was corrected: those are distinct source files.
Production deduplication logic was not changed. The final suite passes.

Synthetic benchmark: six one-page PDFs, mocked 40 ms latency per download:
sequential 245 ms, parallel cold 90 ms, parallel warm 85 ms in one local run.
These are illustrative numbers, not a production latency guarantee. No live
customer document was used for the benchmark.

## Remaining limits / next verification

- This first phase caches merging work, not source downloads. It does not reduce
  Storage download bandwidth, remove Base64 transport, parallelize shipments in
  the browser, or lazy-render PDF pages. The large main HTML is unchanged.
- Real performance depends on Storage latency, document sizes and server load.
  PDF parsing/serialization still uses CPU; up to 64 MiB of source bytes may be
  retained per request, plus parsed PDF objects, response and cache memory.
  Multiple simultaneous users multiply per-request cost. Cache budget is per
  server process, not a global cluster limit. Large results skip caching.
- Before/after real-world measurements and a large-document/concurrent-user load
  check remain necessary before claiming production gains.
- API permission tests use mocks; no Supabase policy was changed or migration run.
- Before publishing, obtain approval, then verify an authorized full preview,
  signature update followed by reopen, unchanged QR content, and unauthorized
  access denial on the deployed service. Do not change source documents to test.
