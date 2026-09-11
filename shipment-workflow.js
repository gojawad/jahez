(function initJahezShipmentWorkflow(global) {
  'use strict';

  const STAGES = Object.freeze(['created', 'bank_sent', 'signed', 'accepted']);
  const STAGE_SET = new Set(STAGES);
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

  global.JahezShipmentWorkflow = Object.freeze({
    STAGES,
    normalizeStage,
    inferStage,
    fromRow,
    toRow,
    bankSentFields
  });
})(window);
