/**
 * Podaci koje administrator mijenja u dashboardu, a javna stranica samo čita:
 *  - pokupi_content        izmijenjeni tekstovi i cijene
 *  - pokupi_blocked_dates  dani kad se ne primaju rezervacije
 *
 * Zadnje poznate vrijednosti čuvaju se u localStorage-u pa se pri sljedećem
 * posjetu primjenjuju odmah, a svježe se dohvaćaju u pozadini.
 */
import { CONFIG } from './config.js';

const CACHE_KEY = 'pokupi-site-data';

function readCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (data && typeof data.content === 'object' && Array.isArray(data.blocked)) return data;
  } catch { /* nema predmemorije ili je neispravna */ }
  return { content: {}, blocked: [] };
}

async function fetchRows(table, select) {
  const { url, key } = CONFIG.supabase;
  const res = await fetch(`${url}/rest/v1/${table}?select=${select}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${table}: ${res.status}`);
  return res.json();
}

/**
 * @param {(content: Record<string,string>) => void} onContentChange
 *   poziva se ako se svježi tekstovi razlikuju od onih iz predmemorije
 * @returns {{content: Record<string,string>, isBlocked: (isoDate: string) => boolean}}
 */
export function loadSiteData(onContentChange) {
  const cached = readCache();
  const blocked = new Set(cached.blocked);

  if (CONFIG.supabase.url && CONFIG.supabase.key) {
    Promise.all([fetchRows('pokupi_content', 'key,value'), fetchRows('pokupi_blocked_dates', 'date')])
      .then(([contentRows, blockedRows]) => {
        const content = Object.fromEntries(contentRows.map((r) => [r.key, r.value]));
        blocked.clear();
        blockedRows.forEach((r) => blocked.add(r.date));
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ content, blocked: [...blocked] }));
        } catch { /* privatni način rada */ }
        // Ako je izmjena uklonjena u adminu, izvorni tekst se vraća pri sljedećem učitavanju.
        if (JSON.stringify(content) !== JSON.stringify(cached.content)) onContentChange(content);
      })
      .catch((err) => console.warn('Podaci stranice nisu dohvaćeni:', err.message));
  }

  return { content: cached.content, isBlocked: (isoDate) => blocked.has(isoDate) };
}
