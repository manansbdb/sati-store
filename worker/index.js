// SATI · api worker — cria checkouts Lemon MoR sem expor a chave ao navegador.
const LEMON_BASE = "https://api.lemonsqueezy.com/v1";
const STORE_ID = "523768";
const VARIANT_ID = "2378241";
const REDIRECT = "https://getati.store/?pay=lemon";
const ALLOWED_ORIGIN = "https://getati.store";
// Mantido em sincronia com o CATALOG de index.html (per = USD por unitSize). Regenerado por .scratch/gen_worker.py.
const PRICING =
{"ig_followers":{"per":5.99,"unitSize":1000,"min":100},
 "ig_likes":{"per":3.49,"unitSize":1000,"min":100},
 "ig_views":{"per":2.49,"unitSize":1000,"min":500},
 "ig_comments":{"per":0.999,"unitSize":1,"min":10},
 "ig_reel_likes":{"per":3.5,"unitSize":1000,"min":100},
 "ig_story_views":{"per":1.49,"unitSize":1000,"min":500},
 "tt_followers":{"per":8.99,"unitSize":1000,"min":100},
 "tt_likes":{"per":2.99,"unitSize":1000,"min":100},
 "tt_views":{"per":1.99,"unitSize":1000,"min":500},
 "tt_shares":{"per":2.72,"unitSize":1000,"min":100},
 "tt_comments":{"per":0.2,"unitSize":1,"min":10},
 "yt_subs":{"per":19.97,"unitSize":1000,"min":50},
 "yt_views":{"per":4.99,"unitSize":1000,"min":100},
 "yt_likes":{"per":2.99,"unitSize":1000,"min":50},
 "yt_watch":{"per":0.4099,"unitSize":1,"min":100,"max":20000},
 "yt_comments":{"per":0.3,"unitSize":1,"min":10},
 "fb_followers":{"per":5.99,"unitSize":1000,"min":100},
 "fb_page_likes":{"per":12.0,"unitSize":1000,"min":100},
 "fb_post_likes":{"per":3.5,"unitSize":1000,"min":100},
 "fb_views":{"per":3.2,"unitSize":1000,"min":100},
 "fb_comments":{"per":0.28,"unitSize":1,"min":10},
 "x_followers":{"per":8.99,"unitSize":1000,"min":100},
 "x_likes":{"per":2.99,"unitSize":1000,"min":100},
 "x_retweets":{"per":3.9,"unitSize":1000,"min":100},
 "x_views":{"per":2.99,"unitSize":1000,"min":500},
 "tg_members":{"per":14.4,"unitSize":1000,"min":100},
 "tg_views":{"per":1.44,"unitSize":1000,"min":500},
 "tg_reactions":{"per":0.3,"unitSize":1,"min":10},
 "th_followers":{"per":5.0,"unitSize":1000,"min":100},
 "th_likes":{"per":3.99,"unitSize":1000,"min":100},
 "th_reposts":{"per":1.99,"unitSize":1000,"min":100}
}
;
const r2 = (x) => Math.round(x * 100) / 100;
function priceService(id, qty) {
  const s = PRICING[id]; if (!s) return null;
  qty = Math.max(s.min, Math.min(s.max || 200000, Math.floor(Number(qty) || s.min)));
  let p = s.per * qty / s.unitSize;
  const from = s.unitSize === 1000 ? r2(s.per) : r2(s.per * s.min / s.unitSize);
  p = Math.max(p, from);
  let d = 0; if (s.unitSize === 1000 && qty >= 25000) d = .10; else if (s.unitSize === 1000 && qty >= 10000) d = .05;
  return Math.round(p * (1 - d) * 100);
}
async function createCheckout(env, cents, label, email, code) {
  const body = { data: { type: "checkouts", attributes: {
    custom_price: cents, test_mode: false,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    product_options: { name: label, redirect_url: REDIRECT },
    checkout_data: { email: email || undefined, custom: { code, source: "web" } } },
    relationships: { store: { data: { type: "stores", id: STORE_ID } }, variant: { data: { type: "variants", id: VARIANT_ID } } } } };
  const r = await fetch(LEMON_BASE + "/checkouts", { method: "POST", headers: { Authorization: "Bearer " + env.LEMON_KEY, "Content-Type": "application/vnd.api+json", Accept: "application/vnd.api+json" }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok || !d.data) throw new Error(((d.errors || [{}])[0].detail || ("http " + r.status)));
  return d.data.attributes.url;
}
const json = (o, h, code = 200) => new Response(JSON.stringify(o), { status: code, headers: { "Content-Type": "application/json", ...h } });
export default {
  async fetch(req, env) {
    const _o = (req.headers.get("origin") || "").trim();
    const _ao = /^https:\/\/([a-z0-9-]+\.)*getati\.store$/i.test(_o) ? _o : ALLOWED_ORIGIN;
    const h = { "Access-Control-Allow-Origin": _ao, "Vary": "Origin", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    if (u.pathname === "/healthz") return json({ ok: true }, h);
    if (u.pathname === "/checkout" && req.method === "POST") {
      let b; try { b = await req.json(); } catch { return json({ ok: false, error: "json" }, h, 400); }
      let cents = null, label = b.label || "";
      if (b.kind === "package") { cents = Math.round(r2(Number(b.total) || 0) * 100); label = label || ("SATI Collection " + (b.pkgId || "")); }
      else if (b.kind === "service") { cents = priceService(b.serviceId, b.qty); if (!label) label = "SATI " + b.serviceId + " x " + (Number(b.qty) || ""); }
      if (!cents || cents <= 0 || cents > 1000000) return json({ ok: false, error: "price" }, h, 400);
      label = (label || "SATI order") + (b.link ? " | " + String(b.link).slice(0, 60) : "");
      try {
        const url = await createCheckout(env, cents, label, b.email, b.code);
        return json({ ok: true, url, code: b.code || null, currency: "EUR" }, h);
      } catch (e) { return json({ ok: false, error: String(e.message || e).slice(0, 200) }, h, 502); }
    }
    return json({ ok: false, error: "nf" }, h, 404);
  }
};
