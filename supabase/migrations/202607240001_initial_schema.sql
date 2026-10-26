-- Second Brain initial schema
-- Applied to the initial remote project on 2026-07-24 after explicit approval.

create extension if not exists pgcrypto;

create table public.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  status text not null default 'inbox',
  title text,
  content text,
  source_url text,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,

  constraint captures_id_user_id_key unique (id, user_id),
  constraint captures_kind_check check (kind in ('note', 'link', 'image')),
  constraint captures_status_check check (status in ('inbox', 'reviewed', 'archived')),
  constraint captures_title_length_check check (title is null or char_length(title) <= 500),
  constraint captures_source_url_length_check check (
    source_url is null or char_length(source_url) <= 8192
  ),
  constraint captures_required_content_check check (
    (
      kind = 'note'
      and (
        nullif(btrim(coalesce(title, '')), '') is not null
        or nullif(btrim(coalesce(content, '')), '') is not null
      )
    )
    or (
      kind = 'link'
      and nullif(btrim(coalesce(source_url, '')), '') is not null
    )
    or kind = 'image'
  ),
  constraint captures_archive_state_check check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived' and archived_at is null)
  )
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  capture_id uuid not null,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),

  constraint attachments_capture_owner_fkey
    foreign key (capture_id, user_id)
    references public.captures (id, user_id)
    on delete cascade,
  constraint attachments_storage_path_check check (
    storage_path = user_id::text
    or storage_path like user_id::text || '/%'
  ),
  constraint attachments_original_name_check check (
    nullif(btrim(original_name), '') is not null
    and char_length(original_name) <= 255
  ),
  constraint attachments_mime_type_check check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  constraint attachments_size_check check (
    size_bytes > 0 and size_bytes <= 10485760
  )
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  normalized_name text generated always as (lower(btrim(name))) stored,
  created_at timestamptz not null default now(),

  constraint tags_id_user_id_key unique (id, user_id),
  constraint tags_name_check check (
    nullif(btrim(name), '') is not null
    and char_length(btrim(name)) <= 50
  ),
  constraint tags_user_normalized_name_key unique (user_id, normalized_name)
);

create table public.capture_tags (
  user_id uuid not null references auth.users (id) on delete cascade,
  capture_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),

  primary key (capture_id, tag_id),
  constraint capture_tags_capture_owner_fkey
    foreign key (capture_id, user_id)
    references public.captures (id, user_id)
    on delete cascade,
  constraint capture_tags_tag_owner_fkey
    foreign key (tag_id, user_id)
    references public.tags (id, user_id)
    on delete cascade
);

create index captures_user_status_created_idx
  on public.captures (user_id, status, created_at desc);

create index captures_user_created_idx
  on public.captures (user_id, created_at desc);

create index captures_user_favorites_idx
  on public.captures (user_id, created_at desc)
  where is_favorite;

create index captures_search_idx
  on public.captures
  using gin (
    to_tsvector(
      'simple',
      coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(source_url, '')
    )
  );

create index attachments_capture_idx
  on public.attachments (capture_id);

create index capture_tags_user_tag_idx
  on public.capture_tags (user_id, tag_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger captures_set_updated_at
before update on public.captures
for each row
execute function public.set_updated_at();

alter table public.captures enable row level security;
alter table public.attachments enable row level security;
alter table public.tags enable row level security;
alter table public.capture_tags enable row level security;

revoke all on table public.captures from anon;
revoke all on table public.attachments from anon;
revoke all on table public.tags from anon;
revoke all on table public.capture_tags from anon;

grant select, insert, update, delete on table public.captures to authenticated;
grant select, insert, update, delete on table public.attachments to authenticated;
grant select, insert, update, delete on table public.tags to authenticated;
grant select, insert, update, delete on table public.capture_tags to authenticated;

create policy "Users can read their captures"
on public.captures
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their captures"
on public.captures
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their captures"
on public.captures
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their captures"
on public.captures
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their attachment metadata"
on public.attachments
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their attachment metadata"
on public.attachments
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their attachment metadata"
on public.attachments
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their attachment metadata"
on public.attachments
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their tags"
on public.tags
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their tags"
on public.tags
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their tags"
on public.tags
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their tags"
on public.tags
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their capture tags"
on public.capture_tags
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their capture tags"
on public.capture_tags
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their capture tags"
on public.capture_tags
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their capture tags"
on public.capture_tags
for delete
to authenticated
using ((select auth.uid()) = user_id);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'capture-images',
  'capture-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can read their image objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'capture-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can upload their image objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'capture-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can update their image objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'capture-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'capture-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can delete their image objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'capture-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
