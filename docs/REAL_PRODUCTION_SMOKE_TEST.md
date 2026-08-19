# ROTEIRO DE SMOKE TEST REAL PÓS-DEPLOY EM PRODUÇÃO

Este documento contém o checklist prático para ser executado imediatamente após a conclusão do deploy em ambiente de produção com credenciais reais configuradas.

---

### 1. INFRAESTRUTURA & HEALTH CHECK
- [ ] **HTTP 200 no Health Check:** Realizar `GET https://seu-dominio.com/api/health`.
  - Resposta esperada: `{"status":"ok", "timestamp":"...", ...}`
- [ ] **Segurança de Headers:** Verificar presença de headers `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Content-Security-Policy` e `Strict-Transport-Security`.
- [ ] **CORS Seguro:** Testar requisições com `Origin` não autorizado para confirmar bloqueio.

---

### 2. FIREBASE AUTHENTICATION & FIRESTORE REAL
- [ ] **Cadastro de Novo Usuário:** Criar conta com e-mail e senha no formulário da SPA.
- [ ] **Verificação no Firebase Console:** Confirmar usuário registrado no Firebase Auth.
- [ ] **Coleção `users`:** Confirmar gravação do documento com `role: 'user'`, `termsVersion: '2026.1'`, `privacyVersion: '2026.1'`.
- [ ] **Coleção `wallets`:** Confirmar carteira criada com `planId: 'plan_free'`, saldo inicial de bônus (`25` créditos) e `planStatus: 'free'`.
- [ ] **Modal de Termos e Consentimento:** Simular usuário com versão antiga e verificar obrigatoriedade do modal de consentimento.

---

### 3. GOOGLE GEMINI AI REAL
- [ ] **Geração de Conteúdo:** Preencher formulário de geração de post ou artigo e disparar geração.
- [ ] **Cascade de Modelos:** Confirmar resposta gerada com sucesso via `gemini-2.5-flash` ou fallback configurado sem erros 403/404.
- [ ] **Débito Atômico:** Confirmar que a reserva de créditos foi debitada e confirmada na coleção `creditTransactions`.

---

### 4. MERCADO PAGO — PAGAMENTOS & WEBHOOKS
- [ ] **Criação de Preferência / Checkout:** Clicar para assinar plano PRO ou BUSINESS e verificar redirecionamento para o gateway de pagamento.
- [ ] **Processamento de Webhook:** Simular ou realizar pagamento de teste no sandbox/produção.
- [ ] **Endpoint `POST /api/webhooks/mercadopago`:** Confirmar validação de assinatura HMAC SHA-256 e resposta HTTP 200.
- [ ] **Atualização de Plano:** Verificar atualização do documento em `wallets` para `planId: 'plan_pro'`, `planStatus: 'active'`, `currentPeriodEnd` (+30 dias) e limite de empresas expandido.

---

### 5. OAUTH & CONEXÃO DE REDES SOCIAIS
- [ ] **Início de Fluxo OAuth:** Clicar em "Conectar" para X, Meta (Facebook/Instagram), LinkedIn, YouTube, TikTok ou Pinterest.
- [ ] **Redirecionamento com PKCE/State:** Verificar URL autorizada no provedor e state armazenado em `oauthStates`.
- [ ] **Callback Seguro:** Completar autorização e verificar redirecionamento para o painel com token criptografado (`encryptedAccessToken`) em `socialConnections`.
- [ ] **Desconexão:** Testar remoção de conta social conectada.

---

### 6. AGENDAMENTO & SCHEDULER / CRON
- [ ] **Agendamento de Post:** Criar agendamento de post para data futura em `scheduledPosts`.
- [ ] **Execução do Cron:** Disparar `GET https://seu-dominio.com/api/cron/process` com header `Authorization: Bearer <CRON_SECRET>`.
- [ ] **Verificação de Lock e Processamento:** Confirmar execução sem concorrência e retorno de `success: true` com contadores de itens processados.

---

### 7. PUBLICAÇÃO SOCIAL REAL (X / FACEBOOK / LINKEDIN)
- [ ] **Publicação no X:** Publicar post textual de até 280 caracteres e confirmar aparição no feed do X.
- [ ] **Publicação em Página Facebook:** Publicar post textual e verificar publicação na Página autorizada.
- [ ] **Publicação no LinkedIn:** Publicar post textual e verificar publicação no feed pessoal do LinkedIn.
- [ ] **Comportamento Honesto em Instagram/YouTube/TikTok/Pinterest:** Confirmar mensagem informativa clara sobre necessidade de mídia/vídeo ou permissões específicas.

---

### 8. PWA & OFFLINE
- [ ] **Service Worker Registrado:** Abrir DevTools > Application > Service Workers e verificar status ativo.
- [ ] **Manifest PWA:** Verificar carregamento de `/manifest.json`, ícones e display standalone.
- [ ] **Banner Offline:** Desconectar a rede no navegador e confirmar exibição do `OfflineBanner`.

---

### 9. RESPONSIVIDADE & MOBILE
- [ ] **Drawer e BottomNav:** Testar visualização em viewport móvel (< 768px).
- [ ] **Touch Targets:** Verificar botões e controles com área de toque mínima de 44px.
