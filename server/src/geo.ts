import net from 'node:net';
import geoip from 'geoip-country';

/**
 * Best-effort, privacy-conscious location for the security center ("approximate location").
 * Country only — never city/coordinates — from a local MaxMind-format database (no outbound request,
 * no third-party IP-lookup service sees the user's address).
 */
export function countryForIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, '');
  if (isPrivateOrLoopback(clean)) return null;
  try {
    return geoip.lookup(clean)?.country ?? null;
  } catch {
    return null;
  }
}

export function isPrivateOrLoopback(ip: string): boolean {
  if (!net.isIP(ip)) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || a === 127;
  }
  const lower = ip.toLowerCase();
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

/** First public-looking address in an X-Forwarded-For chain, falling back to the socket address. */
export function clientIp(headerXff: string | string[] | undefined, socketIp: string | undefined): string | undefined {
  if (headerXff) {
    const list = (Array.isArray(headerXff) ? headerXff.join(',') : headerXff).split(',').map((s) => s.trim()).filter(Boolean);
    const pub = list.find((ip) => !isPrivateOrLoopback(ip.replace(/^::ffff:/, '')));
    if (pub) return pub;
    if (list[0]) return list[0];
  }
  return socketIp;
}
