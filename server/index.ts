// Hang On, Fren score-claim service. The browser POSTs a finished run to
// /api/claim with NIP-98 auth (signed by the PLAYER's key — guest or NIP-07);
// this service checks the run is plausible, signs the kind-30762 gamestr score
// event with the GAME key and publishes it to the write relays. Leaderboards
// then only trust events authored by the game (the player rides in the `p`
// tag), exactly like neon-sentinel and pallasite.
//
// Config (systemd EnvironmentFile, e.g. /etc/hangonfren-api.env):
//   HANGONFREN_GAME_NSEC       REQUIRED — nsec1… or 64-char hex (nsec-tree path hang-on-fren@0)
//   HANGONFREN_GAME_NPUB       expected npub the nsec must derive to (defaults to the committed one)
//   HANGONFREN_API_PORT        default 3191
//   HANGONFREN_DATA_DIR        default /var/lib/hangonfren
//   HANGONFREN_CLAIM_LOG       default $HANGONFREN_DATA_DIR/claims.jsonl
//   HANGONFREN_PUBLISH         set 0 to sign without publishing (testing)
//   HANGONFREN_SITE_URL        public play URL for the event's r/source tags
//   HANGONFREN_ALLOWED_ORIGINS comma-separated extra CORS origins
//   HANGONFREN_WRITE_RELAYS    comma-separated relay override

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import type { VerifiedEvent } from 'nostr-tools/core';
import { nip19 } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';
import {
  unpackEventFromToken,
  validateEventKind,
  validateEventMethodTag,
  validateEventPayloadTag,
  validateEventTimestamp,
  validateEventUrlTag,
} from 'nostr-tools/nip98';
import { buildScoreEvent, scoreLevelKey, GAME_ID, GAME_PUBKEY, SCORE_KIND, type RunSummary } from '../src/scoring.js';
import { DEFAULT_WRITE_RELAYS } from '../src/relays.js';
import { parseClaim, cleanPlayerName, MAX_DISTANCE_M, STALE_RUN_MS, type ClaimInput } from './claim-rules.js';
import { seedHistoricBestScores } from './historic-scores.js';

const WRITE_RELAYS = loadWriteRelays();
const PORT = Number(process.env.PORT ?? process.env.HANGONFREN_API_PORT ?? 3191);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATA_DIR = process.env.HANGONFREN_DATA_DIR ?? '/var/lib/hangonfren';
const CLAIM_LOG = process.env.HANGONFREN_CLAIM_LOG ?? `${DATA_DIR}/claims.jsonl`;
const PUBLISH_ENABLED = process.env.HANGONFREN_PUBLISH !== '0';
const EXPECTED_GAME_NPUB = process.env.HANGONFREN_GAME_NPUB
  ?? 'npub12ycjmydvdlrwx5q9cgm9dv80lg2eez0ykg09dcz56kh49tw8cfeqnap6qw';
const SITE_URL = process.env.HANGONFREN_SITE_URL ?? 'https://hang-on-fren.playechoseven.com/';
const MAX_BODY_BYTES = 64 * 1024;
const CLAIM_DEDUP_TTL_MS = STALE_RUN_MS * 3;
const CLAIM_RATE_LIMIT = { limit: 6, windowMs: 60_000 };
const RATE_LIMIT_MAX_TRACKED_IPS = 10_000;
const RELAY_PUBLISH_TIMEOUT_MS = 5000;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://hang-on-fren.playechoseven.com',
  'https://thecryptodonkey.github.io',
] as const;
const allowedCorsOrigins = loadAllowedCorsOrigins();

interface StoredClaim {
  key: string;
  pubkey: string;
  run_id: string;
  score_event_id: string;
  published: { ok: number; total: number };
  accepted_at: string;
  finished_at: number;
}

const gameSecret = loadGameSecret();
const expectedGamePubkey = decodeNpub(EXPECTED_GAME_NPUB);
const gamePubkey = resolveGamePubkey(gameSecret);
const { claims, bestScores } = await loadClaims();
pruneStaleClaims();
const claimRateLimiter = createRateLimiter(CLAIM_RATE_LIMIT.limit, CLAIM_RATE_LIMIT.windowMs);

if (expectedGamePubkey && expectedGamePubkey !== GAME_PUBKEY) {
  console.warn(`[api] HANGONFREN_GAME_NPUB (${expectedGamePubkey}) differs from the committed GAME_PUBKEY (${GAME_PUBKEY}) — the client leaderboard filters on the committed key.`);
}

