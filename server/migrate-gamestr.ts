// One-off migration to the gamestr spec's per-level addressable score events.
//
// Before commit cf636cd the claim service published kind-30762 events with a
// per-run `d` tag (`hangonfren:<player>:<runId>`), so every run lingered on
// the relays as its own addressable event. This tool replays the append-only
// claim log, republishes each player's BEST score per level under the
// spec-format `d` (`hangonfren:<player>:<level>`), then publishes a kind-5
// deletion for the legacy-format events still on the relays.
//
// Runs ON the VPS (the nsec never leaves it):
//   npm run build:migrate                      # → server-dist/migrate-gamestr.js
//   scp server-dist/migrate-gamestr.js <vps>:/tmp/
//   sudo bash -c 'set -a; . /etc/hangonfren-api.env; MIGRATE_DRY_RUN=1 node /tmp/migrate-gamestr.js'
//   # review the plan, then re-run without MIGRATE_DRY_RUN
//
// Env (same names as the claim service): HANGONFREN_GAME_NSEC (required),
// HANGONFREN_GAME_NPUB, HANGONFREN_CLAIM_LOG, HANGONFREN_WRITE_RELAYS,
// HANGONFREN_SITE_URL, MIGRATE_DRY_RUN=1.

import { readFile } from 'node:fs/promises';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import type { VerifiedEvent } from 'nostr-tools/core';
import { nip19 } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';
import { buildScoreEvent, GAME_ID, SCORE_KIND, type RunSummary } from '../src/scoring.js';
import { cleanPlayerName, type ClaimInput } from './claim-rules.js';

const DEFAULT_WRITE_RELAYS = [
  'wss://relay.gamestr.io',
  'wss://relay.trotters.cc',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://relay.ditto.pub',
];
const WRITE_RELAYS = (process.env.HANGONFREN_WRITE_RELAYS ?? '')
  .split(',').map(r => r.trim()).filter(Boolean);
const RELAYS = WRITE_RELAYS.length ? WRITE_RELAYS : DEFAULT_WRITE_RELAYS;
const CLAIM_LOG = process.env.HANGONFREN_CLAIM_LOG ?? '/var/lib/hangonfren/claims.jsonl';
const SITE_URL = process.env.HANGONFREN_SITE_URL ?? 'https://hang-on-fren.playechoseven.com/';
const DRY_RUN = process.env.MIGRATE_DRY_RUN === '1';
const RELAY_TIMEOUT_MS = 6000;
const NEW_D_FORMAT = new RegExp(`^${GAME_ID}:[0-9a-f]{64}:(10|[1-9])$`);

const gameSecret = loadGameSecret();
const gamePubkey = getPublicKey(gameSecret);
console.log(`[migrate] game pubkey ${gamePubkey}${DRY_RUN ? ' · DRY RUN' : ''}`);

// ---- 1. best claim per (player, level) from the append-only log -------------

interface LoggedClaim { pubkey: string; claim: ClaimInput }

const rows = await loadClaimRows();
const best = new Map<string, LoggedClaim>();
for (const row of rows) {
  const key = `${row.pubkey}:${row.claim.level}`;
  const current = best.get(key);
  if (!current || row.claim.score > current.claim.score) best.set(key, row);
}
console.log(`[migrate] claim log: ${rows.length} claims → ${best.size} best (player, level) entries`);

// ---- 2. current relay state --------------------------------------------------

const existing = await fetchExisting();
const legacy = existing.filter(e => !NEW_D_FORMAT.test(tagOf(e, 'd') ?? ''));
const specFormat = new Map<string, number>(); // d → best already-published score
for (const e of existing) {
  const d = tagOf(e, 'd') ?? '';
  if (!NEW_D_FORMAT.test(d)) continue;
  const score = Number(tagOf(e, 'score')) || 0;
  if (score > (specFormat.get(d) ?? 0)) specFormat.set(d, score);
}
console.log(`[migrate] relays hold ${existing.length} game-signed events: ${legacy.length} legacy-format, ${specFormat.size} spec-format`);

// ---- 3. republish bests under the spec d format ------------------------------

let republished = 0;
for (const { pubkey, claim } of best.values()) {
  const d = `${GAME_ID}:${pubkey}:${claim.level}`;
  if ((specFormat.get(d) ?? 0) >= claim.score) {
    console.log(`[migrate] skip ${d} — relay already has ≥ ${claim.score}`);
    continue;
  }
  const summary: RunSummary = {
    score: claim.score,
    distanceM: claim.distance_m,
    fuel: 0,
    roses: claim.roses,
    overtakes: claim.overtakes,
    nearMisses: 0,
    crashes: claim.crashes,
    bestRoseStreak: 0,
    topSpeedKph: claim.top_speed_kph,
    durationS: claim.duration_s,
    endedBy: claim.ended_by === 'finish' ? 'finish' : 'time',
  };
  const template = buildScoreEvent(summary, pubkey, {
    runId: claim.run_id,
    playerName: cleanPlayerName(claim.player_name) ?? undefined,
    playerMode: claim.player_mode === 'nostr' ? 'nostr' : 'guest',
    level: claim.level,
    siteUrl: SITE_URL,
    btcBlock: claim.btc_block,
    btcUsdCents: claim.btc_usd_cents,
  });
  if (DRY_RUN) {
    console.log(`[migrate] would publish ${d} score=${claim.score} run=${claim.run_id}`);
    republished += 1;
    continue;
  }
  const signed = finalizeEvent(template, gameSecret);
  const ok = await publish(signed);
  console.log(`[migrate] published ${d} score=${claim.score} → ${ok}/${RELAYS.length} relays (${signed.id})`);
  republished += 1;
}

