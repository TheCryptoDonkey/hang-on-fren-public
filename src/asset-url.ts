const baseUrl = ((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/').replace(/\/?$/, '/');

export function assetUrl(path: string): string {
  return `${baseUrl}${path.replace(/^\/+/, '')}`;
}

/** Bytes of an asset URL from assetUrl(); the napplet build reads them from
 *  the inlined bundle instead of the network. */
export function loadAssetBytes(url: string): Promise<ArrayBuffer> {
  return fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`asset ${r.status}`))));
}

/** A media element for an asset URL from assetUrl(); the napplet build fills
 *  the source in once the shell has fetched the bytes. */
export function createAudio(url: string): HTMLAudioElement {
  return new Audio(url);
}
