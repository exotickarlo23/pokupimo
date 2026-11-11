-- =====================================================================
-- Pokupimo – email notifikacija za svaku novu rezervaciju
-- Trigger nakon INSERT-a poziva Edge funkciju `pokupi-notify` (pg_net),
-- a ona šalje email. Šalje se samo ID rezervacije; funkcija sama učita red.
-- URL funkcije čita se iz Vaulta:
--   pokupi_notify_url  – https://<projekt>.supabase.co/functions/v1/pokupi-notify
--   (select vault.create_secret('<url>', 'pokupi_notify_url');)
-- Ako URL nije postavljen ili poziv ne uspije, rezervacija se SVEJEDNO sprema.
-- =====================================================================

create extension if not exists pg_net;

create or replace function public.pokupi_notify_new_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fn_url text;
begin
  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'pokupi_notify_url';
  if fn_url is null then
    return new;
  end if;

  perform net.http_post(
    url := fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('id', new.id)
  );
  return new;
exception when others then
  -- notifikacija nikad ne smije srušiti spremanje rezervacije
  raise warning 'pokupi_notify_new_booking: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.pokupi_notify_new_booking() from public, anon, authenticated;

drop trigger if exists pokupi_bookings_notify on public.pokupi_bookings;
create trigger pokupi_bookings_notify
  after insert on public.pokupi_bookings
  for each row execute function public.pokupi_notify_new_booking();
