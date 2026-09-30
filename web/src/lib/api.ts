import type { ApiErrorBody, ErrorCode } from '@shared/errors';

/** Thrown for every non-2xx API response; carries the machine-readable code so the UI can translate it. */
export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  issues?: ApiErrorBody['error']['issues'];
  params?: Record<string, unknown>;

  constructor(body: ApiErrorBody['error'], status: number) {
    super(body.message);
    this.name = 'ApiError';
    this.code = body.code;
    this.status = status;
    this.issues = body.issues;
    this.params = body.params;
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** send as multipart/form-data instead of JSON */
  form?: FormData;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.pathname + url.search;
}

/** Thin fetch wrapper: same-origin cookies, JSON in/out, CSRF header on mutations, typed ApiError on failure. */
export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    const csrf = readCookie('ft_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { method, headers, body, credentials: 'include', signal: opts.signal });
  } catch {
    throw new ApiError({ code: 'NETWORK', message: 'Network error' }, 0);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    if (contentType.includes('application/json')) {
      const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
      if (data?.error) throw new ApiError(data.error, res.status);
    }
    throw new ApiError({ code: 'INTERNAL', message: res.statusText || 'Request failed' }, res.status);
  }
  if (res.status === 204) return undefined as T;
  if (contentType.includes('application/json')) return res.json() as Promise<T>;
  return res as unknown as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) => apiFetch<T>(path, { method: 'GET', query, signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) => apiFetch<T>(path, { method: 'POST', body, signal }),
  put: <T>(path: string, body?: unknown, signal?: AbortSignal) => apiFetch<T>(path, { method: 'PUT', body, signal }),
  patch: <T>(path: string, body?: unknown, signal?: AbortSignal) => apiFetch<T>(path, { method: 'PATCH', body, signal }),
  delete: <T>(path: string, signal?: AbortSignal) => apiFetch<T>(path, { method: 'DELETE', signal }),
  upload: <T>(path: string, form: FormData, signal?: AbortSignal) => apiFetch<T>(path, { method: 'POST', form, signal }),
};

/** Downloads a binary/file response (CSV/XLSX/PDF exports) and triggers a browser save. */
export async function downloadFile(path: string, query?: RequestOptions['query'], filenameFallback = 'download'): Promise<void> {
  const url = buildUrl(path, query);
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(data?.error ?? { code: 'INTERNAL', message: 'Download failed' }, res.status);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ?? filenameFallback;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
