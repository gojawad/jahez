'use strict';

// Public shipment verification page opened by the permanent /s/<token> QR URL.
// Only explicitly allowlisted shipment fields and documents are exposed here.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vthcmqqiexaedukduquv.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = 'shipment-files';
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOCUMENT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

const DOCUMENT_LABELS = Object.freeze({
  import_permit: 'إذن الاستيراد',
  certificate_of_origin: 'شهادة المنشأ',
  bill_of_lading: 'بوليصة الشحن',
  optional_attachment: 'مرفق إضافي'
});
const PUBLIC_DOCUMENT_TYPES = new Set(Object.keys(DOCUMENT_LABELS));
const LEGACY_DOCUMENT_LABELS = new Map([
  ['إذن الاستيراد', 'import_permit'],
  ['شهادة المنشأ', 'certificate_of_origin'],
  ['شهادة المنشأ (بحر سواكن)', 'certificate_of_origin'],
  ['بوليصة الشحن', 'bill_of_lading'],
  ['بوليصة الشحن (بحر سواكن)', 'bill_of_lading'],
  ['ملف اختياري', 'optional_attachment'],
  ['ملف إضافي اختياري', 'optional_attachment']
]);

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[char]);

function authHeaders() {
  const headers = { apikey: SERVICE_KEY };
  if (!SERVICE_KEY.startsWith('sb_secret_')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  return headers;
}

function setPublicPageHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
}

