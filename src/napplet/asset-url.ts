// Napplet replacement for ../asset-url.ts. A napplet ships as one small HTML
// file in an opaque-origin sandbox with no network of its own, so the build
// publishes the assets as content-addressed external files and the shell
// fetches them from Blossom (NAP-RESOURCE):
//
// - art, pickups and sound effects travel in one pack that boot.ts loads before
//   the game starts, so assetUrl() can stay synchronous;
// - music beds are separate files fetched when a track is first created.
//
// Blob URLs belong to the napplet's own origin, so Web Audio can route the
// <audio> elements without tainting the graph.
import manifest from 'virtual:hof-napplet-assets';

interface ShellResource {
  bytes(url: string): Promise<Blob>;
}

const PACK_MAGIC = 'HOFP';
const EXTERNAL_PREFIX = 'napplet-asset:';

const blobs = new Map<string, Blob>(); // blob: URL -> Blob
const urls = new Map<string, string>(); // asset path -> blob: URL
const missing = new Set<string>();

function shellResource(): ShellResource | null {
  const napplet = (window as { napplet?: { resource?: ShellResource } }).napplet;
  return typeof napplet?.resource?.bytes === 'function' ? napplet.resource : null;
}

function fetchByHash(sha256: string): Promise<Blob> {
  const resource = shellResource();
  if (!resource) return Promise.reject(new Error('resource domain unavailable'));
  return resource.bytes(`blossom:sha256:${sha256}`);
}

function addAsset(path: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  blobs.set(url, blob);
  urls.set(path, url);
}

/** Fetch and unpack the art/sfx pack. Never rejects: without it the game runs
 *  on its code-drawn sprite fallbacks and stays quiet. */
export async function loadPack(): Promise<void> {
  if (!manifest.pack) return;
  try {
    const bytes = new Uint8Array(await (await fetchByHash(manifest.pack.sha256)).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (new TextDecoder().decode(bytes.subarray(0, 4)) !== PACK_MAGIC) throw new Error('not an asset pack');
    const indexLength = view.getUint32(4, true);
    const index = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + indexLength))) as
      Array<{ path: string; mime: string; offset: number; length: number }>;
    const base = 8 + indexLength;
    for (const entry of index) {
      addAsset(entry.path, new Blob([bytes.subarray(base + entry.offset, base + entry.offset + entry.length)], { type: entry.mime }));
    }
  } catch (error) {
    console.warn('[napplet] asset pack unavailable:', error);
  }
}

/** A blob: URL for a packed asset, a placeholder for an external music bed
 *  (createAudio resolves it), or '' when the asset is not available. */
export function assetUrl(path: string): string {
  const key = path.replace(/^\/+/, '');
  const known = urls.get(key);
  if (known) return known;
  if (manifest.external[key]) return EXTERNAL_PREFIX + key;
  if (!missing.has(key)) {
    missing.add(key);
    console.warn(`[napplet] asset not available: ${key}`);
  }
  return '';
}

export function loadAssetBytes(url: string): Promise<ArrayBuffer> {
  const blob = blobs.get(url);
  return blob ? blob.arrayBuffer() : Promise.reject(new Error('asset not available'));
}

export function createAudio(url: string): HTMLAudioElement {
  if (!url.startsWith(EXTERNAL_PREFIX)) return new Audio(url);
  const el = new Audio();
  const entry = manifest.external[url.slice(EXTERNAL_PREFIX.length)];
  // play() can arrive before the bytes do; remember it and start once loaded.
  let wantsPlay = false;
  const play = el.play.bind(el);
  const pause = el.pause.bind(el);
  el.play = () => {
    if (el.src) return play();
    wantsPlay = true;
    return Promise.resolve();
  };
  el.pause = () => {
    wantsPlay = false;
    pause();
  };
  fetchByHash(entry.sha256)
    .then(blob => {
      el.src = URL.createObjectURL(new Blob([blob], { type: entry.mime }));
      if (wantsPlay) void play().catch(() => undefined);
    })
    .catch(error => console.warn('[napplet] music unavailable:', error));
  return el;
}
