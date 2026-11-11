/**
 * Uređivanje tekstova i cijena iz admin dashboarda.
 *
 * Ovaj modul dijele javna stranica i admin:
 *  - collectEditable(doc)  pronalazi sve tekstove na stranici i daje im stabilan ključ
 *  - toMarkup(el)          tekst elementa → jednostavan zapis za uređivanje
 *  - renderMarkup(text)    zapis → DOM (bez innerHTML-a, pa nema XSS-a)
 *
 * Zapis koji se uređuje:
 *    **podebljano**            → <strong>
 *    [tekst](#sidro ili URL)   → link
 *    {{services.dostava.base}} → vrijednost iz js/config.js (npr. cijena)
 *
 * U bazi (tablica pokupi_content) spremaju se SAMO izmijenjene vrijednosti;
 * sve ostalo dolazi iz index.html i js/config.js.
 */

/** Elementi čiji se tekst može uređivati (unutar sekcija i footera). */
const SELECTOR = [
  '.eyebrow', '.h1-main', '.hl', 'h2', 'h3', 'p', 'summary',
  '.ticks li', '.hero-points li', '.about-points li', '.tags li',
  '.choice-title', '.choice-note', '.badge',
  '.zone-badge', '.zone-name', '.zone-price',
  '.chip-label', '.chip-value',
  '.fit-items span', '.fit-gallery span', '.fit-note strong',
  '.hero-cta .btn', '[data-pick-service]', '.btn-whatsapp',
].join(',');

/** Dijelovi stranice kojima upravlja JS ili konfiguracija – ne uređuju se. */
const SKIP_INSIDE = '#booking, #booking-success, .route, .ticket-price, .ticket-lines, .footer-list, .zone-map';

/** Postavke iz js/config.js koje se smiju mijenjati iz admina. */
export const CONFIG_FIELDS = [
  { path: 'services.dostava.base', label: 'Dostava 1–3 komada (€)', type: 'number' },
  { path: 'services.unos.base', label: 'Dostava s unosom (€)', type: 'number' },
  { path: 'services.unos.includedFloors', label: 'Unos: uključeno katova bez lifta', type: 'number' },
  { path: 'services.selidba.hourly', label: 'Mala selidba (€/h)', type: 'number' },
  { path: 'services.selidba.minHours', label: 'Selidba: minimalno sati', type: 'number' },
  { path: 'zones.z2.surcharge', label: 'Zona 2: doplata (€)', type: 'number' },
  { path: 'floorSurcharge', label: 'Doplata po katu bez lifta (€)', type: 'number' },
  { path: 'zones.z3.perKm', label: 'Izvan zona: € po km', type: 'number' },
  { path: 'zones.z3.min', label: 'Izvan zona: minimalna cijena (€)', type: 'number' },
  { path: 'workingHours', label: 'Radno vrijeme (dani)', type: 'text' },
  { path: 'workingHoursShort', label: 'Radno vrijeme (sati)', type: 'text' },
  { path: 'vehicle.name', label: 'Naziv vozila', type: 'text' },
];
export const CFG_PREFIX = 'cfg/';

const isMedia = (node) => node.nodeType === 1 && /^(svg|img)$/i.test(node.tagName);

/**
 * Pronađi sve uredive tekstove.
 * @returns {{key:string, section:string, sectionTitle:string, el:Element}[]}
 */
