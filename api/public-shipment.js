const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vthcmqqiexaedukduquv.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[char]);

const money = value => String(value || '').trim();
const line = (label, value) => value ? `<div class="field"><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></div>` : '';

function page(title, content) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    @page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;background:#eef3f8;color:#102a43;font-family:Tahoma,'IBM Plex Sans Arabic',sans-serif}.sheet{max-width:850px;margin:32px auto;background:#fff;border:1px solid #dce6f1;border-radius:16px;padding:34px;box-shadow:0 14px 40px #17355d14}.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:3px solid #9b1c24;padding-bottom:18px}.brand{color:#9b1c24;font-size:13px;font-weight:800;letter-spacing:.8px}.head h1{margin:6px 0 0;font-size:26px}.operation{display:inline-block;background:#edf5ff;color:#1769e8;border-radius:999px;padding:7px 12px;font-size:13px;font-weight:800;direction:ltr}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:22px 0}.field{border:1px solid #dbe5ef;border-radius:10px;padding:12px;background:#fbfdff;min-width:0}.field b{display:block;font-size:11px;color:#64748b;margin-bottom:5px}.field span{display:block;font-size:14px;font-weight:700;word-break:break-word;direction:auto}.section{margin-top:23px}.section h2{font-size:16px;margin:0 0 9px;color:#9b1c24}.note{white-space:pre-line;line-height:1.8;border:1px solid #dbe5ef;border-radius:10px;padding:13px;background:#fbfdff}.print{border:0;border-radius:9px;padding:10px 14px;background:#1769e8;color:#fff;font:inherit;font-weight:800;cursor:pointer}@media(max-width:600px){.sheet{margin:0;border:0;border-radius:0;padding:20px}.grid{grid-template-columns:1fr}.head{display:block}.print{margin-top:14px}}@media print{body{background:#fff}.sheet{max-width:none;margin:0;padding:0;border:0;box-shadow:none}.print{display:none}.head{border-bottom-color:#000}.section h2,.brand{color:#000}}
  </style></head><body><main class="sheet">${content}</main></body></html>`;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).send(page('رابط غير مكتمل', '<h1>رابط الشحنة غير مكتمل</h1><p>امسح رمز QR من الفاتورة مرة أخرى.</p>'));
  if (!SERVICE_KEY) return res.status(503).send(page('إعداد العرض العام', '<h1>العرض العام غير جاهز بعد</h1><p>يلزم ربط مفتاح خادم قاعدة البيانات مرة واحدة لتظهر الشحنات من رمز QR.</p>'));

  try {
    const headers = { apikey: SERVICE_KEY };
    // New Supabase secret keys use the apikey header directly. Legacy JWT keys
    // still need Authorization, so keep both formats compatible.
    if (!SERVICE_KEY.startsWith('sb_secret_')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/shipments?select=id,status,data,created_at,updated_at&id=eq.${encodeURIComponent(id)}`, { headers });
    if (!response.ok) throw new Error(await response.text());
    const rows = await response.json();
    const row = rows[0];
    if (!row) return res.status(404).send(page('الشحنة غير موجودة', '<h1>الشحنة غير موجودة أو تم حذفها</h1>'));

    const r = Object.assign({}, row.data || {});
    const title = r.itemDesc || r.operationNo || r.invoiceNo || 'بيانات الشحنة';
    const details = [
      ['رقم العملية', r.operationNo], ['حالة الشحنة', row.status], ['رقم الفاتورة', r.invoiceNo], ['تاريخ الفاتورة', r.invoiceDate],
      ['رقم البوليصة', r.billNo || r.billOfLadingNo], ['رقم البروفورما', r.proformaNo], ['العميل / المستلم', r.consignee], ['العنوان', r.consigneeAddress],
      ['وصف البضاعة', r.itemDesc], ['الكمية', [r.totalQty || r.qty, r.qtyUnit].filter(Boolean).join(' ')], ['القيمة الإجمالية', money(r.totalAmount)],
      ['ميناء التحميل', r.portLoading], ['ميناء الوصول', r.portDischarge], ['شرط الدفع', r.paymentTerm], ['البنك', r.bankName], ['بيانات البنك', r.bankDetails]
    ].map(([label, value]) => line(label, value)).join('');
    const content = `<header class="head"><div><div class="brand">BAHAR SWAKEN GENERAL TRADING L.L.C</div><h1>${escapeHtml(title)}</h1><div class="operation">${escapeHtml(r.operationNo || row.id)}</div></div><button class="print" onclick="window.print()">طباعة البيانات</button></header><section class="grid">${details}</section>${r.notes ? `<section class="section"><h2>ملاحظات</h2><div class="note">${escapeHtml(r.notes)}</div></section>` : ''}`;
    return res.status(200).send(page(title, content));
  } catch (error) {
    console.error('public shipment', error);
    return res.status(500).send(page('تعذر عرض الشحنة', '<h1>تعذر عرض بيانات الشحنة الآن</h1><p>حاول المسح مرة أخرى لاحقاً.</p>'));
  }
};
