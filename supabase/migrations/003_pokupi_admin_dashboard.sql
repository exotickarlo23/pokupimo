-- =====================================================================
-- Pokupimo – admin dashboard
-- Administratori (pokupi_admins), troškovnik, uređivanje tekstova,
-- blokirani datumi i prava administratora nad rezervacijama.
-- Javni korisnik i dalje smije samo INSERT u pokupi_bookings; tekstove
-- i blokirane datume smije samo čitati (stranica ih prikazuje).
-- =====================================================================

-- ---------- Administratori ----------
create table if not exists public.pokupi_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.pokupi_admins enable row level security;
revoke all on table public.pokupi_admins from anon, authenticated;
-- Bez politika: tablici se pristupa samo kroz funkciju ispod.

create or replace function public.pokupi_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.pokupi_admins where user_id = (select auth.uid()));
$$;
revoke all on function public.pokupi_is_admin() from public, anon;
grant execute on function public.pokupi_is_admin() to authenticated;

-- ---------- Rezervacije: polja i prava za administratora ----------
alter table public.pokupi_bookings
  add column if not exists final_price numeric(8, 2) check (final_price >= 0),  -- stvarno naplaćeno
  add column if not exists admin_note  text check (char_length(admin_note) <= 2000);

grant select, insert, update, delete on table public.pokupi_bookings to authenticated;

drop policy if exists "pokupi_bookings_admin_all" on public.pokupi_bookings;
create policy "pokupi_bookings_admin_all"
  on public.pokupi_bookings
  for all
  to authenticated
  using ((select public.pokupi_is_admin()))
  with check ((select public.pokupi_is_admin()));

-- ---------- Troškovnik ----------
create table if not exists public.pokupi_expenses (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  date        date not null default current_date,
  category    text not null check (char_length(category) between 1 and 60),
  description text check (char_length(description) <= 500),
  amount      numeric(10, 2) not null check (amount >= 0)
);
alter table public.pokupi_expenses enable row level security;
revoke all on table public.pokupi_expenses from anon, authenticated;
grant select, insert, update, delete on table public.pokupi_expenses to authenticated;

drop policy if exists "pokupi_expenses_admin_all" on public.pokupi_expenses;
create policy "pokupi_expenses_admin_all"
  on public.pokupi_expenses
  for all
  to authenticated
  using ((select public.pokupi_is_admin()))
  with check ((select public.pokupi_is_admin()));

-- ---------- Tekstovi i cijene stranice (samo izmijenjene vrijednosti) ----------
create table if not exists public.pokupi_content (
  key        text primary key check (char_length(key) between 1 and 160),
  value      text not null check (char_length(value) <= 5000),
  updated_at timestamptz not null default now()
);
alter table public.pokupi_content enable row level security;
revoke all on table public.pokupi_content from anon, authenticated;
grant select on table public.pokupi_content to anon, authenticated;
grant insert, update, delete on table public.pokupi_content to authenticated;

drop policy if exists "pokupi_content_public_read" on public.pokupi_content;
create policy "pokupi_content_public_read"
  on public.pokupi_content for select to anon, authenticated using (true);

drop policy if exists "pokupi_content_admin_insert" on public.pokupi_content;
create policy "pokupi_content_admin_insert"
  on public.pokupi_content for insert to authenticated with check ((select public.pokupi_is_admin()));
drop policy if exists "pokupi_content_admin_update" on public.pokupi_content;
create policy "pokupi_content_admin_update"
  on public.pokupi_content for update to authenticated
  using ((select public.pokupi_is_admin())) with check ((select public.pokupi_is_admin()));
drop policy if exists "pokupi_content_admin_delete" on public.pokupi_content;
create policy "pokupi_content_admin_delete"
  on public.pokupi_content for delete to authenticated using ((select public.pokupi_is_admin()));

-- ---------- Blokirani datumi (dani kad ne primamo rezervacije) ----------
create table if not exists public.pokupi_blocked_dates (
  date       date primary key,
  reason     text check (char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
alter table public.pokupi_blocked_dates enable row level security;
revoke all on table public.pokupi_blocked_dates from anon, authenticated;
grant select (date) on table public.pokupi_blocked_dates to anon;   -- razlog nije javan
grant select, insert, update, delete on table public.pokupi_blocked_dates to authenticated;

drop policy if exists "pokupi_blocked_public_read" on public.pokupi_blocked_dates;
create policy "pokupi_blocked_public_read"
  on public.pokupi_blocked_dates for select to anon, authenticated using (true);
drop policy if exists "pokupi_blocked_admin_insert" on public.pokupi_blocked_dates;
create policy "pokupi_blocked_admin_insert"
  on public.pokupi_blocked_dates for insert to authenticated with check ((select public.pokupi_is_admin()));
drop policy if exists "pokupi_blocked_admin_delete" on public.pokupi_blocked_dates;
create policy "pokupi_blocked_admin_delete"
  on public.pokupi_blocked_dates for delete to authenticated using ((select public.pokupi_is_admin()));

-- ---------- Storage: administrator smije vidjeti i obrisati slike ----------
drop policy if exists "pokupi_uploads_admin_read" on storage.objects;
create policy "pokupi_uploads_admin_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'pokupi-uploads' and (select public.pokupi_is_admin()));
drop policy if exists "pokupi_uploads_admin_delete" on storage.objects;
create policy "pokupi_uploads_admin_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'pokupi-uploads' and (select public.pokupi_is_admin()));
