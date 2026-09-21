-- Independent, explicitly assigned read access. Requires 39, 43-45 and 50.
-- No employee grants, data rewrites, write policies or changes to existing scopes.
begin;

insert into public.feature_permission_catalog(permission_key,group_key,label_ar,depends_on)
values ('bsgt.bank_sent.view','bsgt','عرض الملفات المُرسلة للبنك','{}')
on conflict (permission_key) do nothing;

-- Definer helpers avoid recursive RLS through file -> link -> shipment policies.
create or replace function public.bsgt_bank_sent_can_read(p_file_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.is_active()
    and public.has_feature_permission('bsgt.bank_sent.view')
    and exists(select 1 from public.trade_collection_files f
      where f.id=p_file_id and f.company_id=public.bsgt_company_id()
        and f.status='sent_to_collecting' and f.archived_at is null);
$$;

create or replace function public.bsgt_bank_sent_shipment_read(p_shipment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.trade_collection_file_shipments l
    join public.shipments s on s.id=l.shipment_id
    where s.id=p_shipment_id and s.company_id=public.bsgt_company_id()
      and public.bsgt_bank_sent_can_read(l.trade_file_id));
$$;

drop policy if exists bank_sent_files_read on public.trade_collection_files;
create policy bank_sent_files_read on public.trade_collection_files for select to authenticated
  using (public.bsgt_bank_sent_can_read(id));
drop policy if exists bank_sent_links_read on public.trade_collection_file_shipments;
create policy bank_sent_links_read on public.trade_collection_file_shipments for select to authenticated
  using (public.bsgt_bank_sent_can_read(trade_file_id));
drop policy if exists bank_sent_documents_read on public.trade_collection_file_documents;
create policy bank_sent_documents_read on public.trade_collection_file_documents for select to authenticated
  using (public.bsgt_bank_sent_can_read(trade_file_id));
drop policy if exists bank_sent_events_read on public.trade_collection_file_events;
create policy bank_sent_events_read on public.trade_collection_file_events for select to authenticated
  using (public.bsgt_bank_sent_can_read(trade_file_id));
drop policy if exists bank_sent_attachments_read on public.trade_collection_relations_attachments;
create policy bank_sent_attachments_read on public.trade_collection_relations_attachments for select to authenticated
  using (public.bsgt_bank_sent_can_read(trade_file_id));
drop policy if exists bank_sent_shipments_read on public.shipments;
create policy bank_sent_shipments_read on public.shipments for select to authenticated
  using (public.bsgt_bank_sent_shipment_read(id));
drop policy if exists bank_sent_shipment_files_read on public.shipment_files;
create policy bank_sent_shipment_files_read on public.shipment_files for select to authenticated
  using (public.bsgt_bank_sent_shipment_read(shipment_id));
drop policy if exists bank_sent_revisions_read on public.bsgt_operations_revisions;
create policy bank_sent_revisions_read on public.bsgt_operations_revisions for select to authenticated
  using (approved_at is not null and exists(select 1 from public.trade_collection_file_shipments l
    where l.operations_revision_id=bsgt_operations_revisions.id and l.shipment_id=bsgt_operations_revisions.shipment_id
      and public.bsgt_bank_sent_can_read(l.trade_file_id)));

-- Only registered document paths in a permitted file, never arbitrary folder access.
-- Approved operations package objects already use the revision table's RLS (43).
drop policy if exists bank_sent_storage_read on storage.objects;
create policy bank_sent_storage_read on storage.objects for select to authenticated using (
  (bucket_id='trade-collection-documents' and (
    exists(select 1 from public.trade_collection_file_documents d
      where d.storage_path=objects.name and public.bsgt_bank_sent_can_read(d.trade_file_id))
    or exists(select 1 from public.trade_collection_relations_attachments a
      where a.storage_path=objects.name and public.bsgt_bank_sent_can_read(a.trade_file_id))))
  or (bucket_id='shipment-files' and exists(select 1 from public.shipment_files d
    where d.path=objects.name and public.bsgt_bank_sent_shipment_read(d.shipment_id)))
);

-- Extend only this read RPC's gate; preserve its current body and write RPCs.
do $$
declare definition text; needle text; replacement text;
begin
  definition := pg_get_functiondef('public.bsgt_internal_package(uuid)'::regprocedure);
  needle := 'or public.has_bsgt_workspace_permission(''relations'',false)) then raise exception ''Internal document view permission required''';
  replacement := 'or public.has_bsgt_workspace_permission(''relations'',false)
    or public.bsgt_bank_sent_can_read(p_file_id)) then raise exception ''Internal document view permission required''';
  if position(replacement in definition)=0 then
    if position(needle in definition)=0 then raise exception 'Unknown internal package read gate; refusing to overwrite'; end if;
    execute replace(definition,needle,replacement);
  end if;
end $$;

revoke all on function public.bsgt_bank_sent_can_read(uuid) from public,anon;
revoke all on function public.bsgt_bank_sent_shipment_read(uuid) from public,anon;
grant execute on function public.bsgt_bank_sent_can_read(uuid) to authenticated;
grant execute on function public.bsgt_bank_sent_shipment_read(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
