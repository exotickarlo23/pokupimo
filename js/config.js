/**
 * POKUPI – SREDIŠNJA KONFIGURACIJA
 * ---------------------------------------------------------------
 * Sve cijene, zone, termini, kontakti i ID-evi integracija nalaze se
 * OVDJE. Promjena u ovoj datoteci automatski se odražava na kalkulator,
 * kartice usluga, FAQ, zone i formu za rezervaciju.
 *
 * Napomena: meta description i JSON-LD u index.html spominju „od 45 €”
 * kao statičan tekst (zbog SEO-a) – ako mijenjaš najnižu cijenu,
 * promijeni je i tamo.
 */
export const CONFIG = {
  currency: '€',

  /* ---------- USLUGE ---------- */
  services: {
    dostava: {
      name: 'Dostava 1–3 komada',
      base: 45,            // fiksna cijena u €
      includedFloors: 0,   // koliko je katova bez lifta uključeno u cijenu
    },
    unos: {
      name: 'Dostava s unosom (2 osobe)',
      base: 70,
      includedFloors: 1,
    },
    selidba: {
      name: 'Mala selidba (kombi + 2 osobe)',
      hourly: 60,          // cijena po satu u €
      minHours: 2,
      maxHours: 10,
      includedFloors: 0,
    },
  },

  /* ---------- ZONE ---------- */
  zones: {
    z1: { name: 'Zona 1 – Zagreb', surcharge: 0 },
    z2: {
      name: 'Zona 2 – okolica',
      surcharge: 15,       // doplata u €
      places: ['Velika Gorica', 'Samobor', 'Zaprešić', 'Sesvete'],
    },
    z3: {
      name: 'Izvan zona',
      quote: true,         // cijena po ponudi – kalkulator ne računa iznos
      perKm: 1,            // €/km za cijelu rutu uključujući povratak
      min: 60,             // minimalna cijena u €
    },
  },

  /* ---------- DOPLATE ---------- */
  floorSurcharge: 10,      // € po katu bez lifta iznad uključenog
  maxFloors: 20,           // gornja granica u kalkulatoru

  /* ---------- TERMINI (prozori od 2 sata) ---------- */
  timeSlots: ['08–10', '10–12', '12–14', '14–16', '16–18'],

  /* ---------- KONTAKT ---------- */
  contact: {
    phoneDisplay: '095 865 5213',
    phoneIntl: '+385958655213',   // za tel: linkove
    whatsapp: '385958655213',     // za wa.me (bez +)
    whatsappMessage: 'Bok, trebam prijevoz za [datum]…',
  },
  workingHours: 'Svaki dan 08:00–18:00',
  social: {
    tiktok: 'https://www.tiktok.com/@pokupimo',
    instagram: 'https://www.instagram.com/pokupimo',
  },

  /* ---------- VOZILO ----------
   * Dimenzije teretnog prostora: dok su vrijednosti null, na stranici se
   * NE prikazuju. Upiši brojeve (npr. length: 2.86) i blok se sam pojavi. */
  vehicle: {
    name: 'Citroën Jumpy 2008 L2 (duga verzija)',
    cargo: { length: null, width: null, height: null, volume: null }, // m, m, m, m³
  },

  /* ---------- SUPABASE ----------
   * Publishable (anon) ključ je javan po dizajnu – zaštita je RLS:
   * javni korisnik smije samo INSERT. */
  supabase: {
    url: '',               // npr. https://xxxx.supabase.co
    key: '',               // publishable / anon key
    table: 'pokupi_bookings',
    bucket: 'pokupi-uploads',
    maxImageMB: 5,
  },

  /* ---------- ANALITIKA (placeholderi) ----------
   * Dok ID-evi sadrže „XXXX”, skripte se ne učitavaju. */
  analytics: {
    ga4Id: 'G-XXXXXXXXXX',
    adsId: 'AW-XXXXXXXXXX',
    adsLabels: {
      booking: 'XXXXXXXXXXXXXXXX',   // konverzija: uspješna rezervacija
      call: 'XXXXXXXXXXXXXXXX',      // konverzija: klik na poziv
      whatsapp: 'XXXXXXXXXXXXXXXX',  // konverzija: klik na WhatsApp
    },
  },
};
