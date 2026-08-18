/**
 * Utilitários de Segurança e Anti-Fraude do Froc.IA
 * Gera assinatura digital de hardware, persistência de Device ID e marcador de reivindicação de bônus.
 */

const DEVICE_KEY = 'froc_security_device_id_v2';
const CLAIMED_TOKEN_KEY = 'froc_claimed_bonus_token_v2';

function generateRandomToken(len = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      // Verifica cookies para redundância caso localStorage tenha sido limpo
      const match = document.cookie.match(new RegExp('(^| )' + DEVICE_KEY + '=([^;]+)'));
      if (match) {
        id = match[2];
      }
    }

    if (!id) {
      id = `froc_dev_${generateRandomToken(24)}_${Date.now().toString(36)}`;
      try {
        localStorage.setItem(DEVICE_KEY, id);
        sessionStorage.setItem(DEVICE_KEY, id);
        document.cookie = `${DEVICE_KEY}=${id}; max-age=315360000; path=/; SameSite=Lax`;
      } catch {
        // storage disabled
      }
    }
    return id;
  } catch {
    return 'froc_dev_fallback_anonymous';
  }
}

export function getClaimedBonusToken(): string {
  try {
    let token = localStorage.getItem(CLAIMED_TOKEN_KEY) || '';
    if (!token) {
      const match = document.cookie.match(new RegExp('(^| )' + CLAIMED_TOKEN_KEY + '=([^;]+)'));
      if (match) token = match[2];
    }
    return token;
  } catch {
    return '';
  }
}

export function markBonusClaimedOnThisDevice(userId: string): void {
  try {
    const token = `froc_claimed_${userId.slice(0, 10)}_${Date.now()}`;
    localStorage.setItem(CLAIMED_TOKEN_KEY, token);
    sessionStorage.setItem(CLAIMED_TOKEN_KEY, token);
    document.cookie = `${CLAIMED_TOKEN_KEY}=${token}; max-age=315360000; path=/; SameSite=Lax`;
  } catch {
    // ignore
  }
}

/**
 * Coleta assinatura de hardware e renderização para detecção de multicontas
 */
export async function getClientSecurityFingerprint(): Promise<{
  deviceId: string;
  fingerprintHash: string;
  hardwareConcurrency: number;
  screenResolution: string;
  timezone: string;
  language: string;
  claimedToken: string;
}> {
  const deviceId = getOrCreateDeviceId();
  const claimedToken = getClaimedBonusToken();

  let canvasHash = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = '#06b6d4';
      ctx.fillText('Froc.IA-Security-Fingerprint-2026', 2, 2);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.fillRect(50, 5, 80, 30);
      const dataUrl = canvas.toDataURL();
      let hash = 0;
      for (let i = 0; i < dataUrl.length; i++) {
        hash = (hash << 5) - hash + dataUrl.charCodeAt(i);
        hash |= 0;
      }
      canvasHash = Math.abs(hash).toString(16);
    }
  } catch {
    canvasHash = 'canvas_off';
  }

  const screenResolution = `${window.screen?.width || 0}x${window.screen?.height || 0}x${window.screen?.colorDepth || 0}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const language = navigator.language || '';
  const hardwareConcurrency = navigator.hardwareConcurrency || 4;

  const rawSeed = `${canvasHash}|${screenResolution}|${timezone}|${language}|${hardwareConcurrency}`;
  let fpHash = 0;
  for (let i = 0; i < rawSeed.length; i++) {
    fpHash = (fpHash << 5) - fpHash + rawSeed.charCodeAt(i);
    fpHash |= 0;
  }
  const fingerprintHash = `fp_${canvasHash}_${Math.abs(fpHash).toString(16)}`;

  return {
    deviceId,
    fingerprintHash,
    hardwareConcurrency,
    screenResolution,
    timezone,
    language,
    claimedToken
  };
}
