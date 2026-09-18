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
