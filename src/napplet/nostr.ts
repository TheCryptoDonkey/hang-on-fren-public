// Napplet replacement for ../nostr.ts. The web build claims scores through the
// gamestr claim service over HTTP and reads the board straight from relays;
// a napplet has neither direct network access nor window.nostr, so this
// edition plays as a local-only guest: scores stay on the local board and
// sign-in reports that it is unavailable. Same exports as the web module so
// main.ts is unchanged.
import type { GlobalScore, Identity, PublishOutcome, SubmitScoreOptions } from '../nostr.js';
import type { PendingPersonalScore } from '../score-recovery.js';
import type { RunSummary } from '../scoring.js';
import { kv } from './kv.js';

export type { GlobalScore, Identity, PublishOutcome, SubmitScoreOptions };

const NAME_KEY = 'hangonfren:napplet-guest-name:v1';
const MAX_NAME_LEN = 12;

export class ScoreSigningError extends Error {
  constructor(readonly saved = true) {
    super('Personal scores are not available in the napplet edition.');
    this.name = 'ScoreSigningError';
  }
}

export function cleanGuestName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
  return clean || 'FREN';
}

export function renameGuest(name: string): void {
  try { kv.setItem(NAME_KEY, cleanGuestName(name)); } catch { /* ignore */ }
}

export function getIdentity(): Identity {
  let name = 'FREN';
  try { name = kv.getItem(NAME_KEY) ?? name; } catch { /* ignore */ }
  return { mode: 'guest', pubkey: null, name };
}

export async function restoreIdentity(): Promise<Identity> {
  return getIdentity();
}

export async function connectNostr(): Promise<string | null> {
  return null;
}

export function useGuestMode(): void {}

export function personalScoreIsPending(_pubkey: string, _runId: string): boolean {
  return false;
}

export async function submitScore(_summary: RunSummary, _opts: SubmitScoreOptions, _identity?: Identity): Promise<PublishOutcome | null> {
  return null;
}

export async function retryPersonalScore(_receipt: PendingPersonalScore): Promise<PublishOutcome | null> {
  throw new ScoreSigningError();
}

export function discardSavedPersonalScore(_receipt: PendingPersonalScore, _confirmRemoval: () => boolean): boolean {
  return false;
}

export async function fetchGlobalBoard(_limit = 5, _force = false): Promise<GlobalScore[]> {
  return [];
}
