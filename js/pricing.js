/**
 * Čista logika cjenika – bez DOM-a, da se može testirati u Nodeu
 * (vidi tests/pricing.test.mjs).
 */
import { CONFIG } from './config.js';

/** Ograniči broj na raspon [min, max] i zaokruži na cijeli broj. */
export function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Izračun cijene.
 * @param {{service:string, zone:string, floors:number, hours?:number}} sel
 * @param {object} cfg  konfiguracija (zadano CONFIG – parametar postoji radi testova)
 * @returns {{
 *   quote:boolean,            // true = „cijena po ponudi”
 *   total:number|null,        // ukupno u € (null kod ponude)
 *   lines:{label:string, amount:number}[],  // stavke obračuna
 *   hours:number|null, floors:number, extraFloors:number
 * }}
 */
export function calcPrice(sel, cfg = CONFIG) {
  const service = cfg.services[sel.service];
  const zone = cfg.zones[sel.zone];
  if (!service) throw new Error(`Nepoznata usluga: ${sel.service}`);
  if (!zone) throw new Error(`Nepoznata zona: ${sel.zone}`);

  const floors = clampInt(sel.floors ?? 0, 0, cfg.maxFloors);
  const isHourly = typeof service.hourly === 'number';
  const hours = isHourly
    ? clampInt(sel.hours ?? service.minHours, service.minHours, service.maxHours)
    : null;
  const extraFloors = Math.max(0, floors - (service.includedFloors ?? 0));

  const lines = [];
  if (isHourly) {
    lines.push({ label: `${service.name} · ${hours} h × ${service.hourly} €`, amount: hours * service.hourly });
  } else {
    lines.push({ label: service.name, amount: service.base });
  }
  if (extraFloors > 0) {
    lines.push({
      label: `Katovi bez lifta · ${extraFloors} × ${cfg.floorSurcharge} €`,
      amount: extraFloors * cfg.floorSurcharge,
    });
  }

  // Izvan zona: iznos se ne računa, javljamo se s ponudom.
  if (zone.quote) {
    return { quote: true, total: null, lines, hours, floors, extraFloors };
  }

  if (zone.surcharge > 0) {
    lines.push({ label: zone.name, amount: zone.surcharge });
  }
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return { quote: false, total, lines, hours, floors, extraFloors };
}

/** Naziv usluge za spremanje u bazu (selidba dobiva i broj sati). */
export function serviceLabel(sel, cfg = CONFIG) {
  const service = cfg.services[sel.service];
  const { hours } = calcPrice(sel, cfg);
  return hours ? `${service.name} – ${hours} h` : service.name;
}
