/* BSGT workspace — «المركز المالي» phase 2: ledger UI (accounts, vouchers, reports, and the
   ledger card inside a financial file). Mounted by bsgt-financial-center.js. Every write goes
   through the phase-2 RPCs with lock_version; money is a string end to end (never Number()). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JahezBsgtFinancialLedger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEYS = Object.freeze({view:'bsgt.financial_center.view', edit:'bsgt.financial_center.edit', approve:'bsgt.financial_center.approve'});
  const PAGE_SIZE = 10;
  const TYPES = Object.freeze({
    receipt:'سند قبض', payment_bank:'سند صرف للبنك (نيابة)', payment_permit:'سند صرف إذن الاستيراد (نيابة)', refund:'سند رد للعميل',
    recovery:'سند استرداد من البنك/جهة', transfer:'تحويل بين صندوق وبنك', settlement:'تسوية العملية', failure_reclass:'إعادة تصنيف إخفاق',
    balance_transfer:'تخصيص رصيد لملف آخر', adjustment:'تسوية تكلفة بعد الاعتماد'
  });
  const VSTATUS = Object.freeze({draft:'مسودة', posted:'مرحّل', reversed:'معكوس', cancelled:'ملغى'});
  const PURPOSE = Object.freeze({file_transfer:'تحويل تكلفة العملية', commission_advance:'عمولة مقدّمة', other:'أخرى'});
  const ROLES = Object.freeze({group:'مجموعة', cash:'صندوق', bank:'بنك', client_control:'حسابات العملاء', paid_bank:'مدفوع للبنك نيابة', paid_permit:'مدفوع للإذن نيابة', recoverable:'مستحق استرداده', commission_revenue:'إيراد العمولة'});
  const LEDGER_EVENTS = Object.freeze({created:'إنشاء', draft_updated:'تعديل المسودة', posted:'ترحيل', reversed:'عكس', cancelled:'إلغاء', ledger_opened:'فتح الدفتر', delivery_confirmed:'تأكيد التسليم',
    costs_approved:'اعتماد التكاليف الفعلية', refund_allocation_approved:'اعتماد التخصيص بدل الرد', account_created:'إنشاء حساب', account_updated:'تعديل حساب', chart_initialised:'تهيئة الدليل', file_vouchers_enabled:'تفعيل سندات الملفات'});
  const MONEY_KEYS = ['amount','debit','credit','balance','debit_total','credit_total','balance_debit','balance_credit'];

  const deps = {sb:null, toast:null, profile:null, formatDate:null, fmtDecimal:null, normalizeDecimalInput:null, rpcError:null};
  const state = {container:null, tab:'vouchers', busy:false, accounts:[], settings:null,
    vouchers:{filters:{status:'', type:'', search:''}, rows:[], cursors:[], next:null, current:null, open:null, form:null},
    reports:{kind:'trial', clientId:'', clientText:'', fileId:'', fileText:'', from:'', to:'', rows:[]}};

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const sb = () => deps.sb || globalThis.sb;
  const can = key => Boolean(globalThis.JahezPermissions?.can(key));
  const isAdmin = () => deps.profile?.role === 'admin';
  const notify = (text, kind) => { const fn = deps.toast || globalThis.toast; if (typeof fn === 'function') fn(text, kind); else console[kind === 'err' ? 'error' : 'log'](text); };
  const fmtDate = value => value ? (typeof deps.formatDate === 'function' ? deps.formatDate(value) : String(value).replace('T',' ').slice(0,16)) : '—';
  const money = (v, o) => deps.fmtDecimal ? deps.fmtDecimal(v, o) : esc(v ?? '—');
  const dec = (raw, name) => deps.normalizeDecimalInput ? deps.normalizeDecimalInput(raw, name) : String(raw ?? '').trim() || null;
  const label = (map, key) => map[key] || key || '—';
  // request_id for idempotent creation (crypto.randomUUID needs a secure context; fall back to getRandomValues).
  function requestId() {
    const c = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID();
    const b = new Uint8Array(16); (c?.getRandomValues ? c.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); }));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  // Zero test on the decimal string itself (no Number()).
  const isZero = text => text === null || text === undefined || /^-?0*(\.0*)?$/.test(String(text).trim());
  function rpcError(error) {
    const message = String(error?.message || error || 'خطأ غير معروف');
    if (/version changed/i.test(message)) return 'تغيّر السجل من مستخدم آخر؛ أُعيد تحميله — راجع وأعد المحاولة.';
    if (/Maker-checker/i.test(message)) return 'لا يمكن لآخر من عدّل السند أن يرحّله (فصل الإدخال عن الاعتماد).';
    if (/permission required/i.test(message)) return 'ليس لديك الصلاحية المطلوبة لهذا الإجراء.';
    if (/more than 6 decimal/i.test(message)) return 'القيمة تحتوي أكثر من 6 خانات عشرية؛ التقريب غير مسموح.';
    if (/not enabled for this company/i.test(message)) return 'سندات الملفات غير مفعّلة بعد (التفعيل بعد النشر والمراجعة).';
    if (/components changed since the draft was reviewed/i.test(message)) return 'تغيّرت مكوّنات التسوية منذ مراجعة المسودة — حدّث المسودة وراجعها ثم رحّل.';
    if (/Reverse the later voucher/i.test(message)) return 'يوجد سند مرحّل لاحق يعتمد على هذا السند — اعكسه أولاً: ' + message.replace(/^.*Reverse the later voucher /, '');
    return message;
  }
  function assertStrings(row) {
    for (const key of MONEY_KEYS) if (row && typeof row[key] === 'number') throw new Error(`القيمة المالية ${key} وصلت كرقم بدل نص — أوقفنا العرض حفاظاً على الدقة.`);
    return row;
  }
  async function rpc(name, args) { const {data, error} = await sb().rpc(name, args); if (error) throw error; return data; }
  function setBusy(flag) { state.busy = flag; state.container?.querySelectorAll('button, input, select, textarea').forEach(el => { el.disabled = flag || el.dataset.disabled === 'true'; }); }

  // ---------------------------------------------------------------- shared loads
  async function loadSettings() {
    // خطأ القراءة يُرفع ولا يُفسَّر كـ«غير مفعّل»
    const {data, error} = await sb().from('fin_ledger_settings').select('company_id,file_vouchers_enabled').limit(1).maybeSingle();
    if (error) throw new Error('تعذر قراءة إعدادات الدفتر: ' + rpcError(error));
    state.settings = {file_vouchers_enabled: Boolean(data?.file_vouchers_enabled)};
    return state.settings;
  }
  async function loadAccounts() {
    const data = await rpc('list_fin_accounts', {});
    state.accounts = (data || []).map(assertStrings);
    return state.accounts;
  }
  const cashAccounts = () => state.accounts.filter(a => ['cash','bank'].includes(a.role) && a.active);
  const accountOptions = (list, selected) => `<option value="">— اختر —</option>` + list.map(a => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name_ar)}</option>`).join('');

  function configure(options = {}) { Object.assign(deps, options); }

  // ---------------------------------------------------------------- pickers: client by name, financial file by TC number (the id travels in a hidden input)
  function pickerHtml(name, {label, value = '', text = '', locked = false, placeholder = ''} = {}) {
    return `<span class="fc-picker" data-picker="${esc(name)}" data-kind="${name === 'client_id' ? 'client' : 'file'}">
      <input type="hidden" name="${esc(name)}" value="${esc(value)}">
      <span class="fc-picker-chosen" data-chosen>${text ? esc(text) : (value ? esc(value).slice(0, 8) + '…' : '<span class="fc-muted">لم يُختر</span>')}</span>
      ${locked ? '' : `<span class="fc-picker-search"><input type="search" data-picker-query placeholder="${esc(placeholder || (name === 'client_id' ? 'اسم العميل' : 'رقم TC'))}" aria-label="${esc(label || name)}"><button type="button" class="btn btn-ghost btn-small" data-picker-go>بحث</button></span><span class="fc-picker-results" data-picker-results></span>`}
    </span>`;
  }
  async function searchClientsByName(query) {
    let request = sb().from('clients').select('id,name,name_ar,name_en').eq('active', true).order('name').limit(10);
    if (query) request = request.or(`name.ilike.%${query}%,name_ar.ilike.%${query}%,name_en.ilike.%${query}%`);
    const {data, error} = await request; if (error) throw error;
    return (data || []).map(c => ({id: c.id, text: c.name, sub: [c.name_ar, c.name_en].filter(Boolean).join(' · ')}));
  }
  async function searchFilesByTc(query) {
    const rows = await rpc('list_bsgt_financial_files', {p_search: query || null, p_limit: 10});
    return (rows || []).map(f => ({id: f.id, text: f.operation_no || f.id.slice(0, 8), sub: [f.client_name_snapshot || f.consignee_snapshot, f.status].filter(Boolean).join(' · '), client_id: f.client_id, client_name: f.client_name_snapshot}));
  }
  function wirePickers(root, onPick) {
    root.querySelectorAll('[data-picker]').forEach(box => {
      const go = box.querySelector('[data-picker-go]'), q = box.querySelector('[data-picker-query]'), out = box.querySelector('[data-picker-results]'); if (!go) return;
      const search = async () => {
        out.innerHTML = '<span class="fc-muted">جارٍ البحث…</span>';
        try {
          const items = box.dataset.kind === 'client' ? await searchClientsByName(q.value.trim()) : await searchFilesByTc(q.value.trim());
          out.innerHTML = items.length ? items.map((it, i) => `<button type="button" class="fc-picker-item" data-pick="${i}"><b>${esc(it.text)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('') : '<span class="fc-muted">لا نتائج.</span>';
          out.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => {
            const it = items[Number(btn.dataset.pick)];
            box.querySelector('input[type="hidden"]').value = it.id; box.querySelector('[data-chosen]').textContent = it.text; out.innerHTML = ''; q.value = '';
            if (typeof onPick === 'function') onPick(box.dataset.picker, it);
          }));
        } catch (error) { out.innerHTML = `<span class="fc-error">${esc(rpcError(error))}</span>`; }
      };
      go.addEventListener('click', search);
      q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    });
  }

  // ---------------------------------------------------------------- mount (tabs other than the files list)
  async function mount(container, tab, options = {}) {
    Object.assign(deps, options);
    state.container = container; state.tab = tab;
    container.innerHTML = '<div class="fc-muted fc-panel">جارٍ التحميل…</div>';
    try {
      await Promise.all([loadSettings(), loadAccounts()]);
      if (tab === 'accounts') renderAccounts();
      else if (tab === 'reports') renderReports();
      else { renderVouchers(); await loadVouchers(null); }
    } catch (error) {
      container.innerHTML = `<div class="fc-error fc-panel">تعذر تحميل الدفتر: ${esc(rpcError(error))} <button type="button" class="btn btn-ghost btn-small" data-action="retry-ledger">إعادة المحاولة</button></div>`;
      container.querySelector('[data-action="retry-ledger"]').addEventListener('click', () => mount(container, tab, options));
    }
  }

  // ---------------------------------------------------------------- accounts
  function renderAccounts() {
    const c = state.container; const seeded = state.accounts.some(a => a.is_system);
    c.innerHTML = `
      <section class="fc-panel">
        <header class="fc-panel-head"><div><h4>دليل الحسابات</h4><p>حسابات نظامية ثابتة (1410، 1420، 1500، 2100، 4100) وصناديق/بنوك فعلية تُنشأ يدوياً بلا رصيد افتتاحي. الأرصدة من القيود المرحّلة فقط.</p></div>
          <div class="fc-head-actions">${can(KEYS.approve) && !seeded ? '<button type="button" class="btn btn-primary btn-small" data-action="init-chart">تهيئة الدليل</button>' : ''}${can(KEYS.approve) && seeded ? '<button type="button" class="btn btn-primary btn-small" data-action="new-account">إضافة صندوق/بنك</button>' : ''}</div></header>
        <div data-account-form></div>
        <div class="fc-table-wrap"><table class="fc-table"><thead><tr><th>الكود</th><th>الاسم</th><th>النوع</th><th>مدين</th><th>دائن</th><th>الرصيد</th><th></th></tr></thead>
          <tbody>${state.accounts.map(a => `<tr class="${a.active ? '' : 'is-detached'}"><td><b dir="ltr">${esc(a.code)}</b></td><td>${esc(a.name_ar)}${a.is_system ? '<small>حساب نظامي</small>' : ''}${a.active ? '' : '<small>موقوف</small>'}</td><td>${esc(label(ROLES, a.role))}</td><td>${a.postable ? money(a.debit_total) : ''}</td><td>${a.postable ? money(a.credit_total) : ''}</td><td>${a.postable ? money(a.balance) : ''}</td>
            <td>${can(KEYS.approve) && !a.is_system ? `<button type="button" class="btn btn-ghost btn-small" data-edit-account="${esc(a.id)}">تعديل</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="fc-muted">لم يُهيَّأ الدليل بعد.</td></tr>'}</tbody></table></div>
      </section>`;
    c.querySelector('[data-action="init-chart"]')?.addEventListener('click', async () => { await run(() => rpc('init_fin_chart', {}), 'تمت تهيئة دليل الحسابات.'); await loadAccounts(); renderAccounts(); });
    c.querySelector('[data-action="new-account"]')?.addEventListener('click', () => accountForm(null));
    c.querySelectorAll('[data-edit-account]').forEach(btn => btn.addEventListener('click', () => accountForm(state.accounts.find(a => a.id === btn.dataset.editAccount))));
  }
  function accountForm(account) {
    const host = state.container.querySelector('[data-account-form]');
    host.innerHTML = `<form class="fc-form" data-form="account">
      <label class="fc-field"><span>الكود (أرقام، 4–12 خانة)</span><input name="code" value="${esc(account?.code ?? '')}" ${account ? 'disabled' : ''} placeholder="1101"></label>
      <label class="fc-field"><span>الاسم</span><input name="name_ar" value="${esc(account?.name_ar ?? '')}" required></label>
      <label class="fc-field"><span>النوع</span><select name="role" ${account ? 'disabled' : ''}><option value="cash" ${account?.role === 'cash' ? 'selected' : ''}>صندوق (تحت 1100)</option><option value="bank" ${account?.role === 'bank' ? 'selected' : ''}>بنك (تحت 1200)</option></select></label>
      ${account ? `<label class="fc-field"><span>الحالة</span><select name="active"><option value="true" ${account.active ? 'selected' : ''}>نشط</option><option value="false" ${account.active ? '' : 'selected'}>موقوف</option></select></label>` : ''}
      <div class="fc-form-actions"><button type="submit" class="btn btn-primary btn-small">${account ? 'حفظ' : 'إنشاء'}</button><button type="button" class="btn btn-ghost btn-small" data-action="cancel-account">إلغاء</button></div></form>`;
    host.querySelector('[data-action="cancel-account"]').addEventListener('click', () => { host.innerHTML = ''; });
    host.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault(); const el = e.target.elements;
      const ok = account
        ? await run(() => rpc('update_fin_account', {p_id: account.id, p_expected_lock_version: account.lock_version, p_patch: {name_ar: el.name_ar.value.trim(), active: el.active.value === 'true'}}), 'تم حفظ الحساب.')
        : await run(() => rpc('create_fin_account', {p: {code: el.code.value.trim(), name_ar: el.name_ar.value.trim(), role: el.role.value}}), 'تم إنشاء الحساب.');
      if (ok !== null) { await loadAccounts(); renderAccounts(); }
    });
  }

  // ---------------------------------------------------------------- vouchers list
  function renderVouchers() {
    const c = state.container; const v = state.vouchers;
    c.innerHTML = `
      <section class="fc-panel">
        <header class="fc-panel-head"><div><h4>السندات والقيود</h4><p>مسودة ← ترحيل (قيد متوازن) ← عكس بقيد مرآة. الترقيم يُمنح عند الترحيل. ${state.settings?.file_vouchers_enabled ? '' : '<b>سندات الملفات غير مفعّلة بعد</b> — التحويلات بين الصناديق والبنوك متاحة.'}</p></div>
          <div class="fc-head-actions">${can(KEYS.edit) ? '<button type="button" class="btn btn-primary btn-small" data-action="new-voucher">سند جديد</button>' : ''}</div></header>
        <div data-voucher-form></div>
        <div class="fc-toolbar">
          <label class="fc-field"><span>بحث</span><input type="search" data-vf="search" value="${esc(v.filters.search)}" placeholder="رقم السند، المرجع، العميل، رقم TC"></label>
          <label class="fc-field"><span>الحالة</span><select data-vf="status"><option value="">الكل</option>${Object.entries(VSTATUS).map(([k,t]) => `<option value="${k}" ${v.filters.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label class="fc-field"><span>النوع</span><select data-vf="type"><option value="">الكل</option>${Object.entries(TYPES).map(([k,t]) => `<option value="${k}" ${v.filters.type === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <button type="button" class="btn btn-ghost btn-small" data-action="apply-vf">تطبيق</button>
        </div>
        <div class="fc-table-wrap"><table class="fc-table" data-voucher-table><thead><tr><th>السند</th><th>النوع</th><th>الحالة</th><th>التاريخ</th><th>المبلغ SDG</th><th>العميل / الملف</th><th>الحساب</th></tr></thead>
          <tbody data-voucher-rows><tr><td colspan="7" class="fc-muted">جارٍ التحميل…</td></tr></tbody></table></div>
        <div class="fc-pager"><button type="button" class="btn btn-ghost btn-small" data-action="v-prev" disabled>السابق</button><span data-v-info></span><button type="button" class="btn btn-ghost btn-small" data-action="v-next" disabled>التالي</button></div>
      </section>
      <div data-voucher-detail></div>`;
    c.querySelector('[data-action="apply-vf"]').addEventListener('click', () => { readVf(); v.cursors = []; loadVouchers(null); });
    c.querySelector('[data-vf="search"]').addEventListener('keydown', e => { if (e.key === 'Enter') { readVf(); v.cursors = []; loadVouchers(null); } });
    c.querySelector('[data-action="v-next"]').addEventListener('click', () => { if (v.next) { v.cursors.push(v.current || null); loadVouchers(v.next); } });
    c.querySelector('[data-action="v-prev"]').addEventListener('click', () => { if (v.cursors.length) loadVouchers(v.cursors.pop()); });
    c.querySelector('[data-action="new-voucher"]')?.addEventListener('click', () => voucherForm(null, {}));
  }
  function readVf() { const c = state.container; const f = state.vouchers.filters; f.search = c.querySelector('[data-vf="search"]').value.trim(); f.status = c.querySelector('[data-vf="status"]').value; f.type = c.querySelector('[data-vf="type"]').value; }
  async function loadVouchers(cursor, extra = {}) {
    const c = state.container; const rowsEl = c?.querySelector('[data-voucher-rows]'); if (!rowsEl) return;
    const v = state.vouchers;
    try {
      const data = await rpc('list_fin_vouchers', {p_status: v.filters.status || null, p_type: v.filters.type || null, p_file: extra.file || null, p_client: null, p_search: v.filters.search || null,
        p_limit: PAGE_SIZE, p_after_created_at: cursor?.created_at || null, p_after_id: cursor?.id || null});
      const rows = (data || []).map(assertStrings); v.rows = rows; v.current = cursor;
      const last = rows[rows.length - 1]; v.next = rows.length === PAGE_SIZE && last ? {created_at: last.created_at, id: last.id} : null;
      rowsEl.innerHTML = rows.length ? rows.map(r => `<tr data-open-voucher="${esc(r.id)}"><td><b dir="ltr">${esc(r.voucher_no || 'مسودة')}</b><small>${esc(r.reference || '')}</small></td><td>${esc(label(TYPES, r.voucher_type))}${r.purpose && r.voucher_type === 'receipt' ? `<small>${esc(label(PURPOSE, r.purpose))}</small>` : ''}</td>
        <td><span class="fc-status is-v-${esc(r.status)}">${esc(label(VSTATUS, r.status))}</span></td><td>${esc(r.voucher_date)}</td><td>${money(r.amount)}</td><td>${esc(r.client_name || '—')}${r.operation_no ? `<small>${esc(r.operation_no)}</small>` : ''}</td><td dir="ltr">${esc(r.cash_account_code || '—')}</td></tr>`).join('')
        : '<tr><td colspan="7" class="fc-muted">لا سندات مطابقة.</td></tr>';
      rowsEl.querySelectorAll('[data-open-voucher]').forEach(tr => tr.addEventListener('click', () => openVoucher(tr.dataset.openVoucher)));
      c.querySelector('[data-action="v-prev"]').disabled = !v.cursors.length; c.querySelector('[data-action="v-next"]').disabled = !v.next;
      c.querySelector('[data-v-info]').textContent = rows.length ? `صفحة ${v.cursors.length + 1} · ${rows.length} سند` : '';
    } catch (error) { rowsEl.innerHTML = `<tr><td colspan="7" class="fc-error">${esc(rpcError(error))}</td></tr>`; }
  }

  // ---------------------------------------------------------------- voucher form (create / edit draft)
  const FIELDS = {
    receipt:['voucher_date','cash_account_id','client_id','financial_file_id','purpose','amount','reference','memo'],
    payment_bank:['voucher_date','cash_account_id','financial_file_id','amount','reference','memo'],
    payment_permit:['voucher_date','cash_account_id','financial_file_id','amount','reference','memo'],
    refund:['voucher_date','cash_account_id','client_id','financial_file_id','amount','reference','memo'],
    recovery:['voucher_date','cash_account_id','financial_file_id','counter_account_id','amount','reference','memo'],
    transfer:['voucher_date','cash_account_id','counter_account_id','amount','reference','memo'],
    settlement:['voucher_date','financial_file_id','memo'],
    failure_reclass:['voucher_date','financial_file_id','reason','memo'],
    balance_transfer:['voucher_date','client_id','financial_file_id','target_file_id','amount','reason','memo'],
    adjustment:['voucher_date','financial_file_id','counter_account_id','direction','amount','reason','memo']
  };
  const FIELD_LABELS = {voucher_date:'التاريخ', cash_account_id:'الصندوق/البنك', client_id:'العميل', financial_file_id:'الملف المالي (رقم TC)', target_file_id:'الملف المالي الهدف (رقم TC)', purpose:'الغرض',
    amount:'المبلغ SDG', reference:'المرجع (رقم الحوالة/الإشعار)', memo:'البيان', reason:'السبب (إلزامي)', counter_account_id:'الحساب المقابل', direction:'الاتجاه'};
  function voucherForm(voucher, preset, host) {
    host = host || state.container.querySelector('[data-voucher-form]'); if (!host) return;
    const type = voucher?.voucher_type || preset.voucher_type || 'receipt';
    // معرّف طلب ثابت لهذا النموذج: إعادة المحاولة بعد انقطاع الرد تحمل المعرّف نفسه فلا تتكرر المسودة (create_fin_voucher idempotent)
    const createRequestId = preset.requestId || requestId();
    const value = key => voucher?.[key] ?? preset[key] ?? '';
    const isFile = type !== 'transfer' && !(type === 'receipt' || type === 'refund');
    const fileLocked = Boolean(preset.financial_file_id);
    const control = key => {
      switch (key) {
        case 'voucher_date': return `<input type="date" name="voucher_date" value="${esc(value('voucher_date') || new Date().toISOString().slice(0, 10))}" max="${new Date().toISOString().slice(0, 10)}">`;
        case 'cash_account_id': return `<select name="cash_account_id">${accountOptions(cashAccounts(), value('cash_account_id'))}</select>`;
        case 'counter_account_id': {
          const list = type === 'transfer' ? cashAccounts() : type === 'recovery' ? state.accounts.filter(a => ['recoverable','paid_bank','paid_permit'].includes(a.role)) : state.accounts.filter(a => ['paid_bank','paid_permit','commission_revenue'].includes(a.role));
          return `<select name="counter_account_id">${accountOptions(list, value('counter_account_id'))}</select>`; }
        case 'purpose': return `<select name="purpose">${Object.entries(PURPOSE).map(([k,t]) => `<option value="${k}" ${value('purpose') === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
        case 'direction': return `<select name="direction"><option value="charge" ${value('direction') === 'charge' ? 'selected' : ''}>تحميل على العميل (زيادة تكلفة)</option><option value="credit" ${value('direction') === 'credit' ? 'selected' : ''}>لصالح العميل (نقص تكلفة)</option></select>`;
        case 'amount': return `<input name="amount" inputmode="decimal" value="${esc(value('amount'))}" placeholder="0.000000">`;
        case 'memo': case 'reason': return `<textarea name="${key}" rows="2">${esc(value(key))}</textarea>`;
        case 'financial_file_id': case 'target_file_id': case 'client_id': {
          const labels = preset.labels || {};
          return pickerHtml(key, {label: FIELD_LABELS[key], value: value(key), text: labels[key] || (voucher ? (key === 'client_id' ? voucher.client_name : voucher.operation_no) : '') || '', locked: key !== 'target_file_id' && fileLocked}); }
        default: return `<input name="${key}" value="${esc(value(key))}">`;
      }
    };
    host.innerHTML = `<form class="fc-form fc-voucher-form" data-form="voucher">
      <label class="fc-field fc-span"><span>نوع السند</span><select name="voucher_type" ${voucher || preset.voucher_type ? 'disabled' : ''}>${Object.entries(TYPES).map(([k,t]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${FIELDS[type].map(key => `<label class="fc-field ${['memo','reason'].includes(key) ? 'fc-span' : ''}"><span>${FIELD_LABELS[key]}</span>${control(key)}</label>`).join('')}
      ${['settlement','failure_reclass'].includes(type) ? '<p class="fc-muted fc-span">المبلغ يُحسب عند الترحيل من المكوّنات المعتمدة؛ تظهر المعاينة في المسودة ويُرفض الترحيل إن تغيّرت بعد المراجعة.</p>' : ''}
      <div class="fc-form-actions"><button type="submit" class="btn btn-primary btn-small">${voucher ? 'حفظ المسودة' : 'إنشاء مسودة'}</button><button type="button" class="btn btn-ghost btn-small" data-action="cancel-form">إلغاء</button></div></form>`;
    if (!voucher && !preset.voucher_type) host.querySelector('[name="voucher_type"]').addEventListener('change', e => voucherForm(null, {...preset, voucher_type: e.target.value, requestId: createRequestId}, host));
    // اختيار ملف يملأ العميل تلقائياً (عميل الفوترة للملف)
    wirePickers(host, (name, it) => { if (name === 'financial_file_id' && it.client_id) { const cp = host.querySelector('[data-picker="client_id"]'); if (cp) { cp.querySelector('input[type="hidden"]').value = it.client_id; cp.querySelector('[data-chosen]').textContent = it.client_name || it.client_id.slice(0, 8); } } });
    host.querySelector('[data-action="cancel-form"]').addEventListener('click', () => { host.innerHTML = ''; });
    host.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const el = e.target.elements; const p = {};
        for (const key of FIELDS[type]) {
          const raw = el[key]?.value ?? '';
          if (key === 'amount') { const a = dec(raw, FIELD_LABELS.amount); if (a !== null) p.amount = a; }
          else if (raw.trim() !== '') p[key] = raw.trim();
        }
        let data;
        if (voucher) data = await run(() => rpc('update_fin_voucher_draft', {p_id: voucher.id, p_expected_lock_version: voucher.lock_version, p_patch: p}), 'تم حفظ المسودة.');
        else data = await run(() => rpc('create_fin_voucher', {p: {...p, voucher_type: type, request_id: createRequestId}}), 'تم إنشاء المسودة.');
        if (data) { host.innerHTML = ''; if (typeof preset.onDone === 'function') preset.onDone(data); else { await loadVouchers(null); await openVoucher(data.voucher_id || data.voucher?.id); } }
      } catch (error) { notify(error.message, 'err'); }
    });
  }

  // ---------------------------------------------------------------- voucher detail
  async function openVoucher(id, host) {
    host = host || state.container.querySelector('[data-voucher-detail]'); if (!host) return;
    host.innerHTML = '<div class="fc-muted fc-panel">جارٍ التحميل…</div>';
    try {
      const data = await rpc('get_fin_voucher', {p_id: id});
      const v = assertStrings(data.voucher); state.vouchers.open = v;
      const entry = e => e ? `<div class="fc-table-wrap"><table class="fc-table"><thead><tr><th>#</th><th>الحساب</th><th>مدين</th><th>دائن</th><th>البيان</th></tr></thead><tbody>${(e.lines || []).map(l => `<tr><td>${l.line_no}</td><td><b dir="ltr">${esc(l.account_code)}</b> ${esc(l.account_name)}</td><td>${money(l.debit)}</td><td>${money(l.credit)}</td><td>${esc(l.memo || '')}</td></tr>`).join('')}</tbody></table></div><small class="fc-muted">القيد ${esc(e.entry_no)} · ${esc(e.entry_date)} · إجمالي ${esc(e.total_debit)} = ${esc(e.total_credit)}</small>` : '';
      const details = v.details && Object.keys(v.details).filter(k => !['lines','preview'].includes(k)).length ? `<details class="fc-detached"><summary>المكوّنات والتفاصيل</summary><div class="fc-costs">${Object.entries(v.details).filter(([k]) => !['lines','preview'].includes(k)).map(([k, val]) => `<div><span dir="ltr">${esc(k)}</span><b>${typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val) ? money(val) : esc(String(val))}</b></div>`).join('')}</div></details>` : '';
      const actions = [];
      if (v.status === 'draft' && can(KEYS.edit)) { actions.push(['edit','تعديل المسودة','btn-ghost'], ['cancel','إلغاء المسودة','btn-ghost fc-danger']); if (['settlement','failure_reclass'].includes(v.voucher_type)) actions.push(['refresh','تحديث المعاينة','btn-ghost']); }
      if (v.status === 'draft' && can(KEYS.approve)) actions.push(['post','ترحيل','btn-primary']);
      if (v.status === 'posted' && can(KEYS.approve)) actions.push(['reverse','عكس بقيد مقابل','btn-ghost fc-danger']);
      host.innerHTML = `<section class="fc-panel" data-voucher="${esc(v.id)}">
        <header class="fc-panel-head"><div><h4>${esc(label(TYPES, v.voucher_type))} <b dir="ltr">${esc(v.voucher_no || '(مسودة)')}</b> <span class="fc-status is-v-${esc(v.status)}">${esc(label(VSTATUS, v.status))}</span></h4>
          <p>${esc(v.voucher_date)} · المبلغ ${money(v.amount)} · النسخة ${v.lock_version}${v.reference ? ' · ' + esc(v.reference) : ''}${v.memo ? ' · ' + esc(v.memo) : ''}${v.reason ? ' · السبب: ' + esc(v.reason) : ''}</p></div>
          <div class="fc-head-actions">${actions.map(([a, t, c]) => `<button type="button" class="btn ${c} btn-small" data-vaction="${a}">${t}</button>`).join('')}<button type="button" class="btn btn-ghost btn-small" data-vaction="close">إغلاق</button></div></header>
        ${details}
        ${data.entry ? `<h5>قيد الترحيل</h5>${entry(data.entry)}` : '<p class="fc-muted">لم يُرحَّل بعد.</p>'}
        ${data.reversal_entry ? `<h5>قيد العكس (مرآة الأصل — الأصل لا يُمس)</h5>${entry(data.reversal_entry)}<p class="fc-muted">سبب العكس: ${esc(v.reversal_reason || '')}</p>` : ''}
        <details class="fc-detached"><summary>سجل الأحداث (${(data.events || []).length})</summary><div class="fc-events">${(data.events || []).map(e => `<div class="fc-event"><div><b>${esc(label(LEDGER_EVENTS, e.event_type))}</b>${e.note ? `<small>${esc(e.note)}</small>` : ''}${e.changes ? `<small class="fc-changes" dir="ltr">${esc(JSON.stringify(e.changes))}</small>` : ''}</div><div class="fc-event-meta">${esc(fmtDate(e.created_at))}${e.lock_version_after ? `<br>النسخة ${e.lock_version_after}` : ''}</div></div>`).join('')}</div></details>
      </section>`;
      host.querySelectorAll('[data-vaction]').forEach(btn => btn.addEventListener('click', () => voucherAction(btn.dataset.vaction, v, host)));
    } catch (error) { host.innerHTML = `<div class="fc-error fc-panel">${esc(rpcError(error))}</div>`; }
  }
  async function voucherAction(action, v, host) {
    if (action === 'close') { host.innerHTML = ''; return; }
    if (action === 'edit') {
      const row = state.vouchers.rows.find(r => r.id === v.id);
      voucherForm(v, {labels: {client_id: row?.client_name || '', financial_file_id: row?.operation_no || ''}}, host); return;
    }
    let data = null;
    if (action === 'refresh') data = await run(() => rpc('update_fin_voucher_draft', {p_id: v.id, p_expected_lock_version: v.lock_version, p_patch: {}}), 'تم تحديث المعاينة.');
    else if (action === 'cancel') { const reason = globalThis.prompt('سبب الإلغاء (اختياري):'); if (reason === null) return; data = await run(() => rpc('cancel_fin_voucher', {p_id: v.id, p_expected_lock_version: v.lock_version, p_reason: reason || null}), 'أُلغيت المسودة.'); }
    else if (action === 'post') {
      if (!globalThis.confirm(`ترحيل ${label(TYPES, v.voucher_type)} ${v.voucher_no || ''}؟ سيُنشأ قيد متوازن لا يُعدَّل بعدها.`)) return;
      data = await run(async () => {
        try { return await rpc('post_fin_voucher', {p_id: v.id, p_expected_lock_version: v.lock_version, p_override_reason: null}); }
        catch (error) {
          if (/Maker-checker/i.test(error.message) && isAdmin()) {
            const reason = (globalThis.prompt('أنت آخر من عدّل هذا السند. تجاوز فصل الإدخال عن الاعتماد متاح لمدير النظام فقط بسبب يُسجَّل. اكتب السبب:') || '').trim();
            if (reason) return rpc('post_fin_voucher', {p_id: v.id, p_expected_lock_version: v.lock_version, p_override_reason: reason});
          }
          throw error;
        }
      }, 'تم الترحيل.');
    } else if (action === 'reverse') { const reason = (globalThis.prompt('سبب العكس (إلزامي):') || '').trim(); if (!reason) return; data = await run(() => rpc('reverse_fin_voucher', {p_id: v.id, p_expected_lock_version: v.lock_version, p_reason: reason}), 'تم العكس بقيد مقابل.'); }
    if (host?.hasAttribute('data-ledger-voucher') && typeof state.onFileChange === 'function') {
      // داخل بطاقة الملف: أعد تحميل الملف (يعيد رسم البطاقة) ثم أعد فتح السند في الحاوية الجديدة
      await state.onFileChange();
      const again = document.querySelector('[data-ledger-voucher]');
      if (again) await openVoucher(v.id, again);
      return;
    }
    if (state.tab === 'vouchers' && state.container?.querySelector('[data-voucher-rows]')) await loadVouchers(state.vouchers.current);
    await openVoucher(v.id, host);
  }
  async function run(fn, successText) {
    if (state.busy) return null;
    setBusy(true);
    try { const data = await fn(); if (successText) notify(data?.changed === false ? 'لا تغييرات جديدة.' : successText); return data ?? {}; }
    catch (error) { notify(rpcError(error), 'err'); return null; }
    finally { setBusy(false); }
  }

  // ---------------------------------------------------------------- reports
  function renderReports() {
    const c = state.container; const r = state.reports;
    c.innerHTML = `<section class="fc-panel">
      <header class="fc-panel-head"><div><h4>التقارير</h4><p>ميزان المراجعة وكشف حساب العميل من القيود المرحّلة (الأصل وعكسه معاً). الأرقام نصوص بلا تقريب.</p></div></header>
      <div class="fc-toolbar">
        <label class="fc-field"><span>التقرير</span><select data-rf="kind"><option value="trial" ${r.kind === 'trial' ? 'selected' : ''}>ميزان المراجعة</option><option value="statement" ${r.kind === 'statement' ? 'selected' : ''}>كشف حساب عميل</option></select></label>
        <label class="fc-field"><span>حتى تاريخ</span><input type="date" data-rf="to" value="${esc(r.to)}"></label>
        <label class="fc-field"><span>من تاريخ (للكشف)</span><input type="date" data-rf="from" value="${esc(r.from)}"></label>
        <label class="fc-field fc-grow"><span>العميل — للكشف (بالاسم)</span>${pickerHtml('client_id', {value: r.clientId, text: r.clientText})}</label>
        <label class="fc-field fc-grow"><span>الملف المالي (اختياري، برقم TC)</span>${pickerHtml('financial_file_id', {value: r.fileId, text: r.fileText})}</label>
        <button type="button" class="btn btn-primary btn-small" data-action="run-report">عرض</button>
      </div>
      <div data-report></div></section>`;
    c.querySelector('[data-action="run-report"]').addEventListener('click', runReport);
    wirePickers(c, (name, it) => { if (name === 'client_id') r.clientText = it.text; else r.fileText = it.text; });
  }
  async function runReport() {
    const c = state.container; const r = state.reports; const out = c.querySelector('[data-report]');
    r.kind = c.querySelector('[data-rf="kind"]').value; r.to = c.querySelector('[data-rf="to"]').value; r.from = c.querySelector('[data-rf="from"]').value; r.clientId = c.querySelector('[data-picker="client_id"] input[type="hidden"]').value.trim(); r.fileId = c.querySelector('[data-picker="financial_file_id"] input[type="hidden"]').value.trim();
    out.innerHTML = '<div class="fc-muted">جارٍ التحميل…</div>';
    try {
      if (r.kind === 'trial') {
        const rows = (await rpc('fin_trial_balance', {p_as_of: r.to || null}) || []).map(assertStrings);
        out.innerHTML = `<div class="fc-table-wrap"><table class="fc-table" data-trial><thead><tr><th>الكود</th><th>الحساب</th><th>مدين</th><th>دائن</th><th>رصيد مدين</th><th>رصيد دائن</th></tr></thead><tbody>${rows.map(a => `<tr><td dir="ltr">${esc(a.code)}</td><td>${esc(a.name_ar)}</td><td>${money(a.debit_total)}</td><td>${money(a.credit_total)}</td><td>${money(a.balance_debit)}</td><td>${money(a.balance_credit)}</td></tr>`).join('')}</tbody></table></div>`;
      } else {
        if (!r.clientId) throw new Error('اختر العميل بالاسم أولاً.');
        const rows = (await rpc('fin_client_statement', {p_client: r.clientId, p_file: r.fileId || null, p_from: r.from || null, p_to: r.to || null}) || []).map(assertStrings);
        out.innerHTML = `<div class="fc-table-wrap"><table class="fc-table" data-statement><thead><tr><th>التاريخ</th><th>القيد / السند</th><th>النوع</th><th>الملف</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>${rows.map(l => `<tr class="${l.row_kind !== 'line' ? 'fc-row-total' : ''}"><td>${esc(l.entry_date || '')}</td><td dir="ltr">${esc(l.entry_no || '')} ${esc(l.voucher_no || '')}</td><td>${l.row_kind === 'line' ? esc(label(TYPES, l.voucher_type)) + (l.entry_kind === 'reversal' ? ' (عكس)' : '') : (l.row_kind === 'opening' ? 'رصيد افتتاحي' : 'رصيد ختامي')}</td><td>${esc(l.operation_no || '')}</td><td>${l.row_kind === 'line' ? esc(l.memo || '') : ''}</td><td>${money(l.debit)}</td><td>${money(l.credit)}</td><td>${money(l.balance)}</td></tr>`).join('')}</tbody></table></div><p class="fc-muted">الرصيد الموجب = رصيد للعميل، السالب = مطلوب منه.</p>`;
      }
    } catch (error) { out.innerHTML = `<div class="fc-error">${esc(rpcError(error))}</div>`; }
  }

  // ---------------------------------------------------------------- file ledger card (inside the financial file details)
  async function loadFileLedger(fileId) {
    await loadSettings();
    await loadAccounts();                                   // الصناديق/البنوك لنماذج السندات داخل بطاقة الملف
    const {data: st, error} = await sb().from('fin_file_ledger_state').select('financial_file_id,ledger_mode,opened_at,delivery_confirmed_at,delivery_confirmed_by,delivery_note,approved_bank_cost_sdg::text,approved_permit_cost_sdg::text,costs_approved_at,costs_note,refund_due_sdg::text,refund_due_at,refund_allocated_sdg::text,refund_allocation_approved_at,refund_allocation_voucher_ids,lock_version').eq('financial_file_id', fileId).maybeSingle();
    if (error) throw new Error('تعذر قراءة حالة دفتر الملف: ' + rpcError(error));   // لا يُعرض كأن الدفتر غير موجود
    if (!st) return {enabled: state.settings.file_vouchers_enabled, state: null};
    const [totals, refund] = await Promise.all([rpc('fin_file_ledger_totals', {p_file: fileId}), rpc('fin_file_refund_status', {p_file: fileId})]);   // أي خطأ يُرفع للمستدعي
    return {enabled: state.settings.file_vouchers_enabled, state: assertStrings(st), totals, refund};
  }
  function renderFileCard(host, ctx) {
    const {file, ledger, onChange} = ctx; state.onFileChange = onChange;
    ctx.operationNo = ctx.operationNo || '';
    if (!host) return;
    if (!ledger?.enabled && !ledger?.state) { host.innerHTML = `<section class="fc-panel"><header class="fc-panel-head"><div><h4>الدفتر (السندات والقيود)</h4><p>سندات الملفات غير مفعّلة بعد — يُفعَّل بعد النشر والمراجعة. حتى ذلك الحين تُثبَّت الأموال يدوياً كما في المرحلة 1.</p></div></header></section>`; return; }
    const s = ledger.state, t = ledger.totals || {}, r = ledger.refund || {};
    const approve = can(KEYS.approve) && !file.closed_at, edit = can(KEYS.edit);
    if (!s) {
      const legacy = file.client_transferred_at || file.bank_paid_at || file.refund_started_at;
      host.innerHTML = `<section class="fc-panel"><header class="fc-panel-head"><div><h4>الدفتر (السندات والقيود)</h4><p>${legacy ? 'ملف قبل الدفتر: أمواله أُثبتت يدوياً في المرحلة 1. افتحه بنمط «قبل الدفتر» وسجّل السندات الفعلية يدوياً بتواريخها — لا قيود تاريخية تلقائية.' : 'لم يُفتح دفتر هذا الملف بعد. بعد الفتح تُثبَّت الأموال من السندات المرحّلة فقط.'}</p></div>
        <div class="fc-head-actions">${approve && file.status !== 'draft' ? `<button type="button" class="btn btn-primary btn-small" data-laction="open" data-mode="${legacy ? 'pre_ledger' : 'ledger'}">${legacy ? 'فتح الدفتر (قبل الدفتر)' : 'فتح الدفتر'}</button>` : ''}</div></header></section>`;
      host.querySelector('[data-laction="open"]')?.addEventListener('click', async e => {
        const mode = e.target.dataset.mode; let note = null;
        if (mode === 'pre_ledger') { note = (globalThis.prompt('ملاحظة فتح الدفتر لملف قبل الدفتر (إلزامية):') || '').trim(); if (!note) return; }
        if (await run(() => rpc('open_fin_file_ledger', {p_file: file.id, p_mode: mode, p_note: note}), 'فُتح دفتر الملف.')) onChange?.();
      });
      return;
    }
    const row = (k, v, cls = '') => `<div class="${cls}"><span>${k}</span><b>${v}</b></div>`;
    const bsgtPermit = file.import_permit_source === 'bsgt';
    const buttons = [];
    const costStatuses = ['pending_client_transfer','client_transferred','bank_paid','completed'];   // قابلة للتغيير حتى ترحيل التسوية
    if (approve && !s.costs_approved_at && costStatuses.includes(file.status)) buttons.push(['costs','اعتماد التكلفة الفعلية','btn-primary']);
    if (approve && s.costs_approved_at && !t.settled && costStatuses.includes(file.status)) buttons.push(['costs','تعديل التكلفة المعتمدة','btn-ghost']);
    if (approve && !s.delivery_confirmed_at && ['bank_paid','completed'].includes(file.status)) buttons.push(['delivery','تأكيد تسليم الاعتماد','btn-primary']);
    if (edit && s.delivery_confirmed_at && !t.settled && ['bank_paid','completed'].includes(file.status)) buttons.push(['settlement','مسودة تسوية العملية','btn-primary']);
    if (edit && ['failed','refund_in_progress','refunded'].includes(file.status) && !t.failure_reclassified && (!isZero(t.bank_unbilled_sdg) || !isZero(t.permit_unbilled_sdg))) buttons.push(['failure_reclass','مسودة إعادة تصنيف الإخفاق','btn-ghost']);
    if (approve && r.refund_due_sdg && !isZero(r.allocated_after_failure_sdg) && (!s.refund_allocation_approved_at || r.refund_allocation_valid === false)) buttons.push(['allocation','اعتماد التخصيص بدل الرد','btn-ghost']);
    if (edit) buttons.push(['receipt','سند قبض','btn-ghost'], ['payment_bank','صرف للبنك','btn-ghost']); if (edit && bsgtPermit) buttons.push(['payment_permit','صرف الإذن','btn-ghost']);
    if (edit) buttons.push(['refund','رد للعميل','btn-ghost'], ['recovery','استرداد من البنك','btn-ghost'], ['balance_transfer','تخصيص رصيد','btn-ghost']); if (edit && t.settled) buttons.push(['adjustment','تسوية تكلفة','btn-ghost']);
    host.innerHTML = `<section class="fc-panel" data-ledger-card>
      <header class="fc-panel-head"><div><h4>الدفتر (السندات والقيود) <span class="fc-status">${s.ledger_mode === 'ledger' ? 'دفتر كامل' : 'قبل الدفتر'}</span> <small class="fc-muted">النسخة ${esc(s.lock_version)}</small></h4><p>الأمانة = قبض + تخصيص وارد − رد − تخصيص صادر. المحمَّل = التسوية + التعديلات. الرصيد = الأمانة − المحمَّل.</p></div>
        <div class="fc-head-actions">${buttons.map(([a, t2, c]) => `<button type="button" class="btn ${c} btn-small" data-laction="${a}">${t2}</button>`).join('')}</div></header>
      <div class="fc-summary-main">
        ${row('أمانة العميل SDG', money(t.client_deposit_sdg))}${row('المحمَّل على العميل SDG', money(t.client_charged_sdg))}
        ${row('مطلوب من العميل SDG', money(t.due_from_client_sdg))}${row('رصيد للعميل SDG', money(t.balance_for_client_sdg))}
      </div>
      <div class="fc-costs">
        ${row('قبض (تكلفة العملية) / عمولة مقدّمة', `${money(t.receipts_sdg)} / ${money(t.commission_advance_sdg)}`)}
        ${row('ردود / تخصيص وارد / تخصيص صادر', `${money(t.refunds_sdg)} / ${money(t.allocated_in_sdg)} / ${money(t.allocated_out_sdg)}`)}
        ${row('مدفوع للبنك (مرحّل) مقابل المحسوب', `${money(t.bank_paid_sdg)} / ${money(t.bank_cost_computed_sdg)}`)}
        ${row('التكلفة الفعلية المعتمدة: بنك / إذن', s.costs_approved_at ? `${money(s.approved_bank_cost_sdg)} / ${money(s.approved_permit_cost_sdg)}` : '<span class="fc-muted">غير معتمدة بعد</span>')}
        ${row('مدفوع للإذن (مرحّل)', money(t.permit_paid_sdg))}
        ${row('غير محمَّل/معلّق: بنك / إذن (يجب أن يصفر قبل الإقفال)', `${money(t.bank_unbilled_sdg)} / ${money(t.permit_unbilled_sdg)}`)}
        ${row('مستحق استرداده من البنك (1500) / مستردّ', `${money(t.recoverable_outstanding_sdg)} / ${money(t.recovered_sdg)}`)}
        ${row('تسليم الاعتماد', s.delivery_confirmed_at ? `${esc(fmtDate(s.delivery_confirmed_at))}${s.delivery_note ? ' · ' + esc(s.delivery_note) : ''}` : '<span class="fc-muted">لم يُؤكَّد — الاعتراف بالعمولة يشترطه</span>')}
        ${row('التسوية', t.settled ? 'مرحّلة (العمولة معترف بها)' : '<span class="fc-muted">لم تُرحَّل</span>')}
        ${r.refund_due_sdg ? row('استحقاق الرد: ثابت عند الإخفاق / قبض بعده / الإجمالي الواجب رده', `${money(r.refund_due_sdg)} / ${money(r.received_after_failure_sdg)} / ${money(r.refund_total_due_sdg)}`) : ''}
        ${r.refund_due_sdg ? row('مردود نقداً / مخصَّص معتمد / متبقٍ', `${money(r.refunded_cash_sdg)} / ${money(r.refund_allocated_approved_sdg || '0')}${r.refund_allocation_valid === false ? ' <span class="fc-status is-failed">اعتماد التخصيص أُبطل — راجع من جديد</span>' : ''} / ${money(r.refund_remaining_sdg)}`, 'fc-total') : ''}
      </div>
      <div data-ledger-form></div>
      <details class="fc-detached" open><summary>سندات الملف</summary><div class="fc-table-wrap"><table class="fc-table"><thead><tr><th>السند</th><th>النوع</th><th>الحالة</th><th>التاريخ</th><th>المبلغ</th><th>المرجع</th></tr></thead><tbody data-file-vouchers><tr><td colspan="6" class="fc-muted">جارٍ التحميل…</td></tr></tbody></table></div></details>
      <div data-ledger-voucher></div>
    </section>`;
    const formHost = host.querySelector('[data-ledger-form]'), vHost = host.querySelector('[data-ledger-voucher]');
    host.querySelectorAll('[data-laction]').forEach(btn => btn.addEventListener('click', () => fileAction(btn.dataset.laction, {file, ledger, formHost, vHost, onChange, operationNo: ctx.operationNo})));
    loadFileVouchers(file.id, host.querySelector('[data-file-vouchers]'), vHost);
  }
  async function loadFileVouchers(fileId, rowsEl, vHost) {
    try {
      const rows = (await rpc('list_fin_vouchers', {p_file: fileId, p_limit: 50}) || []).map(assertStrings);
      rowsEl.innerHTML = rows.length ? rows.map(r => `<tr data-open-voucher="${esc(r.id)}"><td dir="ltr"><b>${esc(r.voucher_no || 'مسودة')}</b></td><td>${esc(label(TYPES, r.voucher_type))}${r.purpose === 'commission_advance' ? '<small>عمولة مقدّمة</small>' : ''}</td><td><span class="fc-status is-v-${esc(r.status)}">${esc(label(VSTATUS, r.status))}</span></td><td>${esc(r.voucher_date)}</td><td>${money(r.amount)}</td><td>${esc(r.reference || '')}</td></tr>`).join('') : '<tr><td colspan="6" class="fc-muted">لا سندات على هذا الملف.</td></tr>';
      rowsEl.querySelectorAll('[data-open-voucher]').forEach(tr => tr.addEventListener('click', () => openVoucher(tr.dataset.openVoucher, vHost)));
    } catch (error) { rowsEl.innerHTML = `<tr><td colspan="6" class="fc-error">${esc(rpcError(error))}</td></tr>`; }
  }
  async function fileAction(action, ctx) {
    const {file, ledger, formHost, vHost, onChange} = ctx; const s = ledger.state; ctx.operationNo = ctx.operationNo || '';
    if (action === 'costs') {
      formHost.innerHTML = `<form class="fc-form" data-form="costs"><label class="fc-field"><span>تكلفة البنك الفعلية SDG (المحسوبة ${esc(file.bank_cost_sdg ?? '—')})</span><input name="bank" inputmode="decimal" value="${esc(s.approved_bank_cost_sdg ?? '')}"></label>
        ${file.import_permit_source === 'bsgt' ? `<label class="fc-field"><span>تكلفة الإذن الفعلية SDG (المُدخلة ${esc(file.import_permit_cost_sdg ?? '—')})</span><input name="permit" inputmode="decimal" value="${esc(s.approved_permit_cost_sdg ?? '')}"></label>` : ''}
        <label class="fc-field fc-span"><span>ملاحظة</span><input name="note" value="${esc(s.costs_note ?? '')}"></label>
        <div class="fc-form-actions"><button type="submit" class="btn btn-primary btn-small">اعتماد</button><button type="button" class="btn btn-ghost btn-small" data-action="cancel-form">إلغاء</button></div></form>`;
      formHost.querySelector('[data-action="cancel-form"]').addEventListener('click', () => { formHost.innerHTML = ''; });
      formHost.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        try { const el = e.target.elements; const bank = dec(el.bank.value, 'تكلفة البنك الفعلية'); const permit = el.permit ? dec(el.permit.value, 'تكلفة الإذن الفعلية') : null;
          if (bank === null) throw new Error('أدخل تكلفة البنك الفعلية.');
          if (await run(() => rpc('approve_fin_file_costs', {p_file: file.id, p_expected_lock_version: s.lock_version, p_bank_cost: bank, p_permit_cost: permit, p_note: el.note.value.trim() || null}), 'اعتُمدت التكلفة الفعلية.')) onChange?.();
        } catch (error) { notify(error.message, 'err'); }
      });
    } else if (action === 'delivery') {
      const note = globalThis.prompt('تأكيد تسليم الاعتماد/المستندات للعميل — ملاحظة (اختيارية). لا يشترط اكتمال القبض؛ ما يبقى يظهر مطلوباً من العميل.'); if (note === null) return;
      if (await run(() => rpc('confirm_fin_file_delivery', {p_file: file.id, p_expected_lock_version: s.lock_version, p_note: note || null}), 'تم تأكيد التسليم.')) onChange?.();
    } else if (action === 'allocation') {
      const reason = (globalThis.prompt('سبب اعتماد التخصيص بدل الرد النقدي (إلزامي، بطلب العميل):') || '').trim(); if (!reason) return;
      if (await run(() => rpc('approve_fin_refund_allocation', {p_file: file.id, p_expected_lock_version: s.lock_version, p_reason: reason}), 'اعتُمد التخصيص.')) onChange?.();
    } else if (action === 'settlement') {
      try {
        const preview = await rpc('preview_fin_settlement', {p_file: file.id});
        const keys = ['bank_actual_sdg','bank_computed_sdg','bank_variance_sdg','permit_actual_sdg','permit_entered_sdg','permit_variance_sdg','commission_sdg','settled_total_sdg','client_balance_before','client_balance_after'];
        formHost.innerHTML = `<section class="fc-panel"><h5>معاينة التسوية (كما ستُرحَّل الآن)</h5><div class="fc-costs">${keys.map(k => `<div><span dir="ltr">${esc(k)}</span><b>${money(preview[k])}</b></div>`).join('')}</div>
          <div class="fc-form-actions"><button type="button" class="btn btn-primary btn-small" data-action="create-settlement">إنشاء مسودة التسوية</button><button type="button" class="btn btn-ghost btn-small" data-action="cancel-form">إلغاء</button></div></section>`;
        formHost.querySelector('[data-action="cancel-form"]').addEventListener('click', () => { formHost.innerHTML = ''; });
        const settlementRequestId = requestId();   // ثابت لهذه المعاينة: إعادة الضغط بعد انقطاع الرد لا تنشئ مسودة ثانية
        formHost.querySelector('[data-action="create-settlement"]').addEventListener('click', async () => {
          const data = await run(() => rpc('create_fin_voucher', {p: {voucher_type: 'settlement', financial_file_id: file.id, memo: 'تسوية العملية', request_id: settlementRequestId}}), 'أُنشئت مسودة التسوية — راجع المكوّنات ثم رحّل.');
          if (data) { formHost.innerHTML = ''; onChange?.(); }
        });
      } catch (error) { notify(rpcError(error), 'err'); }
    } else {
      // voucher presets linked to this file
      const preset = {voucher_type: action, financial_file_id: file.id, client_id: file.client_id || '', labels: {financial_file_id: ctx.operationNo || file.id.slice(0, 8), client_id: file.client_name_snapshot || ''}, onDone: () => onChange?.()};
      voucherForm(null, preset, formHost);
    }
  }

  return Object.freeze({TYPES, VSTATUS, PURPOSE, ROLES, KEYS, configure, mount, loadFileLedger, renderFileCard, rpcError, isZero, state});
});
