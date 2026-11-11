/**
 * Pokupimo – admin dashboard (bez biblioteka i build koraka).
 *
 *  1. pomoćne funkcije (DOM, formatiranje)
 *  2. prijava i Supabase API (Auth + REST + Storage)
 *  3. podaci
 *  4. dijalog, obavijesti
 *  5. pogledi: Pregled · Rezervacije · Kalendar · Troškovnik · Tekstovi i cijene
 *  6. ljuska aplikacije (izbornik, tema, lozinka, odjava)
 *
 * Sigurnost: pristup podacima određuje RLS u bazi (funkcija pokupi_is_admin),
 * a ne ovaj kôd. Podaci koje su upisali kupci ispisuju se isključivo kao tekst
 * (textContent), nikad kao HTML.
 */
import { CONFIG } from '../js/config.js';
import { calcPrice, serviceLabel } from '../js/pricing.js';
import { collectEditable, toMarkup, CONFIG_FIELDS, CFG_PREFIX, getConfigValue } from '../js/content.js';

/* =====================================================================
   1. Pomoćne funkcije
   ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);

/** Stvori element: h('div', {class:'x', onclick: fn}, 'tekst', dijete…). */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else el.setAttribute(key, value === true ? '' : value);
  });
  children.flat().forEach((child) => {
    if (child !== null && child !== undefined && child !== false) el.append(child);
  });
  return el;
}
/** SVG ikona iz putanje (statičan, vlastiti sadržaj). */
function icon(path) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  return span.firstChild;
}
const ICON = {
  plus: 'M12 5v14M5 12h14',
  phone: 'M6.600 2.500h3l1.500 4.400-2 1.600a12.500 12.500 0 0 0 6.400 6.400l1.600-2 4.400 1.500v3a2.600 2.600 0 0 1-2.900 2.600A18.400 18.400 0 0 1 4 5.400a2.600 2.600 0 0 1 2.600-2.900Z',
  chat: 'M12 3a9 9 0 0 0-7.700 13.600L3 21l4.500-1.200A9 9 0 1 0 12 3Z',
  link: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  image: 'M4 5h16v14H4zM4 15l4.500-4.500L13 15l3-3 4 4M9 9.500h.010',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
};

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}.` : '—');
const fmtMoney = (n) => `${new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 2 }).format(Number(n) || 0)} €`;
const monthName = (key) => new Date(`${key}-01T12:00:00`).toLocaleDateString('hr-HR', { month: 'long', year: 'numeric' });
const weekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('hr-HR', { weekday: 'short' });

const STATUSES = ['novo', 'potvrđeno', 'odrađeno', 'otkazano'];
const STATUS_LABEL = { novo: 'Novo', 'potvrđeno': 'Potvrđeno', 'odrađeno': 'Odrađeno', otkazano: 'Otkazano' };
const EXPENSE_CATEGORIES = [
  'Gorivo', 'Cestarine i parking', 'Servis i održavanje', 'Registracija i osiguranje', 'Oprema', 'Marketing', 'Ostalo',
];

/** Prihod se računa samo za odrađene vožnje: naplaćeno, a ako nije upisano – procjena. */
const revenueOf = (b) => (b.status === 'odrađeno' ? Number(b.final_price ?? b.estimated_price ?? 0) : 0);
const priceOf = (b) => b.final_price ?? b.estimated_price;
const statusBadge = (status) => h('span', { class: `status st-${status}` }, STATUS_LABEL[status] || status);

/* =====================================================================
   2. Prijava i Supabase API
   ===================================================================== */
const SB = CONFIG.supabase;
const SESSION_KEY = 'pokupi-admin-session';
let session = null;

function saveSession(data) {
  session = data && {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user,
  };
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* privatni način rada: sesija živi samo do zatvaranja kartice */ }
}

async function authRequest(path, body, token) {
  const res = await fetch(`${SB.url}/auth/v1/${path}`, {
    method: path === 'user' ? 'PUT' : 'POST',
    headers: { apikey: SB.key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.msg || data.error_description || data.message || 'Greška'), { status: res.status });
  return data;
}

const signIn = async (email, password) => saveSession(await authRequest('token?grant_type=password', { email, password }));

async function refreshSession() {
  if (!session?.refresh_token) throw new Error('Nema sesije');
  saveSession(await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token }));
}

/** Poziv Supabase API-ja s tokenom prijavljenog korisnika (uz automatsko osvježavanje). */
async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}, retried = false) {
  if (session.expires_at - Date.now() / 1000 < 60) await refreshSession();
  const isJson = body !== undefined && !(body instanceof Blob);
  const res = await fetch(`${SB.url}${path}`, {
    method,
    headers: {
      apikey: SB.key,
      Authorization: `Bearer ${session.access_token}`,
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: isJson ? JSON.stringify(body) : body,
  });
  if (res.status === 401 && !retried) {
    await refreshSession();
    return api(path, { method, body, headers, raw }, true);
  }
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const rest = (table, query = '', options) => api(`/rest/v1/${table}${query}`, options);
const RETURN = { Prefer: 'return=representation' };

/* =====================================================================
   3. Podaci
   ===================================================================== */
const db = { bookings: [], expenses: [], content: {}, blocked: new Map() };

async function loadAll() {
  const [bookings, expenses, content, blocked] = await Promise.all([
    rest('pokupi_bookings', '?select=*&order=date.desc,time_slot.asc'),
    rest('pokupi_expenses', '?select=*&order=date.desc,created_at.desc'),
    rest('pokupi_content', '?select=key,value'),
    rest('pokupi_blocked_dates', '?select=date,reason'),
  ]);
  db.bookings = bookings;
  db.expenses = expenses;
  db.content = Object.fromEntries(content.map((r) => [r.key, r.value]));
  db.blocked = new Map(blocked.map((r) => [r.date, r.reason]));
}

/* =====================================================================
   4. Dijalog i obavijesti
   ===================================================================== */
const dialog = $('#dialog');
let dialogSubmit = null;

function openDialog({ title, body, actions = [], onSubmit = null }) {
  $('#dialog-title').textContent = title;
  $('#dialog-body').replaceChildren(...[body].flat());
  $('#dialog-foot').replaceChildren(...actions);
  dialogSubmit = onSubmit;
  if (!dialog.open) dialog.showModal();
}
const closeDialog = () => dialog.open && dialog.close();
dialog.addEventListener('click', (e) => {
  if (e.target === dialog || e.target.closest('[data-close]')) closeDialog();
});
$('#dialog-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!dialogSubmit) return;
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  try {
    await dialogSubmit(new FormData(e.target));
  } catch (err) {
    toast(`Nije uspjelo: ${err.message}`, true);
  } finally {
    if (btn) btn.disabled = false;
  }
});

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 2600);
}

/** Polje forme s natpisom. */
function field(label, control, extraClass = '') {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return h('div', { class: `field ${extraClass}` }, h('label', { for: id }, label), control);
}
const select = (name, options, value) => h('select', { name },
  options.map(([val, text]) => h('option', { value: val, selected: val === value }, text)));

/* =====================================================================
   5. Pogledi
   ===================================================================== */
const view = $('#view');
const actions = $('#view-actions');

function bookingRow(b) {
  return h('button', { type: 'button', class: 'row', onclick: () => openBooking(b) },
    h('span', { class: 'row-date' }, fmtDate(b.date), h('small', {}, `${weekday(b.date)} · ${b.time_slot} h`)),
    h('span', { class: 'row-main' },
      h('strong', {}, b.name),
      h('span', {}, `${b.service} · ${b.pickup_address} → ${b.dropoff_address}`)),
    statusBadge(b.status),
    h('span', { class: 'row-price' }, priceOf(b) === null ? 'po ponudi' : fmtMoney(priceOf(b))));
}
const listCard = (title, rows, emptyText) => h('div', { class: 'card' },
  title && h('p', { class: 'card-title card-pad', style: 'margin:0;padding-bottom:.4rem' }, title),
  rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'empty' }, emptyText));

/* ---------- 5.1 Pregled ---------- */
function renderPregled() {
  actions.replaceChildren();
  const month = todayISO().slice(0, 7);
  const sum = (items, fn) => items.reduce((total, item) => total + fn(item), 0);
  const inMonth = (item) => item.date.startsWith(month);

  const revenueMonth = sum(db.bookings.filter(inMonth), revenueOf);
  const expensesMonth = sum(db.expenses.filter(inMonth), (e) => Number(e.amount));
  const revenueAll = sum(db.bookings, revenueOf);
  const expensesAll = sum(db.expenses, (e) => Number(e.amount));
  const doneMonth = db.bookings.filter((b) => inMonth(b) && b.status === 'odrađeno').length;
  const waiting = db.bookings.filter((b) => b.status === 'novo');
  const upcoming = db.bookings
    .filter((b) => b.date >= todayISO() && (b.status === 'novo' || b.status === 'potvrđeno'))
    .sort((a, b) => (a.date + a.time_slot).localeCompare(b.date + b.time_slot));

  const kpi = (title, value, note, cls = '') => h('div', { class: `card card-pad kpi ${cls}` },
    h('p', { class: 'card-title' }, title), h('p', { class: 'kpi-value' }, value), note && h('p', { class: 'kpi-note' }, note));
  const profit = revenueMonth - expensesMonth;

  // zadnjih 6 mjeseci: prihod i troškovi
  const months = [...Array(6)].map((_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (5 - i));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  });
  const series = months.map((key) => ({
    key,
    revenue: sum(db.bookings.filter((b) => b.date.startsWith(key)), revenueOf),
    expenses: sum(db.expenses.filter((e) => e.date.startsWith(key)), (e) => Number(e.amount)),
  }));

  // rezervacije po uslugama (bez otkazanih)
  const byService = {};
  db.bookings.filter((b) => b.status !== 'otkazano').forEach((b) => {
    const name = b.service.split(' – ')[0];
    byService[name] = (byService[name] || 0) + 1;
  });
  const serviceMax = Math.max(1, ...Object.values(byService));

  view.replaceChildren(
    h('div', { class: 'kpis' },
      kpi('Prihod ovaj mjesec', fmtMoney(revenueMonth), `${doneMonth} odrađenih vožnji`, 'accent'),
      kpi('Troškovi ovaj mjesec', fmtMoney(expensesMonth)),
      h('div', { class: 'card card-pad kpi' },
        h('p', { class: 'card-title' }, 'Dobit ovaj mjesec'),
        h('p', { class: `kpi-value ${profit < 0 ? 'neg' : 'pos'}` }, fmtMoney(profit))),
      kpi('Ukupni prihod', fmtMoney(revenueAll), `Troškovi ukupno: ${fmtMoney(expensesAll)}`),
      kpi('Čeka potvrdu', String(waiting.length), `${upcoming.length} nadolazećih`)),
    h('div', { class: 'cols' },
      h('div', { class: 'card card-pad' },
        h('p', { class: 'card-title' }, 'Trend prihoda i troškova'),
        trendChart(series),
        h('p', { class: 'legend' },
          h('span', {}, h('i', { style: 'background:var(--mint-strong)' }), 'Prihod'),
          h('span', {}, h('i', { style: 'background:var(--muted)' }), 'Troškovi'))),
      h('div', { class: 'card card-pad' },
        h('p', { class: 'card-title' }, 'Rezervacije po uslugama'),
        Object.keys(byService).length
          ? h('div', { class: 'bars' }, Object.entries(byService).sort((a, b) => b[1] - a[1]).map(([name, count]) =>
            h('div', { class: 'bar-row' }, h('span', {}, name), h('strong', {}, String(count)),
              h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${(count / serviceMax) * 100}%` })))))
          : h('p', { class: 'muted' }, 'Još nema rezervacija.'))),
    h('div', { class: 'cols' },
      listCard('Nadolazeće rezervacije', upcoming.slice(0, 8).map(bookingRow), 'Nema nadolazećih rezervacija.'),
      listCard('Čekaju potvrdu', waiting.slice(0, 8).map(bookingRow), 'Sve je potvrđeno.')),
  );
}

