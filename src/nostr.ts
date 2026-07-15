// The gamestr layer: player identity (guest keypair or NIP-07 extension),
// score claiming and the global leaderboard fetch. Mirrors neon-sentinel's
// GAME-SIGNED model: the finished run is POSTed to /api/claim with NIP-98 auth
// (signed by the PLAYER's key); the claim service (server/index.ts) checks the
// run is plausible, signs the kind-30762 with the GAME key and publishes it.
// The leaderboard therefore only trusts events authored by GAME_PUBKEY — a
// self-signed client event can never appear on it.
//
// Guest mode: a locally-generated Nostr keypair persisted in localStorage, so
// scores are attributable and the player can later "become" that identity.
// Nostr mode: signet-login (the same SDK as pallasite) — its picker offers a
// NIP-07 extension, cross-device QR, bunker URI, nsec and Amber, so nostr
// sign-in works on phones where no extension exists.

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { GAME_ID, GAME_PUBKEY, GAME_TITLE, SCORE_KIND, type RunSummary } from './scoring.js';
import { assetUrl } from './asset-url.js';
import { DEFAULT_READ_RELAYS, DEFAULT_WRITE_RELAYS } from './relays.js';

const GUEST_KEY = 'hangonfren:guest:v1';
const MODE_KEY = 'hangonfren:identity-mode:v1';
const BOARD_CACHE_KEY = 'hangonfren:gamestr-board:v2'; // v2: game-signed boards only
const BOARD_CACHE_TTL_MS = 4 * 60 * 1000;
const PUBLISH_TIMEOUT_MS = 4200;
const FETCH_TIMEOUT_MS = 4200;
const MAX_NAME_LEN = 12;
const CLAIM_API = '/api/claim';
const NIP98_KIND = 27235;
const SIGN_TIMEOUT_MS = 30_000;

export const WRITE_RELAYS = DEFAULT_WRITE_RELAYS;

const READ_RELAYS = DEFAULT_READ_RELAYS;

export type IdentityMode = 'guest' | 'nostr';

export interface Identity {
  mode: IdentityMode;
  /** Hex pubkey; null until the guest key is first created / extension connects. */
  pubkey: string | null;
  name: string;
}

interface StoredGuest {
  nsecHex: string;
  name: string;
  createdAt: number;
  v: 1;
}

export interface SignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  id: string;
  pubkey: string;
  sig: string;
}

// ---- signet-login SDK (vendored IIFE bundles in public/) --------------------
// signet-verify assigns window.Signet; signet-login merges into it — loading
// in the reverse order drops login methods (see pallasite's auth.ts).

interface SignetSigner {
  capabilities?: { canSignEvents?: boolean };
  signEvent(event: Record<string, unknown>): Promise<unknown>;
}

interface SignetSession {
  pubkey: string;
  method: string;
  displayName?: string;
  signer: SignetSigner;
}

declare global {
  interface Window {
    Signet?: {
      login(opts: { appName: string; theme?: 'light' | 'dark' | 'auto'; relayUrl?: string }): Promise<SignetSession | null>;
      restoreSession(): Promise<SignetSession | null>;
      logout(session?: SignetSession): Promise<void>;
      handleRedirectCallback?(options?: { waitForBunker?: boolean }): Promise<{ kind: string; session?: SignetSession }>;
    };
  }
}

const SIGNET_AUTH_RELAY = 'wss://relay.trotters.cc';
let signetLoadPromise: Promise<boolean> | null = null;
let signetSession: SignetSession | null = null;

