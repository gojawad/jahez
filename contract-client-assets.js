(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.JahezContractClientAssets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  const BUCKET = 'client-profile-files';
  const DEFAULT_APPROVAL = Object.freeze({
    clientId:null,
    stampFileId:null,
    signatureFileId:null,
    signatoryId:null,
    useStamp:false,
    useSignature:false,
    buyerStampX:56,
    buyerStampY:79,
    buyerStampScale:14,
    buyerSignatureX:58,
    buyerSignatureY:82,
    buyerSignatureScale:18
  });

  function approvalFromRecord(record){
    const saved = record?.clientContractApproval || record?.data?.clientContractApproval || {};
    return Object.assign({}, DEFAULT_APPROVAL, saved);
  }

  function resolveContractClient(options){
    const opts = options || {};
    const consignee = String(opts.record?.consignee || opts.record?.data?.consignee || '').trim();
    const resolver = opts.resolver;
    const client = resolver?.resolveClientForConsignee(opts.clients || [], consignee) || null;
    return {consignee, client};
  }

  function scopeAssets(files, signatories, clientId){
    const scopedFiles = (files || []).filter(file=>
      file?.client_id === clientId && file.is_active === true && ['stamp','signature'].includes(file.file_type)
    );
    const scopedSignatories = (signatories || []).filter(person=>person?.client_id === clientId && person.active === true);
    return {files:scopedFiles, signatories:scopedSignatories};
  }

  function validateApproval(context, input){
    const approval = Object.assign({}, DEFAULT_APPROVAL, input || {});
    const warnings = [];
    if(!context?.client) return {approval, stamp:null, signature:null, signatory:null, warnings:['لم يتم العثور على بروفايل لهذا المرسل إليه.']};
    if(approval.clientId && approval.clientId !== context.client.id){
      warnings.push('اختيارات العميل المحفوظة لا تخص المرسل إليه الحالي، لذلك لم تُستخدم.');
      return {approval, stamp:null, signature:null, signatory:null, warnings};
    }
    const selectedStamp = context.files.find(file=>
      file.id === approval.stampFileId && file.client_id === context.client.id && file.is_active === true && file.file_type === 'stamp'
    ) || null;
    const selectedSignature = context.files.find(file=>
      file.id === approval.signatureFileId && file.client_id === context.client.id && file.is_active === true && file.file_type === 'signature'
    ) || null;
    const stamp = approval.useStamp && selectedStamp?.signedUrl ? selectedStamp : null;
    const signature = approval.useSignature && selectedSignature?.signedUrl ? selectedSignature : null;
    if(approval.stampFileId && !selectedStamp) warnings.push('ختم العميل المحدد مؤرشف أو غير متاح، لذلك لم يُستخدم.');
    if(approval.signatureFileId && !selectedSignature) warnings.push('توقيع العميل المحدد مؤرشف أو غير متاح، لذلك لم يُستخدم.');
    if(selectedStamp && !selectedStamp.signedUrl) warnings.push('تعذر فتح ختم العميل المحدد، لذلك لم يُستخدم.');
    if(selectedSignature && !selectedSignature.signedUrl) warnings.push('تعذر فتح توقيع العميل المحدد، لذلك لم يُستخدم.');
    let signatory = null;
    if(signature?.signatory_id){
      signatory = context.signatories.find(person=>person.id === signature.signatory_id) || null;
      if(!signatory) warnings.push('الشخص المفوض المرتبط بالتوقيع غير نشط أو غير متاح.');
    }
    if(signature && approval.signatoryId && approval.signatoryId !== signature.signatory_id){
      warnings.push('ارتباط الشخص المفوض لا يطابق التوقيع المحدد، لذلك لم يُستخدم التوقيع.');
      return {approval, stamp, signature:null, signatory:null, warnings};
    }
    return {approval, stamp, signature, signatory, warnings};
  }

  function attachRuntime(record, context, input){
    const checked = validateApproval(context, input);
    const runtime = {
      clientId:context?.client?.id || null,
      stampUrl:checked.stamp?.signedUrl || '',
      signatureUrl:checked.signature?.signedUrl || '',
      stampFileId:checked.stamp?.id || null,
      signatureFileId:checked.signature?.id || null,
      signatory:checked.signatory || null,
      warnings:checked.warnings
    };
    if(record){
      Object.defineProperty(record, '__clientContractAssets', {value:runtime,writable:true,configurable:true,enumerable:false});
    }
    return runtime;
  }

  function createSupabaseRepository(supabase){
    return {
      async loadFiles(clientId){
        const {data,error} = await supabase.from('client_profile_files')
          .select('id,client_id,file_type,title,original_name,storage_path,mime_type,is_active,signatory_id')
          .eq('client_id',clientId).eq('is_active',true).in('file_type',['stamp','signature'])
          .order('created_at',{ascending:false});
        if(error) throw error;
        return data || [];
      },
      async loadSignatories(clientId){
        const {data,error} = await supabase.from('client_authorized_signatories')
          .select('id,client_id,name,title,active').eq('client_id',clientId).eq('active',true);
        if(error) throw error;
        return data || [];
      },
      async createSignedUrl(path){
        const {data,error} = await supabase.storage.from(BUCKET).createSignedUrl(path,600);
        if(error) throw error;
        return data?.signedUrl || '';
      }
    };
  }

  async function loadContractClientAssets(options){
    const opts = options || {};
    const resolved = resolveContractClient(opts);
    if(!resolved.client){
      const context = {consignee:resolved.consignee,client:null,files:[],signatories:[],warnings:['لم يتم العثور على بروفايل لهذا المرسل إليه.']};
      attachRuntime(opts.record, context, approvalFromRecord(opts.record));
      return context;
    }
    const repository = opts.repository || createSupabaseRepository(opts.supabase);
    const [rawFiles, rawSignatories] = await Promise.all([
      repository.loadFiles(resolved.client.id),
      repository.loadSignatories(resolved.client.id)
    ]);
    const scoped = scopeAssets(rawFiles, rawSignatories, resolved.client.id);
    const files = await Promise.all(scoped.files.map(async file=>{
      try{ return Object.assign({}, file, {signedUrl:await repository.createSignedUrl(file.storage_path)}); }
      catch(error){ return Object.assign({}, file, {signedUrl:'', signedUrlError:error?.message || String(error)}); }
    }));
    const context = {consignee:resolved.consignee,client:resolved.client,files,signatories:scoped.signatories,warnings:[]};
    const checked = validateApproval(context, approvalFromRecord(opts.record));
    context.warnings = checked.warnings;
    attachRuntime(opts.record, context, checked.approval);
    return context;
  }

  return Object.freeze({
    BUCKET,
    DEFAULT_APPROVAL,
    approvalFromRecord,
    resolveContractClient,
    scopeAssets,
    validateApproval,
    attachRuntime,
    createSupabaseRepository,
    loadContractClientAssets
  });
});