createServer((req, res) => {
  void route(req, res).catch(err => {
    console.error('[api] unhandled error', err);
    sendJson(res, 500, { ok: false, error: 'internal_error' }, req);
  });
}).listen(PORT, HOST, () => {
  console.log(`[api] Hang On, Fren claim service listening on ${HOST}:${PORT}`);
  console.log(`[api] signer ${gameSecret ? `ready ${gamePubkey}` : 'not configured'} · publish ${PUBLISH_ENABLED ? 'on' : 'OFF'}`);
  void publishGameProfile();
});

/** (Re)publish the game's kind-0 profile on boot. Kind 0 is replaceable so
 *  this is idempotent — the game account stays fresh on the relays without a
 *  separate tool ever needing the nsec. */
async function publishGameProfile(): Promise<void> {
  if (!gameSecret || !PUBLISH_ENABLED) return;
  try {
    const profile = finalizeEvent({
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify({
        name: 'Hang On, Fren',
        display_name: 'Hang On, Fren 🛵🌹',
        about: 'Riviera Vespa arcade racer — ten regions, one finish line. Grab the roses, sink the beers (carefully), mind the fly agaric. Scores land on gamestr as kind-30762, signed by this key. Ride at ' + SITE_URL,
        website: SITE_URL,
        picture: `${SITE_URL.replace(/\/$/, '')}/icons/icon-512.png`,
        banner: `${SITE_URL.replace(/\/$/, '')}/art/title-art-orig.png`,
        bot: true,
      }),
      tags: [],
    }, gameSecret);
    const published = await publishSignedScore(profile);
    console.log(`[api] game profile (kind 0) published to ${published.ok}/${published.total} relays`);
  } catch (err) {
    console.warn('[api] game profile publish failed:', err);
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/api/claim/health')) {
    sendJson(res, 200, {
      ok: true,
      service: 'hang-on-fren-claim',
      game: GAME_ID,
      score_kind: SCORE_KIND,
      signer_configured: Boolean(gameSecret),
      publish_enabled: PUBLISH_ENABLED,
      game_pubkey: gamePubkey,
      expected_game_npub: EXPECTED_GAME_NPUB,
      max_distance_m: MAX_DISTANCE_M,
      write_relays: WRITE_RELAYS,
      claims_seen: claims.size,
      best_scores_tracked: bestScores.size,
    }, req);
    return;
  }
  if (req.method !== 'POST' || !req.url?.startsWith('/api/claim')) {
    sendJson(res, 404, { ok: false, error: 'not_found' }, req);
    return;
  }
  // Every claim decision is journalled: a rejected claim is otherwise
  // invisible (no access log on the vhost, nothing in the claim log).
  const ip = clientIp(req);
  if (!claimRateLimiter(ip)) {
    console.warn(`[api] claim rejected 429 rate_limited ip=${ip}`);
    sendJson(res, 429, { ok: false, error: 'rate_limited' }, req);
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req);
  } catch (err) {
    const error = err instanceof Error ? err.message : 'invalid_body';
    console.warn(`[api] claim rejected ${error === 'body_too_large' ? 413 : 400} ${error} ip=${ip}`);
    sendJson(res, err instanceof Error && err.message === 'body_too_large' ? 413 : 400, { ok: false, error: err instanceof Error ? err.message : 'invalid_body' }, req);
    return;
  }
  let body: unknown;
  try {
    body = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    console.warn(`[api] claim rejected 400 invalid_json_body ip=${ip}`);
    sendJson(res, 400, { ok: false, error: 'invalid_json_body' }, req);
    return;
  }

  const auth = await verifyNip98(req, body);
  if (!auth.ok) {
    console.warn(`[api] claim rejected ${auth.status} ${auth.error}${auth.detail ? ` (${auth.detail})` : ''} ip=${ip}`);
    sendJson(res, auth.status, { ok: false, error: auth.error }, req);
    return;
  }

  const parsed = parseClaim(body);
  if (!parsed.ok) {
    const clock = parsed.error === 'stale_run' || parsed.error === 'invalid_run_clock'
      ? ` finished_at=${(body as { finished_at?: unknown }).finished_at} server_now=${Date.now()}`
      : '';
    console.warn(`[api] claim rejected ${parsed.status} ${parsed.error}${parsed.detail ? ` (${parsed.detail})` : ''}${clock} pubkey=${auth.pubkey.slice(0, 8)} ip=${ip}`);
    sendJson(res, parsed.status, { ok: false, error: parsed.error, detail: parsed.detail }, req);
    return;
  }

  if (!gameSecret || !gamePubkey) {
    console.error('[api] claim rejected 503 signer_unavailable');
    sendJson(res, 503, {
      ok: false,
      error: 'signer_unavailable',
      detail: 'Set HANGONFREN_GAME_NSEC in /etc/hangonfren-api.env and restart hangonfren-api.service.',
    }, req);
    return;
  }

  const claim = parsed.claim;
  const key = `${auth.pubkey}:${claim.run_id}:${claim.started_at}:${claim.finished_at}`;
  const replay = claims.get(key);
  if (replay) {
    console.log(`[api] claim replay pubkey=${auth.pubkey.slice(0, 8)} run=${claim.run_id}`);
    sendJson(res, 200, {
      ok: true,
      score_event_id: replay.score_event_id,
      status: 'accepted',
      published: replay.published,
    }, req);
    return;
  }

  // Kind 30762 is addressable: the `d` tag is game:player:levelKey, so
  // publishing a worse run would REPLACE the player's better score for that
  // level on the relays. Sign and log every accepted claim, but only publish
  // improvements. The level key is tour-namespaced (scoreLevelKey) so the
  // secret stone tour can never displace a road-tour score.
  const bestKey = `${auth.pubkey}:${scoreLevelKey(claim.tour, claim.level)}`;
  const improves = claim.score > (bestScores.get(bestKey) ?? 0);
  if (improves) bestScores.set(bestKey, claim.score);

  const signed = finalizeEvent(buildGameSignedScore(claim, auth.pubkey), gameSecret);
  const published = improves
    ? await publishSignedScore(signed)
    : { ok: 0, total: WRITE_RELAYS.length };
  const stored: StoredClaim = {
    key,
    pubkey: auth.pubkey,
    run_id: claim.run_id,
    score_event_id: signed.id,
    published,
    accepted_at: new Date().toISOString(),
    finished_at: claim.finished_at,
  };
  claims.set(key, stored);
  pruneStaleClaims();
  await appendClaim(stored, claim);

  console.log(`[api] claim accepted pubkey=${auth.pubkey.slice(0, 8)} run=${claim.run_id} level=${claim.level} score=${claim.score} improves=${improves} published=${published.ok}/${published.total} ip=${ip}`);
  sendJson(res, 200, {
    ok: true,
    score_event_id: signed.id,
    status: published.ok > 0 ? 'published' : 'accepted',
    published,
    ...(improves ? {} : { reason: 'below_best' }),
  }, req);
}

