let companyId: string | null = null;
export function setApiCompany(value: string | null) {
  companyId = value;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-NTHub-Request', '1');
  if (companyId && !path.startsWith('/auth/'))
    headers.set('X-Company-Id', companyId);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const res = await fetch('/api/v1' + path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Falha na operação.');
  return data as T;
}
