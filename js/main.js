/**
 * Pokupi – glavni modul sučelja:
 *  1. popunjavanje tekstova iz konfiguracije (cijene, kontakt…)
 *  2. kopije ilustracije kombija
 *  3. ruta: kombi vozi preko „stanica” dok se skrola
 *  4. pojavljivanje sekcija pri skrolu
 *  5. kalkulator cijene
 *  6. kartice usluga i zona → kalkulator
 * Forma za rezervaciju je u booking.js, analitika u analytics.js.
 */
import { CONFIG } from './config.js';
import { calcPrice } from './pricing.js';
import { getState, setState, subscribe } from './state.js';
import { initBooking } from './booking.js';
import { initAnalytics, initClickTracking } from './analytics.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- 1. Tekstovi iz konfiguracije ---------- */
function fillFromConfig() {
  // <span data-cfg="services.dostava.base"> → vrijednost iz CONFIG-a
  $$('[data-cfg]').forEach((el) => {
    const value = el.dataset.cfg.split('.').reduce((obj, key) => obj?.[key], CONFIG);
    if (value !== undefined && value !== null) el.textContent = value;
  });
  $$('[data-tel]').forEach((a) => { a.href = `tel:${CONFIG.contact.phoneIntl}`; });
  $$('[data-social]').forEach((a) => { a.href = CONFIG.social[a.dataset.social]; });
  updateWhatsAppLinks();
  $('#year').textContent = new Date().getFullYear();

  // Dimenzije teretnog prostora: prikaži samo ako su upisane u konfiguraciju
  const cargo = CONFIG.vehicle.cargo;
  const dims = $('#cargo-dims');
  let any = false;
  $$('[data-cargo]', dims).forEach((el) => {
    const value = cargo[el.dataset.cargo];
    if (value === null || value === undefined) {
      el.closest('div').hidden = true;
    } else {
      el.textContent = String(value).replace('.', ',');
      any = true;
    }
  });
  dims.hidden = !any;
}

/** WhatsApp linkovi s prepopunjenom porukom; [datum] se zamijeni odabranim datumom. */
export function updateWhatsAppLinks(dateText) {
  const message = dateText
    ? CONFIG.contact.whatsappMessage.replace('[datum]', dateText)
    : CONFIG.contact.whatsappMessage;
  const href = `https://wa.me/${CONFIG.contact.whatsapp}?text=${encodeURIComponent(message)}`;
  $$('[data-wa]').forEach((a) => { a.href = href; });
}

/* ---------- 2. Kopije kombija ---------- */
function cloneVans() {
  const art = $('#van-art');
  $$('[data-van]').forEach((slot) => {
    const copy = art.cloneNode(true);
    copy.removeAttribute('id');
    copy.removeAttribute('role');
    copy.removeAttribute('aria-label');
    copy.setAttribute('aria-hidden', 'true');
    slot.append(copy);
  });
}

