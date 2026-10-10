import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { RunSummary } from './scoring.js';

const handoff = vi.hoisted(() => ({ consume: vi.fn() }));
vi.mock('./arcade-handoff.js', () => ({ consumeArcadeHandoff: handoff.consume }));
const summary = { score: 100, distanceM: 100, durationS: 10, roses: 0, overtakes: 0,
  crashes: 0, topSpeedKph: 80, drifts: 0, fuel: 0, nearMisses: 0,
  bestRoseStreak: 0, bestDriftS: 0, endedBy: 'time' } as RunSummary;
const options = { runId: 'private-test-run', level: 1, startedAt: Date.now() - 10_000,
  finishedAt: Date.now(), endedBy: 'time' as const };

beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('location', { origin: 'https://hang-on-fren.playechoseven.com' });
  vi.stubGlobal('window', {});
  vi.stubGlobal('WebSocket', undefined);
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === 'POST'
    ? new Response(JSON.stringify({ ok: true, published: { ok: 1, total: 1 } }))
    : new Response('', { headers: { date: new Date().toUTCString() } })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function select(signEvent: (template: Parameters<typeof finalizeEvent>[0]) => Promise<unknown>, key = generateSecretKey(), canSign = true) {
  handoff.consume.mockResolvedValue({ pubkey: getPublicKey(key), method: 'arcade',
    signer: { capabilities: { canSignEvents: canSign }, signEvent, close: async () => undefined } });
  const auth = await import('./nostr.js');
  await auth.restoreIdentity();
  return auth;
}
function postCount() {
  return vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST').length;
}

