'use strict';
// اختبار دخاني: يشغّل الخادم على منفذ عشوائي ويتحقق من الواجهة والـ API وتوليد PDF.
// التشغيل: node test/smoke.test.js   (اضبط CHROMIUM_PATH إن لم يكن Chromium في المسار الافتراضي)

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const PORT = 3900 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForServer(proc) {
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode !== null) throw new Error(`server exited early with code ${proc.exitCode}`);
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}

async function main() {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), BUILD_SHA: 'test-sha', BROWSERLESS_TOKEN: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    stdio: ['ignore', 'inherit', 'inherit']
  });
  try {
    await waitForServer(proc);
    const results = [];
    let appHtml = '';
    let companyWizard = '';
    let shipmentListCss = '';
    let shipmentListJs = '';
    const check = async (name, fn) => { await fn(); results.push(name); console.log('✔', name); };

    await check('healthz reports build sha', async () => {
      const j = await (await fetch(`${BASE}/healthz`)).json();
      assert.strictEqual(j.ok, true); assert.strictEqual(j.commitSha, 'test-sha');
    });
    await check('/ serves index.html uncached', async () => {
      const r = await fetch(`${BASE}/`);
      assert.strictEqual(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.match(r.headers.get('cache-control'), /no-cache/);
      assert.strictEqual(r.headers.get('x-frame-options'), 'SAMEORIGIN');
      appHtml = await r.text();
      assert.ok(appHtml.includes('supabase'), 'index.html should be the app');
      const wizardResponse = await fetch(`${BASE}/company-wizard.js`);
      assert.strictEqual(wizardResponse.status, 200);
      companyWizard = await wizardResponse.text();
    });
    await check('login presentation is responsive and Turnstile-protected', async () => {
      assert.ok(appHtml.includes('login.css?v=20260909-bsgt-login-4'));
      assert.ok(appHtml.includes('مرتبطة بخدمات BSGT لتجربة لوجستية متكاملة'));
      assert.ok(appHtml.includes("`${SB_URL}/functions/v1/verify-turnstile`"));
      assert.ok(appHtml.includes('await verifyTurnstile();'));
      const loginSubmit = appHtml.indexOf('async function handleLockSubmit');
      assert.ok(appHtml.indexOf('await verifyTurnstile();', loginSubmit) < appHtml.indexOf('sb.auth.signInWithPassword', loginSubmit));
      assert.ok(!appHtml.includes('TURNSTILE_SECRET_KEY'));
      const cssResponse = await fetch(`${BASE}/login.css`);
      assert.strictEqual(cssResponse.status, 200);
      const loginCss = await cssResponse.text();
      assert.ok(loginCss.includes('body.login-active'));
      assert.ok(loginCss.includes('@media (max-width: 899px)'));
      assert.ok(loginCss.includes('display: none !important'));
      assert.ok(loginCss.includes('min-height: 100dvh'));
      assert.ok(loginCss.includes('env(safe-area-inset-top)'));
      assert.ok(loginCss.includes('--login-hero-image: url("jahez-login-bsgt.png")'));
      assert.ok(loginCss.includes('background-size: 100% 100%, 100% 100%, contain'));
      assert.ok(loginCss.includes('filter: blur(18px) saturate(.72)'));
      assert.ok(!loginCss.includes('transform: scale('));
      const heroResponse = await fetch(`${BASE}/jahez-login-bsgt.png`);
      assert.strictEqual(heroResponse.status, 200);
      assert.match(heroResponse.headers.get('content-type'), /image\/png/);
    });
    await check('public landing is isolated and opens the existing login', async () => {
      const landingSource = appHtml.slice(appHtml.indexOf('<div id="landingPage"'), appHtml.indexOf('<div id="lockScreen"'));
      assert.ok(appHtml.includes('landing.css?v=20260909-landing-1'));
      assert.ok(appHtml.includes('id="landingPage"'));
      assert.ok(appHtml.includes('id="landingLoginBtn"'));
      assert.ok(appHtml.includes('data-open-login'));
      assert.ok(appHtml.includes('await initLock();'));
      assert.ok(appHtml.includes('if(isPublicLandingRequest()) showLanding();'));
      assert.ok(appHtml.includes('document.getElementById(\'landingPage\').hidden = true'));
      assert.ok(!/12,500|1,200|99\.9%/.test(landingSource), 'unverified statistics must not be published');
      const landingResponse = await fetch(`${BASE}/landing.css`);
      assert.strictEqual(landingResponse.status, 200);
      const landingCss = await landingResponse.text();
      assert.ok(landingCss.includes('body.landing-active'));
      assert.ok(landingCss.includes('grid-template-columns: minmax(0, 45fr) minmax(0, 55fr)'));
      assert.ok(landingCss.includes('@media (max-width: 767px)'));
      assert.ok(landingCss.includes('height: clamp(260px, 78vw, 320px)'));
      assert.ok(!landingCss.includes('transform: scale('));
    });
    await check('central brand theme is loaded last and exposes the approved palette', async () => {
      assert.ok(appHtml.includes('brand-theme.css?v=20260911-brand-2'));
      assert.ok(appHtml.indexOf('brand-theme.css?v=20260911-brand-2') > appHtml.indexOf('login.css?v=20260909-bsgt-login-4'));
      const themeResponse = await fetch(`${BASE}/brand-theme.css`);
      assert.strictEqual(themeResponse.status, 200);
      const themeCss = await themeResponse.text();
      assert.ok(themeCss.includes('--brand-primary: #EA1B23'));
      assert.ok(themeCss.includes('--brand-dark: #D01119'));
      assert.ok(themeCss.includes('--brand-gradient: linear-gradient(135deg, #EA1B23 0%, #D01119 100%)'));
      assert.ok(themeCss.includes('.app-sidebar .o-menu button.active'));
      assert.ok(themeCss.includes('#viewRecords.shipment-glass-page'));
      assert.ok(themeCss.includes('.import-permit-overlay'));
      const collectionHtml = await (await fetch(`${BASE}/experiments/bs-collection/`)).text();
      assert.ok(collectionHtml.includes('../../brand-theme.css?v=20260911-brand-2'));
      assert.ok(collectionHtml.indexOf('brand-theme.css') > collectionHtml.indexOf('jahez-glass.css'));
      const publicShipmentHtml = await fs.promises.readFile(path.join(__dirname, '..', 'public-shipment.html'), 'utf8');
      assert.ok(publicShipmentHtml.includes('class="public-shipment-page"'));
      assert.ok(publicShipmentHtml.includes('/brand-theme.css?v=20260911-brand-2'));
      const qrSplashHtml = await fs.promises.readFile(path.join(__dirname, '..', 'qr-splash.html'), 'utf8');
      assert.ok(qrSplashHtml.includes('--brand-primary:#EA1B23'));
      assert.ok(qrSplashHtml.includes('--brand-dark:#D01119'));
    });
    await check('shipment workflow acceptance and BSGT merge gate stay independent from review status', async () => {
      assert.ok(appHtml.includes('shipment-workflow.js?v=20260911-workflow-4'));
      assert.ok(appHtml.includes('JahezShipmentWorkflow.fromRow(row)'));
      assert.ok(appHtml.includes('JahezShipmentWorkflow.toRow(r)'));
      const helperResponse = await fetch(`${BASE}/shipment-workflow.js`);
      assert.strictEqual(helperResponse.status, 200);
      const helperSource = await helperResponse.text();
      assert.ok(helperSource.includes("['created', 'bank_sent', 'signed', 'accepted']"));
      assert.ok(helperSource.includes("workflow_stage: 'bank_sent'"));
      assert.ok(helperSource.includes("SIGNED_DOCUMENT_TYPES = Object.freeze(['letter', 'undertaking', 'exchange'])"));
      assert.ok(helperSource.includes('function evaluateShipmentSigning(record, files)'));
      assert.ok(helperSource.includes('function signingSyncFields(record, files, changedAt)'));
      assert.ok(helperSource.includes('function canAcceptShipment(record, files)'));
      assert.ok(helperSource.includes('function acceptedFields(userId, acceptedAt)'));
      assert.ok(helperSource.includes('function canMergeShipmentPackage(record, files)'));
      assert.ok(helperSource.includes('function packageMergeBlockReason(record, files)'));
      assert.ok(appHtml.includes('function bsgtPackageMergeAccess(r, files)'));
      assert.ok(appHtml.includes("const permissionAllowed = Boolean(window.JahezPermissions?.can('package.merge'))"));
      assert.ok(appHtml.includes('allowed: permissionAllowed && workflowAllowed'));
      assert.ok(appHtml.includes("reason: !permissionAllowed ? 'ليس لديك صلاحية دمج الحزمة.' : JahezShipmentWorkflow.packageMergeBlockReason(r, files)"));
      assert.ok(appHtml.includes('function renderSignedDocumentsPanel(r)'));
      assert.ok(appHtml.includes('async function uploadSignedShipmentDocument(r, type, file)'));
      assert.ok(appHtml.includes('async function syncShipmentSignedWorkflow(shipmentId)'));
      assert.ok(appHtml.includes("sb.from('shipments').select('*').eq('id', id).single()"));
      assert.ok(appHtml.includes("sb.from('shipment_files').select('*').eq('shipment_id', id)"));
      assert.ok(appHtml.includes("signatureStatus:'signed'"));
      assert.ok(appHtml.includes('renderSignedDocumentsPanel(r)'));
      assert.ok(appHtml.includes('بانتظار المستندات الموقعة'));
      assert.ok(appHtml.includes('اكتمل توقيع المستندات'));
      assert.ok(appHtml.includes('function canCurrentUserAcceptShipment()'));
      assert.ok(appHtml.includes('async function acceptShipmentDocuments(shipmentId, triggerButton)'));
      assert.ok(appHtml.includes(".eq('workflow_stage', 'signed').select('*').maybeSingle()"));
      assert.ok(appHtml.includes('shipmentAcceptanceInFlight.has(id)'));
      assert.ok(appHtml.includes('قبول المستندات وإكمال الشحنة'));
      assert.ok(appHtml.includes('مكتملة ومعتمدة'));
      assert.ok(appHtml.includes('function ensureBsgtPackageMergeAllowed(record'));
      assert.ok(appHtml.includes('async function ensureBsgtFinalPackageAllowed(shipmentId)'));
      assert.ok(appHtml.includes("workflowMode:'legacy'"));
      assert.ok(appHtml.includes("workflowMode:'trade_file'"));
      assert.ok(appHtml.includes('adminOverride:false'));
      assert.ok(appHtml.includes('async function requestBsgtPackageMerge(record, triggerButton)'));
      const bsgtMergeSource = appHtml.slice(appHtml.indexOf('async function mergeBsgtPackageLocally'), appHtml.indexOf('window.refreshAllPublishedBsgtQrPackages'));
      assert.ok(bsgtMergeSource.indexOf('ensureBsgtPackageMergeAllowed(r)') < bsgtMergeSource.indexOf('PDFDocument.create()'));
      const fullMergeSource = appHtml.slice(appHtml.indexOf('async function mergeFullPackage'), appHtml.indexOf('// ===== اختيار لغة الطباعة'));
      assert.ok(fullMergeSource.indexOf('ensureBsgtPackageMergeAllowed(r, {showDialog:true})') < fullMergeSource.indexOf('await ensureQrToken(r)'));
      assert.ok(fullMergeSource.includes("if(!gate.allowed) return;"));
      assert.ok(appHtml.includes("if(isBsgtRecord(r)) return requestBsgtPackageMerge(r, document.getElementById('packageBtn'))"));
      assert.ok(appHtml.includes("if(isBsgtRecord(r)) return requestBsgtPackageMerge(r, document.getElementById('mergeAllBtn'))"));
      assert.ok(appHtml.includes('printPackage(r, lang);'));
      assert.ok(appHtml.includes("const canManage = canManageShipmentFiles(r) && stage !== 'accepted'"));
      const collectionHtml = await (await fetch(`${BASE}/experiments/bs-collection/`)).text();
      assert.ok(collectionHtml.includes('../../shipment-workflow.js?v=20260911-workflow-4'));
      const collectionSource = await fs.promises.readFile(path.join(__dirname, '..', 'experiments', 'bs-collection', 'collection-lab.js'), 'utf8');
      assert.ok(collectionSource.includes('JahezShipmentWorkflow.bankSentFields(data.collectionSentAt)'));
      assert.ok(collectionSource.includes("data.collectionStatus='sent'"));
      assert.ok(collectionSource.includes("data.collectionSentAt=sentAt"));
    });
    await check('shipment company isolation guards are present', async () => {
      assert.ok(appHtml.includes('function companyEntryForRecord(r)'));
      assert.ok(appHtml.includes('function isBsgtRecord(r)'));
      assert.ok(appHtml.includes("companyId: selectedCompanyId"));
      assert.ok(appHtml.includes("nextCompanyNumber('invoice', requestedCompanyId)"));
      assert.ok(!appHtml.includes('companyId: (prev && prev.companyId) || document.getElementById(\'f_company\').value'));
      assert.ok(!appHtml.includes('isBaharSwakenCompany(companyDataFor(r))'));
    });
    await check('Bahar sale contract is a compact configurable single A4 sheet', async () => {
      const contractSource = appHtml.slice(appHtml.indexOf('function baharSwakenContractSheet(r)'), appHtml.indexOf('\nfunction invoiceSheet', appHtml.indexOf('function baharSwakenContractSheet(r)')));
      assert.ok(appHtml.includes('function baharSwakenContractSheet(r)'));
      assert.ok(appHtml.includes('function shiftIsoDate(value, dayOffset)'));
      assert.ok(appHtml.includes('shiftIsoDate(r.proformaDate, 3)'));
      assert.ok(appHtml.includes('date.setUTCDate(date.getUTCDate() + Number(dayOffset || 0))'));
      assert.ok(appHtml.includes('function bsgtInvoiceAedText(amountText, enabled = true)'));
      assert.ok(appHtml.includes("return 'AED ' + (numeric * 3.67)"));
      assert.ok(appHtml.includes('const invoiceValue = value => bsgtInvoiceAedText(value, r.bsgtAutoAed !== false)'));
      assert.ok(appHtml.includes("['إجمالي القيمة', contractTotal, 'Total Contract Value']"));
      assert.ok(appHtml.includes("['العملة', contractCurrency, 'Currency']"));
      assert.ok(appHtml.includes("const stationery = settings.header || '';"));
      assert.ok(appHtml.includes('bahar-contract-stationery'));
      assert.ok(!contractSource.includes('bahar-contract-bg'));
      assert.ok(!contractSource.includes('bahar-contract-watermark'));
      assert.ok(!contractSource.includes('bahar-inv-brand'));
      assert.ok(appHtml.includes("fmtDateByLang(bsgtContractDate(r), 'en')"));
      assert.ok(appHtml.includes("has-contract-stationery':''"));
      assert.ok(appHtml.includes('--contract-line-height:${contractLayout.lineHeight}'));
      assert.ok(appHtml.includes('contractCellPaddingMm'));
      assert.ok(appHtml.includes("marginPreset === 'normal' ? 25.4"));
      assert.ok(appHtml.includes('border:.2mm solid #000'));
      assert.ok(appHtml.includes('background:transparent'));
      assert.ok(appHtml.includes("Number(qrPosition.yPercent) <= 36"));
      assert.ok(appHtml.includes('.bahar-contract-sheet.qr-top-right'));
      assert.ok(appHtml.includes('.bahar-contract-title{display:grid;gap:0;width:100%'));
      assert.ok(appHtml.includes('function baharContractRuntimeSettings(r)'));
      assert.ok(appHtml.includes('companySettings.contractBranding || {}'));
      assert.ok(appHtml.includes('--contract-table-y:${contractLayout.tableTopMm}mm'));
      assert.ok(appHtml.includes("grid-template-areas:'en value ar'"));
      assert.ok(appHtml.includes('cc-contract">تعديل العقد'));
      assert.ok(companyWizard.includes('window.openBaharContractEditor = async id =>'));
      assert.ok(companyWizard.includes('contractBranding:clone(draft)'));
      assert.ok(companyWizard.includes('موضع ختم العقد فقط'));
      assert.ok(companyWizard.includes('إضافة / استبدال ختم العقد'));
      assert.ok(companyWizard.includes('استخدام ختم الفاتورة'));
      assert.ok(companyWizard.includes("next.useContractStamp = stampCard.dataset.override === 'true'"));
      assert.ok(appHtml.includes('settings.useContractStamp === true'));
      assert.ok(appHtml.includes("settings.contractStamp || ''"));
      assert.ok(companyWizard.includes('خلفية وترويسة صفحة العقد'));
      assert.ok(companyWizard.includes('bce-header-pick'));
      assert.ok(companyWizard.includes("['stamp','qr']"));
      assert.ok(!companyWizard.includes('bce-show-header'));
      assert.ok(!companyWizard.includes("transformFields('header'"));
      assert.ok(appHtml.includes('company-wizard.js?v=20260912-granular-permissions'));
      assert.ok(appHtml.includes('contract-client-assets.js?v=20260912-1'));
      assert.ok(companyWizard.includes('تحريك الجدول لأعلى أو أسفل'));
      assert.ok(companyWizard.includes('Office 307 Al Faheem Building'));
      assert.ok(!appHtml.includes('${decorations(false,true)}${brand()}'));
    });
    await check('BSGT shipment attachments have role-scoped management UI', async () => {
      assert.ok(appHtml.includes('function canManageShipmentFiles(r)'));
      assert.ok(appHtml.includes('isBsgtPortalUser() && isBsgtRecord(r)'));
      assert.ok(appHtml.includes('async function deleteBaharDocument(r, key)'));
      assert.ok(appHtml.includes("uploaded && canDeleteFiles ? `<button"));
      assert.ok(appHtml.includes('حذف الملف'));
      assert.ok(appHtml.includes('ستبقى الخانة فارغة ويمكنك رفع ملف جديد لاحقاً'));
      assert.ok(appHtml.includes("shipmentFilesCache[r.id] = (shipmentFilesCache[r.id] || []).filter(item=>item.label!==label)"));
      assert.ok(appHtml.includes('shipmentFilesErrors[id]'));
      assert.ok(appHtml.includes('تعذر تحميل الملف — تحقق من الصلاحية أو الاتصال'));
      const policySql = fs.readFileSync(path.join(__dirname, '..', 'supabase', '25_قراءة_مرفقات_BSGT.sql'), 'utf8');
      assert.ok(policySql.includes('public.is_bsgt_user() and s.company_id = public.bsgt_company_id()'));
      assert.ok(policySql.includes('create policy shipmentfiles_select'));
      assert.ok(policySql.includes('create policy shippkgatt_select'));
      const managePolicySql = fs.readFileSync(path.join(__dirname, '..', 'supabase', '26_إدارة_مرفقات_BSGT.sql'), 'utf8');
      assert.ok(managePolicySql.includes('create policy shipmentfiles_write'));
      assert.ok(managePolicySql.includes('create policy shipmentfiles_delete'));
      assert.ok(managePolicySql.includes('public.is_bsgt_user() and s.company_id = public.bsgt_company_id()'));
    });

    await check('Collection document formatting controls are admin-only', async () => {
      const portalHtml = fs.readFileSync(path.join(__dirname, '..', 'experiments', 'bs-collection', 'index.html'), 'utf8');
      const portalJs = fs.readFileSync(path.join(__dirname, '..', 'experiments', 'bs-collection', 'collection-lab.js'), 'utf8');
      const portalCss = fs.readFileSync(path.join(__dirname, '..', 'experiments', 'bs-collection', 'collection-lists.css'), 'utf8');
      assert.ok(portalHtml.includes('<body class="role-collection-preview-only collection-enterprise-ui portal-access-loading">'));
      assert.ok(portalHtml.includes('settings-section admin-document-settings'));
      assert.ok(portalJs.includes("document.body.classList.toggle('role-collection-preview-only',portalRole!=='admin')"));
      assert.ok(portalJs.includes("if(portalRole!=='admin') return;"));
      assert.ok(portalCss.includes('.role-collection-preview-only .document-editor-panel'));
      assert.ok(portalCss.includes('.role-collection-preview-only .admin-document-settings'));
    });
    await check('BSGT bill numbers are duplicate-safe and operation history is visible', async () => {
      assert.ok(appHtml.includes('function normalizeBsgtBillNumber(value)'));
      assert.ok(appHtml.includes('function findDuplicateBsgtBill(value, excludeId = bsgtShipEditId)'));
      assert.ok(appHtml.includes('async function findDuplicateBsgtBillOnServer(companyId, value, excludeId = bsgtShipEditId)'));
      assert.ok(appHtml.includes(".eq('company_id', companyId)"));
      assert.ok(appHtml.includes('رقم البوليصة مستخدم مسبقاً في'));
      assert.ok(appHtml.includes('تعذّر التحقق من عدم تكرار رقم البوليصة. لم يتم الحفظ'));
      assert.ok(appHtml.includes('فتح العملية'));
      assert.ok(appHtml.includes('function shipmentAuditUserName(userId)'));
      assert.ok(appHtml.includes('أنشأ العملية'));
      assert.ok(appHtml.includes('تاريخ الإنشاء'));
      assert.ok(appHtml.includes('آخر تحديث'));
      assert.ok(appHtml.includes('ما حدث في العملية'));
      assert.ok(appHtml.includes("if(!isBsgtAudit) query = query.in('kind', ['submit','approve','return'])"));
      assert.ok(appHtml.includes("const note = isBsgtAudit ? [`بواسطة: ${actor}`, c.body]"));
      assert.ok(appHtml.includes("const preservedId = v === 'clientProfiles' && activeRoute.v === 'clientProfiles' ? activeRoute.id : null;"));
      assert.ok(appHtml.includes("updateHash(navKey === 'bsgt' ? 'bsgt' : v, preservedId, workspaceSection, options?.history)"));
      assert.ok(appHtml.includes('onclick="openBsgtShipForm(null)"'));
    });
    await check('import-permit proforma portal is standalone and Baldna-restricted', async () => {
      const permitSource = fs.readFileSync(path.join(__dirname, '..', 'import-permit.js'), 'utf8');
      const permitCss = fs.readFileSync(path.join(__dirname, '..', 'import-permit.css'), 'utf8');
      const catalogSource = fs.readFileSync(path.join(__dirname, '..', 'baldna-commodities.js'), 'utf8');
      const translationSource = fs.readFileSync(path.join(__dirname, '..', 'baldna-commodity-translations.js'), 'utf8');
      const catalogJson = catalogSource.slice(catalogSource.indexOf('Object.freeze(') + 'Object.freeze('.length, catalogSource.lastIndexOf(');'));
      const catalog = JSON.parse(catalogJson);
      const translationJson = translationSource.slice(translationSource.indexOf('Object.freeze(') + 'Object.freeze('.length, translationSource.lastIndexOf(');'));
      const translations = JSON.parse(translationJson);
      assert.strictEqual(catalog.length, 429);
      assert.strictEqual(Object.keys(translations).length, 429);
      assert.ok(catalog.every(item => translations[item.id] && !/[\u0600-\u06ff]/.test(translations[item.id])));
      assert.ok(catalog.every(item => item.id && item.category && item.name && /^\d{6,10}$/.test(item.hsCode) && item.unit));
      assert.deepStrictEqual([...new Set(catalog.map(item => item.unit))].sort(), ['DZN','GRM','KGM','MTK','MTQ','PCE']);
      assert.ok(appHtml.includes('id="bsgtImportPermitBtn"'));
      assert.ok(appHtml.includes('id="importPermitOverlay"'));
      assert.ok(appHtml.includes('id="importPermitRecordsOverlay"'));
      assert.ok(appHtml.includes('id="importPermitArchiveOverlay"'));
      assert.ok(appHtml.includes('id="permitAedToggle"'));
      assert.ok(appHtml.includes('id="permit_aedRate" value="3.67"'));
      assert.ok(appHtml.includes('id="importPermitFilterClient"'));
      assert.ok(appHtml.includes('id="importPermitFilterSearch"'));
      assert.ok(appHtml.includes('id="importPermitFilterFrom"'));
      assert.ok(appHtml.includes('id="importPermitFilterSort"'));
      assert.ok(appHtml.includes('id="importPermitRouteLoader"'));
      assert.ok(appHtml.includes('id="importPermitPagination"'));
      assert.ok(appHtml.includes('id="importPermitPageSize"'));
      assert.ok(appHtml.includes('data-import-permit-tab="new"'));
      assert.ok(appHtml.includes('data-import-permit-tab="history"'));
      assert.ok(appHtml.includes('import-permit.css?v=20260911-enterprise-1'));
      assert.ok(appHtml.includes('class="import-permit-stepper"'));
      assert.ok(appHtml.includes('aria-label="أقسام فاتورة إذن الاستيراد"'));
      assert.ok(appHtml.includes('بوابة معتمدة داخل BSGT'));
      for (const id of [
        'permit_proformaNo', 'permit_proformaDate', 'permit_consignee', 'permit_consigneeAddress',
        'permit_portDischarge', 'permit_countryOrigin', 'importPermitItems', 'permit_currency',
        'permitAedToggle', 'permit_aedRate', 'permit_incoterm', 'permit_paymentTerm', 'permit_bankPick',
        'permit_weight', 'importPermitResetBtn', 'importPermitSaveBtn', 'importPermitPrintBtn'
      ]) assert.ok(appHtml.includes(`id="${id}"`), `missing preserved import-permit control: ${id}`);
      assert.ok(permitCss.includes('--permit-primary: var(--brand-primary, #EA1B23)'));
      assert.ok(permitCss.includes('--permit-primary-hover: var(--brand-dark, #D01119)'));
      assert.ok(permitCss.includes('#importPermitOverlay .import-permit-shell'));
      assert.ok(permitCss.includes('grid-template-rows: auto auto minmax(0, 1fr) auto'));
      assert.ok(permitCss.includes('.import-permit-current-ref'));
      assert.ok(permitCss.includes('background: #fff7f7'));
      assert.ok(permitCss.includes('.import-permit-actions'));
      assert.ok(permitCss.includes('@media (max-width: 560px)'));
      assert.ok(appHtml.includes("window.dispatchEvent(new CustomEvent('jahez:session-ready'))"));
      assert.ok(appHtml.includes('فاتورة مبدئية فقط، لا تنشئ شحنة ولا قيداً محاسبياً'));
      assert.ok(appHtml.includes('سجل فواتير إذن الاستيراد'));
      assert.ok(appHtml.includes('تحفظ بمرجع مستقل ولا تدخل ضمن الشحنات أو الحسابات'));
      assert.ok(appHtml.includes("const amountCurrency = String(r.permitInvoiceCurrency || 'AED').toUpperCase()"));
      assert.ok(appHtml.includes("record[firstItemKey('Unit')] || record.qtyUnit"));
      assert.ok(permitSource.includes('chooseDocLang(record, lang =>'));
      assert.ok(permitSource.includes("buildSheet(portalRecord(lang), 'proforma', lang)"));
      assert.ok(permitSource.includes("item.descriptionEn || commodity?.nameEn || item.description"));
      assert.ok(permitSource.includes('descriptionEn: commodity?.nameEn'));
      assert.ok(companyWizard.includes("packaging: record.itemUnit || record.qtyUnit || ''"));
      assert.ok(appHtml.includes('id="bsgt_unitPriceToggle"'));
      assert.ok(appHtml.includes('bsgtShowFinalUnitPrice: bsgtShowFinalUnitPrice'));
      assert.ok(companyWizard.includes('proforma || record.bsgtShowFinalUnitPrice !== false'));
      assert.ok(appHtml.includes('isProforma || r.bsgtShowFinalUnitPrice !== false'));
      assert.ok(appHtml.includes('if(r.permitInvoice) return;'));
      assert.ok(permitSource.includes('permitInvoiceCurrency: currency'));
      assert.ok(permitSource.includes("const shouldConvert = data.convertToAed === true && sourceCurrency !== 'AED'"));
      assert.ok(permitSource.includes('amount: amount * rate'));
      assert.ok(permitSource.includes("method:'PATCH'"));
      assert.ok(permitSource.includes('data-record-archive'));
      assert.ok(permitSource.includes('data-record-restore'));
      assert.ok(permitSource.includes('data-record-preview'));
      assert.ok(permitSource.includes('data-record-print'));
      assert.ok(permitSource.includes("url.searchParams.set('portal', 'import-permit-records')"));
      assert.ok(permitSource.includes("url.searchParams.set('permitView', 'history')"));
      assert.ok(permitSource.includes("window.open(url.href, 'jahezImportPermitRecords')"));
      assert.ok(permitSource.includes("window.addEventListener('jahez:access-ready', scheduleStandaloneRegister, {once:true})"));
      assert.ok(permitSource.includes('setTimeout(()=>openStandaloneRegister()'));
      assert.ok(permitSource.includes('if(window.JahezAccess) await window.JahezAccess.ready()'));
      assert.ok(permitSource.includes('pageSize:String(recordPageSize)'));
      assert.ok(permitSource.includes('queueRecordLoad(380)'));
      assert.ok(permitSource.includes("byId('importPermitRouteLoader')?.classList.add('hidden')"));
      assert.ok(permitSource.includes("chooseDocLang({...record.data, permitInvoice:true}"));
      assert.ok(permitSource.includes("portalApi('/api/import-permit-invoices'"));
      assert.ok(permitSource.includes('saveCurrentRecord'));
      assert.ok(permitSource.includes("byId('importPermitResetBtn').addEventListener('click', resetPortal)"));
      assert.ok(permitSource.includes("byId('importPermitSaveBtn').addEventListener('click', saveCurrentRecord)"));
      assert.ok(permitSource.includes("byId('importPermitPrintBtn').addEventListener('click', async () =>"));
      assert.ok(permitSource.includes('document.documentElement.appendChild(overlay)'));
      assert.ok(!permitSource.includes('dbSaveRecord'));
      assert.ok(!permitSource.includes("from('shipments')"));
      assert.ok(!permitSource.includes('ledger'));
      assert.ok(!permitSource.includes('localStorage'));
    });
    await check('import-permit history API paginates and filters without changing records', async () => {
      const api = require(path.join(__dirname, '..', 'api', 'import-permit-invoices.js'));
      const records = Array.from({length: 26}, (_, index) => ({
        id:`invoice-${index + 1}`,
        reference:`BSGT-IP-2026-${String(index + 1).padStart(4, '0')}`,
        ownerId:index === 25 ? 'other-user' : 'user-1',
        ownerName:'Test User',
        createdAt:`2026-09-${String((index % 9) + 1).padStart(2, '0')}T08:00:00.000Z`,
        updatedAt:`2026-09-${String((index % 9) + 1).padStart(2, '0')}T09:00:00.000Z`,
        data:{
          proformaNo:`PI-${index + 1}`,
          proformaDate:`2026-09-${String((index % 9) + 1).padStart(2, '0')}`,
          consignee:index % 2 ? 'Client B' : 'Client A',
          currency:index % 2 ? 'USD' : 'AED',
          items:[{description:index === 7 ? 'Needle special' : 'General goods', descriptionEn:'Goods', hsCode:`63039${index}`}]
        }
      }));
      const original = JSON.stringify(records);
      const firstPage = api.listInvoicesForTest(records, {id:'user-1', role:'editor'}, {page:'1', pageSize:'10'});
      assert.strictEqual(firstPage.records.length, 10);
      assert.strictEqual(firstPage.pagination.total, 25);
      assert.strictEqual(firstPage.pagination.totalPages, 3);
      assert.strictEqual(firstPage.pagination.from, 1);
      assert.strictEqual(firstPage.pagination.to, 10);
      const filtered = api.listInvoicesForTest(records, {id:'user-1', role:'editor'}, {search:'Needle', currency:'USD', page:'1', pageSize:'25'});
      assert.strictEqual(filtered.records.length, 1);
      assert.strictEqual(filtered.records[0].id, 'invoice-8');
      assert.deepStrictEqual(filtered.filters.clients, ['Client A', 'Client B']);
      assert.strictEqual(JSON.stringify(records), original, 'history queries must not mutate stored records');
    });
    await check('static assets served with correct MIME', async () => {
      for (const [file, type] of [['wizard.js', 'text/javascript'], ['wizard.css', 'text/css'], ['jahez-glass.css', 'text/css'], ['landing.css', 'text/css'], ['shipment-list.js', 'text/javascript'], ['shipment-list.css', 'text/css'], ['import-permit.js', 'text/javascript'], ['baldna-commodities.js', 'text/javascript'], ['baldna-commodity-translations.js', 'text/javascript'], ['import-permit.css', 'text/css'], ['dashboard-team.png', 'image/png'], ['dubai-certificate-template.pdf', 'application/pdf'], ['public-shipment.html', 'text/html']]) {
        const r = await fetch(`${BASE}/${file}`);
        assert.strictEqual(r.status, 200, file);
        assert.match(r.headers.get('content-type'), new RegExp(type), file);
        if (file === 'shipment-list.css') shipmentListCss = await r.text();
        if (file === 'shipment-list.js') shipmentListJs = await r.text();
      }
    });
    await check('shipment list glass UI is isolated and server-paginated', async () => {
      assert.ok(appHtml.includes('shipment-list.css?v=20260911-workflow-4'));
      assert.ok(appHtml.includes('shipment-list.js?v=20260911-workflow-4'));
      assert.ok(shipmentListCss.includes('sp-view-table :is(#listBody, #seaBody, #issuedBody, #draftsBody)'));
      assert.ok(shipmentListCss.includes('backdrop-filter: none'));
      assert.ok(shipmentListCss.includes('#viewRecords.shipment-glass-page'));
      assert.ok(shipmentListCss.includes('grid-template-columns: repeat(4, minmax(0, 1fr))'));
      assert.ok(shipmentListCss.includes('padding-right: 194px'));
      assert.ok(shipmentListCss.includes('.shipment-collection-status.collected'));
      assert.ok(shipmentListCss.includes('.shipment-table-identifiers'));
      assert.ok(shipmentListCss.includes('.shipment-workflow-progress'));
      assert.ok(shipmentListCss.includes('.shipment-table-workflow'));
      assert.ok(shipmentListCss.includes('.shipment-workflow-progress.is-full .shipment-workflow-steps'));
      assert.ok(shipmentListCss.includes('@media (max-width: 1160px)'));
      assert.ok(shipmentListCss.includes('@media (max-width: 600px)'));
      assert.ok(shipmentListJs.includes("const STORAGE_KEY = 'jahezShipmentListView'"));
      assert.ok(shipmentListJs.includes("select(ROW_SELECT, {count:'exact'})"));
      for (const field of ['workflow_stage','workflow_updated_at','bank_sent_at','signed_at','accepted_at','accepted_by']) {
        assert.ok(shipmentListJs.includes(field), `${field} must be fetched with the shipment page`);
      }
      assert.ok(shipmentListJs.includes('.range(from, to)'));
      assert.ok(shipmentListJs.includes('id="shipmentWorkflowFilter"'));
      assert.ok(shipmentListJs.includes("query.eq('workflow_stage', filters.workflowStage)"));
      assert.ok(shipmentListJs.includes("query.eq('status', filters.status)"));
      assert.ok(shipmentListJs.includes('ui.workflow.hidden = !isBsgt'));
      assert.ok(shipmentListJs.includes("scopeKey() === 'bsgt' ? renderShipmentWorkflowProgress"));
      assert.ok(shipmentListJs.includes("scopeKey() === 'bsgt' ? renderShipmentWorkflowBadge"));
      assert.ok(!shipmentListJs.includes("from('shipment_files')"));
      assert.ok(shipmentListJs.includes('scheduleQuery(380)'));
      assert.ok(shipmentListJs.includes('<option value="100">100</option>'));
      assert.ok(shipmentListJs.includes("state.viewMode === 'table'"));
      assert.ok(shipmentListJs.includes('shipment-empty-state'));
      assert.ok(shipmentListJs.includes('shipment-portal-slot'));
      assert.ok(shipmentListJs.includes("['bsgtImportPermitBtn', 'bsgtCollectionLabBtn']"));
      assert.ok(shipmentListJs.includes('record.invoiceNo || record.proformaNo'));
      assert.ok(shipmentListJs.includes('record.billNo'));
      assert.ok(shipmentListJs.includes('فاتورة: <b>'));
      assert.ok(shipmentListJs.includes('بوليصة: <b>'));
      assert.ok(shipmentListJs.includes("typeof bsgtCollectionStatus !== 'function'"));
      assert.ok(shipmentListJs.includes('shipment-error-state'));
      assert.ok(shipmentListJs.includes('shipment-skeleton-grid'));
      assert.ok(!/\.from\('shipments'\)\.(insert|update|delete|upsert)/.test(shipmentListJs));
      const storageKeys = [...shipmentListJs.matchAll(/localStorage\.(?:getItem|setItem)\(([^,)]+)/g)].map(match => match[1].trim());
      assert.deepStrictEqual([...new Set(storageKeys)], ['STORAGE_KEY']);
      assert.ok(appHtml.includes('function renderShipmentWorkflowProgress(record, options = {})'));
      assert.ok(appHtml.includes('function renderShipmentWorkflowBadge(record, options = {})'));
      assert.ok(appHtml.includes('id="bsgtWorkflow"'));
      assert.ok(appHtml.includes('record?.bankSentAt'));
      assert.ok(appHtml.includes('record?.signedAt'));
      assert.ok(appHtml.includes('record?.acceptedAt'));
      assert.ok(appHtml.includes('shipmentAuditUserName(record?.acceptedBy)'));
      assert.ok(appHtml.includes('const mergeAccess = bsgtPackageMergeAccess(r, shipmentFilesCache[r.id] || [])'));
      assert.ok(appHtml.includes('async function ensureBsgtPackageMergeAllowed'));
    });
    await check('Jahez Glass skin is isolated from generated documents', async () => {
      assert.ok(appHtml.includes('jahez-glass.css?v=20260908-glass-4'));
      const glass = await (await fetch(`${BASE}/jahez-glass.css`)).text();
      assert.ok(glass.includes('--glass-bg-strong'));
      assert.ok(glass.includes('.app-sidebar'));
      assert.ok(glass.includes('.lab-header'));
      assert.ok(glass.includes('@media print'));
      const navbarRule = glass.match(/\.o-navbar\s*\{([^}]*)\}/);
      assert.ok(navbarRule);
      assert.ok(!navbarRule[1].includes('backdrop-filter'));
      assert.ok(glass.includes('#lockScreen {'));
      assert.ok(!glass.includes('.lock-form-panel { background: rgba'));
      assert.match(glass, /\.o-control-panel\s*\{[^}]*z-index:\s*2/);
      assert.ok(!glass.includes('.doc-sheet'));
      assert.ok(!glass.includes('.bahar-contract'));
      assert.ok(!glass.includes('.bahar-inv'));
      const collectionHtml = await (await fetch(`${BASE}/experiments/bs-collection/`)).text();
      assert.ok(collectionHtml.includes('../../jahez-glass.css?v=20260908-glass-4'));
      assert.ok(collectionHtml.includes('collection-enterprise.css?v=20260912-2'));
      assert.ok(collectionHtml.includes('role-collection-preview-only collection-enterprise-ui'));
      assert.strictEqual((collectionHtml.match(/href="\/#v=dashboard"/g) || []).length, 2);
      assert.ok(collectionHtml.includes('id="documentEditorShell"'));
      assert.ok(collectionHtml.includes('id="saveDocumentLayoutBtn"'));
      assert.strictEqual((collectionHtml.match(/data-preview="(?:letter|undertaking|exchange)"/g) || []).length, 3);
      assert.strictEqual((collectionHtml.match(/data-step-section="(?:picker-section|draft-section|settings-section|preview-section|collection-portal-section)"/g) || []).length, 5);
      const collectionUiCss = await (await fetch(`${BASE}/experiments/bs-collection/collection-enterprise.css`)).text();
      assert.ok(collectionUiCss.includes('body.collection-enterprise-ui'));
      assert.ok(collectionUiCss.includes('width: min(1550px, calc(100% - 48px))'));
      assert.ok(collectionUiCss.includes('grid-template-columns: repeat(5, minmax(0, 1fr))'));
      assert.ok(collectionUiCss.includes('grid-template-columns: minmax(420px, 1fr) 230px 250px'));
      assert.ok(collectionUiCss.includes('border: 1.5px solid #ea1b23'));
      assert.ok(collectionUiCss.includes('overflow-x: hidden'));
      const collectionJs = await (await fetch(`${BASE}/experiments/bs-collection/collection-lab.js`)).text();
      assert.ok(collectionJs.includes("const collectionDocumentEditorMetaStorageKey = 'bsCollectionDocumentEditorMetaV1'"));
      assert.ok(collectionJs.includes('function saveCurrentDocumentLayout()'));
      assert.ok(collectionJs.includes("paper.classList.toggle('has-layout-overflow',overflow)"));
      assert.ok(!collectionJs.includes('offset.y+correction'));
      assert.ok(collectionJs.includes('window.JahezSessionNavigation.navigateBackToJahez({fallback:'));
      assert.ok(!collectionJs.includes('window.history.back()'));
      assert.ok(collectionJs.includes('class="undertaking-refs"'));
      assert.ok(collectionJs.includes('data-text-style-id="undertaking-ref-label"'));
      assert.ok(collectionJs.includes('undertaking-invoice-${index}'));
      assert.ok(collectionJs.includes('undertaking-bill-${index}'));
      assert.ok(collectionJs.includes('undertaking-currency-${index}'));
      assert.ok(collectionJs.includes('undertaking-amount-${index}'));
      assert.ok(collectionJs.includes('<table class="boe-meta">'));
      assert.ok(collectionJs.includes('data-text-style-id="boe-amount-label"'));
      assert.ok(collectionJs.includes('data-text-style-id="boe-amount-value"'));
      assert.ok(collectionJs.includes('<table class="boe-invoices"'));
      assert.ok(collectionHtml.includes('بوابة التحصيل التجاري - بحر سواكن'));
      assert.ok(collectionJs.includes('function createCollectionOperationNo('));
      assert.ok(collectionJs.includes('commercialCollectionOperations'));
      assert.ok(collectionJs.includes('qrIncluded:false'));
      assert.ok(collectionJs.includes('function restoreRequestedCollectionOperation()'));
      const collectionListsCss = await (await fetch(`${BASE}/experiments/bs-collection/collection-lists.css`)).text();
      assert.ok(collectionListsCss.includes('.document-editor-shell'));
      assert.ok(collectionListsCss.includes('.preview-section.is-preview-focus'));
      assert.match(collectionListsCss, /\.undertaking-refs\s*:is\(th,td\)[^{]*\{[^}]*border:\s*0\s*!important/);
      assert.match(collectionListsCss, /\.boe-meta td\s*\{[^}]*border:\s*\.25mm solid #000\s*!important/);
      assert.ok(collectionListsCss.includes('.boe-meta-box { display: flex; align-items: center; justify-content: space-between;'));
      assert.match(collectionListsCss, /\.boe-invoices\s*:is\(th,td\)[^{]*\{[^}]*border:\s*0\s*!important/);
    });
    await check('login requires explicit submit while internal portal routes preserve session restore', async () => {
      assert.ok(appHtml.includes('let loginSubmitIntent = false;'));
      assert.ok(appHtml.includes("loginError('اضغط زر تسجيل الدخول للمتابعة.');"));
      assert.ok(!appHtml.includes('if(isPublicLandingRequest()){\n    showLanding();\n    return;\n  }'));
      assert.ok(appHtml.indexOf('await getRestorableSession()') < appHtml.lastIndexOf('if(isPublicLandingRequest()) showLanding();'));
      assert.ok(appHtml.includes("const AUTH_RETURN_PATH_KEY = 'jahez:auth-return-path';"));
      assert.ok(appHtml.includes('const status = await afterSignIn(data.user);'));
      assert.ok(appHtml.includes("if(status === 'ok') restoreAuthenticatedLocation();"));
      assert.ok(appHtml.includes('const {session, error:sessionError, status:sessionStatus} = await getRestorableSession();'));
      assert.ok(appHtml.includes("if(status === 'ok'){\n        restoreAuthenticatedLocation();"));
      assert.ok(appHtml.includes('rememberAuthReturnPath();\n    await initLock();'));
      assert.ok(!appHtml.includes("else await initLock();\n  switchShipTab('land');\n  switchView(isStaffRole() ? 'tasks' : 'dashboard');"));
      const collectionSessionSource = await (await fetch(`${BASE}/experiments/bs-collection/collection-lab.js`)).text();
      assert.ok(collectionSessionSource.includes('const auth=await restorePortalSession();'));
      assert.ok(collectionSessionSource.includes("if(auth.status==='network_error'){ showPortalSessionRecovery(auth.error); return; }"));
      assert.ok(collectionSessionSource.includes("if(auth.status!=='authenticated' || !auth.session){ redirectPortalToLogin(); return; }"));
      assert.ok(collectionSessionSource.includes("window.location.replace('/?login=1')"));
      assert.ok(collectionSessionSource.includes('sessionStorage.setItem(AUTH_RETURN_PATH_KEY, location.pathname + location.search + location.hash)'));
      assert.ok(appHtml.includes('>بوابة التحصيل التجاري</button>'));
      assert.ok(appHtml.includes('function renderCommercialCollectionHistory(r)'));
      assert.ok(appHtml.includes('/experiments/bs-collection/?shipment='));
      assert.ok(appHtml.includes('مستبعدة من QR'));
      assert.ok(appHtml.includes("const sequence = ['contract','importPermit', ...ordered.filter(kind=>kind!=='contract')];"));
      assert.ok(!appHtml.includes("generatedKinds = new Set(['contract','proforma','invoice','packing','letter','undertaking','exchange'])"));
    });
    await check('server files and SQL are not exposed', async () => {
      for (const p of ['/server.js', '/package.json', '/.env', '/.git/config', '/supabase/1.sql', '/api/microsoft.js', '/../etc/passwd', '/%2e%2e/etc/passwd']) {
        const r = await fetch(`${BASE}${p}`);
        assert.ok(r.status === 404 || r.status === 400, `${p} -> ${r.status}`);
      }
    });
    await check('public-shipment without id returns 400 page', async () => {
      const r = await fetch(`${BASE}/api/public-shipment`);
      assert.strictEqual(r.status, 400);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.match(await r.text(), /رابط الشحنة غير مكتمل/);
    });
    await check('microsoft status without server settings answers JSON', async () => {
      const r = await fetch(`${BASE}/api/microsoft`);
      const j = await r.json();
      assert.strictEqual(j.connected, false);
      assert.strictEqual(j.connectUrl, '/api/microsoft?action=connect');
    });
    await check('/s/<token> QR route shows the branded loader before the existing PDF endpoint', async () => {
      const dockerfile = await fs.promises.readFile(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
      assert.match(dockerfile, /COPY index\.html public-shipment\.html qr-splash\.html/);
      const bad = await fetch(`${BASE}/s/short`);
      assert.strictEqual(bad.status, 404);
      const splash = await fetch(`${BASE}/s/abcdefghijklmnopqrstuvwx`);
      assert.strictEqual(splash.status, 200);
      assert.match(splash.headers.get('content-type'), /text\/html/);
      const splashHtml = await splash.text();
      assert.match(splashHtml, /جاري تجهيز الملفات/);
      assert.match(splashHtml, /bsqt-qr-logo\.png/);
      assert.match(splashHtml, /\/api\/qr-package\?token=/);
      const pdf = await fetch(`${BASE}/api/qr-package?token=abcdefghijklmnopqrstuvwx`);
      assert.strictEqual(pdf.status, 503);
      assert.match(pdf.headers.get('content-type'), /text\/html/);
      assert.match(await pdf.text(), /SUPABASE_SERVICE_ROLE_KEY/);
      assert.strictEqual((await fetch(`${BASE}/s/`)).status, 404);
    });
    await check('unknown api route is 404', async () => {
      assert.strictEqual((await fetch(`${BASE}/api/nope`)).status, 404);
    });
    await check('import-permit record API requires an authenticated session', async () => {
      const read = await fetch(`${BASE}/api/import-permit-invoices`);
      assert.strictEqual(read.status, 401);
      const save = await fetch(`${BASE}/api/import-permit-invoices`, {
        method: 'POST', headers: {'content-type':'application/json'}, body: '{}'
      });
      assert.strictEqual(save.status, 401);
    });
    await check('import-permit records persist with independent sequential references', async () => {
      const dataDir = path.join(__dirname, 'output', 'permit-api-store');
      fs.rmSync(dataDir, {recursive:true, force:true});
      const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const previousDir = process.env.JAHEZ_DATA_DIR;
      const originalFetch = global.fetch;
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
      process.env.JAHEZ_DATA_DIR = dataDir;
      const modulePath = require.resolve('../api/import-permit-invoices');
      delete require.cache[modulePath];
      global.fetch = async url => {
        if(String(url).includes('/auth/v1/user')) return new Response(JSON.stringify({id:'user-1'}), {status:200});
        if(String(url).includes('/rest/v1/profiles')) return new Response(JSON.stringify([{id:'user-1',email:'editor@example.test',display_name:'Editor',role:'editor',active:true}]), {status:200});
        if(String(url).includes('/rest/v1/user_portal_permissions')) return new Response(JSON.stringify([{portal_key:'import_permit',can_view:true}]), {status:200});
        throw new Error(`unexpected fetch ${url}`);
      };
      const call = async (method, body, query = {}) => {
        const req = {method, headers:{authorization:'Bearer user-token'}, body, query};
        const res = {
          statusCode:200, headers:{}, setHeader(k,v){this.headers[k]=v;},
          status(code){this.statusCode=code;return this;}, json(value){this.body=value;return this;}
        };
        await require('../api/import-permit-invoices')(req, res);
        return res;
      };
      const data = {
        proformaNo:'PI-001', proformaDate:'2026-09-08', consignee:'Buyer', consigneeAddress:'Address',
        portDischarge:'Port Sudan', countryOrigin:'China', currency:'USD', convertToAed:true, aedRate:3.67, incoterm:'CFR',
        paymentTerm:'D/A 90 DAYS', bankId:'bank-1', weight:'100 KG',
        items:[{commodityId:'10',description:'سلعة',descriptionEn:'GOODS',category:'CATEGORY',hsCode:'630392',unit:'PCE',quantity:5,amount:100}]
      };
      try {
        const first = await call('POST', {data});
        const second = await call('POST', {data:{...data, proformaNo:'PI-002'}});
        assert.strictEqual(first.statusCode, 200);
        assert.strictEqual(first.body.record.reference, `BSGT-IP-${new Date().getFullYear()}-0001`);
        assert.strictEqual(first.body.record.data.items[0].descriptionEn, 'GOODS');
        assert.strictEqual(first.body.record.data.convertToAed, true);
        assert.strictEqual(first.body.record.data.aedRate, 3.67);
        assert.strictEqual(second.body.record.reference, `BSGT-IP-${new Date().getFullYear()}-0002`);
        const updated = await call('POST', {id:first.body.record.id, data:{...data, proformaNo:'PI-001-A'}});
        assert.strictEqual(updated.body.record.reference, first.body.record.reference);
        const archived = await call('PATCH', {id:first.body.record.id, archived:true});
        assert.strictEqual(archived.statusCode, 200);
        assert.ok(archived.body.record.archivedAt);
        const activeList = await call('GET');
        assert.strictEqual(activeList.body.records.length, 1);
        assert.strictEqual(activeList.body.records[0].id, second.body.record.id);
        const archiveList = await call('GET', undefined, {status:'archived'});
        assert.strictEqual(archiveList.body.records.length, 1);
        assert.strictEqual(archiveList.body.records[0].id, first.body.record.id);
        const blockedUpdate = await call('POST', {id:first.body.record.id, data:{...data, proformaNo:'BLOCKED'}});
        assert.strictEqual(blockedUpdate.statusCode, 409);
        const restored = await call('PATCH', {id:first.body.record.id, archived:false});
        assert.strictEqual(restored.statusCode, 200);
        assert.strictEqual(restored.body.record.archivedAt, null);
        const restoredList = await call('GET');
        assert.strictEqual(restoredList.body.records.length, 2);
        assert.strictEqual(restoredList.body.records.find(record => record.id===first.body.record.id).data.proformaNo, 'PI-001-A');
        const emptyArchive = await call('GET', undefined, {status:'archived'});
        assert.strictEqual(emptyArchive.body.records.length, 0);
      } finally {
        global.fetch = originalFetch;
        if(previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
        if(previousDir === undefined) delete process.env.JAHEZ_DATA_DIR; else process.env.JAHEZ_DATA_DIR = previousDir;
        delete require.cache[modulePath];
        fs.rmSync(dataDir, {recursive:true, force:true});
      }
    });
    await check('render-bsgt-pdf rejects GET and empty body', async () => {
      assert.strictEqual((await fetch(`${BASE}/api/render-bsgt-pdf`)).status, 405);
      const r = await fetch(`${BASE}/api/render-bsgt-pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.strictEqual(r.status, 400);
    });
    await check('render-bsgt-pdf renders a real A4 PDF with local Chromium', async () => {
      const html = '<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>@page{size:A4;margin:0}body{font-family:sans-serif;margin:20mm}</style></head><body><h1>فاتورة اختبار — بحر سواكن</h1><p>Invoice 001</p></body></html>';
      const r = await fetch(`${BASE}/api/render-bsgt-pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html }) });
      const buf = Buffer.from(await r.arrayBuffer());
      assert.strictEqual(r.status, 200, buf.toString('utf8').slice(0, 300));
      assert.strictEqual(r.headers.get('content-type'), 'application/pdf');
      assert.strictEqual(buf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(buf.length > 1000, 'pdf should not be empty');
      fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, 'output', 'smoke.pdf'), buf);
    });
    console.log(`\n${results.length} checks passed`);
  } finally {
    proc.kill('SIGTERM');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
