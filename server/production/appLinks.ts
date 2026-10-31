/** Links de aplicativo da marca (Google Play / App Store), validados para exibição pública. */
export interface AppLinks { android: string | null; ios: string | null }

function storeUrl(value: any, hosts: string[]): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'https:') return null;
    return hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function appLinksOf(company: any): AppLinks {
  return {
    android: storeUrl(company?.androidApp, ['play.google.com']),
    ios: storeUrl(company?.iosApp, ['apps.apple.com', 'itunes.apple.com'])
  };
}

export function hasApp(company: any): boolean {
  const links = appLinksOf(company);
  return Boolean(links.android || links.ios);
}
