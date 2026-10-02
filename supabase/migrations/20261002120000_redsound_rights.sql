-- Red Sound rights model.
-- Musical works and sound recordings are stored apart.
-- Marketplace checkout stays a later step; the tables exist so listings,
-- licences, and payouts do not need a redesign.

create table if not exists profiles (
  id uuid primary key,
  display_name text not null,
  handle text not null
);

create table if not exists musical_works (
  id uuid primary key,
  owner_id uuid not null references profiles (id),
  title text not null,
  lyrics text,
  created_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key,
  owner_id uuid not null references profiles (id),
  title text not null,
  kind text not null check (kind in ('beat', 'song', 'sample', 'stem', 'vocal', 'full_mix', 'lyrics')),
  bpm integer,
  musical_key text,
  duration_sec numeric,
  audio_url text,
  image_url text,
  media_id text,
  mime_type text,
  work_id uuid references musical_works (id),
  project_id uuid,
  stem_name text,
  created_at timestamptz not null default now()
);

create table if not exists sound_recordings (
  id uuid primary key,
  owner_id uuid not null references profiles (id),
  title text not null,
  work_id uuid references musical_works (id),
  asset_id uuid not null references assets (id),
  created_at timestamptz not null default now()
);

alter table assets
  add column if not exists recording_id uuid references sound_recordings (id);

create table if not exists asset_provenance (
  asset_id uuid primary key references assets (id),
  origin text not null check (origin in ('human_created', 'ai_assisted', 'ai_generated', 'imported')),
  provider text,
  provider_job_id text,
  provider_audio_id text,
  model text,
  prompt text,
  lyrics text,
  style text,
  provider_terms_acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists provenance_components (
  id uuid primary key,
  asset_id uuid not null references assets (id),
  role text not null,
  origin text not null,
  parent_asset_id uuid references assets (id),
  note text
);

create table if not exists right_splits (
  id uuid primary key,
  subject_type text not null check (subject_type in ('work', 'recording')),
  subject_id uuid not null,
  name text not null,
  role text not null check (role in ('writer', 'publisher', 'master_owner', 'producer', 'performer')),
  share_bps integer not null check (share_bps > 0 and share_bps <= 10000)
);

create table if not exists rights_declarations (
  asset_id uuid primary key references assets (id),
  created_this_work boolean not null,
  controls_recording boolean not null,
  samples_cleared boolean not null,
  contributors_permitted boolean not null,
  accepts_responsibility boolean not null,
  uses_samples boolean not null,
  signed_at timestamptz
);

create table if not exists sample_clearances (
  id uuid primary key,
  asset_id uuid not null references assets (id),
  source text not null,
  proof_note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key,
  owner_id uuid not null references profiles (id),
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists listings (
  id uuid primary key,
  seller_id uuid not null references profiles (id),
  title text not null,
  status text not null check (status in ('draft', 'held_for_counsel', 'published', 'sold_exclusive', 'removed')),
  genre text,
  bpm integer,
  musical_key text,
  hold_reasons jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists listing_assets (
  listing_id uuid not null references listings (id),
  asset_id uuid not null references assets (id),
  primary key (listing_id, asset_id)
);

create table if not exists license_offers (
  id uuid primary key,
  listing_id uuid not null references listings (id),
  tier text not null,
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'ZAR',
  deliverables jsonb not null,
  summary text not null,
  commercial boolean not null,
  exclusive boolean not null
);

create table if not exists license_grants (
  id uuid primary key,
  grant_number text not null unique,
  listing_id uuid not null references listings (id),
  offer_id uuid not null references license_offers (id),
  asset_id uuid not null references assets (id),
  buyer_name text not null,
  license_tier text not null,
  price_cents integer not null,
  platform_fee_cents integer not null,
  creator_share_cents integer not null,
  currency text not null default 'ZAR',
  status text not null check (status in ('active', 'refunded', 'revoked')),
  purchased_at timestamptz not null default now(),
  payment_provider text not null default 'redface',
  payment_ref text
);

create table if not exists ledger_entries (
  id uuid primary key,
  grant_id uuid references license_grants (id),
  kind text not null check (kind in ('sale', 'platform_fee', 'creator_share', 'refund')),
  amount_cents integer not null,
  currency text not null default 'ZAR',
  party text not null,
  note text not null,
  created_at timestamptz not null default now()
);

create table if not exists provider_tasks (
  id uuid primary key,
  owner_id uuid not null references profiles (id),
  kind text not null,
  suno_task_id text,
  status text not null,
  request jsonb not null,
  error text,
  project_id uuid references projects (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
