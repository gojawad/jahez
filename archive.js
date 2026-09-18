/* Archive (no delete) for test / non-operational shipments and trade files.
   Archived rows stay in the database with every document, event and QR link;
   lists simply exclude them (archived_at is null). Requires supabase/50_bsgt_archive.sql;
   until that migration runs, the column probe fails and every filter is skipped. */
(function(){
  'use strict';
  let supported=null, probe=null;
  const esc=value=>(typeof escapeHtml==='function'?escapeHtml(String(value??'')):String(value??''));

  async function ready(){
    if(supported!==null) return supported;
    if(!probe){
      probe=(async()=>{
        try{
          const {error}=await sb.from('shipments').select('archived_at').limit(1);
          supported=!error;
          if(error) console.warn('archive: column archived_at is not available yet — run supabase/50_bsgt_archive.sql', error.message);
        }catch(error){ supported=false; }
        return supported;
      })();
    }
    return probe;
  }
  function isSupported(){ return supported===true; }
  // query: a PostgREST builder on shipments / trade_collection_files.
  function active(query){ return isSupported() ? query.is('archived_at',null) : query; }
  function archivedOnly(query){ return query.not('archived_at','is',null); }
  function canArchive(){ return Boolean(window.JahezPermissions?.can('shipments.delete')); }

  async function setArchive(kind,id,archived){
    if(!canArchive()) throw new Error('ليس لديك صلاحية الأرشفة.');
    const {data,error}=await sb.rpc('set_bsgt_archive',{p_kind:kind,p_id:id,p_archived:archived!==false});
    if(error) throw error;
    return data;
  }

  // Shipment archive from the shipment page: confirm, call, drop from the loaded records, refresh views.
  async function archiveShipmentFromDetail(id,button){
    const record=(typeof records!=='undefined'?records:[]).find(row=>row.id===id);
    const label=record?.operationNo||record?.itemDesc||'الشحنة';
    if(!confirm(`أرشفة ${label}؟\n\nلن يُحذف أي شيء: الشحنة ومستنداتها وملفها التجاري وسجلها ورابط QR تبقى محفوظة، لكنها تختفي من القوائم والحسابات. يمكنك استعادتها من «الأرشيف» في أي وقت.`)) return false;
    if(button){ button.disabled=true; }
    try{
      netStart();
      const result=await setArchive('shipment',id,true);
      if(typeof records!=='undefined'){ records=records.filter(row=>row.id!==id); }
      const linked=Array.isArray(result?.tradeFileIds)?result.tradeFileIds.length:0;
      toast(`تمت أرشفة ${label}${linked?' وتم تحديث ملفها التجاري':''}.`);
      addLog?.('del',`أرشفة شحنة: ${label}`);
      return true;
    }catch(error){
      console.error('archive shipment',error);
      toast(error.message||'تعذرت الأرشفة.','err');
      if(button) button.disabled=false;
      return false;
    }finally{ netEnd(); }
  }

  // Archive browser (shipments): lists archived shipments with restore.
  async function openArchiveModal(){
    const modal=document.getElementById('jahezArchiveModal'), list=document.getElementById('jahezArchiveList');
    if(!modal||!list) return;
    modal.hidden=false; list.innerHTML='<div class="jahez-archive-empty">جاري تحميل الأرشيف…</div>';
    await ready();
    if(!isSupported()){ list.innerHTML='<div class="jahez-archive-empty">الأرشفة غير مفعّلة بعد في قاعدة البيانات (شغّل ملف supabase/50_bsgt_archive.sql).</div>'; return; }
    try{
      const {data,error}=await archivedOnly(sb.from('shipments').select('id,company_id,archived_at,archived_by,data,created_at')).order('archived_at',{ascending:false}).limit(500);
      if(error) throw error;
      const rows=data||[];
      const actorIds=[...new Set(rows.map(row=>row.archived_by).filter(Boolean))]; let profiles=[];
      if(actorIds.length){ const result=await sb.from('profiles').select('id,display_name,email').in('id',actorIds); profiles=result.data||[]; }
      const actor=id=>{ const row=profiles.find(item=>item.id===id); return row?.display_name||row?.email||'—'; };
      if(!rows.length){ list.innerHTML='<div class="jahez-archive-empty">لا توجد شحنات مؤرشفة.</div>'; return; }
      list.innerHTML=rows.map(row=>{
        const d=row.data||{};
        return `<article class="jahez-archive-row"><div><b dir="auto">${esc(d.operationNo||d.invoiceNo||row.id.slice(0,8))}</b><small dir="auto">${esc(d.consignee||d.exporter||'')}${d.itemDesc?` · ${esc(d.itemDesc)}`:''}</small><small>أُرشفت ${esc(typeof formatShipmentAuditDate==='function'?formatShipmentAuditDate(row.archived_at):row.archived_at)} · بواسطة ${esc(actor(row.archived_by))}</small></div>${canArchive()?`<button type="button" class="btn btn-ghost btn-small" data-jahez-unarchive="${esc(row.id)}">${icon('refresh',14)} إلغاء الأرشفة</button>`:''}</article>`;
      }).join('');
      list.querySelectorAll('[data-jahez-unarchive]').forEach(button=>button.addEventListener('click',async()=>{
        if(!confirm('إلغاء أرشفة هذه الشحنة وإرجاعها إلى القوائم والحسابات؟')) return;
        button.disabled=true;
        try{
          netStart();
          await setArchive('shipment',button.dataset.jahezUnarchive,false);
          toast('تمت استعادة الشحنة.');
          await loadRecords(); render?.(); renderDrafts?.(); renderIssued?.(); renderSea?.(); renderDashboard?.();
          await openArchiveModal();
        }catch(error){ console.error('unarchive shipment',error); toast(error.message||'تعذرت الاستعادة.','err'); button.disabled=false; }
        finally{ netEnd(); }
      }));
    }catch(error){ console.error('load archive',error); list.innerHTML=`<div class="jahez-archive-empty">تعذر تحميل الأرشيف: ${esc(error.message||'')}</div>`; }
  }
  function closeArchiveModal(){ const modal=document.getElementById('jahezArchiveModal'); if(modal) modal.hidden=true; }

  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('archiveBtn')?.addEventListener('click',openArchiveModal);
    document.getElementById('jahezArchiveClose')?.addEventListener('click',closeArchiveModal);
    document.getElementById('jahezArchiveModal')?.addEventListener('click',event=>{ if(event.target.id==='jahezArchiveModal') closeArchiveModal(); });
  });

  window.JahezArchive={ready,isSupported,active,archivedOnly,canArchive,setArchive,archiveShipmentFromDetail,openArchiveModal,closeArchiveModal};
})();
