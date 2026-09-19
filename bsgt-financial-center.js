/* BSGT workspace — «المركز المالي» (phase 1).
   One financial file per trade file: list (keyset, 10 per page), creation from an eligible
   trade file, details (client, invoices, tariffs, import permit, bank documents), computed
   costs read back from the database, event log and status transitions.
   Every write goes through the approved RPCs with lock_version. Money values are handled as
   strings end to end: they are requested from PostgREST with ::text casts, sent to the RPCs as
   strings and never turned into a JavaScript Number. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JahezBsgtFinancialCenter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TITLE = 'المركز المالي';
  const DESCRIPTION = 'إدارة الحسابات والتكاليف والتحصيلات المرتبطة بالعمليات';
  const PAGE_SIZE = 10;
  const KEYS = Object.freeze({view:'bsgt.financial_center.view', edit:'bsgt.financial_center.edit', approve:'bsgt.financial_center.approve'});
  const STATUS = Object.freeze({
    draft:'مسودة', pending_client_transfer:'بانتظار تحويل العميل', client_transferred:'تم تحويل العميل',
    bank_paid:'تم دفع البنك', completed:'مكتملة', failed:'أخفقت', refund_in_progress:'استرداد كامل قيد التنفيذ', refunded:'مستردة بالكامل'
  });
  const TRADE_STATUS = Object.freeze({
    draft:'مسودة مالية', sent_to_remitting:'أُرسل للبنك المرسل', under_management_review:'قيد مراجعة الإدارة',
    final_accepted:'قبول نهائي', sent_to_collecting:'تم الإرسال للبنك المعني'
  });
  const EVENTS = Object.freeze({
    created:'إنشاء الملف المالي', draft_updated:'تعديل المسودة', bank_details_updated:'تعديل بيانات البنك والإذن', invoices_synced:'مزامنة الفواتير',
    invoice_confirmed:'تأكيد مبلغ فاتورة', client_confirmed:'تأكيد العميل', approved:'اعتماد التكلفة', reopened:'إعادة فتح المسودة',
    client_transfer_confirmed:'تأكيد تحويل العميل', bank_payment_confirmed:'تأكيد دفع البنك', completed:'إكمال العملية', failed:'إخفاق العملية',
    refund_started:'بدء الاسترداد الكامل', refunded:'تأكيد الاسترداد الكامل', closed:'إقفال الملف'
  });
  // Money columns are requested with ::text so PostgREST never emits JSON numbers for them.
  const FILE_COLUMNS = ['id','trade_file_id','company_id','status','lock_version','consignee_snapshot','consignee_count','client_id','client_name_snapshot',
    'client_confirmed_at','client_confirmed_by','invoice_total_usd::text','documents_value_aed::text','bank_tariff_per_1000_sdg::text','bsgt_tariff_per_1000_sdg::text',
    'bank_cost_sdg::text','bsgt_commission_sdg::text','import_permit_source','import_permit_cost_sdg::text','import_permit_no','import_permit_issued_at',
    'import_permit_expires_at','import_permit_issuer','client_total_sdg::text','calculation_ready','last_input_at','last_input_by','approved_at','approved_by',
    'client_transferred_at','client_transferred_by','bank_paid_at','bank_paid_by','completed_at','completed_by','failed_at','failed_by','failure_reason',
    'refund_started_at','refund_started_by','refunded_at','refunded_by','closed_at','closed_by','notes','created_by','created_at','updated_at'].join(',');
  const INVOICE_COLUMNS = 'id,financial_file_id,shipment_id,invoice_no_snapshot,currency_snapshot,amount_source_text,amount_usd::text,amount_usd_basis,amount_confirmed_at,amount_confirmed_by,detached_at,detached_by,created_at';
  const MONEY_FIELDS = ['invoice_total_usd','documents_value_aed','bank_tariff_per_1000_sdg','bsgt_tariff_per_1000_sdg','bank_cost_sdg','bsgt_commission_sdg','import_permit_cost_sdg','client_total_sdg','amount_usd'];

  const state = {
    container:null, view:'list', busy:false,
    filters:{status:'', search:'', closed:''},
    page:{rows:[], cursors:[], next:null},          // cursors: stack of {updated_at,id} for the previous pages
    file:null, invoices:[], events:[], names:new Map(), listRow:null,
    create:{open:false, rows:[], search:'', cursors:[], next:null},
    clientSearch:{query:'', rows:[]}
  };

  // ---------------------------------------------------------------- helpers
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  // index.html declares `sb`, `toast` and the current user as top-level lexical bindings (not window
  // properties), so renderBsgtWorkspace() hands them to mount(container, deps).
  const deps = {sb:null, toast:null, profile:null, formatDate:null};
  const sb = () => deps.sb || globalThis.sb;
  const can = key => Boolean(globalThis.JahezPermissions?.can(key));
  const isAdmin = () => deps.profile?.role === 'admin';
  const notify = (text, kind) => { const fn = deps.toast || globalThis.toast; if (typeof fn === 'function') fn(text, kind); else console[kind === 'err' ? 'error' : 'log'](text); };
  const fmtDate = value => value ? (typeof deps.formatDate === 'function' ? deps.formatDate(value) : String(value).replace('T',' ').slice(0,16)) : '—';
  const label = (map, key) => map[key] || key || '—';

  // Decimal strings only: never Number(). Groups the integer part and trims trailing zeros of the fraction
  // (keeping at least two decimals). Adds nothing, rounds nothing; the raw string stays in the title attribute.
  function fmtDecimal(value, {currency = ''} = {}) {
    if (value === null || value === undefined || value === '') return '—';
    const text = String(value).trim();
    if (!/^-?\d+(\.\d+)?$/.test(text)) return esc(text);
    const negative = text.startsWith('-');
    const [whole, fraction = ''] = text.replace('-', '').split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    let frac = fraction.replace(/0+$/, '');
    if (frac.length < 2) frac = (frac + '00').slice(0, 2);
    return `<span class="fc-money" dir="ltr" title="${esc(text)}">${negative ? '-' : ''}${grouped}.${frac}${currency ? ' ' + esc(currency) : ''}</span>`;
  }
  // Input validation without float parsing: optional digits, optional fraction up to 6 places.
  function normalizeDecimalInput(raw, fieldLabel) {
    const text = String(raw ?? '').trim().replace(/,/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    if (text === '') return null;
    if (!/^\d+(\.\d{1,6})?$/.test(text)) throw new Error(`${fieldLabel}: أدخل رقماً عشرياً موجباً بحد أقصى 6 خانات عشرية (بدون تقريب).`);
    return text;
  }
  function assertStrings(row) {
    // Defensive: the app never accepts a numeric JSON value for money (would already have lost precision).
    for (const key of MONEY_FIELDS) if (row && typeof row[key] === 'number') throw new Error(`القيمة المالية ${key} وصلت كرقم بدل نص — أوقفنا العرض حفاظاً على الدقة.`);
    return row;
  }
  function rpcError(error) {
    const message = String(error?.message || error || 'خطأ غير معروف');
    if (/version changed/i.test(message)) return 'تغيّر الملف من مستخدم آخر أثناء عملك؛ تم إعادة تحميله — راجع القيم وأعد المحاولة.';
    if (/Maker-checker/i.test(message)) return 'لا يمكن لمن أدخل آخر قيمة مالية أن يعتمدها (فصل الإدخال عن الاعتماد).';
    if (/permission required/i.test(message)) return 'ليس لديك الصلاحية المطلوبة لهذا الإجراء.';
    if (/more than 6 decimal/i.test(message)) return 'القيمة تحتوي أكثر من 6 خانات عشرية؛ التقريب غير مسموح.';
    if (/bff_permit_no_uniq|duplicate key/i.test(message)) return 'رقم إذن الاستيراد مستخدم في ملف مالي آخر.';
    return message;
  }

  // ---------------------------------------------------------------- shell
  function shell() {
    return `<section class="bsgt-financial-center" id="bsgtFinancialCenter" aria-labelledby="bsgtFinancialCenterTitle">
      <header class="bsgt-financial-center-head">
        <div><h3 id="bsgtFinancialCenterTitle">${TITLE}</h3><p>${DESCRIPTION}</p></div>
        <div class="fc-head-actions" data-head-actions></div>
      </header>
      <div class="bsgt-financial-center-body" data-body aria-live="polite"></div>
    </section>`;
  }
  function mount(container, options = {}) {
    if (!container) return null;
    Object.assign(deps, {sb:options.sb || null, toast:options.toast || null, profile:options.profile || null, formatDate:options.formatDate || null});
    state.container = container;
    container.innerHTML = shell();
    if (!can(KEYS.view)) {
      container.querySelector('[data-body]').innerHTML = '<div class="fc-empty">ليس لديك صلاحية عرض المركز المالي.</div>';
      return container.querySelector('#bsgtFinancialCenter');
    }
    state.view = 'list'; state.file = null; state.page = {rows:[], cursors:[], next:null};
    renderList();
    loadPage(null);
    return container.querySelector('#bsgtFinancialCenter');
  }
  const body = () => state.container?.querySelector('[data-body]');
  const headActions = () => state.container?.querySelector('[data-head-actions]');
  function setBusy(flag) {
    state.busy = flag;
    state.container?.querySelectorAll('button, input, select, textarea').forEach(el => { if (el.dataset.keepEnabled === undefined) el.disabled = flag || el.dataset.disabled === 'true'; });
  }

  // ---------------------------------------------------------------- list
  function renderList() {
    const h = headActions();
    if (h) h.innerHTML = can(KEYS.edit) ? '<button type="button" class="btn btn-primary btn-small" data-action="open-create">إنشاء ملف مالي</button>' : '';
    body().innerHTML = `
      <section class="fc-panel">
        <div class="fc-toolbar">
          <label class="fc-field"><span>بحث</span><input type="search" data-filter="search" value="${esc(state.filters.search)}" placeholder="رقم الملف TC، المستلم، العميل، رقم الإذن"></label>
          <label class="fc-field"><span>الحالة</span><select data-filter="status"><option value="">كل الحالات</option>${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${state.filters.status===k?'selected':''}>${v}</option>`).join('')}</select></label>
          <label class="fc-field"><span>الإقفال</span><select data-filter="closed"><option value="">الكل</option><option value="false" ${state.filters.closed==='false'?'selected':''}>مفتوح</option><option value="true" ${state.filters.closed==='true'?'selected':''}>مقفل</option></select></label>
          <button type="button" class="btn btn-ghost btn-small" data-action="apply-filters">تطبيق</button>
        </div>
        <div class="fc-table-wrap"><table class="fc-table" data-list-table>
          <thead><tr><th>ملف TC</th><th>المستلم / العميل</th><th>الحالة المالية</th><th>الفواتير USD</th><th>إجمالي العميل SDG</th><th>آخر تحديث</th></tr></thead>
          <tbody data-list-rows><tr><td colspan="6" class="fc-muted">جارٍ التحميل…</td></tr></tbody>
        </table></div>
        <div class="fc-pager"><button type="button" class="btn btn-ghost btn-small" data-action="prev-page" disabled>السابق</button><span data-page-info></span><button type="button" class="btn btn-ghost btn-small" data-action="next-page" disabled>التالي</button></div>
      </section>
      <div data-create-host></div>`;
    wireList();
  }
  function wireList() {
    const b = body();
    b.querySelector('[data-action="apply-filters"]')?.addEventListener('click', () => { readFilters(); state.page = {rows:[], cursors:[], next:null}; loadPage(null); });
    b.querySelector('[data-filter="search"]')?.addEventListener('keydown', e => { if (e.key === 'Enter') { readFilters(); state.page = {rows:[], cursors:[], next:null}; loadPage(null); } });
    b.querySelector('[data-action="next-page"]')?.addEventListener('click', () => { if (state.page.next) { state.page.cursors.push(state.page.current || null); loadPage(state.page.next); } });
    b.querySelector('[data-action="prev-page"]')?.addEventListener('click', () => { if (state.page.cursors.length) loadPage(state.page.cursors.pop()); });
    headActions()?.querySelector('[data-action="open-create"]')?.addEventListener('click', openCreate);
  }
  function readFilters() {
    const b = body();
    state.filters.search = b.querySelector('[data-filter="search"]')?.value.trim() || '';
    state.filters.status = b.querySelector('[data-filter="status"]')?.value || '';
    state.filters.closed = b.querySelector('[data-filter="closed"]')?.value || '';
  }
  async function loadPage(cursor) {
    const rowsEl = body()?.querySelector('[data-list-rows]'); if (!rowsEl) return;
    rowsEl.innerHTML = '<tr><td colspan="6" class="fc-muted">جارٍ التحميل…</td></tr>';
    const {data, error} = await sb().rpc('list_bsgt_financial_files', {
      p_status: state.filters.status || null, p_search: state.filters.search || null,
      p_closed: state.filters.closed === '' ? null : state.filters.closed === 'true',
      p_limit: PAGE_SIZE, p_after_updated_at: cursor?.updated_at || null, p_after_id: cursor?.id || null
    });
    if (error) { rowsEl.innerHTML = `<tr><td colspan="6" class="fc-error">تعذر تحميل القائمة: ${esc(rpcError(error))}</td></tr>`; return; }
    const rows = (data || []).map(assertStrings);
    state.page.rows = rows; state.page.current = cursor;
    const last = rows[rows.length - 1];
    state.page.next = rows.length === PAGE_SIZE && last ? {updated_at:last.updated_at, id:last.id} : null;
    rowsEl.innerHTML = rows.length ? rows.map(row => `
      <tr data-open="${esc(row.id)}" class="${row.trade_archived_at ? 'is-archived' : ''}">
        <td><b>${esc(row.operation_no || '—')}</b><small>${esc(label(TRADE_STATUS, row.trade_status))}${row.trade_archived_at ? ' · مؤرشف' : ''}</small></td>
        <td>${esc(row.client_name_snapshot || row.consignee_snapshot || '—')}${row.consignee_count > 1 ? `<small>عدة مستلمين (${row.consignee_count})</small>` : ''}</td>
        <td><span class="fc-status is-${esc(row.status)}">${esc(label(STATUS, row.status))}</span>${row.closed_at ? '<small>مقفل</small>' : ''}</td>
        <td>${fmtDecimal(row.invoice_total_usd)}</td>
        <td>${row.calculation_ready ? fmtDecimal(row.client_total_sdg) : '<span class="fc-muted">غير مكتمل</span>'}</td>
        <td>${esc(fmtDate(row.updated_at))}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="fc-muted">لا توجد ملفات مالية مطابقة.</td></tr>';
    rowsEl.querySelectorAll('[data-open]').forEach(tr => tr.addEventListener('click', () => openFile(tr.dataset.open, rows.find(r => r.id === tr.dataset.open))));
    const b = body();
    b.querySelector('[data-action="prev-page"]').disabled = !state.page.cursors.length;
    b.querySelector('[data-action="next-page"]').disabled = !state.page.next;
    b.querySelector('[data-page-info]').textContent = rows.length ? `صفحة ${state.page.cursors.length + 1} · ${rows.length} سجل` : '';
  }

  // ---------------------------------------------------------------- create
  function openCreate() {
    if (!can(KEYS.edit)) return;
    const host = body()?.querySelector('[data-create-host]'); if (!host) return;
    state.create = {open:true, rows:[], search:'', cursors:[], next:null};
    host.innerHTML = `<section class="fc-panel fc-create" data-create>
      <header class="fc-panel-head"><div><h4>إنشاء ملف مالي</h4><p>اختر ملف عملية تجارية (TC) مؤهلاً: تابع لبحر سواكن، غير مؤرشف، بوضع تحصيل، وبلا ملف مالي سابق.</p></div><button type="button" class="btn btn-ghost btn-small" data-action="close-create">إغلاق</button></header>
      <div class="fc-toolbar"><label class="fc-field"><span>بحث برقم TC</span><input type="search" data-create-search placeholder="TC-2026-"></label><button type="button" class="btn btn-ghost btn-small" data-action="create-search">بحث</button></div>
      <div class="fc-eligible" data-eligible-rows><div class="fc-muted">جارٍ التحميل…</div></div>
      <div class="fc-pager"><button type="button" class="btn btn-ghost btn-small" data-action="create-prev" disabled>السابق</button><span></span><button type="button" class="btn btn-ghost btn-small" data-action="create-next" disabled>التالي</button></div>
    </section>`;
    host.querySelector('[data-action="close-create"]').addEventListener('click', () => { host.innerHTML = ''; state.create.open = false; });
    host.querySelector('[data-action="create-search"]').addEventListener('click', () => { state.create.search = host.querySelector('[data-create-search]').value.trim(); state.create.cursors = []; loadEligible(null); });
    host.querySelector('[data-action="create-next"]').addEventListener('click', () => { if (state.create.next) { state.create.cursors.push(state.create.current || null); loadEligible(state.create.next); } });
    host.querySelector('[data-action="create-prev"]').addEventListener('click', () => { if (state.create.cursors.length) loadEligible(state.create.cursors.pop()); });
    loadEligible(null);
  }
  async function loadEligible(cursor) {
    const host = body()?.querySelector('[data-create]'); if (!host) return;
    const rowsEl = host.querySelector('[data-eligible-rows]');
    const {data, error} = await sb().rpc('list_bsgt_financial_eligible_trade_files', {p_search: state.create.search || null, p_limit: PAGE_SIZE, p_after_created_at: cursor?.created_at || null, p_after_id: cursor?.id || null});
    if (error) { rowsEl.innerHTML = `<div class="fc-error">${esc(rpcError(error))}</div>`; return; }
    const rows = data || []; state.create.rows = rows; state.create.current = cursor;
    const last = rows[rows.length - 1];
    state.create.next = rows.length === PAGE_SIZE && last ? {created_at:last.created_at, id:last.id} : null;
    rowsEl.innerHTML = rows.length ? rows.map(row => `<div class="fc-eligible-row"><div><b>${esc(row.operation_no)}</b><small>${esc(label(TRADE_STATUS, row.status))} · ${row.shipment_count} شحنة · ${esc((row.consignees || []).join(' | ') || '—')}</small></div><button type="button" class="btn btn-primary btn-small" data-create-id="${esc(row.id)}">إنشاء</button></div>`).join('')
      : '<div class="fc-muted">لا توجد ملفات TC مؤهلة بلا ملف مالي.</div>';
    rowsEl.querySelectorAll('[data-create-id]').forEach(btn => btn.addEventListener('click', () => createFile(btn.dataset.createId)));
    host.querySelector('[data-action="create-prev"]').disabled = !state.create.cursors.length;
    host.querySelector('[data-action="create-next"]').disabled = !state.create.next;
  }
  async function createFile(tradeFileId) {
    if (state.busy) return;
    setBusy(true);
    try {
      const {data, error} = await sb().rpc('create_bsgt_financial_file', {p_trade_file_id: tradeFileId});
      if (error) throw error;
      notify(data?.created ? 'تم إنشاء الملف المالي.' : 'الملف المالي موجود مسبقاً — تم فتحه.');
      await openFile(data.financial_file_id, null);
    } catch (error) { notify(rpcError(error), 'err'); }
    finally { setBusy(false); }
  }

  // ---------------------------------------------------------------- details
  async function openFile(id, listRow) {
    state.view = 'detail'; state.listRow = listRow || state.listRow;
    body().innerHTML = '<div class="fc-muted fc-panel">جارٍ تحميل الملف المالي…</div>';
    headActions().innerHTML = '<button type="button" class="btn btn-ghost btn-small" data-action="back">العودة للقائمة</button>';
    headActions().querySelector('[data-action="back"]').addEventListener('click', () => { state.view = 'list'; state.file = null; renderList(); loadPage(null); });
    await reload(id);
  }
  async function reload(id = state.file?.id) {
    const client = sb();
    const [fileRes, invRes, evRes] = await Promise.all([
      client.from('bsgt_financial_files').select(FILE_COLUMNS).eq('id', id).single(),
      client.from('bsgt_financial_file_invoices').select(INVOICE_COLUMNS).eq('financial_file_id', id).order('created_at'),
      client.from('bsgt_financial_file_events').select('id,event_type,from_status,to_status,lock_version_after,actor_id,note,changes,created_at').eq('financial_file_id', id).order('created_at', {ascending:false})
    ]);
    if (fileRes.error) { body().innerHTML = `<div class="fc-error fc-panel">تعذر تحميل الملف: ${esc(rpcError(fileRes.error))}</div>`; return; }
    try {
      state.file = assertStrings(fileRes.data);
      state.invoices = (invRes.data || []).map(assertStrings);
    } catch (error) { body().innerHTML = `<div class="fc-error fc-panel">${esc(error.message)}</div>`; return; }
    state.events = evRes.data || [];
    await loadNames();
    if (!state.listRow || state.listRow.id !== id) {
      const {data} = await client.from('trade_collection_files').select('id,operation_no,status,archived_at').eq('id', state.file.trade_file_id).maybeSingle();
      state.listRow = data ? {id, operation_no:data.operation_no, trade_status:data.status, trade_archived_at:data.archived_at} : {id};
    }
    renderDetail();
  }
  async function loadNames() {
    const ids = new Set();
    const f = state.file;
    ['created_by','last_input_by','approved_by','client_transferred_by','bank_paid_by','completed_by','failed_by','refund_started_by','refunded_by','closed_by','client_confirmed_by'].forEach(k => f[k] && ids.add(f[k]));
    state.events.forEach(e => e.actor_id && ids.add(e.actor_id));
    state.invoices.forEach(i => i.amount_confirmed_by && ids.add(i.amount_confirmed_by));
    const missing = [...ids].filter(id => !state.names.has(id));
    if (!missing.length) return;
    const {data} = await sb().from('profiles').select('id,display_name,email').in('id', missing);
    (data || []).forEach(p => state.names.set(p.id, p.display_name || p.email || p.id));
    missing.forEach(id => { if (!state.names.has(id)) state.names.set(id, id.slice(0, 8)); });
  }
  const who = id => id ? esc(state.names.get(id) || id.slice(0, 8)) : '—';

  function actionsFor(f) {
    if (!can(KEYS.approve) || f.closed_at) return [];
    const list = [];
    const add = (action, text, cls = 'btn-primary', needsNote = false) => list.push({action, text, cls, needsNote});
    switch (f.status) {
      case 'draft': add('approve', 'اعتماد التكلفة'); add('fail', 'تسجيل إخفاق', 'btn-ghost fc-danger', true); break;
      case 'pending_client_transfer': add('confirm_client_transfer', 'تأكيد تحويل العميل'); add('reopen', 'إعادة فتح المسودة', 'btn-ghost'); add('fail', 'تسجيل إخفاق', 'btn-ghost fc-danger', true); break;
      case 'client_transferred': add('confirm_bank_payment', 'تأكيد دفع البنك'); add('fail', 'تسجيل إخفاق', 'btn-ghost fc-danger', true); break;
      case 'bank_paid': add('complete', 'إكمال العملية'); add('fail', 'تسجيل إخفاق', 'btn-ghost fc-danger', true); break;
      case 'completed': add('close', 'إقفال الملف', 'btn-ghost'); break;
      case 'failed': if (f.client_transferred_at) add('start_refund', 'بدء الاسترداد الكامل'); else add('close', 'إقفال الملف', 'btn-ghost'); break;
      case 'refund_in_progress': add('confirm_refund', 'تأكيد الاسترداد الكامل'); break;
      case 'refunded': add('close', 'إقفال الملف', 'btn-ghost'); break;
    }
    return list;
  }

  function renderDetail() {
    const f = state.file, row = state.listRow || {};
    const editable = can(KEYS.edit) && !f.closed_at;
    const draft = editable && f.status === 'draft';
    const bankEditable = editable && ['draft','pending_client_transfer','client_transferred'].includes(f.status);
    const active = state.invoices.filter(i => !i.detached_at), detached = state.invoices.filter(i => i.detached_at);
    const stamps = [['approved','اعتماد التكلفة'],['client_transferred','تحويل العميل'],['bank_paid','دفع البنك'],['completed','الإكمال'],['failed','الإخفاق'],['refund_started','بدء الاسترداد'],['refunded','الاسترداد'],['closed','الإقفال']]
      .filter(([k]) => f[k + '_at']).map(([k, t]) => `<div><span>${t}</span><b>${esc(fmtDate(f[k + '_at']))}</b><small>${who(f[k + '_by'])}</small></div>`).join('');
    body().innerHTML = `
      <section class="fc-panel fc-summary">
        <div class="fc-summary-main">
          <div><span>ملف العملية التجارية</span><b>${esc(row.operation_no || '—')}</b><small>${esc(label(TRADE_STATUS, row.trade_status))}${row.trade_archived_at ? ' · مؤرشف' : ''}</small></div>
          <div><span>الحالة المالية</span><b><span class="fc-status is-${esc(f.status)}">${esc(label(STATUS, f.status))}</span>${f.closed_at ? ' <span class="fc-status is-closed">مقفل</span>' : ''}</b><small>النسخة ${f.lock_version} · آخر إدخال ${who(f.last_input_by)} · ${esc(fmtDate(f.last_input_at))}</small></div>
          <div><span>المستلم${f.consignee_count > 1 ? 'ون' : ''} في TC</span><b>${esc(f.consignee_snapshot)}</b><small>${f.consignee_count > 1 ? 'عدة مستلمين — اختر عميل الفوترة يدوياً' : 'مستلم واحد'}</small></div>
          <div><span>عميل الفوترة</span><b>${esc(f.client_name_snapshot || 'لم يُؤكَّد بعد')}</b><small>${f.client_confirmed_at ? `أكده ${who(f.client_confirmed_by)} · ${esc(fmtDate(f.client_confirmed_at))}` : 'الاعتماد يتطلب تأكيد العميل'}</small></div>
        </div>
        ${f.failure_reason ? `<div class="fc-failure">سبب الإخفاق: ${esc(f.failure_reason)}</div>` : ''}
        <div class="fc-actions" data-actions>${actionsFor(f).map(a => `<button type="button" class="btn ${a.cls} btn-small" data-transition="${a.action}" data-needs-note="${a.needsNote}">${a.text}</button>`).join('')}</div>
      </section>

      <div class="fc-grid">
        <section class="fc-panel">
          <header class="fc-panel-head"><div><h4>التكاليف (من القاعدة)</h4><p>تُحسب داخل PostgreSQL بلا تقريب؛ تظهر بعد اكتمال المدخلات.</p></div></header>
          <div class="fc-costs">
            <div><span>إجمالي الفواتير USD</span><b>${fmtDecimal(f.invoice_total_usd, {currency:'USD'})}</b></div>
            <div><span>تكلفة البنك SDG</span><b>${fmtDecimal(f.bank_cost_sdg, {currency:'SDG'})}</b></div>
            <div><span>عمولة BSGT SDG</span><b>${fmtDecimal(f.bsgt_commission_sdg, {currency:'SDG'})}</b></div>
            <div><span>تكلفة إذن الاستيراد SDG</span><b>${fmtDecimal(f.import_permit_cost_sdg, {currency:'SDG'})}</b></div>
            <div class="fc-total"><span>إجمالي العميل SDG</span><b>${f.calculation_ready ? fmtDecimal(f.client_total_sdg, {currency:'SDG'}) : '<span class="fc-muted">غير مكتمل — أكمل الفواتير والتعرفتين ومصدر الإذن</span>'}</b></div>
            <div><span>قيمة مستندات البنك AED</span><b>${fmtDecimal(f.documents_value_aed, {currency:'AED'})}</b></div>
          </div>
        </section>

        <section class="fc-panel">
          <header class="fc-panel-head"><div><h4>عميل الفوترة</h4><p>يُختار من سجل العملاء ويُؤكَّد يدوياً؛ يُحفظ اسمه لحظة التأكيد.</p></div></header>
          ${draft ? `<div class="fc-toolbar"><label class="fc-field fc-grow"><span>ابحث في العملاء</span><input type="search" data-client-search placeholder="اسم العميل"></label><button type="button" class="btn btn-ghost btn-small" data-action="client-search">بحث</button></div><div class="fc-client-results" data-client-results></div>` : `<p class="fc-muted">${f.client_id ? 'العميل مؤكد.' : 'تعديل العميل متاح في المسودة فقط.'}</p>`}
        </section>
      </div>

      <section class="fc-panel">
        <header class="fc-panel-head"><div><h4>فواتير الشحنات (USD)</h4><p>القيمة الأصلية كما في الشحنة، والقيمة المعتمدة تُؤكَّد يدوياً. العملات غير USD تحتاج ذكر أساس التحويل صراحةً.</p></div>${draft ? '<button type="button" class="btn btn-ghost btn-small" data-action="sync">مزامنة مع شحنات TC</button>' : ''}</header>
        <div class="fc-table-wrap"><table class="fc-table">
          <thead><tr><th>الفاتورة</th><th>القيمة الأصلية</th><th>العملة</th><th>المبلغ المعتمد USD</th><th>الأساس</th><th>التأكيد</th>${draft ? '<th></th>' : ''}</tr></thead>
          <tbody>${active.map(i => invoiceRow(i, draft)).join('') || `<tr><td colspan="7" class="fc-muted">لا توجد فواتير نشطة.</td></tr>`}</tbody>
        </table></div>
        ${detached.length ? `<details class="fc-detached"><summary>فواتير مفصولة (خرجت شحناتها من TC) — ${detached.length}</summary><div class="fc-table-wrap"><table class="fc-table"><tbody>${detached.map(i => invoiceRow(i, false)).join('')}</tbody></table></div></details>` : ''}
      </section>

      <div class="fc-grid">
        <section class="fc-panel">
          <header class="fc-panel-head"><div><h4>التعرفات وإذن الاستيراد</h4><p>تُدخل يدوياً لكل عملية بلا قيم مقترحة؛ تُقفل بعد الاعتماد.</p></div></header>
          <form class="fc-form" data-form="draft">
            <label class="fc-field"><span>تعرفة البنك SDG لكل 1,000 USD</span><input name="bank_tariff_per_1000_sdg" inputmode="decimal" value="${esc(f.bank_tariff_per_1000_sdg ?? '')}" ${draft ? '' : 'disabled'}></label>
            <label class="fc-field"><span>تعرفة BSGT SDG لكل 1,000 USD</span><input name="bsgt_tariff_per_1000_sdg" inputmode="decimal" value="${esc(f.bsgt_tariff_per_1000_sdg ?? '')}" ${draft ? '' : 'disabled'}></label>
            <label class="fc-field"><span>مصدر إذن الاستيراد</span><select name="import_permit_source" ${draft ? '' : 'disabled'}><option value="" ${!f.import_permit_source ? 'selected' : ''}>غير محدد</option><option value="client" ${f.import_permit_source === 'client' ? 'selected' : ''}>مقدم من العميل (بلا تكلفة)</option><option value="bsgt" ${f.import_permit_source === 'bsgt' ? 'selected' : ''}>تستخرجه BSGT (تُضاف التكلفة)</option></select></label>
            <label class="fc-field"><span>تكلفة الإذن SDG (عند استخراج BSGT)</span><input name="import_permit_cost_sdg" inputmode="decimal" value="${esc(f.import_permit_source === 'bsgt' ? (f.import_permit_cost_sdg ?? '') : '')}" ${draft ? '' : 'disabled'}></label>
            <label class="fc-field fc-span"><span>ملاحظات</span><textarea name="notes" rows="2" ${draft ? '' : 'disabled'}>${esc(f.notes ?? '')}</textarea></label>
            ${draft ? '<div class="fc-form-actions"><button type="submit" class="btn btn-primary btn-small">حفظ المسودة</button></div>' : ''}
          </form>
        </section>

        <section class="fc-panel">
          <header class="fc-panel-head"><div><h4>بيانات الإذن ومستندات البنك</h4><p>رقم الإذن إلزامي عند الاعتماد إن قدّمه العميل، وقبل تأكيد دفع البنك إن استخرجته BSGT. قيمة المستندات AED إلزامية قبل تأكيد دفع البنك. تُقفل بعد دفع البنك.</p></div></header>
          <form class="fc-form" data-form="bank">
            <label class="fc-field"><span>رقم إذن الاستيراد</span><input name="import_permit_no" value="${esc(f.import_permit_no ?? '')}" ${bankEditable ? '' : 'disabled'}></label>
            <label class="fc-field"><span>قيمة مستندات البنك AED</span><input name="documents_value_aed" inputmode="decimal" value="${esc(f.documents_value_aed ?? '')}" ${bankEditable ? '' : 'disabled'}></label>
            <label class="fc-field"><span>تاريخ إصدار الإذن</span><input type="date" name="import_permit_issued_at" value="${esc(f.import_permit_issued_at ?? '')}" ${bankEditable ? '' : 'disabled'}></label>
            <label class="fc-field"><span>تاريخ انتهاء الإذن</span><input type="date" name="import_permit_expires_at" value="${esc(f.import_permit_expires_at ?? '')}" ${bankEditable ? '' : 'disabled'}></label>
            <label class="fc-field fc-span"><span>جهة إصدار الإذن</span><input name="import_permit_issuer" value="${esc(f.import_permit_issuer ?? '')}" ${bankEditable ? '' : 'disabled'}></label>
            ${bankEditable ? '<div class="fc-form-actions"><button type="submit" class="btn btn-primary btn-small">حفظ بيانات البنك والإذن</button></div>' : ''}
          </form>
        </section>
      </div>

      <section class="fc-panel">
        <header class="fc-panel-head"><div><h4>الأختام</h4></div></header>
        <div class="fc-stamps">${stamps || '<span class="fc-muted">لا أختام بعد — الملف في المسودة.</span>'}</div>
      </section>

      <section class="fc-panel">
        <header class="fc-panel-head"><div><h4>سجل الأحداث</h4><p>سجل تاريخي لا يُعدَّل ولا يُحذف.</p></div></header>
        <div class="fc-events">${state.events.map(e => `<div class="fc-event"><div><b>${esc(label(EVENTS, e.event_type))}</b>${e.from_status && e.to_status && e.from_status !== e.to_status ? `<span class="fc-muted"> ${esc(label(STATUS, e.from_status))} ← ${esc(label(STATUS, e.to_status))}</span>` : ''}${e.note ? `<small>${esc(e.note)}</small>` : ''}${changesSummary(e.changes)}</div><div class="fc-event-meta">${who(e.actor_id)}<br>${esc(fmtDate(e.created_at))}${e.lock_version_after ? `<br>النسخة ${e.lock_version_after}` : ''}</div></div>`).join('') || '<div class="fc-muted">لا أحداث.</div>'}</div>
      </section>`;
    wireDetail();
  }
  function invoiceRow(i, draft) {
    const usd = String(i.currency_snapshot || '').trim().toUpperCase() === 'USD';
    return `<tr class="${i.detached_at ? 'is-detached' : ''}" data-invoice="${esc(i.id)}">
      <td><b>${esc(i.invoice_no_snapshot || '—')}</b><small>${esc(i.shipment_id.slice(0, 8))}</small></td>
      <td dir="ltr">${esc(i.amount_source_text || '—')}</td>
      <td>${esc(i.currency_snapshot || 'غير محددة')}</td>
      <td>${i.amount_usd !== null && i.amount_usd !== undefined ? fmtDecimal(i.amount_usd) : (draft ? `<input class="fc-inline" data-amount inputmode="decimal" placeholder="0.000000">` : '<span class="fc-muted">غير مؤكد</span>')}${draft && i.amount_usd !== null && i.amount_usd !== undefined ? `<br><input class="fc-inline" data-amount inputmode="decimal" placeholder="تعديل المبلغ">` : ''}</td>
      <td>${i.amount_usd_basis === 'source_usd' ? 'فاتورة بالدولار' : esc(i.amount_usd_basis || '—')}${draft && !usd ? `<br><input class="fc-inline" data-basis placeholder="أساس قيمة USD (إلزامي)" value="${esc(i.amount_usd_basis || '')}">` : ''}</td>
      <td>${i.amount_confirmed_at ? `${who(i.amount_confirmed_by)}<br><small>${esc(fmtDate(i.amount_confirmed_at))}</small>` : (i.detached_at ? '<small>مفصولة ' + esc(fmtDate(i.detached_at)) + '</small>' : '<span class="fc-muted">بانتظار التأكيد</span>')}</td>
      ${draft ? `<td><button type="button" class="btn btn-ghost btn-small" data-confirm-invoice="${esc(i.id)}">تأكيد</button></td>` : ''}
    </tr>`;
  }
  function changesSummary(changes) {
    if (!changes || typeof changes !== 'object') return '';
    const parts = [];
    for (const [key, value] of Object.entries(changes)) {
      if (Array.isArray(value) && value.length === 2 && ['bank_tariff_per_1000_sdg','bsgt_tariff_per_1000_sdg','documents_value_aed','import_permit_cost_sdg','amount_usd','import_permit_source','import_permit_no','client_name_snapshot','consignee_snapshot','consignee_count'].includes(key))
        parts.push(`${key}: ${value[0] ?? '—'} ← ${value[1] ?? '—'}`);
      else if (['added','detached','reattached'].includes(key) && Array.isArray(value) && value.length) parts.push(`${key}: ${value.length}`);
    }
    return parts.length ? `<small class="fc-changes" dir="ltr">${esc(parts.join(' · '))}</small>` : '';
  }

  function wireDetail() {
    const b = body(); const f = state.file;
    b.querySelector('[data-form="draft"]')?.addEventListener('submit', e => { e.preventDefault(); saveDraft(e.target); });
    b.querySelector('[data-form="bank"]')?.addEventListener('submit', e => { e.preventDefault(); saveBank(e.target); });
    b.querySelector('[data-action="sync"]')?.addEventListener('click', syncInvoices);
    b.querySelectorAll('[data-confirm-invoice]').forEach(btn => btn.addEventListener('click', () => confirmInvoice(btn.dataset.confirmInvoice)));
    b.querySelector('[data-action="client-search"]')?.addEventListener('click', searchClients);
    b.querySelector('[data-client-search]')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchClients(); } });
    b.querySelectorAll('[data-transition]').forEach(btn => btn.addEventListener('click', () => transition(btn.dataset.transition, btn.dataset.needsNote === 'true')));
  }

  // ---------------------------------------------------------------- writes (all through RPCs, one lock_version each)
  async function call(name, args, successText) {
    if (state.busy) return null;
    setBusy(true);
    try {
      const {data, error} = await sb().rpc(name, args);
      if (error) throw error;
      if (data?.file) { state.file = assertStrings(data.file); }
      if (successText) notify(data?.changed === false ? 'لا تغييرات جديدة.' : successText);
      await reload(state.file.id);
      return data;
    } catch (error) {
      const message = rpcError(error);
      notify(message, 'err');
      if (/تغيّر الملف/.test(message)) await reload(state.file.id);
      return null;
    } finally { setBusy(false); }
  }
  function patchFromForm(form, fields) {
    const patch = {};
    for (const [name, kind] of Object.entries(fields)) {
      const el = form.elements[name]; if (!el || el.disabled) continue;
      const raw = el.value;
      if (kind === 'decimal') { const value = normalizeDecimalInput(raw, el.closest('label')?.querySelector('span')?.textContent || name); patch[name] = value; }
      else if (kind === 'date') patch[name] = raw.trim() || null;
      else patch[name] = raw.trim() === '' ? null : raw;
    }
    return patch;
  }
  async function saveDraft(form) {
    try {
      const patch = patchFromForm(form, {bank_tariff_per_1000_sdg:'decimal', bsgt_tariff_per_1000_sdg:'decimal', import_permit_source:'text', import_permit_cost_sdg:'decimal', notes:'text'});
      if (patch.import_permit_source !== 'bsgt') delete patch.import_permit_cost_sdg;   // client ⇒ 0 automatically; none ⇒ cleared by the RPC
      else if (!patch.import_permit_cost_sdg) throw new Error('أدخل تكلفة إذن الاستيراد (أكبر من صفر) عندما تستخرجه BSGT.');
      await call('update_bsgt_financial_draft', {p_id: state.file.id, p_expected_lock_version: state.file.lock_version, p_patch: patch}, 'تم حفظ المسودة.');
    } catch (error) { notify(error.message, 'err'); }
  }
  async function saveBank(form) {
    try {
      const patch = patchFromForm(form, {import_permit_no:'text', documents_value_aed:'decimal', import_permit_issued_at:'date', import_permit_expires_at:'date', import_permit_issuer:'text'});
      if (patch.import_permit_issued_at && patch.import_permit_expires_at && patch.import_permit_expires_at < patch.import_permit_issued_at) throw new Error('تاريخ انتهاء الإذن يجب ألا يسبق تاريخ إصداره.');
      await call('update_bsgt_financial_bank_details', {p_id: state.file.id, p_expected_lock_version: state.file.lock_version, p_patch: patch}, 'تم حفظ بيانات البنك والإذن.');
    } catch (error) { notify(error.message, 'err'); }
  }
  async function syncInvoices() {
    const data = await call('sync_bsgt_financial_invoices', {p_id: state.file.id, p_expected_lock_version: state.file.lock_version}, 'تمت المزامنة مع شحنات TC.');
    if (data && data.changed) notify(`مضافة ${(data.added || []).length} · مفصولة ${(data.detached || []).length} · مُعادة ${(data.reattached || []).length}`);
  }
  async function confirmInvoice(invoiceId) {
    const row = body().querySelector(`[data-invoice="${CSS.escape(invoiceId)}"]`); if (!row) return;
    const invoice = state.invoices.find(i => i.id === invoiceId);
    try {
      const amountInput = row.querySelector('[data-amount]');
      const amount = normalizeDecimalInput(amountInput?.value ?? '', 'المبلغ المعتمد USD');
      if (amount === null) throw new Error('أدخل المبلغ المعتمد بالدولار.');
      const basisInput = row.querySelector('[data-basis]');
      const basis = basisInput ? basisInput.value.trim() : null;
      const usd = String(invoice?.currency_snapshot || '').trim().toUpperCase() === 'USD';
      if (!usd && !basis) throw new Error('عملة الفاتورة ليست USD — اذكر أساس قيمة الدولار صراحةً (لا سعر صرف تلقائي).');
      await call('confirm_bsgt_financial_invoice', {p_invoice_id: invoiceId, p_expected_lock_version: state.file.lock_version, p_amount_usd: amount, p_usd_basis: usd ? null : basis}, 'تم تأكيد مبلغ الفاتورة.');
    } catch (error) { notify(error.message, 'err'); }
  }
  async function searchClients() {
    const b = body(); const query = b.querySelector('[data-client-search]')?.value.trim() || '';
    const results = b.querySelector('[data-client-results]'); if (!results) return;
    let request = sb().from('clients').select('id,name,name_ar,name_en').eq('active', true).order('name').limit(20);
    if (query) request = request.or(`name.ilike.%${query}%,name_ar.ilike.%${query}%,name_en.ilike.%${query}%`);
    const {data, error} = await request;
    if (error) { results.innerHTML = `<div class="fc-error">${esc(rpcError(error))}</div>`; return; }
    results.innerHTML = (data || []).map(c => `<div class="fc-client-row"><div><b>${esc(c.name)}</b><small>${esc([c.name_ar, c.name_en].filter(Boolean).join(' · '))}</small></div><button type="button" class="btn btn-ghost btn-small" data-client-id="${esc(c.id)}">${state.file.client_id === c.id ? 'مؤكد' : 'تأكيد كعميل الفوترة'}</button></div>`).join('') || '<div class="fc-muted">لا نتائج.</div>';
    results.querySelectorAll('[data-client-id]').forEach(btn => btn.addEventListener('click', () => call('confirm_bsgt_financial_client', {p_id: state.file.id, p_expected_lock_version: state.file.lock_version, p_client_id: btn.dataset.clientId}, 'تم تأكيد عميل الفوترة.')));
  }
  async function transition(action, needsNote) {
    let note = null;
    if (needsNote) { note = (globalThis.prompt('سبب الإخفاق (إلزامي):') || '').trim(); if (!note) return; }
    else if (!globalThis.confirm(`تأكيد الإجراء: ${actionsFor(state.file).find(a => a.action === action)?.text || action}؟`)) return;
    const args = {p_id: state.file.id, p_expected_lock_version: state.file.lock_version, p_action: action, p_note: note, p_override_reason: null};
    setBusy(true);
    try {
      let {data, error} = await sb().rpc('transition_bsgt_financial_file', args);
      if (error && /Maker-checker/i.test(error.message) && isAdmin() && action === 'approve') {
        const reason = (globalThis.prompt('أنت آخر من أدخل قيمة مالية في هذا الملف. تجاوز فصل الإدخال عن الاعتماد متاح لمدير النظام فقط بسبب طارئ يُسجَّل في الحدث. اكتب السبب:') || '').trim();
        if (!reason) throw error;
        ({data, error} = await sb().rpc('transition_bsgt_financial_file', {...args, p_override_reason: reason}));
      }
      if (error) throw error;
      state.file = assertStrings(data.file);
      notify('تم تنفيذ الإجراء.');
    } catch (error) { notify(rpcError(error), 'err'); }
    finally { setBusy(false); await reload(state.file.id); }
  }

  return Object.freeze({TITLE, DESCRIPTION, KEYS, STATUS, PAGE_SIZE, FILE_COLUMNS, INVOICE_COLUMNS, shell, mount, fmtDecimal, normalizeDecimalInput, actionsFor, state});
});
