/**
 * Edge funkcija: email notifikacija za novu rezervaciju.
 *
 * Poziva je baza (trigger na pokupi_bookings, vidi migraciju 002) i šalje samo
 * ID rezervacije. Funkcija sama učita red (service role) i pošalje email preko
 * Resend API-ja. Zaštita od zlouporabe: ID je nepogodiv UUID koji javni korisnik
 * ne može pročitati, a prihvaćaju se samo rezervacije stare najviše 15 minuta.
 *
 * Tajne (Supabase → Edge Functions → Secrets):
 *   RESEND_API_KEY         – API ključ s resend.com
 *   POKUPI_NOTIFY_EMAIL    – adresa na koju stižu obavijesti
 *   POKUPI_NOTIFY_FROM     – (opcionalno) pošiljatelj, npr. "Pokupimo <rezervacije@pokupimo.com>"
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BUCKET = "pokupi-uploads";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Privremeni (30 dana) link na sliku u privatnom bucketu. */
async function signedImageUrl(imageUrl: string): Promise<string | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const marker = `/storage/v1/object/${BUCKET}/`;
  const idx = imageUrl.indexOf(marker);
  if (!supabaseUrl || !serviceKey || idx === -1) return null;
  const path = imageUrl.slice(idx + marker.length);
  const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 30 }),
  });
  if (!res.ok) return null;
  const { signedURL } = await res.json();
  return signedURL ? `${supabaseUrl}/storage/v1${signedURL}` : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("POKUPI_NOTIFY_EMAIL");
  if (!resendKey || !to) {
    return new Response("RESEND_API_KEY ili POKUPI_NOTIFY_EMAIL nije postavljen", { status: 500 });
  }

  // Učitaj rezervaciju po ID-u; prihvati samo svježe (≤ 15 min)
  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Bad request", { status: 400 });
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const rowRes = await fetch(
    `${supabaseUrl}/rest/v1/pokupi_bookings?id=eq.${id}&created_at=gte.${since}&select=*`,
    { headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` } },
  );
  const [r] = rowRes.ok ? await rowRes.json() : [];
  if (!r) return new Response("Not found", { status: 404 });

  const price = r.estimated_price === null ? "po ponudi" : `${Number(r.estimated_price)} €`;
  const imageLink = r.image_url ? await signedImageUrl(r.image_url) : null;
  const rows: [string, string][] = [
    ["Usluga", esc(r.service)],
    ["Zona", esc(r.zone)],
    ["Procjena", esc(price)],
    ["Datum i termin", `${esc(r.date)} · ${esc(r.time_slot)} h`],
    ["Preuzimanje", `${esc(r.pickup_address)} (${esc(r.pickup_floor_lift)})`],
    ["Dostava", `${esc(r.dropoff_address)} (${esc(r.dropoff_floor_lift)})`],
    ["Katovi bez lifta", esc(r.floors_no_lift)],
    ["Predmeti", esc(r.item_description)],
    ["Slika", imageLink ? `<a href="${esc(imageLink)}">otvori sliku</a>` : (r.image_url ? "u Storageu" : "—")],
    ["Oglas", r.listing_url ? `<a href="${esc(r.listing_url)}">${esc(r.listing_url)}</a>` : "—"],
    ["Ime", esc(r.name)],
    ["Telefon", `<a href="tel:${esc(String(r.phone).replace(/[^+\d]/g, ""))}">${esc(r.phone)}</a>`],
    ["Email", r.email ? esc(r.email) : "—"],
    ["Napomena", r.note ? esc(r.note) : "—"],
  ];
  const html = `<h2>Nova rezervacija – Pokupimo</h2>
<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:15px">
${rows.map(([k, v]) => `<tr><td style="font-weight:bold;vertical-align:top;border-bottom:1px solid #eee">${k}</td><td style="border-bottom:1px solid #eee">${v}</td></tr>`).join("\n")}
</table>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("POKUPI_NOTIFY_FROM") ?? "Pokupimo <onboarding@resend.dev>",
      to: [to],
      subject: `Nova rezervacija: ${r.name} · ${r.date} ${r.time_slot} · ${price}`,
      html,
      ...(r.email ? { reply_to: r.email } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Resend greška:", res.status, detail);
    return new Response("Slanje emaila nije uspjelo", { status: 502 });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
