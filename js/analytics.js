/**
 * Google Tag Manager (+ opcionalno izravni GA4 / Google Ads) s Google Consent Mode v2.
 *
 * - ID-evi su u js/config.js. ID koji sadrži „XXXX” smatra se praznim i ne učitava se.
 * - GTM se učitava odmah, ali sve dok posjetitelj ne prihvati kolačiće privola je
 *   „denied”: Googleove oznake tada ne spremaju kolačiće (GDPR). Klik na „Prihvati”
 *   mijenja privolu u „granted”, „Odbij” je ostavlja odbijenom. Izbor se pamti.
 * - Događaji se šalju u dataLayer (za okidače u GTM-u):
 *     generate_lead   – uspješno poslana rezervacija (value = procjena u €)
 *     click_call      – klik na broj telefona
 *     click_whatsapp  – klik na WhatsApp
 */
import { CONFIG } from './config.js';

const CONSENT_KEY = 'pokupi-consent';
const { gtmId, ga4Id, adsId, adsLabels } = CONFIG.analytics;
const isSet = (id) => Boolean(id) && !id.includes('XXXX');
const EVENTS = { booking: 'generate_lead', call: 'click_call', whatsapp: 'click_whatsapp' };
let started = false;

window.dataLayer = window.dataLayer || [];
function gtag() {
  window.dataLayer.push(arguments); // gtag očekuje objekt `arguments`
}

function loadScript(src) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.append(s);
}

function readConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}
function saveConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* privatni način rada */ }
}

/** Privola za Consent Mode: 'yes' → granted, sve ostalo → denied. */
function consentState(choice) {
  const value = choice === 'yes' ? 'granted' : 'denied';
  return { ad_storage: value, ad_user_data: value, ad_personalization: value, analytics_storage: value };
}

/** Pokreni analitiku: zadana privola, GTM, i traka za kolačiće ako izbor još nije napravljen. */
export function initAnalytics() {
  if (!isSet(gtmId) && !isSet(ga4Id) && !isSet(adsId)) return;
  started = true;
  const choice = readConsent();

  // 1) Zadana privola MORA biti postavljena prije učitavanja oznaka
  gtag('consent', 'default', { ...consentState(choice), wait_for_update: 500 });
  gtag('js', new Date());

  // 2) Google Tag Manager (standardni isječak)
  if (isSet(gtmId)) {
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    loadScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`);
  }

  // 3) Izravni GA4 / Ads – samo ako su upisani (inače sve ide kroz GTM)
  if (isSet(ga4Id) || isSet(adsId)) {
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(isSet(ga4Id) ? ga4Id : adsId)}`);
    if (isSet(ga4Id)) gtag('config', ga4Id);
    if (isSet(adsId)) gtag('config', adsId);
  }

  // 4) Traka za kolačiće
  if (choice === 'yes' || choice === 'no') return;
  const bar = document.getElementById('consent');
  bar.hidden = false;
  bar.addEventListener('click', (e) => {
    const picked = e.target.closest('[data-consent]')?.dataset.consent;
    if (!picked) return;
    saveConsent(picked);
    bar.hidden = true;
    gtag('consent', 'update', consentState(picked));
    window.dataLayer.push({ event: picked === 'yes' ? 'consent_granted' : 'consent_denied' });
  });
}

/**
 * Zabilježi događaj.
 * @param {'booking'|'call'|'whatsapp'} type
 * @param {object} params  dodatni parametri (npr. value)
 */
export function track(type, params = {}) {
  if (!started) return;
  const name = EVENTS[type];
  window.dataLayer.push({ event: name, currency: 'EUR', ...params });
  if (isSet(ga4Id)) gtag('event', name, { currency: 'EUR', ...params });
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
