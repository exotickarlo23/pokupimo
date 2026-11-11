/**
 * Google Analytics 4 + Google Ads konverzije.
 * - ID-evi su u js/config.js. Dok su placeholderi („XXXX”), ništa se ne učitava.
 * - gtag skripta učitava se tek nakon privole korisnika (GDPR).
 * - Događaji: uspješna rezervacija, klik na poziv, klik na WhatsApp.
 */
import { CONFIG } from './config.js';

const CONSENT_KEY = 'pokupi-consent';
const { ga4Id, adsId, adsLabels } = CONFIG.analytics;
const isSet = (id) => Boolean(id) && !id.includes('XXXX');
let loaded = false;

function gtag() {
  window.dataLayer.push(arguments); // gtag očekuje objekt `arguments`
}

function loadGtag() {
  if (loaded) return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${isSet(ga4Id) ? ga4Id : adsId}`;
  document.head.append(s);
  gtag('js', new Date());
  if (isSet(ga4Id)) gtag('config', ga4Id);
  if (isSet(adsId)) gtag('config', adsId);
}

function readConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}
function saveConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* privatni način rada */ }
}

/** Pokreni analitiku: prikaži traku za privolu ako treba. */
export function initAnalytics() {
  if (!isSet(ga4Id) && !isSet(adsId)) return; // placeholderi – ništa ne radimo
  const consent = readConsent();
  if (consent === 'yes') return loadGtag();
  if (consent === 'no') return;

  const bar = document.getElementById('consent');
  bar.hidden = false;
  bar.addEventListener('click', (e) => {
    const choice = e.target.closest('[data-consent]')?.dataset.consent;
    if (!choice) return;
    saveConsent(choice);
    bar.hidden = true;
    if (choice === 'yes') loadGtag();
  });
}

/**
 * Zabilježi događaj.
 * @param {'booking'|'call'|'whatsapp'} type
 * @param {object} params  dodatni parametri (npr. value)
 */
export function track(type, params = {}) {
  if (!loaded) return;
  const ga4Event = { booking: 'generate_lead', call: 'click_call', whatsapp: 'click_whatsapp' }[type];
  if (isSet(ga4Id)) gtag('event', ga4Event, { currency: 'EUR', ...params });
  if (isSet(adsId) && isSet(adsLabels[type])) {
    gtag('event', 'conversion', { send_to: `${adsId}/${adsLabels[type]}`, currency: 'EUR', ...params });
  }
}

/** Klikovi na poziv / WhatsApp: svi linkovi s atributom data-track. */
export function initClickTracking() {
  document.addEventListener('click', (e) => {
    const type = e.target.closest('[data-track]')?.dataset.track;
    if (type) track(type);
  });
}
