-- Reuse trade-file documents for original finance PDFs and internal signed outputs.
begin;
alter table public.trade_collection_file_documents
  add column if not exists document_variant text not null default 'legacy_signed',
  add column if not exists shipment_id uuid references public.shipments(id),
  add column if not exists operations_revision_id uuid references public.bsgt_operations_revisions(id),
  add column if not exists source_document_path text,
  add column if not exists signature_placements jsonb;
alter table public.trade_collection_file_documents drop constraint if exists trade_collection_file_documents_type_check;
alter table public.trade_collection_file_documents add constraint trade_collection_file_documents_type_check check (
  document_type in ('letter','undertaking','exchange') or (
    document_variant = 'administration_signed' and operations_revision_id is not null
    and document_type in ('contract','proforma','invoice','packing','import_permit','certificate_of_origin','bill_of_lading')
  )
);
alter table public.trade_collection_file_documents drop constraint if exists trade_collection_document_variant_check;
alter table public.trade_collection_file_documents add constraint trade_collection_document_variant_check
  check (document_variant in ('legacy_signed','finance_original','administration_signed'));
drop index if exists public.trade_collection_file_documents_active_key;
create unique index trade_collection_file_documents_active_key
  on public.trade_collection_file_documents(trade_file_id,revision_no,document_type,document_variant,
    coalesce(shipment_id,'00000000-0000-0000-0000-000000000000'::uuid)) where is_active;

create or replace function public.bsgt_trade_uses_operations_revisions(p_file_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.trade_collection_file_shipments where trade_file_id=p_file_id)
    and not exists(select 1 from public.trade_collection_file_shipments
      where trade_file_id=p_file_id and operations_revision_id is null);
$$;

create or replace function public.bsgt_internal_package(p_file_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.trade_collection_files%rowtype; packages jsonb; docs jsonb;
begin
  if not (public.has_bsgt_workspace_permission('finance',false)
    or public.has_bsgt_workspace_permission('management',false)
    or public.has_bsgt_workspace_permission('relations',false)) then raise exception 'Internal document view permission required'; end if;
  select * into f from public.trade_collection_files where id=p_file_id and company_id=public.bsgt_company_id();
  if not found or not public.bsgt_trade_uses_operations_revisions(f.id) then raise exception 'Revision-based trade file required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('shipment',r.shipment_snapshot,'revision',to_jsonb(r)) order by r.shipment_id),'[]')
    into packages from public.trade_collection_file_shipments l
    join public.bsgt_operations_revisions r on r.id=l.operations_revision_id and r.approved_at is not null
    where l.trade_file_id=f.id;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at),'[]') into docs
    from public.trade_collection_file_documents d where d.trade_file_id=f.id and d.revision_no=f.revision_no and d.is_active;
  return jsonb_build_object('file',to_jsonb(f),'shipments',packages,'documents',docs);
end;
$$;

