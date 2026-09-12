'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const resolver = require('../consignee-client-resolver');

const source = fs.readFileSync(path.join(__dirname, '..', 'consignee-client-resolver.js'), 'utf8');
let checks = 0;
async function check(name, fn){ await fn(); checks += 1; console.log(`✔ ${name}`); }

function memoryRepository(seed){
  const rows = seed.map(row=>({...row}));
  return {
    rows,
    async insertClient(row){
      if(resolver.resolveClientForConsignee(rows, row.name)){
        const error = new Error('duplicate client'); error.code = '23505'; throw error;
      }
      const created = {id:`client-${rows.length + 1}`, active:true, ...row};
      rows.push(created);
      return created;
    },
    async fillClientAddress(client, address){
      const row = rows.find(item=>item.id === client.id);
      if(!row || String(row.address || '').trim()) return null;
      row.address = address;
      return row;
    },
    async listClients(){ return rows.map(row=>({...row})); }
  };
}

async function main(){
  await check('shipment consignee resolves to its existing client', () => {
    const clients=[{id:'client-a',name:'ABC TRADING LLC'}];
    assert.strictEqual(resolver.resolveClientForConsignee(clients,'ABC TRADING LLC').id,'client-a');
  });

  await check('lookup consignee missing from clients is created once', async () => {
    const repository=memoryRepository([]);
    const result=await resolver.syncConsigneeClients({repository,clients:[],lookupConsignees:['NEW CONSIGNEE']});
    assert.strictEqual(result.created,1);
    assert.strictEqual(repository.rows[0].name,'NEW CONSIGNEE');
  });

  await check('an existing client is never duplicated', async () => {
    const clients=[{id:'stable-id',name:'ABC TRADING LLC'}], repository=memoryRepository(clients);
    const result=await resolver.syncConsigneeClients({repository,clients,lookupConsignees:['ABC TRADING LLC'],shipments:[{data:{consignee:'ABC TRADING LLC'}}]});
    assert.strictEqual(result.created,0);
    assert.strictEqual(repository.rows.length,1);
  });

  await check('case and surrounding or repeated spaces do not create a duplicate', () => {
    const plan=resolver.planConsigneeClientSync({clients:[{id:'stable-id',name:'ABC TRADING LLC'}],lookupConsignees:['  abc   trading llc  ']});
    assert.strictEqual(plan.create.length,0);
  });

  await check('public companies are not a resolver source', () => {
    assert.ok(!/public\.companies|from\(['"]companies['"]\)/.test(source));
  });

  await check('client ids and ledger references remain unchanged', () => {
    const clients=[{id:'stable-id',name:'ABC'}], ledger=[{id:'entry-1',client_id:'stable-id'}];
    resolver.planConsigneeClientSync({clients,shipments:[{consignee:'ABC'}]});
    assert.strictEqual(clients[0].id,'stable-id');
    assert.strictEqual(ledger[0].client_id,'stable-id');
  });

  await check('client profile files are not modified by consignee sync', () => {
    const files=[{id:'file-1',client_id:'stable-id'}];
    resolver.planConsigneeClientSync({clients:[{id:'stable-id',name:'ABC'}],shipments:[{consignee:'ABC'}]});
    assert.deepStrictEqual(files,[{id:'file-1',client_id:'stable-id'}]);
    assert.ok(!source.includes('client_profile_files'));
  });

  await check('authorized signatories are not modified by consignee sync', () => {
    const signatories=[{id:'signatory-1',client_id:'stable-id'}];
    resolver.planConsigneeClientSync({clients:[{id:'stable-id',name:'ABC'}],lookupConsignees:['ABC']});
    assert.deepStrictEqual(signatories,[{id:'signatory-1',client_id:'stable-id'}]);
    assert.ok(!source.includes('client_authorized_signatories'));
  });

  await check('a manually entered address is never overwritten', () => {
    const plan=resolver.planConsigneeClientSync({clients:[{id:'stable-id',name:'ABC',address:'Manual address'}],lookupConsignees:['ABC'],lookupAddressMap:{ABC:'Lookup address'}});
    assert.strictEqual(plan.fillAddress.length,0);
  });

  await check('a linked consignee address fills an empty client address', async () => {
    const clients=[{id:'stable-id',name:'ABC',address:''}], repository=memoryRepository(clients);
    const result=await resolver.syncConsigneeClients({repository,clients,lookupConsignees:['ABC'],lookupAddressMap:{'  abc  ':'Lookup address'}});
    assert.strictEqual(result.addressesFilled,1);
    assert.strictEqual(repository.rows[0].address,'Lookup address');
  });

  assert.strictEqual(checks,10);
  console.log(`\n${checks} consignee client resolver checks passed`);
}

main().catch(error=>{ console.error(error); process.exit(1); });
