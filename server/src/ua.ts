/** Small dependency-free User-Agent parser — good enough for "Chrome on Windows" style display, not a security control. */
export interface UaInfo {
  browser: string;
  os: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
}

export function parseUserAgent(ua: string | undefined | null): UaInfo {
  const s = ua ?? '';
  let browser = 'Unknown browser';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/YaBrowser/.test(s)) browser = 'Yandex Browser';
  else if (/CriOS|Chrome\//.test(s)) browser = 'Chrome';
  else if (/FxiOS|Firefox\//.test(s)) browser = 'Firefox';
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = 'Safari';
  else if (/MSIE|Trident/.test(s)) browser = 'Internet Explorer';

  let os = 'Unknown OS';
  if (/Windows NT 10/.test(s)) os = 'Windows 10/11';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Mac OS X/.test(s) && /iPhone|iPad|iPod/.test(s) === false) os = 'macOS';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Linux/.test(s)) os = 'Linux';

  let deviceType: UaInfo['deviceType'] = 'desktop';
  if (/iPad|Tablet(?!.*Mobile)/.test(s)) deviceType = 'tablet';
  else if (/Mobi|iPhone|Android.*Mobile/.test(s)) deviceType = 'mobile';
  else if (!s) deviceType = 'unknown';

  return { browser, os, deviceType };
}

export function deviceLabel(info: UaInfo): string {
  return `${info.browser} · ${info.os}`;
}