/** Reuse the client's tested event builder — one source of truth for the
 *  gamestr tag shape — with the run mapped back into a RunSummary. */
function buildGameSignedScore(claim: ClaimInput, playerPubkey: string): ReturnType<typeof buildScoreEvent> {
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
    // The claim carries the drift COUNT but not the longest slide — the board
    // only publishes the count, and there is no reason to make clients send a
    // stat nothing reads. Older clients omit it entirely; absent reads as zero.
    drifts: claim.drifts ?? 0,
    bestDriftS: 0,
    durationS: claim.duration_s,
    endedBy: claim.ended_by,
  };
  return buildScoreEvent(summary, playerPubkey, {
    runId: claim.run_id,
    playerName: cleanPlayerName(claim.player_name) ?? undefined,
    playerMode: claim.player_mode === 'nostr' ? 'nostr' : 'guest',
    level: claim.level,
    tour: claim.tour,
    siteUrl: SITE_URL,
    btcBlock: claim.btc_block,
    btcUsdCents: claim.btc_usd_cents,
  });
}

async function verifyNip98(req: IncomingMessage, body: unknown): Promise<
  | { ok: true; pubkey: string }
  | { ok: false; status: 400 | 401; error: string; detail?: string }
> {
  const header = req.headers.authorization;
  if (!header) return { ok: false, status: 401, error: 'missing_authorization' };
  let event;
  try {
    event = await unpackEventFromToken(header);
  } catch {
    return { ok: false, status: 401, error: 'invalid_auth_payload' };
  }
  const url = reconstructUrl(req);
  if (!validateEventKind(event)) return { ok: false, status: 401, error: 'wrong_kind' };
  if (!validateEventTimestamp(event)) {
    // The token is stamped with the CLIENT's clock — a phone more than 60 s
    // adrift fails here before any claim rule runs.
    return {
      ok: false,
      status: 401,
      error: 'stale_timestamp',
      detail: `token_created_at=${event.created_at} server_now=${Math.floor(Date.now() / 1000)}`,
    };
  }
  if (!validateEventUrlTag(event, url)) {
    return {
      ok: false,
      status: 401,
      error: 'url_mismatch',
      detail: `token_u=${event.tags.find(t => t[0] === 'u')?.[1]} reconstructed=${url}`,
    };
  }
  if (!validateEventMethodTag(event, req.method ?? 'POST')) return { ok: false, status: 401, error: 'method_mismatch' };
  if (body && typeof body === 'object' && !validateEventPayloadTag(event, body)) {
    return { ok: false, status: 401, error: 'payload_mismatch' };
  }
  if (!verifyEvent(event)) return { ok: false, status: 401, error: 'invalid_signature' };
  return { ok: true, pubkey: event.pubkey };
}

