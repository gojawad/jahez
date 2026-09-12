(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JahezBsgtFinance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FILE_STATUS_LABELS = Object.freeze({
    draft: 'مسودة',
    sent_to_remitting: 'تم الإرسال للبنك المرسل',
    under_management_review: 'قيد مراجعة الإدارة',
    returned_to_operations: 'معاد إلى العمليات',
    returned_to_finance: 'معاد إلى المالية',
    final_accepted: 'مقبول نهائياً'
  });

  function moneyInfo(value, fallbackCurrency) {
    const text = String(value || '').trim();
    const currency = String(fallbackCurrency || (text.match(/\b[A-Z]{3}\b/i) || [])[0] || '').toUpperCase();
    const match = text.match(/-?[\d,]+(?:\.\d+)?/);
    const amount = match ? Number(match[0].replace(/,/g, '')) : 0;
    return Object.freeze({currency: currency || '—', amount: Number.isFinite(amount) ? amount : 0});
  }

  function shipmentMoney(shipment) {
    return moneyInfo(shipment?.totalAmount, shipment?.currency);
  }

  function summarizeShipments(shipments) {
    const totals = {};
    (Array.isArray(shipments) ? shipments : []).forEach(shipment => {
      const money = shipmentMoney(shipment);
      if (money.currency !== '—') totals[money.currency] = (totals[money.currency] || 0) + money.amount;
    });
    const currencies = Object.keys(totals);
    return Object.freeze({
      count: Array.isArray(shipments) ? shipments.length : 0,
      totals: Object.freeze(totals),
      currencies: Object.freeze(currencies),
      sameCurrency: currencies.length === 1,
      currency: currencies.length === 1 ? currencies[0] : null,
      amount: currencies.length === 1 ? totals[currencies[0]] : null
    });
  }

  function formatMoney(currency, amount) {
    if (!currency || !Number.isFinite(Number(amount))) return '—';
    return `${currency} ${Number(amount).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  }

  function collectionPortalUrl(tradeFileId) {
    return `/experiments/bs-collection/?tradeFileId=${encodeURIComponent(String(tradeFileId || ''))}`;
  }

  function fileStatusLabel(status) {
    return FILE_STATUS_LABELS[status] || String(status || '—');
  }

  return Object.freeze({FILE_STATUS_LABELS, moneyInfo, shipmentMoney, summarizeShipments, formatMoney, collectionPortalUrl, fileStatusLabel});
});
