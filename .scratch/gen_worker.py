import re, json, os
root = "/Users/matheuscarvalho/apps/sati-store"
html = open(f"{root}/index.html", encoding="utf-8").read()
pricing = {}
for line in html.splitlines():
    if '{id:"' not in line:
        continue
    m = re.search(r'id:"([a-z0-9_]+)".*?per:([0-9.]+),\s*unitSize:(\d+),\s*min:(\d+)(?:,\s*max:(\d+))?', line)
    if m:
        sid, per, us, mn, mx = m.group(1), float(m.group(2)), int(m.group(3)), int(m.group(4)), m.group(5)
        pricing[sid] = {"per": per, "unitSize": us, "min": mn, **({"max": int(mx)} if mx else {})}
print("servicos extraidos:", len(pricing))

pj = "{" + ",\n ".join(f'"{k}":{{"per":{v["per"]},"unitSize":{v["unitSize"]},"min":{v["min"]}' + (f',"max":{v["max"]}' if "max" in v else "") + "}" for k, v in pricing.items()) + "\n}"

worker = '''// SATI · api worker — cria checkouts Lemon MoR sem expor a chave ao navegador.
const LEMON_BASE = "https://api.lemonsqueezy.com/v1";
const STORE_ID = "523768";
const VARIANT_ID = "2378241";
const REDIRECT = "https://getati.store/?pay=lemon";
const ALLOWED_ORIGIN = "https://getati.store";
// Mantido em sincronia com o CATALOG de index.html (per = USD por unitSize). Regenerado por .scratch/gen_worker.py.
const PRICING =
''' + pj + '''
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
'''

os.makedirs(f"{root}/worker", exist_ok=True)
open(f"{root}/worker/index.js", "w").write(worker)
open(f"{root}/worker/wrangler.json", "w").write(json.dumps({"name": "sati-api", "main": "index.js", "compatibility_date": "2024-11-01", "routes": [{"pattern": "api.getati.store/*", "zone_name": "getati.store"}]}, indent=1))
# preview de precos p/ conferencia
prev = {k: pricing[k] for k in list(pricing)[:4]}
print("amostra:", json.dumps(prev))
print("gravado worker/index.js (%d bytes) + wrangler.json" % os.path.getsize(f"{root}/worker/index.js"))
