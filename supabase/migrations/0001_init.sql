-- Good News AI Map — initial schema
-- WRITE SLOW -> DATABASE -> READ FAST.
-- Public users can never write; the ingestion edge function uses the service role.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- ---------------------------------------------------------------- locations
create table if not exists public.locations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  normalized_name   text,
  country           text,
  country_code      text,
  latitude          double precision not null,
  longitude         double precision not null,
  default_radius_km integer default 50,
  last_ingested_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists locations_normalized_name_key
  on public.locations (normalized_name);

drop trigger if exists trg_locations_updated_at on public.locations;
create trigger trg_locations_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- stories
create table if not exists public.stories (
  id               uuid primary key default gen_random_uuid(),

  title            text not null,
  source_url       text not null unique,
  source_name      text,
  published_at     timestamptz,

  location_id      uuid references public.locations(id) on delete set null,
  location_name    text,
  latitude         double precision not null,
  longitude        double precision not null,

  category         text,

  summary          text,
  why_it_matters   text,
  lessons          jsonb,
  actions          jsonb,

  future_outlook   text,

  ai_relevance     boolean not null default false,
  ai_outlook       text,

  image_url        text,

  confidence_score numeric,

  status           text not null default 'processing',

  rejection_reason text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint stories_status_check
    check (status in ('processing','published','rejected')),
  constraint stories_category_check
    check (category is null or category in
      ('environment','community','education','health','innovation','other'))
);

create index if not exists stories_status_idx       on public.stories (status);
create index if not exists stories_location_id_idx  on public.stories (location_id);
create index if not exists stories_published_at_idx on public.stories (published_at desc nulls last);
create index if not exists stories_category_idx     on public.stories (category);
create index if not exists stories_status_geo_idx   on public.stories (status, latitude, longitude);

drop trigger if exists trg_stories_updated_at on public.stories;
create trigger trg_stories_updated_at
  before update on public.stories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- ratings
create table if not exists public.ratings (
  id                   uuid primary key default gen_random_uuid(),
  story_id             uuid not null references public.stories(id) on delete cascade,
  anonymous_session_id text,
  rating               smallint not null,
  created_at           timestamptz not null default now(),

  constraint ratings_value_check check (rating in (-1, 1))
);

create unique index if not exists ratings_story_session_key
  on public.ratings (story_id, anonymous_session_id);
create index if not exists ratings_story_id_idx on public.ratings (story_id);

-- ---------------------------------------------------------------- ingestion_jobs
create table if not exists public.ingestion_jobs (
  id                   uuid primary key default gen_random_uuid(),
  location_id          uuid references public.locations(id) on delete set null,

  status               text not null default 'queued',
  search_query         text,

  candidates_found     integer default 0,
  candidates_processed integer default 0,
  stories_published    integer default 0,
  stories_rejected     integer default 0,

  error_message        text,

  started_at           timestamptz,
  finished_at          timestamptz,
  created_at           timestamptz not null default now(),

  constraint ingestion_jobs_status_check
    check (status in ('queued','searching','processing','completed','failed'))
);

create index if not exists ingestion_jobs_status_idx   on public.ingestion_jobs (status);
create index if not exists ingestion_jobs_location_idx on public.ingestion_jobs (location_id);

-- ================================================================ RLS
alter table public.locations      enable row level security;
alter table public.stories        enable row level security;
alter table public.ratings        enable row level security;
alter table public.ingestion_jobs enable row level security;

-- locations: world-readable
drop policy if exists locations_public_read on public.locations;
create policy locations_public_read
  on public.locations for select
  to anon, authenticated
  using (true);

-- stories: ONLY published rows are visible.
-- processing / rejected rows can never leave the database.
drop policy if exists stories_public_read_published on public.stories;
create policy stories_public_read_published
  on public.stories for select
  to anon, authenticated
  using (status = 'published');

-- ratings + ingestion_jobs: zero policies => RLS denies everything.
-- Ratings are written only through rate_story() below.
revoke all on public.ingestion_jobs from anon, authenticated;
revoke all on public.ratings        from anon, authenticated;

