import { sourceFetch, cachedJson } from '../sources/http.js';
const MAX_BYTES = 25 * 1024 * 1024;
export function validatePncpUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'pncp.gov.br' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password
  )
    throw new Error('Endereço de documento fora da fonte oficial PNCP.');
  return url;
}
export async function downloadOfficial(
  value: string,
  maxBytes = MAX_BYTES,
): Promise<Buffer> {
  let url = validatePncpUrl(value);
  for (let hop = 0; hop < 5; hop++) {
    const response = await sourceFetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(60000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Redirecionamento do PNCP sem destino.');
      url = validatePncpUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`PNCP: HTTP ${response.status}`);
    }
    if (Number(response.headers.get('content-length') || 0) > maxBytes) {
      await response.body?.cancel();
      throw new Error('Arquivo excede o limite de tamanho.');
    }
    if (response.status === 204) return Buffer.alloc(0);
    if (!response.body) throw new Error('Resposta vazia do PNCP.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBytes)
          throw new Error('Arquivo excede o limite de tamanho.');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Excesso de redirecionamentos na fonte.');
}
export async function officialJson(url: string): Promise<unknown> {
  return cachedJson(url, () => downloadOfficial(url, 8 * 1024 * 1024));
}
export function procurementBase(sourceId: string) {
  const parts = /^(\d{14})-1-(\d+)\/(\d{4})$/.exec(sourceId);
  if (!parts) throw new Error('Identificador PNCP inválido.');
  return `https://pncp.gov.br/api/pncp/v1/orgaos/${parts[1]}/compras/${parts[3]}/${Number(parts[2])}`;
}
