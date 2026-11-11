/**
 * Forma za rezervaciju:
 *  - dijeli stanje s kalkulatorom (usluga, zona, katovi → procjena cijene)
 *  - validacija na hrvatskom s inline greškama
 *  - slanje preko fetch-a u Supabase (tablica + Storage), bez reloada
 *  - animirana potvrda nakon uspjeha
 *
 * Supabase se zove izravno preko REST API-ja, pa nije potrebna
 * nikakva biblioteka. RLS dopušta javnom korisniku samo INSERT.
 */
import { CONFIG } from './config.js';
import { calcPrice, serviceLabel } from './pricing.js';
import { getState, setState, subscribe } from './state.js';
import { track } from './analytics.js';

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- Pomoćne funkcije ---------- */

/** Današnji datum kao YYYY-MM-DD u lokalnoj zoni. */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** YYYY-MM-DD → DD.MM.YYYY. */
function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}.`;
}
/** Hrvatska množina: 1 kat, 2 kata, 5 katova. */
export function floorsText(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} kat`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} kata`;
  return `${n} katova`;
}

/** Provjera blokiranih datuma (postavlja se u initBooking iz admin podataka). */
let isDateBlocked = () => false;

/* ---------- Pravila validacije (poruke na hrvatskom) ---------- */
const validators = {
  date(v) {
    if (!v) return 'Odaberi datum.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) return 'Datum nije ispravan.';
    if (v < todayISO()) return 'Datum ne može biti u prošlosti.';
    if (isDateBlocked(v)) return 'Taj dan ne primamo rezervacije. Odaberi drugi datum ili nas nazovi.';
    return '';
  },
  time_slot(v) {
    return v ? '' : 'Odaberi termin.';
  },
  pickup_address(v) {
    return v.trim().length >= 5 ? '' : 'Upiši adresu preuzimanja (ulica, broj i mjesto).';
  },
  dropoff_address(v) {
    return v.trim().length >= 5 ? '' : 'Upiši adresu dostave (ulica, broj i mjesto).';
  },
  pickup_floor(v) {
    return v === '' ? 'Odaberi kat.' : '';
  },
  dropoff_floor(v) {
    return v === '' ? 'Odaberi kat.' : '';
  },
  pickup_lift(v, form) {
    return Number(form.elements.pickup_floor.value) > 0 && !v ? 'Odaberi ima li lift.' : '';
  },
  dropoff_lift(v, form) {
    return Number(form.elements.dropoff_floor.value) > 0 && !v ? 'Odaberi ima li lift.' : '';
  },
  item_description(v) {
    return v.trim().length >= 3 ? '' : 'Opiši što vozimo (npr. „trosjed i dvije kutije”).';
  },
  listing_url(v) {
    if (!v.trim()) return '';
    return normalizeUrl(v) ? '' : 'Link nije ispravan. Zalijepi cijelu adresu oglasa.';
  },
  name(v) {
    return v.trim().length >= 2 ? '' : 'Upiši ime i prezime.';
  },
  phone(v) {
    if (!v.trim()) return 'Upiši broj telefona — zovemo te da potvrdimo termin.';
    const digits = v.replace(/\D/g, '');
    if (!/^[+\d\s\-/().]+$/.test(v.trim()) || digits.length < 8 || digits.length > 15) {
      return 'Broj telefona nije ispravan (npr. 091 234 5678).';
    }
    return '';
  },
  email(v) {
    if (!v.trim()) return '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Email adresa nije ispravna.';
  },
};

/** Vrati ispravan http(s) URL ili null. Dodaje https:// ako nedostaje. */
function normalizeUrl(value) {
  let v = value.trim();
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const url = new URL(v);
    return url.hostname.includes('.') ? url.href : null;
  } catch {
    return null;
  }
}

/* ---------- Slika: smanjivanje i pretvorba u WebP prije uploada ---------- */
async function prepareImage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    // Safari stariji od 16 ne podržava WebP export → vrati original
    if (blob && blob.type === 'image/webp' && blob.size < file.size) return { blob, ext: 'webp' };
  } catch { /* preglednik ne može dekodirati sliku – šaljemo original */ }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
  return { blob: file, ext };
}

/* ---------- Supabase REST ---------- */
async function supabaseFetch(path, options) {
  const { url, key } = CONFIG.supabase;
  if (!url || !key) throw new Error('Supabase nije konfiguriran (js/config.js).');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${url}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Upload slike u Storage; vraća URL objekta (bucket je privatan). */
async function uploadImage(file) {
  const { blob, ext } = await prepareImage(file);
  if (blob.size > CONFIG.supabase.maxImageMB * 1024 * 1024) {
    const err = new Error('Slika je prevelika.');
    err.field = 'image';
    throw err;
  }
  const { bucket, url } = CONFIG.supabase;
  const objectPath = `${todayISO().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  await supabaseFetch(`/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'false' },
    body: blob,
  });
  return `${url}/storage/v1/object/${bucket}/${objectPath}`;
}

async function insertBooking(row) {
  await supabaseFetch(`/rest/v1/${CONFIG.supabase.table}`, {
    method: 'POST',
    // return=minimal: javni korisnik nema pravo čitanja, pa ne tražimo red natrag
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
}

/* ---------- Inicijalizacija forme ---------- */
export function initBooking({ updateWhatsAppLinks, isBlocked }) {
  if (isBlocked) isDateBlocked = isBlocked;
  const form = $('#booking');
  const el = form.elements;
  const submitBtn = $('#booking-submit');
  const errorBox = $('#booking-error');
  const touched = new Set();
  let sending = false;

  /* --- dinamički dijelovi forme --- */
  el.date.min = todayISO();

  $('#b-slots').replaceChildren(...CONFIG.timeSlots.map((slot) => {
    const label = document.createElement('label');
    label.className = 'slot';
    label.innerHTML = '<input type="radio" name="time_slot"><span></span>';
    label.firstChild.value = slot;
    label.lastChild.textContent = slot;
    return label;
  }));

  form.querySelectorAll('[data-floor]').forEach((select) => {
    select.add(new Option('Odaberi…', ''));
    select.add(new Option('Prizemlje', '0'));
    for (let i = 1; i <= 15; i++) select.add(new Option(`${i}. kat`, String(i)));
  });

  /** Za današnji datum onemogući termine koji su već počeli. */
  function refreshSlots() {
    const isToday = el.date.value === todayISO();
    const hour = new Date().getHours();
    form.querySelectorAll('input[name=time_slot]').forEach((input) => {
      const startHour = parseInt(input.value, 10);
      input.disabled = isToday && hour >= startHour;
      if (input.disabled) input.checked = false;
    });
  }

  /** Lift je bitan samo ako nije prizemlje. */
  function refreshLift(prefix) {
    const floor = el[`${prefix}_floor`].value;
    const lift = el[`${prefix}_lift`];
    lift.disabled = floor === '' || floor === '0';
    if (lift.disabled) {
      lift.value = '';
      setError(lift, '');
    }
  }

  /** Katovi bez lifta izvedeni iz forme → zajedničko stanje (ažurira i cijenu). */
  function syncFloorsFromForm() {
    const parts = ['pickup', 'dropoff'].map((prefix) => {
      const floor = el[`${prefix}_floor`].value;
      const lift = el[`${prefix}_lift`].value;
      if (floor === '') return null;                 // još nije odabrano
      if (floor === '0') return 0;
      if (lift === '') return null;
      return lift === 'ne' ? Number(floor) : 0;
    });
    if (parts.every((p) => p !== null)) setState({ floors: parts[0] + parts[1] });
  }

  /* --- greške --- */
  function setError(input, message) {
    const field = input instanceof RadioNodeList ? $('#b-slot-group') : input;
    const errorEl = input instanceof RadioNodeList ? $('#b-slot-error') : $(`#${input.id}-error`);
    if (!errorEl) return;
    errorEl.textContent = message;
    if (message) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', errorEl.id);
    } else {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
    }
  }

  function validateField(name) {
    const input = el[name];
    const message = validators[name](input.value, form);
    setError(input, message);
    return !message;
  }

  function validateImage() {
    const file = el.image.files[0];
    let message = '';
    if (file && !file.type.startsWith('image/')) message = 'Datoteka mora biti slika (JPG, PNG ili WebP).';
    else if (file && file.size > 25 * 1024 * 1024) message = 'Slika je prevelika. Odaberi manju sliku.';
    setError(el.image, message);
    return !message;
  }

  /* --- sažetak s procjenom cijene (iz zajedničkog stanja) --- */
  subscribe((s) => {
    const result = calcPrice(s);
    el.service.value = s.service;
    const detail = [CONFIG.zones[s.zone].name];
    if (result.hours) detail.push(`${result.hours} h`);
    detail.push(s.floors > 0 ? `${floorsText(s.floors)} bez lifta` : 'bez katova');
    $('#summary-detail').textContent = detail.join(' · ');
    const priceEl = $('#summary-price');
    priceEl.textContent = result.quote ? 'Po ponudi' : `${result.total} €`;
    priceEl.classList.toggle('is-quote', result.quote);
    submitBtn.textContent = result.quote ? 'Pošalji upit za ponudu' : `Pošalji rezervaciju · ${result.total} €`;
    // odredište iz kalkulatora (zona 3) prepopuni adresu dostave ako je prazna
    if (s.destination && !touched.has('dropoff_address') && !el.dropoff_address.value) {
      el.dropoff_address.value = s.destination;
    }
  });

  /* --- događaji --- */
  form.addEventListener('change', (e) => {
    const { name } = e.target;
    if (name === 'service') setState({ service: e.target.value });
    if (name === 'date') {
      refreshSlots();
      updateWhatsAppLinks(e.target.value ? formatDate(e.target.value) : '');
    }
    if (name === 'pickup_floor' || name === 'dropoff_floor') refreshLift(name.split('_')[0]);
    if (/_(floor|lift)$/.test(name)) syncFloorsFromForm();
    if (name === 'image') validateImage();
    if (validators[name]) { touched.add(name); validateField(name); }
  });
  // validacija pri izlasku iz polja; nakon prve greške i tijekom tipkanja
  form.addEventListener('focusout', (e) => {
    const { name } = e.target;
    if (validators[name] && name !== 'time_slot') { touched.add(name); validateField(name); }
  });
  form.addEventListener('input', (e) => {
    const { name } = e.target;
    if (validators[name] && e.target.getAttribute('aria-invalid') === 'true') validateField(name);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); // bez reloada stranice
    if (sending) return;
    errorBox.hidden = true;

    // validiraj sve; fokusiraj prvo neispravno polje
    const invalid = Object.keys(validators).filter((name) => !validateField(name));
    const imageOk = validateImage();
    if (invalid.length || !imageOk) {
      const first = invalid.length ? el[invalid[0]] : el.image;
      (first instanceof RadioNodeList ? first[0] : first).focus();
      return;
    }
    if (el.website.value) return showSuccess(); // honeypot: bot – glumi uspjeh, ne šalji

    sending = true;
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Šaljem…';

    try {
      const s = getState();
      const result = calcPrice(s);
      const floorLift = (prefix) => {
        const floor = el[`${prefix}_floor`].value;
        if (floor === '0') return 'Prizemlje';
        return `${floor}. kat, ${el[`${prefix}_lift`].value === 'da' ? 'ima lift' : 'bez lifta'}`;
      };
      const file = el.image.files[0];
      const imageUrl = file ? await uploadImage(file) : null;

      await insertBooking({
        service: serviceLabel(s),
        zone: CONFIG.zones[s.zone].name,
        floors_no_lift: s.floors,
        estimated_price: result.total, // null = cijena po ponudi
        date: el.date.value,
        time_slot: el.time_slot.value,
        pickup_address: el.pickup_address.value.trim(),
        dropoff_address: el.dropoff_address.value.trim(),
        pickup_floor_lift: floorLift('pickup'),
        dropoff_floor_lift: floorLift('dropoff'),
        item_description: el.item_description.value.trim(),
        image_url: imageUrl,
        listing_url: el.listing_url.value.trim() ? normalizeUrl(el.listing_url.value) : null,
        name: el.name.value.trim(),
        phone: el.phone.value.trim(),
        email: el.email.value.trim() || null,
        note: el.note.value.trim() || null,
      });

      track('booking', result.total ? { value: result.total } : {});
      showSuccess(
        `${formatDate(el.date.value)} · ${el.time_slot.value} h · ${serviceLabel(s)}`
        + (result.quote ? ' · cijena po ponudi' : ` · procjena ${result.total} €`),
      );
    } catch (err) {
      console.error(err);
      if (err.field === 'image') {
        setError(el.image, `Slika je prevelika (najviše ${CONFIG.supabase.maxImageMB} MB). Odaberi manju ili pošalji bez slike.`);
        el.image.focus();
      } else {
        errorBox.innerHTML = '';
        errorBox.append(
          'Nešto je pošlo po zlu i rezervacija nije poslana. Pokušaj ponovno ili nas nazovi na ',
          Object.assign(document.createElement('a'), {
            href: `tel:${CONFIG.contact.phoneIntl}`,
            textContent: CONFIG.contact.phoneDisplay,
          }),
          '.',
        );
        errorBox.hidden = false;
        errorBox.scrollIntoView({ block: 'center' });
      }
      submitBtn.textContent = originalText;
    } finally {
      sending = false;
      submitBtn.disabled = false;
    }
  });

  /** Zamijeni formu animiranom potvrdom (kombi odlazi s ekrana). */
  function showSuccess(detail = '') {
    const box = $('#booking-success');
    $('#success-detail').textContent = detail;
    form.hidden = true;
    box.hidden = false;
    box.classList.add('play');
    box.focus({ preventScroll: true });
    box.scrollIntoView({ block: 'center' });
  }

  refreshLift('pickup');
  refreshLift('dropoff');
}
