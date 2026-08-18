# GUIA DE CONFIGURAÇÃO EXTERNA DE PRODUÇÃO (PRODUCTION SETUP)

Este guia orienta a equipe de DevOps e Administradores na configuração das contas e serviços externos necessários para a entrada em produção do **Froc.IA Marketing Engine**.

---

### SEÇÃO A — FIREBASE CONSOLE

#### 1. Criação e Configuração do Projeto
- Acesse o [Firebase Console](https://console.firebase.google.com/) e selecione o projeto de produção.
- **Authentication**:
  - Habilite o provedor de **E-mail / Senha** em *Sign-in method*.
  - Habilite o provedor **Google** (se utilizado no frontend).
  - Em *Authorized domains*, adicione o domínio da aplicação na Vercel (ex: `seu-app.vercel.app`) e seu domínio customizado.
- **Firestore Database**:
  - Crie o banco de dados Firestore no modo de produção na região mais próxima ao seu público (ex: `southamerica-east1` em São Paulo ou `us-central1`).
  - Deploy das regras de segurança: `firebase deploy --only firestore:rules` (utilizando o arquivo `firestore.rules` do repositório).
  - Deploy dos índices compostos: `firebase deploy --only firestore:indexes` (utilizando o arquivo `firestore.indexes.json`).
- **Firebase Storage**:
  - Habilite o Storage para upload de logos e criativos de mídia.
- **Service Account / Admin SDK**:
  - Em *Project Settings > Service accounts*, gere uma nova chave privada (*Generate new private key*).
  - Extraia `project_id`, `client_email` e `private_key` para configurar nas variáveis de ambiente do backend.

---

### SEÇÃO B — VERCEL

#### 1. Configuração do Projeto e Build
- Conecte o repositório GitHub à Vercel.
- **Framework Preset**: Vite / Other.
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm ci`
- O arquivo `vercel.json` na raiz gerencia os rewrites da API Express (`api/index.ts`) e o cron job.

#### 2. Agendamento do Cron Job
- O cron job está configurado em `vercel.json` para rodar a cada 10 minutos (`*/10 * * * *`) chamando `/api/scheduler/tick`.
- **Requisito Externo**: O agendamento de 10 minutos na Vercel requer um plano Pro ou superior. Caso utilize o plano Hobby, configure um serviço externo de cron (ex: GitHub Actions Cron, EasyCron, Cron-Job.org, Cloud Scheduler) disparando `POST https://seu-dominio.com/api/scheduler/tick` com o header `Authorization: Bearer <CRON_SECRET>`.

---

### SEÇÃO C — GOOGLE GEMINI AI

#### 1. Obtenção da Chave de API
- Acesse o [Google AI Studio](https://aistudio.google.com/) e crie uma API Key para o projeto.
- Configure a variável de ambiente `GEMINI_API_KEY` na Vercel.
- Modelos padrão configurados no engine:
  - Texto e Estratégia: `gemini-2.5-flash`
  - Modelos Pro: `gemini-3.1-pro-preview`
  - Fallback Rápido: `gemini-3.1-flash-lite`
  - Geração de Imagem: `gemini-3.1-flash-image`

---

### SEÇÃO D — MERCADO PAGO

#### 1. Credenciais de Produção
- Acesse o painel de desenvolvedores do [Mercado Pago](https://www.mercadopago.com.br/developers).
- Em *Suas integrações > Credenciais de produção*, obtenha:
  - **Access Token** (`MERCADO_PAGO_ACCESS_TOKEN`)
  - **Public Key** (`MERCADO_PAGO_PUBLIC_KEY`)
- Configure o **Webhook** em *Notificações Webhook*:
  - **URL de Produção**: `https://seu-dominio.com/api/payments/webhook`
  - **Eventos Assinados**: Selecionar Pagamentos (`payment`), Assinaturas / Pré-aprovações (`subscription_preapproval`, `subscription_authorized_payment`).
  - **Secret do Webhook**: Copie a chave secreta gerada para a variável `MERCADO_PAGO_WEBHOOK_SECRET`.

---

### SEÇÃO E — PROVEDORES OAUTH / REDES SOCIAIS

Para cada plataforma que desejar habilitar a conexão social no painel:

| Provedor | Variáveis Necessárias | URL de Callback Autorizada | Scopes / Requisitos |
| :--- | :--- | :--- | :--- |
| **Meta (Instagram & Facebook)** | `META_APP_ID`, `META_APP_SECRET` | `https://seu-dominio.com/api/social/meta/callback` | `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `instagram_content_publish` (Requer App Review da Meta para publicação) |
| **LinkedIn** | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | `https://seu-dominio.com/api/social/linkedin/callback` | `openid`, `profile`, `email`, `w_member_social` (Requer aprovação de Developer Portal) |
| **Google & YouTube** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `https://seu-dominio.com/api/social/google/callback` | `https://www.googleapis.com/auth/youtube.upload` |
| **X (Twitter)** | `X_CLIENT_ID`, `X_CLIENT_SECRET` | `https://seu-dominio.com/api/social/x/callback` | `tweet.read`, `tweet.write`, `users.read`, `offline.access` |
| **TikTok** | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | `https://seu-dominio.com/api/social/tiktok/callback` | `user.info.basic`, `video.publish` (Requer aprovação comercial) |
| **Pinterest** | `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET` | `https://seu-dominio.com/api/social/pinterest/callback` | `pins:read`, `pins:write`, `boards:read` |

---

### SEÇÃO F — GITHUB & CI/CD

1. **Branch Protection**:
   - Acesse as configurações do repositório no GitHub (*Settings > Branches*).
   - Adicione regra de proteção para a branch `main`:
     - Marque *Require a pull request before merging*.
     - Marque *Require status checks to pass before merging*.
     - Selecione o status check do workflow do CI: `Typecheck, Test & Build Gate`.
2. **GitHub Secrets**:
   - Caso configure deploy automatizado no futuro via GitHub Actions, adicione os secrets necessários (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`).

---

### SEÇÃO G — SMOKE TESTS FINAIS EM PRODUÇÃO

Após aplicar as configurações e realizar o primeiro deploy:
1. Validar endpoint de integridade: `curl -I https://seu-dominio.com/api/health` (deve retornar HTTP 200).
2. Criar uma conta de teste real e verificar registro no Firebase Auth.
3. Testar a geração de 1 post com IA e confirmar débito correto de créditos.
4. Simular 1 pagamento no Mercado Pago Sandbox e confirmar transição de plano no webhook.
5. Disparar teste do cron com o Bearer token para validar execução do scheduler.
