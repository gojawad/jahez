(function(){
  'use strict';
  let busy=false;
  async function rpc(name,args){const {data,error}=await sb.rpc(name,args);if(error)throw error;return data;}
  function base64(bytes){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
  async function load(){
    const context=await rpc('get_bsgt_finance_context',{p_context_id:requestedFinanceContext});
    state.shipments=context.shipments.map(entry=>rowToShipment(entry.shipment));
    state.selected=new Set(state.shipments.map(s=>s.id));state.payments={};
    const {data:payments,error}=await sb.from('payments').select('*').in('shipment_id',state.shipments.map(s=>s.id)).order('paid_on');
    if(error)throw error;
    (payments||[]).forEach(payment=>(state.payments[payment.shipment_id]??=[]).push(payment));
    if(context.tradeFileId){
      const result=await rpc('bsgt_internal_package',{p_file_id:context.tradeFileId});
      state.tradeFile=result.file;state.activeOperationNo=result.file.operation_no;
      if(result.file.metadata?.documentSettings)Object.assign(state.settings,result.file.metadata.documentSettings);
      if(result.file.remitting_bank)state.settings.remittingBank=result.file.remitting_bank;
      state.convertToAed=!!result.file.metadata?.convertToAed;
      state.exchangeRate=Number(result.file.metadata?.exchangeRate)||state.exchangeRate;
    }
    document.body.classList.add('trade-file-context');
    // Same as loadTradeFileContext(): finance staff must see and fill section 03
    // (بيانات الإرسال للبنك المُرسل) before sending; only the list manager stays admin-only.
    for(const selector of ['[data-step-section="settings-section"]','.settings-section'])document.querySelector?.(selector)?.classList.remove('admin-document-settings');
  }
  async function send(){
    if(busy)return;
    if(!confirm('سيتم حفظ نسخ جديدة من مستندات التحصيل الثلاثة ثم إرسال الملف للإدارة عبر البنك المرسل. هل تؤكد؟'))return;
    busy=true;
    const buttons=[$('compactRecordCollectionBtn'),$('recordCollectionBtn')].filter(Boolean);buttons.forEach(b=>b.disabled=true);
    try{
      const context=await rpc('get_bsgt_finance_context',{p_context_id:requestedFinanceContext});
      if(context.readOnly)throw new Error('تم إرسال الملف وأصبح للقراءة فقط.');
      const {rows,currencies}=detected();
      if(currencies.length!==1)throw new Error('أرسل كل عملة في ملف مستقل.');
      const total=collectionTotal(rows);
      if(state.convertToAed&&!(Number(state.exchangeRate)>0))throw new Error('أدخل سعر صرف صحيحاً.');
      const selected=selectedShipments().map(s=>s.id).sort(),expected=context.shipments.map(s=>s.shipment.id).sort();
      if(JSON.stringify(selected)!==JSON.stringify(expected))throw new Error('عدّل اختيار الشحنات من المالية أولاً، ثم افتح بوابة التحصيل مجددًا.');
      state.tradeFile=await rpc('open_bsgt_finance_context_trade_file',{p_context_id:requestedFinanceContext});
      state.tradeFile=await rpc('refresh_bsgt_finance_revision',{p_context_id:requestedFinanceContext});
      state.activeOperationNo=state.tradeFile.operation_no;
      const generated={};for(const kind of collectionDocumentKinds())generated[kind]=base64(new Uint8Array(await CollectionHtmlTemplates.exportPdf(kind)));
      const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error('سجّل الدخول أولاً.');
      const response=await fetch('/api/bsgt-internal-document',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action:'finance',contextId:requestedFinanceContext,revisionNo:state.tradeFile.revision_no,settings:state.settings,generated})});
      const saved=await response.json();if(!response.ok)throw new Error(saved.error);state.tradeFile=saved.file;
      state.tradeFile=await rpc('send_bsgt_trade_file_to_remitting',{p_trade_file_id:state.tradeFile.id,p_remitting_bank:state.settings.remittingBank,
        p_metadata:{documentSettings:{...state.settings},documentKinds:collectionDocumentKinds(),amountSnapshot:total.number,currency:total.currency,shipmentNumbers:rows.map(row=>row.shipmentNo),convertToAed:state.convertToAed,exchangeRate:state.exchangeRate,qrIncluded:false}});
      state.shipments=state.shipments.map(s=>({...s,bsgtStage:'sent_to_remitting'}));renderAll();
      showCollectionNotice('حُفظت مستندات المالية وأُرسل الملف للإدارة. حزمة العمليات ورمز QR لم يتغيرا.');
    }catch(error){alert(error.message||'تعذر إرسال الملف.');}
    finally{busy=false;buttons.forEach(b=>b.disabled=state.tradeFile?.status==='sent_to_remitting');}
  }
  window.CollectionRevisionContext={load,send};
})();
