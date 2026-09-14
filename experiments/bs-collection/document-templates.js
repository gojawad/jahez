/* Collection-only HTML settings; existing templates remain the fallback. */
window.CollectionHtmlTemplates = (()=>{
  const settingsKey='collectionHtmlTemplates';
  let editingKind='letter', busy=false, legacyRendering=false, previewUrl='';
  const units={mm:1,cm:10,inch:25.4};
  const fields=['top','bottom','left','right','headerSize','footerSize'];
  const defaults=()=>({version:1,header:'collection',unit:'mm',top:20,bottom:20,left:17,right:17,headerSize:29,footerSize:8,html:''});
  const saved=kind=>sharedCollectionCompany?.settings?.[settingsKey]?.[kind]||null;
  // Keep administrator-authored HTML intact when updating built-in Word bodies.
  const builtIn=kind=>({exchange:window.CollectionExchangeWordTemplate,undertaking:window.CollectionUndertakingWordTemplate}[kind])?.config();
  const active=kind=>saved(kind)?.html?.trim()?saved(kind):builtIn(kind)||saved(kind)||defaults();
  const hasTemplate=kind=>Boolean(active(kind)?.html?.trim());
  const byId=id=>document.getElementById(id);
  const title=kind=>collectionDocumentLabels[kind]?.title||kind;
  const error=message=>{ byId('templateError').textContent=message; };

  function validate(value){
    const result={...defaults(),...value};
    if(!Object.hasOwn(units,result.unit)||!['collection','company','none'].includes(result.header)) throw new Error('إعدادات الصفحة غير صالحة.');
    fields.forEach(key=>{
      result[key]=Number(result[key]);
      if(!Number.isFinite(result[key])||result[key]<0||result[key]*units[result.unit]>150) throw new Error('أدخل مقاسات صحيحة للهوامش والرأس والذيل.');
    });
    const mm=key=>result[key]*units[result.unit];
    if(mm('left')+mm('right')>=190||mm('top')+mm('bottom')+mm('headerSize')+mm('footerSize')>=277) throw new Error('المقاسات لا تترك مساحة كافية لمحتوى A4.');
    if(typeof result.html!=='string'||result.html.length>300000) throw new Error('قالب HTML أكبر من الحجم المسموح.');
    return result;
  }

  function variables(kind){
    const {rows,currencies,consignees}=detected();
    if(!rows.length) throw new Error('اختر شحنة واحدة على الأقل للمعاينة.');
    if(currencies.length!==1) throw new Error('اختر شحنات بعملة واحدة للمعاينة.');
    const total=collectionTotal(rows);
    return {...rows[0],...state.settings,rows,settings:{...state.settings},
      document_title:title(kind),currency:total.currency,total:total.number,
      amount:formatMoney(total.currency,total.number),words:`${total.currency} ${amountWords(total.number)} ONLY`,
      drawee:consignees.join(' / '),draweeAddress:state.settings.draweeAddress||rows[0].consigneeAddress||'',
      collectionDateText:collectionDateText(state.settings.collectionDate),
      exchangeAmount:`${total.currency} ${total.number}`,
      exchangeCollectionDate:collectionDateText(state.settings.collectionDate).replace(/-(\d{4})$/,'- $1'),
      exchangeBank:String(state.settings.remittingBank||'').toUpperCase(),
      exchangeWords:`${amountWords(total.number)} ${total.currency} ONLY`.toUpperCase(),
      undertakingBankAddress:String(state.settings.remittingBankAddress||'').replace(/(BANIYAS BRANCH BUILDING,)\s*/i,'$1\n'),
      undertakingRows:rows.map((row,index)=>{
        const money=collectionMoney(row.totalAmount);
        return {...row,referenceLabel:index===0?'REF #:':'',invoiceNo:row.invoiceNo||row.shipmentNo||'-',billNo:row.billNo||'-',referenceCurrency:money.currency,referenceAmount:money.number.toFixed(2)};
      }),
      exchangeRows:rows.map(row=>({...row,invoiceNo:row.invoiceNo||row.shipmentNo||'-',exchangeInvoiceDate:exchangeDate(row.invoiceDate)}))};
  }
  function exchangeDate(value){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
    if(!match) return value||'-';
    const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(match[2])-1];
    return month?`${Number(match[3])} ${month} ${match[1]}`:value;
  }
  function lookup(context,key){
    return key.split('.').reduce((value,part)=>value&&Object.hasOwn(value,part)?value[part]:undefined,context);
  }
  function interpolate(source,context){
    // Field names are the existing shipment/settings keys. Values are always escaped.
    source=source.replace(/{{#each\s+([\w.]+)}}([\s\S]*?){{\/each}}/g,(_,key,body)=>{
      const rows=lookup(context,key);
      return Array.isArray(rows)?rows.map(row=>interpolate(body,{...context,...row})).join(''):'';
    });
    return source.replace(/{{\s*([\w.]+)\s*}}/g,(_,key)=>{
      const value=lookup(context,key);
      return value===null||value===undefined||typeof value==='object'?'':esc(value);
    });
  }

  function safeImage(source){
    const value=String(source||'').trim();
    return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z\d+/=\s]+$/i.test(value)?value:'';
  }
  function cleanCss(css){
    // CSSOM parsing also decodes escaped url()/@import tokens before validation.
    const sheet=new CSSStyleSheet();
    try{sheet.replaceSync(css);}catch(_){return '';}
    const declarations=style=>[...style].filter(name=>!/(?:url\s*\(|image-set\s*\(|expression\s*\(|javascript:|behavior|binding|attr\s*\()/i.test(style.getPropertyValue(name)))
      .map(name=>`${name}:${style.getPropertyValue(name)}${style.getPropertyPriority(name)?' !important':''};`).join('');
    const rules=list=>[...list].map(rule=>{
      if(rule.type===1) return `${rule.selectorText}{${declarations(rule.style)}}`;
      if(rule.type===4) return `@media ${rule.conditionText}{${rules(rule.cssRules)}}`;
      if(rule.type===12) return `@supports ${rule.conditionText}{${rules(rule.cssRules)}}`;
      return '';
    }).join('\n');
    return rules(sheet.cssRules).replace(/<\/style/gi,'');
  }
  function sanitize(html){
    const doc=new DOMParser().parseFromString(html,'text/html');
    doc.querySelectorAll('script,iframe,frame,frameset,object,embed,link,meta,base,form,input,button,textarea,select,svg,math,template,audio,video,source').forEach(node=>node.remove());
    const allowed=new Set('HTML HEAD BODY STYLE DIV SPAN P BR HR H1 H2 H3 H4 H5 H6 TABLE THEAD TBODY TFOOT TR TH TD COLGROUP COL CAPTION UL OL LI DL DT DD B STRONG I EM U S SMALL SUP SUB BLOCKQUOTE PRE CODE SECTION ARTICLE HEADER FOOTER MAIN FIGURE FIGCAPTION IMG A'.split(' '));
    doc.querySelectorAll('*').forEach(node=>{
      if(!allowed.has(node.tagName)){node.replaceWith(...node.childNodes);return;}
      [...node.attributes].forEach(attr=>{
        if(!/^(class|id|style|dir|lang|colspan|rowspan|scope|width|height|alt|title|src|start|type)$/i.test(attr.name)) node.removeAttribute(attr.name);
      });
      if(node.hasAttribute('src')){
        const src=safeImage(node.getAttribute('src'));
        if(node.tagName==='IMG'&&src) node.setAttribute('src',src); else node.removeAttribute('src');
      }
      if(node.hasAttribute('style')){
        const css=cleanCss(`x{${node.getAttribute('style')}}`);
        node.setAttribute('style',css.slice(css.indexOf('{')+1,css.lastIndexOf('}')));
      }
    });
    const styles=[...doc.querySelectorAll('style')].map(node=>{const css=cleanCss(node.textContent);node.remove();return css;}).join('\n');
    return {html:doc.body.innerHTML,css:styles,dir:doc.body.getAttribute('dir')||doc.documentElement.getAttribute('dir')||'ltr'};
  }

  function trustedAsset(value){
    if(safeImage(value)) return value;
    try{
      const url=new URL(value,location.origin);
      if(url.protocol==='https:'&&(url.origin===location.origin||url.origin===SB_URL)) return url.href;
    }catch(_){}
    return '';
  }
  function stampData(kind){
    const brand=collectionBrandingSettings();
    const stamp=brand.showStamp===false?'':trustedAsset(brand.stamp);
    const stored=collectionStoredObject(stampTransformStorageKey);
    const key=JSON.stringify([requestedTradeFileId||'',[...state.selected].sort(),kind]);
    const fallback=brand.stampPosition||{};
    const position=(portalRole!=='admin'&&employeeStampPositions.get(key))||stored.positions?.[kind]||{xMm:(fallback.xPercent??78)*2.1,yMm:(fallback.yPercent??78)*2.97};
    const width=stored.widthMm||((fallback.widthPercent||13)*2.1);
    return {source:stamp,x:Number(position.xMm),y:Number(position.yMm),width:Number(width),rotate:Number(fallback.rotate)||0};
  }
  function stampMarkup(kind,top,left){
    const stamp=stampData(kind),signature=trustedAsset(collectionBrandingSettings().signature);
    return `${stamp.source?`<div class="template-stamp collection-stamp-overlay" style="left:${stamp.x-left}mm;top:${stamp.y-top}mm;width:${stamp.width}mm;transform:rotate(${stamp.rotate}deg)"><img src="${esc(stamp.source)}" alt=""></div>`:''}${signature?`<div class="template-signature"><img src="${esc(signature)}" alt=""></div>`:''}`;
  }
  function documentHtml(kind,value){
    const config=validate(value||active(kind)), context=variables(kind);
    if(!config.html.trim()){
      if(builtIn(kind)) return documentHtml(kind,builtIn(kind));
      return legacyHtml(kind);
    }
    const content=sanitize(interpolate(config.html,context));
    const mm=key=>config[key]*units[config.unit];
    const top=mm('top')+mm('headerSize'),bottom=mm('bottom')+mm('footerSize'),left=mm('left'),right=mm('right');
    const company=sharedCollectionCompany?.settings||{};
    const branding=collectionBrandingSettings();
    const background=config.header==='collection'?trustedAsset(branding.background):'';
    const header=config.header==='company'?trustedAsset(company.letterheadImg):'';
    const footer=config.header==='company'?trustedAsset(company.footerImg):'';
    const artwork={background,header,footer,stamp:stampData(kind),left,right,top:mm('top'),bottom:mm('bottom'),headerSize:mm('headerSize'),footerSize:mm('footerSize')};
    const assets=`${background?`<img class="template-background" src="${esc(background)}" alt="">`:''}${header?`<header class="template-header"><img src="${esc(header)}" alt=""></header>`:''}${footer?`<footer class="template-footer"><img src="${esc(footer)}" alt=""></footer>`:''}`;
    const exchangeFonts=kind==='exchange'?window.CollectionExchangeWordTemplate?.fonts(location.origin)||'':'';
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: ${location.origin} ${SB_URL}; font-src ${kind==='exchange'?`data: ${location.origin}`:"'none'"}; base-uri 'none'; form-action 'none'"><title>${esc(title(kind))}</title>
      <meta name="collection-page-art" content="${esc(JSON.stringify(artwork))}"><style>${exchangeFonts}${content.css}</style><style>
      @page{size:A4;margin:${top}mm ${right}mm ${bottom}mm ${left}mm}
      html{background:#fff}body{margin:0!important;color:#111;font-family:Arial,Tahoma,sans-serif;font-size:11pt;line-height:1.45}
      .template-sheet{position:relative;box-sizing:border-box;width:210mm;min-height:297mm;padding:${top}mm ${right}mm ${bottom}mm ${left}mm;background:transparent;isolation:isolate}
      .template-content{display:flow-root;overflow-wrap:anywhere;position:relative;z-index:1}
      .template-content table{max-width:100%;border-collapse:collapse} .template-content img{max-width:100%}
      .template-content tr,.template-content p,.template-content li{break-inside:avoid;orphans:3;widows:3}
      .template-content thead{display:table-header-group}.template-content tfoot{display:table-footer-group}
      .template-background{position:absolute;inset:0;width:210mm;height:297mm;z-index:0;pointer-events:none}
      .template-header,.template-footer{position:absolute;left:${left}mm;right:${right}mm;z-index:0;overflow:hidden}
      .template-header{top:${mm('top')}mm;height:${mm('headerSize')}mm}.template-footer{bottom:${mm('bottom')}mm;height:${mm('footerSize')}mm}
      .template-header img,.template-footer img{width:100%;height:100%;object-fit:contain}
      .template-stamp{position:absolute;z-index:3;touch-action:none;cursor:grab}.template-stamp img{width:100%;pointer-events:none}
      .template-signature img{max-width:48mm;max-height:25mm}
      @media screen{.template-stamp{margin-left:${left}mm;margin-top:${top}mm}}
      @media print{html,body{background:transparent!important}.template-sheet{width:auto;min-height:0;padding:0;background:transparent}.template-background,.template-header,.template-footer{display:none!important}.template-stamp{outline:none!important}}
      ${kind==='undertaking'?'@media print{.bank-undertaking .undertaking-footnote-rule{margin-top:8mm}}':''}
      </style></head><body dir="${content.dir==='rtl'?'rtl':'ltr'}">${assets}<article class="template-sheet"><div class="template-content">${content.html}</div>${stampMarkup(kind,top,left)}</article></body></html>`;
  }

  function legacyHtml(kind){
    const original=state.preview;
    legacyRendering=true;
    try{
      state.preview=kind; renderPreview();
      const paper=byId('documentPreview').innerHTML;
      const styles=[...document.querySelectorAll('link[rel="stylesheet"]')].map(link=>`<link rel="stylesheet" href="${esc(link.href)}">`).join('');
      return `<!doctype html><html><head><meta charset="utf-8">${styles}<style>${byId('collectionBrandStyle')?.textContent||''}body{margin:0;background:#fff}.collection-a4{margin:0!important}</style></head><body>${paper}</body></html>`;
    }finally{state.preview=original;legacyRendering=false;renderPreview();}
  }
  async function pdf(html){
    const doc=new DOMParser().parseFromString(html,'text/html');
    const artMeta=doc.querySelector('meta[name="collection-page-art"]');
    const artwork=artMeta?JSON.parse(artMeta.content):null;
    if(artMeta){artMeta.remove();doc.querySelectorAll('.template-background,.template-header,.template-footer,.template-stamp').forEach(node=>node.remove());html='<!doctype html>'+doc.documentElement.outerHTML;}
    // Chromium's PDF document has an opaque origin. Embed only our two bundled fonts
    // so cross-origin font restrictions cannot silently substitute a different typeface.
    if(doc.querySelector('.bank-exchange')){
      const fonts=await exchangePdfFonts();
      fonts.forEach(({url,data})=>{html=html.split(url).join(data);});
    }
    const response=await fetch('/api/render-bsgt-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html})});
    if(!response.ok) throw new Error('تعذّر إنشاء معاينة PDF. حاول مرة أخرى.');
    const bytes=await response.arrayBuffer();
    if(!artwork||![artwork.background,artwork.header,artwork.footer,artwork.stamp?.source].some(Boolean)) return bytes;
    await loadPdfLibrary();
    const result=await PDFLib.PDFDocument.create();
    const source=await PDFLib.PDFDocument.load(bytes);
    const image=async url=>{
      if(!url)return null;
      const img=new Image();img.crossOrigin='anonymous';img.src=url;await img.decode();
      const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      canvas.getContext('2d').drawImage(img,0,0);
      return result.embedPng(canvas.toDataURL('image/png'));
    };
    const background=await image(artwork.background),header=await image(artwork.header),footer=await image(artwork.footer);
    const stamp=await image(artwork.stamp?.source);
    const pages=await result.embedPdf(bytes,source.getPageIndices()),pt=72/25.4;
    // Reuse PDFLib already bundled with Jahez to repeat the existing artwork on every page.
    for(let index=0;index<pages.length;index++){
      const {width,height}=source.getPage(index).getSize(),page=result.addPage([width,height]);
      if(background)page.drawImage(background,{x:0,y:0,width,height});
      page.drawPage(pages[index],{x:0,y:0,width,height});
      const fit=(asset,y,space)=>{
        if(!asset||!space)return;
        const available=width-(artwork.left+artwork.right)*pt;
        const scale=Math.min(available/asset.width,space*pt/asset.height);
        const w=asset.width*scale,h=asset.height*scale;
        page.drawImage(asset,{x:artwork.left*pt+(available-w)/2,y:y+(space*pt-h)/2,width:w,height:h});
      };
      fit(header,height-(artwork.top+artwork.headerSize)*pt,artwork.headerSize);
      fit(footer,artwork.bottom*pt,artwork.footerSize);
      if(stamp&&index===0){
        const w=artwork.stamp.width*pt,h=w*stamp.height/stamp.width;
        const angle=-artwork.stamp.rotate*Math.PI/180,cx=artwork.stamp.x*pt+w/2,cy=height-artwork.stamp.y*pt-h/2;
        page.drawImage(stamp,{x:cx-w/2*Math.cos(angle)+h/2*Math.sin(angle),y:cy-w/2*Math.sin(angle)-h/2*Math.cos(angle),width:w,height:h,rotate:PDFLib.degrees(-artwork.stamp.rotate)});
      }
    }
    return result.save();
  }
  let exchangeFontPromise;
  function exchangePdfFonts(){
    if(!exchangeFontPromise)exchangeFontPromise=(async()=>{
      const fonts=[];
      for(const weight of ['Regular','Bold']){
        const url=`${location.origin}/experiments/bs-collection/assets/Carlito-${weight}.ttf`;
        const response=await fetch(url);
        if(!response.ok)throw new Error('تعذر تحميل خط الكمبيالة. حاول مرة أخرى.');
        const blob=await response.blob();
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
        fonts.push({url,data});
      }
      return fonts;
    })().catch(error=>{exchangeFontPromise=null;throw error;});
    return exchangeFontPromise;
  }
  function showPdf(bytes,label,returnToEditor){
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    byId('templatePdfPreview').src=previewUrl;
    byId('templatePreviewTitle').textContent=label;
    byId('templatePreviewBack').textContent=returnToEditor?'رجوع للتعديل':'رجوع';
    if(!byId('templatePreviewDialog').open) byId('templatePreviewDialog').showModal();
  }
  async function run(task){
    if(busy) return;
    busy=true;error('');
    const previewLabel=byId('templatePreview').textContent;
    byId('templatePreview').textContent='جاري المعالجة...';
    const printButton=byId('printAllBtn'),printLabel=printButton.innerHTML;
    printButton.disabled=true;printButton.textContent='جاري تجهيز المستندات...';
    byId('templateForm').querySelectorAll('button').forEach(button=>button.disabled=true);
    try{await task();}catch(reason){if(byId('templateSettingsDialog').open) error(reason.message);else alert(reason.message);}
    finally{busy=false;byId('templateForm').querySelectorAll('button').forEach(button=>button.disabled=false);byId('templatePreview').textContent=previewLabel;printButton.disabled=false;printButton.innerHTML=printLabel;}
  }
  function formValue(){
    const value={header:byId('templateHeader').value,unit:byId('templateUnit').value,html:byId('templateHtml').value};
    fields.forEach(key=>value[key]=byId(`template_${key}`).value);
    return validate(value);
  }
  function open(kind){
    if(portalRole!=='admin') return false;
    editingKind=kind;error('');
    const value={...defaults(),...active(kind)};
    byId('templateSettingsTitle').textContent=`إعداد ${title(kind)}`;
    const company=sharedCollectionCompany?.settings||{};
    byId('templateHeader').innerHTML=`<option value="collection">${esc(sharedCollectionCompany?.name_ar||sharedCollectionCompany?.name_en||'الترويسة الحالية')}</option>${company.letterheadImg||company.footerImg?'<option value="company">ترويسة وتذييل الشركة</option>':''}<option value="none">بدون ترويسة</option>`;
    byId('templateHeader').value=value.header;
    byId('templateUnit').value=value.unit;
    byId('templateUnit').dataset.previous=value.unit;
    fields.forEach(key=>byId(`template_${key}`).value=value[key]);
    byId('templateHtml').value=value.html;
    byId('templateSettingsDialog').showModal();
    return true;
  }
  async function save(){
    if(portalRole!=='admin'||!sharedCollectionCompany?.id) throw new Error('حفظ القالب متاح للمدير فقط.');
    const config=formValue();
    const kind=editingKind;
    // Read the latest company settings so another document's settings survive this save.
    const {data,error:readError}=await sb.from('companies').select('settings').eq('id',sharedCollectionCompany.id).single();
    if(readError) throw readError;
    const current=(Array.isArray(data)?data[0]:data)?.settings||sharedCollectionCompany.settings||{};
    const settings={...current,[settingsKey]:{...current[settingsKey],[kind]:{...config,documentType:kind,updatedAt:new Date().toISOString()}}};
    const {error:saveError}=await sb.from('companies').update({settings}).eq('id',sharedCollectionCompany.id);
    if(saveError) throw saveError;
    sharedCollectionCompany.settings=settings;
    byId('templateSettingsDialog').close();renderPreview();
    alert('تم حفظ إعدادات المستند للموظفين.');
  }

  async function importWord(file){
    if(!file||!file.name.toLowerCase().endsWith('.docx')||file.size>10*1024*1024) throw new Error('تعذر قراءة إعدادات الصفحة من الملف.');
    const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer);
    let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(view.getUint32(i,true)===0x06054b50){end=i;break;}}
    if(end<0) throw new Error('Invalid DOCX');
    let offset=view.getUint32(end+16,true),xml='';
    const count=view.getUint16(end+10,true);
    for(let i=0;i<count;i++){
      if(view.getUint32(offset,true)!==0x02014b50) throw new Error('Invalid ZIP');
      const method=view.getUint16(offset+10,true),size=view.getUint32(offset+20,true),unpacked=view.getUint32(offset+24,true);
      const nameSize=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true);
      const name=new TextDecoder().decode(bytes.slice(offset+46,offset+46+nameSize));
      if(name==='word/document.xml'){
        if(size>2e6||unpacked>2e6||(view.getUint16(offset+8,true)&1)) throw new Error('Invalid XML');
        const local=view.getUint32(offset+42,true);
        if(view.getUint32(local,true)!==0x04034b50) throw new Error('Invalid ZIP');
        const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
        if(start+size>bytes.length) throw new Error('Invalid ZIP');
        const packed=bytes.slice(start,start+size);
        if(method===0) xml=new TextDecoder().decode(packed);
        else if(method===8){
          const reader=new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
          const chunks=[];let length=0;
          while(true){const result=await reader.read();if(result.done)break;length+=result.value.length;if(length>2e6){await reader.cancel();throw new Error('XML too large');}chunks.push(result.value);}
          xml=await new Blob(chunks).text();
        }else throw new Error('Unsupported ZIP');
        break;
      }
      offset+=46+nameSize+extra+comment;
    }
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.querySelector('parsererror')) throw new Error('Invalid XML');
    const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const sections=doc.getElementsByTagNameNS(ns,'sectPr');
    const margin=sections[sections.length-1]?.getElementsByTagNameNS(ns,'pgMar')[0];
    if(!margin) throw new Error('Missing margins');
    const result={unit:'mm'};
    for(const [key,attr] of [['top','top'],['bottom','bottom'],['left','left'],['right','right'],['headerSize','header'],['footerSize','footer']]){
      const raw=margin.getAttributeNS(ns,attr);
      if(raw===null&&(key==='headerSize'||key==='footerSize')) continue;
      if(raw===null||!/^\d+$/.test(raw)) throw new Error('Invalid margin');
      result[key]=Math.round(Number(raw)*25.4/1440*1000)/1000;
    }
    return result;
  }

  function renderSaved(){
    if(legacyRendering||!hasTemplate(state.preview)) return false;
    const kind=state.preview;
    try{
      const wrapper=document.createElement('div');wrapper.className='collection-html-page';
      const frame=document.createElement('iframe');frame.className='collection-html-frame';frame.title=title(kind);frame.setAttribute('sandbox','allow-same-origin');
      const doc=new DOMParser().parseFromString(documentHtml(kind,active(kind)),'text/html');
      doc.querySelectorAll('.template-stamp').forEach(node=>node.remove());
      frame.srcdoc='<!doctype html>'+doc.documentElement.outerHTML;
      frame.onload=()=>{
        const paper=frame.contentDocument?.querySelector('.template-sheet');
        if(!paper)return;
        frame.style.height=`${Math.max(1123,paper.scrollHeight)}px`;
      };
      wrapper.append(frame);
      wrapper.insertAdjacentHTML('beforeend',stampMarkup(kind,0,0));
      byId('documentPreview').replaceChildren(wrapper);
      const stampImage=wrapper.querySelector('.template-stamp img');
      if(stampImage){
        if(stampImage.complete)wireCollectionStampDrag(wrapper);
        else stampImage.addEventListener('load',()=>wireCollectionStampDrag(wrapper),{once:true});
      }
      return true;
    }catch(reason){byId('documentPreview').textContent=reason.message;return true;}
  }
  async function printSaved(kind=state.preview){
    await run(async()=>showPdf(await pdf(documentHtml(kind,active(kind))),`معاينة ${title(kind)}`,false));
  }
  async function printAll(){
    await run(async()=>{
      const documents=collectionDocumentKinds().map(kind=>documentHtml(kind,active(kind)));
      await loadPdfLibrary();
      const merged=await PDFLib.PDFDocument.create();
      for(const html of documents){
        const bytes=await pdf(html);
        const source=await PDFLib.PDFDocument.load(bytes);
        (await merged.copyPages(source,source.getPageIndices())).forEach(page=>merged.addPage(page));
      }
      showPdf(await merged.save(),'حزمة مستندات التحصيل',false);
    });
  }
  let pdfLibraryPromise;
  function loadPdfLibrary(){
    if(window.PDFLib)return Promise.resolve();
    if(!pdfLibraryPromise)pdfLibraryPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='collection-pdf-lib.js';script.onload=resolve;script.onerror=()=>{pdfLibraryPromise=null;script.remove();reject(new Error('تعذّر تحميل أدوات PDF.'));};document.head.append(script);});
    return pdfLibraryPromise;
  }
  function init(){
    document.body.classList.add('collection-html-templates');
    document.body.insertAdjacentHTML('beforeend',`<dialog id="templateSettingsDialog" class="template-dialog" aria-labelledby="templateSettingsTitle"><form id="templateForm"><header><h2 id="templateSettingsTitle"></h2></header><div class="template-fields">
      <label>الترويسة<select id="templateHeader"></select></label>
      <fieldset><legend>هوامش المستند</legend><div class="template-measures">${[['top','الهامش العلوي'],['bottom','الهامش السفلي'],['right','الهامش الأيمن'],['left','الهامش الأيسر']].map(([key,label])=>`<label>${label}<input id="template_${key}" type="number" min="0" step="any" required></label>`).join('')}</div><div class="template-margin-actions"><label>الوحدة<select id="templateUnit"><option value="mm">mm</option><option value="cm">cm</option><option value="inch">inch</option></select></label><button id="templateWordImport" class="text-btn" type="button">استيراد من Word</button><input id="templateWordFile" type="file" accept=".docx" hidden></div></fieldset>
      <div class="template-distances"><label>حجم الرأس<input id="template_headerSize" type="number" min="0" step="any" required></label><label>حجم الذيل<input id="template_footerSize" type="number" min="0" step="any" required></label></div>
      <label>قالب HTML<textarea id="templateHtml" spellcheck="false" dir="ltr" placeholder="<h1>{{document_title}}</h1>&#10;<p>{{consignee}} — {{invoiceNo}}</p>"></textarea><small>استخدم أسماء الحقول الحالية مثل {{invoiceNo}}، {{billNo}}، {{consignee}}، {{amount}}، {{remittingBank}}. لتكرار الشحنات: {{#each rows}} ... {{invoiceNo}} ... {{/each}}. ترك القالب فارغاً يستخدم المستند الحالي.</small></label><p id="templateError" class="template-error" role="alert"></p>
      </div><footer><button id="templateCancel" type="button" class="text-btn">إلغاء</button><button id="templatePreview" type="button" class="btn btn-secondary">معاينة المستند</button><button type="submit" class="btn btn-primary">حفظ الإعدادات</button></footer></form></dialog>
      <dialog id="templatePreviewDialog" class="template-dialog" aria-labelledby="templatePreviewTitle"><header><h2 id="templatePreviewTitle"></h2></header><iframe id="templatePdfPreview" title="معاينة PDF"></iframe><footer><button id="templatePreviewBack" class="text-btn" type="button">رجوع للتعديل</button></footer></dialog>`);
    byId('templateCancel').onclick=()=>byId('templateSettingsDialog').close();
    byId('templatePreviewBack').onclick=()=>byId('templatePreviewDialog').close();
    byId('templatePreviewDialog').addEventListener('close',()=>{byId('templatePdfPreview').removeAttribute('src');if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';});
    byId('templateForm').onsubmit=event=>{event.preventDefault();run(save);};
    byId('templatePreview').onclick=()=>run(async()=>showPdf(await pdf(documentHtml(editingKind,formValue())),`معاينة ${title(editingKind)}`,true));
    byId('templateUnit').onchange=()=>{const next=byId('templateUnit').value,previous=byId('templateUnit').dataset.previous;fields.forEach(key=>byId(`template_${key}`).value=Number((Number(byId(`template_${key}`).value)*units[previous]/units[next]).toFixed(4)));byId('templateUnit').dataset.previous=next;};
    byId('templateWordImport').onclick=()=>byId('templateWordFile').click();
    byId('templateWordFile').onchange=()=>run(async()=>{
      try{
        const imported=await importWord(byId('templateWordFile').files[0]);
        const current=formValue();
        fields.forEach(key=>current[key]*=units[current.unit]);
        const next=validate({...current,...imported});
        fields.forEach(key=>byId(`template_${key}`).value=next[key]);
        byId('templateUnit').value='mm';byId('templateUnit').dataset.previous='mm';
      }catch(_){throw new Error('تعذر قراءة إعدادات الصفحة من الملف.');}
      finally{byId('templateWordFile').value='';}
    });
  }
  init();
  return {open,hasTemplate,renderSaved,printSaved,printAll,documentHtml,sanitize,importWord,validate,settingsKey,pdf};
})();
