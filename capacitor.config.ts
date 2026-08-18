import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.froc.ia',
  appName: 'Froc.IA',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false }
};
export default config;