function page(title, content) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="theme-color" content="#ffffff"><title>${escapeHtml(title)}</title><style>
    :root{--brand:#EA1B23;--brand-dark:#D01119;--ink:#182230;--muted:#667085;--line:#e4e7ec;--soft:#f8fafc;--ok:#067647}*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;min-height:100vh;min-height:100dvh;background:linear-gradient(145deg,#f8fafc 0%,#fff 48%,#fff1f2 100%);color:var(--ink);font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif}.sheet{width:min(920px,calc(100% - 32px));margin:28px auto;padding:28px;background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:0 20px 55px rgba(16,24,40,.08)}.head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding-bottom:20px;border-bottom:3px solid var(--brand)}.brand{color:var(--brand-dark);font-size:13px;font-weight:800;letter-spacing:.6px;direction:ltr}.head h1{margin:7px 0 5px;font-size:clamp(24px,4vw,34px)}.operation{display:inline-flex;direction:ltr;padding:7px 12px;border-radius:999px;background:#fff1f2;color:var(--brand-dark);font-weight:800}.verified{display:flex;align-items:center;gap:7px;color:var(--ok);font-size:13px;font-weight:800;white-space:nowrap}.verified i{width:9px;height:9px;border-radius:50%;background:#12b76a;box-shadow:0 0 0 4px #d1fadf}.status{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:20px 0;padding:16px 18px;border:1px solid #fed7da;border-radius:14px;background:#fff7f7}.status b{display:block;margin-bottom:3px}.status span{color:var(--muted);font-size:13px}.package-button,.doc-link{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;font-weight:800;transition:.2s ease}.package-button{min-height:42px;padding:9px 16px;border-radius:10px;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-dark));white-space:nowrap}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.field{min-width:0;padding:12px 14px;border:1px solid var(--line);border-radius:11px;background:var(--soft)}.field b{display:block;margin-bottom:5px;color:var(--muted);font-size:11px}.field span{display:block;font-size:14px;font-weight:700;word-break:break-word;direction:auto}.section{margin-top:24px}.section-title{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:10px}.section h2{margin:0;color:var(--brand-dark);font-size:18px}.section-title span{color:var(--muted);font-size:12px}.docs{display:grid;gap:9px}.doc{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:14px;padding:13px 15px;border:1px solid var(--line);border-radius:12px}.doc-info{min-width:0}.doc-info b,.doc-info small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.doc-info small{margin-top:3px;color:var(--muted);direction:auto}.doc-link{min-height:36px;padding:7px 13px;border:1px solid #fda4aa;border-radius:9px;color:var(--brand-dark);background:#fff}.empty{padding:18px;border:1px dashed #cfd6df;border-radius:12px;background:var(--soft);color:var(--muted);text-align:center}.foot{margin-top:24px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;text-align:center}@media(max-width:620px){.sheet{width:100%;min-height:100dvh;margin:0;padding:max(22px,env(safe-area-inset-top)) 18px max(22px,env(safe-area-inset-bottom));border:0;border-radius:0;box-shadow:none}.head{display:block}.verified{margin-top:14px}.status{align-items:stretch;flex-direction:column}.package-button{width:100%}.grid{grid-template-columns:1fr}.doc{grid-template-columns:minmax(0,1fr)}.doc-link{width:100%}}
  </style></head><body><main class="sheet">${content}</main></body></html>`;
}

function errorPage(title, message) {
  return page(title, `<header class="head"><div><div class="brand">BSGT / JAHEZ</div><h1>${escapeHtml(title)}</h1></div></header><div class="empty" style="margin-top:20px">${escapeHtml(message)}</div>`);
}

async function restRows(resource, params) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?${params}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`${resource} ${response.status}: ${await response.text()}`);
  return response.json();
}

function publicDocumentType(file) {
  const type = String(file?.document_type || '').trim().toLowerCase();
  if (PUBLIC_DOCUMENT_TYPES.has(type)) return type;
  return LEGACY_DOCUMENT_LABELS.get(String(file?.label || '').trim()) || '';
}

function safeStoragePath(value) {
  const path = String(value || '').trim();
  if (!path || path.startsWith('/') || path.includes('\\')) return '';
  const segments = path.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..') ? '' : path;
}

function publicMime(file) {
  const mime = String(file?.mime || '').toLowerCase().split(';')[0].trim();
  if (['application/pdf', 'image/png', 'image/jpeg'].includes(mime)) return mime;
  const name = String(file?.name || file?.path || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  return '';
}

function publicDocuments(files) {
  const requiredSeen = new Set();
  return (files || []).filter(file => {
    const type = publicDocumentType(file);
    if (!type || !safeStoragePath(file.path) || !publicMime(file)) return false;
    file.__publicType = type;
    if (type === 'optional_attachment') return true;
    if (requiredSeen.has(type)) return false;
    requiredSeen.add(type);
    return true;
  });
}

function buildShipmentPage(row, files, token) {
  const r = Object.assign({}, row.data || {});
  const operationNo = r.operationNo || 'بيانات الشحنة';
  const title = `مستندات الشحنة | ${operationNo}`;
  const packageReady = Boolean(TOKEN_RE.test(token) && safeStoragePath(r.qrPackagePath));
  const docs = files.map(file => {
    const label = DOCUMENT_LABELS[file.__publicType] || 'مرفق الشحنة';
    const href = `/api/public-shipment?token=${encodeURIComponent(token)}&document=${encodeURIComponent(file.id)}`;
    return `<article class="doc"><div class="doc-info"><b>${escapeHtml(label)}</b><small>${escapeHtml(file.name || label)}</small></div><a class="doc-link" href="${href}" target="_blank" rel="noopener">عرض المستند</a></article>`;
  }).join('');
  const packageAction = packageReady
    ? `<a class="package-button" href="/api/qr-package?token=${encodeURIComponent(token)}" target="_blank" rel="noopener">عرض الحزمة الكاملة PDF</a>`
    : '';
  return page(title, `<header class="head"><div><div class="brand">BAHAR SWAKEN GENERAL TRADING L.L.C</div><h1>مستندات الشحنة</h1><div class="operation">${escapeHtml(operationNo)}</div></div><div class="verified"><i></i> صفحة تحقق رسمية</div></header><section class="status"><div><b>${packageReady ? 'الحزمة الكاملة جاهزة' : 'الحزمة الكاملة قيد التجهيز'}</b><span>${packageReady ? 'يمكن عرض أحدث نسخة من ملف PDF الكامل.' : 'لم يتم إنشاء PDF الكامل بعد، والمستندات المتاحة تظهر أدناه.'}</span></div>${packageAction}</section><section class="section"><div class="section-title"><h2>الملفات المتاحة</h2><span>${files.length} مستند</span></div><div class="docs">${docs || '<div class="empty">لا توجد ملفات متاحة حتى الآن. ستظهر هنا تلقائياً بعد رفعها.</div>'}</div></section><footer class="foot">صفحة التحقق من مستندات الشحنة.</footer>`);
}

async function loadPublicShipment(token, id) {
  const params = new URLSearchParams({ select: 'id,status,data,created_at,updated_at', limit: '1' });
  if (token) params.set('data->>qrToken', `eq.${token}`);
  else params.set('id', `eq.${id}`);
  const [row] = await restRows('shipments', params);
  return row || null;
}

async function loadShipmentDocuments(shipmentId) {
  const params = new URLSearchParams({
    select: 'id,shipment_id,document_type,label,name,path,mime,size_bytes,created_at',
    shipment_id: `eq.${shipmentId}`,
    order: 'created_at.desc'
  });
  return publicDocuments(await restRows('shipment_files', params));
}

async function streamDocument(res, file) {
  const path = safeStoragePath(file.path);
  const mime = publicMime(file);
  if (!path || !mime) return res.status(404).send(errorPage('المستند غير متاح', 'هذا المستند غير مخصص للعرض العام.'));
  const objectPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, { headers: authHeaders() });
  if (response.status === 404) return res.status(404).send(errorPage('المستند غير موجود', 'قد يكون المستند قيد الاستبدال. أعد فتح صفحة الشحنة بعد قليل.'));
  if (!response.ok) throw new Error(`storage download ${response.status}: ${await response.text()}`);
  const body = Buffer.from(await response.arrayBuffer());
  const originalName = String(file.name || `shipment-document.${mime === 'application/pdf' ? 'pdf' : 'jpg'}`);
  const fallbackName = originalName.replace(/[^A-Za-z0-9._-]+/g, '_') || 'shipment-document';
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(originalName)}`);
  res.setHeader('Content-Length', body.length);
  return res.status(200).send(body);
}

