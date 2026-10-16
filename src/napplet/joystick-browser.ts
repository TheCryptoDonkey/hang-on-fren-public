// Napplet replacement for @forgesworn/joystick-protocol/browser. The phone
// controller pairs through the gamestr arcade window (window.opener and
// location.origin messaging), neither of which exists in a napplet sandbox;
// keyboard, touch and any shell-provided gamepad still work.
export function installArcadeGameController(_options: unknown): () => void {
  return () => undefined;
}
