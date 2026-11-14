#!/usr/bin/env node
/* SATI Telegram Bot — recebe pedidos, gera link Stripe, entrega via SMM panel.
 * Roda em modo long-polling (sem webhook público).
 * Uso: node index.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const CATALOG_FILE = path.join(__dirname, '..', 'index.html');

// ─── Load catalog from index.html (single source of truth) ──────────────────
function loadCatalog() {
  const html = fs.readFileSync(CATALOG_FILE, 'utf8');
  const m = html.match(/const CATALOG = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('CATALOG not found');
  return new Function(`return ${m[1]}`)();
}
const CATALOG = loadCatalog();

// ─── Pricing (same logic as site) ───────────────────────────────────────────
function calcPrice(s, qty) {
  let p = s.per * qty / s.unitSize;
  const from = s.unitSize === 1000 ? Math.round(s.per * 100) / 100 : Math.round(p * 100) / 100;
  p = Math.max(p, from);
  let d = 0;
  if (s.unitSize === 1000 && qty >= 25000) d = .10;
  else if (s.unitSize === 1000 && qty >= 10000) d = .05;
  return { raw: p * (1 - d), base: p, disc: d };
}

// ─── Pay links ──────────────────────────────────────────────────────────────
let payLinks = {};
function loadPayLinks() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pay.json'), 'utf8'));
    payLinks = j.links || {};
  } catch {}
}
loadPayLinks();

// ─── Orders storage ─────────────────────────────────────────────────────────
function loadOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch { return []; }
}
function saveOrders(orders) { fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 1)); }
function addOrder(o) { const all = loadOrders(); all.push(o); saveOrders(all); }
function findOrder(code) { return loadOrders().find(o => o.code === code); }
function updateOrder(code, patch) {
  const all = loadOrders();
  const i = all.findIndex(o => o.code === code);
  if (i > -1) { Object.assign(all[i], patch); saveOrders(all); return all[i]; }
}

// ─── Telegram API helpers ───────────────────────────────────────────────────
const T = CFG.telegramToken;
async function tg(method, body) {
  const url = `https://api.telegram.org/bot${T}/${method}`;
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
}
async function send(chatId, text, extra = {}) {
  await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}
async function sendBtn(chatId, text, keyboard) {
  await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
}

// ─── SMM Panel fulfillment ─────────────────────────────────────────────────
async function fulfill(order) {
  const panel = CFG.smmPanel;
  if (!panel.apiKey) {
    return { status: 'manual', msg: 'SMM panel não configurado — entregar manualmente.' };
  }
  const svcId = panel.serviceMap[order.serviceId];
  if (!svcId) {
    return { status: 'no_mapping', msg: `Sem mapping p/ ${order.serviceId}` };
  }
  const params = new URLSearchParams({
    key: panel.apiKey,
    action: 'add',
    service: svcId,
    link: order.link,
    quantity: String(order.qty)
  });
  const r = await fetch(panel.baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const data = await r.json();
  if (data.order) {
    return { status: 'submitted', panelOrderId: data.order };
  }
  return { status: 'error', msg: JSON.stringify(data) };
}

async function checkFulfillment(panelOrderId) {
  const panel = CFG.smmPanel;
  if (!panel.apiKey || !panelOrderId) return null;
  const params = new URLSearchParams({ key: panel.apiKey, action: 'status', order: String(panelOrderId) });
  const r = await fetch(panel.baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  return r.json();
}

// ─── Stripe verify (optional: check if payment went through) ───────────────
function getStripeKey() {
  try {
    const f = os.homedir() + '/.config/drael/stripe.key';
    return fs.readFileSync(f, 'utf8').trim();
  } catch { return null; }
}
async function stripeBalanceCheck() {
  const key = getStripeKey();
  if (!key) return null;
  const r = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${key}` } });
  return r.json();
}

// ─── User state machine ─────────────────────────────────────────────────────
const users = new Map(); // chatId → state
function setState(chatId, state) { users.set(chatId, state); }
function getState(chatId) { return users.get(chatId) || { step: 'idle' }; }

// ─── Order code generator ──────────────────────────────────────────────────
function genCode() {
  return 'SATI-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

// ─── Catalog grouping ───────────────────────────────────────────────────────
const PLATFORM_NAMES = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', x: 'X', telegram: 'Telegram', threads: 'Threads' };
const PLATFORM_BTNS = [
  [['📸 Instagram', 'plat:instagram'], ['🎵 TikTok', 'plat:tiktok'], ['▶️ YouTube', 'plat:youtube']],
  [['👤 Facebook', 'plat:facebook'], ['✖️ X', 'plat:x'], ['💬 Telegram', 'plat:telegram']],
  [['🧵 Threads', 'plat:threads']]
];

function servicesFor(platform) {
  return CATALOG.filter(s => s.platform === platform);
}
function presetsFor(s) {
  return s.presets;
}

// ─── Bot handlers ──────────────────────────────────────────────────────────
async function handleStart(chatId, username) {
  const btns = [
    [['🛒 Comprar', 'cmd:buy']],
    [['📦 Rastrear pedido', 'cmd:track']],
    [['💬 Concierge', 'cmd:concierge']]
  ];
  await sendBtn(chatId,
    `<b>SATI — The Growth Atelier</b>\n\nCurated followers, likes & views delivered quietly.\n\nO que você quer fazer?`,
    btns);
}

async function handleBuy(chatId) {
  setState(chatId, { step: 'pick_platform' });
  const btns = PLATFORM_BTNS.map(row => row.map(([label, cb]) => [label, cb]));
  await sendBtn(chatId, `Escolha a <b>plataforma</b>:`, btns);
}

async function handlePickPlatform(chatId, platform) {
  const svcs = servicesFor(platform);
  if (!svcs.length) { await send(chatId, 'Sem serviços para esta plataforma.'); return; }
  setState(chatId, { step: 'pick_service', platform });
  const btns = svcs.map(s => [[`${s.name}`, `svc:${s.id}`]]);
  await sendBtn(chatId, `<b>${PLATFORM_NAMES[platform]}</b> — escolha o serviço:`, btns);
}

async function handlePickService(chatId, serviceId) {
  const s = CATALOG.find(x => x.id === serviceId);
  if (!s) return;
  setState(chatId, { step: 'pick_qty', service: s });
  const unitLabel = s.unitLabel || (s.unitSize === 1000 ? 'por 1K' : 'unidades');
  const btns = [];
  const presets = s.presets;
  // Split into rows of 4
  for (let i = 0; i < presets.length; i += 4) {
    btns.push(presets.slice(i, i + 4).map(q => [`${q.toLocaleString()}`, `qty:${q}`]));
  }
  btns.push([['✏️ Outra', 'qty:custom']]);
  await sendBtn(chatId,
    `<b>${s.name}</b> — ${s.blurb}\n\nPreço: <b>$${s.per.toFixed(2)}</b> ${unitLabel}${s.min ? ` · mín ${s.min}` : ''}\n\nQuantidade:`,
    btns);
}

async function handleQty(chatId, qtyStr) {
  const st = getState(chatId);
  const s = st.service;
  let qty;
  if (qtyStr === 'custom') {
    setState(chatId, { ...st, step: 'await_custom_qty' });
    await send(chatId, `Digite a quantidade (mín ${s.min}${s.max ? `, máx ${s.max}` : ''}):`);
    return;
  }
  qty = parseInt(qtyStr);
  if (isNaN(qty) || qty < s.min) { await send(chatId, `Mínimo é ${s.min}. Tente de novo:`); return; }
  if (s.max && qty > s.max) { await send(chatId, `Máximo é ${s.max}.`); return; }
  await proceedToLink(chatId, s, qty);
}

async function proceedToLink(chatId, s, qty) {
  setState(chatId, { step: 'await_link', service: s, qty });
  const unitLabel = s.unitSize === 1000 ? 'por 1,000' : (s.unitLabel || '');
  await send(chatId,
    `Agora me manda o <b>link</b> do perfil ou post:\n\nEx: https://instagram.com/seuusuario` +
    (s.unitSize === 1 ? `\n(para comentários/reações, pode ser o link do post)` : ``) +
    `\n\nUnit price: $${s.per.toFixed(3)} ${unitLabel}\nTotal: <b>$${calcPrice(s, qty).raw.toFixed(2)}</b>`);
}

async function handleLink(chatId, link) {
  const st = getState(chatId);
  if (!/https?:\/\/[^\s]+/i.test(link)) {
    await send(chatId, `Link inválido. Me manda a URL completa (com https://):`);
    return;
  }
  const s = st.service, qty = st.qty;
  const price = calcPrice(s, qty);
  const orderKey = `${s.id}_${qty}`;
  const payUrl = payLinks[orderKey];

  const order = {
    code: genCode(),
    chatId,
    serviceId: s.id,
    serviceName: s.name,
    platform: s.platform,
    qty,
    link: link.trim(),
    total: Math.round(price.raw * 100) / 100,
    discount: price.disc,
    status: 'awaiting_payment',
    ts: Date.now(),
    payUrl: payUrl || null
  };
  addOrder(order);

  setState(chatId, { step: 'awaiting_payment', order });

  const discountLine = price.disc > 0 ? `\nDesconto volume: −${Math.round(price.disc * 100)}%` : '';
  let msg = `✅ <b>Resumo do pedido</b>\n\n`;
  msg += `• ${s.name} × ${qty.toLocaleString()}\n`;
  msg += `• Plataforma: ${PLATFORM_NAMES[s.platform]}\n`;
  msg += `• Link: ${link.trim().slice(0, 60)}\n`;
  if (discountLine) msg += `${discountLine}\n`;
  msg += `\n💰 Total: <b>$${order.total.toFixed(2)}</b>`;
  msg += `\n\n📋 Código: <code>${order.code}</code>`;

  if (payUrl) {
    const btns = [
      [['💳 Pagar agora', `pay:${payUrl}`]],
      [['✅ Já paguei', `confirm:${order.code}`]],
      [['📞 Falar concierge', `concierge:${order.code}`]]
    ];
    await sendBtn(chatId, msg, btns);
  } else {
    const waMsg = encodeURIComponent(`SATI Order ${order.code}\n${s.name} x${qty} (${PLATFORM_NAMES[s.platform]})\n${link.trim()}\n$${order.total.toFixed(2)}`);
    const btns = [
      [['📞 Falar concierge (WhatsApp)', `wa:${waMsg}`]],
      [['✅ Já paguei', `confirm:${order.code}`]]
    ];
    await sendBtn(chatId, msg + `\n\n📲 Pague via concierge no WhatsApp:`, btns);
  }

  // Notify admin
  if (CFG.adminUserId) {
    const adminMsg = `🔔 <b>Novo pedido</b>\n\n<code>${order.code}</code>\n${s.name} × ${qty.toLocaleString()}\n@${PLATFORM_NAMES[s.platform]}: ${link.trim().slice(0, 50)}\n💰 $${order.total.toFixed(2)}\n\nCliente: @${username || chatId}`;
    await send(CFG.adminUserId, adminMsg).catch(() => {});
  }
}

async function handleConfirmPayment(chatId, code) {
  const order = findOrder(code);
  if (!order) { await send(chatId, 'Pedido não encontrado.'); return; }
  if (order.status === 'delivered' || order.status === 'fulfilling') {
    await send(chatId, `Este pedido já está em entrega: <code>${order.status}</code>.`);
    return;
  }

  // Try auto-fulfillment
  const result = await fulfill(order);
  if (result.status === 'submitted') {
    updateOrder(code, { status: 'fulfilling', panelOrderId: result.panelOrderId, fulfilledAt: Date.now() });
    setState(chatId, { step: 'idle' });
    await send(chatId,
      `🚀 <b>Pedido em entrega!</b>\n\n` +
      `Seu pedido <code>${code}</code> foi submetido.\n` +
      `Entrega começa em poucos minutos e será concluída automaticamente.\n\n` +
      `Você vai receber uma notificação quando terminar.`);
    if (CFG.adminUserId) {
      await send(CFG.adminUserId, `✅ ${code} → panel order ${result.panelOrderId} (${order.serviceName} ×${order.qty})`).catch(() => {});
    }
  } else if (result.status === 'manual') {
    updateOrder(code, { status: 'manual_fulfill' });
    setState(chatId, { step: 'idle' });
    await send(chatId,
      `✅ <b>Pagamento confirmado!</b>\n\n` +
      `Pedido <code>${code}</code> registrado. Nossa equipe vai iniciar a entrega em breve.\n\n` +
      `Você vai ser notificado quando concluir.`);
    if (CFG.adminUserId) {
      await send(CFG.adminUserId, `⚠️ ${code} → ENTREGA MANUAL (${order.serviceName} ×${order.qty})\nLink: ${order.link}`).catch(() => {});
    }
  } else {
    // Error — fallback to manual
    updateOrder(code, { status: 'manual_fulfill', error: result.msg });
    setState(chatId, { step: 'idle' });
    await send(chatId, `✅ Pedido <code>${code}</code> registrado. Entrega em andamento.`);
    if (CFG.adminUserId) {
      await send(CFG.adminUserId, `⚠️ ${code} error: ${result.msg} → manual`).catch(() => {});
    }
  }
}

async function handleTrack(chatId, codeInput) {
  const code = (codeInput || '').toUpperCase().trim();
  if (!code.startsWith('SATI-')) {
    setState(chatId, { step: 'await_track_code' });
    await send(chatId, `Me manda o código do pedido (ex: SATI-ABC123):`);
    return;
  }
  const order = findOrder(code);
  if (!order) {
    await send(chatId, `Pedido <code>${code}</code> não encontrado.`);
    return;
  }
  const statusMap = {
    awaiting_payment: '⏳ Aguardando pagamento',
    manual_fulfill: '📋 Registrado — em processamento',
    fulfilling: '🚀 Em entrega',
    delivered: '✅ Concluído',
    failed: '❌ Problema (contato concierge)'
  };
  const statusText = statusMap[order.status] || order.status;
  let msg = `<b>Pedido</b> <code>${order.code}</code>\n\n`;
  msg += `${order.serviceName} × ${order.qty.toLocaleString()} — ${PLATFORM_NAMES[order.platform]}\n`;
  msg += `Status: ${statusText}\n`;
  msg += `Total: $${order.total.toFixed(2)}\n`;
  if (order.fulfilledAt) msg += `Iniciado: ${new Date(order.fulfilledAt).toLocaleString()}\n`;
  await send(chatId, msg);
}

// ─── Main polling loop ─────────────────────────────────────────────────────
let offset = 0;
let running = true;

async function poll() {
  while (running) {
    try {
      const r = await tg('getUpdates', { offset, timeout: 50, allowed_updates: JSON.stringify(['message']) });
      if (!r.ok) { await new Promise(s => setTimeout(s, 3000)); continue; }
      for (const upd of r.result) {
        offset = upd.update_id + 1;
        const msg = upd.message;
        if (!msg) continue;
        const chatId = msg.chat.id;
        const text = (msg.text || '').trim();
        const username = msg.from?.username || '';

        try {
          const st = getState(chatId);

          // Inline button callback
          if (msg.callback_query) {
            const cb = msg.callback_query;
            const data = cb.data;
            await tg('answerCallbackQuery', { callback_query_id: cb.id });

            const [action, value] = data.split(':');

            if (action === 'cmd') {
              if (value === 'buy') await handleBuy(chatId);
              else if (value === 'track') await handleTrack(chatId);
              else if (value === 'concierge') {
                await send(chatId, `Concierge disponível:\n📱 <a href="https://wa.me/${CFG.whatsapp}">${CFG.whatsappDisplay}</a>\n💬 Vamo resolver seu pedido!`);
              }
            } else if (action === 'plat') {
              await handlePickPlatform(chatId, value);
            } else if (action === 'svc') {
              await handlePickService(chatId, value);
            } else if (action === 'qty') {
              await handleQty(chatId, value);
            } else if (action === 'pay') {
              await send(chatId, `Abra o link abaixo para pagar:\n\n${value}\n\nDepois clique em "Já paguei" aqui.`);
            } else if (action === 'confirm') {
              await handleConfirmPayment(chatId, value);
            } else if (action === 'concierge') {
              const code = value;
              const order = findOrder(code);
              const name = order ? `${order.serviceName} x${order.qty}` : '';
              const waMsg = encodeURIComponent(`SATI Order ${code} ${name}`);
              await send(chatId, `Clica aqui pra falar com o concierge:\n\n📱 <a href="https://wa.me/${CFG.whatsapp}?text=${waMsg}">WhatsApp</a>`);
            } else if (action === 'wa') {
              await send(chatId, `Abre o WhatsApp com seu pedido pronto:\n\n📱 <a href="https://wa.me/${CFG.whatsapp}?text=${value}">Click here</a>`);
            }
            continue;
          }

          // Text commands
          if (text === '/start' || text === '/menu' || text === '/help') {
            setState(chatId, { step: 'idle' });
            await handleStart(chatId, username);
          } else if (text === '/buy') {
            await handleBuy(chatId);
          } else if (text === '/track') {
            await handleTrack(chatId);
          } else if (text === '/status') {
            // Admin: show balance + recent orders
            const bal = await stripeBalanceCheck();
            const orders = loadOrders();
            let msg = `📊 <b>SATI Status</b>\n`;
            if (bal?.available) msg += `💰 Stripe balance: $${(bal.available[0].amount / 100).toFixed(2)}\n`;
            const recent = orders.slice(-5).reverse();
            msg += `\nÚltimos pedidos:\n`;
            for (const o of recent) {
              msg += `  ${o.code} | ${o.serviceName}×${o.qty} | ${o.status} | $${o.total}\n`;
            }
            await send(chatId, msg);
          } else if (st.step === 'pick_platform' && !text.startsWith('/')) {
            // Platform selected via text (from inline buttons that came through as text)
            const platLower = text.toLowerCase();
            const match = Object.keys(PLATFORM_NAMES).find(p => platLower.includes(p.toLowerCase()) ||
              ({ ig: 'instagram', tt: 'tiktok', yt: 'youtube', fb: 'facebook', x: 'x', th: 'threads' })[platLower]?.toLowerCase() === platLower);
            if (match) {
              await handlePickPlatform(chatId, match);
            } else {
              await send(chatId, 'Escolha uma plataforma com os botões acima, ou digite o nome.');
            }
          } else if (st.step === 'await_custom_qty') {
            const qty = parseInt(text);
            if (isNaN(qty)) { await send(chatId, 'Digite apenas números:'); return; }
            setState(chatId, { ...st, step: 'pick_qty' });
            await handleQty(chatId, String(qty));
          } else if (st.step === 'await_link') {
            await handleLink(chatId, text);
          } else if (st.step === 'await_track_code') {
            setState(chatId, { step: 'idle' });
            await handleTrack(chatId, text);
          } else if (text.startsWith('/track ') || text.startsWith('/track\n')) {
            await handleTrack(chatId, text.replace(/^\/track\s*/, ''));
          } else if (text.startsWith('SATI-')) {
            await handleTrack(chatId, text);
          } else if (text.toLowerCase().includes('http') || text.toLowerCase().includes('www.')) {
            if (st.step === 'await_link') {
              await handleLink(chatId, text);
            }
          } else if (text === 'balanco' || text === 'balance') {
            const bal = await stripeBalanceCheck();
            if (bal?.available) await send(chatId, `💰 Stripe: $${(bal.available[0].amount / 100).toFixed(2)}`);
            else await send(chatId, 'Não consegui ler o balance.');
          } else {
            if (st.step !== 'idle') {
              await send(chatId, 'Entendi. Se quiser recomeçar: /start');
            }
          }
        } catch (e) {
          console.error(`Handler error [${chatId}]:`, e.message);
          await send(chatId, `⚠️ Erro interno. Tente /start novamente.`).catch(() => {});
        }
      }
    } catch (e) {
      if (e.code === 'ECONNRESET' || e.cause?.code === 'ECONNRESET') {
        await new Promise(s => setTimeout(s, 2000));
      } else {
        console.error('Poll error:', e.message);
        await new Promise(s => setTimeout(s, 5000));
      }
    }
  }
}

console.log('🚀 SATI Bot iniciado (long polling)');
console.log(`   Services: ${CATALOG.length} | Pay links: ${Object.keys(payLinks).length}`);
console.log(`   SMM Panel: ${CFG.smmPanel.name}${CFG.smmPanel.apiKey ? ' ✅' : ' ⚠️ (sem API key)'}`);
poll();

process.on('SIGTERM', () => { running = false; process.exit(0); });
process.on('SIGINT', () => { running = false; process.exit(0); });
