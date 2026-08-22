-- Good News AI Map — the public suggestion queue.
--
-- A suggestion is an INPUT to Loop A, never a shortcut into it. Nothing here
-- reaches the map until an operator harvests and validates the article the same
-- way every other story is validated.
--
-- Shape follows rate_story() in 0001_init.sql: the table is sealed, RLS has no
-- policies at all, and one security-definer function is the only door. There is
-- deliberately no read path — not even for the person who submitted the row.
--
-- NOTE: Supabase's defaults have granted anon privileges on new tables before
-- (TRUNCATE on stories, which ignores RLS). The revoke below is not optional.

create table if not exists public.story_suggestions (
  id          uuid primary key default gen_random_uuid(),

  source_url  text not null,
  place       text not null,
  submitter   text,
  note        text,

  session_id  text,

  status      text not null default 'new',

  created_at  timestamptz not null default now(),

  constraint story_suggestions_status_check
    check (status in ('new','reviewed','harvested','discarded'))
);

create index if not exists story_suggestions_status_idx
  on public.story_suggestions (status, created_at desc);
create index if not exists story_suggestions_session_idx
  on public.story_suggestions (session_id, created_at desc);

-- ================================================================ RLS
alter table public.story_suggestions enable row level security;

-- Zero policies: RLS denies everything, including reads by the submitter.
-- Privileges revoked as well, so a future default grant cannot open a hole.
revoke all on public.story_suggestions from anon, authenticated;

-- ================================================================ write path
create or replace function public.submit_suggestion(
  p_url        text,
  p_place      text,
  p_submitter  text default null,
  p_note       text default null,
  p_session_id text default null
)
returns json
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_url       text := btrim(coalesce(p_url, ''));
  v_place     text := btrim(coalesce(p_place, ''));
  v_submitter text := nullif(btrim(coalesce(p_submitter, '')), '');
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_session   text := nullif(btrim(coalesce(p_session_id, '')), '');
  v_recent    integer;
begin
  if v_url !~* '^https?://[^[:space:]]+\.[^[:space:]]+' or length(v_url) > 2048 then
    raise exception 'invalid url';
  end if;

  if length(v_place) < 2 or length(v_place) > 200 then
    raise exception 'invalid place';
  end if;

  if v_submitter is not null and length(v_submitter) > 200 then
    raise exception 'invalid submitter';
  end if;

  if v_note is not null and length(v_note) > 2000 then
    raise exception 'note too long';
  end if;

  if v_session is null or length(v_session) > 64 then
    raise exception 'invalid session id';
  end if;

  -- Session ids are browser-generated, so this is friction, not a wall. It
  -- keeps an open form from becoming an open firehose.
  select count(*) into v_recent
  from public.story_suggestions
  where session_id = v_session
    and created_at > now() - interval '24 hours';

  if v_recent >= 5 then
    raise exception 'daily suggestion limit reached';
  end if;

  insert into public.story_suggestions (source_url, place, submitter, note, session_id)
  values (v_url, v_place, v_submitter, v_note, v_session);

  -- No id, no row, nothing stored comes back out.
  return json_build_object('ok', true);
end;
$fn$;

revoke all on function public.submit_suggestion(text, text, text, text, text) from public;
grant execute on function public.submit_suggestion(text, text, text, text, text) to anon, authenticated;
