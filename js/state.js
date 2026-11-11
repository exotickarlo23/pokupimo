/**
 * Zajedničko stanje odabira (usluga, zona, katovi, sati, odredište).
 * Dijele ga kalkulator i forma za rezervaciju – tako se odabir iz
 * kalkulatora automatski „prenosi” u formu.
 */
import { CONFIG } from './config.js';
import { clampInt } from './pricing.js';

const state = {
  service: 'dostava',
  zone: 'z1',
  floors: 0,
  hours: CONFIG.services.selidba.minHours,
  destination: '',
};
const listeners = new Set();

export function getState() {
  return { ...state };
}

/** Promijeni dio stanja (uz validaciju) i obavijesti pretplatnike. */
export function setState(patch) {
  const next = { ...state, ...patch };
  if (!CONFIG.services[next.service]) next.service = state.service;
  if (!CONFIG.zones[next.zone]) next.zone = state.zone;
  next.floors = clampInt(next.floors, 0, CONFIG.maxFloors);
  next.hours = clampInt(next.hours, CONFIG.services.selidba.minHours, CONFIG.services.selidba.maxHours);
  next.destination = String(next.destination ?? '').slice(0, 200);
  Object.assign(state, next);
  listeners.forEach((fn) => fn(getState()));
}

/** Pretplata na promjene; callback se odmah poziva s trenutnim stanjem. */
export function subscribe(fn) {
  listeners.add(fn);
  fn(getState());
}
