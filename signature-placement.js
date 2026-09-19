/* Default placement (position + size on an A4 page) for a saved stamp or signature.
   Stored as fractions of the page in the file's metadata.placement = {x, y, width};
   the signing viewer applies it when the asset is fetched automatically. */
(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.JahezSignaturePlacement = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const DEFAULTS=Object.freeze({stamp:{x:.62,y:.72,width:.18},signature:{x:.14,y:.76,width:.2}});
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  function normalize(input,type){
    const base=DEFAULTS[type]||DEFAULTS.stamp, p=input&&typeof input==='object'?input:{};
    const width=Number.isFinite(Number(p.width))?clamp(Number(p.width),.03,.9):base.width;
    return {x:Number.isFinite(Number(p.x))?clamp(Number(p.x),0,1-width):base.x, y:Number.isFinite(Number(p.y))?clamp(Number(p.y),0,.97):base.y, width};
  }
  function fromMetadata(file){ const p=file?.metadata?.placement; return p&&typeof p==='object'&&Number.isFinite(Number(p.width))?normalize(p,file.file_type):null; }

  // Opens an A4 preview where the image is dragged / resized. Resolves with {x,y,width} or null.
  function open({imageUrl,type,placement,title}){
    return new Promise(resolve=>{
      const current=normalize(placement,type);
      const node=document.createElement('dialog'); node.className='bsgt-management-modal-card jahez-placement-dialog';
      node.style.cssText='max-width:min(720px,95vw);width:95vw;max-height:94dvh;overflow:auto;border:1px solid #e5e7eb;border-radius:16px;padding:18px';
      node.innerHTML=`<header style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h3 style="margin:0">${title||'ضبط الموضع والحجم الافتراضي'}</h3><button type="button" class="btn btn-ghost" data-close>إغلاق</button></header>
        <p style="margin:8px 0 12px;color:#667085;font-size:12px">اسحب الصورة إلى موضعها على الصفحة، وغيّر حجمها من المقبض الأحمر أو الحقول. يُطبَّق تلقائياً عند الاستجلاب في نافذة التوقيع لكل المستندات.</p>
        <div class="jahez-placement-controls"><label>العرض % <input data-width type="number" min="3" max="90" step="0.5"></label><label>من اليسار % <input data-x type="number" min="0" max="100" step="0.5"></label><label>من الأعلى % <input data-y type="number" min="0" max="100" step="0.5"></label><button type="button" class="btn btn-ghost btn-small" data-reset>الافتراضي</button></div>
        <div data-sheet class="jahez-placement-sheet"><img data-image alt="" draggable="false"><span data-handle class="jahez-placement-handle" title="اسحب لتغيير الحجم"></span></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button type="button" class="btn btn-ghost" data-cancel>إلغاء</button><button type="button" class="btn btn-primary" data-save>حفظ الإعداد</button></div>`;
      document.body.append(node);
      const sheet=node.querySelector('[data-sheet]'),img=node.querySelector('[data-image]'),handle=node.querySelector('[data-handle]');
      const inputs={width:node.querySelector('[data-width]'),x:node.querySelector('[data-x]'),y:node.querySelector('[data-y]')};
      let ratio=1,result=null;
      const apply=()=>{
        const rect=sheet.getBoundingClientRect();
        img.style.left=`${current.x*100}%`;img.style.top=`${current.y*100}%`;img.style.width=`${current.width*100}%`;
        const height=current.width*ratio*rect.width/rect.height;
        handle.style.left=`calc(${(current.x+current.width)*100}% - 8px)`;handle.style.top=`calc(${(current.y+height)*100}% - 8px)`;
        inputs.width.value=(current.width*100).toFixed(1);inputs.x.value=(current.x*100).toFixed(1);inputs.y.value=(current.y*100).toFixed(1);
      };
      img.onload=()=>{ratio=img.naturalHeight/img.naturalWidth||1;apply();};
      img.src=imageUrl;
      img.onpointerdown=event=>{
        event.preventDefault();const rect=sheet.getBoundingClientRect(),startX=event.clientX,startY=event.clientY,x=current.x,y=current.y;
        img.setPointerCapture(event.pointerId);
        img.onpointermove=e=>{current.x=clamp(x+(e.clientX-startX)/rect.width,0,1-current.width);current.y=clamp(y+(e.clientY-startY)/rect.height,0,.97);apply();};
        img.onpointerup=()=>{img.onpointermove=null;};
      };
      handle.onpointerdown=event=>{
        event.preventDefault();const rect=sheet.getBoundingClientRect(),startX=event.clientX,base=current.width;
        handle.setPointerCapture(event.pointerId);
        handle.onpointermove=e=>{current.width=clamp(base+(e.clientX-startX)/rect.width,.03,1-current.x);apply();};
        handle.onpointerup=()=>{handle.onpointermove=null;};
      };
      inputs.width.oninput=()=>{current.width=clamp(Number(inputs.width.value)/100||current.width,.03,1-current.x);apply();};
      inputs.x.oninput=()=>{current.x=clamp(Number(inputs.x.value)/100||0,0,1-current.width);apply();};
      inputs.y.oninput=()=>{current.y=clamp(Number(inputs.y.value)/100||0,0,.97);apply();};
      node.querySelector('[data-reset]').onclick=()=>{Object.assign(current,normalize(null,type));apply();};
      node.querySelector('[data-save]').onclick=()=>{result={x:Math.round(current.x*1000)/1000,y:Math.round(current.y*1000)/1000,width:Math.round(current.width*1000)/1000};node.close();};
      node.querySelector('[data-cancel]').onclick=()=>node.close();node.querySelector('[data-close]').onclick=()=>node.close();
      node.addEventListener('close',()=>{node.remove();resolve(result);},{once:true});
      node.showModal();
    });
  }
  return Object.freeze({DEFAULTS,normalize,fromMetadata,open});
});
