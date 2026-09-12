(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JahezBsgtOperations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STAGES = Object.freeze({
    operations_draft: 'مسودة',
    ready_for_finance: 'جاهزة للمالية',
    sent_to_remitting: 'تم الإرسال للبنك المرسل',
    management_review: 'قيد مراجعة الإدارة',
    final_accepted: 'القبول النهائي',
    sent_to_collecting: 'تم الإرسال للبنك المحصل'
  });

  const BUSINESS_STAGES = Object.freeze([
    Object.freeze({key:'operations', label:'العمليات'}),
    Object.freeze({key:'finance', label:'المالية'}),
    Object.freeze({key:'management', label:'الإدارة'}),
    Object.freeze({key:'relations', label:'العلاقات التجارية'})
  ]);

  const WORKFLOW_PRESENTATION = Object.freeze({
    operations_draft: Object.freeze({currentIndex:0, completedCount:0, detailLabel:'مسودة', allCompleted:false}),
    ready_for_finance: Object.freeze({currentIndex:1, completedCount:1, detailLabel:'جاهزة للمالية', allCompleted:false}),
    sent_to_remitting: Object.freeze({currentIndex:2, completedCount:2, detailLabel:'تم الإرسال للبنك المرسل', allCompleted:false}),
    management_review: Object.freeze({currentIndex:2, completedCount:2, detailLabel:'قيد مراجعة الإدارة', allCompleted:false}),
    final_accepted: Object.freeze({currentIndex:3, completedCount:3, detailLabel:'القبول النهائي · جاهزة للإرسال', allCompleted:false}),
    sent_to_collecting: Object.freeze({currentIndex:null, completedCount:4, detailLabel:'تم الإرسال للبنك المحصل', allCompleted:true})
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

  const DELETABLE_DOCUMENT_TYPES = Object.freeze(Object.values(DOCUMENT_TYPES));

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

  function workflowPresentation(stage) {
    const technicalStage = Object.prototype.hasOwnProperty.call(WORKFLOW_PRESENTATION, stage) ? stage : 'operations_draft';
    return Object.freeze({
      technicalStage,
      ...WORKFLOW_PRESENTATION[technicalStage]
    });
  }

  function isSupportedFile(file) {
    const name = String(file?.name || '');
    const mime = String(file?.type || file?.mime || '').toLowerCase();
    return ['application/pdf', 'image/png', 'image/jpeg'].includes(mime) || /\.(pdf|png|jpe?g)$/i.test(name);
  }

  function isUploadedOperationsDocument(file) {
    const type = fileType(file);
    if (DELETABLE_DOCUMENT_TYPES.includes(type)) return true;
    const label = String(file?.label || '').trim();
    return Object.values(LEGACY_LABELS).flat().includes(label) || label === 'ملف إضافي اختياري';
  }

  function canEditUploadedDocuments(shipment, hasEditPermission) {
    const stage = String(shipment?.bsgtStage || shipment?.bsgt_stage || '').trim();
    return hasEditPermission === true && stage === 'operations_draft';
  }

  function canDeleteUploadedDocument(shipment, file, hasEditPermission) {
    return canEditUploadedDocuments(shipment, hasEditPermission) && isUploadedOperationsDocument(file);
  }

  return Object.freeze({
    STAGES,
    BUSINESS_STAGES,
    WORKFLOW_PRESENTATION,
    DOCUMENT_TYPES,
    GENERATED_LABELS,
    UPLOADED_LABELS,
    DELETABLE_DOCUMENT_TYPES,
    generatedReadiness,
    hasDocument,
    evaluateBsgtOperationsReadiness,
    stageLabel,
    workflowPresentation,
    isSupportedFile,
    isUploadedOperationsDocument,
    canEditUploadedDocuments,
    canDeleteUploadedDocument
  });
});
