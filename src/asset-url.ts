const baseUrl = ((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/').replace(/\/?$/, '/');

export function assetUrl(path: string): string {
  return `${baseUrl}${path.replace(/^\/+/, '')}`;
}
