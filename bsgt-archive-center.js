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
  const PERMISSION_KEY = 'shipments.delete';
  const PAGE_SIZE = 20;
  const BUCKET = 'trade-collection-documents';

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
    error: null
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const sb = () => deps.sb || globalThis.sb;
  const can = key => Boolean(globalThis.JahezPermissions?.can(key));
  const isAdmin = () => deps.profile?.role === 'admin';
  const canUse = () => isAdmin() || can(PERMISSION_KEY);
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

  async function reload({ withSummary = true } = {}) {
    if (!state.container) return;
    state.busy = true;
    // تُفرَّغ الصفوف أولاً: لولا ذلك لظهرت صفوف التبويب السابق تحت عناوين التبويب الجديد.
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
    if (!canUse()) return notify('ليس لديك صلاحية الاستعادة من الأرشيف.', 'err');
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

  async function preview(path) {
    try {
      const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, 300);
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
      <td class="ac-actions">${canUse()
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
      <td class="ac-actions">${canUse()
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
    if (!container) return;
    if (!canUse()) {
      container.innerHTML = `<section class="ac-shell"><div class="ac-empty">ليس لديك صلاحية الاطلاع على الأرشيف.</div></section>`;
      return;
    }
    render();
    reload();
  }

  return Object.freeze({ TITLE, DESCRIPTION, PERMISSION_KEY, PAGE_SIZE, TABS, RPC, configure, mount, fmtSize });
});
