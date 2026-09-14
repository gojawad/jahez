'use strict';

const { randomUUID } = require('node:crypto');
const { PDFDocument } = require('../experiments/bs-collection/collection-pdf-lib.js');
const BUCKET = 'bsgt-operations-packages';
const GENERATED = Object.freeze(['contract', 'proforma', 'invoice', 'packing']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 64 * 1024 * 1024;

async function readBody(req) {
  if (req.body) {
    const text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(text) > MAX_BODY) throw new Error('Package request too large');
    return JSON.parse(text);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY) throw new Error('Package request too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function serviceHeaders(key) {
  return { apikey: key, ...(!key.startsWith('sb_secret_') ? { Authorization: `Bearer ${key}` } : {}) };
}

async function asPdf(bytes, mime) {
  if (bytes.subarray(0, 5).toString() === '%PDF-') {
    const document = await PDFDocument.load(bytes);
    if (!document.getPageCount()) throw new Error('Empty operations PDF');
    return bytes;
  }
  const document = await PDFDocument.create();
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216;
  if (!png && !jpeg) throw new Error(`Unsupported operations attachment: ${mime || 'unknown'}`);
  const image = png ? await document.embedPng(bytes) : await document.embedJpg(bytes);
  const page = document.addPage([595.28, 841.89]);
  const scale = Math.min(555.28 / image.width, 801.89 / image.height);
  const width = image.width * scale, height = image.height * scale;
  page.drawImage(image, { x: (595.28-width)/2, y: (841.89-height)/2, width, height });
  return Buffer.from(await document.save());
}

// Generated operations PDFs come from the existing templates. Uploaded sources
// and the merge order come exclusively from the authorized server snapshot.
async function buildPackage(input, generated, download, store, revisionId) {
  const kinds = Object.keys(input.generated).sort();
  if (JSON.stringify(kinds) !== JSON.stringify([...GENERATED].sort()) ||
      JSON.stringify(Object.keys(generated || {}).sort()) !== JSON.stringify(kinds)) {
    throw new Error('Unexpected generated document scope');
  }
  const folder = `${input.shipment.id}/${revisionId}`;
  const merged = await PDFDocument.create();
  const documents = [];
  async function append(kind, bytes, sourceId = null) {
    const pdf = await asPdf(bytes);
    const source = await PDFDocument.load(pdf);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach(page => merged.addPage(page));
    const path = `${folder}/${kind}.pdf`;
    await store(path, pdf);
    documents.push({ kind, sourceId, path, name: `${kind}.pdf`, source: 'operations' });
  }
  for (const kind of GENERATED) {
    const encoded = generated[kind];
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid generated PDF');
    const pdf = Buffer.from(encoded, 'base64');
    if (pdf.subarray(0,5).toString() !== '%PDF-') throw new Error('Generated document must be PDF');
    await append(kind, pdf);
  }
  const allowedUploads = new Set(['import_permit', 'certificate_of_origin', 'bill_of_lading']);
  for (const file of input.files) {
    if (!allowedUploads.delete(file.kind)) throw new Error('Unexpected uploaded document scope');
    await append(file.kind, await download(file.path), file.id);
  }
  if (allowedUploads.size) throw new Error('Missing required operations attachments');
  const packagePath = `${folder}/package.pdf`;
  await store(packagePath, Buffer.from(await merged.save()));
  return { documents, packagePath };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const base = (process.env.SUPABASE_URL || 'https://vthcmqqiexaedukduquv.supabase.co').replace(/\/$/, '');
  if (!key) return res.status(503).json({ error: 'Package service is not configured' });
  const authorization = String(req.headers.authorization || '');
  if (!/^Bearer [^\s]+$/.test(authorization)) return res.status(401).json({ error: 'Authentication required' });
  const headers = { apikey: key, Authorization: authorization, 'Content-Type': 'application/json' };
  const service = serviceHeaders(key);
  async function jsonRequest(path, options) {
    const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Package operation failed (${response.status}): ${(await response.text()).slice(0,300)}`);
    return response.json();
  }
  try {
    const user = await jsonRequest('/auth/v1/user', { headers });
    const { shipmentId, fingerprint, generated, language = 'en' } = await readBody(req);
    if (!['ar','en'].includes(language)) throw new Error('Invalid package language');
    if (!UUID.test(shipmentId || '') || !/^[a-f0-9]{32}$/.test(fingerprint || '')) throw new Error('Invalid shipment snapshot');
    const input = await jsonRequest('/rest/v1/rpc/bsgt_operations_package_input', {
      method: 'POST', headers, body: JSON.stringify({ p_shipment_id: shipmentId })
    });
    if (input.workflowVersion !== 2) throw new Error('Separate merge/send migration 47 is required');
    if (input.fingerprint !== fingerprint) throw new Error('Shipment changed. Reload and merge again.');
    const revisionId = randomUUID();
    const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
    const download = async path => {
      if (!path || path.includes('..')) throw new Error('Invalid operations source path');
      const response = await fetch(`${base}/storage/v1/object/shipment-files/${encodePath(path)}`, { headers: service, signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Operations source unavailable (${response.status})`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_BODY) throw new Error('Operations source too large');
      return buffer;
    };
    const store = async (path, bytes) => {
      const response = await fetch(`${base}/storage/v1/object/${BUCKET}/${encodePath(path)}`, {
        method: 'POST', headers: { ...service, 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: bytes,
        signal: AbortSignal.timeout(60000)
      });
      if (!response.ok) throw new Error(`Package upload failed (${response.status})`);
    };
    const result = await buildPackage(input, generated, download, store, revisionId);
    await jsonRequest('/rest/v1/bsgt_operations_revisions', {
      method: 'POST', headers: { ...service, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ id: revisionId, shipment_id: shipmentId, revision_no: input.revisionNo,
        source_fingerprint: fingerprint, shipment_snapshot: input.shipment, documents: result.documents,
        package_path: result.packagePath, created_by: user.id })
    });
    const saved = await jsonRequest('/rest/v1/rpc/approve_bsgt_operations_revision', {
      method: 'POST', headers, body: JSON.stringify({ p_revision_id: revisionId })
    });
    return res.status(200).json({ shipment: saved, revisionId, revisionNo: input.revisionNo });
  } catch (error) {
    // Never remove an object here: a lost approval response may already be committed.
    // Unapproved objects are inaccessible through RLS and QR and may be reconciled later.
    console.error('Operations package failed:', error.message);
    return res.status(409).json({ error: 'تعذر اعتماد الحزمة. حدّث الشحنة وتحقق من الصلاحيات والمتطلبات ثم أعد المحاولة.' });
  }
}

module.exports = handler;
module.exports.buildPackage = buildPackage;
module.exports.readBody = readBody;
module.exports.serviceHeaders = serviceHeaders;
