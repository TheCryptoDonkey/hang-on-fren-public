// Napplet replacement for ../bitcoin.ts. Napplets have no direct network
// access, so runs carry no chain-tip or price flavour.
import type { BtcSnapshot } from '../bitcoin.js';

export type { BtcSnapshot };

export async function fetchBtcSnapshot(): Promise<BtcSnapshot> {
  return {};
}
