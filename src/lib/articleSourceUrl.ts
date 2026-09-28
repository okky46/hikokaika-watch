import { safeHttpUrl } from './tracking.ts';

/** 0008の出典URL規則と共通。通常のASCIIドメイン、IPv4、IPv6を扱う。 */
export function articleSourceUrl(value: string): string | null {
  const normalized = safeHttpUrl(value);
  if (!normalized) return null;
  const host = new URL(normalized).hostname;
  if (host.startsWith('[')) return normalized; // URL()がIPv6を検証済み
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return normalized;
  if (host.length > 254 || host.toLowerCase().split('.').some(label => label.startsWith('xn--'))) return null;
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z]([a-z0-9-]{0,61}[a-z0-9])?\.?$/i.test(host) ? normalized : null;
}
