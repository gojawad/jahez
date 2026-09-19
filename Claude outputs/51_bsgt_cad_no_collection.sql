-- Trade files without bank collection (CAD / paid in advance).
-- The shipment's payment term decides the mode: CAD or advance payment needs no
-- collection letter / undertaking / bill of exchange. Such files still get the
-- remitting bank, go to management and to relations exactly like other files;
-- only the collection-document requirements are lifted. Collection and
-- no-collection shipments can never share one trade file.
begin;

create or replace function public.bsgt_collection_mode(p_data jsonb)
returns text language sql immutable as $$
  select case
    when upper(coalesce(p_data->>'paymentTerm','')) ~ '(^|[^A-Z])CAD([^A-Z]|$)'
      or upper(coalesce(p_data->>'paymentTerm','')) ~ 'CASH[ ]+AGAINST'
      or upper(coalesce(p_data->>'paymentTerm','')) ~ 'ADVANCE'
    then 'cad' else 'collection' end
$$;
revoke all on function public.bsgt_collection_mode(jsonb) from public, anon;
grant execute on function public.bsgt_collection_mode(jsonb) to authenticated;

-- One mode per trade file: enforced when a shipment is linked, and recorded on the file.
create or replace function public.guard_bsgt_trade_file_collection_mode()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_mode text; v_other text; v_file public.trade_collection_files%rowtype;
begin
  select public.bsgt_collection_mode(s.data) into v_mode from public.shipments s where s.id = new.shipment_id;
  if v_mode is null then return new; end if;
  select distinct public.bsgt_collection_mode(s.data) into v_other
    from public.trade_collection_file_shipments link join public.shipments s on s.id = link.shipment_id
    where link.trade_file_id = new.trade_file_id and link.shipment_id <> new.shipment_id
      and public.bsgt_collection_mode(s.data) <> v_mode limit 1;
  if v_other is not null then
    raise exception 'لا يمكن دمج شحنات CAD (بدون تحصيل) مع شحنات التحصيل في ملف واحد';
  end if;
  select * into v_file from public.trade_collection_files where id = new.trade_file_id;
  if found and coalesce(v_file.metadata->>'collectionMode','') <> v_mode then
    update public.trade_collection_files
      set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('collectionMode', v_mode)
        || case when v_mode = 'cad' then jsonb_build_object('documentKinds','[]'::jsonb) else '{}'::jsonb end
      where id = new.trade_file_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trade_file_shipments_collection_mode on public.trade_collection_file_shipments;
create trigger trade_file_shipments_collection_mode before insert on public.trade_collection_file_shipments
  for each row execute function public.guard_bsgt_trade_file_collection_mode();
revoke all on function public.guard_bsgt_trade_file_collection_mode() from public, anon, authenticated;

-- Finance submission: CAD files need no finance originals, but keep the revision-workflow flags.
create or replace function public.guard_bsgt_finance_original_completion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status='sent_to_remitting' and old.status is distinct from new.status
    and public.bsgt_trade_uses_operations_revisions(new.id) then
    if coalesce(new.metadata->>'collectionMode','collection') <> 'cad' and
      (select array_agg(document_type order by document_type) from public.trade_collection_file_documents
      where trade_file_id=new.id and revision_no=new.revision_no and is_active and document_variant='finance_original')
      is distinct from array['exchange','letter','undertaking']::text[] then raise exception 'Generate and save the three finance originals before submission'; end if;
    new.metadata := new.metadata || jsonb_build_object('operationsRevisionWorkflow',true,'qrIncluded',false);
  end if;
  return new;
end;
$$;

-- Management acceptance and dispatch to the collecting bank: no signed collection
-- documents are required for CAD files. Patch the installed gate in place, failing
-- closed if the definitions differ (same approach as migration 45).
do $$
declare signature text; definition text; needle text; replacement text;
begin
  needle := 'if v_signed <> cardinality(v_required) then raise exception';
  replacement := 'if coalesce(v_file.metadata->>''collectionMode'',''collection'') <> ''cad'' and v_signed <> cardinality(v_required) then raise exception';
  foreach signature in array array['public.final_accept_bsgt_trade_file(uuid)','public.send_bsgt_trade_file_to_collecting(uuid,text,text)'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position(replacement in definition)>0 then continue; end if;
    if position(needle in definition)=0 then raise exception 'Unexpected installed document gate in %',signature; end if;
    execute replace(definition,needle,replacement);
  end loop;
end;
$$;

notify pgrst,'reload schema';
commit;
