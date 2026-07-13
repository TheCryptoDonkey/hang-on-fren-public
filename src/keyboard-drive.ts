import type { DriveInput } from './road.js';

type DriveAction = 'left' | 'right' | 'brake';

const CODE_ACTION: Readonly<Record<string, DriveAction>> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowDown: 'brake',
  KeyS: 'brake',
  Space: 'brake',
};

export function isSteeringCode(code: string): boolean {
  const action = CODE_ACTION[code];
  return action === 'left' || action === 'right';
}

/**
 * Keyboard state for driving, keyed by physical `KeyboardEvent.code` rather
 * than the layout-dependent `event.key`. Browsers can report a different key
 * value on key-up after a modifier/layout change; using `code` guarantees that
 * the release removes the same entry that the press added.
 *
 * Direction changes are mutually exclusive. If a key-up was swallowed, the
 * next intentional turn replaces that stale direction instead of combining
 * with it and reappearing when the newer key is released.
 */
export class KeyboardDriveState {
  private held = new Set<string>();

  press(code: string): boolean {
    const action = CODE_ACTION[code];
    if (!action) return false;
    if (action === 'left') this.dropAction('right');
    else if (action === 'right') this.dropAction('left');
    this.held.add(code);
    return true;
  }

  release(code: string): boolean {
    if (!CODE_ACTION[code]) return false;
    this.held.delete(code);
    return true;
  }

  clear(): void {
    this.held.clear();
  }

  applyTo(input: DriveInput): void {
    input.left = this.hasAction('left');
    input.right = this.hasAction('right');
    input.brake = this.hasAction('brake');
  }

  direction(): -1 | 0 | 1 {
    return (this.hasAction('right') ? 1 : 0) - (this.hasAction('left') ? 1 : 0) as -1 | 0 | 1;
  }

  private hasAction(action: DriveAction): boolean {
    for (const code of this.held) if (CODE_ACTION[code] === action) return true;
    return false;
  }

  private dropAction(action: DriveAction): void {
    for (const code of this.held) if (CODE_ACTION[code] === action) this.held.delete(code);
  }
}
