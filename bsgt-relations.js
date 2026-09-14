(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JahezBsgtRelations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ATTACHMENTS = Object.freeze({
    company_letter: 'خطاب الشركة',
    signed_stamped_letterhead: 'ترويسة الشركة موقعة ومختومة'
  });
  const STATUS_LABELS = Object.freeze({
    final_accepted: 'مقبول نهائياً — جاهز للعلاقات التجارية',
    sent_to_collecting: 'تم الإرسال للبنك المحصل'
  });
  const ALLOWED_MIME_TYPES = Object.freeze(['application/pdf', 'image/png', 'image/jpeg']);
  const MAX_FILE_SIZE = 15 * 1024 * 1024;

  function evaluateBsgtRelationsAttachments(shipments, attachments, revisionNo) {
    const rows = Array.isArray(shipments) ? shipments : [];
    const revision = Number(revisionNo) || 1;
    const shipmentIds = new Set(rows.map(row=>row.id));
    const active = new Set((Array.isArray(attachments) ? attachments : [])
      .filter(item => item?.is_active !== false && Number(item?.revision_no) === revision)
      .filter(item => item.shipment_id == null || shipmentIds.has(item.shipment_id))
      .map(item => item.attachment_type));
    // Legacy shipment attachments remain in place and count once for the case.
    const warnings = [];
    const companyLetter = active.has('company_letter');
    const signedStampedLetterhead = active.has('signed_stamped_letterhead');
    for(const type of Object.keys(ATTACHMENTS)){
      if(!active.has(type))warnings.push(Object.freeze({type,label:ATTACHMENTS[type]}));
    }
    const shipmentStates = rows.map(shipment => {
      const shipmentId = shipment?.id;
      return Object.freeze({shipmentId, companyLetter, signedStampedLetterhead});
    });
    return Object.freeze({
      shipments:Object.freeze(shipmentStates),
      missingOptionalCount:warnings.length,
      warnings:Object.freeze(warnings)
    });
  }

  function validateAttachmentFile(file) {
    if (!file) return Object.freeze({valid:false, message:'اختر الملف أولاً.'});
    if (!ALLOWED_MIME_TYPES.includes(String(file.type || '').toLowerCase())) {
      return Object.freeze({valid:false, message:'المسموح PDF أو PNG أو JPG فقط.'});
    }
    if (Number(file.size) > MAX_FILE_SIZE) {
      return Object.freeze({valid:false, message:'حجم الملف يجب ألا يتجاوز 15 ميجابايت.'});
    }
    return Object.freeze({valid:true, message:''});
  }

  function statusLabel(status) { return STATUS_LABELS[status] || String(status || '—'); }
  function attachmentLabel(type) { return ATTACHMENTS[type] || String(type || '—'); }

  return Object.freeze({
    ATTACHMENTS,
    STATUS_LABELS,
    ALLOWED_MIME_TYPES,
    MAX_FILE_SIZE,
    evaluateBsgtRelationsAttachments,
    validateAttachmentFile,
    statusLabel,
    attachmentLabel
  });
});
