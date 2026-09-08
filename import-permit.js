(function(){
  'use strict';

  const MAX_ITEMS = 10;
  const catalog = Array.isArray(window.BALDNA_COMMODITY_CATALOG) ? window.BALDNA_COMMODITY_CATALOG : [];
  const catalogById = new Map(catalog.map(item => [String(item.id), item]));
  let rowSequence = 0;
  let savedRecords = [];
  let currentRecordId = '';
  let currentReference = '';
  let recordListLoaded = false;
  let formDirty = false;

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
    return (typeof canEdit === 'function' && canEdit()) || (typeof isBsgtPortalUser === 'function' && isBsgtPortalUser());
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
    byId('importPermitRecords').innerHTML = '<div class="import-permit-records-empty">جاري تحميل السجل...</div>';
    const result = await portalApi('/api/import-permit-invoices');
    savedRecords = Array.isArray(result.records) ? result.records : [];
    recordListLoaded = true;
    renderSavedRecords();
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
    byId('importPermitGrandCurrency').textContent = byId('permit_currency').value || 'AED';
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
      incoterm: byId('permit_incoterm').value,
      paymentTerm: byId('permit_paymentTerm').value,
      bankId: byId('permit_bankPick').value,
      weight: byId('permit_weight').value.trim(),
      items: [...byId('importPermitItems').children].map(row => {
        const commodity = selectedCommodity(row);
        return {
          commodityId: commodity?.id || '',
          description: commodity?.name || '',
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
    setSelectValue(byId('permit_bankPick'), data.bankId || '');
    byId('importPermitItems').innerHTML = '';
    (data.items || []).forEach(item => addItem({commodityId:item.commodityId, quantity:item.quantity, amount:item.amount}));
    if(!byId('importPermitItems').children.length) addItem();
    clearValidation();
    recalculateGrandTotal();
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

  function portalRecord(){
    const companyEntry = baharCompanyEntry();
    const currency = byId('permit_currency').value;
    const bank = bankBook.find(entry => entry.id === byId('permit_bankPick').value);
    const lines = [...byId('importPermitItems').children].map(row => {
      const commodity = selectedCommodity(row);
      return {
        description: commodity.name,
        quantity: numeric(row.querySelector('.permit-item-qty').value),
        unit: commodity.unit,
        hsCode: commodity.hsCode,
        amount: numeric(row.querySelector('.permit-item-amount').value),
        price: numeric(row.querySelector('.permit-item-price').value)
      };
    });
    const currencyValue = value => `${currency} ${money(value)}`;
    const grandTotal = lines.reduce((sum, line) => sum + line.amount, 0);
    const record = {
      companyId: companyEntry.id,
      permitInvoice: true,
      permitInvoiceCurrency: currency,
      permitInvoiceReference: currentReference,
      proformaNo: byId('permit_proformaNo').value.trim(),
      proformaDate: byId('permit_proformaDate').value,
      consignee: byId('permit_consignee').value,
      consigneeAddress: byId('permit_consigneeAddress').value,
      portDischarge: byId('permit_portDischarge').value,
      countryOrigin: byId('permit_countryOrigin').value,
      countryOfOrigin: byId('permit_countryOrigin').value,
      incoterm: byId('permit_incoterm').value,
      paymentTerm: byId('permit_paymentTerm').value,
      bankId: bank?.id || '',
      bankDetails: bank?.body || '',
      currency,
      grossWeight: byId('permit_weight').value.trim(),
      totalQty: groupedQuantity(lines),
      qtyUnit: '',
      totalAmount: currencyValue(grandTotal),
      bsgtAutoAed: false,
      bsgtShowWeight: !!byId('permit_weight').value.trim()
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

  function renderSavedRecords(){
    const host = byId('importPermitRecords');
    if(!host) return;
    if(!recordListLoaded){
      host.innerHTML = '<div class="import-permit-records-empty">جاري تحميل السجل...</div>';
      return;
    }
    if(!savedRecords.length){
      host.innerHTML = '<div class="import-permit-records-empty">لا توجد فواتير محفوظة بعد.</div>';
      return;
    }
    host.innerHTML = savedRecords.slice(0, 12).map(record => {
      const active = record.id === currentRecordId ? ' active' : '';
      return `<button type="button" class="import-permit-record${active}" data-record-id="${escapeText(record.id)}">
        <b>${escapeText(record.reference)}</b>
        <span>${escapeText(record.data?.proformaNo || 'بدون رقم')} · ${escapeText(record.data?.consignee || 'بدون مستلم')}</span>
        <small>${escapeText(formatSavedDate(record.updatedAt))}</small>
      </button>`;
    }).join('');
  }

  function resetPortal(){
    clearValidation();
    ['permit_proformaNo','permit_weight'].forEach(id => { byId(id).value = ''; });
    ['permit_consignee','permit_consigneeAddress','permit_portDischarge','permit_countryOrigin','permit_incoterm','permit_paymentTerm','permit_bankPick'].forEach(id => { byId(id).value = ''; });
    byId('permit_proformaDate').value = todayIso();
    byId('permit_currency').value = 'AED';
    byId('importPermitItems').innerHTML = '';
    addItem();
    recalculateGrandTotal();
    setCurrentRecord(null);
  }

  function closePortal(){
    const overlay = byId('importPermitOverlay');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  window.openImportPermitInvoice = async function(){
    if(!canUsePortal()){
      toast('ليست لديك صلاحية إنشاء الفاتورة', 'err');
      return;
    }
    if(!catalog.length){
      alert('تعذر تحميل دليل سلع منصة بلدنا. حدّث الصفحة وحاول مرة أخرى.');
      return;
    }
    if(!baharCompanyEntry()){
      alert('شركة بحر سواكن غير موجودة في قائمة الشركات.');
      return;
    }
    fillPortalOptions();
    if(!byId('importPermitItems').children.length) resetPortal();
    const overlay = byId('importPermitOverlay');
    if(overlay.parentElement !== document.documentElement) document.documentElement.appendChild(overlay);
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    if(!recordListLoaded){
      try{ await loadSavedRecords(); }
      catch(error){
        byId('importPermitRecords').innerHTML = `<div class="import-permit-records-empty error">${escapeText(error.message)}</div>`;
        toast(error.message || 'تعذر تحميل سجل الفواتير', 'err');
      }
    }
  };

  byId('importPermitCloseX').addEventListener('click', closePortal);
  byId('importPermitResetBtn').addEventListener('click', resetPortal);
  byId('importPermitNewBtn').addEventListener('click', resetPortal);
  byId('importPermitSaveBtn').addEventListener('click', saveCurrentRecord);
  byId('importPermitRecords').addEventListener('click', event => {
    const button = event.target.closest('[data-record-id]');
    if(!button) return;
    const record = savedRecords.find(item => item.id === button.dataset.recordId);
    if(record) hydratePortal(record);
  });
  byId('importPermitAddItemBtn').addEventListener('click', () => { addItem(); markFormDirty(); });
  byId('permit_currency').addEventListener('change', recalculateGrandTotal);
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
    openPrintWindow(buildSheet(record, 'proforma', 'en'));
  });
})();