export function collectEditable(doc) {
  const items = [];
  doc.querySelectorAll('main section[id], footer').forEach((section) => {
    const sectionId = section.id || 'footer';
    const sectionTitle = sectionId === 'footer' ? 'Podnožje (footer)'
      : sectionId === 'pocetak' ? 'Početak (hero)'
        : section.querySelector('h2')?.textContent.trim() || sectionId;
    const counters = {};
    section.querySelectorAll(SELECTOR).forEach((el) => {
      if (el.closest(SKIP_INSIDE)) return;
      if (el.id || el.hasAttribute('data-cfg') || el.hasAttribute('aria-live')) return;
      if (el.matches('.error, .sr-only, .hint[id], .kicker ~ .x')) return;
      if (el.querySelector(SELECTOR)) return;                       // uzmi samo najdublji element
      if (el.querySelector('[id], input, select, textarea, [data-tel], [data-wa], [data-social]')) return;
      if (!el.textContent.trim()) return;
      const name = (el.classList[0] || el.tagName).toLowerCase();
      counters[name] = (counters[name] || 0) + 1;
      items.push({ key: `${sectionId}/${name}/${counters[name]}`, section: sectionId, sectionTitle, el });
    });
  });
  return items;
}

/** Tekst elementa u zapisu za uređivanje. */
export function toMarkup(el) {
  const walk = (node) => {
    if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
    if (node.nodeType !== 1 || isMedia(node)) return '';
    const inner = [...node.childNodes].map(walk).join('');
    if (node.tagName === 'BR') return '\n';
    if (node.hasAttribute('data-cfg')) return `{{${node.getAttribute('data-cfg')}}}`;
    if (/^(STRONG|B)$/.test(node.tagName)) return `**${inner.trim()}**`;
    if (node.tagName === 'A') return `[${inner.trim()}](${node.getAttribute('href')})`;
    return inner;
  };
  return [...el.childNodes].map(walk).join('').trim();
}

/** Zapis → DocumentFragment. Tekst se nikad ne tumači kao HTML. */
export function renderMarkup(text, doc = document) {
  const frag = doc.createDocumentFragment();
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\((#[\w-]+|https?:\/\/[^\s)]+|tel:[+\d]+|mailto:[^\s)]+)\)|\{\{([\w.]+)\}\}|\n/g;
  let last = 0;
  let m;
  while ((m = pattern.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const strong = doc.createElement('strong');
      strong.append(renderMarkup(m[1], doc));
      frag.append(strong);
    } else if (m[2] !== undefined) {
      const a = doc.createElement('a');
      a.href = m[3];
      a.textContent = m[2];
      if (/^https?:/.test(m[3])) { a.target = '_blank'; a.rel = 'noopener'; }
      frag.append(a);
    } else if (m[4] !== undefined) {
      const span = doc.createElement('span');
      span.setAttribute('data-cfg', m[4]);   // vrijednost upisuje fillFromConfig()
      frag.append(span);
    } else {
      frag.append(doc.createElement('br'));
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

/** Zamijeni tekst elementa; ikone i slike (svg/img) ostaju na svom mjestu. */
export function applyText(el, markup) {
  const nodes = [...el.childNodes];
  const firstReal = nodes.find((n) => isMedia(n) || (n.nodeType === 3 && n.textContent.trim()) || n.nodeType === 1);
  const mediaFirst = firstReal && isMedia(firstReal);
  nodes.filter((n) => !isMedia(n)).forEach((n) => n.remove());
  const frag = renderMarkup(markup, el.ownerDocument);
  if (mediaFirst) el.append(frag); else el.prepend(frag);
}

/** Upiši izmijenjene postavke u CONFIG (samo dopuštena polja). */
export function applyConfigOverrides(config, overrides) {
  CONFIG_FIELDS.forEach(({ path, type }) => {
    const raw = overrides[CFG_PREFIX + path];
    if (raw === undefined || raw === '') return;
    const value = type === 'number' ? Number(String(raw).replace(',', '.')) : String(raw);
    if (type === 'number' && (!Number.isFinite(value) || value < 0)) return;
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((obj, key) => obj?.[key], config);
    if (target) target[last] = value;
  });
}

/** Dohvati vrijednost iz CONFIG-a po putanji (npr. "zones.z2.surcharge"). */
export function getConfigValue(config, path) {
  return path.split('.').reduce((obj, key) => obj?.[key], config);
}
