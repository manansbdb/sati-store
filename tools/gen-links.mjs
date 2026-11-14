#!/usr/bin/env node
/* gen-links.mjs — Gera Stripe Payment Links para a loja SATI.
 * Fonte única de verdade: CATALOG/PACKAGES/PLATFORMS lidos do index.html.
 * Saída: pay.json no root do repo (formato esperado por loadPayLinks()).
 *
 * Uso (a partir da raiz do repo):
 *   node tools/gen-links.mjs --dry-run          # tabela de links, sem chamar API
 *   node tools/gen-links.mjs                    # gera tudo (key de ~/.config/drael/stripe.key)
 *   node tools/gen-links.mjs --key sk_live_...  # key por flag
 *   node tools/gen-links.mjs --only ig_followers_1000   # só chaves com esse prefixo
 *
 * Idempotente: reutiliza plink existentes via tools/.links-manifest.json (--fresh força novo).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

function extractArray(name) {
  const m = html.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n\\]);`));
  if (!m) { console.error(`✗ não achei const ${name} em index.html`); process.exit(1); }
  return new Function(`return ${m[1]}`)();
}
const CATALOG = extractArray('CATALOG');
const PACKAGES = extractArray('PACKAGES');
const PLATFORMS = extractArray('PLATFORMS');

// espelha computePrice()/pFrom() de index.html — se mudar lá, muda aqui
function amountCents(s, qty) {
  let p = s.per * qty / s.unitSize;
  const from = s.unitSize === 1000 ? Math.round(s.per * 100) / 100 : Math.round(p * 100) / 100;
  p = Math.max(p, from);
  let d = 0;
  if (s.unitSize === 1000 && qty >= 25000) d = .10;
  else if (s.unitSize === 1000 && qty >= 10000) d = .05;
  return Math.round(p * (1 - d) * 100);
}

const jobs = [];
for (const s of CATALOG)
  for (const q of s.presets)
    jobs.push({ key: `${s.id}_${q}`, label: `${s.name} ×${q} (${PLATFORMS.find(p => p.id === s.platform)?.name ?? s.platform})`, cents: amountCents(s, q) });
for (const pk of PACKAGES)
  for (const pl of PLATFORMS)
    jobs.push({ key: `pkg_${pk.id}_${pl.id}`, label: `Collection ${pk.name} — ${pl.name}`, cents: pk.price * 100 });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fresh = args.includes('--fresh');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx > -1 ? args[onlyIdx + 1] : null;
const keyFlagIdx = args.indexOf('--key');
const KEY_FILE = path.join(os.homedir(), '.config/drael/stripe.key');
let key = keyFlagIdx > -1 ? args[keyFlagIdx + 1] : null;
if (!key) key = process.env.STRIPE_SECRET_KEY;
if (!key && fs.existsSync(KEY_FILE)) key = fs.readFileSync(KEY_FILE, 'utf8').trim();

const todo = only ? jobs.filter(j => j.key.startsWith(only)) : jobs;

if (!dryRun && !key) {
  console.error('✗ sem chave Stripe. Use --key sk_live_... ou salve em ~/.config/drael/stripe.key');
  process.exit(1);
}

console.log(`${todo.length} link(s) ${dryRun ? '(dry-run)' : 'a gerar'}\n`);
console.log('key'.padEnd(34), 'label'.padEnd(44), 'valor');
for (const j of todo) console.log(j.key.padEnd(34), j.label.padEnd(44), `$${(j.cents / 100).toFixed(2)}`);

if (dryRun) { console.log(`\n✓ dry-run ok — total ${todo.length} links`); process.exit(0); }

const MANIFEST = path.join(REPO, 'tools', '.links-manifest.json');
let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch {}

async function createLink(j) {
  const body = new URLSearchParams();
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'usd');
  body.set('line_items[0][price_data][unit_amount]', String(j.cents));
  body.set('line_items[0][price_data][product_data][name]', j.label.slice(0, 100));
  body.set('metadata[sati_key]', j.key);
  body.set('metadata[sati_label]', j.label.slice(0, 80));
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch('https://api.stripe.com/v1/payment_links', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return { id: data.id, url: data.url };
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await new Promise(s => setTimeout(s, 1200 * attempt)); continue; }
    throw new Error(`stripe ${r.status} em ${j.key}: ${data.error?.message || JSON.stringify(data).slice(0, 200)}`);
  }
}

let created = 0, reused = 0, failed = 0;
const CONC = 8; let i = 0;
async function worker() {
  while (i < todo.length) {
    const j = todo[i++];
    try {
      if (manifest[j.key]?.url && !fresh) { console.log(`↺ reuse  ${j.key}`); reused++; }
      else {
        const { id, url } = await createLink(j);
        manifest[j.key] = { id, url, cents: j.cents, at: new Date().toISOString() };
        console.log(`✓ novo  ${j.key}`); created++;
      }
    } catch (e) { console.error(`✗ falhou ${j.key}: ${e.message}`); failed++; }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));

// monta pay.json preservando a nota existente
let pay = { note: '', links: {} };
try { pay = JSON.parse(fs.readFileSync(path.join(REPO, 'pay.json'), 'utf8')); } catch {}
for (const j of todo) if (manifest[j.key]?.url) pay.links[j.key] = manifest[j.key].url;
fs.writeFileSync(path.join(REPO, 'pay.json'), JSON.stringify(pay, null, 1) + '\n');
console.log(`\nFeito: ${created} novos, ${reused} reutilizados, ${failed} falhas. pay.json gravado com ${Object.keys(pay.links).length} links.`);
if (failed) process.exit(2);
