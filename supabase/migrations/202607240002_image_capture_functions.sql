-- Milestone 4A image capture transaction boundaries.
-- Prepared for review only. Do not apply remotely without explicit approval.

create or replace function public.finalize_image_capture(
  p_capture_id uuid,
  p_attachment_id uuid,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_title text default null,
  p_content text default null
)
returns table (
  created_capture_id uuid,
  created_attachment_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_extension text;
  v_expected_path text;
  v_original_name text := nullif(btrim(p_original_name), '');
  v_title text := nullif(btrim(p_title), '');
  v_content text := nullif(btrim(p_content), '');
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  if p_capture_id is null or p_attachment_id is null then
    raise exception using
      errcode = '22004',
      message = 'Capture and attachment IDs are required.';
  end if;

  if v_title is not null and char_length(v_title) > 500 then
    raise exception using
      errcode = '22001',
      message = 'Title must be 500 characters or fewer.';
  end if;

  if v_original_name is null or char_length(v_original_name) > 255 then
    raise exception using
      errcode = '22023',
      message = 'Original filename must contain 1 to 255 characters.';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then
    raise exception using
      errcode = '22023',
      message = 'Image size must be between 1 byte and 10 MiB.';
  end if;

  v_extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    else null
  end;

  if v_extension is null then
    raise exception using
      errcode = '22023',
      message = 'Only JPEG, PNG, and WebP images are supported.';
  end if;

  v_expected_path :=
    v_user_id::text
    || '/'
    || p_capture_id::text
    || '/'
    || p_attachment_id::text
    || '.'
    || v_extension;

  if p_storage_path is distinct from v_expected_path then
    raise exception using
      errcode = '22023',
      message = 'The image Storage path is invalid.';
  end if;

  if not exists (
    select 1
    from storage.objects as stored_object
    where stored_object.bucket_id = 'capture-images'
      and stored_object.name = v_expected_path
  ) then
    raise exception using
      errcode = 'P0002',
      message = 'The uploaded image object was not found.';
  end if;

  insert into public.captures (
    id,
    user_id,
    kind,
    status,
    title,
    content,
    source_url,
    archived_at
  )
  values (
    p_capture_id,
    v_user_id,
    'image',
    'inbox',
    v_title,
    v_content,
    null,
    null
  )
  on conflict (id) do nothing;

  if not exists (
    select 1
    from public.captures as capture
    where capture.id = p_capture_id
      and capture.user_id = v_user_id
      and capture.kind = 'image'
  ) then
    raise exception using
      errcode = '23505',
      message = 'The capture ID is already in use.';
  end if;

  insert into public.attachments (
    id,
    user_id,
    capture_id,
    storage_path,
    original_name,
    mime_type,
    size_bytes
  )
  values (
    p_attachment_id,
    v_user_id,
    p_capture_id,
    v_expected_path,
    v_original_name,
    p_mime_type,
    p_size_bytes
  )
  on conflict (id) do nothing;

  if not exists (
    select 1
    from public.attachments as attachment
    where attachment.id = p_attachment_id
      and attachment.user_id = v_user_id
      and attachment.capture_id = p_capture_id
      and attachment.storage_path = v_expected_path
      and attachment.original_name = v_original_name
      and attachment.mime_type = p_mime_type
      and attachment.size_bytes = p_size_bytes
  ) then
    raise exception using
      errcode = '23505',
      message = 'The attachment ID is already in use.';
  end if;

  return query
  select p_capture_id, p_attachment_id;
end;
$$;

create or replace function public.delete_image_capture_after_storage(
  p_capture_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_capture_kind text;
  v_storage_prefix text;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  if p_capture_id is null then
    raise exception using
      errcode = '22004',
      message = 'Capture ID is required.';
  end if;

  select capture.kind
  into v_capture_kind
  from public.captures as capture
  where capture.id = p_capture_id
    and capture.user_id = v_user_id
  for update;

  if not found then
    return true;
  end if;

  if v_capture_kind <> 'image' then
    raise exception using
      errcode = '22023',
      message = 'This operation only deletes image captures.';
  end if;

  v_storage_prefix := v_user_id::text || '/' || p_capture_id::text || '/';

  if exists (
    select 1
    from storage.objects as stored_object
    where stored_object.bucket_id = 'capture-images'
      and left(stored_object.name, char_length(v_storage_prefix)) = v_storage_prefix
  ) then
    raise exception using
      errcode = '55000',
      message = 'Remove the stored image before deleting its capture records.';
  end if;

  delete from public.captures as capture
  where capture.id = p_capture_id
    and capture.user_id = v_user_id;

  return true;
end;
$$;

revoke all on function public.finalize_image_capture(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text
) from public, anon, authenticated;
revoke all on function public.delete_image_capture_after_storage(uuid)
from public, anon, authenticated;

grant execute on function public.finalize_image_capture(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text
) to authenticated;
grant execute on function public.delete_image_capture_after_storage(uuid) to authenticated;

comment on function public.finalize_image_capture(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text
) is 'Atomically finalizes one owned image capture after its private Storage object exists.';

comment on function public.delete_image_capture_after_storage(uuid)
is 'Deletes owned image capture metadata only after its private Storage folder is empty.';
