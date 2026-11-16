-- Files of any type can be attached to a capture (new capture kind: 'file').
-- Prepared for review only; apply via `supabase db push` (or the SQL editor) after approval.
--
-- What changes (nothing else is touched; image captures behave exactly as before):
--   1. Storage bucket `capture-images`: the object size limit goes from 10 MiB to 50 MiB (the
--      Supabase free-plan cap) and the MIME allow-list is lifted, so a file of any type can be
--      stored. The bucket stays private and its owner-folder RLS policies are unchanged. Images
--      keep their own 10 MiB / JPEG-PNG-WebP limits: the app checks them, and
--      `finalize_image_capture` still enforces them in the database.
--   2. public.attachments: any non-empty MIME type, and sizes up to 50 MiB.
--   3. public.captures: `file` becomes a valid kind. Like an image capture, a file capture needs
--      no title or text of its own (its files are the content).
--
-- Safe to run more than once. Older app builds never create 'file' captures, so they keep working
-- before and after this migration.

update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = null
where id = 'capture-images';

alter table public.attachments
  drop constraint if exists attachments_mime_type_check,
  drop constraint if exists attachments_size_check;

alter table public.attachments
  add constraint attachments_mime_type_check check (
    nullif(btrim(mime_type), '') is not null
    and char_length(mime_type) <= 255
  ),
  add constraint attachments_size_check check (
    size_bytes > 0 and size_bytes <= 52428800
  );

alter table public.captures
  drop constraint if exists captures_kind_check,
  drop constraint if exists captures_required_content_check;

alter table public.captures
  add constraint captures_kind_check check (kind in ('note', 'link', 'image', 'file')),
  add constraint captures_required_content_check check (
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
    or kind in ('image', 'file')
  );
