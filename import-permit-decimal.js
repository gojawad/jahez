/* Exact arithmetic shared only by the import permit portal and its API. */
(function(root){
  'use strict';
  function decimal(value){
    let text=String(value ?? '').trim();
    if(text.length>400) throw new Error('Decimal is too long');
    const match=text.match(/^\+?(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/);
    if(!match) throw new Error('Invalid decimal');
    let [whole,fraction='']=match[1].split('.');
    whole=whole||'0';
    let exponent=BigInt(match[2]||'0');
    if(exponent>200n||exponent< -200n) throw new Error('Decimal exponent is too large');
    while(exponent>0n){whole+=fraction[0]||'0';fraction=fraction.slice(1);exponent--;}
    while(exponent<0n){fraction=(whole.slice(-1)||'0')+fraction;whole=whole.slice(0,-1)||'0';exponent++;}
    whole=whole.replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');
    return whole+(fraction?'.'+fraction:'');
  }
  function parts(value){const text=decimal(value),[a,b='']=text.split('.');return {n:BigInt(a+b),scale:b.length};}
  function format(n,scale){let s=n.toString().padStart(scale+1,'0');return decimal(scale?s.slice(0,-scale)+'.'+s.slice(-scale):s);}
  function add(a,b){const x=parts(a),y=parts(b),s=Math.max(x.scale,y.scale);return format(x.n*10n**BigInt(s-x.scale)+y.n*10n**BigInt(s-y.scale),s);}
  function multiply(a,b){const x=parts(a),y=parts(b);return format(x.n*y.n,x.scale+y.scale);}
  function divide(a,b){
    const x=parts(a),y=parts(b);if(y.n===0n)throw new Error('Division by zero');
    let n=x.n*10n**BigInt(y.scale),d=y.n*10n**BigInt(x.scale),u=n,v=d;
    while(v){const remainder=u%v;u=v;v=remainder;}n/=u;d/=u;
    let rest=d,twos=0,fives=0;
    while(rest%2n===0n){rest/=2n;twos++;}while(rest%5n===0n){rest/=5n;fives++;}
    // A repeating quotient has no finite decimal representation: retain an exact fraction.
    if(rest!==1n)return n.toString()+' / '+d.toString();
    const scale=Math.max(twos,fives);return format(n*(10n**BigInt(scale)/d),scale);
  }
  function valid(value){try{decimal(value);return true;}catch{return false;}}
  function positive(value){return valid(value)&&parts(value).n>0n;}
  function currency(value){
    const text=String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');
    if(!text||text.length>64||!/[\p{L}\p{N}]/u.test(text)||/[^\p{L}\p{M}\p{N} .()_\/-]/u.test(text))throw new Error('Invalid currency');
    return /^[a-z]{3}$/i.test(text)?text.toUpperCase():text;
  }
  const api={decimal,add,multiply,divide,valid,positive,currency};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ImportPermitDecimal=api;
})(typeof globalThis==='object'?globalThis:this);
