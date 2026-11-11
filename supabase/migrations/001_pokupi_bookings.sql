-- =====================================================================
-- Pokupimo – rezervacije
-- Tablica pokupi_bookings + Storage bucket pokupi-uploads + RLS.
-- Javni (anon) korisnik smije SAMO INSERT – bez čitanja, izmjene i brisanja.
-- =====================================================================

create table if not exists public.pokupi_bookings (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  service            text not null check (char_length(service) between 1 and 120),
  zone               text not null check (char_length(zone) between 1 and 120),
  floors_no_lift     integer not null default 0 check (floors_no_lift between 0 and 50),
  estimated_price    numeric(8, 2) check (estimated_price >= 0),      -- null = cijena po ponudi
  date               date not null,
  time_slot          text not null check (char_length(time_slot) between 1 and 20),
  pickup_address     text not null check (char_length(pickup_address) between 1 and 300),
  dropoff_address    text not null check (char_length(dropoff_address) between 1 and 300),
  pickup_floor_lift  text check (char_length(pickup_floor_lift) <= 60),
  dropoff_floor_lift text check (char_length(dropoff_floor_lift) <= 60),
  item_description   text not null check (char_length(item_description) between 1 and 1000),
  image_url          text check (char_length(image_url) <= 500),
  listing_url        text check (char_length(listing_url) <= 600),
  name               text not null check (char_length(name) between 1 and 120),
  phone              text not null check (char_length(phone) between 1 and 30),
  email              text check (char_length(email) <= 200),
  note               text check (char_length(note) <= 1000),
  status             text not null default 'novo'
);

comment on table public.pokupi_bookings is 'Rezervacije s pokupimo.com. Javni korisnik smije samo INSERT.';

-- ---------- RLS ----------
alter table public.pokupi_bookings enable row level security;

-- Makni sva zadana prava pa dodijeli samo INSERT, i to samo na stupce iz forme
-- (id, created_at i status javni korisnik ne može sam postaviti).
revoke all on table public.pokupi_bookings from anon, authenticated;
grant insert (
  service, zone, floors_no_lift, estimated_price, date, time_slot,
  pickup_address, dropoff_address, pickup_floor_lift, dropoff_floor_lift,
  item_description, image_url, listing_url, name, phone, email, note
) on table public.pokupi_bookings to anon;

drop policy if exists "pokupi_bookings_public_insert" on public.pokupi_bookings;
create policy "pokupi_bookings_public_insert"
  on public.pokupi_bookings
  for insert
  to anon
  with check (status = 'novo' and date >= current_date - 1);

-- Namjerno NEMA select/update/delete politika → javno čitanje nije moguće.

-- ---------- Storage: slike predmeta ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pokupi-uploads', 'pokupi-uploads', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
)
on conflict (id) do nothing;

-- Javni korisnik smije samo uploadati u ovaj bucket (bez čitanja i listanja).
drop policy if exists "pokupi_uploads_public_insert" on storage.objects;
create policy "pokupi_uploads_public_insert"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'pokupi-uploads');
