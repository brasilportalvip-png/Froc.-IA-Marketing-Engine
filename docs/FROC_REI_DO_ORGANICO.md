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

### Voz (microfone) — mesmo sistema da Froc IA
- Botão de microfone na tela da IA: liga a **conversa por voz** (ouvir → pensar → falar → voltar a ouvir, sem novo clique).
- **Escuta:** Gemini Live (`gemini-3.5-transcribe-live`) com token efêmero emitido pelo servidor (`POST /api/ai/speech/live-token`); se falhar, usa o reconhecimento do navegador.
- **Fala:** voz neural Gemini (padrão `Charon`, masculina, natural e calorosa) em streaming PCM 24 kHz (`POST /api/ai/speech/stream`), com fallback WAV (`POST /api/ai/speech`) e, por último, voz do navegador.
- Comandos: "Ok, Froc" (chamar) e "pare" (desligar). Botão "Ouvir" em cada resposta.
- Visitantes sem login usam os motores do navegador (sem custo); a voz neural é para usuários logados.
- Segurança: microfone liberado só para o próprio site (`Permissions-Policy: microphone=(self)`), CSP permite apenas `wss://generativelanguage.googleapis.com`; a chave Gemini nunca vai para o navegador.

### Janela 3 — Posts (`/posts`)
- Todas as postagens num só lugar: artigos do Froc Magazine + posts diários da Vitrine, com filtros, busca e "carregar mais".
- Pré-renderizada para o Google (Schema `CollectionPage`), no sitemap e no robots.txt.

### 1 post por dia do site
- O Froc Magazine publica **1 artigo por dia automaticamente** (30 pautas de SEO e tráfego orgânico em rodízio), avisando os buscadores via IndexNow.
- Ligado por padrão. Se na Vercel existir `AUTO_BLOG_ENABLED=false`, troque para `true` (ou apague a variável).

### Painel admin completo
Abas: Visão geral (usuários, assinantes, receita, projetos, posts, créditos, IA, chamados) · **Usuários** (adicionar/remover créditos, ativar/revogar plano, papel, bloquear, excluir perfil com confirmação por e-mail) · **Projetos** (criar para qualquer usuário, editar, trocar dono, pôr/tirar da vitrine, excluir) · Posts da Vitrine (arquivar, republicar, excluir) · Froc Magazine · Pagamentos · Atividade (ações de admin, execuções de IA, extrato) · Motor SEO · Suporte. Toda ação fica registrada no log de auditoria.

### Imagens dos posts (ligadas ao nicho)
- Cada post diário da Vitrine e cada artigo do Froc Magazine ganha uma **imagem criada pela IA** a partir do projeto (nicho, produtos, serviços, descrição, cidade/bairro) e da publicação (título, palavra-chave, ângulo do dia). Sem texto, logos ou marcas d'água na arte.
- Não consome créditos do cliente (serviço da plataforma). Posts antigos sem imagem são completados automaticamente, 2 por ciclo do cron, ou na hora pelo botão **Admin → Posts da Vitrine → Criar imagens que faltam**.
- A imagem entra na página, no `og:image`, no Schema `BlogPosting` e no sitemap de imagens.

### Site + aplicativo com direcionamento
- Quem tem app (opcional) cadastra o link da Google Play e/ou da App Store em Minha Marca, pela conversa com a IA ou no admin.
- Os posts passam a convidar para o site **e** para o app, com o bloco "Baixe o app" e botões de loja.
- Links inteligentes `/ir/{marca}/{site|app|android|ios|whatsapp}`: o botão de app leva o Android para a Google Play e o iPhone para a App Store. Cada clique é contado por marca e por post (Meu Painel e Admin → Projetos).
- Páginas públicas ganham Schema `MobileApplication` quando a marca tem app.

### Admin sem limite de projetos
- O administrador cria quantos projetos quiser (pela IA, em Minha Marca ou em Admin → Projetos, onde o dono padrão é o próprio admin).

### Diagnóstico da voz
- Admin → Visão geral → **Testar voz agora**: testa de verdade a chave Gemini, a escuta ao vivo e a voz neural e mostra o erro exato do provedor.

## Mapa do site (o que está ativo)

| Área | Endereço | Para quê |
|---|---|---|
| Froc.IA (texto + voz) | `/` | Conversar e pedir tudo: anúncios, imagens, roteiros, artigos, estratégia, vitrine |
| Vitrine | `/vitrine` | Marcas em destaque, página de cada marca e posts diários |
| Posts | `/posts` | Todas as postagens (Magazine + Vitrine) |
| Planos | `/planos` | Assinatura e créditos |
| Meu Painel | `/dashboard` | Créditos, plano, marca, posts diários e últimas criações |
| Minha Marca | `/empresa` | Dados, logo, contatos e vitrine da marca |
| Minhas Criações | `/conteudos` | Tudo que a IA criou, para copiar ou baixar |
| Créditos · Perfil · Suporte | `/creditos` · `/perfil` · `/suporte` | Conta |
| Admin | `/admin` | Painel completo do dono do site |

Tarefas automáticas (cron `/api/cron/process`): post diário de cada marca da Vitrine, 1 artigo por dia no Froc Magazine, pings IndexNow, publicação de posts que já estavam agendados e limpeza de reservas de créditos.

### Removido nesta versão (substituído pela Froc.IA na conversa)
Telas antigas de ferramentas separadas: Froc IA (antiga), Autopilot, Criar Conteúdo, Criar Imagem, Criar Vídeo, Criar Artigo, SEO Inteligente, Campanhas, Calendário, Redes Sociais e Analytics, e as rotas de API que só elas usavam, além do auditor de SEO de URL. Os endereços antigos redirecionam (301) para a IA ou para o painel. O Autopilot antigo fica desligado no agendador (`LEGACY_AUTOPILOT_ENABLED=false`) para não gastar créditos sem uma tela para controlá-lo. O código de conexão com redes sociais (OAuth Meta/TikTok/YouTube/Pinterest) foi mantido no servidor, sem tela, para uma integração futura.

## Depois do merge (5 minutos)
1. Na Vercel → Settings → Environment Variables, crie `INDEXNOW_KEY` (ex.: um UUID) e faça redeploy.
2. No Google Search Console → Sitemaps, envie `sitemap_index.xml`.
3. No Bing Webmaster Tools, importe do Search Console (opcional: `BING_SITE_VERIFICATION`).
4. Confirme que o cron externo chama `/api/cron/process` (já documentado em `PRODUCTION_SETUP.md`).

## Limites honestos
- Nenhuma ferramenta pode garantir 1º lugar no Google; o motor aplica todas as boas práticas técnicas e de conteúdo para maximizar as chances.
- A segmentação por bairro/rua é **orgânica** (SEO local, conteúdo e Schema `areaServed`) e alimenta as campanhas; não é entrega de mídia paga em redes de terceiros.
- Posts diários são gerados por IA com regras anti-invenção (sem números, depoimentos ou promoções falsas).
