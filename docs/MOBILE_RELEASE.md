# Froc.IA — Android / PWA / iOS readiness

A base web usa uma única API e Firebase Auth. Para gerar Android, configure no build mobile:

- `VITE_API_BASE_URL=https://SEU-DOMINIO-PRODUCAO`
- `CORS_ORIGINS=https://SEU-DOMINIO-PRODUCAO,capacitor://localhost,https://localhost,http://localhost`

Depois:

```bash
npm install
npm run build
npm run android:add
npm run cap:sync
npm run android:open
```

O Android Studio abrirá o projeto nativo gerado por Capacitor. Não coloque segredos de servidor no APK/AAB. `MERCADO_PAGO_ACCESS_TOKEN`, Firebase Admin, Gemini, OAuth client secrets, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET` e `ADMIN_BOOTSTRAP_KEY` permanecem somente no backend.

## App Links / Universal Links

Não foram criados `assetlinks.json` nem `apple-app-site-association` falsos. Eles só devem ser publicados quando existirem:

- pacote Android definitivo + SHA-256 do certificado de assinatura;
- Team ID / Bundle ID iOS definitivos.

As rotas web já usam URLs reais (`/dashboard`, `/empresa`, `/froc-ia`, `/calendario`, etc.) e estão prontas para mapeamento futuro.
