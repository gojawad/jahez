-- BSGT only; depends on 45 and 51, not on Letters migration 56.
-- No data rewrites, schema changes, new permissions or Storage policies.
begin;

-- Keep all acceptance/dispatch checks and require finance originals for modern
-- collection files. Legacy signatures and CAD signatures are never mandatory.
do $$
declare signature text; definition text; needle text; replacement text;
begin
  needle := 'if coalesce(v_file.metadata->>''collectionMode'',''collection'') <> ''cad'' and v_signed <> cardinality(v_required) then raise exception';
  replacement := 'if public.bsgt_trade_uses_operations_revisions(v_file.id) and coalesce(v_file.metadata->>''collectionMode'',''collection'') <> ''cad'' and v_signed <> cardinality(v_required) then raise exception';
  foreach signature in array array['public.final_accept_bsgt_trade_file(uuid)','public.send_bsgt_trade_file_to_collecting(uuid,text,text)'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position(replacement in definition)>0 then continue; end if;
    if position(needle in definition)=0 or position('''finance_original''' in definition)=0 then
      raise exception 'Expected migrations 45/51 document gate in %; refusing unknown definition',signature;
    end if;
    execute replace(definition,needle,replacement);
  end loop;
end $$;

-- Reuse the existing immutable original + separate signed-version mechanism.
-- Recheck the stage and its edit permission while holding the trade-file lock.
do $$
declare definition text; needle text; replacement text;
begin
  definition := pg_get_functiondef('public.register_bsgt_internal_signature(uuid,integer,uuid,text,text,text,jsonb)'::regprocedure);
  if position('Relations or management signing permission required' in definition)>0 then return; end if;
  needle := 'if not public.has_bsgt_workspace_permission(''management'',true) then raise exception ''Management edit permission required''; end if;';
  replacement := 'if not (public.has_bsgt_workspace_permission(''management'',true) or public.has_bsgt_workspace_permission(''relations'',true)) then raise exception ''Relations or management signing permission required''; end if;';
  if position(needle in definition)=0 then raise exception 'Unknown internal signature permission gate'; end if;
  definition := replace(definition,needle,replacement);
  needle := 'if not found or f.status<>''under_management_review'' or f.revision_no<>p_revision_no';
  replacement := 'if not found or not ((f.status=''under_management_review'' and public.has_bsgt_workspace_permission(''management'',true)) or (f.status=''final_accepted'' and public.has_bsgt_workspace_permission(''relations'',true))) or f.revision_no<>p_revision_no';
  if position(needle in definition)=0 then raise exception 'Unknown internal signature stage gate'; end if;
  definition := replace(definition,needle,replacement);
  needle := '''action'',''administration_signature_saved''';
  replacement := '''action'',case when f.status=''final_accepted'' then ''relations_signature_saved'' else ''administration_signature_saved'' end';
  if position(needle in definition)=0 then raise exception 'Unknown internal signature audit event'; end if;
  execute replace(definition,needle,replacement);
end $$;

notify pgrst,'reload schema';
commit;
