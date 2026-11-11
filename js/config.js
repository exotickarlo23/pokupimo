/**
 * POKUPIMO – SREDIŠNJA KONFIGURACIJA
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
    z1: { name: 'Zona 1 – Zagreb', surcharge: 0 },   // uključuje i IKEA-u
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
  workingHours: 'Svaki dan, i vikendom',
  workingHoursShort: '08:00–18:00',
  social: {
    instagram: 'https://www.instagram.com/pokupimo',
  },

  /* ---------- PODACI O OBRTU (footer) ---------- */
  company: {
    name: 'GROWZY, obrt za usluge',
    owner: 'vl. Karlo Turić',
    address: 'Čučerska cesta 181A, Zagreb',
  },

  /* ---------- VOZILO ----------
   * Stavke se prikazuju u sekciji „Hoće li stati?” redom kojim su navedene. */
  vehicle: {
    name: 'Citroën Jumpy L1H1 (kraća verzija)',
    specs: [
      { label: 'Teretni prostor', value: 'oko 5 m³' },
      { label: 'Nosivost', value: 'oko 1137 kg' },
      { label: 'Duljina vozila', value: '4,81 m' },
      { label: 'Širina vozila', value: '1,90 m' },
      { label: 'Visina vozila', value: '1,88 m' },
    ],
  },

  /* ---------- SUPABASE ----------
   * Publishable (anon) ključ je javan po dizajnu – zaštita je RLS:
   * javni korisnik smije samo INSERT. */
  supabase: {
    url: 'https://weyhdcyimnefzblmldxz.supabase.co',
    key: 'sb_publishable_aBxytUU8q2CCz0sMRmGRmw_vmI8jtDO',   // publishable ključ (javan)
    table: 'pokupi_bookings',
    bucket: 'pokupi-uploads',
    maxImageMB: 5,
  },

  /* ---------- ANALITIKA ----------
   * Google Tag Manager je glavni: GA4 i Ads oznake postavljaju se u GTM-u.
   * ga4Id / adsId upiši samo ako ih želiš učitati izravno, mimo GTM-a.
   * ID koji sadrži „XXXX” se ne učitava. */
  analytics: {
    gtmId: 'GTM-T4N48274',
    ga4Id: 'G-XXXXXXXXXX',
    adsId: 'AW-XXXXXXXXXX',
    adsLabels: {
      booking: 'XXXXXXXXXXXXXXXX',   // konverzija: uspješna rezervacija
      call: 'XXXXXXXXXXXXXXXX',      // konverzija: klik na poziv
      whatsapp: 'XXXXXXXXXXXXXXXX',  // konverzija: klik na WhatsApp
    },
  },
};
