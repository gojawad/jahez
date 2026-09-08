(function shipmentListWorkspace(){
  'use strict';

  const view = document.getElementById('viewRecords');
  if(!view || typeof sb === 'undefined') return;

  const ROW_SELECT = 'id,status,owner_id,company_id,review_note,due_date,credit_days,due_from,task_ref,bol_template_id,created_at,updated_at,data';
  const STORAGE_KEY = 'jahezShipmentListView';
  const state = {
    viewMode: readViewPreference(),
    pageSize: 10,
    pages: Object.create(null),
    total: 0,
    rows: [],
    loading: false,
    error: null,
    requestId: 0,
    timer: null,
    scope: '',
    statsScope: '',
    statsLoadedAt: 0,
    clientFallback: false
  };

  let ui = null;
  let legacyRender = render;
  let legacyRenderSea = renderSea;
  let legacyRenderIssued = renderIssued;
  let legacyRenderDrafts = renderDrafts;

  function readViewPreference(){
    try{ return localStorage.getItem(STORAGE_KEY) === 'table' ? 'table' : 'cards'; }
    catch(_){ return 'cards'; }
  }

  function writeViewPreference(value){
    try{ localStorage.setItem(STORAGE_KEY, value); }catch(_){}
  }

  function buildWorkspace(){
    if(view.classList.contains('shipment-glass-ready')) return;
    view.classList.add('shipment-glass-page', 'shipment-glass-ready');

    view.insertAdjacentHTML('afterbegin', `
      <section class="shipment-page-hero" aria-labelledby="shipmentPageTitle">
        <div class="shipment-page-heading">
          <span class="shipment-page-heading-icon">${icon('ship', 31)}</span>
          <div>
            <h1 id="shipmentPageTitle">الشحنات الصادرة</h1>
            <p id="shipmentPageSubtitle">إدارة ومتابعة جميع الشحنات الصادرة من النظام</p>
          </div>
        </div>
        <div class="shipment-stat-grid" aria-label="إحصائيات الشحنات">
          <article class="shipment-stat">
            <span class="shipment-stat-icon">${icon('box', 21)}</span>
            <div><b id="shipmentStatTotal">0</b><small>إجمالي الشحنات</small></div>
          </article>
          <article class="shipment-stat success">
            <span class="shipment-stat-icon">${icon('arrowUp', 21)}</span>
            <div><b id="shipmentStatSent">0</b><small>تم الإرسال</small></div>
          </article>
          <article class="shipment-stat warning">
            <span class="shipment-stat-icon">${icon('history', 21)}</span>
            <div><b id="shipmentStatReview">0</b><small>قيد المراجعة</small></div>
          </article>
          <article class="shipment-stat draft">
            <span class="shipment-stat-icon">${icon('doc', 21)}</span>
            <div><b id="shipmentStatDraft">0</b><small>مسودة</small></div>
          </article>
        </div>
      </section>
      <section class="shipment-tools" aria-label="أدوات البحث والتصفية">
        <div class="shipment-filter-row">
          <button class="shipment-create-button" id="shipmentCreateButton" type="button">${icon('plus', 19)}<span class="shipment-create-label">إنشاء شحنة جديدة</span></button>
          <select class="shipment-filter-control" id="shipmentDatePreset" aria-label="التاريخ">
            <option value="all">كل التواريخ</option>
            <option value="today">اليوم</option>
            <option value="7days">آخر 7 أيام</option>
            <option value="30days">آخر 30 يوماً</option>
            <option value="year">هذا العام</option>
          </select>
          <select class="shipment-filter-control" id="shipmentStatusFilter" aria-label="الحالة">
            <option value="">كل الحالات</option>
            <option value="sent">صادرة</option>
            <option value="review">بانتظار الاعتماد</option>
            <option value="rework">معادة للتعديل</option>
            <option value="draft">مسودة</option>
          </select>
          <select class="shipment-filter-control" id="shipmentClientFilter" aria-label="العميل">
            <option value="">كل العملاء</option>
          </select>
          <label class="shipment-search-control">${icon('search', 19)}<input id="shipmentPageSearch" type="search" autocomplete="off" placeholder="ابحث برقم الشحنة، العملية، العميل أو الصنف..."></label>
        </div>
        <div class="shipment-control-row">
          <div class="shipment-tab-slot"></div>
          <div class="shipment-advanced-slot"></div>
          <div class="shipment-portal-slot" aria-label="بوابات BSGT"></div>
          <div class="shipment-view-switch" role="group" aria-label="طريقة العرض">
            <button class="shipment-view-button" id="shipmentCardsView" type="button">${icon('dashboard', 16)} بطاقات</button>
            <button class="shipment-view-button" id="shipmentTableView" type="button">${icon('list', 16)} جدول</button>
          </div>
          <label class="shipment-sort-group"><span>ترتيب حسب</span><select class="shipment-compact-select" id="shipmentSort"><option value="newest">الأحدث أولاً</option><option value="oldest">الأقدم أولاً</option></select></label>
          <label class="shipment-sort-group"><span>عرض</span><select class="shipment-compact-select" id="shipmentPageSize"><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
        </div>
      </section>
    `);

    const tabs = view.querySelector('.ship-tabs');
    const tabSlot = view.querySelector('.shipment-tab-slot');
    if(tabs && tabSlot) tabSlot.appendChild(tabs);

    const advanced = view.querySelector('.filter-bar');
    const advancedSlot = view.querySelector('.shipment-advanced-slot');
    if(advanced && advancedSlot){
      advanced.classList.add('shipment-advanced-filter');
      const advancedButton = advanced.querySelector('#fbToggle');
      if(advancedButton) advancedButton.childNodes.forEach(node=>{
        if(node.nodeType === Node.TEXT_NODE && node.textContent.trim()) node.textContent = 'فلاتر إضافية ';
      });
      advancedSlot.appendChild(advanced);
    }

    const portalSlot = view.querySelector('.shipment-portal-slot');
    if(portalSlot){
      ['bsgtImportPermitBtn', 'bsgtCollectionLabBtn'].forEach(id=>{
        const button = document.getElementById(id);
        if(button) portalSlot.appendChild(button);
      });
    }

    const firstPane = document.getElementById('shipPaneLand');
    if(firstPane){
      firstPane.insertAdjacentHTML('beforebegin', `
        <div class="shipment-results-head">
          <span id="shipmentResultSummary">جاري تجهيز الشحنات...</span>
          <span class="shipment-query-mode">${icon('bolt', 11)} <span id="shipmentQueryMode">ترقيم خادمي</span></span>
        </div>
        <div class="shipment-data-state shipment-loading-state" id="shipmentLoadingState" hidden aria-live="polite">
          <div class="shipment-skeleton-grid">${skeletonCards()}</div>
        </div>
        <div class="shipment-data-state shipment-error-state" id="shipmentErrorState" hidden role="alert">
          <b>تعذر تحميل الشحنات</b><p id="shipmentErrorText">تحقق من الاتصال ثم أعد المحاولة.</p>
          <button class="shipment-retry-button" id="shipmentRetryButton" type="button">إعادة المحاولة</button>
        </div>
        <div class="shipment-data-state shipment-empty-state" id="shipmentEmptyState" hidden>
          <b>لا توجد نتائج مطابقة</b><p>جرّب تغيير البحث أو أحد الفلاتر الحالية.</p>
        </div>
      `);
    }

    view.insertAdjacentHTML('beforeend', `
      <nav class="shipment-pagination-shell" id="shipmentPagination" aria-label="ترقيم صفحات الشحنات" hidden>
        <div class="shipment-page-summary" id="shipmentPageSummary"></div>
        <div class="shipment-pagination-buttons" id="shipmentPaginationButtons"></div>
        <form class="shipment-jump" id="shipmentJumpForm">
          <span>الانتقال إلى صفحة:</span>
          <input id="shipmentJumpInput" type="number" min="1" inputmode="numeric" aria-label="رقم الصفحة">
          <button type="submit">انتقال</button>
        </form>
      </nav>
    `);

    buildShellExtras();
    ui = collectUi();
    bindUi();
    setViewMode(state.viewMode, false);
    syncScopeUi(true);
  }

  function buildShellExtras(){
    const sidebar = document.querySelector('.app-sidebar');
    if(sidebar && !sidebar.querySelector('.shipment-sidebar-footer')){
      sidebar.insertAdjacentHTML('beforeend', `
        <div class="shipment-sidebar-footer" aria-hidden="true">
          <span class="shipment-sidebar-ship">${icon('ship', 48)}</span>
          <b>جاهز لنقل أعمالك إلى آفاق أبعد</b>
          <small>Jahez Logistics Platform</small>
        </div>
      `);
    }

    const navbar = document.querySelector('.o-navbar');
    const navbarRight = navbar && navbar.querySelector('.o-navbar-right');
    if(navbar && navbarRight && !navbar.querySelector('.shipment-top-search')){
      navbarRight.insertAdjacentHTML('beforebegin', `
        <label class="shipment-top-search">${icon('search', 21)}<input id="shipmentTopSearch" type="search" autocomplete="off" placeholder="بحث عن رقم الشحنة، اسم العميل، الصنف..."></label>
        <div class="shipment-clock" id="shipmentClock">${icon('calendarIcon', 23)}<div><b id="shipmentClockDate"></b><small id="shipmentClockTime"></small></div></div>
      `);
      updateClock();
      window.setInterval(updateClock, 60000);
    }
  }

  function collectUi(){
    return {
      title: document.getElementById('shipmentPageTitle'),
      subtitle: document.getElementById('shipmentPageSubtitle'),
      create: document.getElementById('shipmentCreateButton'),
      search: document.getElementById('shipmentPageSearch'),
      topSearch: document.getElementById('shipmentTopSearch'),
      datePreset: document.getElementById('shipmentDatePreset'),
      status: document.getElementById('shipmentStatusFilter'),
      client: document.getElementById('shipmentClientFilter'),
      sort: document.getElementById('shipmentSort'),
      pageSize: document.getElementById('shipmentPageSize'),
      cardsView: document.getElementById('shipmentCardsView'),
      tableView: document.getElementById('shipmentTableView'),
      resultSummary: document.getElementById('shipmentResultSummary'),
      queryMode: document.getElementById('shipmentQueryMode'),
      loading: document.getElementById('shipmentLoadingState'),
      error: document.getElementById('shipmentErrorState'),
      errorText: document.getElementById('shipmentErrorText'),
      empty: document.getElementById('shipmentEmptyState'),
      retry: document.getElementById('shipmentRetryButton'),
      pagination: document.getElementById('shipmentPagination'),
      pageSummary: document.getElementById('shipmentPageSummary'),
      pageButtons: document.getElementById('shipmentPaginationButtons'),
      jumpForm: document.getElementById('shipmentJumpForm'),
      jumpInput: document.getElementById('shipmentJumpInput'),
      statTotal: document.getElementById('shipmentStatTotal'),
      statSent: document.getElementById('shipmentStatSent'),
      statReview: document.getElementById('shipmentStatReview'),
      statDraft: document.getElementById('shipmentStatDraft')
    };
  }

  function bindUi(){
    const setSearch = value=>{
      ui.search.value = value;
      if(ui.topSearch) ui.topSearch.value = value;
      const legacy = document.getElementById('searchInput');
      if(legacy) legacy.value = value;
      const issued = document.getElementById('issuedSearch');
      if(issued) issued.value = value;
      const sea = document.getElementById('seaSearch');
      if(sea) sea.value = value;
      setPage(1);
      scheduleQuery(380);
    };
    ui.search.addEventListener('input', ()=>setSearch(ui.search.value));
    if(ui.topSearch) ui.topSearch.addEventListener('input', ()=>setSearch(ui.topSearch.value));

    ui.datePreset.addEventListener('change', ()=>{
      applyDatePreset(ui.datePreset.value);
      setPage(1);
      scheduleQuery();
    });
    ui.status.addEventListener('change', ()=>{
      setLegacyValue('fltStatus', ui.status.value);
      setPage(1);
      scheduleQuery();
    });
    ui.client.addEventListener('change', ()=>{
      setLegacyValue('fltConsignee', ui.client.value);
      setPage(1);
      scheduleQuery();
    });
    ui.sort.addEventListener('change', ()=>{
      setLegacyValue('fltSort', ui.sort.value);
      setPage(1);
      scheduleQuery();
    });
    ui.pageSize.addEventListener('change', ()=>{
      state.pageSize = Number(ui.pageSize.value) || 10;
      setLegacyValue('fltPerPage', String(state.pageSize));
      setPage(1);
      scheduleQuery();
    });
    ui.cardsView.addEventListener('click', ()=>setViewMode('cards', true));
    ui.tableView.addEventListener('click', ()=>setViewMode('table', true));
    ui.create.addEventListener('click', ()=>{
      if(!canEdit()) return;
      if(currentCompanyScope === 'bsgt') openBsgtShipForm(null);
      else switchView('createShip');
    });
    ui.retry.addEventListener('click', ()=>scheduleQuery());
    ui.jumpForm.addEventListener('submit', event=>{
      event.preventDefault();
      const page = Number(ui.jumpInput.value);
      const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
      if(Number.isInteger(page) && page >= 1 && page <= pages){
        setPage(page);
        scheduleQuery();
      }
    });

    view.querySelectorAll('.ship-tab').forEach(button=>{
      button.addEventListener('click', ()=>{
        window.setTimeout(()=>{
          setPage(1);
          syncScopeUi();
          scheduleQuery();
        }, 0);
      });
    });

    const clear = document.getElementById('fbClear');
    if(clear) clear.addEventListener('click', ()=>{
      ui.search.value = '';
      if(ui.topSearch) ui.topSearch.value = '';
      ui.datePreset.value = 'all';
      ui.status.value = '';
      ui.client.value = '';
      ui.sort.value = 'newest';
      ui.pageSize.value = '10';
      state.pageSize = 10;
      setPage(1);
      scheduleQuery();
    });

    document.addEventListener('click', event=>{
      if(!event.target.closest('.shipment-card-menu')){
        document.querySelectorAll('.shipment-card-menu.open').forEach(menu=>menu.classList.remove('open'));
      }
    });
  }

  function setLegacyValue(id, value){
    const element = document.getElementById(id);
    if(element) element.value = value;
  }

  function applyDatePreset(value){
    let from = '';
    let to = '';
    const today = new Date();
    const asIso = date=>{
      const year = date.getFullYear();
      const month = String(date.getMonth()+1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    if(value === 'today') from = to = asIso(today);
    if(value === '7days' || value === '30days'){
      const days = value === '7days' ? 6 : 29;
      const start = new Date(today);
      start.setDate(start.getDate() - days);
      from = asIso(start);
      to = asIso(today);
    }
    if(value === 'year'){
      from = `${today.getFullYear()}-01-01`;
      to = `${today.getFullYear()}-12-31`;
    }
    setLegacyValue('fltDateFrom', from);
    setLegacyValue('fltDateTo', to);
  }

  function setViewMode(mode, rerender){
    state.viewMode = mode === 'table' ? 'table' : 'cards';
    view.classList.toggle('sp-view-cards', state.viewMode === 'cards');
    view.classList.toggle('sp-view-table', state.viewMode === 'table');
    ui.cardsView.classList.toggle('active', state.viewMode === 'cards');
    ui.tableView.classList.toggle('active', state.viewMode === 'table');
    ui.cardsView.setAttribute('aria-pressed', String(state.viewMode === 'cards'));
    ui.tableView.setAttribute('aria-pressed', String(state.viewMode === 'table'));
    writeViewPreference(state.viewMode);
    if(rerender) renderRows();
  }

  function updateClock(){
    const date = new Date();
    const dateElement = document.getElementById('shipmentClockDate');
    const timeElement = document.getElementById('shipmentClockTime');
    if(dateElement) dateElement.textContent = new Intl.DateTimeFormat('ar-AE', {weekday:'long', day:'numeric', month:'long', year:'numeric'}).format(date);
    if(timeElement) timeElement.textContent = new Intl.DateTimeFormat('en-US', {hour:'2-digit', minute:'2-digit'}).format(date);
  }

  function scopeKey(){
    return currentCompanyScope === 'bsgt' ? 'bsgt' : 'general';
  }

  function activeTab(){
    return currentShipTab || 'land';
  }

  function pageKey(){
    return `${scopeKey()}:${activeTab()}`;
  }

  function getPage(){
    return state.pages[pageKey()] || 1;
  }

  function setPage(page){
    state.pages[pageKey()] = Math.max(1, Number(page) || 1);
  }

  function syncScopeUi(force){
    if(!ui) return;
    const nextScope = scopeKey();
    if(force || state.scope !== nextScope){
      state.scope = nextScope;
      state.statsScope = '';
      state.statsLoadedAt = 0;
      setPage(1);
      refreshClientOptions();
    }
    const isBsgt = nextScope === 'bsgt';
    ui.title.textContent = isBsgt ? 'شحنات BSGT' : 'الشحنات الصادرة';
    ui.subtitle.textContent = isBsgt
      ? 'إدارة ومتابعة شحنات بحر سواكن ومستنداتها من مكان واحد'
      : 'إدارة ومتابعة جميع الشحنات الصادرة من النظام';
    ui.create.querySelector('.shipment-create-label').textContent = isBsgt ? 'إنشاء شحنة BSGT' : 'إنشاء شحنة جديدة';
    ui.create.hidden = !canEdit();
    const permitButton = document.getElementById('bsgtImportPermitBtn');
    const collectionButton = document.getElementById('bsgtCollectionLabBtn');
    if(permitButton) permitButton.style.display = isBsgt && (canEdit() || isBsgtPortalUser()) ? 'inline-flex' : 'none';
    if(collectionButton) collectionButton.style.display = isBsgt ? 'inline-flex' : 'none';
    updateLocalStats();
    void loadServerStats();
  }

  function refreshClientOptions(){
    if(!ui) return;
    const selected = ui.client.value;
    const names = Array.from(new Set(records.filter(inCompanyScope).map(record=>String(record.consignee || '').trim()).filter(Boolean)))
      .sort((a,b)=>a.localeCompare(b, 'ar'));
    ui.client.replaceChildren(new Option('كل العملاء', ''), ...names.map(name=>new Option(name, name)));
    ui.client.value = names.includes(selected) ? selected : '';
  }

  function updateLocalStats(){
    if(!ui) return;
    const scoped = records.filter(inCompanyScope);
    const sent = scoped.filter(record=>recStatus(record) === 'sent').length;
    const review = scoped.filter(record=>['review','rework'].includes(recStatus(record))).length;
    const drafts = scoped.filter(record=>recStatus(record) === 'draft').length;
    setStat(ui.statTotal, scoped.length);
    setStat(ui.statSent, sent);
    setStat(ui.statReview, review);
    setStat(ui.statDraft, drafts);
    updateTabBadges(scoped);
  }

  function updateTabBadges(scoped){
    const values = {
      land: scoped.filter(record=>!isSea(record)).length,
      sea: scoped.filter(isSea).length,
      issued: scoped.filter(record=>recStatus(record) === 'sent').length,
      drafts: scoped.filter(record=>recStatus(record) === 'draft').length
    };
    Object.entries(values).forEach(([name, value])=>{
      const badge = document.getElementById(`${name}Badge`);
      if(!badge) return;
      badge.textContent = value.toLocaleString('en-US');
      badge.classList.toggle('zero', value === 0);
    });
    const globalCount = document.getElementById('totalCount');
    if(globalCount) globalCount.textContent = scoped.length.toLocaleString('en-US');
  }

  function setStat(element, value){
    if(element) element.textContent = Number(value || 0).toLocaleString('en-US');
  }

  function applyScopeToQuery(query){
    const bahar = typeof baharCompanyEntry === 'function' ? baharCompanyEntry() : null;
    if(scopeKey() === 'bsgt'){
      if(bahar && bahar.id) return query.or(`company_id.eq.${bahar.id},data->>operationNo.ilike.BSGTX-*`);
      return query.ilike('data->>operationNo', 'BSGTX-*');
    }
    if(bahar && bahar.id) query = query.or(`company_id.is.null,company_id.neq.${bahar.id}`);
    return query.or('data->>operationNo.is.null,data->>operationNo.not.ilike.BSGTX-*');
  }

  async function countByStatus(status){
    let query = sb.from('shipments').select('id', {count:'exact', head:true});
    query = applyScopeToQuery(query);
    if(status) query = query.eq('status', status);
    const result = await query;
    if(result.error) throw result.error;
    return result.count || 0;
  }

  async function loadServerStats(){
    const scope = scopeKey();
    if(state.statsScope === scope && Date.now() - state.statsLoadedAt < 30000) return;
    const requestScope = scope;
    try{
      const [total, sent, review, rework, draft] = await Promise.all([
        countByStatus(''), countByStatus('sent'), countByStatus('review'), countByStatus('rework'), countByStatus('draft')
      ]);
      if(scopeKey() !== requestScope) return;
      setStat(ui.statTotal, total);
      setStat(ui.statSent, sent);
      setStat(ui.statReview, review + rework);
      setStat(ui.statDraft, draft);
      state.statsScope = scope;
      state.statsLoadedAt = Date.now();
    }catch(error){
      console.warn('shipment stats query failed; keeping local counters', error);
    }
  }

  function currentFilters(){
    return {
      search: String(ui.search.value || '').trim(),
      client: String(ui.client.value || '').trim(),
      status: String(ui.status.value || ''),
      from: String(document.getElementById('fltDateFrom')?.value || ''),
      to: String(document.getElementById('fltDateTo')?.value || ''),
      bank: String(document.getElementById('fltBank')?.value || '').trim(),
      docs: String(document.getElementById('fltDocs')?.value || ''),
      amountMin: String(document.getElementById('fltAmtMin')?.value || ''),
      amountMax: String(document.getElementById('fltAmtMax')?.value || ''),
      sort: String(ui.sort.value || 'newest')
    };
  }

  function needsClientFallback(filters){
    const legacySort = String(document.getElementById('fltSort')?.value || filters.sort);
    return !!(filters.docs || filters.amountMin || filters.amountMax || !['newest','oldest'].includes(legacySort));
  }

  function safeSearchTerm(value){
    return String(value || '').replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function applyTabToQuery(query){
    const tab = activeTab();
    if(tab === 'sea') return query.eq('data->>shipType', 'sea');
    if(tab === 'land') return query.or('data->>shipType.is.null,data->>shipType.neq.sea');
    if(tab === 'issued') return query.eq('status', 'sent');
    if(tab === 'drafts') return query.eq('status', 'draft');
    return query;
  }

  function applyFiltersToQuery(query, filters){
    if(filters.search){
      const term = safeSearchTerm(filters.search);
      if(term){
        const value = `*${term}*`;
        query = query.or([
          `data->>operationNo.ilike.${value}`,
          `data->>invoiceNo.ilike.${value}`,
          `data->>proformaNo.ilike.${value}`,
          `data->>billNo.ilike.${value}`,
          `data->>consignee.ilike.${value}`,
          `data->>exporter.ilike.${value}`,
          `data->>itemDesc.ilike.${value}`
        ].join(','));
      }
    }
    if(filters.client) query = query.ilike('data->>consignee', `*${safeSearchTerm(filters.client)}*`);
    if(filters.bank) query = query.ilike('data->>destBank', `*${safeSearchTerm(filters.bank)}*`);
    if(filters.from) query = query.gte('data->>invoiceDate', filters.from);
    if(filters.to) query = query.lte('data->>invoiceDate', filters.to);
    if(filters.status && !['issued','drafts'].includes(activeTab())) query = query.eq('status', filters.status);
    return query;
  }

  async function fetchServerPage(filters){
    const page = getPage();
    const from = (page - 1) * state.pageSize;
    const to = from + state.pageSize - 1;
    let query = sb.from('shipments').select(ROW_SELECT, {count:'exact'});
    query = applyScopeToQuery(query);
    query = applyTabToQuery(query);
    query = applyFiltersToQuery(query, filters);
    query = query.order('updated_at', {ascending: filters.sort === 'oldest', nullsFirst:false}).range(from, to);
    const result = await query;
    if(result.error) throw result.error;
    const rows = (result.data || []).map(row=>{
      const record = rowToRecord(row);
      record.taskRef = record.taskRef || row.task_ref || '';
      return record;
    });
    return {rows, total:result.count || 0, mode:'server'};
  }

  function clientPage(filters){
    let list = records.filter(inCompanyScope);
    if(activeTab() === 'sea') list = list.filter(isSea);
    if(activeTab() === 'land') list = list.filter(record=>!isSea(record));
    if(activeTab() === 'issued') list = list.filter(record=>recStatus(record) === 'sent');
    if(activeTab() === 'drafts') list = list.filter(record=>recStatus(record) === 'draft');
    if(filters.search){
      const term = filters.search.toLowerCase();
      list = list.filter(record=>[
        record.operationNo, record.invoiceNo, record.proformaNo, record.billNo,
        record.consignee, record.exporter, record.itemDesc, record.item2Desc, record.item3Desc
      ].join(' ').toLowerCase().includes(term));
    }
    list = applyFilters(list);
    const total = list.length;
    const offset = (getPage() - 1) * state.pageSize;
    return {rows:list.slice(offset, offset + state.pageSize), total, mode:'compatibility'};
  }

  function scheduleQuery(delay){
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(runQuery, Number(delay) || 0);
  }

  async function runQuery(){
    if(!view.classList.contains('active') || !ui) return;
    syncScopeUi();
    const requestId = ++state.requestId;
    const filters = currentFilters();
    state.loading = true;
    state.error = null;
    showState('loading');
    try{
      const result = needsClientFallback(filters) ? clientPage(filters) : await fetchServerPage(filters);
      if(requestId !== state.requestId) return;
      state.clientFallback = result.mode !== 'server';
      state.total = result.total;
      const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
      if(getPage() > pages){
        setPage(pages);
        scheduleQuery();
        return;
      }
      state.rows = result.rows;
      mergePageRows(result.rows);
      state.loading = false;
      showState(result.rows.length ? 'ready' : 'empty');
      renderRows();
      renderPagination();
      ui.queryMode.textContent = result.mode === 'server' ? 'ترقيم خادمي' : 'توافق الفلاتر القديمة';
      updateResultSummary();
    }catch(error){
      if(requestId !== state.requestId) return;
      state.loading = false;
      state.error = error;
      console.error('shipment page query', error);
      ui.errorText.textContent = error && error.message ? error.message : 'تحقق من الاتصال ثم أعد المحاولة.';
      showState('error');
      ui.pagination.hidden = true;
    }
  }

  function mergePageRows(rows){
    rows.forEach(row=>{
      row.__saved = true;
      const index = records.findIndex(record=>record.id === row.id);
      if(index >= 0) records[index] = row;
      else records.push(row);
    });
  }

  function showState(kind){
    ui.loading.hidden = kind !== 'loading';
    ui.error.hidden = kind !== 'error';
    ui.empty.hidden = kind !== 'empty';
    const activeBody = bodyForTab(activeTab());
    const activeLedger = activeBody && activeBody.closest('.ledger');
    if(activeLedger) activeLedger.hidden = kind !== 'ready';
    ui.pagination.hidden = kind !== 'ready';
  }

  function bodyForTab(tab){
    return document.getElementById({land:'listBody',sea:'seaBody',issued:'issuedBody',drafts:'draftsBody'}[tab] || 'listBody');
  }

  function renderRows(){
    if(!ui || state.loading || state.error) return;
    const body = bodyForTab(activeTab());
    if(!body) return;
    if(!state.rows.length){ body.innerHTML = ''; return; }
    const offset = (getPage() - 1) * state.pageSize;
    body.innerHTML = state.rows.map((record, index)=>state.viewMode === 'table'
      ? shipmentTableRow(record, offset + index + 1)
      : shipmentCard(record, offset + index + 1)).join('');
    bindResultActions(body);
  }

  function shipmentCard(record, sequence){
    const status = recStatus(record);
    const reference = record.operationNo || record.taskRef || record.invoiceNo || record.proformaNo || 'بدون رقم مرجعي';
    const companyName = record.consignee || record.exporter || 'لم يحدد العميل';
    const quantity = quantityText(record);
    const type = shipmentType(record);
    return `<article class="shipment-result-card" data-shipment-id="${escapeHtml(record.id)}" tabindex="0" role="button" aria-label="فتح تفاصيل ${escapeHtml(reference)}">
      <div class="shipment-card-top">
        <span class="shipment-card-sequence">${String(sequence).padStart(2, '0')}</span>
        ${statusBadge(status)}
        <span class="shipment-card-icon">${icon(getShipmentIcon(record.itemDesc || '', record), 21)}</span>
        <span class="shipment-card-menu">
          <button class="shipment-card-menu-button" type="button" data-shipment-menu aria-label="المزيد">⋮</button>
          <span class="shipment-card-menu-popover"><button type="button" data-shipment-open>فتح التفاصيل</button></span>
        </span>
      </div>
      <h2 class="shipment-card-product" title="${escapeHtml(record.itemDesc || '(بدون وصف)')}">${escapeHtml(record.itemDesc || '(بدون وصف)')}</h2>
      <p class="shipment-card-company" title="${escapeHtml(companyName)}">${escapeHtml(companyName)}</p>
      <strong class="shipment-card-reference" title="${escapeHtml(reference)}">${escapeHtml(reference)}</strong>
      <div class="shipment-card-meta">
        <span>${icon('calendarIcon', 11)} ${escapeHtml(fmtDate(record.invoiceDate || record.proformaDate || '') || 'بدون تاريخ')}</span>
        ${quantity ? `<span>${icon('box', 11)} ${escapeHtml(quantity)}</span>` : ''}
        <span>${icon(type.icon, 11)} ${type.label}</span>
      </div>
      <div class="shipment-card-docs">${documentBadges(record)}</div>
      <footer class="shipment-card-footer">
        <strong class="shipment-card-amount">${escapeHtml(record.totalAmount || '—')}</strong>
        <button class="shipment-card-open" type="button" data-shipment-open>فتح التفاصيل</button>
      </footer>
    </article>`;
  }

  function shipmentTableRow(record, sequence){
    const reference = record.operationNo || record.taskRef || record.invoiceNo || record.proformaNo || '—';
    const type = shipmentType(record);
    return `<div class="shipment-table-row" data-shipment-id="${escapeHtml(record.id)}" tabindex="0" role="button">
      <span class="shipment-card-sequence">${String(sequence).padStart(2, '0')}</span>
      <span class="shipment-table-main"><b title="${escapeHtml(record.itemDesc || '(بدون وصف)')}">${escapeHtml(record.itemDesc || '(بدون وصف)')}</b><small title="${escapeHtml(record.consignee || record.exporter || 'لم يحدد العميل')}">${escapeHtml(record.consignee || record.exporter || 'لم يحدد العميل')}</small></span>
      <span class="shipment-table-meta"><b title="${escapeHtml(reference)}">${escapeHtml(reference)}</b><small>${escapeHtml(fmtDate(record.invoiceDate || record.proformaDate || '') || 'بدون تاريخ')} · ${type.label}</small></span>
      <span class="shipment-table-docs">${documentBadges(record)} ${statusBadge(recStatus(record))}</span>
      <strong class="shipment-table-amount">${escapeHtml(record.totalAmount || '—')}</strong>
      <button class="shipment-table-action" type="button" data-shipment-open>فتح</button>
    </div>`;
  }

  function quantityText(record){
    const value = String(record.totalQty || record.qty || record.numberOfPackages || '').trim();
    const unit = String(record.qtyUnit || '').trim();
    if(!value) return '';
    if(unit && !value.toLowerCase().includes(unit.toLowerCase())) return `${value} ${unit}`;
    return value;
  }

  function shipmentType(record){
    if(record.shipType === 'air') return {label:'جوي', icon:'plane'};
    if(isSea(record)) return {label:'بحري', icon:'anchor'};
    return {label:'بري', icon:'truck'};
  }

  function statusBadge(status){
    const labels = {sent:'صادرة', review:'تحت المراجعة', rework:'معادة للتعديل', draft:'مسودة'};
    const icons = {sent:'checkCircle', review:'history', rework:'warning', draft:'doc'};
    return `<span class="shipment-status-badge ${status}">${icon(icons[status] || 'checkCircle', 11)} ${labels[status] || STATUS_AR[status] || 'صادرة'}</span>`;
  }

  function documentBadges(record){
    return [
      ['بروفورما', !!String(record.proformaNo || '').trim()],
      ['فاتورة', !!String(record.invoiceNo || '').trim()],
      ['منشأ', !!String(record.certNo || '').trim()],
      ['بوليصة', !!String(record.billNo || '').trim()],
      ['تعبئة', !!String(record.invoiceNo || '').trim()]
    ].map(([label, ready])=>`<span class="shipment-doc-badge ${ready ? 'ready' : ''}">${label}</span>`).join('');
  }

  function bindResultActions(body){
    body.onclick = event=>{
      const card = event.target.closest('[data-shipment-id]');
      if(!card) return;
      const menuButton = event.target.closest('[data-shipment-menu]');
      if(menuButton){
        event.preventDefault();
        event.stopPropagation();
        const menu = menuButton.closest('.shipment-card-menu');
        const opening = !menu.classList.contains('open');
        document.querySelectorAll('.shipment-card-menu.open').forEach(item=>item.classList.remove('open'));
        menu.classList.toggle('open', opening);
        return;
      }
      event.preventDefault();
      openDetail(card.dataset.shipmentId);
    };
    body.onkeydown = event=>{
      if(!['Enter',' '].includes(event.key)) return;
      if(event.target.closest('button')) return;
      const card = event.target.closest('[data-shipment-id]');
      if(card){
        event.preventDefault();
        openDetail(card.dataset.shipmentId);
      }
    };
  }

  function updateResultSummary(){
    const from = state.total ? (getPage() - 1) * state.pageSize + 1 : 0;
    const to = Math.min(state.total, getPage() * state.pageSize);
    ui.resultSummary.innerHTML = `عرض <b>${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')}</b> من <b>${state.total.toLocaleString('en-US')}</b> شحنة`;
  }

  function paginationNumbers(page, pages){
    const values = new Set([1, pages]);
    for(let number = Math.max(1, page - 2); number <= Math.min(pages, page + 2); number++) values.add(number);
    if(page <= 4) for(let number=1; number<=Math.min(5, pages); number++) values.add(number);
    if(page >= pages - 3) for(let number=Math.max(1, pages - 4); number<=pages; number++) values.add(number);
    return Array.from(values).sort((a,b)=>a-b);
  }

  function renderPagination(){
    const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    const page = Math.min(getPage(), pages);
    const from = state.total ? (page - 1) * state.pageSize + 1 : 0;
    const to = Math.min(state.total, page * state.pageSize);
    ui.pagination.hidden = state.total === 0;
    ui.pageSummary.textContent = `عرض ${from.toLocaleString('en-US')} إلى ${to.toLocaleString('en-US')} من ${state.total.toLocaleString('en-US')} شحنة · الصفحة ${page.toLocaleString('en-US')} من ${pages.toLocaleString('en-US')}`;
    const values = paginationNumbers(page, pages);
    let previous = 0;
    const numberButtons = values.map(number=>{
      const dots = previous && number - previous > 1 ? '<span class="shipment-page-dots">…</span>' : '';
      previous = number;
      return `${dots}<button class="shipment-page-button ${number === page ? 'active' : ''}" type="button" data-page="${number}" ${number === page ? 'aria-current="page"' : ''}>${number.toLocaleString('en-US')}</button>`;
    }).join('');
    ui.pageButtons.innerHTML = `
      <button class="shipment-page-button" type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="السابق">‹</button>
      ${numberButtons}
      <button class="shipment-page-button" type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="التالي">›</button>`;
    ui.pageButtons.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click', ()=>{
      if(button.disabled) return;
      setPage(Number(button.dataset.page));
      scheduleQuery();
      view.querySelector('.shipment-results-head')?.scrollIntoView({behavior:'smooth', block:'start'});
    }));
    ui.jumpInput.max = String(pages);
    ui.jumpInput.placeholder = String(page);
  }

  function skeletonCards(){
    return Array.from({length:8}, ()=>`<div class="shipment-skeleton-card"><div class="shipment-skeleton-line tall short"></div><div class="shipment-skeleton-line medium"></div><div class="shipment-skeleton-line"></div><div class="shipment-skeleton-line medium"></div><div class="shipment-skeleton-line"></div><div class="shipment-skeleton-line short"></div></div>`).join('');
  }

  function requestActiveList(){
    if(!ui) return;
    updateLocalStats();
    if(!view.classList.contains('active')) return;
    syncScopeUi();
    scheduleQuery();
  }

  buildWorkspace();

  // Existing event handlers keep calling these names. Redirect only the list renderers;
  // save, edit, detail, document and workflow functions remain untouched.
  render = requestActiveList;
  renderSea = requestActiveList;
  renderIssued = requestActiveList;
  renderDrafts = requestActiveList;

  window.shipmentListWorkspace = {
    refresh: ()=>{ state.statsLoadedAt = 0; requestActiveList(); },
    retry: scheduleQuery,
    legacy: {render:legacyRender, renderSea:legacyRenderSea, renderIssued:legacyRenderIssued, renderDrafts:legacyRenderDrafts}
  };
})();
