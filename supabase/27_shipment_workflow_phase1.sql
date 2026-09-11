-- Jahez shipment workflow, phase 1.
-- Additive only: the existing shipment status and review cycle are unchanged.

alter table public.shipments
  add column if not exists workflow_stage text not null default 'created',
  add column if not exists workflow_updated_at timestamptz,
  add column if not exists bank_sent_at timestamptz,
  add column if not exists signed_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by uuid references public.profiles(id) on delete set null;

alter table public.shipments
  drop constraint if exists shipments_workflow_stage_check;

alter table public.shipments
  add constraint shipments_workflow_stage_check
  check (workflow_stage in ('created', 'bank_sent', 'signed', 'accepted'));

-- Existing collection submissions become bank_sent. Never advance legacy rows
-- automatically to signed or accepted.
with legacy_collection as (
  select
    id,
    case
      when coalesce(data->>'collectionSentAt', '') ~
        '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
      then (data->>'collectionSentAt')::timestamptz
      else coalesce(updated_at, created_at, now())
    end as sent_at
  from public.shipments
  where workflow_stage = 'created'
    and (
      lower(coalesce(data->>'collectionStatus', '')) = 'sent'
      or nullif(data->>'collectionSentAt', '') is not null
    )
)
update public.shipments as shipment
set
  workflow_stage = 'bank_sent',
  workflow_updated_at = legacy.sent_at,
  bank_sent_at = coalesce(shipment.bank_sent_at, legacy.sent_at)
from legacy_collection as legacy
where shipment.id = legacy.id;

-- Give pre-existing created rows a useful starting timestamp without changing
-- their stage. Future stage transitions set this field explicitly.
update public.shipments
set workflow_updated_at = coalesce(updated_at, created_at, now())
where workflow_updated_at is null;

create index if not exists shipments_workflow_stage_idx
  on public.shipments(workflow_stage);

create index if not exists shipments_workflow_updated_idx
  on public.shipments(workflow_updated_at desc);

notify pgrst, 'reload schema';