/** Stupčasti graf (SVG) – prihod i troškovi po mjesecima. */
function trendChart(series) {
  const W = 520, H = 200, top = 12, bottom = 26, left = 6;
  const max = Math.max(10, ...series.flatMap((s) => [s.revenue, s.expenses]));
  const band = (W - left * 2) / series.length;
  const scale = (v) => (v / max) * (H - top - bottom);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', series.map((s) => `${monthName(s.key)}: prihod ${fmtMoney(s.revenue)}, troškovi ${fmtMoney(s.expenses)}`).join('; '));
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (text) el.textContent = text;
    svg.append(el);
  };
  add('line', { x1: left, x2: W - left, y1: H - bottom, y2: H - bottom, stroke: 'var(--line)', 'stroke-width': 1 });
  series.forEach((s, i) => {
    const x = left + i * band;
    const bw = Math.min(26, band * 0.3);
    [[s.revenue, 'var(--mint-strong)', -bw - 2], [s.expenses, 'var(--muted)', 2]].forEach(([value, fill, dx]) => {
      const barH = Math.max(value > 0 ? 2 : 0, scale(value));
      add('rect', { x: x + band / 2 + dx, y: H - bottom - barH, width: bw, height: barH, rx: 4, fill, stroke: 'none' });
    });
    if (s.revenue > 0) add('text', { x: x + band / 2 - bw / 2 - 2, y: H - bottom - scale(s.revenue) - 4, 'text-anchor': 'middle', stroke: 'none' }, Math.round(s.revenue));
    add('text', { x: x + band / 2, y: H - 8, 'text-anchor': 'middle', stroke: 'none' },
      new Date(`${s.key}-01T12:00:00`).toLocaleDateString('hr-HR', { month: 'short' }));
  });
  return svg;
}

