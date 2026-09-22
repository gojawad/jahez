/* BSGT workspace — «مركز الأرشيف»: بوابة موحّدة للمؤرشف من الشحنات والملفات التجارية
   والمستندات الموقّعة. قراءة فقط عبر دوال supabase/58_bsgt_archive_center.sql، والاستعادة
   تمرّ بـ set_bsgt_archive القائمة بلا أي تغيير عليها. الصلاحية هي صلاحية الأرشفة نفسها
   (shipments.delete أو مدير) — لا مفاتيح جديدة.
   معاينة ملف المستند من التخزين تبقى محكومة بصلاحية الإدارة كما كانت: الخادم يرجع
   can_preview، والواجهة تُظهر زر المعاينة فقط عندما يكون true. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JahezBsgtArchiveCenter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TITLE = 'مركز الأرشيف';
  const DESCRIPTION = 'الشحنات والملفات التجارية والمستندات الموقّعة المؤرشفة — بلا حذف، وقابلة للاستعادة.';
  const PERMISSION_KEY = 'bsgt.archive.view';   // من يرى البوابة
  const RESTORE_KEY = 'shipments.delete';       // من يستعيد منها (صلاحية الأرشفة القائمة)
  const PAGE_SIZE = 20;
  const BUCKET = 'trade-collection-documents';
  const SHIPMENT_BUCKET = 'shipment-files';

  const TABS = Object.freeze({
    shipments: 'الشحنات المؤرشفة',
    files: 'الملفات التجارية المؤرشفة',
    documents: 'المستندات المؤرشفة'
  });
  const RPC = Object.freeze({
    shipments: 'list_bsgt_archived_shipments',
    files: 'list_bsgt_archived_trade_files',
    documents: 'list_bsgt_archived_documents'
  });
  const TRADE_STATUS = Object.freeze({
    draft: 'مسودة مالية', sent_to_remitting: 'أُرسل للبنك المرسل', under_management_review: 'قيد مراجعة الإدارة',
    final_accepted: 'قبول نهائي', sent_to_collecting: 'أُرسل للبنك المحصل'
  });
  const STAGE = Object.freeze({
    operations_draft: 'مسودة العمليات', ready_for_finance: 'جاهزة للمالية', sent_to_remitting: 'أُرسلت للبنك المرسل',
    management_review: 'مراجعة الإدارة', final_accepted: 'قبول نهائي', sent_to_collecting: 'أُرسلت للبنك المحصل'
  });
  const DOC_TYPE = Object.freeze({ letter: 'خطاب التحصيل', undertaking: 'التعهد', exchange: 'الكمبيالة' });
  // تسميات عربية لمفاتيح بيانات الشحنة المعروفة؛ أي مفتاح آخر يُعرض باسمه كما هو.
  const DATA_LABEL = Object.freeze({
    operationNo:'رقم العملية', consignee:'المرسل إليه', consigneeAddress:'عنوان المرسل إليه',
    shipper:'المرسِل', itemDesc:'الصنف', invoiceNo:'رقم الفاتورة', proformaNo:'رقم الفاتورة المبدئية',
    currency:'العملة', totalAmount:'القيمة', quantity:'الكمية', unit:'الوحدة', hsCode:'البند الجمركي',
    paymentTerm:'شرط الدفع', creditDays:'أيام الأجل', blNo:'رقم البوليصة', containerNo:'رقم الحاوية',
    vessel:'الباخرة', portOfLoading:'ميناء الشحن', portOfDischarge:'ميناء التفريغ',
    originCountry:'بلد المنشأ', destination:'الوجهة', bank:'البنك', remittingBank:'البنك المرسل',
    collectingBank:'البنك المحصل', notes:'ملاحظات', date:'التاريخ'
  });

  // index.html يعرّف sb و toast كمتغيرات لغوية لا كخصائص على window،
  // لذلك renderBsgtWorkspace يمرّرها إلى mount(container, deps).
  const deps = { sb: null, toast: null, profile: null, formatDate: null };
  const state = {
    container: null,
    tab: 'shipments',
    busy: false,
    summary: null,
    summaryError: null,
    search: '',
    page: 1,
    rows: [],
    total: 0,
    error: null,
    detail: null   // {id, loading, error, shipment, files}
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const sb = () => deps.sb || globalThis.sb;
  const can = key => Boolean(globalThis.JahezPermissions?.can(key));
  const isAdmin = () => deps.profile?.role === 'admin';
  const canUse = () => isAdmin() || can(PERMISSION_KEY);
  const canRestore = () => isAdmin() || can(RESTORE_KEY);
  const notify = (text, kind) => {
    const fn = deps.toast || globalThis.toast;
    if (typeof fn === 'function') fn(text, kind);
    else console[kind === 'err' ? 'error' : 'log'](text);
  };
  const fmtDate = value => value
    ? (typeof deps.formatDate === 'function' ? deps.formatDate(value) : String(value).replace('T', ' ').slice(0, 16))
    : '—';
  const label = (map, key) => map[key] || key || '—';
  const dash = value => (value === null || value === undefined || value === '' ? '—' : esc(value));
  const rpcError = error => error?.message || error?.hint || 'تعذّر تنفيذ العملية.';

  function fmtSize(bytes) {
    if (bytes === null || bytes === undefined || bytes === '') return '—';
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1024) return `${n} بايت`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} كيلوبايت`;
    return `${(n / (1024 * 1024)).toFixed(1)} ميجابايت`;
  }

  function configure(next) {
    if (!next) return;
    if (next.sb) deps.sb = next.sb;
    if (next.toast) deps.toast = next.toast;
    if (next.profile) deps.profile = next.profile;
    if (next.formatDate) deps.formatDate = next.formatDate;
  }

  // ---------------------------------------------------------------- data
  async function loadSummary() {
    const { data, error } = await sb().rpc('bsgt_archive_center_summary');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row || { archived_shipments: 0, archived_trade_files: 0, archived_documents: 0 };
  }

  async function loadPage() {
    const { data, error } = await sb().rpc(RPC[state.tab], {
      p_search: state.search || null,
      p_page: state.page,
      p_page_size: PAGE_SIZE
    });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return { rows, total: rows.length ? Number(rows[0].total_count) || rows.length : 0 };
  }

  async function loadShipmentDetail(id) {
    const [card, files] = await Promise.all([
      sb().rpc('get_bsgt_archived_shipment', { p_shipment_id: id }),
      sb().rpc('list_bsgt_archived_shipment_files', { p_shipment_id: id })
    ]);
    if (card.error) throw card.error;
    if (files.error) throw files.error;
    const row = Array.isArray(card.data) ? card.data[0] : card.data;
    if (!row) throw new Error('لم تُعثر هذه الشحنة في الأرشيف.');
    return { shipment: row, files: Array.isArray(files.data) ? files.data : [] };
  }

  async function openDetail(id) {
    state.detail = { id, loading: true, error: null, shipment: null, files: [] };
    render();
    try {
      const loaded = await loadShipmentDetail(id);
      if (state.detail?.id !== id) return;
      state.detail = { id, loading: false, error: null, shipment: loaded.shipment, files: loaded.files };
    } catch (error) {
      if (state.detail?.id !== id) return;
      state.detail = { id, loading: false, error: rpcError(error), shipment: null, files: [] };
    }
    render();
  }

  function closeDetail() { state.detail = null; render(); }

  async function reload({ withSummary = true } = {}) {
    if (!state.container) return;
    state.busy = true;
    // تُفرَّغ الصفوف أولاً: لولا ذلك لظهرت صفوف التبويب السابق تحت عناوين التبويب الجديد.
    state.detail = null;
    state.rows = [];
    state.total = 0;
    state.error = null;
    render();
    try {
      if (withSummary) {
        try { state.summary = await loadSummary(); state.summaryError = null; }
        catch (error) { state.summary = null; state.summaryError = rpcError(error); }
      }
      const page = await loadPage();
      state.rows = page.rows;
      state.total = page.total;
      state.error = null;
    } catch (error) {
      state.rows = [];
      state.total = 0;
      state.error = rpcError(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function restore(kind, id, name) {
    if (!canRestore()) return notify('ليس لديك صلاحية الاستعادة من الأرشيف.', 'err');
    const what = kind === 'shipment' ? 'الشحنة' : 'الملف التجاري';
    const extra = kind === 'trade_file'
      ? '\n\nستُستعاد معه كل الشحنات المرتبطة به.'
      : '\n\nإن كان ملفها التجاري مؤرشفاً فسيُستعاد هو أيضاً.';
    if (!confirm(`استعادة ${what} ${name || ''} من الأرشيف؟${extra}`)) return;
    try {
      const { error } = await sb().rpc('set_bsgt_archive', { p_kind: kind, p_id: id, p_archived: false });
      if (error) throw error;
      notify(`تمت استعادة ${what} من الأرشيف.`, 'ok');
      await reload();
    } catch (error) {
      notify(rpcError(error), 'err');
    }
  }

  async function preview(path, bucket) {
    try {
      const { data, error } = await sb().storage.from(bucket || BUCKET).createSignedUrl(path, 300);
      if (error) throw error;
      globalThis.open(data.signedUrl, '_blank', 'noopener');
    } catch (error) {
      notify(rpcError(error), 'err');
    }
  }

  // ---------------------------------------------------------------- render
  function summaryHtml() {
    if (state.summaryError) {
      return `<div class="ac-summary-error" role="status">تعذّر تحميل ملخّص الأرشيف: ${esc(state.summaryError)}
        <button type="button" class="btn btn-ghost btn-small" data-action="retry">إعادة المحاولة</button></div>`;
    }
    const s = state.summary || {};
    const cell = (labelText, value) =>
      `<div class="ac-stat"><span>${esc(labelText)}</span><b>${value === undefined || value === null ? '—' : esc(String(value))}</b></div>`;
    return `<div class="ac-summary">
      ${cell('شحنات مؤرشفة', s.archived_shipments)}
      ${cell('ملفات تجارية مؤرشفة', s.archived_trade_files)}
      ${cell('مستندات مؤرشفة', s.archived_documents)}
    </div>`;
  }

  function tabsHtml() {
    return `<div class="ac-tabs" role="tablist">${Object.entries(TABS).map(([key, text]) =>
      `<button type="button" role="tab" class="ac-tab${state.tab === key ? ' is-active' : ''}"
        aria-selected="${state.tab === key}" data-tab="${key}">${esc(text)}</button>`).join('')}</div>`;
  }

  function shipmentRow(row) {
    return `<tr>
      <td><b>${dash(row.operation_no)}</b><small>${dash(row.consignee)}</small></td>
      <td>${dash(row.item_desc)}</td>
      <td>${dash(row.invoice_no)}</td>
      <td>${esc(label(STAGE, row.bsgt_stage))}</td>
      <td>${row.trade_file_operation_no ? esc(row.trade_file_operation_no) : '<span class="ac-muted">غير مرتبطة</span>'}</td>
      <td>${esc(fmtDate(row.archived_at))}<small>${dash(row.archived_by_name)}</small></td>
      <td class="ac-actions">
        <button type="button" class="btn btn-ghost btn-small" data-open-shipment="${esc(row.id)}">عرض</button>
        ${canRestore()
          ? `<button type="button" class="btn btn-ghost btn-small" data-restore="shipment" data-id="${esc(row.id)}" data-name="${esc(row.operation_no || '')}">استعادة</button>`
          : ''}</td>
    </tr>`;
  }

  function fileRow(row) {
    return `<tr>
      <td><b>${dash(row.operation_no)}</b><small>المراجعة ${dash(row.revision_no)}</small></td>
      <td>${esc(label(TRADE_STATUS, row.status))}</td>
      <td>${dash(row.remitting_bank)}</td>
      <td>${dash(row.collecting_bank)}</td>
      <td>${esc(String(row.shipment_count ?? 0))}</td>
      <td>${esc(String(row.document_count ?? 0))}</td>
      <td>${esc(fmtDate(row.archived_at))}<small>${dash(row.archived_by_name)}</small></td>
      <td class="ac-actions">${canRestore()
        ? `<button type="button" class="btn btn-ghost btn-small" data-restore="trade_file" data-id="${esc(row.id)}" data-name="${esc(row.operation_no || '')}">استعادة</button>`
        : ''}</td>
    </tr>`;
  }

  function documentRow(row) {
    const reason = row.document_archived_at
      ? `مؤرشف بذاته · ${esc(fmtDate(row.document_archived_at))}`
      : `تابع لملف مؤرشف · ${esc(fmtDate(row.file_archived_at))}`;
    return `<tr>
      <td><b>${esc(label(DOC_TYPE, row.document_type))}</b><small>${dash(row.file_name)}</small></td>
      <td>${dash(row.trade_file_operation_no)}<small>${esc(label(TRADE_STATUS, row.trade_file_status))}</small></td>
      <td>${dash(row.revision_no)}</td>
      <td>${esc(fmtSize(row.file_size))}</td>
      <td>${esc(fmtDate(row.created_at))}<small>${dash(row.uploaded_by_name)}</small></td>
      <td>${reason}</td>
      <td class="ac-actions">${row.can_preview
        ? `<button type="button" class="btn btn-ghost btn-small" data-preview="${esc(row.storage_path)}">معاينة</button>`
        : '<span class="ac-muted" title="فتح ملف المستند محكوم بصلاحية الإدارة كما هو في بقية النظام">المعاينة تحتاج صلاحية الإدارة</span>'}</td>
    </tr>`;
  }

  const HEADERS = Object.freeze({
    shipments: ['الشحنة', 'الصنف', 'الفاتورة', 'المرحلة', 'الملف التجاري', 'تاريخ الأرشفة', ''],
    files: ['الملف', 'الحالة', 'البنك المرسل', 'البنك المحصل', 'الشحنات', 'المستندات', 'تاريخ الأرشفة', ''],
    documents: ['المستند', 'الملف التجاري', 'المراجعة', 'الحجم', 'الرفع', 'سبب الأرشفة', '']
  });

  function tableHtml() {
    if (state.error) {
      return `<div class="ac-error" role="alert">تعذّر تحميل الأرشيف: ${esc(state.error)}
        <button type="button" class="btn btn-ghost btn-small" data-action="retry">إعادة المحاولة</button></div>`;
    }
    if (state.busy && !state.rows.length) return '<div class="ac-empty">جاري التحميل…</div>';
    if (!state.rows.length) {
      return `<div class="ac-empty">${state.search ? 'لا نتائج مطابقة للبحث.' : 'لا يوجد شيء مؤرشف في هذا القسم.'}</div>`;
    }
    const rowHtml = state.tab === 'shipments' ? shipmentRow : state.tab === 'files' ? fileRow : documentRow;
    return `<div class="ac-table-wrap" tabindex="0" role="region" aria-label="${esc(TABS[state.tab])}">
      <table class="ac-table"><thead><tr>${HEADERS[state.tab].map(text => `<th scope="col">${esc(text)}</th>`).join('')}</tr></thead>
      <tbody>${state.rows.map(rowHtml).join('')}</tbody></table></div>`;
  }

  function detailFieldsHtml(data) {
    if (!data || typeof data !== 'object') return '';
    const cells = Object.keys(data).map(key => {
      const raw = data[key];
      if (raw === null || raw === undefined || raw === '') return '';
      const value = (typeof raw === 'object') ? JSON.stringify(raw) : String(raw);
      if (!value.trim()) return '';
      return `<div class="ac-field"><span>${esc(DATA_LABEL[key] || key)}</span><b>${esc(value)}</b></div>`;
    }).filter(Boolean).join('');
    return cells ? `<div class="ac-fields">${cells}</div>` : '<p class="ac-muted">لا توجد بيانات مسجّلة لهذه الشحنة.</p>';
  }

  function detailFilesHtml(files) {
    if (!files.length) return '<p class="ac-muted">لا توجد مرفقات مرفوعة لهذه الشحنة.</p>';
    return `<div class="ac-table-wrap"><table class="ac-table"><thead><tr>
        <th scope="col">المرفق</th><th scope="col">الوصف</th><th scope="col">الحجم</th><th scope="col">الرفع</th><th scope="col"></th>
      </tr></thead><tbody>${files.map(file => `<tr>
        <td><b>${dash(file.name)}</b><small dir="ltr">${dash(file.mime)}</small></td>
        <td>${dash(file.label)}</td>
        <td>${esc(fmtSize(file.size_bytes))}</td>
        <td>${esc(fmtDate(file.created_at))}<small>${dash(file.uploaded_by_name)}</small></td>
        <td class="ac-actions"><button type="button" class="btn btn-ghost btn-small"
          data-preview-shipment-file="${esc(file.path)}">معاينة</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function detailHtml() {
    const detail = state.detail;
    if (!detail) return '';
    const head = `<header class="ac-detail-head"><h3>تفاصيل الشحنة المؤرشفة</h3>
      <button type="button" class="btn btn-ghost btn-small" data-action="close-detail">إغلاق</button></header>`;
    if (detail.loading) return `<section class="ac-detail">${head}<div class="ac-empty">جاري التحميل…</div></section>`;
    if (detail.error) {
      return `<section class="ac-detail">${head}<div class="ac-error" role="alert">تعذّر فتح الشحنة: ${esc(detail.error)}
        <button type="button" class="btn btn-ghost btn-small" data-retry-shipment="${esc(detail.id)}">إعادة المحاولة</button></div></section>`;
    }
    const s0 = detail.shipment || {};
    const stamp = `<div class="ac-fields">
      <div class="ac-field"><span>رقم العملية</span><b>${dash(s0.operation_no)}</b></div>
      <div class="ac-field"><span>المرحلة</span><b>${esc(label(STAGE, s0.bsgt_stage))}</b></div>
      <div class="ac-field"><span>تاريخ الأرشفة</span><b>${esc(fmtDate(s0.archived_at))}</b></div>
      <div class="ac-field"><span>أرشفها</span><b>${dash(s0.archived_by_name)}</b></div>
      <div class="ac-field"><span>الملف التجاري</span><b>${s0.trade_file_operation_no
        ? esc(s0.trade_file_operation_no) + ' · ' + esc(label(TRADE_STATUS, s0.trade_file_status))
        : 'غير مرتبطة'}</b></div>
      <div class="ac-field"><span>المرفقات</span><b>${esc(String(s0.file_count ?? 0))}</b></div>
    </div>`;
    return `<section class="ac-detail">${head}
      ${stamp}
      <h4>بيانات الشحنة</h4>
      ${detailFieldsHtml(s0.data)}
      <h4>مرفقات الشحنة</h4>
      ${detailFilesHtml(detail.files || [])}
    </section>`;
  }

  function pagerHtml() {
    if (state.error || state.total <= PAGE_SIZE) return '';
    const pages = Math.ceil(state.total / PAGE_SIZE);
    return `<nav class="ac-pager" aria-label="صفحات الأرشيف">
      <button type="button" class="btn btn-ghost btn-small" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>السابق</button>
      <span>صفحة ${state.page} من ${pages} · ${state.total} سجلاً</span>
      <button type="button" class="btn btn-ghost btn-small" data-page="next" ${state.page >= pages ? 'disabled' : ''}>التالي</button>
    </nav>`;
  }

  function render() {
    const host = state.container;
    if (!host) return;
    host.innerHTML = `<section class="ac-shell${state.busy ? ' is-busy' : ''}">
      <header class="ac-head">
        <div><h2>${esc(TITLE)}</h2><p>${esc(DESCRIPTION)}</p></div>
        <div class="ac-search">
          <label class="ac-sr" for="acSearch">بحث في الأرشيف</label>
          <input id="acSearch" type="search" placeholder="رقم العملية، الجهة، الصنف، الفاتورة، البنك أو اسم المستند" value="${esc(state.search)}">
          <button type="button" class="btn btn-ghost btn-small" data-action="search">بحث</button>
          ${state.search ? '<button type="button" class="btn btn-ghost btn-small" data-action="clear">مسح</button>' : ''}
        </div>
      </header>
      ${summaryHtml()}
      ${tabsHtml()}
      ${detailHtml()}
      ${tableHtml()}
      ${pagerHtml()}
      <p class="ac-note">الأرشفة لا تحذف شيئاً: السجلات ومستنداتها وأحداثها وروابط QR محفوظة، والاستعادة متاحة في أي وقت.</p>
    </section>`;
    wire(host);
  }

  function wire(host) {
    host.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
      if (state.tab === button.dataset.tab) return;
      state.tab = button.dataset.tab;
      state.page = 1;
      reload({ withSummary: false });
    }));
    const input = host.querySelector('#acSearch');
    const runSearch = () => {
      const next = String(input?.value ?? '').trim();
      if (next === state.search) return;
      state.search = next;
      state.page = 1;
      reload({ withSummary: false });
    };
    host.querySelector('[data-action="search"]')?.addEventListener('click', runSearch);
    input?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); runSearch(); } });
    host.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
      state.search = ''; state.page = 1; reload({ withSummary: false });
    });
    host.querySelector('[data-action="retry"]')?.addEventListener('click', () => reload());
    host.querySelector('[data-page="prev"]')?.addEventListener('click', () => {
      if (state.page > 1) { state.page -= 1; reload({ withSummary: false }); }
    });
    host.querySelector('[data-page="next"]')?.addEventListener('click', () => {
      if (state.page * PAGE_SIZE < state.total) { state.page += 1; reload({ withSummary: false }); }
    });
    host.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', () =>
      restore(button.dataset.restore, button.dataset.id, button.dataset.name)));
    host.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () =>
      preview(button.dataset.preview)));
    host.querySelectorAll('[data-open-shipment]').forEach(button => button.addEventListener('click', () =>
      openDetail(button.dataset.openShipment)));
    host.querySelector('[data-action="close-detail"]')?.addEventListener('click', closeDetail);
    host.querySelector('[data-retry-shipment]')?.addEventListener('click', event =>
      openDetail(event.currentTarget.dataset.retryShipment));
    host.querySelectorAll('[data-preview-shipment-file]').forEach(button => button.addEventListener('click', () =>
      preview(button.dataset.previewShipmentFile, SHIPMENT_BUCKET)));
  }

  function mount(container, options) {
    configure(options);
    state.container = container;
    state.tab = 'shipments';
    state.search = '';
    state.page = 1;
    state.rows = [];
    state.total = 0;
    state.error = null;
    state.summary = null;
    state.summaryError = null;
    state.detail = null;
    if (!container) return;
    if (!canUse()) {
      container.innerHTML = `<section class="ac-shell"><div class="ac-empty">ليس لديك صلاحية الاطلاع على الأرشيف.</div></section>`;
      return;
    }
    render();
    reload();
  }

  return Object.freeze({ TITLE, DESCRIPTION, PERMISSION_KEY, RESTORE_KEY, PAGE_SIZE, TABS, RPC, DATA_LABEL, configure, mount, fmtSize });
});
