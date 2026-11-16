import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { httpStore } from './http-store.js';
export class SourceThrottleError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    public readonly source: string,
  ) {
    super(
      `${source}: limite temporário de consultas. Retomada automática em ${Math.ceil(retryAfterMs / 1000)} segundo(s).`,
    );
  }
}
export function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return 60000;
  if (/^\d+(\.\d+)?$/.test(value.trim()))
    return Math.max(1000, Number(value) * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(1000, timestamp - now) : 60000;
}
function sourceHost(url: URL) {
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !['pncp.gov.br', 'dadosabertos.compras.gov.br'].includes(url.hostname)
  )
    throw new Error('Fonte oficial não autorizada.');
  return url.hostname;
}
export async function sourceFetch(value: string | URL, init: RequestInit = {}) {
  const url = new URL(value),
    host = sourceHost(url);
  let wait = await httpStore.reserve(
    host,
    host === 'pncp.gov.br' ? 2000 : 1500,
  );
  if (wait > 2500) throw new SourceThrottleError(wait, host);
  while (wait > 0) {
    await delay(wait + 25);
    wait = await httpStore.reserve(host, host === 'pncp.gov.br' ? 2000 : 1500);
    if (wait > 2500) throw new SourceThrottleError(wait, host);
  }
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    signal: init.signal || AbortSignal.timeout(45000),
  });
  if (response.status === 429 || response.status === 503) {
    const wait = retryAfterMs(response.headers.get('retry-after'));
    await response.body?.cancel();
    await httpStore.cooldown(host, wait);
    throw new SourceThrottleError(wait, host);
  }
  return response;
}
export async function cachedJson(
  url: string,
  read: () => Promise<Buffer>,
): Promise<unknown> {
  sourceHost(new URL(url));
  const cached = await httpStore.get(url);
  if (cached !== null) return JSON.parse(cached);
  const token = randomUUID();
  if (!(await httpStore.lock(url, token)))
    throw new SourceThrottleError(2000, new URL(url).hostname);
  try {
    const cached = await httpStore.get(url);
    if (cached !== null) return JSON.parse(cached);
    const bytes = await read();
    const text = bytes.length ? bytes.toString('utf8') : '[]';
    const parsed: unknown = JSON.parse(text);
    if (bytes.length <= 4 * 1024 * 1024) await httpStore.put(url, text);
    return parsed;
  } finally {
    await httpStore.unlock(url, token);
  }
}
export async function sourceJson(url: string) {
  return cachedJson(url, async () => {
    const response = await sourceFetch(url);
    if (response.status === 204) return Buffer.from('[]');
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!response.body) throw new Error('Resposta vazia da fonte.');
    const reader = response.body.getReader();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 8 * 1024 * 1024)
          throw new Error('Resposta JSON excede 8 MB.');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  });
}
