// Bitcoin chain-state snapshot for score flavour: every saved score records
// the block height and BTC price at the moment the run ended. Best-effort —
// if mempool.space is unreachable the score simply saves without them.

const TIP_HEIGHT_URL = 'https://mempool.space/api/blocks/tip/height';
const PRICES_URL = 'https://mempool.space/api/v1/prices';
const FETCH_TIMEOUT_MS = 4000;

export interface BtcSnapshot {
  /** Chain tip height when the run ended. */
  block?: number;
  /** BTC price in US cents (amounts live in the smallest unit). */
  usdCents?: number;
}

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** Fetch tip height + USD price in parallel; each side is independently best-effort. */
export async function fetchBtcSnapshot(): Promise<BtcSnapshot> {
  const [block, usdCents] = await Promise.all([
    fetchWithTimeout(TIP_HEIGHT_URL)
      .then(res => (res.ok ? res.text() : null))
      .then(text => {
        const n = Number(text);
        return Number.isInteger(n) && n > 0 ? n : undefined;
      })
      .catch(() => undefined),
    fetchWithTimeout(PRICES_URL)
      .then(res => (res.ok ? (res.json() as Promise<{ USD?: unknown }>) : null))
      .then(data => {
        const usd = data?.USD;
        return typeof usd === 'number' && usd > 0 ? Math.round(usd * 100) : undefined;
      })
      .catch(() => undefined),
  ]);
  return { block, usdCents };
}
