-- Shared commodity thumbnails for the BSGT operations UI.
-- This cache is independent from shipments, shipment files, documents, and package merge.

create table if not exists public.commodity_image_cache (
  id uuid primary key default gen_random_uuid(),
  normalized_query text not null unique,
  item_desc text not null,
  image_url text,
  thumbnail_url text,
  source_url text,
  source_name text,
  attribution text,
  resolved_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  metadata jsonb not null default '{}'::jsonb,
  constraint commodity_image_cache_query_length check (char_length(normalized_query) between 1 and 200),
  constraint commodity_image_cache_https_urls check (
    (image_url is null or image_url ~ '^https://') and
    (thumbnail_url is null or thumbnail_url ~ '^https://') and
    (source_url is null or source_url ~ '^https://')
  )
);

create index if not exists commodity_image_cache_expires_idx
  on public.commodity_image_cache(expires_at);

alter table public.commodity_image_cache enable row level security;

drop policy if exists commodity_image_cache_active_read on public.commodity_image_cache;
create policy commodity_image_cache_active_read on public.commodity_image_cache
  for select to authenticated
  using (public.is_active());

revoke insert, update, delete on public.commodity_image_cache from authenticated;
grant select on public.commodity_image_cache to authenticated;
