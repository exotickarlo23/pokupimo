/**
 * Test kalkulatora za SVE kombinacije: usluga × zona × katovi × sati.
 * Očekivana cijena računa se neovisno, izravno iz pravila cjenika.
 * Pokretanje: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { calcPrice, serviceLabel } from '../js/pricing.js';

test('cjenik iz specifikacije je u konfiguraciji', () => {
  assert.equal(CONFIG.services.dostava.base, 45);
  assert.equal(CONFIG.services.unos.base, 70);
  assert.equal(CONFIG.services.unos.includedFloors, 1);
  assert.equal(CONFIG.services.selidba.hourly, 60);
  assert.equal(CONFIG.services.selidba.minHours, 2);
  assert.equal(CONFIG.zones.z2.surcharge, 15);
  assert.equal(CONFIG.zones.z3.perKm, 1);
  assert.equal(CONFIG.zones.z3.min, 60);
  assert.equal(CONFIG.floorSurcharge, 10);
});

test('sve kombinacije usluga × zona × katovi × sati', () => {
  let count = 0;
  for (const service of ['dostava', 'unos', 'selidba']) {
    for (const zone of ['z1', 'z2', 'z3']) {
      for (let floors = 0; floors <= CONFIG.maxFloors; floors++) {
        const hoursList = service === 'selidba' ? [2, 3, 4, 5, 6, 7, 8, 9, 10] : [undefined];
        for (const hours of hoursList) {
          const r = calcPrice({ service, zone, floors, hours });
          count++;

          // neovisni izračun po pravilima
          const base = { dostava: 45, unos: 70, selidba: 60 * (hours ?? 0) }[service];
          const included = service === 'unos' ? 1 : 0;
          const expected = base + Math.max(0, floors - included) * 10 + (zone === 'z2' ? 15 : 0);

          if (zone === 'z3') {
            assert.equal(r.quote, true, `${service}/${zone} mora biti po ponudi`);
            assert.equal(r.total, null);
          } else {
            assert.equal(r.quote, false);
            assert.equal(r.total, expected, `${service}/${zone}/katovi=${floors}/sati=${hours}`);
            assert.equal(r.lines.reduce((s, l) => s + l.amount, 0), r.total, 'stavke = ukupno');
          }
        }
      }
    }
  }
  assert.equal(count, 2 * 3 * 21 + 3 * 21 * 9);
});

test('primjeri iz cjenika', () => {
  assert.equal(calcPrice({ service: 'dostava', zone: 'z1', floors: 0 }).total, 45);
  assert.equal(calcPrice({ service: 'dostava', zone: 'z1', floors: 3 }).total, 75);
  assert.equal(calcPrice({ service: 'unos', zone: 'z1', floors: 1 }).total, 70); // 1 kat uključen
  assert.equal(calcPrice({ service: 'unos', zone: 'z2', floors: 4 }).total, 115);
  assert.equal(calcPrice({ service: 'selidba', zone: 'z1', floors: 0, hours: 2 }).total, 120);
  assert.equal(calcPrice({ service: 'selidba', zone: 'z2', floors: 2, hours: 3 }).total, 215);
});

test('rubni slučajevi: sati i katovi se ograničavaju', () => {
  assert.equal(calcPrice({ service: 'selidba', zone: 'z1', floors: 0, hours: 1 }).total, 120); // min 2 h
  assert.equal(calcPrice({ service: 'selidba', zone: 'z1', floors: 0, hours: 0 }).hours, 2);
  assert.equal(calcPrice({ service: 'selidba', zone: 'z1', floors: 0, hours: 99 }).hours, 10);
  assert.equal(calcPrice({ service: 'selidba', zone: 'z1', floors: 0 }).hours, 2);
  assert.equal(calcPrice({ service: 'dostava', zone: 'z1', floors: -3 }).total, 45);
  assert.equal(calcPrice({ service: 'dostava', zone: 'z1', floors: 'abc' }).total, 45);
  assert.equal(calcPrice({ service: 'dostava', zone: 'z1', floors: 0, hours: 5 }).total, 45); // sati se ignoriraju
  assert.throws(() => calcPrice({ service: 'x', zone: 'z1', floors: 0 }));
  assert.throws(() => calcPrice({ service: 'dostava', zone: 'x', floors: 0 }));
});

test('naziv usluge za bazu', () => {
  assert.equal(serviceLabel({ service: 'dostava', zone: 'z1', floors: 0 }), 'Dostava 1–3 komada');
  assert.equal(
    serviceLabel({ service: 'selidba', zone: 'z1', floors: 0, hours: 3 }),
    'Mala selidba (kombi + 2 osobe) – 3 h',
  );
});
