// يفتح حزمة العملية الكاملة (PDF) من رمز QR المطبوع على الفاتورة.
//
// الرابط: /s/<token>. الرمز السري يُولَّد داخل البرنامج ويُحفظ في الشحنة
// (data.qrToken)، وملف الحزمة يُرفع إلى bucket "shipment-files" عند كل
// "تجميع الحزمة الكاملة PDF" (data.qrPackagePath). يقرأ هذا المسار بمفتاح
// service_role على الخادم فقط، فلا يُكشف أي شيء إلا لمن يحمل الرمز.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vthcmqqiexaedukduquv.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = 'shipment-files';
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[char]);

function page(title, body) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#eef3f8;color:#102a43;font-family:Tahoma,'IBM Plex Sans Arabic',sans-serif}main{max-width:560px;margin:60px auto;background:#fff;border:1px solid #dce6f1;border-radius:16px;padding:32px;line-height:1.9}h1{font-size:22px;margin:0 0 10px;color:#9b1c24}p{margin:0}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${body}</p></main></body></html>`;
}

function authHeaders() {
  const headers = { apikey: SERVICE_KEY };
  // المفاتيح الجديدة sb_secret_ تكفيها apikey، ومفاتيح JWT القديمة تحتاج Authorization أيضاً.
  if (!SERVICE_KEY.startsWith('sb_secret_')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  return headers;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const token = String(req.query.token || '').trim();
  if (!TOKEN_RE.test(token)) {
    return res.status(404).send(page('الرابط غير صحيح', 'امسح رمز QR من الفاتورة مرة أخرى.'));
  }
  if (!SERVICE_KEY) {
    return res.status(503).send(page('العرض من رمز QR غير جاهز بعد', 'يلزم ضبط SUPABASE_SERVICE_ROLE_KEY على الخادم مرة واحدة.'));
  }

  try {
    const query = new URLSearchParams({
      select: 'id,data->>operationNo,data->>qrPackagePath,data->>qrPublishedAt',
      'data->>qrToken': `eq.${token}`,
      limit: '1'
    });
    const lookup = await fetch(`${SUPABASE_URL}/rest/v1/shipments?${query}`, { headers: authHeaders() });
    if (!lookup.ok) throw new Error(`shipment lookup ${lookup.status}: ${await lookup.text()}`);
    const [row] = await lookup.json();
    if (!row) {
      return res.status(404).send(page('الشحنة غير موجودة', 'الرمز لا يطابق أي عملية، أو حُذفت العملية.'));
    }
    const packagePath = row.qrPackagePath;
    if (!packagePath || packagePath.includes('..')) {
      return res.status(404).send(page('الحزمة لم تُنشر بعد', `افتح العملية ${escapeHtml(row.operationNo || '')} في البرنامج واضغط «تجميع الحزمة الكاملة PDF» لتحديث ما يفتحه هذا الرمز.`));
    }

    const objectUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${packagePath.split('/').map(encodeURIComponent).join('/')}`;
    const file = await fetch(objectUrl, { headers: authHeaders() });
    if (file.status === 404) {
      return res.status(404).send(page('ملف الحزمة غير موجود', 'أعد تجميع الحزمة من البرنامج ليُنشأ الملف من جديد.'));
    }
    if (!file.ok) throw new Error(`storage download ${file.status}: ${await file.text()}`);

    const pdf = Buffer.from(await file.arrayBuffer());
    const filename = `operation-${String(row.operationNo || row.id).replace(/[^\w.-]+/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    return res.status(200).send(pdf);
  } catch (error) {
    console.error('qr package', error);
    return res.status(500).send(page('تعذر فتح حزمة العملية الآن', 'حاول المسح مرة أخرى لاحقاً.'));
  }
};
