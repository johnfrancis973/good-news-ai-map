-- Good News AI Map — the sponsorship and donation queue.
--
-- Same shape as story_suggestions in 0002: the table is sealed, RLS carries no
-- policies at all, and one security-definer function is the only door. There is
-- deliberately no read path — not for the sender, not for anyone holding the
-- public key. An operator reads these with the service role.
--
-- This replaces a mailto: link. mailto fails silently when no mail client is
-- registered, so a visitor could finish the form and send nothing at all. A row
-- in a table cannot fail silently.
--
-- NOTE: Supabase's defaults have granted anon privileges on new tables before
-- (TRUNCATE on stories, which ignores RLS). The revoke below is not optional.

create table if not exists public.support_requests (
  id          uuid primary key default gen_random_uuid(),

  intent      text not null,
  supporter   text not null,
  email       text not null,
  amount      text,
  message     text,

  session_id  text,

  status      text not null default 'new',

  created_at  timestamptz not null default now(),

  constraint support_requests_intent_check
    check (intent in ('sponsor','donate')),
  constraint support_requests_status_check
    check (status in ('new','contacted','closed','discarded'))
);

create index if not exists support_requests_status_idx
  on public.support_requests (status, created_at desc);
create index if not exists support_requests_session_idx
  on public.support_requests (session_id, created_at desc);

-- ================================================================ RLS
alter table public.support_requests enable row level security;

-- Zero policies: RLS denies everything, including reads by the sender.
-- Privileges revoked as well, so a future default grant cannot open a hole.
revoke all on public.support_requests from anon, authenticated;

-- ================================================================ write path
create or replace function public.submit_support_request(
  p_intent     text,
  p_supporter  text,
  p_email      text,
  p_amount     text default null,
  p_message    text default null,
  p_session_id text default null
)
returns json
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_intent    text := btrim(coalesce(p_intent, ''));
  v_supporter text := btrim(coalesce(p_supporter, ''));
  v_email     text := btrim(coalesce(p_email, ''));
  v_amount    text := nullif(btrim(coalesce(p_amount, '')), '');
  v_message   text := nullif(btrim(coalesce(p_message, '')), '');
  v_session   text := nullif(btrim(coalesce(p_session_id, '')), '');
  v_recent    integer;
begin
  if v_intent not in ('sponsor', 'donate') then
    raise exception 'invalid intent';
  end if;

  if length(v_supporter) < 2 or length(v_supporter) > 200 then
    raise exception 'invalid name';
  end if;

  if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_email) > 200 then
    raise exception 'invalid email';
  end if;

  if v_amount is not null and length(v_amount) > 120 then
    raise exception 'amount too long';
  end if;

  if v_message is not null and length(v_message) > 2000 then
    raise exception 'message too long';
  end if;

  if v_session is null or length(v_session) > 64 then
    raise exception 'invalid session id';
  end if;

  -- Session ids are browser-generated, so this is friction, not a wall. It
  -- keeps an open form from becoming an open firehose.
  select count(*) into v_recent
  from public.support_requests
  where session_id = v_session
    and created_at > now() - interval '24 hours';

  if v_recent >= 5 then
    raise exception 'daily limit reached';
  end if;

  insert into public.support_requests (intent, supporter, email, amount, message, session_id)
  values (v_intent, v_supporter, v_email, v_amount, v_message, v_session);

  -- No id, no row, nothing stored comes back out.
  return json_build_object('ok', true);
end;
$fn$;

revoke all on function public.submit_support_request(text, text, text, text, text, text) from public;
grant execute on function public.submit_support_request(text, text, text, text, text, text) to anon, authenticated;
