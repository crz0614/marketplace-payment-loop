create table if not exists public.mpl_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text not null,
  role text not null default 'member' check (role in ('member','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.mpl_sessions (
  token_hash text primary key,
  user_id uuid not null references public.mpl_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.mpl_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.mpl_users(id),
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  price_cents integer not null check (price_cents between 50 and 10000000),
  currency text not null default 'usd' check (currency = 'usd'),
  status text not null default 'active' check (status in ('active','paused')),
  created_at timestamptz not null default now()
);

create table if not exists public.mpl_orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.mpl_listings(id),
  buyer_id uuid not null references public.mpl_users(id),
  seller_id uuid not null references public.mpl_users(id),
  quantity integer not null check (quantity between 1 and 20),
  total_cents integer not null check (total_cents > 0),
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending','checkout_failed','paid','refund_pending','refunded')),
  stripe_checkout_id text unique,
  stripe_payment_intent text,
  created_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);

create table if not exists public.mpl_webhook_events (
  id text primary key check (char_length(id) between 3 and 255),
  event_type text not null,
  received_at timestamptz not null default now()
);

create index if not exists mpl_sessions_expiry_idx on public.mpl_sessions(expires_at);
create index if not exists mpl_listings_search_idx on public.mpl_listings using gin (to_tsvector('english', title || ' ' || description));
create index if not exists mpl_orders_buyer_idx on public.mpl_orders(buyer_id, created_at desc);

alter table public.mpl_users enable row level security;
alter table public.mpl_sessions enable row level security;
alter table public.mpl_listings enable row level security;
alter table public.mpl_orders enable row level security;
alter table public.mpl_webhook_events enable row level security;

revoke all on public.mpl_users, public.mpl_sessions, public.mpl_listings, public.mpl_orders, public.mpl_webhook_events from anon, authenticated;

