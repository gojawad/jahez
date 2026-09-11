(function(){
  'use strict';

  const MAX_ITEMS = 10;
  const commodityTranslations = window.BALDNA_COMMODITY_TRANSLATIONS || {};
  const catalog = Array.isArray(window.BALDNA_COMMODITY_CATALOG)
    ? window.BALDNA_COMMODITY_CATALOG.map(item => ({
        ...item,
        nameEn: commodityTranslations[String(item.id)] || item.name
      }))
    : [];
  const catalogById = new Map(catalog.map(item => [String(item.id), item]));
  let rowSequence = 0;
  let savedRecords = [];
  let archivedRecords = [];
  let currentRecordId = '';
  let currentReference = '';
  let recordListLoaded = false;
  let archivedListLoaded = false;
  let formDirty = false;
  let aedConversionEnabled = true;
  const portalRouteParams = new URLSearchParams(location.search);
  const standaloneRegister = portalRouteParams.get('portal') === 'import-permit-records';
  let requestedPortalView = portalRouteParams.get('permitView') === 'new' ? 'new' : 'history';
  let standaloneRegisterOpened = false;
  let recordPage = 1;
  let recordPageSize = 10;
  let recordPagination = {page:1, pageSize:10, total:0, totalPages:1, from:0, to:0, availableTotal:0};
  let recordClients = [];
  let recordRequestSequence = 0;
  let recordFilterTimer = 0;

  const byId = id => document.getElementById(id);
  const numeric = value => {
    const number = Number(String(value || '').replace(/,/g, '').trim());
    return Number.isFinite(number) ? number : NaN;
  };
  const money = value => Number(value || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const commodityLabel = item => `${item.name} — ${item.category} — HS ${item.hsCode} — ${item.unit}`;

  function todayIso(){
    const date = new Date();
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function canUsePortal(){
    if(!window.JahezPortalAccess || typeof currentAccessProfile !== 'function') return false;
    return window.JahezPortalAccess.canAccessPortal('import_permit', currentAccessProfile());
  }

  function denyStandalonePortalAccess(){
    const message = 'ليس لديك صلاحية للوصول إلى هذه البوابة.';
    try{ sessionStorage.setItem(window.JahezPortalAccess?.ACCESS_MESSAGE_KEY || 'jahez:portal-access-message', message); }catch(error){}
    window.location.replace('/#v=dashboard');
  }

  async function portalApi(path, options){
    const {data:{session}} = await sb.auth.getSession();
    if(!session?.access_token) throw new Error('انتهت جلسة الدخول. سجّل الدخول مرة أخرى.');
    const response = await fetch(path, {
      ...options,
      headers: {...(options?.headers || {}), Authorization:`Bearer ${session.access_token}`, 'Content-Type':'application/json'}
    });
    const result = await response.json().catch(() => ({}));
    if(!response.ok) throw new Error(result.error || 'تعذر الاتصال بخدمة فواتير إذن الاستيراد.');
    return result;
  }

  function escapeText(value){
    return typeof escapeHtml === 'function' ? escapeHtml(value) : String(value ?? '');
  }

  function formatSavedDate(value){
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ar-AE', {dateStyle:'short', timeStyle:'short'});
  }

  async function loadSavedRecords(force){
    if(recordListLoaded && !force) return;
    const requestSequence = ++recordRequestSequence;
    recordListLoaded = false;
    renderSavedRecords();
    const params = new URLSearchParams({
      status:'active',
      page:String(recordPage),
      pageSize:String(recordPageSize),
      search:String(byId('importPermitFilterSearch').value || '').trim(),
      client:byId('importPermitFilterClient').value,
      currency:byId('importPermitFilterCurrency').value,
      from:byId('importPermitFilterFrom').value,
      to:byId('importPermitFilterTo').value,
      sort:byId('importPermitFilterSort').value
    });
    const result = await portalApi(`/api/import-permit-invoices?${params}`);
    if(requestSequence !== recordRequestSequence) return;
    savedRecords = Array.isArray(result.records) ? result.records : [];
    recordPagination = {...recordPagination, ...(result.pagination || {})};
    recordPage = recordPagination.page || 1;
    recordPageSize = recordPagination.pageSize || recordPageSize;
    recordClients = Array.isArray(result.filters?.clients) ? result.filters.clients : [];
    recordListLoaded = true;
    renderSavedRecords();
  }

  async function loadArchivedRecords(force){
    if(archivedListLoaded && !force) return;
    byId('importPermitArchivedRecords').innerHTML = '<div class="import-permit-records-empty">جاري تحميل الأرشيف...</div>';
    const result = await portalApi('/api/import-permit-invoices?status=archived&page=1&pageSize=100');
    archivedRecords = Array.isArray(result.records) ? result.records : [];
    archivedListLoaded = true;
    renderArchivedRecords();
  }

  function setSelectOptions(id, values, placeholder){
    const select = byId(id);
    if(!select) return;
    const current = select.value;
    select.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = placeholder || '— اختر —';
    select.appendChild(empty);
    (values || []).forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = typeof shortLabel === 'function' ? shortLabel(value) : value;
      select.appendChild(option);
    });
    if(current && [...select.options].some(option => option.value === current)) select.value = current;
  }

  function setSelectValue(select, value){
    if(!select || !value) return;
    if(![...select.options].some(option => option.value === value)){
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    select.value = value;
  }

  function fillPortalOptions(){
    setSelectOptions('permit_consignee', lookups.consignee || []);
    setSelectOptions('permit_consigneeAddress', lookups.consigneeAddress || []);
    setSelectOptions('permit_portDischarge', lookups.portDischarge || []);
    setSelectOptions('permit_countryOrigin', lookups.countryOrigin || []);
    setSelectOptions('permit_incoterm', lookups.incoterm || []);
    setSelectOptions('permit_paymentTerm', lookups.paymentTerm || []);

    const bankSelect = byId('permit_bankPick');
    const selectedBank = bankSelect.value;
    bankSelect.innerHTML = '<option value="">— اختر العنوان البنكي —</option>';
    bankBook.forEach(bank => {
      const option = document.createElement('option');
      option.value = bank.id;
      option.textContent = bank.nick;
      bankSelect.appendChild(option);
    });
    if(selectedBank && bankBook.some(bank => bank.id === selectedBank)) bankSelect.value = selectedBank;

    const list = byId('permitCommodityOptions');
    if(!list.dataset.ready){
      const fragment = document.createDocumentFragment();
      catalog.forEach(item => {
        const option = document.createElement('option');
        option.value = commodityLabel(item);
        option.dataset.id = item.id;
        fragment.appendChild(option);
      });
      list.appendChild(fragment);
      list.dataset.ready = '1';
    }
    byId('permitCatalogCount').textContent = String(catalog.length);
  }

  function itemRowTemplate(index){
    return `<div class="field permit-commodity"><label>السلعة ${index} *</label><input type="text" class="permit-item-commodity" list="permitCommodityOptions" placeholder="ابحث باسم السلعة أو HS Code" autocomplete="off"></div>
      <div class="field"><label>الكمية *</label><input type="number" class="permit-item-qty" min="0.000001" step="any" inputmode="decimal"></div>
      <div class="field permit-unit"><label>الوحدة</label><input type="text" class="permit-item-unit" dir="ltr" readonly></div>
      <div class="field"><label>HS Code</label><input type="text" class="permit-item-hs" dir="ltr" readonly></div>
      <div class="field"><label>إجمالي السلعة *</label><input type="number" class="permit-item-amount" min="0.01" step="any" inputmode="decimal"></div>
      <div class="field"><label>سعر الوحدة</label><input type="text" class="permit-item-price" dir="ltr" readonly></div>
      <button type="button" class="import-permit-item-remove" title="حذف السلعة" aria-label="حذف السلعة" data-ic="trash"></button>`;
  }

  function addItem(prefill){
    const host = byId('importPermitItems');
    if(host.children.length >= MAX_ITEMS) return;
    rowSequence += 1;
    const row = document.createElement('div');
    row.className = 'import-permit-item';
    row.dataset.row = String(rowSequence);
    row.innerHTML = itemRowTemplate(host.children.length + 1);
    host.appendChild(row);
    if(prefill?.commodityId){
      const item = catalogById.get(String(prefill.commodityId));
      if(item){
        row.dataset.commodityId = item.id;
        row.querySelector('.permit-item-commodity').value = commodityLabel(item);
        row.querySelector('.permit-item-unit').value = item.unit;
        row.querySelector('.permit-item-hs').value = item.hsCode;
      }
    }
    if(prefill?.quantity) row.querySelector('.permit-item-qty').value = prefill.quantity;
    if(prefill?.amount) row.querySelector('.permit-item-amount').value = prefill.amount;
    renumberItems();
    recalculateRow(row);
  }

  function renumberItems(){
    const rows = [...byId('importPermitItems').children];
    rows.forEach((row, index) => {
      row.querySelector('.permit-commodity label').textContent = `السلعة ${index + 1} *`;
      row.querySelector('.import-permit-item-remove').disabled = rows.length === 1;
    });
    byId('importPermitItemsCount').textContent = `${rows.length === 1 ? 'سلعة واحدة' : rows.length + ' سلع'} من ${MAX_ITEMS}`;
    byId('importPermitAddItemBtn').disabled = rows.length >= MAX_ITEMS;
  }

  function selectedCommodity(row){
    const saved = catalogById.get(String(row.dataset.commodityId || ''));
    const inputValue = row.querySelector('.permit-item-commodity').value.trim();
    if(saved && commodityLabel(saved) === inputValue) return saved;
    return catalog.find(item => commodityLabel(item) === inputValue) || null;
  }

  function applyCommodity(row){
    const item = selectedCommodity(row);
    if(!item){
      delete row.dataset.commodityId;
      row.querySelector('.permit-item-unit').value = '';
      row.querySelector('.permit-item-hs').value = '';
      return;
    }
    row.dataset.commodityId = item.id;
    row.querySelector('.permit-item-unit').value = item.unit;
    row.querySelector('.permit-item-hs').value = item.hsCode;
  }

  function recalculateRow(row){
    const quantity = numeric(row.querySelector('.permit-item-qty').value);
    const amount = numeric(row.querySelector('.permit-item-amount').value);
    row.querySelector('.permit-item-price').value = Number.isFinite(quantity) && quantity > 0 && Number.isFinite(amount)
      ? money(amount / quantity)
      : '';
    recalculateGrandTotal();
  }

  function recalculateGrandTotal(){
    const total = [...byId('importPermitItems').querySelectorAll('.permit-item-amount')]
      .reduce((sum, input) => sum + (Number.isFinite(numeric(input.value)) ? numeric(input.value) : 0), 0);
    byId('importPermitGrandTotal').textContent = money(total);
    const currency = byId('permit_currency').value || 'AED';
    byId('importPermitGrandCurrency').textContent = currency;
    const shouldConvert = aedConversionEnabled && currency !== 'AED';
    byId('importPermitAedTotal').textContent = shouldConvert
      ? `يعادل AED ${money(total * conversionRate())}`
      : '';
  }

  function conversionRate(){
    const rate = numeric(byId('permit_aedRate').value);
    return Number.isFinite(rate) && rate > 0 ? rate : 3.67;
  }

  function updateAedConversionUi(){
    const currency = byId('permit_currency').value || 'AED';
    const needsConversion = currency !== 'AED';
    const button = byId('permitAedToggle');
    const rateInput = byId('permit_aedRate');
    button.disabled = !needsConversion;
    button.classList.toggle('active', needsConversion && aedConversionEnabled);
    button.textContent = !needsConversion ? 'الفاتورة بالدرهم' : (aedConversionEnabled ? 'التحويل مفعّل' : 'التحويل متوقف');
    rateInput.disabled = !needsConversion || !aedConversionEnabled;
    byId('permitAedHint').textContent = !needsConversion
      ? 'لا يحتاج المبلغ إلى تحويل.'
      : (aedConversionEnabled ? `سعر التحويل إلى الدرهم: ${conversionRate()}` : 'ستُطبع الفاتورة بعملتها الأصلية.');
    recalculateGrandTotal();
  }

  function clearValidation(){
    byId('importPermitOverlay').querySelectorAll('.permit-field-missing').forEach(element => {
      element.classList.remove('permit-field-missing');
      element.removeAttribute('aria-invalid');
    });
    const alertBox = byId('importPermitValidation');
    alertBox.classList.remove('show');
    alertBox.textContent = '';
  }

  function markMissing(element, label, missing, elements){
    missing.push(label);
    element.classList.add('permit-field-missing');
    element.setAttribute('aria-invalid', 'true');
    elements.push(element);
  }

  function validatePortal(){
    clearValidation();
    const missing = [];
    const elements = [];
    [
      ['permit_proformaNo','رقم الفاتورة المبدئية'], ['permit_proformaDate','تاريخ الفاتورة'],
      ['permit_consignee','المرسل إليه'], ['permit_consigneeAddress','عنوان المرسل إليه'],
      ['permit_portDischarge','جهة الوصول'], ['permit_countryOrigin','بلد المنشأ'],
      ['permit_currency','عملة الفاتورة'], ['permit_incoterm','نوع التأمين'],
      ['permit_paymentTerm','شروط الدفع'], ['permit_bankPick','العنوان البنكي']
    ].forEach(([id, label]) => {
      const element = byId(id);
      if(!String(element.value || '').trim()) markMissing(element, label, missing, elements);
    });
    if(aedConversionEnabled && byId('permit_currency').value !== 'AED' && !(numeric(byId('permit_aedRate').value) > 0)){
      markMissing(byId('permit_aedRate'), 'سعر تحويل موجب إلى الدرهم', missing, elements);
    }

    [...byId('importPermitItems').children].forEach((row, index) => {
      const commodityInput = row.querySelector('.permit-item-commodity');
      const quantityInput = row.querySelector('.permit-item-qty');
      const amountInput = row.querySelector('.permit-item-amount');
      if(!selectedCommodity(row)) markMissing(commodityInput, `سلعة صحيحة للبند ${index + 1}`, missing, elements);
      if(!(numeric(quantityInput.value) > 0)) markMissing(quantityInput, `كمية موجبة للبند ${index + 1}`, missing, elements);
      if(!(numeric(amountInput.value) > 0)) markMissing(amountInput, `إجمالي موجب للبند ${index + 1}`, missing, elements);
    });

    if(!missing.length) return true;
    const alertBox = byId('importPermitValidation');
    alertBox.textContent = `أكمل الحقول المطلوبة: ${missing.join('، ')}`;
    alertBox.classList.add('show');
    elements[0]?.scrollIntoView({behavior:'smooth', block:'center'});
    setTimeout(() => elements[0]?.focus(), 220);
    return false;
  }

  function groupedQuantity(items){
    const totals = new Map();
    items.forEach(item => totals.set(item.unit, (totals.get(item.unit) || 0) + item.quantity));
    return [...totals.entries()].map(([unit, quantity]) => `${quantity.toLocaleString('en-US')} ${unit}`).join(' / ');
  }

  function formPayload(){
    return {
      proformaNo: byId('permit_proformaNo').value.trim(),
      proformaDate: byId('permit_proformaDate').value,
      consignee: byId('permit_consignee').value,
      consigneeAddress: byId('permit_consigneeAddress').value,
      portDischarge: byId('permit_portDischarge').value,
      countryOrigin: byId('permit_countryOrigin').value,
      currency: byId('permit_currency').value,
      convertToAed: aedConversionEnabled,
      aedRate: conversionRate(),
      incoterm: byId('permit_incoterm').value,
      paymentTerm: byId('permit_paymentTerm').value,
      bankId: byId('permit_bankPick').value,
      weight: byId('permit_weight').value.trim(),
      items: [...byId('importPermitItems').children].map(row => {
        const commodity = selectedCommodity(row);
        return {
          commodityId: commodity?.id || '',
          description: commodity?.name || '',
          descriptionEn: commodity?.nameEn || commodity?.name || '',
          category: commodity?.category || '',
          hsCode: commodity?.hsCode || '',
          unit: commodity?.unit || '',
          quantity: numeric(row.querySelector('.permit-item-qty').value),
          amount: numeric(row.querySelector('.permit-item-amount').value)
        };
      })
    };
  }

  function hydratePortal(record){
    const data = record?.data || {};
    fillPortalOptions();
    ['proformaNo','proformaDate','weight'].forEach(key => {
      const id = key === 'weight' ? 'permit_weight' : `permit_${key}`;
      byId(id).value = data[key] || (key === 'proformaDate' ? todayIso() : '');
    });
    ['consignee','consigneeAddress','portDischarge','countryOrigin','incoterm','paymentTerm'].forEach(key => {
      setSelectValue(byId(`permit_${key}`), data[key] || '');
    });
    byId('permit_currency').value = data.currency || 'AED';
    aedConversionEnabled = data.convertToAed === true;
    byId('permit_aedRate').value = data.aedRate || 3.67;
    setSelectValue(byId('permit_bankPick'), data.bankId || '');
    byId('importPermitItems').innerHTML = '';
    (data.items || []).forEach(item => addItem({commodityId:item.commodityId, quantity:item.quantity, amount:item.amount}));
    if(!byId('importPermitItems').children.length) addItem();
    clearValidation();
    updateAedConversionUi();
    setCurrentRecord(record);
  }

  async function saveCurrentRecord(){
    if(!validatePortal()) return null;
    const button = byId('importPermitSaveBtn');
    const printButton = byId('importPermitPrintBtn');
    button.disabled = true;
    printButton.disabled = true;
    const original = button.textContent;
    button.textContent = 'جاري الحفظ...';
    try{
      const result = await portalApi('/api/import-permit-invoices', {
        method:'POST',
        body:JSON.stringify({id:currentRecordId || undefined, data:formPayload()})
      });
      const saved = result.record;
      const index = savedRecords.findIndex(record => record.id === saved.id);
      if(index >= 0) savedRecords[index] = saved;
      else savedRecords.unshift(saved);
      savedRecords.sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      setCurrentRecord(saved);
      toast(`تم حفظ الفاتورة بالمرجع ${saved.reference}`);
      return saved;
    }catch(error){
      toast(error.message || 'تعذر حفظ الفاتورة', 'err');
      return null;
    }finally{
      button.textContent = original;
      button.disabled = false;
      printButton.disabled = false;
    }
  }

  function portalRecordFromData(data, reference, lang){
    const printLanguage = lang === 'en' ? 'en' : 'ar';
    const companyEntry = baharCompanyEntry();
    const sourceCurrency = data.currency || 'AED';
    const shouldConvert = data.convertToAed === true && sourceCurrency !== 'AED';
    const savedRate = numeric(data.aedRate);
    const rate = shouldConvert && savedRate > 0 ? savedRate : 1;
    const currency = shouldConvert ? 'AED' : sourceCurrency;
    const bank = bankBook.find(entry => entry.id === data.bankId);
    const lines = (data.items || []).map(item => {
      const commodity = catalogById.get(String(item.commodityId || ''));
      const quantity = numeric(item.quantity);
      const amount = numeric(item.amount);
      return {
        description: printLanguage === 'en'
          ? (item.descriptionEn || commodity?.nameEn || item.description)
          : (item.description || commodity?.name || item.descriptionEn),
        quantity,
        unit: item.unit || commodity?.unit || '',
        hsCode: item.hsCode || commodity?.hsCode || '',
        amount: amount * rate,
        price: (quantity > 0 ? amount / quantity : 0) * rate
      };
    });
    const currencyValue = value => `${currency} ${money(value)}`;
    const grandTotal = lines.reduce((sum, line) => sum + line.amount, 0);
    const record = {
      companyId: companyEntry.id,
      permitInvoice: true,
      permitInvoiceCurrency: currency,
      permitInvoiceSourceCurrency: sourceCurrency,
      permitInvoiceAedRate: rate,
      permitInvoiceReference: reference,
      proformaNo: data.proformaNo,
      proformaDate: data.proformaDate,
      consignee: data.consignee,
      consigneeAddress: data.consigneeAddress,
      portDischarge: data.portDischarge,
      countryOrigin: data.countryOrigin,
      countryOfOrigin: data.countryOrigin,
      incoterm: data.incoterm,
      paymentTerm: data.paymentTerm,
      bankId: bank?.id || '',
      bankDetails: bank?.body || '',
      currency,
      grossWeight: String(data.weight || '').trim(),
      totalQty: groupedQuantity(lines),
      qtyUnit: '',
      totalAmount: currencyValue(grandTotal),
      bsgtAutoAed: false,
      bsgtShowWeight: !!String(data.weight || '').trim()
    };
    lines.forEach((line, index) => {
      const suffix = index ? String(index + 1) : '';
      record[`item${suffix}Desc`] = line.description;
      record[`item${suffix}Qty`] = String(line.quantity);
      record[`item${suffix}Unit`] = line.unit;
      record[`item${suffix}HsCode`] = line.hsCode;
      record[`item${suffix}Price`] = currencyValue(line.price);
      record[`item${suffix}Amount`] = currencyValue(line.amount);
    });
    record.itemDesc = lines[0].description;
    record.qty = String(lines[0].quantity);
    record.qtyUnit = '';
    record.hsCode = lines[0].hsCode;
    record.unitPrice = currencyValue(lines[0].price);
    record.item1Price = currencyValue(lines[0].price);
    record.item1Amount = currencyValue(lines[0].amount);
    return record;
  }

  function portalRecord(lang){
    return portalRecordFromData(formPayload(), currentReference, lang);
  }

  function setCurrentRecord(record){
    currentRecordId = record?.id || '';
    currentReference = record?.reference || '';
    formDirty = false;
    byId('importPermitCurrentRef').textContent = currentReference || 'مسودة غير محفوظة';
    byId('importPermitSaveState').textContent = currentReference
      ? `آخر حفظ: ${formatSavedDate(record.updatedAt)}`
      : 'احفظ الفاتورة ليصدر رقمها المرجعي المستقل.';
    renderSavedRecords();
  }

  function markFormDirty(){
    formDirty = true;
    byId('importPermitSaveState').textContent = currentReference
      ? 'توجد تعديلات غير محفوظة.'
      : 'مسودة جديدة لم تُحفظ بعد.';
  }

  function fillRecordFilterOptions(){
    const select = byId('importPermitFilterClient');
    const current = select.value;
    select.innerHTML = '<option value="">كل العملاء</option>' + recordClients.map(client => `<option value="${escapeText(client)}">${escapeText(client)}</option>`).join('');
    if(recordClients.includes(current)) select.value = current;
  }

  function hasRecordFilters(){
    return ['importPermitFilterSearch','importPermitFilterClient','importPermitFilterCurrency','importPermitFilterFrom','importPermitFilterTo']
      .some(id => String(byId(id).value || '').trim());
  }

  function renderRecordPagination(){
    const pagination = byId('importPermitPagination');
    const pages = Math.max(1, Number(recordPagination.totalPages) || 1);
    pagination.hidden = !recordListLoaded || !recordPagination.total;
    byId('importPermitPageSize').value = String(recordPageSize);
    byId('importPermitPrevPage').disabled = recordPage <= 1;
    byId('importPermitNextPage').disabled = recordPage >= pages;
    const candidates = new Set([1, pages, recordPage - 2, recordPage - 1, recordPage, recordPage + 1, recordPage + 2]);
    const visiblePages = [...candidates].filter(page => page >= 1 && page <= pages).sort((a, b) => a - b);
    const parts = [];
    let previous = 0;
    visiblePages.forEach(page => {
      if(previous && page - previous > 1) parts.push('<span aria-hidden="true">…</span>');
      parts.push(`<button type="button" class="${page === recordPage ? 'active' : ''}" data-import-permit-page="${page}"${page === recordPage ? ' aria-current="page"' : ''}>${page.toLocaleString('ar-AE')}</button>`);
      previous = page;
    });
    byId('importPermitPageNumbers').innerHTML = parts.join('');
  }

  function renderSavedRecords(){
    const host = byId('importPermitRecords');
    if(!host) return;
    if(!recordListLoaded){
      host.innerHTML = `<div class="import-permit-records-skeleton" aria-label="جاري تحميل سجل الفواتير">${Array.from({length:6}, () => '<span></span>').join('')}</div>`;
      byId('importPermitResultsSummary').textContent = 'جاري تحميل سجل الفواتير...';
      renderRecordPagination();
      return;
    }
    fillRecordFilterOptions();
    const total = Number(recordPagination.total) || 0;
    const availableTotal = Number(recordPagination.availableTotal) || 0;
    if(!total){
      const filtered = hasRecordFilters();
      host.innerHTML = `<div class="import-permit-records-empty"><b>${filtered ? 'لا توجد نتائج مطابقة لبحثك.' : 'لا توجد فواتير إذن استيراد حتى الآن.'}</b><button type="button" class="btn btn-primary btn-small" data-import-permit-empty-action="${filtered ? 'clear' : 'new'}">${filtered ? 'مسح عوامل التصفية' : 'إنشاء فاتورة جديدة'}</button></div>`;
      byId('importPermitResultsSummary').textContent = filtered ? `لا توجد نتائج ضمن ${availableTotal.toLocaleString('ar-AE')} فاتورة` : 'لا توجد فواتير محفوظة بعد.';
      renderRecordPagination();
      return;
    }
    byId('importPermitResultsSummary').textContent = `عرض ${(recordPagination.from || 0).toLocaleString('ar-AE')} - ${(recordPagination.to || 0).toLocaleString('ar-AE')} من ${total.toLocaleString('ar-AE')} فاتورة`;
    const rows = savedRecords.map(record => {
      const active = record.id === currentRecordId ? ' active' : '';
      const items = record.data?.items || [];
      const total = items.reduce((sum, item) => sum + (numeric(item.amount) || 0), 0);
      return `<tr class="${active.trim()}">
        <td data-label="المرجع"><b dir="ltr">${escapeText(record.reference)}</b></td>
        <td data-label="رقم الفاتورة"><button type="button" class="import-permit-record-link" data-record-open="${escapeText(record.id)}">${escapeText(record.data?.proformaNo || 'بدون رقم')}</button></td>
        <td data-label="العميل">${escapeText(record.data?.consignee || 'بدون مستلم')}</td>
        <td data-label="التاريخ"><span dir="ltr">${escapeText(record.data?.proformaDate || 'بدون تاريخ')}</span></td>
        <td data-label="الإجمالي"><b dir="ltr">${escapeText(record.data?.currency || 'AED')} ${escapeText(money(total))}</b><small>${items.length.toLocaleString('ar-AE')} بند</small></td>
        <td data-label="أنشأها">${escapeText(record.ownerName || '—')}<small>${escapeText(formatSavedDate(record.updatedAt))}</small></td>
        <td data-label="الحالة"><span class="import-permit-status">نشطة</span></td>
        <td data-label="الإجراءات"><div class="import-permit-record-actions">
          <button type="button" class="btn btn-ghost btn-small" data-record-open="${escapeText(record.id)}" data-ic="edit">فتح</button>
          <button type="button" class="btn btn-ghost btn-small" data-record-preview="${escapeText(record.id)}" data-ic="eye">معاينة</button>
          <button type="button" class="btn btn-primary btn-small" data-record-print="${escapeText(record.id)}" data-ic="printer">طباعة</button>
          <button type="button" class="btn btn-danger btn-small" data-record-archive="${escapeText(record.id)}" data-ic="archive">أرشفة</button>
        </div></td>
      </tr>`;
    }).join('');
    host.innerHTML = `<div class="import-permit-table-wrap"><table class="import-permit-table"><thead><tr><th>المرجع</th><th>رقم الفاتورة</th><th>العميل / المرسل إليه</th><th>التاريخ</th><th>الإجمالي</th><th>أنشأها / آخر تحديث</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    renderRecordPagination();
    if(typeof hydrateIcons === 'function') hydrateIcons(host);
  }

  function renderArchivedRecords(){
    const host = byId('importPermitArchivedRecords');
    if(!archivedListLoaded){
      host.innerHTML = '<div class="import-permit-records-empty">جاري تحميل الأرشيف...</div>';
      return;
    }
    if(!archivedRecords.length){
      host.innerHTML = '<div class="import-permit-records-empty">الأرشيف فارغ.</div>';
      return;
    }
    host.innerHTML = archivedRecords.map(record => `<article class="import-permit-record archived">
      <div class="import-permit-record-main">
        <b>${escapeText(record.reference)}</b>
        <span>${escapeText(record.data?.proformaNo || 'بدون رقم')} · ${escapeText(record.data?.consignee || 'بدون مستلم')}</span>
        <small>أُرشفت ${escapeText(formatSavedDate(record.archivedAt))}${record.archivedByName ? ` بواسطة ${escapeText(record.archivedByName)}` : ''}</small>
      </div>
      <div class="import-permit-record-actions"><button type="button" class="btn btn-primary btn-small" data-record-restore="${escapeText(record.id)}">استرجاع إلى السجل</button></div>
    </article>`).join('');
  }

  function previewSavedRecord(record){
    const body = buildSavedRecordSheet(record, 'ar');
    if(!body) return;
    const html = buildStandaloneDocHtml(body, `معاينة ${record.reference}`);
    const url = URL.createObjectURL(new Blob([html], {type:'text/html;charset=utf-8'}));
    const previewLayer = byId('pdfPreviewOverlay');
    if(previewLayer.parentElement !== document.documentElement) document.documentElement.appendChild(previewLayer);
    previewLayer.classList.add('import-permit-preview-layer');
    openPdfPreview(url, `معاينة ${record.reference}`);
    setTimeout(() => { try{ URL.revokeObjectURL(url); }catch(error){} }, 60000);
  }

  function printSavedRecord(record){
    const languageLayer = byId('docLangOverlay');
    if(languageLayer.parentElement !== document.documentElement) document.documentElement.appendChild(languageLayer);
    languageLayer.classList.add('import-permit-preview-layer');
    chooseDocLang({...record.data, permitInvoice:true}, lang => {
      const body = buildSavedRecordSheet(record, lang);
      if(body) openPrintWindow(body);
    });
  }

  function buildSavedRecordSheet(record, lang){
    try{
      return buildSheet(portalRecordFromData(record.data || {}, record.reference || '', lang), 'proforma', lang);
    }catch(error){
      console.error('import permit saved invoice render', error);
      toast('تعذر تجهيز الفاتورة للمعاينة', 'err');
      return '';
    }
  }

  async function changeArchiveState(id, archived){
    const source = archived ? savedRecords : archivedRecords;
    const record = source.find(item => item.id === id);
    if(!record) return;
    if(archived && !confirm(`نقل ${record.reference} إلى الأرشيف؟`)) return;
    try{
      const result = await portalApi('/api/import-permit-invoices', {
        method:'PATCH',
        body:JSON.stringify({id, archived})
      });
      if(archived){
        archivedListLoaded = false;
        if(currentRecordId === id) resetPortal();
        toast('تم نقل الفاتورة إلى الأرشيف');
        await loadSavedRecords(true);
      }else{
        archivedRecords = archivedRecords.filter(item => item.id !== id);
        recordListLoaded = false;
        toast('تم استرجاع الفاتورة إلى السجل');
        await loadArchivedRecords(true);
      }
      renderSavedRecords();
      renderArchivedRecords();
    }catch(error){
      toast(error.message || 'تعذر تحديث الأرشيف', 'err');
    }
  }

  function resetPortal(){
    clearValidation();
    ['permit_proformaNo','permit_weight'].forEach(id => { byId(id).value = ''; });
    ['permit_consignee','permit_consigneeAddress','permit_portDischarge','permit_countryOrigin','permit_incoterm','permit_paymentTerm','permit_bankPick'].forEach(id => { byId(id).value = ''; });
    byId('permit_proformaDate').value = todayIso();
    byId('permit_currency').value = 'AED';
    aedConversionEnabled = true;
    byId('permit_aedRate').value = '3.67';
    byId('importPermitItems').innerHTML = '';
    addItem();
    updateAedConversionUi();
    setCurrentRecord(null);
  }

  function hidePortal(id){
    const overlay = byId(id);
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function showPortal(id){
    const overlay = byId(id);
    if(overlay.parentElement !== document.documentElement) document.documentElement.appendChild(overlay);
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function updateStandalonePortalView(view){
    requestedPortalView = view;
    if(!standaloneRegister) return;
    const url = new URL(location.href);
    url.searchParams.set('portal', 'import-permit-records');
    url.searchParams.set('permitView', view);
    history.replaceState(null, '', url);
  }

  function setPortalTabState(view){
    document.querySelectorAll('[data-import-permit-tab]').forEach(button => {
      const active = button.dataset.importPermitTab === view;
      button.classList.toggle('active', active);
      if(active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function openNewInvoicePortal(reset = true){
    if(!portalIsReady()) return false;
    fillPortalOptions();
    if(reset) resetPortal();
    hidePortal('importPermitRecordsOverlay');
    hidePortal('importPermitArchiveOverlay');
    byId('importPermitRouteLoader')?.classList.add('hidden');
    showPortal('importPermitOverlay');
    setPortalTabState('new');
    updateStandalonePortalView('new');
    return true;
  }

  function closePortal(){ hidePortal('importPermitOverlay'); }

  function openRecordsInNewTab(){
    if(standaloneRegister){
      openRecordsPortal();
      return;
    }
    const url = new URL(location.href);
    url.searchParams.set('portal', 'import-permit-records');
    url.searchParams.set('permitView', 'history');
    url.hash = 'v=bsgt';
    const opened = window.open(url.href, 'jahezImportPermitRecords');
    if(!opened) toast('اسمح للنوافذ المنبثقة لفتح سجل الفواتير في تبويب مستقل.', 'err');
    else try{ opened.focus(); }catch(error){}
  }

  function closeRecordsPortal(){
    if(standaloneRegister && window.opener && !window.opener.closed){
      window.close();
      return;
    }
    hidePortal('importPermitRecordsOverlay');
  }

  function portalIsReady(){
    if(!canUsePortal()){
      toast('ليست لديك صلاحية إنشاء الفاتورة', 'err');
      return false;
    }
    if(!catalog.length){
      alert('تعذر تحميل دليل سلع منصة بلدنا. حدّث الصفحة وحاول مرة أخرى.');
      return false;
    }
    if(!baharCompanyEntry()){
      alert('شركة بحر سواكن غير موجودة في قائمة الشركات.');
      return false;
    }
    return true;
  }

  window.openImportPermitInvoice = function(){
    openNewInvoicePortal(true);
  };

  window.openImportPermitRecords = openRecordsInNewTab;

  async function openRecordsPortal(){
    if(!portalIsReady()) return false;
    if(byId('importPermitOverlay').classList.contains('open') && formDirty && !confirm('توجد تعديلات غير محفوظة. هل تريد مغادرة شاشة الإدخال؟')) return false;
    hidePortal('importPermitOverlay');
    hidePortal('importPermitArchiveOverlay');
    byId('importPermitRouteLoader')?.classList.add('hidden');
    showPortal('importPermitRecordsOverlay');
    setPortalTabState('history');
    updateStandalonePortalView('history');
    try{ await loadSavedRecords(true); }
    catch(error){
      recordListLoaded = false;
      byId('importPermitRecords').innerHTML = `<div class="import-permit-records-empty error"><b>تعذر تحميل سجل الفواتير.</b><span>${escapeText(error.message)}</span><button type="button" class="btn btn-primary btn-small" data-import-permit-retry>إعادة المحاولة</button></div>`;
      byId('importPermitResultsSummary').textContent = 'تعذر تحميل البيانات. السجل ما زال مفتوحاً.';
      byId('importPermitPagination').hidden = true;
      console.error('import permit invoice history load', error);
      toast(error.message || 'تعذر تحميل سجل الفواتير', 'err');
    }
    return true;
  }

  async function openArchivePortal(){
    if(!portalIsReady()) return;
    hidePortal('importPermitOverlay');
    hidePortal('importPermitRecordsOverlay');
    showPortal('importPermitArchiveOverlay');
    try{ await loadArchivedRecords(true); }
    catch(error){
      byId('importPermitArchivedRecords').innerHTML = `<div class="import-permit-records-empty error">${escapeText(error.message)}</div>`;
      toast(error.message || 'تعذر تحميل الأرشيف', 'err');
    }
  }

  byId('importPermitCloseX').addEventListener('click', closePortal);
  byId('importPermitRecordsCloseX').addEventListener('click', closeRecordsPortal);
  byId('importPermitArchiveCloseX').addEventListener('click', () => hidePortal('importPermitArchiveOverlay'));
  byId('importPermitOpenArchiveBtn').addEventListener('click', openArchivePortal);
  byId('importPermitBackToRecordsBtn').addEventListener('click', openRecordsPortal);
  byId('importPermitResetBtn').addEventListener('click', resetPortal);
  byId('importPermitNewBtn').addEventListener('click', () => {
    openNewInvoicePortal(true);
  });
  byId('importPermitSaveBtn').addEventListener('click', saveCurrentRecord);
  byId('importPermitRecords').addEventListener('click', event => {
    const retryButton = event.target.closest('[data-import-permit-retry]');
    const emptyAction = event.target.closest('[data-import-permit-empty-action]');
    const openButton = event.target.closest('[data-record-open]');
    const previewButton = event.target.closest('[data-record-preview]');
    const printButton = event.target.closest('[data-record-print]');
    const archiveButton = event.target.closest('[data-record-archive]');
    if(retryButton) return loadSavedRecords(true).catch(error => {
      byId('importPermitRecords').innerHTML = `<div class="import-permit-records-empty error"><b>تعذر تحميل سجل الفواتير.</b><span>${escapeText(error.message)}</span><button type="button" class="btn btn-primary btn-small" data-import-permit-retry>إعادة المحاولة</button></div>`;
    });
    if(emptyAction){
      if(emptyAction.dataset.importPermitEmptyAction === 'new') openNewInvoicePortal(true);
      else resetRecordFilters();
      return;
    }
    if(archiveButton) return changeArchiveState(archiveButton.dataset.recordArchive, true);
    if(previewButton){
      const record = savedRecords.find(item => item.id === previewButton.dataset.recordPreview);
      if(record) previewSavedRecord(record);
      return;
    }
    if(printButton){
      const record = savedRecords.find(item => item.id === printButton.dataset.recordPrint);
      if(record) printSavedRecord(record);
      return;
    }
    if(!openButton) return;
    const record = savedRecords.find(item => item.id === openButton.dataset.recordOpen);
    if(record){
      hidePortal('importPermitRecordsOverlay');
      hydratePortal(record);
      showPortal('importPermitOverlay');
      setPortalTabState('new');
      updateStandalonePortalView('new');
    }
  });
  byId('importPermitArchivedRecords').addEventListener('click', event => {
    const button = event.target.closest('[data-record-restore]');
    if(button) changeArchiveState(button.dataset.recordRestore, false);
  });
  function queueRecordLoad(delay = 0){
    clearTimeout(recordFilterTimer);
    recordPage = 1;
    recordFilterTimer = setTimeout(() => loadSavedRecords(true).catch(error => {
      byId('importPermitRecords').innerHTML = `<div class="import-permit-records-empty error"><b>تعذر تحميل سجل الفواتير.</b><span>${escapeText(error.message)}</span><button type="button" class="btn btn-primary btn-small" data-import-permit-retry>إعادة المحاولة</button></div>`;
      byId('importPermitPagination').hidden = true;
    }), delay);
  }
  byId('importPermitFilterSearch').addEventListener('input', () => queueRecordLoad(380));
  ['importPermitFilterClient','importPermitFilterCurrency','importPermitFilterFrom','importPermitFilterTo','importPermitFilterSort'].forEach(id => {
    byId(id).addEventListener('change', () => queueRecordLoad());
  });
  function resetRecordFilters(){
    byId('importPermitFilterSearch').value = '';
    byId('importPermitFilterClient').value = '';
    byId('importPermitFilterCurrency').value = '';
    byId('importPermitFilterFrom').value = '';
    byId('importPermitFilterTo').value = '';
    byId('importPermitFilterSort').value = 'updated-desc';
    queueRecordLoad();
  }
  byId('importPermitFilterResetBtn').addEventListener('click', resetRecordFilters);
  byId('importPermitPageSize').addEventListener('change', event => {
    recordPageSize = Number(event.target.value) || 10;
    queueRecordLoad();
  });
  byId('importPermitPrevPage').addEventListener('click', () => {
    if(recordPage <= 1) return;
    recordPage -= 1;
    loadSavedRecords(true).catch(error => toast(error.message, 'err'));
  });
  byId('importPermitNextPage').addEventListener('click', () => {
    if(recordPage >= recordPagination.totalPages) return;
    recordPage += 1;
    loadSavedRecords(true).catch(error => toast(error.message, 'err'));
  });
  byId('importPermitPageNumbers').addEventListener('click', event => {
    const button = event.target.closest('[data-import-permit-page]');
    if(!button) return;
    recordPage = Number(button.dataset.importPermitPage) || 1;
    loadSavedRecords(true).catch(error => toast(error.message, 'err'));
  });
  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-import-permit-tab]');
    if(!tab) return;
    if(tab.dataset.importPermitTab === 'history') openRecordsInNewTab();
    else if(!tab.classList.contains('active')) openNewInvoicePortal(true);
  });
  byId('importPermitAddItemBtn').addEventListener('click', () => { addItem(); markFormDirty(); });
  byId('permit_currency').addEventListener('change', updateAedConversionUi);
  byId('permitAedToggle').addEventListener('click', () => {
    if(byId('permit_currency').value === 'AED') return;
    aedConversionEnabled = !aedConversionEnabled;
    updateAedConversionUi();
    markFormDirty();
  });
  byId('permit_aedRate').addEventListener('input', updateAedConversionUi);
  byId('permit_consignee').addEventListener('change', function(){
    if(byId('permit_consigneeAddress').value) return;
    const address = (lookupAddresses.consignee || {})[this.value] || clientByName(this.value)?.address || '';
    setSelectValue(byId('permit_consigneeAddress'), address);
  });

  byId('importPermitItems').addEventListener('input', event => {
    const row = event.target.closest('.import-permit-item');
    if(!row) return;
    if(event.target.classList.contains('permit-item-commodity')) applyCommodity(row);
    if(event.target.classList.contains('permit-item-qty') || event.target.classList.contains('permit-item-amount')) recalculateRow(row);
  });
  byId('importPermitItems').addEventListener('change', event => {
    const row = event.target.closest('.import-permit-item');
    if(row && event.target.classList.contains('permit-item-commodity')) applyCommodity(row);
  });
  byId('importPermitItems').addEventListener('click', event => {
    const button = event.target.closest('.import-permit-item-remove');
    if(!button || button.disabled) return;
    button.closest('.import-permit-item').remove();
    renumberItems();
    recalculateGrandTotal();
    markFormDirty();
  });
  byId('importPermitOverlay').addEventListener('input', event => {
    event.target.classList.remove('permit-field-missing');
    event.target.removeAttribute('aria-invalid');
    if(event.target.matches('input,select')) markFormDirty();
  });
  byId('importPermitOverlay').addEventListener('change', event => {
    event.target.classList.remove('permit-field-missing');
    event.target.removeAttribute('aria-invalid');
    if(event.target.matches('input,select')) markFormDirty();
  });

  byId('importPermitPrintBtn').addEventListener('click', async () => {
    if(!validatePortal()) return;
    if(formDirty || !currentRecordId){
      const saved = await saveCurrentRecord();
      if(!saved) return;
    }
    const record = portalRecord();
    const languageLayer = byId('docLangOverlay');
    if(languageLayer.parentElement !== document.documentElement) document.documentElement.appendChild(languageLayer);
    languageLayer.classList.add('import-permit-preview-layer');
    chooseDocLang(record, lang => {
      openPrintWindow(buildSheet(portalRecord(lang), 'proforma', lang));
    });
  });

  async function openStandaloneRegister(){
    if(!standaloneRegister || standaloneRegisterOpened) return;
    if(!byId('lockScreen').classList.contains('hidden')) return;
    if(!canUsePortal()){
      standaloneRegisterOpened = true;
      denyStandalonePortalAccess();
      return;
    }
    if(!catalog.length || !baharCompanyEntry()) return;
    standaloneRegisterOpened = true;
    if(requestedPortalView === 'new') openNewInvoicePortal(true);
    else await openRecordsPortal();
  }

  function scheduleStandaloneRegister(){
    setTimeout(openStandaloneRegister, 0);
  }

  window.addEventListener('jahez:session-ready', scheduleStandaloneRegister);
  if(standaloneRegister){
    scheduleStandaloneRegister();
    const waitForSession = setInterval(() => {
      scheduleStandaloneRegister();
      if(standaloneRegisterOpened) clearInterval(waitForSession);
    }, 300);
    setTimeout(() => {
      if(standaloneRegisterOpened) return;
      const message = byId('importPermitRouteLoader')?.querySelector('small');
      if(message) message.textContent = 'ما زال النظام يسترجع جلستك الحالية؛ اترك هذا التبويب مفتوحاً للحظات.';
    }, 12000);
  }
})();
