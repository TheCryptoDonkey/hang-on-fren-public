import type { RunSummary } from './scoring.js';
import type { SubmitScoreOptions } from './nostr.js';

const KEY = 'hangonfren:pending-personal-scores:v1';
const MAX_BYTES = 128_000;
export interface PendingPersonalScore {
  pubkey: string;
  summary: RunSummary;
  options: SubmitScoreOptions;
  arcade: boolean;
}

function parseReceipt(value: unknown): PendingPersonalScore | null {
  if (!value || typeof value !== 'object') return null;
  const receipt = value as PendingPersonalScore;
  if (typeof receipt.pubkey !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.pubkey)
    || typeof receipt.arcade !== 'boolean' || !receipt.summary || !receipt.options) return null;
  const fields = ['score', 'distanceM', 'fuel', 'roses', 'overtakes', 'nearMisses', 'crashes',
    'bestRoseStreak', 'topSpeedKph', 'drifts', 'bestDriftS', 'durationS'] as const;
  const summary = {} as RunSummary;
  for (const field of fields) {
    const number = receipt.summary[field];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) return null;
    summary[field] = number;
  }
  if (summary.score <= 0 || !['time', 'crashes', 'finish'].includes(receipt.summary.endedBy)) return null;
  summary.endedBy = receipt.summary.endedBy;
  const input = receipt.options;
  if (typeof input.runId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.runId)
    || !Number.isSafeInteger(input.level) || input.level < 1
    || !Number.isFinite(input.startedAt) || !Number.isFinite(input.finishedAt)
    || input.startedAt < 0 || input.finishedAt < input.startedAt
    || !['time', 'finish'].includes(input.endedBy)) return null;
  const options: SubmitScoreOptions = { runId: input.runId, level: input.level,
    startedAt: input.startedAt, finishedAt: input.finishedAt, endedBy: input.endedBy };
  if (input.playerName !== undefined) {
    if (typeof input.playerName !== 'string' || input.playerName.length > 64) return null;
    options.playerName = input.playerName;
  }
  if (input.tour !== undefined) {
    if (!['grand', 'world', 'stone'].includes(input.tour)) return null;
    options.tour = input.tour;
  }
  for (const field of ['btcBlock', 'btcUsdCents'] as const) {
    if (input[field] !== undefined) {
      if (!Number.isSafeInteger(input[field]) || input[field]! < 0) return null;
      options[field] = input[field];
    }
  }
  return { pubkey: receipt.pubkey, summary, options, arcade: receipt.arcade };
}

export function pendingPersonalScores(): PendingPersonalScore[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > MAX_BYTES) return [];
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items) || items.length > 64) return [];
    return items.map(parseReceipt).filter((item): item is PendingPersonalScore => item !== null);
  } catch { return []; }
}

export function retainPersonalScore(receipt: PendingPersonalScore): boolean {
  const safe = parseReceipt(receipt);
  if (!safe) return false;
  const items = pendingPersonalScores();
  const index = items.findIndex(item => item.pubkey === safe.pubkey && item.options.runId === safe.options.runId);
  if (index >= 0) items[index] = safe;
  else items.push(safe);
  const serialized = JSON.stringify(items);
  if (serialized.length > MAX_BYTES || items.length > 64) return false;
  try { localStorage.setItem(KEY, serialized); return true; } catch { return false; }
}

export function clearPublishedPersonalScore(pubkey: string, runId: string, expected: { summary: RunSummary; options: SubmitScoreOptions }): void {
  const confirmed = parseReceipt({ pubkey, summary: expected.summary, options: expected.options, arcade: false });
  if (!confirmed) return;
  const items = pendingPersonalScores().filter(item => item.pubkey !== pubkey || item.options.runId !== runId
    || JSON.stringify(item.summary) !== JSON.stringify(confirmed.summary)
    || JSON.stringify(item.options) !== JSON.stringify(confirmed.options));
  try {
    if (items.length) localStorage.setItem(KEY, JSON.stringify(items));
    else localStorage.removeItem(KEY);
  } catch { /* Leave receipts available if storage cannot be updated. */ }
}
