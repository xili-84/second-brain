-- Link previews: title, description, site name, image and favicon for link captures.
--
-- Filled by the `link-preview` Edge Function, which runs as the signed-in user (no service-role
-- key) and writes through the ordinary captures RLS policies. The preview image lives in its own
-- private bucket, `link-previews`, so the capture-images clean-up job never sees it and the app
-- shows it through short-lived signed URLs from the existing Supabase origin (the CSP is unchanged).

alter table public.captures
  add column link_title text,
  add column link_description text,
  add column link_site_name text,
  add column link_image_path text,
  add column link_favicon text,
  add column link_preview_status text,
  add column link_preview_fetched_at timestamptz;

alter table public.captures
  add constraint captures_link_title_length_check check (
    link_title is null or char_length(link_title) <= 300
  ),
  add constraint captures_link_description_length_check check (
    link_description is null or char_length(link_description) <= 600
  ),
  add constraint captures_link_site_name_length_check check (
    link_site_name is null or char_length(link_site_name) <= 120
  ),
  -- The image must sit in the owner's folder for this very capture.
  add constraint captures_link_image_path_check check (
    link_image_path is null
    or link_image_path = user_id::text || '/' || id::text || '/preview'
  ),
  -- Favicons are small raster data URLs (16 KB before base64); never SVG or other documents.
  add constraint captures_link_favicon_check check (
    link_favicon is null
    or (
      char_length(link_favicon) <= 22000
      and link_favicon ~ '^data:image/(png|jpeg|gif|webp|x-icon);base64,[A-Za-z0-9+/]+=*$'
    )
  ),
  add constraint captures_link_preview_status_check check (
    link_preview_status is null or link_preview_status in ('ready', 'failed')
  ),
  add constraint captures_link_preview_kind_check check (
    kind = 'link'
    or (
      link_title is null
      and link_description is null
      and link_site_name is null
      and link_image_path is null
      and link_favicon is null
      and link_preview_status is null
      and link_preview_fetched_at is null
    )
  );

-- A preview refresh is not an edit: only user-facing columns move updated_at.
drop trigger if exists captures_set_updated_at on public.captures;

create trigger captures_set_updated_at
before update on public.captures
for each row
when (
  (old.kind, old.status, old.title, old.content, old.source_url, old.is_favorite, old.archived_at)
  is distinct from
  (new.kind, new.status, new.title, new.content, new.source_url, new.is_favorite, new.archived_at)
)
execute function public.set_updated_at();

-- Private bucket for preview images: <user id>/<capture id>/preview, 2 MB, raster images only.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'link-previews',
  'link-previews',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can read their link preview objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'link-previews'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can upload their link preview objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'link-previews'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can update their link preview objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'link-previews'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'link-previews'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can delete their link preview objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'link-previews'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
