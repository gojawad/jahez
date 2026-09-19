/* BSGT workspace — «المركز المالي» (phase 0: empty structural shell).
   Mounted by renderBsgtWorkspace() for section `financialCenter`, following the
   same mount(content) pattern as the trade-files section. No data, no forms, no
   API or database access in this phase. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JahezBsgtFinancialCenter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TITLE = 'المركز المالي';
  const DESCRIPTION = 'إدارة الحسابات والتكاليف والتحصيلات المرتبطة بالعمليات';

  function shell() {
    return `<section class="bsgt-financial-center" id="bsgtFinancialCenter" aria-labelledby="bsgtFinancialCenterTitle">
      <header class="bsgt-financial-center-head">
        <div>
          <h3 id="bsgtFinancialCenterTitle">${TITLE}</h3>
          <p>${DESCRIPTION}</p>
        </div>
      </header>
      <div class="bsgt-financial-center-body" aria-live="polite"></div>
    </section>`;
  }

  function mount(container) {
    if (!container) return null;
    container.innerHTML = shell();
    return container.querySelector('#bsgtFinancialCenter');
  }

  return Object.freeze({ TITLE, DESCRIPTION, shell, mount });
});
