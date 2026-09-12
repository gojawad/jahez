(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JahezBsgtOperations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STAGES = Object.freeze({
    operations_draft: 'مسودة',
    ready_for_finance: 'جاهزة للمالية'
  });

  const DOCUMENT_TYPES = Object.freeze({
    importPermit: 'import_permit',
    certificateOfOrigin: 'certificate_of_origin',
    billOfLading: 'bill_of_lading',
    optionalAttachment: 'optional_attachment'
  });

  const LEGACY_LABELS = Object.freeze({
    importPermit: ['إذن الاستيراد'],
    certificateOfOrigin: ['شهادة المنشأ', 'شهادة المنشأ (بحر سواكن)'],
    billOfLading: ['بوليصة الشحن', 'بوليصة الشحن (بحر سواكن)']
  });

  const GENERATED_LABELS = Object.freeze({
    contract: 'العقد',
    proforma: 'الفاتورة المبدئية',
    invoice: 'الفاتورة النهائية',
    packing: 'Packing List'
  });

  const UPLOADED_LABELS = Object.freeze({
    importPermit: 'إذن الاستيراد',
    certificateOfOrigin: 'شهادة المنشأ',
    billOfLading: 'بوليصة الشحن'
  });

  function hasValue(value) {
    return String(value || '').trim().length > 0;
  }

  function generatedReadiness(shipment) {
    const row = shipment || {};
    return Object.freeze({
      contract: hasValue(row.operationNo) && hasValue(row.consignee) && hasValue(row.itemDesc),
      proforma: hasValue(row.proformaNo),
      invoice: hasValue(row.invoiceNo),
      packing: hasValue(row.invoiceNo)
    });
  }

  function fileType(file) {
    return String(file?.document_type || file?.documentType || '').trim().toLowerCase();
  }

  function hasDocument(documents, key) {
    const expected = DOCUMENT_TYPES[key];
    const legacy = LEGACY_LABELS[key] || [];
    return (Array.isArray(documents) ? documents : []).some(file =>
      fileType(file) === expected || legacy.includes(String(file?.label || '').trim())
    );
  }

  function evaluateBsgtOperationsReadiness(shipment, documents) {
    const files = Array.isArray(documents) ? documents : [];
    const generated = generatedReadiness(shipment);
    const uploaded = Object.freeze({
      importPermit: hasDocument(files, 'importPermit'),
      certificateOfOrigin: hasDocument(files, 'certificateOfOrigin'),
      billOfLading: hasDocument(files, 'billOfLading')
    });
    const optionalCount = files.filter(file => fileType(file) === DOCUMENT_TYPES.optionalAttachment).length;
    const missing = [];
    Object.keys(generated).forEach(key => {
      if (!generated[key]) missing.push(GENERATED_LABELS[key]);
    });
    Object.keys(uploaded).forEach(key => {
      if (!uploaded[key]) missing.push(UPLOADED_LABELS[key]);
    });
    const generatedCount = Object.values(generated).filter(Boolean).length;
    const uploadedCount = Object.values(uploaded).filter(Boolean).length;
    return Object.freeze({
      generated,
      uploaded,
      optionalCount,
      missing: Object.freeze(missing),
      generatedCount,
      uploadedCount,
      completedCount: generatedCount + uploadedCount,
      completed: missing.length === 0
    });
  }

  function stageLabel(stage) {
    return STAGES[stage] || STAGES.operations_draft;
  }

  function isSupportedFile(file) {
    const name = String(file?.name || '');
    const mime = String(file?.type || file?.mime || '').toLowerCase();
    return ['application/pdf', 'image/png', 'image/jpeg'].includes(mime) || /\.(pdf|png|jpe?g)$/i.test(name);
  }

  return Object.freeze({
    STAGES,
    DOCUMENT_TYPES,
    GENERATED_LABELS,
    UPLOADED_LABELS,
    generatedReadiness,
    hasDocument,
    evaluateBsgtOperationsReadiness,
    stageLabel,
    isSupportedFile
  });
});