/* ---------- 5.2 Rezervacije ---------- */
const bookingFilter = { status: 'sve', query: '' };

function renderRezervacije() {
  actions.replaceChildren(h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openNewBooking() }, icon(ICON.plus), 'Nova rezervacija'));
  const list = h('div', { class: 'card' });
  const draw = () => {
    const q = bookingFilter.query.toLowerCase();
    const rows = db.bookings.filter((b) => (bookingFilter.status === 'sve' || b.status === bookingFilter.status)
      && (!q || [b.name, b.phone, b.pickup_address, b.dropoff_address, b.item_description, b.service].join(' ').toLowerCase().includes(q)));
    list.replaceChildren(rows.length ? h('div', { class: 'list' }, rows.map(bookingRow)) : h('p', { class: 'empty' }, 'Nema rezervacija za ovaj prikaz.'));
  };
  const chips = h('div', { class: 'chips' }, ['sve', ...STATUSES].map((status) => {
    const count = status === 'sve' ? db.bookings.length : db.bookings.filter((b) => b.status === status).length;
    return h('button', {
      type: 'button', class: `chip ${bookingFilter.status === status ? 'active' : ''}`,
      onclick: () => { bookingFilter.status = status; renderRezervacije(); },
    }, `${status === 'sve' ? 'Sve' : STATUS_LABEL[status]} (${count})`);
  }));
  const search = h('input', {
    type: 'search', placeholder: 'Traži ime, telefon, adresu…', 'aria-label': 'Pretraga', value: bookingFilter.query,
    oninput: (e) => { bookingFilter.query = e.target.value; draw(); },
  });
  view.replaceChildren(h('div', { class: 'toolbar' }, chips, search), list);
  draw();
}

