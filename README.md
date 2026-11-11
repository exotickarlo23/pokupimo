# Pokupi – pokupimo.com

Web stranica za Pokupi, uslugu kombi prijevoza u Zagrebu („Ti kupiš. Mi pokupimo.”).

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
| `supabase/migrations/` | SQL: tablica, RLS, Storage bucket, trigger za email |
| `supabase/functions/pokupi-notify/` | Edge funkcija koja šalje email za novu rezervaciju |
| `tests/pricing.test.mjs` | Test kalkulatora za sve kombinacije |

## Česte izmjene

- **Cijene, doplate, termini, telefon, radno vrijeme, društvene mreže** → `js/config.js`.
  Kalkulator, kartice usluga, zone, FAQ i forma čitaju vrijednosti odande.
  (Iznimka: „od 45 €” u `<meta name="description">` i JSON-LD-u u `index.html` je statičan tekst.)
- **Dimenzije teretnog prostora** → `js/config.js` → `vehicle.cargo`. Dok su `null`, ne prikazuju se.
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

1. Pokreni `supabase/migrations/001_pokupi_bookings.sql` (tablica `pokupi_bookings`, RLS, bucket `pokupi-uploads`).
2. U `js/config.js` upiši `supabase.url` i `supabase.key` (publishable/anon ključ – javan je po dizajnu).

Sigurnost: javni korisnik ima **samo INSERT** (i to samo na stupce iz forme). Nema politika za čitanje,
izmjenu ni brisanje. Bucket je privatan; `image_url` je putanja do objekta vidljiva samo iz Supabase sučelja
ili preko potpisanog linka u emailu.

### Email notifikacija

1. Pokreni `supabase/migrations/002_pokupi_email_notification.sql` (trigger → Edge funkcija preko `pg_net`).
2. Deployaj funkciju `pokupi-notify` (bez JWT provjere – funkcija sama provjerava tajno zaglavlje).
3. Postavi tajne funkcije: `POKUPI_WEBHOOK_SECRET`, `RESEND_API_KEY`, `POKUPI_NOTIFY_EMAIL`
   (opcionalno `POKUPI_NOTIFY_FROM`).
4. U Vault dodaj `pokupi_notify_url` (URL funkcije) i `pokupi_notify_secret` (isti niz kao `POKUPI_WEBHOOK_SECRET`).

Ako email ne uspije, rezervacija se svejedno sprema u tablicu.
