-- =====================================================================
-- Pokupi – email notifikacija za svaku novu rezervaciju
-- Trigger nakon INSERT-a poziva Edge funkciju `pokupi-notify` (pg_net),
-- a ona šalje email. URL funkcije i tajni ključ čitaju se iz Vaulta:
--   pokupi_notify_url     – https://<projekt>.supabase.co/functions/v1/pokupi-notify
--   pokupi_notify_secret  – isti niz kao tajna POKUPI_WEBHOOK_SECRET na funkciji
-- Ako tajne nisu postavljene ili poziv ne uspije, rezervacija se SVEJEDNO sprema.
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
  fn_secret text;
begin
  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'pokupi_notify_url';
  select decrypted_secret into fn_secret from vault.decrypted_secrets where name = 'pokupi_notify_secret';
  if fn_url is null or fn_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-pokupi-secret', fn_secret),
    body := jsonb_build_object('record', to_jsonb(new))
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
