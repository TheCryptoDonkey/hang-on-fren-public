import { describe, expect, it } from 'vitest';
import type { DriveInput } from './road.js';
import { KeyboardDriveState } from './keyboard-drive.js';

function read(state: KeyboardDriveState): DriveInput {
  const input: DriveInput = { left: false, right: false, throttle: true, brake: false };
  state.applyTo(input);
  input.throttle = !input.brake;
  return input;
}

describe('KeyboardDriveState', () => {
  it('releases a direction by physical code even when a key value could have changed', () => {
    const keyboard = new KeyboardDriveState();
    keyboard.press('ArrowLeft');
    expect(read(keyboard).left).toBe(true);

    keyboard.release('ArrowLeft');
    expect(read(keyboard)).toMatchObject({ left: false, right: false });
  });

  it('replaces a stale opposite direction on the next intentional turn', () => {
    const keyboard = new KeyboardDriveState();
    keyboard.press('KeyA'); // imagine its key-up was swallowed
    keyboard.press('ArrowRight');
    expect(read(keyboard)).toMatchObject({ left: false, right: true });

    keyboard.release('ArrowRight');
    expect(read(keyboard)).toMatchObject({ left: false, right: false });
  });

  it('reports neutral steering as soon as the last direction code is released', () => {
    const keyboard = new KeyboardDriveState();
    keyboard.press('ArrowLeft');
    expect(keyboard.direction()).toBe(-1);
    keyboard.release('ArrowLeft');
    expect(keyboard.direction()).toBe(0);
  });

  it('clears every held driving control at a lifecycle boundary', () => {
    const keyboard = new KeyboardDriveState();
    keyboard.press('ArrowLeft');
    keyboard.press('Space');
    keyboard.clear();
    expect(read(keyboard)).toEqual({ left: false, right: false, throttle: true, brake: false });
  });

  it('ignores keys that are not driving controls', () => {
    const keyboard = new KeyboardDriveState();
    expect(keyboard.press('KeyM')).toBe(false);
    expect(read(keyboard)).toEqual({ left: false, right: false, throttle: true, brake: false });
  });
});