describe('personal score signing', () => {
  it('never submits a personal score as guest when its signer rejects', async () => {
    const auth = await select(async () => { throw new Error('arcade-sign-timeout'); });
    await expect(auth.submitScore(summary, options)).rejects.toThrow();
    expect(postCount()).toBe(0);
    expect(localStorage.getItem('hangonfren:guest:v1')).toBeNull();
    const { pendingPersonalScores } = await import('./score-recovery.js');
    expect(pendingPersonalScores()).toHaveLength(1);
    expect(pendingPersonalScores()[0].pubkey).toBe(auth.getIdentity().pubkey);
  });
  it('never submits an identity-only personal session as guest', async () => {
    const sign = vi.fn();
    const auth = await select(sign, generateSecretKey(), false);
    await expect(auth.submitScore(summary, options)).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
    expect(postCount()).toBe(0);
  });
  it('rejects a valid signature from another account', async () => {
    const other = generateSecretKey();
    const auth = await select(async template => finalizeEvent(template, other));
    await expect(auth.submitScore(summary, options)).rejects.toThrow();
    expect(postCount()).toBe(0);
  });
  it('rejects a changed template signed by the selected account', async () => {
    const key = generateSecretKey();
    const auth = await select(async template => finalizeEvent({ ...template, content: 'changed' }, key), key);
    await expect(auth.submitScore(summary, options)).rejects.toThrow();
    expect(postCount()).toBe(0);
  });
  it('does not publish a signature completed after logout', async () => {
    const key = generateSecretKey();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const auth = await select(async template => { entered(); await gate; return finalizeEvent(template, key); }, key);
    const claim = auth.submitScore(summary, options);
    await started; auth.useGuestMode(); release();
    await expect(claim).rejects.toThrow();
    expect(postCount()).toBe(0);
  });
  it('retains the original receipt across logout and retries only its own account', async () => {
    const key = generateSecretKey();
    let working = false;
    const auth = await select(async template => {
      if (!working) throw new Error('closed-port');
      return finalizeEvent(template, key);
    }, key);
    await expect(auth.submitScore(summary, options)).rejects.toThrow();
    const recovery = await import('./score-recovery.js');
    const receipt = recovery.pendingPersonalScores()[0];
    auth.useGuestMode();
    await expect(auth.retryPersonalScore(receipt)).rejects.toThrow();
    expect(recovery.pendingPersonalScores()[0]).toEqual(receipt);
    working = true;
    await auth.restoreIdentity();
    expect((await auth.retryPersonalScore(receipt))?.status).toBe('published');
    expect(recovery.pendingPersonalScores()).toEqual([]);
    expect(postCount()).toBe(1);
  });
  it('keeps a receipt when the service has not confirmed publication', async () => {
    const key = generateSecretKey();
    const auth = await select(async template => finalizeEvent(template, key), key);
    vi.mocked(fetch).mockImplementation(async (_url, init) => init?.method === 'POST'
      ? new Response(JSON.stringify({ ok: true, published: { ok: 0, total: 1 } }))
      : new Response(''));
    expect((await auth.submitScore(summary, options))?.status).toBe('accepted');
    expect((await import('./score-recovery.js')).pendingPersonalScores()).toHaveLength(1);
  });
  it('refuses a completed run belonging to a different selected account', async () => {
    const key = generateSecretKey();
    const auth = await select(async template => finalizeEvent(template, key), key);
    const original = { mode: 'nostr' as const, pubkey: getPublicKey(generateSecretKey()), name: 'original' };
    await expect(auth.submitScore(summary, options, original)).rejects.toThrow();
    expect(postCount()).toBe(0);
    expect((await import('./score-recovery.js')).pendingPersonalScores()[0].pubkey).toBe(original.pubkey);
  });
  it('rejects a signer that mutates and signs the supplied request', async () => {
    const key = generateSecretKey();
    const auth = await select(async template => { template.tags.push(['extra', 'changed']); return finalizeEvent(template, key); }, key);
    await expect(auth.submitScore(summary, options)).rejects.toThrow();
    expect(postCount()).toBe(0);
  });
  it('keeps explicitly chosen guest claims available', async () => {
    const auth = await import('./nostr.js');
    handoff.consume.mockResolvedValue(null);
    expect((await auth.submitScore(summary, options))?.signedAs).toBe('guest');
    const [, init] = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(init?.body)).player_mode).toBe('guest');
    expect((await import('./score-recovery.js')).pendingPersonalScores()).toEqual([]);
  });
  it('does not revive an old claim after logging back into the same session', async () => {
    const key = generateSecretKey();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const auth = await select(async template => { entered(); await gate; return finalizeEvent(template, key); }, key);
    const claim = auth.submitScore(summary, options);
    await started; auth.useGuestMode(); await auth.restoreIdentity(); release();
    await expect(claim).rejects.toThrow();
    expect(postCount()).toBe(0);
  });
  it('does not restore a handoff completed after logout', async () => {
    const auth = await import('./nostr.js');
    let release!: (value: unknown) => void;
    handoff.consume.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const restoring = auth.restoreIdentity();
    auth.useGuestMode();
    const close = vi.fn(async () => undefined);
    release({ pubkey: getPublicKey(generateSecretKey()), method: 'bunker', signer: { close } });
    expect((await restoring).mode).toBe('guest');
    expect(close).toHaveBeenCalledOnce();
  });
  it('reports an unsaved retry when browser storage fails without selecting guest', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('storage-disabled'); });
    const auth = await select(async () => { throw new Error('signer-offline'); });
    expect(auth.getIdentity().mode).toBe('nostr');
    await expect(auth.submitScore(summary, options)).rejects.toMatchObject({ saved: false });
    expect(postCount()).toBe(0);
    expect(localStorage.getItem('hangonfren:guest:v1')).toBeNull();
  });
  it('publishes a canonical personal claim under the selected account', async () => {
    const key = generateSecretKey();
    const auth = await select(async template => finalizeEvent(template, key), key);
    const result = await auth.submitScore(summary, options);
    expect(result?.signedAs).toBe('nostr');
    const [, init] = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!;
    const signed = JSON.parse(atob((init?.headers as Record<string, string>).authorization.slice(6)));
    expect(signed.pubkey).toBe(getPublicKey(key));
    expect(JSON.parse(String(init?.body)).player_mode).toBe('nostr');
  });
  it('shares a same-run retry while the original signer approval is pending', async () => {
    const key = generateSecretKey();
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const sign = vi.fn(async template => { entered(); await gate; return finalizeEvent(template, key); });
    const auth = await select(sign, key);
    const first = auth.submitScore(summary, options);
    await started;
    const receipt = (await import('./score-recovery.js')).pendingPersonalScores()[0];
    const retry = auth.retryPersonalScore(receipt);
    release();
    const results = await Promise.all([first, retry]);
    expect(sign).toHaveBeenCalledOnce();
    expect(postCount()).toBe(1);
    expect(results[0]).toEqual(results[1]);
    expect((await import('./score-recovery.js')).pendingPersonalScores()).toEqual([]);
  });
  it('shares a same-run retry while its first claim response is pending', async () => {
    const key = generateSecretKey();
    const sign = vi.fn(async template => finalizeEvent(template, key));
    const auth = await select(sign, key);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') return new Response('');
      entered(); await gate;
      return new Response(JSON.stringify({ ok: true, published: { ok: 1, total: 1 } }));
    });
    const first = auth.submitScore(summary, options);
    await started;
    const receipt = (await import('./score-recovery.js')).pendingPersonalScores()[0];
    const retry = auth.retryPersonalScore(receipt);
    release(); await Promise.all([first, retry]);
    expect(sign).toHaveBeenCalledOnce();
    expect(postCount()).toBe(1);
  });

  it('bounds a stalled clock request and still submits the saved run', async () => {
    vi.useFakeTimers();
    const key = generateSecretKey();
    const auth = await select(async template => finalizeEvent(template, key), key);
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') { signal = init?.signal ?? undefined; return new Promise<Response>(() => {}); }
      return new Response(JSON.stringify({ ok: true, published: { ok: 1, total: 1 } }));
    });
    const first = auth.submitScore(summary, options);
    await vi.advanceTimersByTimeAsync(4200);
    expect(signal?.aborted).toBe(true);
    expect((await first)?.status).toBe('published');
    expect(auth.personalScoreIsPending(getPublicKey(key), options.runId)).toBe(false);
  });
  it('releases a stalled claim for explicit retry without losing its receipt', async () => {
    vi.useFakeTimers();
    const key = generateSecretKey();
    const auth = await select(async template => finalizeEvent(template, key), key);
    let entered!: () => void, signal: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') return new Response('');
      signal = init.signal ?? undefined; entered(); return new Promise<Response>(() => {});
    });
    const first = auth.submitScore(summary, options); await started;
    expect(auth.personalScoreIsPending(getPublicKey(key), options.runId)).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    expect(await first).toBeNull(); expect(signal?.aborted).toBe(true);
    expect(auth.personalScoreIsPending(getPublicKey(key), options.runId)).toBe(false);
    const receipt = (await import('./score-recovery.js')).pendingPersonalScores()[0];
    expect(receipt.pubkey).toBe(getPublicKey(key));
    vi.mocked(fetch).mockImplementation(async (_url, init) => init?.method === 'POST'
      ? new Response(JSON.stringify({ ok: true, published: { ok: 1, total: 1 } })) : new Response(''));
    expect((await auth.retryPersonalScore(receipt))?.status).toBe('published');
    expect(postCount()).toBe(2);
  });
  it('bounds a stalled response body as well as the claim headers', async () => {
    vi.useFakeTimers();
    const key = generateSecretKey();
    const auth = await select(async template => finalizeEvent(template, key), key);
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') return new Response('');
      return { json: async () => { entered(); return new Promise(() => {}); } } as unknown as Response;
    });
    const first = auth.submitScore(summary, options); await started;
    await vi.advanceTimersByTimeAsync(15000);
    expect(await first).toBeNull();
    expect(auth.personalScoreIsPending(getPublicKey(key), options.runId)).toBe(false);
    expect((await import('./score-recovery.js')).pendingPersonalScores()).toHaveLength(1);
  });
  it('pins the public run details before asynchronous clock work', async () => {
    const key = generateSecretKey();
    const auth = await select(async template => finalizeEvent(template, key), key);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') { await gate; return new Response(''); }
      return new Response(JSON.stringify({ ok: true, published: { ok: 1, total: 1 } }));
    });
    const run = { ...summary }, details = { ...options };
    const first = auth.submitScore(run, details);
    run.score = 999; details.runId = 'different-run'; release();
    expect((await first)?.status).toBe('published');
    const [, init] = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(init?.body))).toMatchObject({ score: summary.score, run_id: options.runId });
    expect((await import('./score-recovery.js')).pendingPersonalScores()).toEqual([]);
  });

});
