-- Private, user-owned interaction state for the SWEET Garden.
-- Growth continues to derive only from participation records; these tables do
-- not store scores, streaks, diagnoses, AI output, or public profile data.
create table public.tempo_garden_care_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  care_date date not null,
  action text not null check (action in ('water', 'sunlight', 'invite_visitor')),
  created_at timestamptz not null default now(),
  unique (user_id, care_date)
);

create index tempo_garden_care_events_user_created_idx
on public.tempo_garden_care_events(user_id, created_at desc);

create table public.tempo_garden_layout_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null check (slot in ('flower_border', 'hill_path', 'pond_edge', 'bench_corner')),
  item_key text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot),
  check (
    (slot = 'flower_border' and item_key in ('wildflower_patch', 'low_fern'))
    or (slot = 'hill_path' and item_key in ('flat_stones', 'wooden_sign'))
    or (slot = 'pond_edge' and item_key in ('water_grass', 'small_birdbath'))
    or (slot = 'bench_corner' and item_key in ('linen_cushion', 'warm_lantern'))
  )
);

create table public.tempo_garden_keepsakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  keepsake_date date not null,
  keepsake_type text not null check (keepsake_type in ('flower', 'stone', 'lantern')),
  created_at timestamptz not null default now(),
  unique (user_id, keepsake_date)
);

alter table public.tempo_garden_care_events enable row level security;
alter table public.tempo_garden_layout_items enable row level security;
alter table public.tempo_garden_keepsakes enable row level security;

revoke all on table public.tempo_garden_care_events from public, anon, authenticated;
revoke all on table public.tempo_garden_layout_items from public, anon, authenticated;
revoke all on table public.tempo_garden_keepsakes from public, anon, authenticated;

grant select, insert, update, delete on table public.tempo_garden_care_events to service_role;
grant select, insert, update, delete on table public.tempo_garden_layout_items to service_role;
grant select, insert, update, delete on table public.tempo_garden_keepsakes to service_role;

-- These policies are defense in depth if authenticated table grants are added
-- later. Browser clients currently hold no privileges on the tables.
create policy tempo_garden_care_events_select_own
on public.tempo_garden_care_events for select to authenticated
using ((select auth.uid()) = user_id);

create policy tempo_garden_care_events_insert_own
on public.tempo_garden_care_events for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy tempo_garden_care_events_update_own
on public.tempo_garden_care_events for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy tempo_garden_care_events_delete_own
on public.tempo_garden_care_events for delete to authenticated
using ((select auth.uid()) = user_id);

create policy tempo_garden_layout_items_select_own
on public.tempo_garden_layout_items for select to authenticated
using ((select auth.uid()) = user_id);

create policy tempo_garden_layout_items_insert_own
on public.tempo_garden_layout_items for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy tempo_garden_layout_items_update_own
on public.tempo_garden_layout_items for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy tempo_garden_layout_items_delete_own
on public.tempo_garden_layout_items for delete to authenticated
using ((select auth.uid()) = user_id);

create policy tempo_garden_keepsakes_select_own
on public.tempo_garden_keepsakes for select to authenticated
using ((select auth.uid()) = user_id);

create policy tempo_garden_keepsakes_insert_own
on public.tempo_garden_keepsakes for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy tempo_garden_keepsakes_update_own
on public.tempo_garden_keepsakes for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy tempo_garden_keepsakes_delete_own
on public.tempo_garden_keepsakes for delete to authenticated
using ((select auth.uid()) = user_id);
