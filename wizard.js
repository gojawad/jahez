/* Keeps the original shipment inputs, IDs, values, listeners, and save flow intact. */
(() => {
  const panel = document.getElementById('formPanel');
  if (!panel || panel.dataset.wizardReady) return;
  panel.dataset.wizardReady = '1';

  const meta = [
    ['بيانات الشحنة', 'التفاصيل الأساسية'],
    ['بيانات الصفقة والبضاعة', 'تفاصيل الصفقة'],
    ['الأطراف والمستندات', 'الأطراف والوثائق'],
    ['بيانات الشحن', 'تفاصيل الشحن والنقل'],
    ['التفاصيل والمراجعة', 'مراجعة وإرسال']
  ];
  const findTitle = text => [...panel.querySelectorAll(':scope > .section-title')]
    .find(el => el.textContent.trim().startsWith(text));
  const takeBlock = text => {
    const title = findTitle(text);
    return title ? [title, title.nextElementSibling] : [];
  };
  const takeAdvBlock = text => {
    const adv = document.getElementById('advWrap');
    const title = [...adv.querySelectorAll(':scope > .section-title')]
      .find(el => el.textContent.trim().startsWith(text));
    return title ? [title, title.nextElementSibling] : [];
  };
  const title = document.getElementById('formTitle');
  const editId = document.getElementById('editId');
  const actions = panel.querySelector('.form-actions');
  const advToggle = document.getElementById('advToggle');
  const adv = document.getElementById('advWrap');

  // Currency is selected once per shipment and applied to the saved amount text.
  const qtyUnitField = document.getElementById('f_qtyUnit')?.closest('.field');
  if (qtyUnitField && !document.getElementById('f_currency')) {
    const currencyField = document.createElement('div');
    currencyField.className = 'field';
    currencyField.innerHTML = `<label>عملة الفاتورة</label><select id="f_currency" class="lookup-sel" dir="ltr"><option value="USD">USD - دولار أمريكي</option><option value="AED">AED - درهم إماراتي</option><option value="SAR">SAR - ريال سعودي</option></select>`;
    qtyUnitField.insertAdjacentElement('afterend', currencyField);
  }
  const currencyInput = document.getElementById('f_currency');
  const currencyCode = () => currencyInput?.value || 'USD';
  const numericValue = value => {
    const parsed = parseFloat(String(value || '').replace(/[^\d.,]/g, '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const hasCurrencyCode = value => /\b[A-Za-z]{3}\b/.test(String(value || ''));
  const formatCurrency = value => {
    const number = numericValue(value);
    return Number.isFinite(number) ? `${currencyCode()} ${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(value || '');
  };
  const detectCurrency = () => {
    const source = [document.getElementById('f_totalAmount')?.value, document.getElementById('f_unitPrice')?.value].join(' ');
    const match = source.match(/\b(USD|AED|SAR)\b/i);
    return match ? match[1].toUpperCase() : 'USD';
  };
  const refreshPrimaryPrice = () => {
    const total = numericValue(document.getElementById('f_totalAmount')?.value);
    const quantity = numericValue(document.getElementById('f_totalQty')?.value || document.getElementById('f_qty')?.value);
    const price = document.getElementById('f_unitPrice');
    if (!price || price.dataset.manual === '1' || !Number.isFinite(total) || !Number.isFinite(quantity) || !quantity) return;
    price.value = formatCurrency(total / quantity);
  };
  const refreshItemAmount = number => {
    const price = document.getElementById(`f_item${number}Price`);
    const quantity = document.getElementById(`f_item${number}Qty`);
    const amount = document.getElementById(`f_item${number}Amount`);
    if (!price || !quantity || !amount || amount.dataset.manual === '1') return;
    const unitPrice = numericValue(price.value), qty = numericValue(quantity.value);
    if (Number.isFinite(unitPrice) && Number.isFinite(qty)) amount.value = formatCurrency(unitPrice * qty);
  };
  const normalizeCurrencyInputs = () => {
    ['f_unitPrice', 'f_totalAmount'].forEach(id => {
      const input = document.getElementById(id);
      if (input && input.value.trim() && !hasCurrencyCode(input.value)) input.value = formatCurrency(input.value);
    });
    for (let number = 2; number <= 15; number++) {
      [`f_item${number}Price`, `f_item${number}Amount`].forEach(id => {
        const input = document.getElementById(id);
        if (input && input.value.trim() && !hasCurrencyCode(input.value)) input.value = formatCurrency(input.value);
      });
    }
  };
  currencyInput?.addEventListener('change', () => {
    refreshPrimaryPrice();
    for (let number = 2; number <= 15; number++) refreshItemAmount(number);
  });
  document.getElementById('f_totalAmount')?.addEventListener('input', refreshPrimaryPrice);
  document.getElementById('f_qty')?.addEventListener('input', refreshPrimaryPrice);
  document.getElementById('f_totalQty')?.addEventListener('input', refreshPrimaryPrice);
  for (let number = 2; number <= 15; number++) {
    document.getElementById(`f_item${number}Price`)?.addEventListener('input', () => refreshItemAmount(number));
    document.getElementById(`f_item${number}Qty`)?.addEventListener('input', () => refreshItemAmount(number));
  }
  panel.addEventListener('focusout', event => {
    if (!event.target.matches('#f_unitPrice,#f_totalAmount,[id^="f_item"][id$="Price"],[id^="f_item"][id$="Amount"]')) return;
    if (event.target.value.trim() && !hasCurrencyCode(event.target.value)) event.target.value = formatCurrency(event.target.value);
  });
  panel.addEventListener('click', event => {
    if (event.target.closest('#saveBtn,#saveDraftBtn')) normalizeCurrencyInputs();
  }, true);
  new MutationObserver(() => {
    if (!panel.classList.contains('open') || !currencyInput) return;
    currencyInput.value = detectCurrency();
  }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  const shell = document.createElement('div');
  shell.className = 'shipment-wizard';
  shell.innerHTML = `<aside class="wizard-sidebar"><div class="wizard-progress"><b>0%</b></div><div class="wizard-progress-label">تقدم تعبئة البيانات</div><div class="wizard-steps"></div></aside><section class="wizard-content"><div class="wizard-top"><div class="wizard-top-row"><div><h3>إدخال الشحنة خطوة بخطوة</h3><p>أكمل البيانات المطلوبة ثم تابع للمرحلة التالية.</p></div><b class="wizard-step-count">الخطوة 1 من 5</b></div><div class="wizard-bar"><span></span></div></div></section>`;
  editId.insertAdjacentElement('afterend', shell);
  const stepsEl = shell.querySelector('.wizard-steps');
  const content = shell.querySelector('.wizard-content');
  const steps = meta.map(([name, desc], index) => {
    const nav = document.createElement('button');
    nav.type = 'button'; nav.className = 'wizard-step-link'; nav.dataset.step = index + 1;
    nav.innerHTML = `<span class="wizard-step-num">${index + 1}</span><span><strong>${name}</strong><small>${desc}</small></span>`;
    stepsEl.append(nav);
    const step = document.createElement('section');
    step.className = 'wizard-step'; step.dataset.step = index + 1;
    step.setAttribute('aria-label', name); content.append(step);
    return step;
  });
  const append = (step, nodes) => nodes.filter(Boolean).forEach(n => step.append(n));
  append(steps[0], takeBlock('نوع الشحن'));
  append(steps[1], [...takeBlock('بيانات الصفقة'), ...takeBlock('بنود إضافية')]);
  append(steps[2], [...takeBlock('الأطراف'), ...takeBlock('أرقام المستندات')]);
  append(steps[3], [advToggle, adv]);
  append(steps[4], [...takeAdvBlock('تفاصيل الشحن'), ...takeAdvBlock('التحصيل'), ...takeAdvBlock('العنوان البنكي'), ...takeAdvBlock('ملاحظات')]);
  const summary = document.createElement('div');
  summary.className = 'wizard-summary'; summary.id = 'wizardSummary';
  steps[4].append(summary, actions);

  steps.forEach((step, index) => {
    if (index < 4) {
      const nav = document.createElement('div'); nav.className = 'wizard-nav';
      nav.innerHTML = `<button type="button" class="btn btn-ghost wizard-prev" ${index ? '' : 'id="wizardCancel"'}>${index ? 'السابق' : 'إلغاء'}</button><div class="wizard-nav-right"><button type="button" class="btn btn-gold wizard-draft">حفظ كمسودة</button><button type="button" class="btn btn-primary wizard-next">موافق ومتابعة</button></div><div class="wizard-error">يرجى إكمال الحقول المطلوبة للمتابعة</div>`;
      step.append(nav);
    }
  });

  const required = [
    ['f_company', 'f_shipType'],
    ['f_itemDesc', 'f_qty', 'f_totalAmount'],
    ['f_exporter', 'f_consignee', 'f_invoiceNo'],
    [], []
  ];
  let current = 1;
  const allFields = () => [...panel.querySelectorAll('input,select,textarea')].filter(el =>
    el.type !== 'hidden' && el.id !== 'f_bankDetails' && !el.closest('.wizard-sidebar') &&
    !(el.closest('.item-block') && el.closest('.item-block').style.display === 'none')
  );
  const valueOf = id => {
    const el = document.getElementById(id); if (!el) return '—';
    if (el.tagName === 'SELECT') return el.options[el.selectedIndex]?.text || el.value || '—';
    return el.value.trim() || '—';
  };
  const refreshSummary = () => {
    const entries = [['نوع الشحن','f_shipType'],['الشركة','f_company'],['السلعة','f_itemDesc'],['القيمة الإجمالية','f_totalAmount'],['المصدر','f_exporter'],['المرسل إليه','f_consignee'],['رقم الفاتورة','f_invoiceNo'],['رقم البوليصة','f_billNo']];
    summary.innerHTML = entries.map(([label,id]) => `<div><span>${label}</span><b>${valueOf(id)}</b></div>`).join('');
  };
  const refreshProgress = () => {
    const fields = allFields();
    const filled = fields.filter(el => String(el.value || '').trim()).length;
    const pct = fields.length ? Math.round(filled / fields.length * 100) : 0;
    const hue = Math.round(Math.min(135, pct * 1.35));
    shell.style.setProperty('--wizard-progress', pct); shell.style.setProperty('--wizard-color', `hsl(${hue} 75% 45%)`);
    shell.querySelector('.wizard-progress b').textContent = `${pct}%`;
    refreshSummary();
  };
  const setStep = step => {
    current = Math.max(1, Math.min(5, step));
    steps.forEach((el, i) => el.classList.toggle('active', i + 1 === current));
    [...stepsEl.children].forEach((el, i) => {
      el.classList.toggle('active', i + 1 === current); el.classList.toggle('done', i + 1 < current);
      el.setAttribute('aria-current', i + 1 === current ? 'step' : 'false');
      el.querySelector('.wizard-step-num').textContent = i + 1 < current ? '✓' : i + 1;
    });
    shell.querySelector('.wizard-step-count').textContent = `الخطوة ${current} من 5`;
    try { sessionStorage.setItem('shipment_wizard_step', String(current)); } catch (_) {}
    refreshProgress();
    steps[current - 1].scrollIntoView({behavior:'smooth', block:'start'});
  };
  const validate = step => {
    const missing = required[step - 1].map(id => document.getElementById(id)).filter(el => el && !String(el.value || '').trim());
    steps[step -1].querySelectorAll('.wizard-invalid').forEach(el => el.classList.remove('wizard-invalid'));
    const error = steps[step - 1].querySelector('.wizard-error');
    if (!missing.length) { if (error) error.classList.remove('show'); return true; }
    missing.forEach(el => el.classList.add('wizard-invalid'));
    if (error) error.classList.add('show'); missing[0].scrollIntoView({behavior:'smooth', block:'center'}); missing[0].focus();
    return false;
  };
  stepsEl.addEventListener('click', e => { const btn = e.target.closest('.wizard-step-link'); if (btn && +btn.dataset.step <= current) setStep(+btn.dataset.step); });
  shell.addEventListener('click', e => {
    if (e.target.closest('.wizard-next') && validate(current)) setStep(current + 1);
    if (e.target.closest('.wizard-prev')) current > 1 ? setStep(current - 1) : document.getElementById('cancelBtn').click();
    if (e.target.closest('.wizard-draft')) document.getElementById('saveDraftBtn').click();
  });
  panel.addEventListener('input', refreshProgress); panel.addEventListener('change', refreshProgress);
  document.getElementById('newBtn').addEventListener('click', () => setTimeout(() => setStep(1), 0));
  const oldOpen = panel.classList.contains('open');
  try { current = Math.max(1, Math.min(5, +(sessionStorage.getItem('shipment_wizard_step') || 1))); } catch (_) {}
  setStep(oldOpen ? current : 1);
  refreshProgress();
})();