/* ---------- 3. Ruta ---------- */
function initRoute() {
  const route = $('.route');
  const van = $('.route-van');
  const stations = $$('.station', route);
  const sections = stations.map((a) => $(a.getAttribute('href')));
  let tops = [];
  let centers = [];
  let lastX = null;
  let ticking = false;
  let stopTimer;

  function measure() {
    const routeLeft = route.getBoundingClientRect().left;
    tops = sections.map((s) => s.getBoundingClientRect().top + window.scrollY);
    centers = stations.map((a) => {
      const r = a.getBoundingClientRect();
      return r.left + r.width / 2 - routeLeft;
    });
    update();
  }

  function update() {
    ticking = false;
    const last = tops.length - 1;
    const y = window.scrollY + window.innerHeight * 0.4; // referentna linija na 40 % visine
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;

    // u kojoj smo sekciji i koliko duboko (0–1)
    let i = 0;
    while (i < last && y >= tops[i + 1]) i++;
    let t = i < last ? (y - tops[i]) / (tops[i + 1] - tops[i]) : 0;
    t = Math.min(1, Math.max(0, t));
    if (atBottom) { i = last; t = 0; }

    const x = (i < last ? centers[i] + (centers[i + 1] - centers[i]) * t : centers[last]) - van.offsetWidth / 2;
    van.style.setProperty('--van-x', `${x.toFixed(1)}px`);

    // smjer vožnje + okretanje kotača dok se skrola
    if (lastX !== null && Math.abs(x - lastX) > 0.5) {
      van.classList.toggle('reverse', x < lastX);
      van.classList.add('moving');
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => van.classList.remove('moving'), 180);
    }
    lastX = x;

    stations.forEach((a, idx) => {
      a.classList.toggle('passed', idx < i);
      a.classList.toggle('current', idx === i);
      if (idx === i) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  const onScroll = () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  // visina stranice se mijenja (npr. polja u kalkulatoru, potvrda rezervacije)
  new ResizeObserver(measure).observe(document.body);
  measure();
}

/* ---------- 4. Pojavljivanje pri skrolu ---------- */
function initReveal() {
  const items = $$('.reveal');
  if (!('IntersectionObserver' in window) || reducedMotion.matches) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  items.forEach((el) => io.observe(el));
}

/* ---------- 5. Kalkulator ---------- */
function initCalculator() {
  const form = $('#calc');
  const amountEl = $('#calc-amount');
  const priceEl = $('.ticket-price', form);
  const quoteEl = $('#calc-quote');
  const linesEl = $('#calc-lines');
  const liveEl = $('#calc-live');
  const cta = $('#calc-cta');
  const floorsInput = $('#calc-floors');
  const hoursInput = $('#calc-hours');
  const destInput = $('#calc-destination');
  let shown = null; // trenutno prikazan iznos (za animaciju broja)
  let raf;

  // Granice iz konfiguracije
  floorsInput.max = CONFIG.maxFloors;
  hoursInput.min = CONFIG.services.selidba.minHours;
  hoursInput.max = CONFIG.services.selidba.maxHours;

  /** Animirani broj: glatko „odbrojavanje” od stare do nove cijene. */
  function animateAmount(to) {
    cancelAnimationFrame(raf);
    if (shown === null || reducedMotion.matches) {
      shown = to;
      amountEl.textContent = to;
      return;
    }
    const from = shown;
    const start = performance.now();
    const duration = 450;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      shown = Math.round(from + (to - from) * eased);
      amountEl.textContent = shown;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    priceEl.classList.remove('bump');
    void priceEl.offsetWidth; // ponovno pokreni CSS animaciju
    priceEl.classList.add('bump');
  }

  function render(s) {
    const service = CONFIG.services[s.service];
    const zone = CONFIG.zones[s.zone];
    const result = calcPrice(s);

    // sinkroniziraj kontrole sa stanjem (stanje se može promijeniti i izvana)
    form.elements.service.value = s.service;
    form.elements.zone.value = s.zone;
    if (document.activeElement !== floorsInput) floorsInput.value = s.floors;
    if (document.activeElement !== hoursInput) hoursInput.value = s.hours;
    if (document.activeElement !== destInput) destInput.value = s.destination;

    $('#calc-hours-wrap').hidden = !service.hourly;
    $('#calc-destination-wrap').hidden = !zone.quote;
    $('#calc-floors-hint').textContent = service.includedFloors > 0
      ? `Ukupno na obje adrese. Uključen ${service.includedFloors} kat, svaki dodatni +${CONFIG.floorSurcharge} €.`
      : `Ukupno na obje adrese. Svaki kat +${CONFIG.floorSurcharge} €.`;

    $$('.stepper-btn', form).forEach((btn) => {
      const input = $(`#${btn.dataset.for}`);
      const value = btn.dataset.for === 'calc-floors' ? s.floors : s.hours;
      btn.disabled = Number(btn.dataset.step) < 0 ? value <= Number(input.min) : value >= Number(input.max);
    });

    // stavke obračuna
    linesEl.replaceChildren(...result.lines.map((line) => {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><span></span>';
      li.firstChild.textContent = line.label;
      li.lastChild.textContent = `${line.amount} €`;
      return li;
    }));
    if (result.quote) {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><span>po ponudi</span>';
      li.firstChild.textContent = `Prijevoz · ${zone.perKm} €/km, min. ${zone.min} €`;
      linesEl.append(li);
    }

    priceEl.hidden = result.quote;
    quoteEl.hidden = !result.quote;
    if (result.quote) {
      shown = null;
      cta.textContent = 'Zatraži ponudu';
      liveEl.textContent = 'Cijena po ponudi – javit ćemo se.';
    } else {
      animateAmount(result.total);
      cta.textContent = `Rezerviraj za ${result.total} €`;
      liveEl.textContent = `Procijenjena cijena: ${result.total} €.`;
    }
  }

  // Promjene kontrola → stanje
  form.addEventListener('change', (e) => {
    const { name, value } = e.target;
    if (name === 'service' || name === 'zone') setState({ [name]: value });
    if (name === 'floors' || name === 'hours') {
      setState({ [name]: value });
      e.target.value = getState()[name]; // prikaži ograničenu vrijednost
    }
  });
  form.addEventListener('input', (e) => {
    const { name, value } = e.target;
    if (name === 'destination') setState({ destination: value });
    if ((name === 'floors' || name === 'hours') && value !== '') setState({ [name]: value });
  });
  form.addEventListener('click', (e) => {
    const btn = e.target.closest('.stepper-btn');
    if (!btn) return;
    const key = btn.dataset.for === 'calc-floors' ? 'floors' : 'hours';
    setState({ [key]: getState()[key] + Number(btn.dataset.step) });
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  subscribe(render);
}

/* ---------- 6. Kartice usluga i zona → kalkulator ---------- */
function initPickers() {
  const goToCalc = () => $('#kalkulator').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });

  $$('[data-pick-service]').forEach((btn) => btn.addEventListener('click', () => {
    setState({ service: btn.dataset.pickService });
    goToCalc();
  }));
  $$('[data-pick-zone]').forEach((btn) => btn.addEventListener('click', () => {
    setState({ zone: btn.dataset.pickZone });
    goToCalc();
  }));
  // klik na zonu na karti samo je označi (bez skoka), uz isticanje kartice
  $$('.map-zone').forEach((g) => g.addEventListener('click', () => setState({ zone: g.dataset.zone })));

  subscribe((s) => {
    $$('[data-pick-zone]').forEach((b) => b.classList.toggle('active', b.dataset.pickZone === s.zone));
    $$('.map-zone').forEach((g) => g.classList.toggle('active', g.dataset.zone === s.zone));
  });
}

/* ---------- Pokretanje ---------- */
fillFromConfig();
cloneVans();
initCalculator();
initPickers();
initBooking({ updateWhatsAppLinks });
initRoute();
initReveal();
initAnalytics();
initClickTracking();
