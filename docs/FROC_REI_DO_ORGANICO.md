# Froc.IA — Atualização "Rei do Orgânico"

## O que mudou

### Tela 1 — IA conversacional (`/`)
- A tela inicial agora é uma conversa estilo ChatGPT com a Froc.IA.
- A IA entende o pedido, coleta os dados (negócio, oferta, objetivo, público, formato foto/vídeo/texto, canais e **segmentação geográfica: país, estado, cidade, bairros, ruas e raio em km**), mostra um resumo e só executa depois da confirmação.
- As ferramentas antigas continuam existindo, mas ficam **escondidas do menu**: quem executa é a IA (`POST /api/concierge/execute`).
- Conversar é grátis (com limite anti-abuso por IP). Créditos só são usados nas criações confirmadas (post, imagem, roteiro, artigo, estratégia).

### Rede de 200 agentes (`shared/agents.ts`)
- 20 esquadrões × 10 especialistas (SEO técnico, SEO local, copy, gatilhos éticos, Google orgânico, Instagram, TikTok, YouTube, design, vitrine, leads, WhatsApp, analytics, estratégia, indexação, Schema, e-commerce, reputação, segmentação…).
- A cada mensagem, o orquestrador escolhe os especialistas relevantes e injeta as diretrizes deles no prompt. A tela mostra quais agentes trabalharam na resposta.
- Lista pública: `GET /api/agents`.

### Tela 2 — Vitrine premium (`/vitrine`)
- Hero com aurora, holofotes, grade de luz, texto em gradiente animado, letreiro infinito de marcas, cards com efeito 3D e brilho que segue o mouse, borda girando nas marcas em destaque, feed "posts estratégicos do dia" e CTA final.
- Respeita `prefers-reduced-motion`.

### Post diário por projeto da vitrine (`server/production/vitrineDaily.ts`)
- Todo dia (fuso de São Paulo), cada marca pública ganha 1 post otimizado para tráfego orgânico: título SEO, meta description, gancho, conteúdo H2/H3, gatilhos éticos, FAQ (vira Schema FAQPage) e CTA para os canais reais.
- 14 ângulos editoriais rotativos (guia local, perguntas frequentes, como escolher, quebra de objeções…).
- Idempotente (`${companyId}_${data}`), em lotes (`VITRINE_DAILY_POSTS_PER_TICK`) dentro do cron já existente `/api/cron/process`.
- URL pública: `/vitrine/{marca}/{post}` com conteúdo pré-renderizado para o Google.

### Motor SEO (`server/production/seoEngine.ts`)
| Arquivo | Conteúdo |
|---|---|
| `/sitemap_index.xml` (e `/sitemap.xml`) | Índice no padrão Yoast |
| `/page-sitemap.xml` | Páginas institucionais |
| `/post-sitemap.xml`, `post-sitemap2.xml`… | Artigos do Froc Magazine |
| `/vitrine-sitemap.xml` | Marcas da vitrine (com `image:image`) |
| `/vitrine-post-sitemap.xml` | Posts diários |
| `/sitemap.txt` | Lista simples de URLs |
| `/feed.xml` | RSS 2.0 |
| `/main-sitemap.xsl` | Visual legível para humanos |
| `/indexnow-key.txt` | Verificação IndexNow |

Regras: só URLs indexáveis (públicas e publicadas), 1.000 URLs por arquivo, `lastmod` em W3C, XML escapado, imagens no namespace do Google.

**Pings:** a cada publicação (post diário, entrada na vitrine, artigo publicado) a Froc.IA avisa o **IndexNow** (Bing, Yandex, Seznam, Naver, Yep). O Google desativou o "ping de sitemap" em 2023; ele descobre os sitemaps pelo `robots.txt` e pelo Search Console.

**Páginas públicas:** canonical, hreflang, robots `max-image-preview:large`, Open Graph com datas de artigo, JSON-LD (`WebSite`, `BreadcrumbList`, `BlogPosting`, `FAQPage`, `LocalBusiness` com `areaServed` por bairro/cidade, `ItemList` na vitrine) e conteúdo pré-renderizado visível sem JavaScript.

### Painéis
- **Usuário:** bloco "O que vamos criar hoje?" + lista dos posts diários da marca na vitrine.
- **Admin:** nova aba "Motor SEO & Vitrine" com contagem por sitemap, links, histórico de pings, botão "Ping IndexNow (tudo)" e "Gerar posts do dia".

### Identidade visual
Preto `#050505`, branco, amarelo `#FFD400`, pink `#FF2D87` e verde `#00E676`. As cores antigas são remapeadas no `@theme` do Tailwind, então todas as telas herdam a nova paleta.

## Depois do merge (5 minutos)
1. Na Vercel → Settings → Environment Variables, crie `INDEXNOW_KEY` (ex.: um UUID) e faça redeploy.
2. No Google Search Console → Sitemaps, envie `sitemap_index.xml`.
3. No Bing Webmaster Tools, importe do Search Console (opcional: `BING_SITE_VERIFICATION`).
4. Confirme que o cron externo chama `/api/cron/process` (já documentado em `PRODUCTION_SETUP.md`).

## Limites honestos
- Nenhuma ferramenta pode garantir 1º lugar no Google; o motor aplica todas as boas práticas técnicas e de conteúdo para maximizar as chances.
- A segmentação por bairro/rua é **orgânica** (SEO local, conteúdo e Schema `areaServed`) e alimenta as campanhas; não é entrega de mídia paga em redes de terceiros.
- Posts diários são gerados por IA com regras anti-invenção (sem números, depoimentos ou promoções falsas).
