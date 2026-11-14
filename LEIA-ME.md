# SATI — The Growth Atelier

Loja SMM de luxo (clonada do Promotid com marca própria), single-file, zero dependências de runtime.
Dinheiro entra pela **sua conta Stripe** (o "seu sati" = sua conta de recebimento).

## O que já funciona hoje
- Catálogo completo (Instagram, TikTok, YouTube, Facebook, X, Telegram, Threads) com preços de mercado do Promotid.
- 3 coleções (Éclat $49 / Maison $149 / Signature $299) — são elas que pagam as contas (ticket maior, margem maior).
- Checkout em 2 modos automáticos:
  1. **Stripe Payment Link** — se existir link no `pay.json` para o serviço+quantidade, abre o checkout Stripe direto no card do cliente.
  2. **Concierge (fallback)** — sem link, o pedido cai no **seu WhatsApp** (+353 83 829 1142) com todos os dados; você cria/gera um Payment Link no painel da Stripe e manda pro cliente em 1 clique. Dinheiro na sua conta, sem fricção.
- Códigos de pedido (SATI-XXXXXX) + página de tracking (`#track`).
- Contagem regressiva "founding rate", FAQ, garantias, depoimentos (placeholder — troque por reais quando vierem).

## Como receber (já configurado)
- Conta Stripe grátis criada (seu e-mail / SATI). Chave **restricted** `rk_live_...` salva em `~/.config/drael/stripe.key` (chmod 600).
- Os **202 Payment Links** (184 serviços × quantidades + 18 coleções × plataformas) foram gerados via API em `pay.json` por `tools/gen-links.mjs`. Quem clica em "Pay securely" cai direto no checkout Stripe; o dinheiro cai na sua conta.
- Statement do cartão do cliente: **"SATI Growth"** (ajustável em `PAYMENTS.BRAND.statement`).

### Gerar / atualizar links (quando mudar preço ou item)
```bash
cd ~/apps/sati-store
node tools/gen-links.mjs --dry-run                 # só mostra a tabela de valores
node tools/gen-links.mjs                           # cria o que falta (idempotente)
node tools/gen-links.mjs --only ig_followers_      # só chaves com esse prefixo
node tools/gen-links.mjs --fresh                   # recria tudo do zero
```
O script lê o catálogo do próprio `index.html` (fonte única de verdade) — mude preço aí e rode de novo. Depois `git push`: o CDN entrega o novo `pay.json` ~1 min após o push.

## A parte que ninguém te conta: de onde vêm os seguidores
A loja recebe o dinheiro; **quem entrega é um painel SMM upstream** (reseller).
- Abra conta num painel (ex.: Joys, SMMKart, Advanced) e recarregue ~US$50–100.
- Custo típista: US$1–3/1K de seguidores IG vs. seu preço de venda US$5.99/1K → **margem ~50–70%**.
- v1: você repassa o pedido manualmente no painel (leva 2 min; o cliente já está no seu WhatsApp).
- v2 (quando houver volume): Cloudflare Worker grátis criando Checkout Session dinâmico + API do painel entregando automático. Diga quando quiser que eu monto.

## Editar
- **Preços/cópias**: bloco `CATALOG` e `PACKAGES` no topo do `<script>` em `index.html`.
- **Contato**: `PAYMENTS.conciergeWhatsapp` / `conciergeEmail` (já estão os seus) e o rodapé.
- **Marca**: variáveis CSS em `:root` (paleta obsidiana/ouro); arte em `assets/` gerada por `gen-art.swift` (`swiftc -O gen-art.swift -o /tmp/x && /tmp/x`).

## Deploy (já está no ar assim que eu terminar de pushar)
- Repo público `manansbdb/sati-store` → **https://cdn.jsdelivr.net/gh/manansbdb/sati-store@main/index.html** (atualiza sozinha ~1 min após push).
- GitHub Pages: tentativa automática; se habilitado, vira `https://manansbdb.github.io/sati-store/` (melhor pra SEO).
- Domínio próprio (opcional, ~US$12/ano): aponto depois — `sati.store` ou similar, com redirect pro jsDelivr/Pages.

## Pendentes seus
- [x] Conta Stripe + 202 Payment Links (feito via `tools/gen-links.mjs`, key restricted salva em `~/.config/drael/stripe.key`).
- [ ] No painel Stripe: verificar se há pendência de identidade/endereço p/ liberação de saques (1º pagamento dispara isso); conferir notificações de e-mail ligadas (Dashboard → Notifications) pra saber quando cair pedido.
- [ ] Painel upstream com ~US$50 pra primeira entrega.
- [ ] (Opcional) Depoimentos reais pra substituir os placeholders.
- [ ] (Opcional) Domínio próprio.

## Fluxo de um pedido (v1)
1. Cliente escolhe item/quantidade → "Pay securely" → checkout Stripe (seu `pay.json` tem link p/ cada combinação).
2. Stripe debita o cartão, dinheiro fica em **saldo** na sua conta.
3. Você vê o pedido em **Dashboard → Payments** (e-mail da notificação). O nome/e-mail do cliente e o item estão lá (item = metadata `sati_key` no payment).
4. Repassa o pedido no painel upstream com o @/link do cliente (2 min) → confirma.
5. Saldo: quando quiser, saque pro seu IBAN irlandes (Dashboard → Balances).
