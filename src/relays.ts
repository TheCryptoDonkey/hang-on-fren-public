// Shared relay policy for the browser, claim service, and score migration.
// Keep Gamestr's production and test relays together so endpoint changes
// cannot drift between live publishing and historic-score reconciliation.

export const GAMESTR_RELAYS = [
  'wss://main.relay.gamestr.io',
  'wss://test.relay.gamestr.io',
] as const;

export const DEFAULT_WRITE_RELAYS = [
  ...GAMESTR_RELAYS,
  'wss://relay.trotters.cc',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://relay.ditto.pub',
] as const;

export const DEFAULT_READ_RELAYS = [
  ...GAMESTR_RELAYS,
  'wss://relay.trotters.cc',
  'wss://nos.lol',
  'wss://relay.damus.io',
] as const;
