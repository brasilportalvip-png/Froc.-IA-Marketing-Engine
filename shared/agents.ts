/**
 * Froc.IA — Rede de 200 agentes especialistas.
 *
 * São 20 esquadrões com 10 especialistas cada. Para cada pedido do cliente, o
 * orquestrador escolhe os especialistas mais relevantes e injeta as diretrizes
 * deles no cérebro da IA concierge. Assim cada resposta e cada automação é
 * produzida "pelo time certo" — SEO, geo, copy, gatilhos, vídeo, vitrine etc.
 */

export interface FrocSquad {
  id: string;
  name: string;
  color: 'yellow' | 'pink' | 'green' | 'white';
  mission: string;
  keywords: string[];
  roles: string[];
}

export interface FrocAgent {
  id: string;
  name: string;
  squadId: string;
  squadName: string;
  role: string;
  color: FrocSquad['color'];
  directive: string;
}

export const FROC_SQUADS: FrocSquad[] = [
  {
    id: 'seo-tecnico', name: 'SEO Técnico', color: 'green',
    mission: 'garantir que cada página seja rastreável, indexável e rápida para o Google',
    keywords: ['seo', 'google', 'index', 'sitemap', 'rank', 'posicionar', 'busca', 'pesquisa', 'site'],
    roles: ['Arquiteto de Sitemaps', 'Guardião do Robots.txt', 'Especialista em Canonical', 'Auditor de Indexação', 'Engenheiro de Core Web Vitals', 'Especialista em Links Internos', 'Caçador de Erros 404', 'Especialista em Meta Tags', 'Especialista em Open Graph', 'Analista de Rastreamento']
  },
  {
    id: 'seo-local', name: 'SEO Local & Geo', color: 'green',
    mission: 'fazer o negócio aparecer para quem busca na cidade, bairro e rua certos',
    keywords: ['bairro', 'cidade', 'rua', 'perto', 'região', 'local', 'estado', 'país', 'mapa', 'endereço', 'loja física', 'delivery'],
    roles: ['Estrategista de Bairros', 'Especialista em Cidades', 'Mapeador de Ruas e Pontos de Referência', 'Especialista Google Business Profile', 'Especialista em NAP (nome, endereço, telefone)', 'Criador de Páginas Locais', 'Especialista em "perto de mim"', 'Analista de Concorrência Local', 'Especialista em Raio de Atendimento', 'Especialista em Expansão Nacional e Internacional']
  },
  {
    id: 'copy', name: 'Conteúdo & Copywriting', color: 'white',
    mission: 'escrever textos claros, persuasivos e verdadeiros que vendem',
    keywords: ['texto', 'post', 'legenda', 'copy', 'artigo', 'conteúdo', 'escrever', 'anúncio', 'anuncio'],
    roles: ['Redator Chefe', 'Criador de Headlines', 'Especialista em Ganchos (hooks)', 'Redator de Legendas', 'Redator de Artigos Longos', 'Especialista em Storytelling', 'Revisor de Clareza', 'Especialista em Tom de Voz da Marca', 'Redator de E-mail', 'Redator de Descrições de Produto']
  },
  {
    id: 'gatilhos', name: 'Gatilhos & Psicologia de Conversão', color: 'pink',
    mission: 'aplicar gatilhos mentais éticos que tornam a oferta irresistível sem enganar ninguém',
    keywords: ['venda', 'vender', 'cliente', 'converter', 'irresistível', 'gatilho', 'persuas', 'fechar', 'oferta'],
    roles: ['Especialista em Curiosidade', 'Especialista em Autoridade', 'Especialista em Reciprocidade', 'Especialista em Prova Social Real', 'Especialista em Especificidade', 'Especialista em Quebra de Objeções', 'Especialista em Urgência Verdadeira', 'Especialista em Benefício vs. Característica', 'Especialista em Chamadas para Ação', 'Especialista em Pertencimento']
  },
  {
    id: 'organico-google', name: 'Tráfego Orgânico Google', color: 'yellow',
    mission: 'capturar buscas com intenção de compra e transformar em visitas gratuitas',
    keywords: ['orgânico', 'organico', 'tráfego', 'trafego', 'visitas', 'google', 'palavra-chave', 'palavras'],
    roles: ['Pesquisador de Palavras-chave', 'Especialista em Intenção de Busca', 'Especialista em Cauda Longa', 'Especialista em Featured Snippets', 'Especialista em Perguntas Frequentes', 'Estrategista de Clusters de Conteúdo', 'Especialista em Google Discover', 'Especialista em Google Imagens', 'Especialista em Atualização de Conteúdo', 'Analista de SERP']
  },
  {
    id: 'instagram', name: 'Instagram', color: 'pink',
    mission: 'gerar alcance, salvamentos e mensagens no Instagram',
    keywords: ['instagram', 'insta', 'reels', 'stories', 'carrossel', 'feed'],
    roles: ['Estrategista de Reels', 'Criador de Carrosséis', 'Especialista em Stories', 'Especialista em Bio e Destaques', 'Especialista em Hashtags', 'Especialista em Colaborações', 'Especialista em Direct', 'Especialista em Horários', 'Especialista em Estética de Feed', 'Analista de Engajamento']
  },
  {
    id: 'facebook', name: 'Facebook & Meta', color: 'white',
    mission: 'ativar comunidades e alcance orgânico no ecossistema Meta',
    keywords: ['facebook', 'meta', 'grupo', 'página', 'comunidade'],
    roles: ['Estrategista de Página', 'Especialista em Grupos', 'Especialista em Comunidade', 'Especialista em Marketplace', 'Especialista em Eventos', 'Especialista em Vídeo no Facebook', 'Especialista em Messenger', 'Especialista em Avaliações', 'Especialista em Conteúdo Compartilhável', 'Analista Meta']
  },
  {
    id: 'tiktok', name: 'TikTok & Vídeo Curto', color: 'pink',
    mission: 'criar vídeos curtos que prendem nos 3 primeiros segundos',
    keywords: ['tiktok', 'vídeo', 'video', 'viral', 'shorts', 'trend'],
    roles: ['Roteirista de 15 segundos', 'Especialista em Primeiros 3 Segundos', 'Caçador de Tendências', 'Especialista em Áudio', 'Especialista em Legendas na Tela', 'Especialista em Formato UGC', 'Especialista em Séries', 'Especialista em Duetos e Costuras', 'Especialista em Retenção', 'Analista TikTok']
  },
  {
    id: 'youtube', name: 'YouTube & Vídeo Longo', color: 'yellow',
    mission: 'ranquear vídeos no YouTube e no Google Vídeos',
    keywords: ['youtube', 'canal', 'vídeo longo', 'thumbnail', 'roteiro'],
    roles: ['Roteirista de Vídeo', 'Especialista em Títulos de Vídeo', 'Especialista em Thumbnails', 'Especialista em Capítulos', 'Especialista em Descrições SEO', 'Especialista em Shorts', 'Especialista em Playlists', 'Especialista em Retenção de Audiência', 'Especialista em Chamadas no Vídeo', 'Analista YouTube']
  },
  {
    id: 'design', name: 'Design & Imagem', color: 'yellow',
    mission: 'produzir imagens e peças visuais que param a rolagem',
    keywords: ['foto', 'imagem', 'design', 'arte', 'banner', 'logo', 'cor', 'cores', 'visual'],
    roles: ['Diretor de Arte', 'Especialista em Paleta de Cores', 'Especialista em Tipografia', 'Especialista em Composição', 'Especialista em Fotografia de Produto', 'Especialista em Prompts de Imagem', 'Especialista em Formatos (1:1, 9:16, 16:9)', 'Especialista em Contraste e Legibilidade', 'Especialista em Identidade Visual', 'Especialista em Texto Alternativo (alt)']
  },
  {
    id: 'vitrine', name: 'Vitrine & Branding', color: 'yellow',
    mission: 'deixar cada marca brilhando na Vitrine Froc.IA e gerar desejo',
    keywords: ['vitrine', 'marca', 'branding', 'destaque', 'aparecer', 'divulgar', 'site'],
    roles: ['Curador da Vitrine', 'Especialista em Primeira Impressão', 'Especialista em Proposta de Valor', 'Especialista em Diferenciais', 'Especialista em Posicionamento', 'Especialista em Naming e Slogans', 'Especialista em Página de Empresa', 'Especialista em Post Diário', 'Especialista em Consistência de Marca', 'Especialista em Desejo e Exclusividade']
  },
  {
    id: 'leads', name: 'Captura de Leads & Funis', color: 'pink',
    mission: 'transformar visitantes em contatos e contatos em clientes',
    keywords: ['lead', 'captura', 'contato', 'funil', 'cadastro', 'clientes', 'capturar'],
    roles: ['Arquiteto de Funil', 'Especialista em Iscas Digitais', 'Especialista em Landing Pages', 'Especialista em Formulários', 'Especialista em Nutrição', 'Especialista em Remarketing Orgânico', 'Especialista em Ofertas de Entrada', 'Especialista em Jornada do Cliente', 'Especialista em Qualificação', 'Analista de Conversão']
  },
  {
    id: 'whatsapp', name: 'WhatsApp & Atendimento', color: 'green',
    mission: 'levar o cliente para a conversa e fechar no WhatsApp',
    keywords: ['whatsapp', 'zap', 'atendimento', 'mensagem', 'conversa', 'telefone'],
    roles: ['Especialista em Links de WhatsApp', 'Especialista em Mensagens de Boas-vindas', 'Especialista em Scripts de Venda', 'Especialista em Catálogo', 'Especialista em Listas de Transmissão', 'Especialista em Status', 'Especialista em Follow-up', 'Especialista em Respostas Rápidas', 'Especialista em Pós-venda', 'Especialista em Indicações']
  },
  {
    id: 'analytics', name: 'Analytics & Métricas', color: 'white',
    mission: 'medir o que funciona e cortar o que não funciona',
    keywords: ['métrica', 'resultado', 'relatório', 'analytics', 'dados', 'medir', 'desempenho'],
    roles: ['Analista de Dados', 'Especialista em KPIs', 'Especialista em Search Console', 'Especialista em Atribuição', 'Especialista em Testes A/B', 'Especialista em Cohorts', 'Especialista em Painéis', 'Especialista em Previsões', 'Especialista em Relatórios Executivos', 'Especialista em Diagnóstico']
  },
  {
    id: 'estrategia', name: 'Estratégia & Planejamento', color: 'white',
    mission: 'desenhar o plano que liga cada ação a um objetivo de negócio',
    keywords: ['estratégia', 'estrategia', 'plano', 'planejamento', 'calendário', 'semana', 'mês', 'campanha'],
    roles: ['Estrategista Chefe', 'Planejador de Calendário', 'Especialista em Pilares de Conteúdo', 'Especialista em Persona', 'Especialista em Sazonalidade', 'Especialista em Lançamentos', 'Especialista em Posicionamento Competitivo', 'Especialista em Orçamento de Créditos', 'Especialista em Priorização', 'Especialista em Metas']
  },
  {
    id: 'indexacao', name: 'Indexação & Ping', color: 'green',
    mission: 'avisar os buscadores na hora que um conteúdo novo nasce',
    keywords: ['index', 'ping', 'indexnow', 'bing', 'rápido', 'aparecer no google'],
    roles: ['Operador IndexNow', 'Especialista em Feed RSS', 'Especialista em Sitemap de Imagens', 'Especialista em Sitemap TXT', 'Especialista em Search Console', 'Especialista em Bing Webmaster', 'Especialista em Frescor de Conteúdo', 'Especialista em Lastmod', 'Especialista em Orçamento de Rastreamento', 'Monitor de Cobertura']
  },
  {
    id: 'schema', name: 'Schema & Dados Estruturados', color: 'green',
    mission: 'ganhar resultados ricos com dados estruturados válidos',
    keywords: ['schema', 'rich', 'estrelas', 'faq', 'estruturado', 'json-ld'],
    roles: ['Especialista em LocalBusiness', 'Especialista em Organization', 'Especialista em Article', 'Especialista em FAQPage', 'Especialista em BreadcrumbList', 'Especialista em Product', 'Especialista em Service', 'Especialista em AreaServed', 'Especialista em WebSite e SearchAction', 'Validador de Rich Results']
  },
  {
    id: 'ecommerce', name: 'E-commerce & Ofertas', color: 'yellow',
    mission: 'vender produtos online com páginas e ofertas que convertem',
    keywords: ['loja', 'produto', 'e-commerce', 'ecommerce', 'promoção', 'preço', 'desconto', 'comprar'],
    roles: ['Especialista em Páginas de Produto', 'Especialista em Kits e Combos', 'Especialista em Datas Comerciais', 'Especialista em Frete e Entrega', 'Especialista em Garantias', 'Especialista em Upsell', 'Especialista em Carrinho', 'Especialista em Avaliações de Produto', 'Especialista em Catálogo', 'Especialista em Precificação']
  },
  {
    id: 'reputacao', name: 'Reputação & Prova Social', color: 'pink',
    mission: 'construir confiança com provas reais e reputação forte',
    keywords: ['avaliação', 'reputação', 'depoimento', 'confiança', 'review', 'credibilidade'],
    roles: ['Especialista em Avaliações Google', 'Especialista em Depoimentos Reais', 'Especialista em Estudos de Caso', 'Especialista em Selos e Certificações', 'Especialista em Resposta a Críticas', 'Especialista em Imprensa', 'Especialista em Parcerias', 'Especialista em Autoridade do Fundador', 'Especialista em Comunidade de Clientes', 'Monitor de Reputação']
  },
  {
    id: 'segmentacao', name: 'Segmentação & Público', color: 'yellow',
    mission: 'falar com a pessoa certa, no lugar certo, na hora certa',
    keywords: ['público', 'publico', 'segmentar', 'segmentação', 'idade', 'interesse', 'nicho', 'alvo', 'direcionar'],
    roles: ['Especialista em Público-alvo', 'Especialista em Faixa Etária', 'Especialista em Interesses', 'Especialista em Nichos', 'Especialista em Horários de Pico', 'Especialista em Dispositivos', 'Especialista em Idiomas', 'Especialista em Geografia', 'Especialista em Momentos de Compra', 'Especialista em Microssegmentos']
  }
];

