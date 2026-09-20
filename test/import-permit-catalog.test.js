'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const context={window:{}};vm.createContext(context);
for(const file of ['baldna-commodities.js','baldna-commodity-translations.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
const {BALDNA_COMMODITY_CATALOG:rows,BALDNA_COMMODITY_TRANSLATIONS:english,BALDNA_COMMODITY_UNIT_LABELS:units}=context.window;
test('replacement workbook catalog has complete source rows, unique IDs and bilingual print labels',()=>{
  assert.equal(rows.length,1088);assert.equal(new Set(rows.map(x=>x.id)).size,rows.length);
  assert.equal(Object.keys(english).length,rows.length);
  for(const row of rows){
    assert.match(row.id,/^xl-20260917-\d+$/);assert.equal(Number(row.id.split('-').at(-1)),row.sourceRow);
    assert.ok(row.name&&row.category&&row.unit);assert.match(row.hsCode,/^\d{8}$/);assert.notEqual(row.hsCode,'00000000');
    assert.ok(english[row.id]);assert.doesNotMatch(english[row.id],/[\u0600-\u06ff]/);
    assert.ok(units[row.unit]?.ar&&units[row.unit]?.en);assert.ok(row.unit.length<=8);
    if('indicativePriceUsd' in row){assert.equal(typeof row.indicativePriceUsd,'string');assert.match(row.indicativePriceUsd,/^\d+(\.\d+)?$/);}
  }
  for(const excluded of [34,44,53,811,816,847,872,877])assert.ok(!rows.some(x=>x.sourceRow===excluded));
  assert.equal(rows[0].hsCode,'01063100');assert.equal(rows[0].indicativePriceUsd,'350');
});
test('distinct source reference prices stay distinguishable and missing prices stay absent',()=>{
  const melons=rows.filter(x=>x.name==='الشمام'&&x.unit==='طن');
  assert.ok(melons.some(x=>x.indicativePriceUsd==='300'));assert.ok(melons.some(x=>x.indicativePriceUsd==='600'));
  assert.ok(rows.some(x=>!Object.hasOwn(x,'indicativePriceUsd')));
  const keys=rows.map(x=>JSON.stringify([x.category,x.name,x.hsCode,x.unit,x.indicativePriceUsd]));
  assert.equal(new Set(keys).size,rows.length);
});
test('print units expand workbook and legacy abbreviations',()=>{
  assert.equal(units['طن'].en,'TON');assert.equal(units['طن'].ar,'طن');
  for(const unit of ['كيلوجرام','KGM','KG']){
    assert.equal(units[unit].en,'KILOGRAM');assert.equal(units[unit].ar,'كيلوجرام');
  }
  for(const entry of Object.values(units))assert.equal(entry.en,entry.en.toUpperCase());
  assert.equal(units.PCE.en,'PIECE');assert.equal(units.MTK.en,'SQUARE METRE');
});
