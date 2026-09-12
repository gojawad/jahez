(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JahezBsgtManagement = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DOCUMENTS = Object.freeze({
    letter:'خطاب التحصيل',
    undertaking:'خطاب التعهد',
    exchange:'الكمبيالة'
  });
  const STATUS_LABELS = Object.freeze({
    sent_to_remitting:'بانتظار مراجعة الإدارة',
    under_management_review:'قيد مراجعة الإدارة',
    returned_to_operations:'معاد إلى العمليات',
    returned_to_finance:'معاد إلى المالية',
    final_accepted:'القبول النهائي'
  });

  function requiredDocumentTypes(tradeFile) {
    const kinds = tradeFile?.metadata?.documentKinds;
    const source = Array.isArray(kinds) && kinds.length ? kinds : Object.keys(DOCUMENTS);
    return [...new Set(source.map(value=>String(value || '').trim()).filter(value=>DOCUMENTS[value]))];
  }

  function evaluateBsgtManagementReadiness(tradeFile, signedDocuments) {
    const requiredTypes = requiredDocumentTypes(tradeFile);
    const revision = Number(tradeFile?.revision_no) || 1;
    const signedTypes = [...new Set((Array.isArray(signedDocuments) ? signedDocuments : [])
      .filter(document=>document?.is_active !== false && Number(document?.revision_no) === revision)
      .map(document=>document.document_type)
      .filter(type=>requiredTypes.includes(type)))];
    const missingTypes = requiredTypes.filter(type=>!signedTypes.includes(type));
    return Object.freeze({
      requiredTypes:Object.freeze(requiredTypes),
      signedTypes:Object.freeze(signedTypes),
      missingTypes:Object.freeze(missingTypes),
      completed:requiredTypes.length > 0 && missingTypes.length === 0,
      progress:`${signedTypes.length} من ${requiredTypes.length}`
    });
  }

  function statusLabel(status) { return STATUS_LABELS[status] || String(status || '—'); }
  function documentLabel(type) { return DOCUMENTS[type] || String(type || '—'); }
  function mergeAllowed(shipment, tradeFile, signedDocuments) {
    if(!tradeFile) return null;
    return shipment?.bsgtStage === 'final_accepted'
      && tradeFile.status === 'final_accepted'
      && evaluateBsgtManagementReadiness(tradeFile, signedDocuments).completed;
  }

  return Object.freeze({DOCUMENTS, STATUS_LABELS, requiredDocumentTypes, evaluateBsgtManagementReadiness, statusLabel, documentLabel, mergeAllowed});
});
