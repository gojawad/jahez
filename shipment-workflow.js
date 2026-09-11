(function initJahezShipmentWorkflow(global) {
  'use strict';

  const STAGES = Object.freeze(['created', 'bank_sent', 'signed', 'accepted']);
  const STAGE_SET = new Set(STAGES);
  const SIGNED_DOCUMENT_TYPES = Object.freeze(['letter', 'undertaking', 'exchange']);
  const SIGNED_DOCUMENT_TYPE_SET = new Set(SIGNED_DOCUMENT_TYPES);
  const FIELD_MAP = Object.freeze({
    workflowUpdatedAt: 'workflow_updated_at',
    bankSentAt: 'bank_sent_at',
    signedAt: 'signed_at',
    acceptedAt: 'accepted_at',
    acceptedBy: 'accepted_by'
  });

  function normalizeStage(value) {
    const stage = String(value || '').trim().toLowerCase();
    return STAGE_SET.has(stage) ? stage : 'created';
  }

  function inferStage(row) {
    if(row && row.workflow_stage) return normalizeStage(row.workflow_stage);
    const data = row && row.data && typeof row.data === 'object' ? row.data : {};
    return data.collectionStatus === 'sent' || data.collectionSentAt ? 'bank_sent' : 'created';
  }

  function fromRow(row) {
    const source = row || {};
    const fields = {workflowStage: inferStage(source)};
    Object.entries(FIELD_MAP).forEach(([recordKey, rowKey])=>{
      fields[recordKey] = source[rowKey] || '';
    });
    return fields;
  }

  function toRow(record) {
    const source = record || {};
    const fields = {};
    if(source.workflowStage !== undefined){
      fields.workflow_stage = normalizeStage(source.workflowStage);
    }
    Object.entries(FIELD_MAP).forEach(([recordKey, rowKey])=>{
      if(source[recordKey] !== undefined){
        fields[rowKey] = source[recordKey] || null;
      }
    });
    return fields;
  }

  function bankSentFields(sentAt) {
    const timestamp = sentAt || new Date().toISOString();
    return {
      workflow_stage: 'bank_sent',
      workflow_updated_at: timestamp,
      bank_sent_at: timestamp
    };
  }

  function normalizeSignedDocumentTypes(value) {
    const source = Array.isArray(value) ? value : [];
    return Array.from(new Set(source.map(item=>String(item || '').trim().toLowerCase())
      .filter(item=>SIGNED_DOCUMENT_TYPE_SET.has(item))));
  }

  function latestSentCollectionOperation(record) {
    const operations = Array.isArray(record && record.commercialCollectionOperations)
      ? record.commercialCollectionOperations
      : [];
    return operations.reduce((latest, operation, index)=>{
      if(!operation || String(operation.status || '').toLowerCase() !== 'sent') return latest;
      const timestamp = Date.parse(operation.sentAt || operation.completedAt || '') || 0;
      if(!latest || timestamp > latest.timestamp || (timestamp === latest.timestamp && index > latest.index)){
        return {operation, timestamp, index};
      }
      return latest;
    }, null)?.operation || null;
  }

  function requiredSignedDocumentTypes(record) {
    const latestOperation = latestSentCollectionOperation(record);
    const operationTypes = normalizeSignedDocumentTypes(latestOperation && latestOperation.documentKinds);
    if(operationTypes.length) return operationTypes;
    return normalizeSignedDocumentTypes(record && record.collectionDocumentKinds);
  }

  function signedFileType(file) {
    return String((file && (file.document_type || file.documentType)) || '').trim().toLowerCase();
  }

  function signedFileStatus(file) {
    return String((file && (file.signature_status || file.signatureStatus)) || 'uploaded').trim().toLowerCase();
  }

  function signedFileTimestamp(file) {
    return Date.parse((file && (file.created_at || file.createdAt || file.signed_at || file.signedAt)) || '') || 0;
  }

  function evaluateShipmentSigning(record, files) {
    const requiredTypes = requiredSignedDocumentTypes(record);
    const activeSignedFiles = {};
    (Array.isArray(files) ? files : []).forEach(file=>{
      const type = signedFileType(file);
      if(!SIGNED_DOCUMENT_TYPE_SET.has(type) || signedFileStatus(file) !== 'signed') return;
      const current = activeSignedFiles[type];
      if(!current || signedFileTimestamp(file) >= signedFileTimestamp(current)) activeSignedFiles[type] = file;
    });
    const signedTypes = requiredTypes.filter(type=>activeSignedFiles[type]);
    const missingTypes = requiredTypes.filter(type=>!activeSignedFiles[type]);
    return {
      requiredTypes,
      signedTypes,
      missingTypes,
      activeSignedFiles,
      completed: requiredTypes.length > 0 && missingTypes.length === 0,
      progress: {completed:signedTypes.length, total:requiredTypes.length}
    };
  }

  function signedFields(signedAt) {
    const timestamp = signedAt || new Date().toISOString();
    return {
      workflow_stage: 'signed',
      workflow_updated_at: timestamp,
      signed_at: timestamp
    };
  }

  function signingSyncFields(record, files, changedAt) {
    const stage = normalizeStage(record && (record.workflowStage || record.workflow_stage));
    if(stage === 'accepted' || stage === 'created') return null;
    const evaluation = evaluateShipmentSigning(record, files);
    if(stage === 'bank_sent' && evaluation.completed) return signedFields(changedAt);
    if(stage === 'signed' && !evaluation.completed){
      return {
        workflow_stage: 'bank_sent',
        workflow_updated_at: changedAt || new Date().toISOString(),
        signed_at: null
      };
    }
    return null;
  }

  function canAcceptShipment(record, files) {
    const stage = normalizeStage(record && (record.workflowStage || record.workflow_stage));
    return stage === 'signed' && evaluateShipmentSigning(record, files).completed;
  }

  function acceptedFields(userId, acceptedAt) {
    const acceptedBy = String(userId || '').trim();
    if(!acceptedBy) throw new TypeError('accepted user is required');
    const timestamp = acceptedAt || new Date().toISOString();
    return {
      workflow_stage: 'accepted',
      workflow_updated_at: timestamp,
      accepted_at: timestamp,
      accepted_by: acceptedBy
    };
  }

  function canMergeShipmentPackage(record, files) {
    const stage = normalizeStage(record && (record.workflowStage || record.workflow_stage));
    return stage === 'accepted' && evaluateShipmentSigning(record, files).completed;
  }

  function packageMergeBlockReason(record, files) {
    const stage = normalizeStage(record && (record.workflowStage || record.workflow_stage));
    if(stage === 'created') return 'يجب إرسال الشحنة للبنك أولاً.';
    if(stage === 'bank_sent') return 'بانتظار اكتمال المستندات الموقعة.';
    if(stage === 'signed') return 'تم توقيع جميع المستندات، لكن لم يتم قبولها بعد.';
    if(!evaluateShipmentSigning(record, files).completed) return 'المستندات الموقعة المطلوبة غير مكتملة.';
    return 'الشحنة مكتملة ويمكن دمج الحزمة.';
  }

  global.JahezShipmentWorkflow = Object.freeze({
    STAGES,
    SIGNED_DOCUMENT_TYPES,
    normalizeStage,
    inferStage,
    fromRow,
    toRow,
    bankSentFields,
    normalizeSignedDocumentTypes,
    latestSentCollectionOperation,
    requiredSignedDocumentTypes,
    evaluateShipmentSigning,
    signedFields,
    signingSyncFields,
    canAcceptShipment,
    acceptedFields,
    canMergeShipmentPackage,
    packageMergeBlockReason
  });
})(window);