create or replace function public.refresh_bsgt_finance_revision(p_context_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.bsgt_finance_contexts%rowtype; f public.trade_collection_files%rowtype;
begin
  if not public.has_bsgt_workspace_permission('finance',true) then raise exception 'Finance edit permission required'; end if;
  select * into c from public.bsgt_finance_contexts where id=p_context_id and user_id=auth.uid() for update;
  if not found or c.trade_file_id is null then raise exception 'Open a finance selection first'; end if;
  perform public.get_bsgt_finance_context(c.id);
  select * into f from public.trade_collection_files where id=c.trade_file_id for update;
  if f.status not in ('draft','returned_to_operations','returned_to_finance') then raise exception 'Trade file already submitted'; end if;
  perform 1 from public.shipments s join public.trade_collection_file_shipments l on l.shipment_id=s.id
    where l.trade_file_id=f.id order by s.id for update of s;
  perform public.get_bsgt_finance_context(c.id);
  if exists(select 1 from public.trade_collection_file_shipments l join public.shipments s on s.id=l.shipment_id
    where l.trade_file_id=f.id and l.operations_revision_id is distinct from s.operations_revision_id)
    or f.status <> 'draft' or exists(select 1 from public.trade_collection_file_documents
      where trade_file_id=f.id and revision_no=f.revision_no and document_variant='finance_original') then
    update public.trade_collection_files set revision_no=revision_no+1,status='draft',updated_at=now() where id=f.id returning * into f;
    update public.trade_collection_file_shipments l set operations_revision_id=s.operations_revision_id
      from public.shipments s where l.trade_file_id=f.id and l.shipment_id=s.id;
    insert into public.activity_log(user_id,type,text) values(auth.uid(),'edit',
      jsonb_build_object('action','finance_draft_regenerated','tradeFile',f.id,'revision',f.revision_no,'sources',c.sources,'actor',auth.uid(),'role',public.my_role(),'at',now())::text);
  end if;
  return to_jsonb(f);
end;
$$;

create or replace function public.register_bsgt_finance_originals(
  p_context_id uuid,p_revision_no integer,p_documents jsonb,p_settings jsonb
) returns jsonb language plpgsql security definer set search_path = public,storage as $$
declare c public.bsgt_finance_contexts%rowtype; f public.trade_collection_files%rowtype; d jsonb;
begin
  if not public.has_bsgt_workspace_permission('finance',true) then raise exception 'Finance edit permission required'; end if;
  select * into c from public.bsgt_finance_contexts where id=p_context_id and user_id=auth.uid() for update;
  if not found or c.trade_file_id is null then raise exception 'Finance context required'; end if;
  select * into f from public.trade_collection_files where id=c.trade_file_id for update;
  perform 1 from public.shipments s join public.trade_collection_file_shipments l on l.shipment_id=s.id
    where l.trade_file_id=f.id order by s.id for update of s;
  perform public.get_bsgt_finance_context(c.id);
  if f.status <> 'draft' or f.revision_no <> p_revision_no then raise exception 'Finance draft changed'; end if;
  if exists(select 1 from public.trade_collection_file_shipments l join public.shipments s on s.id=l.shipment_id
    where l.trade_file_id=f.id and l.operations_revision_id is distinct from s.operations_revision_id) then
    raise exception 'Refresh the finance draft before generating documents';
  end if;
  if (select array_agg(x->>'kind' order by x->>'kind') from jsonb_array_elements(p_documents) x)
    is distinct from array['exchange','letter','undertaking']::text[] then raise exception 'The three existing finance documents are required'; end if;
  if exists(select 1 from public.trade_collection_file_documents where trade_file_id=f.id
    and revision_no=f.revision_no and document_variant='finance_original') then raise exception 'Finance originals already saved; create a new draft revision to regenerate'; end if;
  for d in select value from jsonb_array_elements(p_documents) loop
    if d->>'path' not like 'workflow/'||f.id||'/'||f.revision_no||'/finance/%'
      or position('..' in d->>'path')>0
      or not exists(select 1 from storage.objects where bucket_id='trade-collection-documents' and name=d->>'path') then
      raise exception 'Finance PDF upload is incomplete';
    end if;
    insert into public.trade_collection_file_documents(trade_file_id,revision_no,document_type,storage_path,file_name,mime_type,uploaded_by,document_variant)
      values(f.id,f.revision_no,d->>'kind',d->>'path',(d->>'kind')||'.pdf','application/pdf',auth.uid(),'finance_original');
  end loop;
  update public.trade_collection_files set metadata=coalesce(metadata,'{}')||jsonb_build_object(
    'documentSettings',p_settings,'documentKinds',jsonb_build_array('letter','undertaking','exchange'),
    'operationsRevisionWorkflow',true,'qrIncluded',false),updated_at=now() where id=f.id returning * into f;
  insert into public.activity_log(user_id,type,text) values(auth.uid(),'edit',
    jsonb_build_object('action','finance_documents_generated','tradeFile',f.id,'revision',f.revision_no,'sources',c.sources,'actor',auth.uid(),'role',public.my_role(),'at',now())::text);
  return to_jsonb(f);
end;
$$;

create or replace function public.register_bsgt_internal_signature(
  p_file_id uuid,p_revision_no integer,p_shipment_id uuid,p_kind text,p_path text,p_source_path text,p_placements jsonb
) returns jsonb language plpgsql security definer set search_path = public,storage as $$
declare f public.trade_collection_files%rowtype; ops_id uuid; result public.trade_collection_file_documents%rowtype;
begin
  if not public.has_bsgt_workspace_permission('management',true) then raise exception 'Management edit permission required'; end if;
  select * into f from public.trade_collection_files where id=p_file_id and company_id=public.bsgt_company_id() for update;
  if not found or f.status<>'under_management_review' or f.revision_no<>p_revision_no
    or not public.bsgt_trade_uses_operations_revisions(f.id) then raise exception 'Management review changed'; end if;
  select operations_revision_id into ops_id from public.trade_collection_file_shipments where trade_file_id=f.id and shipment_id=p_shipment_id;
  if not found then raise exception 'Shipment is outside this package'; end if;
  if p_kind in ('letter','undertaking','exchange') then
    if not exists(select 1 from public.trade_collection_file_documents where trade_file_id=f.id and revision_no=f.revision_no
      and document_variant='finance_original' and document_type=p_kind and storage_path=p_source_path and is_active) then
      raise exception 'Finance original not found'; end if;
  elsif not exists(select 1 from public.bsgt_operations_revisions r,jsonb_array_elements(r.documents) d
    where r.id=ops_id and d->>'kind'=p_kind and d->>'path'=p_source_path) then raise exception 'Operations original not found'; end if;
  if p_path not like 'workflow/'||f.id||'/'||f.revision_no||'/signed/%' or position('..' in p_path)>0
    or not exists(select 1 from storage.objects where bucket_id='trade-collection-documents' and name=p_path) then raise exception 'Signed PDF upload is incomplete'; end if;
  if jsonb_typeof(p_placements)<>'array' or jsonb_array_length(p_placements)<1 then raise exception 'Signature placement required'; end if;
  update public.trade_collection_file_documents set is_active=false,archived_at=now()
    where trade_file_id=f.id and revision_no=f.revision_no and shipment_id=p_shipment_id
      and document_type=p_kind and document_variant='administration_signed' and is_active;
  insert into public.trade_collection_file_documents(trade_file_id,revision_no,document_type,storage_path,file_name,mime_type,
    uploaded_by,document_variant,shipment_id,operations_revision_id,source_document_path,signature_placements)
    values(f.id,f.revision_no,p_kind,p_path,p_kind||'-signed.pdf','application/pdf',auth.uid(),
      'administration_signed',p_shipment_id,ops_id,p_source_path,p_placements) returning * into result;
  insert into public.activity_log(user_id,type,text) values(auth.uid(),'edit',
    jsonb_build_object('action','administration_signature_saved','tradeFile',f.id,'shipment',p_shipment_id,
      'revision',f.revision_no,'operationsRevision',ops_id,'document',result.id,'placements',p_placements,'actor',auth.uid(),'role',public.my_role(),'at',now())::text);
  return to_jsonb(result);
end;
$$;

-- Preserve the existing acceptance/send implementations, changing only what
-- constitutes a complete document set in revision-based cases. Fail closed if
-- the installed definitions differ rather than overwriting unknown changes.
do $$
declare signature text; definition text; needle text; replacement text;
begin
  needle := 'and is_active and document_type = any(v_required);';
  replacement := 'and is_active and document_type = any(v_required) and document_variant = case when public.bsgt_trade_uses_operations_revisions(v_file.id) then ''finance_original'' else ''legacy_signed'' end;';
  foreach signature in array array['public.final_accept_bsgt_trade_file(uuid)','public.send_bsgt_trade_file_to_collecting(uuid,text,text)'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position(replacement in definition)>0 then continue; end if;
    if position(needle in definition)=0 then raise exception 'Unexpected installed document gate in %',signature; end if;
    execute replace(definition,needle,replacement);
  end loop;
end;
$$;

create or replace function public.guard_bsgt_finance_original_completion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status='sent_to_remitting' and old.status is distinct from new.status
    and public.bsgt_trade_uses_operations_revisions(new.id) then
    if (select array_agg(document_type order by document_type) from public.trade_collection_file_documents
      where trade_file_id=new.id and revision_no=new.revision_no and is_active and document_variant='finance_original')
      is distinct from array['exchange','letter','undertaking']::text[] then raise exception 'Generate and save the three finance originals before submission'; end if;
    new.metadata := new.metadata || jsonb_build_object('operationsRevisionWorkflow',true,'qrIncluded',false);
  end if;
  return new;
end;
$$;
drop trigger if exists trade_file_guard_finance_originals on public.trade_collection_files;
create trigger trade_file_guard_finance_originals before update of status on public.trade_collection_files
  for each row execute function public.guard_bsgt_finance_original_completion();

create or replace function public.guard_bsgt_finance_original_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.document_variant='finance_original' then raise exception 'Finance originals are immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trade_file_finance_original_immutable on public.trade_collection_file_documents;
create trigger trade_file_finance_original_immutable before update or delete on public.trade_collection_file_documents
  for each row execute function public.guard_bsgt_finance_original_immutable();

create or replace function public.guard_bsgt_finance_document_scope()
returns trigger language plpgsql security definer set search_path=public as $$
declare file_id uuid;
begin
  file_id:=case when tg_op='DELETE' then old.trade_file_id else new.trade_file_id end;
  perform 1 from public.trade_collection_files where id=file_id for update;
  if exists(select 1 from public.trade_collection_file_documents d join public.trade_collection_files f on f.id=d.trade_file_id
    where f.id=file_id and d.revision_no=f.revision_no and d.document_variant='finance_original') then
    raise exception 'Finance originals already capture this selection; regenerate the draft before changing shipments';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trade_file_finance_document_scope on public.trade_collection_file_shipments;
create trigger trade_file_finance_document_scope before insert or delete on public.trade_collection_file_shipments
  for each row execute function public.guard_bsgt_finance_document_scope();

drop policy if exists bsgt_internal_workflow_read on storage.objects;
create policy bsgt_internal_workflow_read on storage.objects for select to authenticated using (
  bucket_id='trade-collection-documents' and name like 'workflow/%' and exists(
    select 1 from public.trade_collection_file_documents d where d.storage_path=name
  )
);
drop policy if exists bsgt_internal_workflow_insert on storage.objects;
create policy bsgt_internal_workflow_insert on storage.objects as restrictive for insert to authenticated
  with check (bucket_id<>'trade-collection-documents' or name not like 'workflow/%');
drop policy if exists bsgt_internal_workflow_update on storage.objects;
create policy bsgt_internal_workflow_update on storage.objects as restrictive for update to authenticated
  using (bucket_id<>'trade-collection-documents' or name not like 'workflow/%')
  with check (bucket_id<>'trade-collection-documents' or name not like 'workflow/%');
drop policy if exists bsgt_internal_workflow_delete on storage.objects;
create policy bsgt_internal_workflow_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id<>'trade-collection-documents' or name not like 'workflow/%');

revoke all on function public.bsgt_trade_uses_operations_revisions(uuid) from public,anon,authenticated;
revoke all on function public.bsgt_internal_package(uuid) from public,anon;
revoke all on function public.refresh_bsgt_finance_revision(uuid) from public,anon;
revoke all on function public.register_bsgt_finance_originals(uuid,integer,jsonb,jsonb) from public,anon;
revoke all on function public.register_bsgt_internal_signature(uuid,integer,uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.bsgt_internal_package(uuid) to authenticated;
grant execute on function public.refresh_bsgt_finance_revision(uuid) to authenticated;
grant execute on function public.register_bsgt_finance_originals(uuid,integer,jsonb,jsonb) to authenticated;
grant execute on function public.register_bsgt_internal_signature(uuid,integer,uuid,text,text,text,jsonb) to authenticated;
revoke all on function public.guard_bsgt_finance_original_completion() from public,anon,authenticated;
revoke all on function public.guard_bsgt_finance_original_immutable() from public,anon,authenticated;
revoke all on function public.guard_bsgt_finance_document_scope() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
