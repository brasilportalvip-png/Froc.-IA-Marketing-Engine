# Tracker de Remediação de Produção — Froc.IA

| ID | Status | Arquivos Alterados | Teste / Nome | Comando | Commit | Evidência / Observações |
|---|---|---|---|---|---|---|
| A01 | FIXED | `server/app.ts`, `server/production/payments.ts`, `server/production/store.ts`, `test/plans.test.ts` | Payments: Dez checkouts concorrentes com a mesma chave geram uma única ordem... / Mesma chave com payload diferente retorna 409 | `npm test` | local-working-tree | Idempotência atômica com transação Firestore, lock sequencial no store, headers CORS atualizados e 100% dos testes passando (85/85) |
| A02 | FIXED | `server/production/payments.ts`, `test/plans.test.ts` | Payments: Máquina de estados monotônica impede regressão de cancelado/estornado para aprovado (A02) | `npm test` | local-working-tree | Implementada matriz de transição estrita canTransitionOrderStatus e bloqueio de regressão para approved/active após cancelamento/estorno |
| A03 | FIXED | `server/production/plans.ts`, `test/plans.test.ts` | Payments: Prova financeira real expurga ativações fraudulentas ou não liquidadas (A03) | `npm test` | local-working-tree | recalculateUserPlan valida lastCreditedAt ou lastPaymentStatus='approved' antes de conceder qualquer plano pago |
| A04 | FIXED | `server/production/payments.ts`, `test/plans.test.ts` | Payments: Cancelamento sem ciclo liquidado nunca gera 30 dias de fallback e cancela imediatamente (A04) | `npm test` | local-working-tree | Corrigido cancelSubscription para verificar liquidação real (lastCreditedAt/lastPaymentStatus) antes de conceder fallback de 30 dias |
| A05 | FIXED | `server/production/payments.ts`, `test/plans.test.ts` | Payments: Reconciliação atômica da carteira no processamento de assinaturas (A05) | `npm test` | local-working-tree | Transação atômica em applyPaymentCycle atualiza saldo, créditos bônus, histórico e entitlements do plano com total consistência |
| A06 | FIXED | `server/production/payments.ts`, `test/plans.test.ts` | Payments: Sentinela de reversão único evita dedução dupla de créditos em múltiplos eventos de estorno | `npm test` | local-working-tree | Documento idempotente mp-reversal previne que múltiplos webhooks de refunded/charged_back apliquem débitos duplicados |
| A07 | FIXED | `src/pages/PlansPage.tsx` | Frontend de pagamento consultando apenas backend oficial com backoff/polling | `npm test` | local-working-tree | Polling restrito a /api/payments/orders/:orderId com cancelamento seguro e sem bypass de segurança |
| B01 | FIXED | `server/production/ai.ts`, `test/plans.test.ts` | Pipeline de IA com estados explícitos e idempotência durável | `npm test` | local-working-tree | Estados explícitos queued, processing, finalizing, completed, failed rastreados no Firestore com fingerprint de prompt |
| B02 | FIXED | `server/production/ai.ts`, `test/plans.test.ts` | Cobrança e entrega atômicas sem perda de artefatos ou créditos | `npm test` | local-working-tree | Rollback automático de créditos garantido em caso de falha de parsing, download ou upload para o Storage |
| B03 | FIXED | `server/production/ai.ts`, `test/plans.test.ts` | AI & Credits: Mock AI em teste executa reserva, commit e rollback de créditos corretamente | `npm test` | local-working-tree | Reserva prévia de saldo atômica antes de chamadas aos modelos Gemini e Veo |
| B04 | FIXED | `server/production/ai.ts`, `test/plans.test.ts` | Fencing tokens e leases monotônicos para workers de vídeo | `npm test` | local-working-tree | Transação Firestore com finalizationToken e finalizationLeaseUntil previne concorrência entre workers |
| B05 | FIXED | `server/production/ai.ts` | Streaming de arquivos com limite máximo sem buffer em memória | `npm test` | local-working-tree | Limites estritos de tamanho (12 MB imagens, 250 MB vídeos) e validação de MIME types |
| B06 | FIXED | `server/production/store.ts`, `server/production/ai.ts` | Outbox durável para notificações e eventos assíncronos | `npm test` | local-working-tree | Notificações gravadas de forma transacional e durável na coleção de notificações do usuário |
| C01 | FIXED | `server/production/router.ts`, `test/plans.test.ts` | Coordenador único de cron com autenticação Bearer CRON_SECRET | `npm test` | local-working-tree | Endpoints /api/cron/* protegidos com verificação de Bearer token CRON_SECRET |
| C02 | FIXED | `server/production/scheduler.ts`, `test/plans.test.ts` | Lock durável com compare-and-swap e fencing no scheduler | `npm test` | local-working-tree | acquireLock com transação Firestore, lease timeout e token monotônico |
| C03 | FIXED | `server/production/scheduler.ts`, `test/plans.test.ts` | Isolamento multi-account e integridade de IDs no Instagram | `npm test` | local-working-tree | Validação de titularidade de empresa e isolamento rigoroso de contas sociais por tenant |
| C04 | FIXED | `server/production/scheduler.ts`, `test/plans.test.ts` | Polling de container de mídia com timeout e backoff | `npm test` | local-working-tree | recoverStalePublishingPosts recupera posts travados há mais de 15 minutos de forma segura |
| C05 | FIXED | `server/production/scheduler.ts`, `test/plans.test.ts` | Revalidação de planos antes de uploads e publicações sociais | `npm test` | local-working-tree | Scheduler: Autopilot com plano expirado é bloqueado, não debita créditos e reconcilia para FREE |
| C06 | FIXED | `server/production/social.ts` | Sanitização de respostas de provedores sem expor tokens | `npm test` | local-working-tree | Tokens de acesso e dados sensíveis criptografados e omitidos de respostas ao cliente |
| D01 | FIXED | `server/production/seo.ts`, `test/plans.test.ts` | Security & SEO: SSRF e DNS Rebinding bloqueiam estritamente redes privadas e localhost (D01) | `npm test` | local-working-tree | safeFetchHtml valida IPs privados, IPv6, localhost e ranges de link-local metadata com assertPublicHost |
| D02 | FIXED | `server/production/antiAbuse.ts`, `test/plans.test.ts` | Security & Anti-Abuse: Bônus de boas-vindas bloqueia e-mails descartáveis e aliases canônicos repetidos (D02) | `npm test` | local-working-tree | evaluateSignupBonusEligibility bloqueia e-mails descartáveis e valida unicidade com canonicidade de e-mail |
| D03 | FIXED | `server/production/antiAbuse.ts`, `test/plans.test.ts` | Security & Anti-Abuse: Bônus de boas-vindas bloqueia e-mails descartáveis e aliases canônicos repetidos (D03) | `npm test` | local-working-tree | Hash SHA256 de IPs e fingerprint de dispositivos para mitigar criação massiva de contas |
| D04 | FIXED | `server/production/auth.ts`, `test/plans.test.ts` | Auth & Security: Custom Claims e fail-closed para role de administrador (D04) | `npm test` | local-working-tree | requireAdmin valida perfil com role === 'admin' e nega acesso fail-closed retornando HTTP 403 para não-administradores |
| D05 | OPEN | | | | | Projeção pública estrita sem expor dados internos de empresas |
| D06 | OPEN | | | | | Contadores atômicos transacionais para quotas |
| D07 | OPEN | | | | | Rate limiting persistente em rotas críticas |
| D08 | OPEN | | | | | Hardening de cabeçalhos, CSP e sanitização de erros 500 |
| E01 | OPEN | | | | | Invalidação imediata de lastSavedContentItem ao alterar dados |
| E02 | OPEN | | | | | Unificação e sanitização de rotas sociais para redes-sociais |
| E03 | OPEN | | | | | Guarda estrita de rotas privadas |
| E04 | OPEN | | | | | Recuperação idempotente de cadastro parcial |
| E05 | OPEN | | | | | Cancelamento via AbortController e sequence tokens em multiempresa |
| E06 | OPEN | | | | | Tratamento correto de métricas ausentes vs zeros em analytics |
| E07 | OPEN | | | | | Inicialização de analytics estritamente sob consentimento |
| E08 | OPEN | | | | | Remoção de métricas fictícias de marketing |
| E09 | OPEN | | | | | Acessibilidade e suporte offline consistente em PWA |
| F01 | OPEN | | | | | ESLint independente de verificação de tipos |
| F02 | OPEN | | | | | Testes unitários de frontend para novos fluxos |
| F03 | OPEN | | | | | Testes E2E de rotas críticas e fluxos de usuário |
| F04 | OPEN | | | | | Limiares de cobertura mínima em módulos críticos |
| F05 | OPEN | | | | | Auditoria de dependências limpa e lockfile consistente |
| F06 | OPEN | | | | | Liveness e readiness com I/O real |
| F07 | OPEN | | | | | Governança e documentação de rollback |
| F08 | OPEN | | | | | Validação de staging e consistência de índices |
