// Score accrual + the end-of-run summary. Kept pure so scoring rules are
// unit-tested. `buildScoreEvent()` is the deliberate seam for the future
// Nostr layer: today it just shapes the data; later a signer publishes it as a
// kind 30762 event exactly like neon-sentinel (see docs spec, "Online scope").

export interface ScoreState {
  score: number;
  /** Difficulty-mode points multiplier — braver roads pay better. */
  mult: number;
  /** Metres travelled — also the primary skill signal. */
  distance: number;
  fuel: number; // petrol cans (the common pickup)
  roses: number; // rare special roses
  overtakes: number;
  nearMisses: number;
  crashes: number;
  /** Longest streak of pickups grabbed without a crash in between. */
  bestRoseStreak: number;
  roseStreak: number;
  topSpeed: number;
}

// Points. Distance dominates (skill-first), pickups/overtakes are the spice.
const POINTS_PER_METRE = 1;
const POINTS_PER_FUEL = 120;
const POINTS_PER_ROSE = 400; // rare special
const POINTS_PER_OVERTAKE = 250;
const POINTS_PER_NEAR_MISS = 60;

export function createScore(mult = 1): ScoreState {
  return {
    score: 0,
    mult,
    distance: 0,
    fuel: 0,
    roses: 0,
    overtakes: 0,
    nearMisses: 0,
    crashes: 0,
    bestRoseStreak: 0,
    roseStreak: 0,
    topSpeed: 0,
  };
}

/** Bank distance travelled this frame. `speedKph` feeds the top-speed stat. */
export function addDistance(state: ScoreState, metres: number, speedKph: number): void {
  if (metres <= 0) return;
  state.distance += metres;
  state.score += metres * POINTS_PER_METRE * state.mult;
  if (speedKph > state.topSpeed) state.topSpeed = speedKph;
}

function bumpStreak(state: ScoreState): number {
  state.roseStreak += 1;
  if (state.roseStreak > state.bestRoseStreak) state.bestRoseStreak = state.roseStreak;
  // Streak multiplier rewards clean pickup runs without over-scaling.
  return 1 + Math.min(state.roseStreak - 1, 9) * 0.1;
}

/** A petrol can (the common pickup) grants points + tops up the clock. */
export function addFuel(state: ScoreState, actionMul = 1): void {
  state.fuel += 1;
  const streakBonus = bumpStreak(state);
  state.score += Math.round(POINTS_PER_FUEL * streakBonus * state.mult * actionMul);
}

/** A rare rose grants big points (and a nitro boost, handled in main). */
export function addRose(state: ScoreState, actionMul = 1): void {
  state.roses += 1;
  const streakBonus = bumpStreak(state);
  state.score += Math.round(POINTS_PER_ROSE * streakBonus * state.mult * actionMul);
}

/** A special treat pickup (cake, meme, ATH…): points, streak-multiplied. */
export function addBonus(state: ScoreState, points: number, actionMul = 1): void {
  const streakBonus = bumpStreak(state);
  state.score += Math.round(points * streakBonus * state.mult * actionMul);
}

/** A troll pickup (fiat): shaves score and breaks the streak. */
export function penalise(state: ScoreState, points: number): void {
  state.score = Math.max(0, state.score - points);
  state.roseStreak = 0;
}

/** A skill stunt (slipstream slingshot): mode-multiplied points, streak-neutral. */
export function addStuntBonus(state: ScoreState, points: number, actionMul = 1): void {
  state.score += Math.round(points * state.mult * actionMul);
}

export function addOvertake(state: ScoreState, actionMul = 1): void {
  state.overtakes += 1;
  state.score += POINTS_PER_OVERTAKE * state.mult * actionMul;
}

export function addNearMiss(state: ScoreState, actionMul = 1): void {
  state.nearMisses += 1;
  state.score += POINTS_PER_NEAR_MISS * state.mult * actionMul;
}

export function registerCrash(state: ScoreState): void {
  state.crashes += 1;
  state.roseStreak = 0;
}

export interface RunSummary {
  score: number;
  distanceM: number;
  fuel: number;
  roses: number;
  overtakes: number;
  nearMisses: number;
  crashes: number;
  bestRoseStreak: number;
  topSpeedKph: number;
  durationS: number;
  endedBy: 'time' | 'crashes' | 'finish';
}

export function summarise(state: ScoreState, durationS: number, endedBy: 'time' | 'crashes' | 'finish'): RunSummary {
  return {
    score: Math.round(state.score),
    distanceM: Math.round(state.distance),
    fuel: state.fuel,
    roses: state.roses,
    overtakes: state.overtakes,
    nearMisses: state.nearMisses,
    crashes: state.crashes,
    bestRoseStreak: state.bestRoseStreak,
    topSpeedKph: Math.round(state.topSpeed),
    durationS: Math.round(durationS),
    endedBy,
  };
}

