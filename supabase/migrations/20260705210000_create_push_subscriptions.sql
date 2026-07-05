-- Push subscriptions for the "order needs you" notify layer (2026-07-05).
-- Census core-promise item #7: 8 bottles went OOS on order day and the app
-- waited SILENTLY for Tony to reopen it. This table holds each device's Web
-- Push subscription so the API can tell the store owner the moment a run
-- finishes and needs a decision.
--
-- ADDITIVE + INERT: nothing reads or writes this table until the push routes
-- and the finalize hook ship, and those are dormant without VAPID env keys.
--
-- endpoint  the browser push service capability URL (unique per device+app;
--           treated as a secret — never logged in full).
-- keys      { p256dh, auth } encryption keys from PushSubscription.toJSON().
-- Scoped by store_id: every device registered to a store gets that store's
-- run notifications. Cascade-deletes with the store.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  endpoint text not null,
  keys jsonb not null,
  user_agent text,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- Upsert target: re-subscribing the same device updates in place.
create unique index if not exists push_subscriptions_endpoint_unique
  on public.push_subscriptions (endpoint);

create index if not exists push_subscriptions_store_idx
  on public.push_subscriptions (store_id);

alter table public.push_subscriptions enable row level security;

-- House pattern (same as upc_mappings): all access flows through the API with
-- the service role; resolveAuthenticatedStore enforces store scoping there.
create policy "Service role can do everything"
  on public.push_subscriptions
  for all
  to service_role
  using (true)
  with check (true);
