import { randomUUID, webcrypto } from 'node:crypto';
import { MessageChannel as NodeMessageChannel } from 'node:worker_threads';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import { consumeArcadeHandoff } from './arcade-handoff.js';

const SECRET = new Uint8Array(32).fill(11);
const PUBKEY = getPublicKey(SECRET);

Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), randomUUID, subtle: webcrypto.subtle },
});

function tokenFor(target: string, channel: string): string {
  const event = finalizeEvent({
    kind: 21236,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [
      ['challenge', 'c'.repeat(64)],
      ['origin', 'https://arcade.600.wtf'],
      ['app', '600 Billion Arcade'],
    ],
  }, SECRET);
  return Buffer.from(JSON.stringify({
    v: 1,
    game: 'hangonfren',
    target,
    channel,
    canSign: true,
    profile: { name: 'Arcade Rider' },
    event,
  })).toString('base64url');
}

describe('600B arcade handoff', () => {
  it('uses the live arcade session for rider identity and signing', async () => {
    const channelId = 'test-channel-1234567890';
    const target = 'https://hang-on-fren.playechoseven.com';
    const token = tokenFor(target, channelId);
    let replacedUrl = '';
    const opener = {
      postMessage(message: unknown, origin: string, ports: MessagePort[]) {
        expect(message).toEqual({ protocol: 'gamestr-auth-v1', type: 'connect', channel: channelId });
        expect(origin).toBe('https://arcade.600.wtf');
        const port = ports[0];
        port.onmessage = requestMessage => {
          const request = requestMessage.data as { protocol: string; type: string; id: string; event: Parameters<typeof finalizeEvent>[0] };
          if (request.type !== 'sign') return;
          port.postMessage({
            protocol: request.protocol,
            type: 'result',
            id: request.id,
            ok: true,
            event: finalizeEvent(request.event, SECRET),
          });
        };
        port.start();
        port.postMessage({ protocol: 'gamestr-auth-v1', type: 'connected' });
      },
    };
    const fakeWindow = { opener, setTimeout, clearTimeout };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { origin: target, pathname: '/', search: '', hash: `#gamestr-auth=${token}` },
    });
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      value: { replaceState: (_state: unknown, _title: string, url: string) => { replacedUrl = url; } },
    });
    Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, value: NodeMessageChannel });

    const session = await consumeArcadeHandoff('hangonfren');
    expect(session?.pubkey).toBe(PUBKEY);
    expect(session?.displayName).toBe('Arcade Rider');
    expect(session?.signer.capabilities.canSignEvents).toBe(true);
    expect(replacedUrl).toBe('/');
    expect(fakeWindow.opener).toBeNull();

    const signed = await session!.signer.signEvent({ kind: 27235, created_at: 1_800_000_000, content: '', tags: [['u', `${target}/api/claim`]] });
    expect(signed.pubkey).toBe(PUBKEY);
    expect(signed.kind).toBe(27235);
    await session!.signer.close();
  });
});