async function publishSignedScore(event: VerifiedEvent): Promise<{ ok: number; total: number }> {
  if (!PUBLISH_ENABLED) return { ok: 0, total: WRITE_RELAYS.length };
  const results = await Promise.all(WRITE_RELAYS.map(relay => publishToRelay(relay, event)));
  return { ok: results.filter(Boolean).length, total: WRITE_RELAYS.length };
}

interface RelayWebSocket {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

function publishToRelay(relay: string, event: VerifiedEvent): Promise<boolean> {
  return new Promise(resolve => {
    const WebSocketCtor = (globalThis as unknown as { WebSocket?: new (url: string) => RelayWebSocket }).WebSocket;
    if (!WebSocketCtor) {
      resolve(false);
      return;
    }
    let ws: RelayWebSocket | null = null;
    let settled = false;
    const timer = setTimeout(() => settle(false), RELAY_PUBLISH_TIMEOUT_MS);
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* ignore */ }
      resolve(ok);
    };
    try {
      ws = new WebSocketCtor(relay);
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    ws.onopen = () => {
      try { ws?.send(JSON.stringify(['EVENT', event])); } catch { settle(false); }
    };
    ws.onmessage = ev => {
      let msg: unknown;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (!Array.isArray(msg) || msg[0] !== 'OK' || msg[1] !== event.id) return;
      settle(msg[2] === true);
    };
    ws.onerror = () => settle(false);
    ws.onclose = () => settle(false);
  });
}

async function appendClaim(stored: StoredClaim, claim: ClaimInput): Promise<void> {
  await mkdir(dirname(CLAIM_LOG), { recursive: true });
  await appendFile(CLAIM_LOG, `${JSON.stringify({ ...stored, claim })}\n`, { encoding: 'utf8' });
}

async function loadClaims(): Promise<{ claims: Map<string, StoredClaim>; bestScores: Map<string, number> }> {
  const map = new Map<string, StoredClaim>();
  // Best accepted score per `${pubkey}:${level}` — the publish gate for the
  // per-level addressable events. Rebuilt from the full append-only log and
  // curated pre-service board so a restart can never let a worse run replace a
  // better one on the relays.
  const best = new Map<string, number>();
  try {
    const raw = await readFile(CLAIM_LOG, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Partial<StoredClaim> & { claim?: { score?: unknown; level?: unknown; tour?: unknown } };
        if (typeof parsed.key === 'string' && typeof parsed.score_event_id === 'string') {
          const acceptedAt = String(parsed.accepted_at ?? '');
          const pubkey = String(parsed.pubkey ?? '');
          map.set(parsed.key, {
            key: parsed.key,
            pubkey,
            run_id: String(parsed.run_id ?? ''),
            score_event_id: parsed.score_event_id,
            published: isPublished(parsed.published) ? parsed.published : { ok: 0, total: WRITE_RELAYS.length },
            accepted_at: acceptedAt,
            finished_at: typeof parsed.finished_at === 'number' ? parsed.finished_at : Date.parse(acceptedAt) || 0,
          });
          const score = parsed.claim?.score;
          const level = parsed.claim?.level;
          const tour = typeof parsed.claim?.tour === 'string' ? parsed.claim.tour : undefined;
          if (pubkey && typeof score === 'number' && typeof level === 'number') {
            const key = `${pubkey}:${scoreLevelKey(tour, level)}`;
            if (score > (best.get(key) ?? 0)) best.set(key, score);
          }
        }
      } catch {
        // Ignore malformed audit rows; future writes remain append-only.
      }
    }
  } catch {
    // First deploy starts with no claim log.
  }
  seedHistoricBestScores(best);
  return { claims: map, bestScores: best };
}

