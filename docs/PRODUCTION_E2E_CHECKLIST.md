# FROC.IA MARKETING ENGINE — PRODUCTION E2E CHECKLIST

Este documento detalha o roteiro completo de testes ponta a ponta (E2E) para validação pós-deploy em ambiente de produção (ou staging espelhado).

---

### ROTEIRO DE VERIFICAÇÃO PÓS-DEPLOY (27 ETAPAS)

#### 1. Abertura da Aplicação
- **Ação:** Acessar a URL de produção no navegador (ex: `https://froc-ia.vercel.app`).
- **Resultado Esperado:** Carregamento instantâneo da SPA (Vite + React), sem tela branca, sem erros no console DevTools, UI responsiva com cabeçalho, navegação e botões de autenticação visíveis.

#### 2. Criação de Novo Usuário (Cadastro por E-mail)
- **Ação:** Abrir o modal de autenticação, selecionar "Criar minha conta", preencher nome, e-mail válido, senha com mais de 6 caracteres, marcar os checkboxes de Termos de Uso e Política de Privacidade e submeter.
- **Resultado Esperado:** Criação bem-sucedida do usuário no Firebase Auth e redirecionamento para o dashboard inicial.

#### 3. Confirmação no Firebase Authentication
- **Ação:** Verificar o console do Firebase Auth.
- **Resultado Esperado:** O registro do usuário existe com provider `password`, data de criação correta e UID único.

#### 4. Confirmação do Documento no Firestore (`users`)
- **Ação:** Verificar a coleção `users` no Firestore para o UID criado.
- **Resultado Esperado:** Documento gravado com `role: 'user'`, `termsVersion: '2026.1'`, `privacyVersion: '2026.1'`, `termsAcceptedAt` e `privacyAcceptedAt` preenchidos com timestamp ISO.

#### 5. Aceite de Termos de Consentimento (Usuário Legado ou Atualizado)
- **Ação:** Simular ou logar com usuário com `termsVersion: '2025.1'`.
- **Resultado Esperado:** O `TermsConsentModal` é exibido imediatamente bloqueando a navegação. Ao clicar em "Aceitar e Continuar", é enviado `POST /api/auth/accept-terms` e as versões são atualizadas para `2026.1`, liberando o acesso.

#### 6. Criação de Empresa
- **Ação:** Navegar até o cadastro de empresas e registrar uma nova empresa (nome, categoria, descrição).
- **Resultado Esperado:** Empresa criada com sucesso e associada ao `userId` da sessão autenticada.

#### 7. Confirmação de Limite do Plano FREE (Max 1 Empresa)
- **Ação:** No plano FREE, tentar cadastrar uma segunda empresa.
- **Resultado Esperado:** O backend rejeita a criação com HTTP 403 informando que o plano FREE permite no máximo 1 empresa e sugerindo upgrade.

#### 8. Geração de Conteúdo com IA (Froc AI Engine)
- **Ação:** Selecionar a empresa, preencher o formulário de criação de post e solicitar geração de headline/post completo.
- **Resultado Esperado:** A chamada à API do Gemini processa o prompt e retorna o conteúdo gerado (headline, body, CTA, hashtags, visualPrompt).

#### 9. Validação e Consumo de Créditos
- **Ação:** Verificar a carteira (`wallets`) antes e após a geração de conteúdo.
- **Resultado Esperado:** Saldo debitado exatamente de acordo com a tabela de custos (ex: 5 créditos para `full_post`). Transação registrada na coleção `creditTransactions`.

#### 10. Compra de Plano no Mercado Pago (Sandbox / Produção)
- **Ação:** Navegar para a página de Planos e selecionar assinatura do plano PRO ou BUSINESS.
- **Resultado Esperado:** Redirecionamento correto para o checkout do Mercado Pago (ou inicialização do preapproval).

#### 11. Processamento de Webhook Aprovado
- **Ação:** Recebimento da notificação de pagamento aprovado pelo Mercado Pago no endpoint oficial `POST /api/webhooks/mercadopago`.
- **Resultado Esperado:** Webhook valida a assinatura HMAC SHA-256 (`x-signature` e `x-request-id`), consulta a API do Mercado Pago para confirmação de status, processa a ordem de forma idempotente e retorna HTTP 200.

#### 12. Atualização da Carteira (`wallets`)
- **Ação:** Consultar o documento da carteira do usuário após pagamento aprovado.
- **Resultado Esperado:** `planId` atualizado para o plano adquirido, `planStatus: 'active'`, `currentPeriodEnd` configurado para +30 dias e créditos do plano creditados.

