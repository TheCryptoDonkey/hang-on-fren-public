import { describe, expect, it } from 'vitest';
import { DEFAULT_READ_RELAYS, DEFAULT_WRITE_RELAYS, GAMESTR_RELAYS } from './relays.js';

describe('relay policy', () => {
  it('publishes and reads live scores on the production Gamestr relay', () => {
    expect(GAMESTR_RELAYS).toEqual(['wss://main.relay.gamestr.io']);
    expect(DEFAULT_WRITE_RELAYS).toEqual(expect.arrayContaining([...GAMESTR_RELAYS]));
    expect(DEFAULT_READ_RELAYS).toEqual(expect.arrayContaining([...GAMESTR_RELAYS]));
    expect(DEFAULT_WRITE_RELAYS).not.toContain('wss://test.relay.gamestr.io');
    expect(DEFAULT_READ_RELAYS).not.toContain('wss://test.relay.gamestr.io');
  });
});