export const FROC_AGENTS: FrocAgent[] = FROC_SQUADS.flatMap((squad, squadIndex) =>
  squad.roles.map((role, roleIndex) => {
    const number = squadIndex * 10 + roleIndex + 1;
    return {
      id: `A${String(number).padStart(3, '0')}`,
      name: `Froc ${String(number).padStart(3, '0')}`,
      squadId: squad.id,
      squadName: squad.name,
      role,
      color: squad.color,
      directive: `${role} (${squad.name}): sua missão é ${squad.mission}.`
    };
  })
);

function normalize(value: string): string {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Escolhe os esquadrões mais relevantes para o pedido. Sempre inclui o núcleo
 * (estratégia, copy, gatilhos, orgânico Google e indexação) — os "reis do orgânico".
 */
export function selectAgentsForIntent(text: string, max = 24): FrocAgent[] {
  const haystack = normalize(text);
  const core = new Set(['estrategia', 'copy', 'gatilhos', 'organico-google', 'indexacao']);
  const scored = FROC_SQUADS.map((squad) => ({
    squad,
    score: squad.keywords.reduce((sum, keyword) => sum + (haystack.includes(normalize(keyword)) ? 2 : 0), 0) + (core.has(squad.id) ? 1 : 0)
  })).sort((a, b) => b.score - a.score);
  const chosenSquads = scored.filter((item) => item.score > 0).slice(0, 8).map((item) => item.squad.id);
  const perSquad = Math.max(2, Math.floor(max / Math.max(chosenSquads.length, 1)));
  return chosenSquads.flatMap((id) => FROC_AGENTS.filter((agent) => agent.squadId === id).slice(0, perSquad)).slice(0, max);
}