module.exports = async (req, res) => {
  setPublicPageHeaders(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send(errorPage('طريقة الطلب غير مسموحة', 'افتح صفحة الشحنة من رمز QR.'));
  }
  const token = String(req.query.token || '').trim();
  const id = String(req.query.id || '').trim();
  const documentId = String(req.query.document || '').trim();
  // Old QR-page links now converge on the single merged package experience.
  if (TOKEN_RE.test(token)) {
    return res.redirect(302, `/api/qr-package?token=${encodeURIComponent(token)}`);
  }
  if (!TOKEN_RE.test(token) && !UUID_RE.test(id)) {
    return res.status(400).send(errorPage('رابط الشحنة غير مكتمل', 'امسح رمز QR من الفاتورة مرة أخرى.'));
  }
  if (documentId && (!TOKEN_RE.test(token) || !DOCUMENT_ID_RE.test(documentId))) {
    return res.status(404).send(errorPage('رابط المستند غير صحيح', 'افتح المستند من صفحة الشحنة مرة أخرى.'));
  }
  if (!SERVICE_KEY) {
    return res.status(503).send(errorPage('العرض العام غير جاهز بعد', 'يلزم ضبط SUPABASE_SERVICE_ROLE_KEY على الخادم.'));
  }

  try {
    const row = await loadPublicShipment(TOKEN_RE.test(token) ? token : '', id);
    if (!row) return res.status(404).send(errorPage('الشحنة غير موجودة', 'الرمز لا يطابق أي شحنة متاحة، أو حُذفت الشحنة.'));
    const resolvedToken = TOKEN_RE.test(token) ? token : String(row.data?.qrToken || '');
    const files = TOKEN_RE.test(resolvedToken) ? await loadShipmentDocuments(row.id) : [];
    if (documentId) {
      const file = files.find(candidate => String(candidate.id) === documentId);
      if (!file) return res.status(404).send(errorPage('المستند غير متاح', 'هذا المستند غير مخصص للعرض العام أو تم استبداله.'));
      return streamDocument(res, file);
    }
    return res.status(200).send(buildShipmentPage(row, files, resolvedToken));
  } catch (error) {
    console.error('public shipment', error);
    return res.status(500).send(errorPage('تعذر عرض الشحنة', 'حاول مسح رمز QR مرة أخرى لاحقاً.'));
  }
};
