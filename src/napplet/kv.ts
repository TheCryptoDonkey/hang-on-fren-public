// Napplet replacement for ../kv.ts. A sandboxed napplet has no localStorage, so
// saved state lives in the shell's storage NAP, which is async. The game reads
// storage synchronously, so boot.ts awaits loadKv() to copy every key into
// memory before the game starts; writes update memory at once and go through
// to the shell in the background. Without a storage domain the game still
// runs, it just forgets everything on reload.

interface ShellStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const LOAD_TIMEOUT_MS = 4000;
const memory = new Map<string, string>();

function shellStorage(): ShellStorage | null {
  const napplet = (window as { napplet?: { storage?: ShellStorage } }).napplet;
  return napplet?.storage ?? null;
}

function background(write: (storage: ShellStorage) => Promise<void>): void {
  const storage = shellStorage();
  if (!storage) return;
  // The shell enforces a quota and can time out; a failed write must never
  // surface as an unhandled rejection mid-run.
  try { void write(storage).catch(() => undefined); } catch { /* ignore */ }
}

async function readAll(storage: ShellStorage): Promise<void> {
  const keys = await storage.keys();
  const values = await Promise.all(keys.map(key => storage.getItem(key)));
  keys.forEach((key, i) => {
    const value = values[i];
    if (typeof value === 'string') memory.set(key, value);
  });
}

/** Copy the napplet's saved keys into memory. Never rejects; gives up after a
 *  few seconds so a slow or missing shell cannot hold the game at boot. */
export async function loadKv(): Promise<void> {
  const storage = shellStorage();
  if (!storage) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>(resolve => { timer = setTimeout(resolve, LOAD_TIMEOUT_MS); });
  try {
    await Promise.race([readAll(storage), timeout]);
  } catch {
    // Start with whatever loaded.
  } finally {
    clearTimeout(timer);
  }
}

export const kv = {
  getItem: (key: string): string | null => memory.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    memory.set(key, String(value));
    background(storage => storage.setItem(key, String(value)));
  },
  removeItem: (key: string): void => {
    memory.delete(key);
    background(storage => storage.removeItem(key));
  },
};
