// Value-for-value interstitial: shown between the title screen and the run.
// Honour-system, same as take-me-to-your-ledger — a plain lightning address
// gives no payment callback, so the rider self-confirms with I PAID. Patrons
// ride blessed for 24 hours: HODL shield armed and nitro lit at launch.

const LIGHTNING_ADDRESS = 'profusemeat89@walletofsatoshi.com';
const STORE_KEY = 'hangonfren:v4v:v1';

interface V4vState {
  declines: number;
  paidAt: number;
}

function loadState(): V4vState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { declines: 0, paidAt: 0, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { declines: 0, paidAt: 0 };
}

function saveState(s: V4vState): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const NUDGES = [
  'This Vespa runs on sats. Patrons ride blessed: HODL shield and nitro at launch.',
  'Free ride logged. The donkey is counting. Patrons launch shielded.',
  'Still free. The road remembers — and blesses its patrons.',
  'Sats are voluntary. The blessing (shield + nitro at launch) is not subtle.',
];

// Previous donors do not get away with it either.
const RETURNING_NUDGES = [
  'You paid before. The donkey remembers. Your blessing holds for 24 hours.',
  'Generosity noted. Ride blessed: HODL shield armed, nitro warm.',
  'One sat is a signal. Two is a habit. Bless you either way, fren.',
];

let onClosed: (() => void) | null = null;
let onPaidHook: (() => void) | null = null;

function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

export function isV4vOpen(): boolean {
  return !el('v4v-overlay').hidden;
}

/** The ask fires before every run from the title — nobody gets away with it. */
export function shouldAskV4v(): boolean {
  return true;
}

/** Patrons ride blessed for 24 hours after paying: HODL shield + nitro at launch. */
export function isBlessed(): boolean {
  const s = loadState();
  return s.paidAt > 0 && Date.now() - s.paidAt < 24 * 60 * 60 * 1000;
}

export function openV4v(closed: () => void): void {
  onClosed = closed;
  const s = loadState();
  el('v4v-nudge').textContent = s.paidAt
    ? RETURNING_NUDGES[Math.min(s.declines, RETURNING_NUDGES.length - 1)]
    : NUDGES[Math.min(s.declines, NUDGES.length - 1)];
  el('v4v-ask').hidden = false;
  el('v4v-thanks').hidden = true;
  el('v4v-overlay').hidden = false;
}

function closeV4v(): void {
  el('v4v-overlay').hidden = true;
  const cb = onClosed;
  onClosed = null;
  cb?.();
}

export function initV4v(hooks?: { onPaid?: () => void }): void {
  onPaidHook = hooks?.onPaid ?? null;
  el('v4v-addr').addEventListener('click', () => {
    void navigator.clipboard?.writeText(LIGHTNING_ADDRESS).then(() => {
      const label = el('v4v-addr').querySelector('.donate-copy-label');
      if (label) {
        label.textContent = 'COPIED!';
        setTimeout(() => { label.textContent = 'TAP TO COPY · OPENS WALLET'; }, 1400);
      }
    }).catch(() => undefined);
    // Same gesture also offers the wallet deep link.
    window.location.href = `lightning:${LIGHTNING_ADDRESS}`;
  });
  el('v4v-paid').addEventListener('click', () => {
    const s = loadState();
    s.paidAt = Date.now();
    s.declines = 0;
    saveState(s);
    el('v4v-ask').hidden = true;
    el('v4v-thanks').hidden = false;
    onPaidHook?.();
  });
  el('v4v-later').addEventListener('click', () => {
    const s = loadState();
    s.declines++;
    saveState(s);
    closeV4v();
  });
  el('v4v-start').addEventListener('click', closeV4v);
  document.addEventListener('keydown', (e) => {
    if (!isV4vOpen()) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      (el('v4v-thanks').hidden ? el('v4v-later') : el('v4v-start')).click();
    } else if (e.key === 'Enter' && !el('v4v-thanks').hidden) {
      e.stopPropagation();
      el('v4v-start').click();
    }
  }, true);
}
