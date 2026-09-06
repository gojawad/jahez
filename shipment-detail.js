(() => {
  const card = document.getElementById('detailCard');
  if (!card) return;
  function enhance() {
    if (card.querySelector('.shipment-detail-layout') || !card.querySelector('#packageBtn')) return;
    card.dataset.detailEnhanced = '1';
    const header = card.querySelector(':scope > .dh');
    const rows = [...card.querySelectorAll(':scope > .drow')];
    const timeline = card.querySelector(':scope > .stl-section');
    const order = [...card.querySelectorAll(':scope > .sf-section')].find(section => section.querySelector('#docOrderList'));
    const docs = card.querySelector('#docActionsGrid');
    const comments = card.querySelector('.cmt-section');
    const notes = card.querySelector('.comments-box');
    const archive = [...card.querySelectorAll(':scope > .sf-section')].find(section => section.querySelector('#sfList'));
    const packageAttachments = card.querySelector('#pkgAttSection');
    const actions = card.querySelector(':scope > .detail-actions');
    const review = card.querySelector(':scope > .rework-note');
    if (!header || !actions) return;

    const title = header.querySelector('h2')?.textContent?.trim() || 'تفاصيل الشحنة';
    const layout = document.createElement('div'); layout.className = 'shipment-detail-layout';
    const sidebar = document.createElement('aside'); sidebar.className = 'shipment-detail-sidebar';
    const main = document.createElement('main'); main.className = 'shipment-detail-main';
    const hero = document.createElement('section'); hero.className = 'shipment-hero';
    hero.innerHTML = `<span class="shipment-hero-icon" aria-hidden="true">&#9633;</span><small>رقم مرجع الشحنة</small><strong>${title}</strong><span class="shipment-pill">الحالة الحالية</span>`;
    const status = document.createElement('section'); status.className = 'shipment-status-card';
    status.innerHTML = `<div class="shipment-status-title">إنشاء الشحنة <span>(صادرة مباشرة)</span></div><div class="shipment-status-current"><span></span><b>الحالة الحالية</b></div><div class="shipment-status-date">جاري تحميل تاريخ الحالة...</div>`;
    const refreshStatus = () => {
      const latest = timeline?.querySelector('.stl-item.current, .stl-item:last-child');
      if (!latest) return;
      const statusName = latest.querySelector('.stl-title')?.textContent?.trim();
      const statusDate = latest.querySelector('.stl-time')?.textContent?.trim();
      if (statusName) status.querySelector('b').textContent = statusName;
      if (statusDate) status.querySelector('.shipment-status-date').textContent = statusDate;
    };
    if (timeline) new MutationObserver(refreshStatus).observe(timeline, {childList:true, subtree:true});
    const summary = document.createElement('section'); summary.className = 'shipment-summary';
    rows.forEach(row => summary.append(row));
    const append = (parent, ...nodes) => nodes.filter(Boolean).forEach(node => parent.append(node));
    append(sidebar, hero, status, timeline, order);
    append(main, review, summary, docs, comments, notes, archive, packageAttachments, actions);
    layout.append(sidebar, main); card.append(layout);
  }
  new MutationObserver(enhance).observe(card, {childList:true});
  enhance();
})();
