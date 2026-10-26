-- Full-text search across all of the signed-in user's captures.
-- Prepared for review only. Apply with `supabase db push` after approval; the web and Android
-- apps fall back to a slower substring search until this function exists.
--
-- The tsvector expression below must stay byte-for-byte identical to captures_search_idx in
-- 202607240001_initial_schema.sql so that Postgres can use that GIN index.

create or replace function public.search_captures(
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
  v_terms text;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  -- Tokenise each typed word with the same 'simple' parser the index uses, so "example.com"
  -- stays one lexeme. Lexemes from one word are OR'd ("über-straße" -> über | straße |
  -- über-straße), words are AND'd, and every lexeme is a prefix match. Each lexeme is quoted
  -- and escaped, so user input never reaches to_tsquery as operators.
  select string_agg('(' || words.word_query || ')', ' & ')
  into v_terms
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

  return query
  select
    capture.id,
    capture.kind,
    capture.status,
    capture.title,
    capture.content,
    capture.source_url,
    capture.created_at,
    ts_rank(
      to_tsvector(
        'simple',
        coalesce(capture.title, '') || ' ' || coalesce(capture.content, '') || ' ' || coalesce(capture.source_url, '')
      ),
      v_query
    ) as rank
  from public.captures as capture
  where capture.user_id = v_user_id
    and to_tsvector(
      'simple',
      coalesce(capture.title, '') || ' ' || coalesce(capture.content, '') || ' ' || coalesce(capture.source_url, '')
    ) @@ v_query
  order by rank desc, capture.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.search_captures(text, integer) from public, anon, authenticated;
grant execute on function public.search_captures(text, integer) to authenticated;

comment on function public.search_captures(text, integer)
is 'Prefix full-text search over the caller''s own captures using captures_search_idx.';