/** Detalji i uređivanje rezervacije. */
function openBooking(b) {
  const digits = String(b.phone).replace(/[^\d+]/g, '');
  const waNumber = digits.startsWith('+') ? digits.slice(1) : digits.replace(/^00/, '').replace(/^0/, '385');
  const photoSlot = h('div');

  async function showPhoto(btn) {
    btn.disabled = true;
    try {
      const path = b.image_url.split(`/object/${SB.bucket}/`)[1];
      const res = await api(`/storage/v1/object/authenticated/${SB.bucket}/${path}`, { raw: true });
      photoSlot.replaceChildren(h('img', { class: 'photo', src: URL.createObjectURL(await res.blob()), alt: 'Slika predmeta' }));
      btn.remove();
    } catch (err) {
      toast('Slika se ne može učitati.', true);
      btn.disabled = false;
    }
  }

  const detail = (label, value) => (value === null || value === undefined || value === '' ? [] : [h('dt', {}, label), h('dd', {}, String(value))]);
  const body = [
    h('div', { class: 'quick' },
      h('a', { class: 'btn btn-dark btn-small', href: `tel:${digits}` }, icon(ICON.phone), 'Nazovi'),
      h('a', { class: 'btn btn-ghost btn-small', href: `https://wa.me/${waNumber}`, target: '_blank', rel: 'noopener' }, icon(ICON.chat), 'WhatsApp'),
      b.listing_url && /^https?:\/\//.test(b.listing_url)
        && h('a', { class: 'btn btn-ghost btn-small', href: b.listing_url, target: '_blank', rel: 'noopener noreferrer' }, icon(ICON.link), 'Oglas'),
      b.image_url && h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: (e) => showPhoto(e.currentTarget) }, icon(ICON.image), 'Prikaži sliku')),
    photoSlot,
    h('dl', { class: 'details' },
      detail('Kupac', b.name), detail('Telefon', b.phone), detail('Email', b.email),
      detail('Usluga', b.service), detail('Zona', b.zone),
      detail('Procjena', b.estimated_price === null ? 'po ponudi' : fmtMoney(b.estimated_price)),
      detail('Preuzimanje', `${b.pickup_address}${b.pickup_floor_lift ? ` (${b.pickup_floor_lift})` : ''}`),
      detail('Dostava', `${b.dropoff_address}${b.dropoff_floor_lift ? ` (${b.dropoff_floor_lift})` : ''}`),
      detail('Katovi bez lifta', b.floors_no_lift), detail('Predmeti', b.item_description),
      detail('Napomena kupca', b.note), detail('Zaprimljeno', new Date(b.created_at).toLocaleString('hr-HR'))),
    h('div', { class: 'grid-2' },
      field('Status', select('status', STATUSES.map((s) => [s, STATUS_LABEL[s]]), b.status)),
      field('Naplaćeno (€)', h('input', { type: 'number', name: 'final_price', min: 0, step: '0.01', inputmode: 'decimal', value: b.final_price ?? '', placeholder: b.estimated_price ?? '' }))),
    h('div', { class: 'grid-2' },
      field('Datum', h('input', { type: 'date', name: 'date', required: true, value: b.date })),
      field('Termin', select('time_slot', [...new Set([...CONFIG.timeSlots, b.time_slot])].map((s) => [s, `${s} h`]), b.time_slot))),
    field('Interna bilješka', h('textarea', { name: 'admin_note', rows: 2, maxlength: 2000, value: b.admin_note ?? '' })),
  ];

  openDialog({
    title: `${b.name} · ${fmtDate(b.date)}`,
    body,
    actions: [
      h('button', { type: 'button', class: 'btn btn-danger', onclick: () => deleteBooking(b) }, icon(ICON.trash), 'Obriši'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn btn-ghost', 'data-close': true }, 'Zatvori'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Spremi'),
    ],
    onSubmit: async (form) => {
      const patch = {
        status: form.get('status'),
        final_price: form.get('final_price') === '' ? null : Number(form.get('final_price')),
        date: form.get('date'),
        time_slot: form.get('time_slot'),
        admin_note: form.get('admin_note').trim() || null,
      };
      const [updated] = await rest('pokupi_bookings', `?id=eq.${b.id}`, { method: 'PATCH', body: patch, headers: RETURN });
      Object.assign(b, updated);
      closeDialog();
      toast('Rezervacija je spremljena.');
      refresh();
    },
  });
}

async function deleteBooking(b) {
  if (!window.confirm(`Obrisati rezervaciju (${b.name}, ${fmtDate(b.date)})? Ovo se ne može poništiti.`)) return;
  try {
    await rest('pokupi_bookings', `?id=eq.${b.id}`, { method: 'DELETE' });
    if (b.image_url) { // slika više nije potrebna
      const path = b.image_url.split(`/object/${SB.bucket}/`)[1];
      api(`/storage/v1/object/${SB.bucket}/${path}`, { method: 'DELETE' }).catch(() => {});
    }
    db.bookings = db.bookings.filter((x) => x.id !== b.id);
    closeDialog();
    toast('Rezervacija je obrisana.');
    refresh();
  } catch (err) {
    toast(`Brisanje nije uspjelo: ${err.message}`, true);
  }
}

