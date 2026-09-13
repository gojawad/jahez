(function () {
  'use strict';

  const MOBILE_ROUTES = [
    { view: 'dashboard', source: 'navDashboard', label: 'الرئيسية', icon: 'home' },
    { view: 'records', source: 'navOperations', label: 'الشحنات', icon: 'ship' },
    { view: 'bsgtWorkspace', source: 'navBsgt', label: 'مساحة BSGT', icon: 'grid' },
    { view: 'tasks', source: 'navTasks', label: 'المهام', icon: 'tasks' }
  ];
  let sidebarHome = null;

  const ICONS = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
    ship: '<path d="M3 17h18l-2 3H5l-2-3Z"/><path d="M7 17V8h10v9M9 8V4h6v4"/><path d="M2 21c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    tasks: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3.5h6M9 9h6M9 13h6M9 17h4"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    filter: '<path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z"/>'
  };

  function svg(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.grid}</svg>`;
  }

  function buildShell() {
    if (document.getElementById('mobileAppHeader')) return;
    const header = document.createElement('header');
    header.className = 'mobile-app-header';
    header.id = 'mobileAppHeader';
    header.innerHTML = `
      <button type="button" class="mobile-icon-button" id="mobileDrawerTrigger" aria-label="فتح القائمة" aria-expanded="false">${svg('menu')}</button>
      <div class="mobile-app-heading">
        <img src="bsqt-qr-logo.png" alt="" aria-hidden="true">
        <div><strong id="mobilePageTitle">لوحة المعلومات</strong><small>منصة جاهز</small></div>
      </div>
      <div class="mobile-app-actions">
        <button type="button" class="mobile-icon-button mobile-filter-button" id="mobileFilterButton" aria-label="إظهار الفلاتر" hidden>${svg('filter')}</button>
        <button type="button" class="mobile-icon-button" id="mobileNotifButton" aria-label="الإشعارات">${svg('bell')}<span id="mobileNotifBadge" hidden>0</span></button>
        <button type="button" class="mobile-user-button" id="mobileProfileButton" aria-label="الملف الشخصي"><span id="mobileUserAvatar">م</span></button>
      </div>`;

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'mobile-drawer-backdrop';
    backdrop.id = 'mobileDrawerBackdrop';
    backdrop.setAttribute('aria-label', 'إغلاق القائمة');

    const bottom = document.createElement('nav');
    bottom.className = 'mobile-bottom-nav';
    bottom.id = 'mobileBottomNav';
    bottom.setAttribute('aria-label', 'التنقل الرئيسي');
    bottom.innerHTML = MOBILE_ROUTES.map(route => `
      <button type="button" data-mobile-view="${route.view}" data-source="${route.source}">${svg(route.icon)}<span>${route.label}</span></button>`).join('') + `
      <button type="button" data-mobile-action="more">${svg('more')}<span>المزيد</span></button>`;

    const sidebar = document.querySelector('.app-sidebar');
    if (sidebar) {
      sidebarHome = document.createComment('app-sidebar-home');
      sidebar.parentNode.insertBefore(sidebarHome, sidebar);
      const drawerHead = document.createElement('div');
      drawerHead.className = 'mobile-drawer-head';
      drawerHead.innerHTML = `<div><strong>القائمة الرئيسية</strong><small>التنقل حسب صلاحياتك</small></div><button type="button" id="mobileDrawerClose" aria-label="إغلاق القائمة">${svg('close')}</button>`;
      sidebar.prepend(drawerHead);
      const portals = document.createElement('div');
      portals.className = 'mobile-drawer-portals';
      portals.id = 'mobileDrawerPortals';
      sidebar.appendChild(portals);
    }

    document.body.prepend(backdrop);
    document.body.prepend(header);
    document.body.appendChild(bottom);
  }

  function positionSidebar() {
    const sidebar = document.querySelector('.app-sidebar');
    if (!sidebar || !sidebarHome?.parentNode) return;
    if (window.innerWidth <= 1023) {
      if (sidebar.parentNode !== document.body) document.body.appendChild(sidebar);
      return;
    }
    if (sidebar.parentNode !== sidebarHome.parentNode) {
      sidebarHome.parentNode.insertBefore(sidebar, sidebarHome.nextSibling);
    }
  }

  function appIsReady() {
    const landing = document.getElementById('landingPage');
    const lock = document.getElementById('lockScreen');
    const restoring = document.getElementById('authRestoreScreen');
    return Boolean(landing?.hidden && lock?.classList.contains('hidden') && restoring?.hidden);
  }

  function currentView() {
    const raw = new URLSearchParams(location.hash.slice(1)).get('v') || 'dashboard';
    return ({ bsgt: 'records', sea: 'records', issued: 'records', drafts: 'records' })[raw] || raw;
  }

  function sourceIsAvailable(route) {
    const source = document.getElementById(route.source);
    if (!source) return false;
    if (window.JahezAccess?.canViewAppRoute && !window.JahezAccess.canViewAppRoute(route.view)) return false;
    return getComputedStyle(source).display !== 'none';
  }

  function closeDrawer() {
    document.body.classList.remove('mobile-drawer-open');
    document.querySelector('.app-sidebar')?.classList.remove('is-open');
    document.getElementById('mobileDrawerTrigger')?.setAttribute('aria-expanded', 'false');
  }

  function openDrawer() {
    closeMobileFilters();
    document.body.classList.add('mobile-drawer-open');
    document.querySelector('.app-sidebar')?.classList.add('is-open');
    document.getElementById('mobileDrawerTrigger')?.setAttribute('aria-expanded', 'true');
  }

  function filterTarget() {
    return document.querySelector('.view.active .shipment-filter-row, .view.active .import-permit-filters');
  }

  function closeMobileFilters() {
    document.body.classList.remove('mobile-filters-open');
    document.querySelectorAll('.mobile-filter-open').forEach(element => element.classList.remove('mobile-filter-open'));
    document.getElementById('mobileFilterButton')?.setAttribute('aria-expanded', 'false');
  }

  function toggleMobileFilters() {
    const target = filterTarget();
    if (!target) return;
    const opening = !target.classList.contains('mobile-filter-open');
    closeDrawer();
    closeMobileFilters();
    if (opening) {
      target.classList.add('mobile-filter-open');
      document.body.classList.add('mobile-filters-open');
      document.getElementById('mobileFilterButton')?.setAttribute('aria-expanded', 'true');
    }
  }

  function syncPortals() {
    const target = document.getElementById('mobileDrawerPortals');
    const source = document.getElementById('employeePortalLinks');
    if (!target || !source) return;
    const links = Array.from(source.querySelectorAll('a'));
    target.replaceChildren();
    if (!links.length) return;
    const title = document.createElement('span');
    title.className = 'mobile-drawer-section-title';
    title.textContent = 'البوابات المتاحة';
    target.appendChild(title);
    links.forEach(link => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = link.textContent.trim();
      button.addEventListener('click', () => {
        closeDrawer();
        link.click();
      });
      target.appendChild(button);
    });
  }

  function syncShell() {
    positionSidebar();
    document.body.classList.toggle('mobile-app-ready', appIsReady());
    const view = currentView();
    const title = document.getElementById('crumbCurrent')?.textContent?.trim() || 'لوحة المعلومات';
    const mobileTitle = document.getElementById('mobilePageTitle');
    if (mobileTitle) mobileTitle.textContent = title;

    MOBILE_ROUTES.forEach(route => {
      const button = document.querySelector(`[data-mobile-view="${route.view}"]`);
      if (!button) return;
      button.hidden = !sourceIsAvailable(route);
      button.classList.toggle('active', route.view === view);
      button.setAttribute('aria-current', route.view === view ? 'page' : 'false');
    });

    const navAvatar = document.getElementById('navAvatar');
    const mobileAvatar = document.getElementById('mobileUserAvatar');
    if (navAvatar && mobileAvatar) {
      mobileAvatar.innerHTML = navAvatar.innerHTML;
      mobileAvatar.className = navAvatar.className.includes('has-photo') ? 'has-photo' : '';
    }
    const badge = document.getElementById('notifBadge');
    const mobileBadge = document.getElementById('mobileNotifBadge');
    const count = Number(badge?.textContent || 0);
    if (mobileBadge) {
      mobileBadge.textContent = String(count);
      mobileBadge.hidden = count < 1;
    }
    const filters = filterTarget();
    document.querySelectorAll('[data-mobile-filter-sheet]').forEach(element => element.removeAttribute('data-mobile-filter-sheet'));
    if (filters) filters.setAttribute('data-mobile-filter-sheet', '');
    const filterButton = document.getElementById('mobileFilterButton');
    if (filterButton) filterButton.hidden = !filters;
    syncPortals();
  }

  function scheduleSync() {
    cancelAnimationFrame(scheduleSync.frame);
    scheduleSync.frame = requestAnimationFrame(syncShell);
  }

  function bindShell() {
    document.getElementById('mobileDrawerTrigger')?.addEventListener('click', () => {
      document.body.classList.contains('mobile-drawer-open') ? closeDrawer() : openDrawer();
    });
    document.getElementById('mobileDrawerClose')?.addEventListener('click', closeDrawer);
    document.getElementById('mobileDrawerBackdrop')?.addEventListener('click', () => {
      closeDrawer();
      closeMobileFilters();
    });
    document.getElementById('mobileFilterButton')?.addEventListener('click', toggleMobileFilters);
    document.getElementById('mobileNotifButton')?.addEventListener('click', () => document.getElementById('notifBtn')?.click());
    document.getElementById('mobileProfileButton')?.addEventListener('click', () => document.getElementById('profileBtn')?.click());
    document.getElementById('mobileBottomNav')?.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.mobileAction === 'more') return openDrawer();
      document.getElementById(button.dataset.source)?.click();
      closeDrawer();
      closeMobileFilters();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeDrawer();
        closeMobileFilters();
      }
    });
    window.addEventListener('hashchange', () => {
      closeDrawer();
      closeMobileFilters();
      scheduleSync();
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024) {
        closeDrawer();
        closeMobileFilters();
      }
      scheduleSync();
    }, { passive: true });

    const observer = new MutationObserver(scheduleSync);
    [document.body, document.getElementById('lockScreen'), document.getElementById('landingPage'), document.getElementById('authRestoreScreen'), document.getElementById('crumbCurrent'), document.querySelector('.app-sidebar'), document.getElementById('employeePortalLinks'), document.getElementById('navAvatar'), document.getElementById('notifBadge'), ...document.querySelectorAll('.app-sidebar .navtab')]
      .filter(Boolean)
      .forEach(element => observer.observe(element, { attributes: true, childList: true, subtree: element.id === 'employeePortalLinks' }));
  }

  buildShell();
  bindShell();
  syncShell();
  window.JahezMobileShell = Object.freeze({ sync: syncShell, closeDrawer, closeFilters: closeMobileFilters });
})();
