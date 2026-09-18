'use strict';
// Rebuilds the approved operations package for the public QR link, swapping in
// the administration-signed version of each operations document when one
// exists. Finance (collection) documents are confidential and are never part of
// the QR output, whatever variant they carry.
const { PDFDocument } = require('../experiments/bs-collection/collection-pdf-lib');

const CONFIDENTIAL_KINDS = new Set(['letter', 'undertaking', 'exchange']);
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_PAGES = 500;

function pickSignedRows(rows, { shipmentId, revisionId, revisionNo }) {
  return (rows || []).filter(row =>
    row && row.is_active !== false &&
    row.document_variant === 'administration_signed' &&
    row.shipment_id === shipmentId &&
    row.operations_revision_id === revisionId &&
    (revisionNo == null || Number(row.revision_no) === Number(revisionNo)) &&
    !CONFIDENTIAL_KINDS.has(String(row.document_type || '')) &&
    typeof row.source_document_path === 'string' && typeof row.storage_path === 'string' &&
    !row.storage_path.includes('..')
  );
}

// documents: revision.documents ([{kind,path,...}] in package order).
// download(bucket, path) -> Buffer.
async function buildSignedOperationsPackage({ documents, signedRows, download }) {
  const ordered = Array.isArray(documents) ? documents.filter(doc => doc && typeof doc.path === 'string') : [];
  const bySource = new Map();
  for (const row of signedRows || []) {
    const previous = bySource.get(row.source_document_path);
    if (!previous || String(row.created_at || '') > String(previous.created_at || '')) bySource.set(row.source_document_path, row);
  }
  const substituted = ordered.filter(doc => bySource.has(doc.path) && !CONFIDENTIAL_KINDS.has(String(doc.kind || '')));
  if (!substituted.length) return null;

  const merged = await PDFDocument.create();
  let totalBytes = 0;
  for (const doc of ordered) {
    if (CONFIDENTIAL_KINDS.has(String(doc.kind || ''))) continue;
    const signed = bySource.get(doc.path);
    const source = signed ? { bucket: 'trade-collection-documents', path: signed.storage_path } : { bucket: 'bsgt-operations-packages', path: doc.path };
    const bytes = await download(source.bucket, source.path);
    totalBytes += bytes.length;
    if (totalBytes > MAX_BYTES) throw new Error('Signed package too large');
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error(`Document ${doc.kind} is not a PDF`);
    const pdf = await PDFDocument.load(bytes);
    if (!pdf.getPageCount()) throw new Error(`Document ${doc.kind} is empty`);
    for (const page of await merged.copyPages(pdf, pdf.getPageIndices())) merged.addPage(page);
    if (merged.getPageCount() > MAX_PAGES) throw new Error('Signed package has too many pages');
  }
  return { bytes: Buffer.from(await merged.save()), signedKinds: substituted.map(doc => doc.kind), pageCount: merged.getPageCount() };
}

module.exports = { buildSignedOperationsPackage, pickSignedRows, CONFIDENTIAL_KINDS };

// Trade-file states whose signatures are current. Draft/returned files start a
// new review revision, so their older signatures stay out until re-signed.
const SIGNED_FILE_STATUSES = ['under_management_review', 'final_accepted', 'sent_to_collecting'];

// Small in-memory cache of rebuilt packages. Entries are keyed by the exact set
// of signed document rows, so a new signature or a new revision produces a new
// key and the old entry simply ages out. Nothing is persisted.
const CACHE_MAX_ENTRIES = 40;
const CACHE_MAX_BYTES = 96 * 1024 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const packageCache = new Map();
let packageCacheBytes = 0;
function cacheGet(key) {
  const entry = packageCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) { packageCache.delete(key); packageCacheBytes -= entry.value.bytes.length; return null; }
  packageCache.delete(key); packageCache.set(key, entry); // refresh LRU order
  return entry.value;
}
function cacheSet(key, value) {
  if (!value || !value.bytes || value.bytes.length > CACHE_MAX_BYTES / 4) return value;
  if (packageCache.has(key)) packageCacheBytes -= packageCache.get(key).value.bytes.length;
  packageCache.set(key, { value, at: Date.now() }); packageCacheBytes += value.bytes.length;
  while (packageCache.size > CACHE_MAX_ENTRIES || packageCacheBytes > CACHE_MAX_BYTES) {
    const [oldest, entry] = packageCache.entries().next().value;
    packageCache.delete(oldest); packageCacheBytes -= entry.value.bytes.length;
  }
  return value;
}
function clearPackageCache() { packageCache.clear(); packageCacheBytes = 0; }

// Shared resolver: finds the newest active administration signatures for the
// shipment's approved revision and returns the rebuilt package, or null.
// restRows(pathAndQuery) -> rows (service role); download(bucket, path) -> Buffer.
async function resolveSignedOperationsPackage({ shipmentId, revision, restRows, download }) {
  if (!revision || !Array.isArray(revision.documents) || !revision.documents.length) return null;
  const links = await restRows(`trade_collection_file_shipments?${new URLSearchParams({
    select: 'trade_file_id', shipment_id: `eq.${shipmentId}`, operations_revision_id: `eq.${revision.id}`
  })}`);
  const fileIds = [...new Set(links.map(link => link.trade_file_id).filter(Boolean))];
  if (!fileIds.length) return null;
  const files = await restRows(`trade_collection_files?${new URLSearchParams({
    select: 'id,revision_no,status,created_at', id: `in.(${fileIds.join(',')})`,
    status: `in.(${SIGNED_FILE_STATUSES.join(',')})`, order: 'created_at.desc', limit: '1'
  })}`);
  const file = files[0];
  if (!file) return null;
  const rows = await restRows(`trade_collection_file_documents?${new URLSearchParams({
    select: 'id,document_type,document_variant,storage_path,source_document_path,shipment_id,operations_revision_id,revision_no,is_active,created_at',
    trade_file_id: `eq.${file.id}`, revision_no: `eq.${file.revision_no}`, document_variant: 'eq.administration_signed',
    shipment_id: `eq.${shipmentId}`, is_active: 'eq.true'
  })}`);
  const signedRows = pickSignedRows(rows, { shipmentId, revisionId: revision.id, revisionNo: file.revision_no });
  if (!signedRows.length) return null;
  const key = `${shipmentId}|${revision.id}|${file.id}|${file.revision_no}|${signedRows.map(row => `${row.id}:${row.storage_path}`).sort().join(',')}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };
  return cacheSet(key, await buildSignedOperationsPackage({ documents: revision.documents, signedRows, download }));
}

module.exports.resolveSignedOperationsPackage = resolveSignedOperationsPackage;
module.exports.clearPackageCache = clearPackageCache;
module.exports.SIGNED_FILE_STATUSES = SIGNED_FILE_STATUSES;