/** Ručni unos rezervacije (npr. dogovor telefonom). */
function openNewBooking(date = '') {
  const serviceSel = select('service', Object.entries(CONFIG.services).map(([key, s]) => [key, s.name]), 'dostava');
  const zoneSel = select('zone', Object.entries(CONFIG.zones).map(([key, z]) => [key, z.name]), 'z1');
  const floors = h('input', { type: 'number', name: 'floors', min: 0, max: CONFIG.maxFloors, value: 0, inputmode: 'numeric' });
  const hours = h('input', { type: 'number', name: 'hours', min: CONFIG.services.selidba.minHours, max: CONFIG.services.selidba.maxHours, value: CONFIG.services.selidba.minHours, inputmode: 'numeric' });
  const price = h('input', { type: 'number', name: 'price', min: 0, step: '0.01', inputmode: 'decimal' });
  const hoursField = field('Sati', hours);
  const selection = () => ({ service: serviceSel.value, zone: zoneSel.value, floors: floors.value, hours: hours.value });
  const recalc = () => {
    hoursField.hidden = serviceSel.value !== 'selidba';
    const result = calcPrice(selection());
    price.value = result.total ?? '';
    price.placeholder = result.quote ? 'po ponudi' : '';
  };
  [serviceSel, zoneSel, floors, hours].forEach((el) => el.addEventListener('input', recalc));
  recalc();

  openDialog({
    title: 'Nova rezervacija',
    body: [
      h('div', { class: 'grid-2' }, field('Usluga', serviceSel), field('Zona', zoneSel)),
      h('div', { class: 'grid-2' }, field('Katovi bez lifta', floors), hoursField),
      h('div', { class: 'grid-2' },
        field('Datum', h('input', { type: 'date', name: 'date', required: true, value: date })),
        field('Termin', select('time_slot', CONFIG.timeSlots.map((s) => [s, `${s} h`])))),
      field('Adresa preuzimanja', h('input', { type: 'text', name: 'pickup_address', required: true, maxlength: 300 })),
      field('Adresa dostave', h('input', { type: 'text', name: 'dropoff_address', required: true, maxlength: 300 })),
      field('Što vozimo', h('textarea', { name: 'item_description', rows: 2, required: true, maxlength: 1000 })),
      h('div', { class: 'grid-2' },
        field('Ime i prezime', h('input', { type: 'text', name: 'name', required: true, maxlength: 120 })),
        field('Telefon', h('input', { type: 'tel', name: 'phone', required: true, maxlength: 30 }))),
      h('div', { class: 'grid-2' },
        field('Cijena (€)', price),
        field('Status', select('status', STATUSES.map((s) => [s, STATUS_LABEL[s]]), 'potvrđeno'))),
      field('Interna bilješka', h('textarea', { name: 'admin_note', rows: 2, maxlength: 2000 })),
    ],
    actions: [
      h('button', { type: 'button', class: 'btn btn-ghost', 'data-close': true }, 'Odustani'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Dodaj rezervaciju'),
    ],
    onSubmit: async (form) => {
      const required = ['date', 'pickup_address', 'dropoff_address', 'item_description', 'name', 'phone'];
      if (required.some((name) => !String(form.get(name)).trim())) return toast('Ispuni sva obavezna polja.', true);
      const s = selection();
      const [created] = await rest('pokupi_bookings', '', {
        method: 'POST',
        headers: RETURN,
        body: {
          service: serviceLabel(s),
          zone: CONFIG.zones[s.zone].name,
          floors_no_lift: Number(s.floors) || 0,
          estimated_price: form.get('price') === '' ? null : Number(form.get('price')),
          date: form.get('date'),
          time_slot: form.get('time_slot'),
          pickup_address: form.get('pickup_address').trim(),
          dropoff_address: form.get('dropoff_address').trim(),
          item_description: form.get('item_description').trim(),
          name: form.get('name').trim(),
          phone: form.get('phone').trim(),
          status: form.get('status'),
          admin_note: form.get('admin_note').trim() || null,
        },
      });
      db.bookings.unshift(created);
      db.bookings.sort((a, b) => (b.date + a.time_slot).localeCompare(a.date + b.time_slot));
      closeDialog();
      toast('Rezervacija je dodana.');
      refresh();
    },
  });
}

/* ---------- 5.3 Kalendar ---------- */
const cal = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), selected: todayISO() };

function renderKalendar() {
  actions.replaceChildren(h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openNewBooking(cal.selected) }, icon(ICON.plus), 'Nova rezervacija'));
  const byDate = {};
  db.bookings.filter((b) => b.status !== 'otkazano').forEach((b) => (byDate[b.date] ||= []).push(b));

  const first = new Date(cal.month);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // ponedjeljak prvog tjedna
  const days = [...Array(42)].map((_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const move = (delta) => { cal.month = new Date(first.getFullYear(), first.getMonth() + delta, 1); renderKalendar(); };

  const grid = h('div', { class: 'cal' },
    ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'].map((d) => h('div', { class: 'cal-dow' }, d)),
    days.map((d) => {
      const iso = isoOf(d);
      const items = (byDate[iso] || []).sort((a, b) => a.time_slot.localeCompare(b.time_slot));
      const classes = ['cal-day', d.getMonth() !== first.getMonth() && 'other', iso === todayISO() && 'today',
        iso === cal.selected && 'selected', db.blocked.has(iso) && 'blocked'].filter(Boolean).join(' ');
      return h('button', {
        type: 'button', class: classes,
        'aria-label': `${fmtDate(iso)}, ${items.length} rezervacija${db.blocked.has(iso) ? ', blokirano' : ''}`,
        onclick: () => { cal.selected = iso; renderKalendar(); },
      },
      h('span', { class: 'cal-num' }, String(d.getDate())),
      items.slice(0, 3).map((b) => h('span', { class: `cal-ev st-${b.status}` }, `${b.time_slot.slice(0, 2)}h ${b.name}`)),
      items.length > 3 && h('span', { class: 'cal-more' }, `+${items.length - 3}`));
    }));

  const dayItems = db.bookings.filter((b) => b.date === cal.selected).sort((a, b) => a.time_slot.localeCompare(b.time_slot));
  const isBlocked = db.blocked.has(cal.selected);
  const panel = h('div', { class: 'card day-panel' },
    h('div', { class: 'day-panel-head' },
      h('h3', {}, `${weekday(cal.selected)}, ${fmtDate(cal.selected)}`, isBlocked && h('span', { class: 'status st-otkazano', style: 'margin-left:.6rem' }, 'Blokirano')),
      h('button', { type: 'button', class: `btn btn-small ${isBlocked ? 'btn-ghost' : 'btn-danger'}`, onclick: () => toggleBlocked(cal.selected) },
        isBlocked ? 'Odblokiraj dan' : 'Blokiraj dan')),
    dayItems.length ? h('div', { class: 'list' }, dayItems.map(bookingRow)) : h('p', { class: 'empty' }, 'Nema rezervacija za ovaj dan.'));

  view.replaceChildren(
    h('div', { class: 'cal-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Prethodni mjesec', onclick: () => move(-1) }, icon(ICON.left)),
      h('h2', {}, monthName(isoOf(first).slice(0, 7))),
      h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { cal.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); cal.selected = todayISO(); renderKalendar(); } }, 'Danas'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Sljedeći mjesec', onclick: () => move(1) }, icon(ICON.right))),
    grid,
    h('p', { class: 'muted small', style: 'margin-top:.6rem' }, 'Blokirani dani se na stranici ne mogu odabrati u formi za rezervaciju.'),
    panel);
}