function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === '1') {
      resolve();
      return;
    }
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`failed to load ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureSignetLoaded(): Promise<boolean> {
  if (typeof window.Signet?.login === 'function') return true;
  if (!signetLoadPromise) {
    signetLoadPromise = (async () => {
      await loadScript(assetUrl('signet-verify.iife.js'), 'hof-signet-verify-sdk');
      await loadScript(assetUrl('signet-login.iife.js'), 'hof-signet-login-sdk');
      return typeof window.Signet?.login === 'function';
    })().catch(err => {
      console.warn('[gamestr] failed to load Signet SDK:', err);
      signetLoadPromise = null;
      return false;
    });
  }
  return signetLoadPromise;
}

/** True when the nostr session's signer can actually sign (an auth-only QR
 *  identity proof cannot — claims are then skipped, scores stay local). */
function sessionCanSign(session: SignetSession | null): boolean {
  return session?.signer?.capabilities?.canSignEvents === true;
}

// ---- identity ---------------------------------------------------------------

export function loadIdentityMode(): IdentityMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'nostr' ? 'nostr' : 'guest';
  } catch {
    return 'guest';
  }
}

export function saveIdentityMode(mode: IdentityMode): void {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* private mode */ }
}

export function cleanGuestName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
  return clean || 'FREN';
}

function readGuest(): StoredGuest | null {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredGuest>;
    if (typeof parsed.nsecHex !== 'string' || !/^[0-9a-f]{64}$/i.test(parsed.nsecHex)) return null;
    if (typeof parsed.name !== 'string') return null;
    return {
      nsecHex: parsed.nsecHex.toLowerCase(),
      name: cleanGuestName(parsed.name),
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      v: 1,
    };
  } catch {
    return null;
  }
}

function writeGuest(record: StoredGuest): void {
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(record)); } catch { /* ignore */ }
}

/** Create (or restore) the guest keypair. Freshly-created guests publish a
 *  kind-0 profile so leaderboards can show their name. */
function loadOrCreateGuest(name: string): StoredGuest {
  const existing = readGuest();
  if (existing) return existing;
  const stored: StoredGuest = {
    nsecHex: bytesToHex(generateSecretKey()),
    name: cleanGuestName(name),
    createdAt: Date.now(),
    v: 1,
  };
  writeGuest(stored);
  void publishGuestProfile(stored).catch(() => undefined);
  return stored;
}

/** Rename the stored guest (no-op without a change) and republish the profile. */
export function renameGuest(name: string): void {
  const clean = cleanGuestName(name);
  const stored = readGuest();
  if (!stored) {
    loadOrCreateGuest(clean);
    return;
  }
  if (stored.name === clean) return;
  const next = { ...stored, name: clean };
  writeGuest(next);
  void publishGuestProfile(next).catch(() => undefined);
}

export function getIdentity(): Identity {
  if (loadIdentityMode() === 'nostr' && signetSession) {
    const name = signetSession.displayName?.trim() || `${signetSession.pubkey.slice(0, 8)}…`;
    return { mode: 'nostr', pubkey: signetSession.pubkey, name: name.slice(0, 16) };
  }
  const guest = readGuest();
  return {
    mode: 'guest',
    pubkey: guest ? safePubkey(guest.nsecHex) : null,
    name: guest?.name ?? 'FREN',
  };
}

function safePubkey(nsecHex: string): string | null {
  try {
    return getPublicKey(hexToBytes(nsecHex));
  } catch {
    return null;
  }
}

/** Interactive nostr sign-in via the signet-login picker (extension / QR /
 *  bunker / nsec / Amber — works on phones). Resolves the pubkey, or null if
 *  the SDK failed to load or the player dismissed the dialog. */
export async function connectNostr(): Promise<string | null> {
  if (!(await ensureSignetLoaded()) || !window.Signet) return null;
  try {
    const session = await window.Signet.login({
      appName: GAME_TITLE,
      theme: 'dark',
      relayUrl: SIGNET_AUTH_RELAY,
    });
    if (!session) return null;
    signetSession = session;
    saveIdentityMode('nostr');
    return session.pubkey;
  } catch (err) {
    console.warn('[gamestr] nostr sign-in failed:', err);
    return null;
  }
}

/** Restore the persisted identity mode on boot (quietly resumes the Signet
 *  session, and consumes a redirect-mode callback if one is in the URL). */
export async function restoreIdentity(): Promise<Identity> {
  if (loadIdentityMode() === 'nostr') {
    if (await ensureSignetLoaded() && window.Signet) {
      try {
        const callback = await window.Signet.handleRedirectCallback?.({ waitForBunker: true });
        signetSession = (callback?.kind === 'session' && callback.session)
          ? callback.session
          : await window.Signet.restoreSession();
      } catch {
        signetSession = null;
      }
    }
    if (!signetSession) saveIdentityMode('guest');
  }
  return getIdentity();
}

export function useGuestMode(): void {
  saveIdentityMode('guest');
  const session = signetSession;
  signetSession = null;
  if (session && window.Signet) void window.Signet.logout(session).catch(() => undefined);
}

// ---- signing + publishing ----------------------------------------------------

async function publishGuestProfile(stored: StoredGuest): Promise<void> {
  const secret = hexToBytes(stored.nsecHex);
  const event = finalizeEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    content: JSON.stringify({
      name: stored.name,
      display_name: stored.name,
      about: 'Hang On, Fren guest rider. Grab the roses, mind the corners.',
      client: `${GAME_ID}-guest`,
    }),
    tags: [],
  }, secret) as SignedEvent;
  await publishToRelays(event);
}

/** Sign an arbitrary event template with the active identity (guest local key
 *  or the signet session's signer). Null when the nostr signer can't sign
 *  (auth-only session), declines, or times out. */
async function signWithIdentity(template: {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}, guestNameHint?: string): Promise<SignedEvent | null> {
  const identity = getIdentity();
  if (identity.mode === 'nostr' && signetSession) {
    if (!sessionCanSign(signetSession)) {
      console.warn('[gamestr] nostr session is auth-only (no live signer) — score stays local');
      return null;
    }
    try {
      const signed = await Promise.race([
        signetSession.signer.signEvent(template),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('signer-timeout')), SIGN_TIMEOUT_MS);
        }),
      ]);
      return signed as SignedEvent;
    } catch {
      return null;
    }
  }
  const guest = loadOrCreateGuest(guestNameHint ?? 'FREN');
  return finalizeEvent(template, hexToBytes(guest.nsecHex)) as SignedEvent;
}

export interface SubmitScoreOptions {
  runId: string;
  playerName?: string;
  level: number;
  /** Which tour the run rode — the prehistoric stone tour publishes tagged and
   *  namespaced so it never mixes with the road boards. */
  tour?: 'grand' | 'world' | 'stone';
  /** Wall-clock ms bounds of the run — the claim service sanity-checks them. */
  startedAt: number;
  finishedAt: number;
  endedBy: 'time' | 'finish';
  /** Bitcoin chain tip when the run ended — flavour stamped onto the event. */
  btcBlock?: number;
  /** BTC price in US cents when the run ended. */
  btcUsdCents?: number;
}

export interface PublishOutcome {
  ok: number;
  total: number;
  /** 'published' = live on relays; 'accepted' = signed but not on relays (all
   *  publishes failed, or the run didn't beat the player's best at that level —
   *  score events are per-level addressable, so only improvements go out). */
  status: 'published' | 'accepted';
}

/** Pure: clock offset (server − local) in ms from an HTTP Date header, 0 when
 *  the header is missing or unparseable. */
export function clockOffsetMs(dateHeader: string | null, localNowMs: number): number {
  if (!dateHeader) return 0;
  const serverMs = Date.parse(dateHeader);
  return Number.isFinite(serverMs) ? serverMs - localNowMs : 0;
}

/** Measure how far this device's clock is from the claim service's. Phone
 *  clocks are routinely minutes adrift, and the service enforces NIP-98
 *  freshness (±60 s) and run staleness against ITS clock — so claims are
 *  submitted in server time. Best-effort: 0 when the service is unreachable
 *  (the claim POST would fail anyway). */
async function fetchServerClockOffset(): Promise<number> {
  try {
    const res = await fetch(`${CLAIM_API}/health`, { cache: 'no-store' });
    return clockOffsetMs(res.headers.get('date'), Date.now());
  } catch {
    return 0;
  }
}

/**
 * Claim the finished run: NIP-98-sign the payload with the PLAYER's key and
 * POST it to the claim service, which validates, signs the score event with
 * the GAME key and publishes it. Null = score stays local (no service, signer
 * declined, or the claim was rejected).
 */
export async function submitScore(summary: RunSummary, opts: SubmitScoreOptions): Promise<PublishOutcome | null> {
  if (summary.score <= 0) return null; // boards ignore zero scores
  const identity = getIdentity();
  // Shift the run's wall-clock bounds and the auth timestamp into server time;
  // both bounds move together, so the duration/wall-clock relation the service
  // checks is preserved.
  const clockOffset = await fetchServerClockOffset();
  const claim = {
    game: GAME_ID,
    score: summary.score,
    distance_m: summary.distanceM,
    duration_s: summary.durationS,
    started_at: opts.startedAt + clockOffset,
    finished_at: opts.finishedAt + clockOffset,
    run_id: opts.runId,
    roses: summary.roses,
    overtakes: summary.overtakes,
    crashes: summary.crashes,
    top_speed_kph: summary.topSpeedKph,
    drifts: summary.drifts,
    level: opts.level,
    ended_by: opts.endedBy,
    ...(opts.tour ? { tour: opts.tour } : {}),
    ...(opts.playerName ? { player_name: opts.playerName } : {}),
    ...(opts.btcBlock ? { btc_block: opts.btcBlock } : {}),
    ...(opts.btcUsdCents ? { btc_usd_cents: opts.btcUsdCents } : {}),
    player_mode: identity.mode,
  };
  const bodyJson = JSON.stringify(claim);
  const url = `${location.origin}${CLAIM_API}`;
  const auth = await signWithIdentity({
    kind: NIP98_KIND,
    created_at: Math.floor((Date.now() + clockOffset) / 1000),
    content: '',
    tags: [
      ['u', url],
      ['method', 'POST'],
      ['payload', await sha256Hex(bodyJson)],
    ],
  }, opts.playerName);
  if (!auth) return null;

  let res: Response;
  try {
    res = await fetch(CLAIM_API, {
      method: 'POST',
      headers: {
        authorization: `Nostr ${utf8Base64(JSON.stringify(auth))}`,
        'content-type': 'application/json',
      },
      body: bodyJson,
    });
  } catch {
    return null; // no claim service reachable — score stays local
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const result = data as { ok?: unknown; published?: { ok?: unknown; total?: unknown }; status?: unknown };
  if (result.ok !== true) {
    console.warn('[gamestr] claim rejected:', data);
    return null;
  }
  const ok = typeof result.published?.ok === 'number' ? result.published.ok : 0;
  const total = typeof result.published?.total === 'number' ? result.published.total : 0;
  return { ok, total, status: ok > 0 ? 'published' : 'accepted' };
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function utf8Base64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function publishToRelays(event: SignedEvent): Promise<boolean[]> {
  return Promise.all(WRITE_RELAYS.map(relay => publishToRelay(relay, event)));
}

function publishToRelay(relay: string, event: SignedEvent): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof WebSocket === 'undefined') {
      resolve(false);
      return;
    }
    let ws: WebSocket;
    let settled = false;
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(ok);
    };
    const timer = setTimeout(() => settle(false), PUBLISH_TIMEOUT_MS);
    try {
      ws = new WebSocket(relay);
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    ws.onopen = () => {
      try { ws.send(JSON.stringify(['EVENT', event])); } catch { settle(false); }
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

// ---- global leaderboard --------------------------------------------------------

export interface GlobalScore {
  pubkey: string;
  name: string;
  score: number;
  distanceM: number;
  at: number;
}

interface BoardCache {
  entries: GlobalScore[];
  fetchedAt: number;
}

function readBoardCache(): BoardCache | null {
  try {
    const raw = localStorage.getItem(BOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BoardCache>;
    if (!Array.isArray(parsed.entries) || typeof parsed.fetchedAt !== 'number') return null;
    return { entries: parsed.entries as GlobalScore[], fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

/**
 * Fetch the global hangonfren board: kind-30762 events AUTHORED BY THE GAME
 * KEY (self-signed player events never qualify — same trust model as
 * neon-sentinel/pallasite), signature-verified, best-per-player (the `p` tag),
 * top `limit` by score. Serves a short localStorage cache first so the title
 * screen isn't waiting on sockets.
 */
export async function fetchGlobalBoard(limit = 5, force = false): Promise<GlobalScore[]> {
  const cached = readBoardCache();
  if (!force && cached && Date.now() - cached.fetchedAt < BOARD_CACHE_TTL_MS) {
    return cached.entries.slice(0, limit);
  }
  const events = await Promise.all(READ_RELAYS.map(relay => fetchScoresFromRelay(relay)));
  const bestByPlayer = new Map<string, GlobalScore>();
  const flat = events.flat();
  for (let i = 0; i < flat.length; i += 1) {
    const event = flat[i];
    // Schnorr verification is 1-3ms of field maths per event, and a relay dump
    // can be dozens of events — verified in a tight loop that lands mid-run,
    // it's a dropped-frames hitch. Yield to the frame between events so the
    // cost smears invisibly across time instead.
    if (i > 0) await new Promise(resolve => setTimeout(resolve, 0));
    if (!isValidScoreEvent(event)) continue;
    const tag = (name: string): string | undefined => event.tags.find(t => t[0] === name)?.[1];
    const score = Number(tag('score'));
    if (!Number.isFinite(score) || score <= 0) continue;
    if (tag('cheated') === 'true') continue;
    // Prehistoric scores live on their own timeline: the 600B YEARS BC tour's
    // pill/drift economy prices runs on a different scale, so the main TOP
    // FRENS board stays road-tour only and BC runs board apart.
    if (tag('tour') === 'stone') continue;
    // Game-signed events attribute the player via the `p` tag; without one
    // there is nobody to credit, so the event is skipped.
    const player = tag('p');
    if (!player || !/^[0-9a-f]{64}$/i.test(player)) continue;
    const entry: GlobalScore = {
      pubkey: player.toLowerCase(),
      name: (tag('playerName') ?? tag('player') ?? `${player.slice(0, 8)}…`).slice(0, MAX_NAME_LEN),
      score: Math.floor(score),
      distanceM: Number(tag('distance')) || 0,
      at: event.created_at,
    };
    const existing = bestByPlayer.get(entry.pubkey);
    if (!existing || entry.score > existing.score) bestByPlayer.set(entry.pubkey, entry);
  }
  const entries = Array.from(bestByPlayer.values()).sort((a, b) => b.score - a.score).slice(0, 20);
  if (entries.length || !cached) {
    try { localStorage.setItem(BOARD_CACHE_KEY, JSON.stringify({ entries, fetchedAt: Date.now() })); } catch { /* ignore */ }
  }
  const out = entries.length ? entries : cached?.entries ?? [];
  return out.slice(0, limit);
}

function isValidScoreEvent(event: SignedEvent): boolean {
  if (event.kind !== SCORE_KIND) return false;
  if (event.pubkey !== GAME_PUBKEY) return false; // game-signed only
  if (!event.tags.some(t => t[0] === 'game' && t[1] === GAME_ID)) return false;
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}

function fetchScoresFromRelay(relay: string): Promise<SignedEvent[]> {
  return new Promise(resolve => {
    if (typeof WebSocket === 'undefined') {
      resolve([]);
      return;
    }
    const events: SignedEvent[] = [];
    let ws: WebSocket;
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(events);
    };
    const timer = setTimeout(settle, FETCH_TIMEOUT_MS);
    try {
      ws = new WebSocket(relay);
    } catch {
      clearTimeout(timer);
      resolve([]);
      return;
    }
    const subId = `hof-${Math.random().toString(36).slice(2, 10)}`;
    ws.onopen = () => {
      try {
        // No '#game' tag filter: relays only index single-letter tags (NIP-01),
        // so filtering on the multi-letter `game` tag returns nothing on most
        // of them. Kind + author narrows it enough; isValidScoreEvent checks
        // the game tag client-side.
        ws.send(JSON.stringify(['REQ', subId, { kinds: [SCORE_KIND], authors: [GAME_PUBKEY], limit: 200 }]));
      } catch {
        settle();
      }
    };
    ws.onmessage = ev => {
      let msg: unknown;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (!Array.isArray(msg)) return;
      if (msg[0] === 'EVENT' && msg[1] === subId && typeof msg[2] === 'object' && msg[2] !== null) {
        events.push(msg[2] as SignedEvent);
      } else if (msg[0] === 'EOSE' && msg[1] === subId) {
        settle();
      }
    };
    ws.onerror = () => settle();
    ws.onclose = () => settle();
  });
}
