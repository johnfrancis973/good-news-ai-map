-- Good News AI Map — automatic verification of public submissions.
--
-- 0002 made the suggestion queue a dead end on purpose: a sealed table, no read
-- path, and an operator with a CLI. This migration keeps the seal and removes
-- the dead end. A submitted link is now checked automatically, by the SAME
-- pipeline every harvested story goes through, and the row records what
-- happened to it.
--
-- Two things this must not become:
--   * a way around verdictFor() — the edge function calls the shared
--     processCandidate(), never a softer copy of it;
--   * a way to spend the Firecrawl and OpenAI budget — hence
--     claim_verification_slot() below.
--
-- The table stays unreadable. Everything here is a function, and every function
-- is either security-definer with its own validation, or service-role only.

-- ================================================================ columns

alter table public.story_suggestions
  add column if not exists latitude          double precision,
  add column if not exists longitude         double precision,
  -- Closes the gap 0002 left open: a suggestion could never be joined to the
  -- story it produced, so 'harvested' recorded a belief rather than a fact.
  add column if not exists story_id          uuid references public.stories(id) on delete set null,
  add column if not exists rejection_reason  text,
  add column if not exists verify_started_at timestamptz,
  add column if not exists verified_at       timestamptz;

-- 'verifying' / 'published' / 'rejected' are the machine's states. The four
-- original values stay so scripts/suggestions.mjs keeps working and so an
-- operator can still overrule the machine by hand.
alter table public.story_suggestions
  drop constraint if exists story_suggestions_status_check;

alter table public.story_suggestions
  add constraint story_suggestions_status_check
    check (status in (
      'new','verifying','published','rejected',
      'reviewed','harvested','discarded'
    ));

-- The budget query counts rows inside a rolling 24h window.
create index if not exists story_suggestions_verify_started_idx
  on public.story_suggestions (verify_started_at desc)
  where verify_started_at is not null;

-- ================================================================ write path

-- Replaces the 5-arg version from 0002. Same validation, same rate limit, plus
-- the resolved coordinates and the row id.
--
-- Returning the id is not a hole in the seal: it is a random uuid for a row the
-- caller just created, the table still has zero RLS policies, and the revoke
-- below still stands. Nothing can be read back with it.
drop function if exists public.submit_suggestion(text, text, text, text, text);

create or replace function public.submit_suggestion(
  p_url        text,
  p_place      text,
  p_submitter  text default null,
  p_note       text default null,
  p_session_id text default null,
  p_latitude   double precision default null,
  p_longitude  double precision default null
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
  v_lat       double precision := p_latitude;
  v_lng       double precision := p_longitude;
  v_recent    integer;
  v_id        uuid;
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

  -- Coordinates are optional: a place nobody can resolve is still a suggestion
  -- worth keeping, it just waits for a human instead of being checked. Garbage
  -- is dropped rather than rejected, for the same reason.
  if v_lat is null or v_lng is null
     or abs(v_lat) > 90 or abs(v_lng) > 180 then
    v_lat := null;
    v_lng := null;
  end if;

  -- Session ids are browser-generated, so this is friction, not a wall. It
  -- keeps an open form from becoming an open firehose. The real ceiling on
  -- spending is claim_verification_slot().
  select count(*) into v_recent
  from public.story_suggestions
  where session_id = v_session
    and created_at > now() - interval '24 hours';

  if v_recent >= 5 then
    raise exception 'daily suggestion limit reached';
  end if;

  insert into public.story_suggestions
    (source_url, place, submitter, note, session_id, latitude, longitude)
  values
    (v_url, v_place, v_submitter, v_note, v_session, v_lat, v_lng)
  returning id into v_id;

  return json_build_object('ok', true, 'id', v_id);
end;
$fn$;

revoke all on function public.submit_suggestion(
  text, text, text, text, text, double precision, double precision
) from public;
grant execute on function public.submit_suggestion(
  text, text, text, text, text, double precision, double precision
) to anon, authenticated;

-- ================================================================ spend ceiling

-- The global cap on paid verification. The per-session limit above is friction
-- only: session ids are minted in the browser, so anyone willing to clear
-- localStorage can mint more. This is the number that actually bounds the
-- Firecrawl and OpenAI bill.
--
-- Returns true if this suggestion may be verified now, false if the day's
-- budget is spent. False is not an error: the suggestion simply stays 'new'
-- and waits for a human, and the submitter is never told a different story.
create or replace function public.claim_verification_slot(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  -- One knob. Raising it is a one-line migration.
  c_daily_budget constant integer := 50;
  v_used  integer;
  v_taken integer;
begin
  -- Count and claim must be one atomic step, or two concurrent submissions
  -- both read 49 and both proceed. Transaction-scoped, released on commit.
  perform pg_advisory_xact_lock(hashtext('gnam.verify_budget'));

  select count(*) into v_used
  from public.story_suggestions
  where verify_started_at > now() - interval '24 hours';

  if v_used >= c_daily_budget then
    return false;
  end if;

  -- Only a row still waiting can be claimed, so a retry cannot spend twice.
  update public.story_suggestions
     set verify_started_at = now(),
         status            = 'verifying'
   where id = p_id
     and status = 'new'
     and verify_started_at is null;

  get diagnostics v_taken = row_count;
  return v_taken = 1;
end;
$fn$;

-- Service-role only. Nothing reachable with the publishable key may decide to
-- spend money.
revoke all on function public.claim_verification_slot(uuid)
  from public, anon, authenticated;