// ---- 4. delete the legacy-format events --------------------------------------

if (legacy.length === 0) {
  console.log('[migrate] no legacy events to delete');
} else if (DRY_RUN) {
  for (const e of legacy) console.log(`[migrate] would delete ${e.id} d=${tagOf(e, 'd')} score=${tagOf(e, 'score')}`);
} else {
  const deletion = finalizeEvent({
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    content: 'Superseded by per-level gamestr score events (spec d format).',
    tags: [
      ...legacy.map(e => ['e', e.id]),
      ['k', String(SCORE_KIND)],
    ],
  }, gameSecret);
  const ok = await publish(deletion);
  console.log(`[migrate] deletion of ${legacy.length} legacy events → ${ok}/${RELAYS.length} relays (${deletion.id})`);
}

console.log(`[migrate] done: ${republished} republished, ${legacy.length} legacy deletions${DRY_RUN ? ' (dry run — nothing sent)' : ''}`);
process.exit(0);

// ---- helpers -----------------------------------------------------------------

function loadGameSecret(): Uint8Array {
  const raw = (process.env.HANGONFREN_GAME_NSEC ?? '').trim();
  if (!raw) throw new Error('HANGONFREN_GAME_NSEC is required');
  if (/^[0-9a-f]{64}$/i.test(raw)) return hexToBytes(raw);
  const decoded = nip19.decode(raw);
  if (decoded.type !== 'nsec') throw new Error('HANGONFREN_GAME_NSEC did not decode to nsec');
  return decoded.data;
}

async function loadClaimRows(): Promise<LoggedClaim[]> {
  const out: LoggedClaim[] = [];
  const raw = await readFile(CLAIM_LOG, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { pubkey?: unknown; claim?: Partial<ClaimInput> };
      const claim = parsed.claim;
      if (typeof parsed.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(parsed.pubkey)) continue;
      if (!claim || typeof claim.score !== 'number' || typeof claim.level !== 'number') continue;
      if (claim.score <= 0 || claim.level < 1 || claim.level > 10) continue;
      out.push({ pubkey: parsed.pubkey.toLowerCase(), claim: claim as ClaimInput });
    } catch {
      // malformed audit row — skip
    }
  }
  return out;
}

interface RelayEvent { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string }

function tagOf(e: RelayEvent, name: string): string | undefined {
  return e.tags.find(t => t[0] === name)?.[1];
}

/** All game-signed 30762 events currently on the write relays, deduped by id. */
async function fetchExisting(): Promise<RelayEvent[]> {
  const results = await Promise.all(RELAYS.map(relay => new Promise<RelayEvent[]>(resolve => {
    const events: RelayEvent[] = [];
    let ws: WebSocket;
    const timer = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } resolve(events); }, RELAY_TIMEOUT_MS);
    try {
      ws = new WebSocket(relay);
    } catch {
      clearTimeout(timer);
      resolve(events);
      return;
    }
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'mig', { kinds: [SCORE_KIND], authors: [gamePubkey], limit: 500 }]));
    ws.onmessage = ev => {
      let msg: unknown;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (!Array.isArray(msg)) return;
      if (msg[0] === 'EVENT' && msg[2]) events.push(msg[2] as RelayEvent);
      if (msg[0] === 'EOSE') { clearTimeout(timer); try { ws.close(); } catch { /* ignore */ } resolve(events); }
    };
    ws.onerror = () => { clearTimeout(timer); resolve(events); };
  })));
  const byId = new Map<string, RelayEvent>();
  for (const e of results.flat()) byId.set(e.id, e);
  return Array.from(byId.values());
}

function publish(event: VerifiedEvent): Promise<number> {
  return Promise.all(RELAYS.map(relay => new Promise<boolean>(resolve => {
    let ws: WebSocket;
    const timer = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } resolve(false); }, RELAY_TIMEOUT_MS);
    try {
      ws = new WebSocket(relay);
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]));
    ws.onmessage = ev => {
      let msg: unknown;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (!Array.isArray(msg) || msg[0] !== 'OK' || msg[1] !== event.id) return;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(msg[2] === true);
    };
    ws.onerror = () => { clearTimeout(timer); resolve(false); };
  }))).then(results => results.filter(Boolean).length);
}