function pruneStaleClaims(): void {
  const cutoff = Date.now() - CLAIM_DEDUP_TTL_MS;
  for (const [key, stored] of claims) {
    if (stored.finished_at < cutoff) claims.delete(key);
  }
}

function isPublished(value: unknown): value is { ok: number; total: number } {
  if (!value || typeof value !== 'object') return false;
  const parsed = value as { ok?: unknown; total?: unknown };
  return typeof parsed.ok === 'number' && typeof parsed.total === 'number';
}

function loadGameSecret(): Uint8Array | null {
  const raw = process.env.HANGONFREN_GAME_NSEC ?? process.env.GAME_NSEC ?? '';
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return hexToBytes(trimmed);
  if (trimmed.toLowerCase().startsWith('nsec1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'nsec') throw new Error('HANGONFREN_GAME_NSEC did not decode to nsec');
    return decoded.data;
  }
  throw new Error('HANGONFREN_GAME_NSEC must be 64-char hex or nsec1...');
}

function resolveGamePubkey(secret: Uint8Array | null): string | null {
  if (!secret) return expectedGamePubkey;
  const actual = getPublicKey(secret);
  if (expectedGamePubkey && actual !== expectedGamePubkey) {
    throw new Error(`HANGONFREN_GAME_NSEC derives to ${actual}, expected ${expectedGamePubkey} (${EXPECTED_GAME_NPUB})`);
  }
  return actual;
}

function decodeNpub(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.toLowerCase().startsWith('npub1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'npub') throw new Error('HANGONFREN_GAME_NPUB did not decode to npub');
    return decoded.data;
  }
  throw new Error('HANGONFREN_GAME_NPUB must be 64-char hex or npub1...');
}

function reconstructUrl(req: IncomingMessage): string {
  const proto = header(req, 'x-forwarded-proto') ?? 'http';
  const host = header(req, 'x-forwarded-host') ?? header(req, 'host') ?? `${HOST}:${PORT}`;
  return `${proto}://${host}${req.url ?? '/api/claim'}`;
}

function header(req: IncomingMessage, key: string): string | undefined {
  const value = req.headers[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error('body_too_large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown, req?: IncomingMessage): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...corsHeaders(req),
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function clientIp(req: IncomingMessage): string {
  const forwarded = header(req, 'x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

function createRateLimiter(limit: number, windowMs: number, maxTrackedIps = RATE_LIMIT_MAX_TRACKED_IPS): (ip: string) => boolean {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();
  return (ip: string): boolean => {
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (bucket) {
      buckets.delete(ip); // re-insert below to mark as most-recently-used
    } else {
      if (buckets.size >= maxTrackedIps) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) buckets.delete(oldestKey);
      }
      bucket = { tokens: limit, updatedAt: now };
    }
    const elapsedMs = now - bucket.updatedAt;
    bucket.tokens = Math.min(limit, bucket.tokens + (elapsedMs / windowMs) * limit);
    bucket.updatedAt = now;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    buckets.set(ip, bucket);
    return allowed;
  };
}

function corsHeaders(req?: IncomingMessage): Record<string, string> {
  const requestOrigin = req ? header(req, 'origin') : undefined;
  const origin = requestOrigin && allowedCorsOrigins.has(requestOrigin)
    ? requestOrigin
    : DEFAULT_ALLOWED_ORIGINS[0];
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
  };
}

function loadAllowedCorsOrigins(): Set<string> {
  const configured = (process.env.HANGONFREN_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function loadWriteRelays(): string[] {
  const configured = (process.env.HANGONFREN_WRITE_RELAYS ?? '')
    .split(',')
    .map(relay => relay.trim())
    .filter(Boolean);
  const relays = configured.length > 0 ? configured : [...DEFAULT_WRITE_RELAYS];
  const clean: string[] = [];
  const seen = new Set<string>();
  for (const relay of relays) {
    if (!isRelayUrl(relay) || seen.has(relay)) continue;
    seen.add(relay);
    clean.push(relay);
  }
  return clean.length > 0 ? clean : [...DEFAULT_WRITE_RELAYS];
}

function isRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'wss:' || url.protocol === 'ws:';
  } catch {
    return false;
  }
}