// Gamestr identity of this game. Boards (pallasite, gamestr-arcade) filter
// kind-30762 events on the `game` tag, need `score` > 0 and attribute runs to
// the `p` tag — no registration required anywhere.
export const GAME_ID = 'hangonfren';
export const SCORE_KIND = 30762;
export const GAME_TITLE = 'Hang On, Fren';
// The game's official Nostr identity (hex pubkey for
// npub12ycjmydvdlrwx5q9cgm9dv80lg2eez0ykg09dcz56kh49tw8cfeqnap6qw, derived at
// nsec-tree path hang-on-fren@0 — the nsec itself stays offline, never in this
// repo). Not used for signing today (scores are player-signed); this is the
// identity for the game's kind-0 profile and any future game-signed board.
export const GAME_PUBKEY = '51312d91ac6fc6e35005c23656b0effa159c89e4b21e56e054d5af52adc7c272';
// The public host is deliberately not committed (see deploy/README.md), so the
// discovery URL is derived from wherever the game is actually being served.
// (globalThis lookup, not bare `location` — this module is shared with the
// claim server's node build, which has no DOM lib.)
function browserLocation(): { origin: string; pathname: string; host: string } | undefined {
  return (globalThis as { location?: { origin: string; pathname: string; host: string } }).location;
}
function gameUrl(): string {
  const loc = browserLocation();
  return loc ? `${loc.origin}${loc.pathname}` : 'https://github.com/TheCryptoDonkey/hang-on-fren-public';
}
function gameSource(): string {
  return browserLocation()?.host ?? 'hang-on-fren';
}
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export interface ScoreEventOptions {
  /** Unique per run — provenance stamped as a `run_id` tag (the `d` tag is
   *  per-level per the gamestr spec, so runs at the same level replace). */
  runId?: string;
  playerName?: string;
  playerMode?: 'guest' | 'nostr';
  /** 1-based level/region reached (gamestr-wide `level` discovery tag). */
  level?: number;
  /** Explicit play URL for the `r`/`source` tags — the claim server passes its
   *  configured public URL; the browser client derives it from `location`. */
  siteUrl?: string;
  /** Bitcoin chain tip when the run ended — flavour stamped onto the event. */
  btcBlock?: number;
  /** BTC price in US cents when the run ended. */
  btcUsdCents?: number;
}

/** The human-readable line gamestr renders as the event body (their spec wants
 *  a message here, not data — the run's numbers all live in tags). */
function scoreMessage(summary: RunSummary, level: number, playerName?: string): string {
  const rider = playerName ?? 'A fren';
  const km = (summary.distanceM / 1000).toFixed(1);
  if (summary.endedBy === 'finish') {
    return `${rider} finished the grand tour — ${summary.score} points over ${km} km on ${GAME_TITLE}!`;
  }
  return `${rider} scored ${summary.score} points over ${km} km on ${GAME_TITLE} (level ${level}).`;
}

/**
 * Shape a run into an unsigned kind-30762 gamestr score event, following the
 * gamestr score-event spec: `d` is `game-id:player-pubkey:level` (addressable —
 * a player's later run at the same level REPLACES this event on relays, so the
 * claim service only publishes improvements), `content` is a human-readable
 * message, and the run's data rides in tags. Signing/publishing lives in
 * nostr.ts / server/index.ts.
 */
export function buildScoreEvent(summary: RunSummary, playerPubkey = 'guest', opts: ScoreEventOptions = {}): {
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
} {
  const siteUrl = opts.siteUrl ?? gameUrl();
  const source = opts.siteUrl ? hostOf(opts.siteUrl) : gameSource();
  const level = opts.level ?? 1;
  const tags = [
    ['d', `${GAME_ID}:${playerPubkey}:${level}`],
    ['game', GAME_ID],
    ['score', String(summary.score)],
    ['p', playerPubkey],
    ['state', 'active'],
    ['distance', String(summary.distanceM)],
    ['roses', String(summary.roses)],
    ['overtakes', String(summary.overtakes)],
    ['crashes', String(summary.crashes)],
    ['duration', String(summary.durationS)],
    ['top_speed_kph', String(summary.topSpeedKph)],
    ['ended_by', summary.endedBy],
    // Gamestr-wide discovery tags: boards render any game's event from these
    // without game-specific knowledge.
    ['title', GAME_TITLE],
    ['level', String(level)],
    ['r', siteUrl],
    ['source', source],
    ['platform', 'web'],
    ['t', 'arcade'],
    ['t', 'racer'],
    ['t', GAME_ID],
  ];
  if (opts.runId) tags.push(['run_id', opts.runId]);
  if (opts.playerName) tags.push(['player', opts.playerName], ['playerName', opts.playerName]);
  if (opts.playerMode) tags.push(['playerMode', opts.playerMode]);
  if (opts.btcBlock) tags.push(['btc_block', String(opts.btcBlock)]);
  if (opts.btcUsdCents) tags.push(['btc_usd_cents', String(opts.btcUsdCents)]);
  return {
    kind: SCORE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: scoreMessage(summary, level, opts.playerName),
    tags,
  };
}
