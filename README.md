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
- **Google Analytics / Ads** → `js/config.js` → `analytics`. Dok ID-evi sadrže `XXXX`, ništa se ne učitava.
  Kad se upišu, pojavljuje se traka za privolu, a `gtag` se učitava tek nakon prihvaćanja.
  Događaji: uspješna rezervacija (`generate_lead`), klik na poziv (`click_call`), klik na WhatsApp (`click_whatsapp`).

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
