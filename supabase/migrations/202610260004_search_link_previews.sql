-- Search also matches link preview titles and descriptions (from 202610260003_link_previews.sql),
-- and returns them so results can show and highlight the page title.
-- Prepared for review only; apply via `supabase db push` (or the SQL editor) after approval.
-- Requires 202610260002 (tags in search) and 202610260003 (preview columns).
--
-- Security is unchanged: security invoker (captures/tags RLS still applies), an explicit
-- auth.uid() check rejects anonymous callers, every table is filtered by the caller's user id,
-- and only `authenticated` may execute the function.
--
-- The return type gains link_title and link_description, so the function is dropped and
-- recreated. Older app builds ignore the extra columns; newer builds work before and after.
--
-- Index use: candidates come from captures_search_idx (title/content/link; that tsvector
-- expression must stay byte-for-byte identical to the index), from captures_link_preview_search_idx
-- below (preview text matching any typed word, mirroring how tags are found), and from tags.
-- Only then is the full query checked against text + preview + tags, so "invoice march" finds a
-- link whose page title says "Invoice" and that is tagged "March".

create index if not exists captures_link_preview_search_idx
  on public.captures
  using gin (
    to_tsvector('simple', coalesce(link_title, '') || ' ' || coalesce(link_description, ''))
  )
  where link_title is not null or link_description is not null;

drop function if exists public.search_captures(text, integer);

create function public.search_captures(
  p_query text,
  p_limit integer default 50
)
returns table (
  id uuid,
  kind text,
  status text,
  title text,
  content text,
  source_url text,
  created_at timestamptz,
  is_favorite boolean,
  tags text[],
  link_title text,
  link_description text,
  rank real
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_query tsquery;
  v_any_query tsquery;
  v_terms text;
  v_any_terms text;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  -- Same tokenising as 202610260002: lexemes of one word are OR'd, words are AND'd, every
  -- lexeme is an escaped, quoted prefix match. v_any_terms ORs every lexeme of every word and is
  -- only used to find tag and preview candidates cheaply.
  select
    string_agg('(' || words.word_query || ')', ' & '),
    string_agg('(' || words.word_query || ')', ' | ')
  into v_terms, v_any_terms
  from (
    select (
      select string_agg(
        '''' || replace(replace(token.lexeme, '\', '\\'), '''', '''''') || ''':*',
        ' | '
      )
      from unnest(to_tsvector('simple', word)) as token
    ) as word_query
    from regexp_split_to_table(btrim(left(coalesce(p_query, ''), 200)), '\s+') as word
    limit 8
  ) as words
  where words.word_query is not null;

  if v_terms is null then
    return;
  end if;

  v_query := to_tsquery('simple', v_terms);
  v_any_query := to_tsquery('simple', v_any_terms);

  return query
  with candidates as (
    select capture.id
    from public.captures as capture
    where capture.user_id = v_user_id
      and to_tsvector(
        'simple',
        coalesce(capture.title, '') || ' ' || coalesce(capture.content, '') || ' ' || coalesce(capture.source_url, '')
      ) @@ v_query
    union
    select capture.id
    from public.captures as capture
    where capture.user_id = v_user_id
      and (capture.link_title is not null or capture.link_description is not null)
      and to_tsvector(
        'simple',
        coalesce(capture.link_title, '') || ' ' || coalesce(capture.link_description, '')
      ) @@ v_any_query
    union
    select link.capture_id
    from public.capture_tags as link
    join public.tags as tag
      on tag.id = link.tag_id
      and tag.user_id = link.user_id
    where link.user_id = v_user_id
      and to_tsvector('simple', tag.name) @@ v_any_query
  ),
  scored as (
    select
      capture.*,
      coalesce(
        (
          select array_agg(tag.name order by lower(tag.name))
          from public.capture_tags as link
          join public.tags as tag
            on tag.id = link.tag_id
            and tag.user_id = link.user_id
          where link.capture_id = capture.id
            and link.user_id = v_user_id
        ),
        '{}'::text[]
      ) as tag_names
    from public.captures as capture
    join candidates on candidates.id = capture.id
    where capture.user_id = v_user_id
  ),
  matched as (
    select
      scored.*,
      to_tsvector(
        'simple',
        coalesce(scored.title, '') || ' ' || coalesce(scored.content, '') || ' ' || coalesce(scored.source_url, '')
      )
      || to_tsvector(
        'simple',
        coalesce(scored.link_title, '') || ' ' || coalesce(scored.link_description, '')
      )
      || to_tsvector('simple', array_to_string(scored.tag_names, ' ')) as document
    from scored
  )
  select
    matched.id,
    matched.kind,
    matched.status,
    matched.title,
    matched.content,
    matched.source_url,
    matched.created_at,
    matched.is_favorite,
    matched.tag_names,
    matched.link_title,
    matched.link_description,
    ts_rank(matched.document, v_query) as rank
  from matched
  where matched.document @@ v_query
  order by rank desc, matched.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.search_captures(text, integer) from public, anon, authenticated;
grant execute on function public.search_captures(text, integer) to authenticated;

comment on function public.search_captures(text, integer)
is 'Prefix full-text search over the caller''s own captures, their link previews and tag names.';