-- No INSERT/UPDATE/DELETE policy exists on any table for anon/authenticated,
-- so public users cannot create, edit, delete or publish stories, nor change
-- publication status. Writes happen only via the service role in edge functions.

-- ================================================================ read-path RPCs

-- Nearby published stories. status = 'published' is hardcoded, so this function
-- cannot be coerced into leaking processing/rejected rows.
create or replace function public.get_nearby_stories(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_km double precision default 50,
  p_category  text default null,
  p_limit     integer default 100
)
returns table (
  id             uuid,
  title          text,
  source_url     text,
  source_name    text,
  published_at   timestamptz,
  location_name  text,
  latitude       double precision,
  longitude      double precision,
  category       text,
  summary        text,
  why_it_matters text,
  ai_relevance   boolean,
  image_url      text,
  distance_km    double precision
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with b as (
    select
      least(greatest(coalesce(p_radius_km, 50), 1), 2000) as r,
      p_lat as lat,
      p_lng as lng
  )
  select
    s.id, s.title, s.source_url, s.source_name, s.published_at,
    s.location_name, s.latitude, s.longitude, s.category,
    s.summary, s.why_it_matters, s.ai_relevance, s.image_url,
    (6371 * acos(least(1, greatest(-1,
        cos(radians(b.lat)) * cos(radians(s.latitude))
      * cos(radians(s.longitude) - radians(b.lng))
      + sin(radians(b.lat)) * sin(radians(s.latitude))
    )))) as distance_km
  from public.stories s, b
  where s.status = 'published'
    and s.latitude  between b.lat - (b.r / 111.0)
                        and b.lat + (b.r / 111.0)
    and s.longitude between b.lng - (b.r / (111.0 * greatest(cos(radians(b.lat)), 0.01)))
                        and b.lng + (b.r / (111.0 * greatest(cos(radians(b.lat)), 0.01)))
    and (p_category is null or s.category = p_category)
    and (6371 * acos(least(1, greatest(-1,
        cos(radians(b.lat)) * cos(radians(s.latitude))
      * cos(radians(s.longitude) - radians(b.lng))
      + sin(radians(b.lat)) * sin(radians(s.latitude))
    )))) <= b.r
  order by s.published_at desc nulls last, distance_km asc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$fn$;

-- Rating counts for one published story. Aggregates only, no row exposure.
create or replace function public.get_story_ratings(p_story_id uuid)
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select json_build_object(
    'useful',     coalesce(count(*) filter (where r.rating = 1), 0),
    'not_useful', coalesce(count(*) filter (where r.rating = -1), 0)
  )
  from public.ratings r
  join public.stories s on s.id = r.story_id and s.status = 'published'
  where r.story_id = p_story_id;
$fn$;

-- Anonymous rating. One vote per (story, session); re-voting replaces it.
create or replace function public.rate_story(
  p_story_id   uuid,
  p_session_id text,
  p_rating     smallint
)
returns json
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_rating not in (-1, 1) then
    raise exception 'rating must be -1 or 1';
  end if;

  if p_session_id is null or length(p_session_id) = 0 or length(p_session_id) > 64 then
    raise exception 'invalid session id';
  end if;

  if not exists (
    select 1 from public.stories
    where id = p_story_id and status = 'published'
  ) then
    raise exception 'story not found';
  end if;

  insert into public.ratings (story_id, anonymous_session_id, rating)
  values (p_story_id, p_session_id, p_rating)
  on conflict (story_id, anonymous_session_id)
  do update set rating = excluded.rating, created_at = now();

  return public.get_story_ratings(p_story_id);
end;
$fn$;

-- Only these three functions are callable by the public.
revoke all on function public.get_nearby_stories(double precision, double precision, double precision, text, integer) from public;
revoke all on function public.get_story_ratings(uuid) from public;
revoke all on function public.rate_story(uuid, text, smallint) from public;

grant execute on function public.get_nearby_stories(double precision, double precision, double precision, text, integer) to anon, authenticated;
grant execute on function public.get_story_ratings(uuid) to anon, authenticated;
grant execute on function public.rate_story(uuid, text, smallint) to anon, authenticated;
