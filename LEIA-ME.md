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

## Pra começar a receber (30 min, $0)
1. Crie conta Stripe grátis: https://dashboard.stripe.com/signup (dados: nome SATI ou seu CNPJ/empresa; país conforme sua conta bancária).
2. Em **Payment links**, crie links. Ordem sugerida (maior volume primeiro):
   - `ig_followers_1000` … `ig_followers_25000`
   - `pkg_maison_instagram`, `pkg_maison_tiktok` (e demais plataformas)
   - `ig_likes_1000`, `tt_followers_1000`, `yt_subs_100` …
3. Cole os URLs em `pay.json` (chave = `serviceId_quantidade`, ver o exemplo comentado dentro do arquivo) e faça `git push`. Pronto — quem clicar em "Pay securely" vai direto pro checkout Stripe.
   - Alternativa: me mande a chave `sk_live_...` que eu gero todos os links via API numa tarde.
4. Statement do cartão do cliente aparecerá como **"SATI Growth"** (ajustável em PAYMENTS.BRAND.statement).

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
- [ ] Conta Stripe + links (ou me passa a `sk_live_`).
- [ ] Painel upstream com ~US$50 pra primeira entrega.
- [ ] (Opcional) Depoimentos reais pra substituir os placeholders.
- [ ] (Opcional) Domínio próprio.