#### 13. Atualização de Entitlements
- **Ação:** Acessar rotas previamente bloqueadas (ex: Conexão Social para plano PRO).
- **Resultado Esperado:** Acesso liberado sem erro de autorização HTTP 403.

#### 14. Execução Manual do Autopilot (Plano PRO ou superior)
- **Ação:** No painel da empresa, acionar "Executar Autopilot Agora" no modo de aprovação manual.
- **Resultado Esperado:** Geração do post com débito estrito de 5 créditos (`autopilot_cycle`), salvamento do rascunho em `contentItems` e notificação emitida.

#### 15. Execução Automática do Autopilot (Plano BUSINESS ou AGENCY)
- **Ação:** Configurar Autopilot no modo `automatic` e disparar o ciclo.
- **Resultado Esperado:** Conteúdo gerado, salvo e automaticamente agendado na coleção `scheduledPosts` com data futura para publicação.

#### 16. Agendamento de Publicações (`scheduledPosts`)
- **Ação:** Criar um agendamento manual de post para data e horário futuros.
- **Resultado Esperado:** Documento salvo na coleção `scheduledPosts` com status `scheduled`, validando ownership do usuário e da empresa.

#### 17. Execução do Cron / Scheduler Process
- **Ação:** Disparar requisição `GET /api/cron/process` com cabeçalho `Authorization: Bearer <CRON_SECRET>`.
- **Resultado Esperado:** Resposta JSON com status de processamento de reservas expiradas, posts agendados devidos e ciclos de Autopilot devidos, sem concorrência duplicada (lock ativo).

#### 18. Conexão com Rede Social (OAuth Flow)
- **Ação:** Clicar em "Conectar" para uma rede suportada (ex: Meta / LinkedIn) no plano PRO+.
- **Resultado Esperado:** Geração do `state` criptografado e seguro, redirecionamento para o fluxo OAuth do provedor e retorno ao callback da aplicação.

#### 19. Publicação nas Redes Conectadas
- **Ação:** Processar publicação agendada com rede social ativa.
- **Resultado Esperado:** O post é publicado na API da rede social e o status em `scheduledPosts` é alterado para `published` (ou `failed` com mensagem clara caso a rede rejeite).

#### 20. Cancelamento de Assinatura (Fail-Closed)
- **Ação:** Usuário solicita cancelamento da assinatura no painel.
- **Resultado Esperado:** Comunicação síncrona com o Mercado Pago via `PUT /preapproval/:id` com `status: 'cancelled'`. Se a API do MP falhar, a operação falha e o estado local não é alterado. Se o MP confirmar, o pedido é atualizado para `cancel_at_period_end`.

#### 21. Período de Graça (Grace Period)
- **Ação:** Acessar recursos pagos após solicitar cancelamento, enquanto `now < currentPeriodEnd`.
- **Resultado Esperado:** Entitlements do plano continuam ativos até a data final do ciclo faturado.

#### 22. Downgrade Automático por Expiração
- **Ação:** Acessar a aplicação após o vencimento do `currentPeriodEnd` de uma assinatura cancelada.
- **Resultado Esperado:** O método `getEffectiveWallet` recalcula os pedidos, detecta a expiração, persiste `planId: 'plan_free'` e `planStatus: 'free'`, restringindo os limites para o plano gratuito.

#### 23. Tratamento de Reembolso / Chargeback (Refund)
- **Ação:** Recebimento de webhook de estorno (`refunded` / `charged_back`).
- **Resultado Esperado:** Reversão financeira idempotente dos créditos, recalculando o plano efetivo sem derrubar outros planos ativos válidos.

#### 24. Isolamento Multi-Tenant e Autorização Cruzada
- **Ação:** Usuário B tenta ler, editar ou deletar empresa, post ou agendamento criado pelo Usuário A através de manipulação de parâmetros de requisição.
- **Resultado Esperado:** O backend rejeita a operação com HTTP 403/404, protegendo a segregação de dados entre clientes.

#### 25. Logout e Novo Login
- **Ação:** Efetuar logout da conta e realizar login novamente.
- **Resultado Esperado:** Sessão encerrada no cliente, cookies/tokens limpos e restabelecimento seguro da sessão no login subsequente.

#### 26. PWA e Assets Estáticos
- **Ação:** Inspecionar `manifest.webmanifest`, service workers e carregamento offline/cached.
- **Resultado Esperado:** Ícones, splash e manifesto servidos corretamente com status HTTP 200 e headers de cache apropriados.

#### 27. Endpoint de Health Check
- **Ação:** Acessar `GET /api/health`.
- **Resultado Esperado:** Retorno JSON `{ status: 'ok', timestamp: '...' }` com HTTP 200.
