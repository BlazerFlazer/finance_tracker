import net from 'node:net';
import { createRequire } from 'node:module';

// A lazy, catchable require (not a static top-level `import`) — geoip-country reads its MaxMind-format
// .dat file synchronously the moment it's loaded, and some deploy environments' dependency tracing can
// miss that binary asset (seen on Vercel: ENOENT for the .dat file). A static import would crash the
// whole app at module-load time in that case; this way, only geo lookups quietly stop working.
const require = createRequire(import.meta.url);
let geoip: { lookup(ip: string): { country: string } | null } | null | undefined;
function loadGeoip() {
  if (geoip === undefined) {
    try {
      geoip = require('geoip-country');
    } catch {
      geoip = null;
    }
  }
  return geoip;
}

/**
 * Best-effort, privacy-conscious location for the security center ("approximate location").
 * Country only — never city/coordinates — from a local MaxMind-format database (no outbound request,
 * no third-party IP-lookup service sees the user's address).
 */
export function countryForIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, '');
  if (isPrivateOrLoopback(clean)) return null;
  const lib = loadGeoip();
  if (!lib) return null;
  try {
    return lib.lookup(clean)?.country ?? null;
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