async function toggleBlocked(iso) {
  try {
    if (db.blocked.has(iso)) {
      await rest('pokupi_blocked_dates', `?date=eq.${iso}`, { method: 'DELETE' });
      db.blocked.delete(iso);
      toast('Dan je odblokiran.');
    } else {
      await rest('pokupi_blocked_dates', '', { method: 'POST', body: { date: iso } });
      db.blocked.set(iso, null);
      toast('Dan je blokiran za nove rezervacije.');
    }
    renderKalendar();
  } catch (err) {
    toast(`Nije uspjelo: ${err.message}`, true);
  }
}

/* ---------- 5.4 Troškovnik ---------- */
const expenseFilter = { month: '' };

function renderTroskovi() {
  actions.replaceChildren();
  const months = [...new Set(db.expenses.map((e) => e.date.slice(0, 7)))].sort().reverse();
  const items = db.expenses.filter((e) => !expenseFilter.month || e.date.startsWith(expenseFilter.month));
  const total = items.reduce((sum, e) => sum + Number(e.amount), 0);
  const byCategory = {};
  items.forEach((e) => { byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount); });

  const form = h('form', { class: 'card card-pad expense-form', novalidate: true, onsubmit: addExpense },
    field('Datum', h('input', { type: 'date', name: 'date', required: true, value: todayISO() })),
    field('Kategorija', select('category', EXPENSE_CATEGORIES.map((c) => [c, c]))),
    field('Opis', h('input', { type: 'text', name: 'description', maxlength: 500, placeholder: 'npr. INA Slavonska' }), 'wide'),
    field('Iznos (€)', h('input', { type: 'number', name: 'amount', required: true, min: 0, step: '0.01', inputmode: 'decimal' })),
    h('button', { type: 'submit', class: 'btn btn-primary' }, icon(ICON.plus), 'Dodaj'));

  view.replaceChildren(
    form,
    h('div', { class: 'toolbar' },
      h('select', { 'aria-label': 'Razdoblje', onchange: (e) => { expenseFilter.month = e.target.value; renderTroskovi(); } },
        h('option', { value: '' }, 'Sva razdoblja'),
        months.map((m) => h('option', { value: m, selected: m === expenseFilter.month }, monthName(m))))),
    h('div', { class: 'cat-grid' },
      h('div', { class: 'card card-pad kpi accent' }, h('p', { class: 'card-title' }, 'Ukupno'), h('p', { class: 'kpi-value' }, fmtMoney(total))),
      Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([name, amount]) =>
        h('div', { class: 'card card-pad kpi' }, h('p', { class: 'card-title' }, name), h('p', { class: 'kpi-value' }, fmtMoney(amount))))),
    h('div', { class: 'card' },
      items.length ? h('div', { class: 'list' }, items.map((e) => h('div', { class: 'row expense' },
        h('span', { class: 'row-date' }, fmtDate(e.date)),
        h('span', { class: 'row-main' }, h('strong', {}, e.category), h('span', {}, e.description || '—')),
        h('span', { class: 'row-price' }, fmtMoney(e.amount)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Obriši trošak ${e.category} ${fmtMoney(e.amount)}`, onclick: () => deleteExpense(e) }, icon(ICON.trash)))))
        : h('p', { class: 'empty' }, 'Još nema upisanih troškova.')));
}

async function addExpense(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const amount = Number(String(form.get('amount')).replace(',', '.'));
  if (!form.get('date') || !Number.isFinite(amount) || amount <= 0) return toast('Upiši datum i iznos veći od 0.', true);
  try {
    const [created] = await rest('pokupi_expenses', '', {
      method: 'POST',
      headers: RETURN,
      body: { date: form.get('date'), category: form.get('category'), description: form.get('description').trim() || null, amount },
    });
    db.expenses.unshift(created);
    db.expenses.sort((a, b) => b.date.localeCompare(a.date));
    toast('Trošak je dodan.');
    renderTroskovi();
  } catch (err) {
    toast(`Nije uspjelo: ${err.message}`, true);
  }
}

async function deleteExpense(expense) {
  if (!window.confirm(`Obrisati trošak „${expense.category}” (${fmtMoney(expense.amount)})?`)) return;
  try {
    await rest('pokupi_expenses', `?id=eq.${expense.id}`, { method: 'DELETE' });
    db.expenses = db.expenses.filter((x) => x.id !== expense.id);
    toast('Trošak je obrisan.');
    renderTroskovi();
  } catch (err) {
    toast(`Nije uspjelo: ${err.message}`, true);
  }
}

/* ---------- 5.5 Tekstovi i cijene ---------- */
let siteTexts = null; // [{key, sectionTitle, kind, original}] – izvorni tekstovi iz index.html
const KIND_LABEL = {
  h2: 'Naslov sekcije', h3: 'Podnaslov', p: 'Tekst', summary: 'Pitanje', li: 'Stavka', span: 'Oznaka', strong: 'Istaknuto',
  eyebrow: 'Nadnaslov', 'h1-main': 'Glavni naslov (1. dio)', hl: 'Glavni naslov (istaknuti dio)', kicker: 'Oznaka sekcije',
  lead: 'Uvodni tekst', 'hero-sub': 'Podnaslov', fineprint: 'Sitni tekst', btn: 'Gumb', badge: 'Značka',
  'choice-title': 'Kalkulator: naziv', 'choice-note': 'Kalkulator: opis', 'zone-name': 'Zona: naziv', 'zone-price': 'Zona: cijena',
  'zone-badge': 'Zona: oznaka', 'chip-label': 'Kartica: natpis', 'chip-value': 'Kartica: vrijednost',
};

async function loadSiteTexts() {
  if (siteTexts) return siteTexts;
  const html = await (await fetch('../index.html', { cache: 'no-store' })).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  siteTexts = collectEditable(doc).map(({ key, sectionTitle, el }) => ({ key, sectionTitle, kind: key.split('/')[1], original: toMarkup(el) }));
  return siteTexts;
}

async function renderTekstovi() {
  actions.replaceChildren();
  view.replaceChildren(h('p', { class: 'empty' }, 'Učitavam tekstove…'));
  const texts = await loadSiteTexts();
  const pending = { ...db.content }; // radna kopija izmjena

  const savebar = h('div', { class: 'savebar', hidden: true },
    h('span', {}), h('button', { type: 'button', class: 'btn btn-primary btn-small', onclick: save }, 'Spremi izmjene'));
  const dirtyKeys = () => [...new Set([...Object.keys(pending), ...Object.keys(db.content)])].filter((k) => pending[k] !== db.content[k]);
  const updateSavebar = () => {
    const n = dirtyKeys().length;
    savebar.hidden = n === 0;
    savebar.firstChild.textContent = `${n} nespremljen${n === 1 ? 'a izmjena' : 'ih izmjena'}`;
  };

  /** Jedno polje: prikazuje izmijenjenu vrijednost ili izvornu. */
  function textField(key, label, original, type = 'text') {
    const long = type === 'text' && (original.length > 70 || original.includes('\n'));
    const control = long
      ? h('textarea', { rows: Math.min(6, Math.ceil(original.length / 70) + 1), maxlength: 5000 })
      : h('input', { type: type === 'number' ? 'number' : 'text', maxlength: 5000, ...(type === 'number' ? { min: 0, step: 'any', inputmode: 'decimal' } : {}) });
    control.value = pending[key] ?? original;
    const reset = h('button', { type: 'button', class: 'reset', onclick: () => { control.value = original; sync(); } }, 'Vrati izvorno');
    const wrap = field(label, control, 'text-field');
    wrap.firstChild.append(reset);
    function sync() {
      const value = control.value.trim();
      if (value === '' || value === String(original)) delete pending[key]; // prazno = izvorni tekst
      else pending[key] = value;
      wrap.classList.toggle('changed', key in pending);
      reset.hidden = !(key in pending);
      updateSavebar();
    }
    control.addEventListener('input', sync);
    wrap.classList.toggle('changed', key in pending);
    reset.hidden = !(key in pending);
    return wrap;
  }

  const groups = [];
  groups.push(h('details', { class: 'card group', open: true },
    h('summary', {}, 'Cijene i postavke', h('span', { class: 'group-count' }, `${CONFIG_FIELDS.length} polja`)),
    h('div', { class: 'group-body cfg-grid' },
      CONFIG_FIELDS.map((f) => textField(CFG_PREFIX + f.path, f.label, String(getConfigValue(CONFIG, f.path)), f.type)))));

  const sections = [...new Set(texts.map((t) => t.sectionTitle))];
  sections.forEach((title) => {
    const items = texts.filter((t) => t.sectionTitle === title);
    groups.push(h('details', { class: 'card group' },
      h('summary', {}, title, h('span', { class: 'group-count' }, `${items.length} tekstova`)),
      h('div', { class: 'group-body' }, items.map((t) => textField(t.key, KIND_LABEL[t.kind] || 'Tekst', t.original)))));
  });

  const code = (text) => h('code', {}, text);
  view.replaceChildren(
    h('div', { class: 'hint-box' },
      'Promjene su vidljive na stranici odmah nakon spremanja. Posebni zapisi: ', code('**podebljano**'), ', ',
      code('[tekst linka](#kalkulator)'), ' i ', code('{{services.dostava.base}}'),
      ' — umetak u vitičastim zagradama povlači cijenu iz polja „Cijene i postavke”, pa ga ne treba dirati.'),
    ...groups, savebar);
  updateSavebar();

  async function save() {
    const dirty = dirtyKeys();
    const upserts = dirty.filter((k) => k in pending).map((k) => ({ key: k, value: pending[k], updated_at: new Date().toISOString() }));
    const removals = dirty.filter((k) => !(k in pending));
    try {
      if (upserts.length) {
        await rest('pokupi_content', '', { method: 'POST', body: upserts, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      }
      if (removals.length) {
        const list = removals.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(',');
        await rest('pokupi_content', `?key=in.(${encodeURIComponent(list)})`, { method: 'DELETE' });
      }
      db.content = { ...pending };
      updateSavebar();
      toast('Spremljeno. Promjene su vidljive na stranici.');
    } catch (err) {
      toast(`Spremanje nije uspjelo: ${err.message}`, true);
    }
  }
}

/* =====================================================================
   6. Ljuska aplikacije
   ===================================================================== */
const VIEWS = {
  pregled: ['Pregled', renderPregled],
  rezervacije: ['Rezervacije', renderRezervacije],
  kalendar: ['Kalendar', renderKalendar],
  troskovi: ['Troškovnik', renderTroskovi],
  tekstovi: ['Tekstovi i cijene', renderTekstovi],
};
const currentView = () => (VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'pregled');

function refresh() {
  const name = currentView();
  const [title, render] = VIEWS[name];
  $('#view-title').textContent = title;
  document.querySelectorAll('.nav a').forEach((a) => {
    const active = a.dataset.view === name;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const fresh = db.bookings.filter((b) => b.status === 'novo').length;
  $('#nav-new').hidden = fresh === 0;
  $('#nav-new').textContent = fresh;
  Promise.resolve(render()).catch((err) => toast(err.message, true));
}

function setSidebar(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#backdrop').hidden = !open;
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('pokupi-admin-theme', theme); } catch { /* nema spremanja */ }
  $('#theme-toggle span').textContent = theme === 'dark' ? 'Svijetli mod' : 'Tamni mod';
}

function openPasswordDialog(forced = false) {
  openDialog({
    title: forced ? 'Postavi svoju lozinku' : 'Promjena lozinke',
    body: [
      forced && h('p', { class: 'muted', style: 'margin-bottom:1rem' }, 'Prijavljen si privremenom lozinkom. Postavi svoju prije nastavka.'),
      field('Nova lozinka (najmanje 8 znakova)', h('input', { type: 'password', name: 'password', minlength: 8, required: true, autocomplete: 'new-password' })),
      field('Ponovi lozinku', h('input', { type: 'password', name: 'repeat', minlength: 8, required: true, autocomplete: 'new-password' })),
    ],
    actions: [
      !forced && h('button', { type: 'button', class: 'btn btn-ghost', 'data-close': true }, 'Odustani'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Spremi lozinku'),
    ].filter(Boolean),
    onSubmit: async (form) => {
      const password = form.get('password');
      if (password.length < 8) return toast('Lozinka mora imati najmanje 8 znakova.', true);
      if (password !== form.get('repeat')) return toast('Lozinke se ne podudaraju.', true);
      const user = await authRequest('user', { password, data: { must_change_password: false } }, session.access_token);
      session.user = user;
      saveSession({ ...session, expires_in: session.expires_at - Math.floor(Date.now() / 1000) });
      closeDialog();
      toast('Lozinka je promijenjena.');
    },
  });
}

function showLogin(message = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-error').hidden = !message;
  $('#login-error').textContent = message;
}

async function logout() {
  const token = session?.access_token;
  saveSession(null); // prvo lokalno – odjava mora uspjeti i bez mreže
  if (token) fetch(`${SB.url}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: SB.key, Authorization: `Bearer ${token}` } }).catch(() => {});
  showLogin();
}

/** Nakon prijave: provjeri administratorska prava pa učitaj podatke. */
async function startApp() {
  const isAdmin = await rest('rpc/pokupi_is_admin', '', { method: 'POST', body: {} });
  if (!isAdmin) {
    saveSession(null);
    return showLogin('Ovaj račun nema pristup dashboardu.');
  }
  await loadAll();
  $('#login').hidden = true;
  $('#app').hidden = false;
  refresh();
  if (session.user?.user_metadata?.must_change_password) openPasswordDialog(true);
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-submit');
  btn.disabled = true;
  $('#login-error').hidden = true;
  try {
    await signIn($('#login-email').value.trim(), $('#login-password').value);
    $('#login-password').value = '';
    await startApp();
  } catch (err) {
    saveSession(null);
    showLogin(err.status === 400 ? 'Pogrešan email ili lozinka.' : `Prijava nije uspjela: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

window.addEventListener('hashchange', () => { setSidebar(false); if (!$('#app').hidden) refresh(); });
$('#menu-toggle').addEventListener('click', () => setSidebar(!$('#sidebar').classList.contains('open')));
$('#backdrop').addEventListener('click', () => setSidebar(false));
$('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('#password-open').addEventListener('click', () => { setSidebar(false); openPasswordDialog(); });
$('#logout').addEventListener('click', logout);
setTheme(document.documentElement.dataset.theme || 'light');

// Pokretanje: nastavi postojeću sesiju ili prikaži prijavu
(async () => {
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { session = null; }
  if (!session?.access_token) return showLogin();
  try {
    await startApp();
  } catch {
    saveSession(null);
    showLogin('Sesija je istekla. Prijavi se ponovno.');
  }
})();
