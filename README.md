# Pokupimo – pokupimo.com

Web stranica za Pokupimo, uslugu kombi prijevoza u Zagrebu („Ti kupiš. Mi pokupimo.”).

Statična stranica **bez build koraka i bez biblioteka**: čisti HTML, CSS i ES moduli.
Može se hostati bilo gdje (Vercel, Netlify, Cloudflare Pages, obični hosting) – korijen repozitorija je korijen stranice.

## Struktura

| Putanja | Što je |
| --- | --- |
| `index.html` | Cijela stranica (sekcije, SEO meta, LocalBusiness JSON-LD) |
| `css/styles.css` | Stilovi, animacije, `prefers-reduced-motion` |
| `js/config.js` | **Sve cijene, zone, termini, kontakt, Supabase i analitika ID-evi** |
| `js/pricing.js` | Logika cjenika (čista funkcija, pokrivena testovima) |
| `js/state.js` | Zajedničko stanje kalkulatora i forme |
| `js/main.js` | Kalkulator, ruta s kombijem, animacije |
| `js/booking.js` | Forma: validacija, upload slike, slanje u Supabase |
| `js/analytics.js` | GA4 + Google Ads konverzije (uz privolu) |
| `js/content.js`, `js/site-data.js` | Tekstovi, cijene i blokirani datumi koje administrator mijenja u dashboardu |
| `admin/` | **Admin dashboard** (`/admin/`): pregled, rezervacije, kalendar, troškovnik, tekstovi i cijene |
| `assets/img/` | Logo, kombi i fotografije (WebP) |
| `supabase/migrations/` | SQL: tablica, RLS, Storage bucket, trigger za email |
| `supabase/functions/pokupi-notify/` | Edge funkcija koja šalje email za novu rezervaciju |
| `tests/pricing.test.mjs` | Test kalkulatora za sve kombinacije |

## Česte izmjene

- **Cijene, doplate, termini, telefon, radno vrijeme, društvene mreže** → `js/config.js`.
  Kalkulator, kartice usluga, zone, FAQ i forma čitaju vrijednosti odande.
  (Iznimka: „od 45 €” u `<meta name="description">` i JSON-LD-u u `index.html` je statičan tekst.)
- **Podaci o vozilu** (obujam, nosivost, dimenzije) → `js/config.js` → `vehicle.specs`.
- **Podaci o obrtu u footeru, radno vrijeme, Instagram** → `js/config.js` (`company`, `workingHours`, `social`).
- **Google Tag Manager / Analytics / Ads** → `js/config.js` → `analytics`. Stranica učitava GTM kontejner
  `GTM-T4N48274` uz Google Consent Mode v2: dok posjetitelj ne klikne „Prihvati”, Googleove oznake ne spremaju
  kolačiće. GA4 i Google Ads oznake postavljaju se u GTM-u. U `dataLayer` se šalju događaji
  `generate_lead` (rezervacija, s `value`), `click_call` i `click_whatsapp` – koristi ih kao okidače
  („Custom Event”) u GTM-u.

## Admin dashboard

Dashboard je na `/admin/` (npr. `https://pokupimo.com/admin/`). Prijava je Supabase Auth (email + lozinka).

- **Pregled** – prihod, troškovi i dobit za mjesec, trend zadnjih 6 mjeseci, nadolazeće rezervacije i one koje čekaju potvrdu.
- **Rezervacije** – popis s filtrima i pretragom; detalji, promjena statusa (novo → potvrđeno → odrađeno / otkazano),
  naplaćeni iznos, interna bilješka, slika predmeta, ručni unos rezervacije.
  Prihod se računa samo za status „odrađeno” (naplaćeni iznos, a ako nije upisan – procjena).
- **Kalendar** – mjesečni prikaz; dan se može blokirati pa ga kupci ne mogu odabrati u formi.
- **Troškovnik** – unos troškova po kategorijama, zbroj po kategoriji i razdoblju.
- **Tekstovi i cijene** – svi tekstovi stranice i cijene iz `js/config.js`. U bazu se spremaju samo izmjene
  (tablica `pokupi_content`); „Vrati izvorno” briše izmjenu. Popis tekstova čita se iz `index.html`,
  pa se novi tekst na stranici automatski pojavi u dashboardu.

Tko je administrator određuje tablica `pokupi_admins` (ID korisnika iz Supabase Autha); sva prava provodi RLS
u bazi (`supabase/migrations/003_pokupi_admin_dashboard.sql`). Novi administrator: stvori korisnika u
Supabase → Authentication, pa `insert into pokupi_admins (user_id) values ('<id korisnika>');`.

## Lokalno pokretanje

```bash
npm run dev
```

```bash
npm test
```

## Supabase

Stranica koristi Supabase projekt **slavimo-hr** (`js/config.js` → `supabase`). Tablica `pokupi_bookings`,
bucket `pokupi-uploads`, trigger i funkcija `pokupi-notify` već su postavljeni; SQL je u `supabase/migrations/`
radi ponovljivosti.

Sigurnost: javni korisnik ima **samo INSERT** (i to samo na stupce iz forme). Nema politika za čitanje,
izmjenu ni brisanje. Bucket je privatan i prima samo slike do 5 MB; `image_url` je putanja do objekta
vidljiva iz Supabase sučelja ili preko potpisanog linka u emailu.

### Email notifikacija

Trigger nakon svakog INSERT-a zove Edge funkciju `pokupi-notify` (preko `pg_net`), koja šalje email preko
[Resenda](https://resend.com). Da bi emailovi krenuli, u Supabase → Edge Functions → Secrets treba dodati:

- `RESEND_API_KEY` – API ključ s resend.com
- `POKUPI_NOTIFY_EMAIL` – adresa na koju stižu obavijesti
- `POKUPI_NOTIFY_FROM` – opcionalno, pošiljatelj s vlastite domene

Dok tajne nisu postavljene, rezervacije se normalno spremaju u tablicu, samo email ne stiže.
