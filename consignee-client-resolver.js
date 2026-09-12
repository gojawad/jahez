(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.JahezConsigneeClients = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  function cleanConsigneeName(value){
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function normalizeConsigneeName(value){
    return cleanConsigneeName(value).toLocaleLowerCase('en-US');
  }

  function resolveClientForConsignee(clients, consignee){
    const key = normalizeConsigneeName(consignee);
    if(!key) return null;
    return (clients || []).find(client=>normalizeConsigneeName(client && client.name) === key) || null;
  }

  function collectConsigneeCandidates(options){
    const opts = options || {};
    const candidates = new Map();
    const addresses = new Map();
    Object.entries(opts.lookupAddressMap || {}).forEach(([name,address])=>{
      const key = normalizeConsigneeName(name);
      const cleanAddress = String(address == null ? '' : address).trim();
      if(key && cleanAddress) addresses.set(key, cleanAddress);
    });
    const add = name=>{
      const cleanName = cleanConsigneeName(name);
      const key = normalizeConsigneeName(cleanName);
      if(!key || candidates.has(key)) return;
      candidates.set(key, {key, name:cleanName, address:addresses.get(key) || null});
    };
    (opts.lookupConsignees || []).forEach(add);
    (opts.shipments || []).forEach(record=>add(record && (record.consignee || record.data?.consignee)));
    return [...candidates.values()];
  }

  function planConsigneeClientSync(options){
    const opts = options || {};
    const clients = opts.clients || [];
    const candidates = collectConsigneeCandidates(opts);
    const existing = new Map();
    clients.forEach(client=>{
      const key = normalizeConsigneeName(client && client.name);
      if(key && !existing.has(key)) existing.set(key, client);
    });
    const create = [];
    const fillAddress = [];
    candidates.forEach(candidate=>{
      const client = existing.get(candidate.key);
      if(!client){
        create.push({name:candidate.name, address:candidate.address});
        return;
      }
      if(candidate.address && !String(client.address == null ? '' : client.address).trim()){
        fillAddress.push({client, address:candidate.address});
      }
    });
    return {candidates, create, fillAddress};
  }

  function createSupabaseRepository(supabase){
    return {
      async insertClient(row){
        const payload = {name:row.name};
        if(row.address) payload.address = row.address;
        const {data,error} = await supabase.from('clients').insert(payload).select('*').single();
        if(error) throw error;
        return data;
      },
      async fillClientAddress(client, address){
        let query = supabase.from('clients').update({address}).eq('id', client.id);
        query = client.address == null ? query.is('address', null) : query.eq('address', client.address);
        const {data,error} = await query.select('*');
        if(error) throw error;
        return data && data[0] ? data[0] : null;
      },
      async listClients(){
        const {data,error} = await supabase.from('clients').select('*').order('name');
        if(error) throw error;
        return data || [];
      }
    };
  }

  async function syncConsigneeClients(options){
    const opts = options || {};
    const currentClients = opts.clients || [];
    if(opts.canWrite === false) return {clients:currentClients, created:0, addressesFilled:0, conflicts:0};
    const repository = opts.repository || createSupabaseRepository(opts.supabase);
    const plan = planConsigneeClientSync(opts);
    let created = 0, addressesFilled = 0, conflicts = 0;
    for(const row of plan.create){
      try{
        await repository.insertClient(row);
        created += 1;
      }catch(error){
        if(error && error.code === '23505') conflicts += 1;
        else throw error;
      }
    }
    for(const item of plan.fillAddress){
      const updated = await repository.fillClientAddress(item.client, item.address);
      if(updated) addressesFilled += 1;
    }
    const changed = created || addressesFilled || conflicts;
    const clients = changed ? await repository.listClients() : currentClients;
    return {clients, created, addressesFilled, conflicts};
  }

  return Object.freeze({
    cleanConsigneeName,
    normalizeConsigneeName,
    resolveClientForConsignee,
    collectConsigneeCandidates,
    planConsigneeClientSync,
    createSupabaseRepository,
    syncConsigneeClients
  });
});
