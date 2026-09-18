'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {test}=require('node:test');
const {withLocalFonts}=require('../api/render-bsgt-pdf');
const root=path.join(__dirname,'..');

test('the PDF renderer replaces the Google Fonts import with the embedded local faces',()=>{
  const css=fs.readFileSync(path.join(root,'pdf-fonts','fonts.css'),'utf8');
  for(const family of ['Tajawal','IBM Plex Sans Arabic','IBM Plex Sans','IBM Plex Mono'])assert.ok(css.includes(`font-family: '${family}'`),family);
  for(const file of css.match(/url\(\.\/([^)]+\.woff2)\)/g).map(m=>m.slice(6,-1)))assert.ok(fs.existsSync(path.join(root,'pdf-fonts',file)),file);
  const html="<style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&display=swap');body{font-family:'Tajawal'}</style><p>نص</p>";
  const prepared=withLocalFonts(html);
  assert.equal(prepared.local,true);
  assert.ok(!prepared.html.includes('fonts.googleapis.com'),'no remote font import remains');
  assert.ok(prepared.html.includes('data:font/woff2;base64,'),'faces are inlined');
  assert.ok(prepared.html.endsWith("body{font-family:'Tajawal'}</style><p>نص</p>"),'the rest of the document is untouched');
  const plain=withLocalFonts('<p>no import</p>');
  assert.equal(plain.local,false);assert.equal(plain.html,'<p>no import</p>');
  assert.match(fs.readFileSync(path.join(root,'Dockerfile'),'utf8'),/^COPY pdf-fonts \.\/pdf-fonts$/m,'fonts ship in the production image');
});
