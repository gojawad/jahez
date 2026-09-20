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
    // CAD / paid-in-advance files carry no collection documents at all.
    if (String(tradeFile?.metadata?.collectionMode || '') === 'cad') return [];
    const kinds = tradeFile?.metadata?.documentKinds;
    const source = Array.isArray(kinds) && kinds.length ? kinds : Object.keys(DOCUMENTS);
    return [...new Set(source.map(value=>String(value || '').trim()).filter(value=>DOCUMENTS[value]))];
  }

  function evaluateBsgtManagementReadiness(tradeFile, signedDocuments) {
    const requiredTypes = requiredDocumentTypes(tradeFile);
    const revision = Number(tradeFile?.revision_no) || 1;
    const signedTypes = [...new Set((Array.isArray(signedDocuments) ? signedDocuments : [])
      .filter(document=>document?.is_active !== false && Number(document?.revision_no) === revision)
      .filter(document=>tradeFile?.metadata?.operationsRevisionWorkflow
        ? document.document_variant === 'finance_original'
        : !document.document_variant || document.document_variant === 'legacy_signed')
      .map(document=>document.document_type)
      .filter(type=>requiredTypes.includes(type)))];
    const missingTypes = requiredTypes.filter(type=>!signedTypes.includes(type));
    return Object.freeze({
      requiredTypes:Object.freeze(requiredTypes),
      signedTypes:Object.freeze(signedTypes),
      missingTypes:Object.freeze(missingTypes),
      // Revision-based collection files still require their finance originals,
      // but signatures are optional in both current and legacy workflows.
      completed:!tradeFile?.metadata?.operationsRevisionWorkflow || missingTypes.length === 0,
      progress:'التوقيع اختياري'
    });
  }

  function statusLabel(status) { return STATUS_LABELS[status] || String(status || '—'); }
  function documentLabel(type) { return DOCUMENTS[type] || String(type || '—'); }
  function mergeAllowed(shipment, tradeFile, signedDocuments) {
    if(!tradeFile) return null;
    const acceptedStages = new Set(['final_accepted', 'sent_to_collecting']);
    return acceptedStages.has(shipment?.bsgtStage)
      && acceptedStages.has(tradeFile.status)
      && evaluateBsgtManagementReadiness(tradeFile, signedDocuments).completed;
  }

  return Object.freeze({DOCUMENTS, STATUS_LABELS, requiredDocumentTypes, evaluateBsgtManagementReadiness, statusLabel, documentLabel, mergeAllowed});
});
