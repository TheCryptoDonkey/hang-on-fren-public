// Napplet replacement for ../asset-url.ts. A napplet ships as a single HTML
// file in an opaque-origin sandbox, so there is nowhere to fetch art or audio
// from: the build inlines the assets and this module turns each one into a
// blob: URL on first use. Blob URLs belong to the napplet's own origin, so
// Web Audio can route <audio> elements without tainting the graph.
import assets from 'virtual:hof-napplet-assets';

const blobs = new Map<string, Blob>(); // blob: URL -> Blob
const urls = new Map<string, string>(); // asset path -> blob: URL
const missing = new Set<string>();

function decode(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** A blob: URL for an inlined asset, or '' when the build left it out (music
 *  can be excluded to keep the napplet small; callers treat '' as "none"). */
export function assetUrl(path: string): string {
  const key = path.replace(/^\/+/, '');
  const known = urls.get(key);
  if (known) return known;
  const entry = assets[key];
  if (!entry) {
    if (!missing.has(key)) {
      missing.add(key);
      console.warn(`[napplet] asset not bundled: ${key}`);
    }
    return '';
  }
  const blob = decode(entry.base64, entry.mime);
  delete assets[key]; // keep the Blob, drop the base64 copy
  const url = URL.createObjectURL(blob);
  blobs.set(url, blob);
  urls.set(key, url);
  return url;
}

export function loadAssetBytes(url: string): Promise<ArrayBuffer> {
  const blob = blobs.get(url);
  return blob ? blob.arrayBuffer() : Promise.reject(new Error('asset not bundled'));
}
