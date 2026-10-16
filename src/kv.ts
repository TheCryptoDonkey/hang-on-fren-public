// Durable key-value seam for saved settings, boards and progress. The web build
// reads browser localStorage at call time (callers keep their own try/catch,
// since the property access itself can throw in private modes); the napplet
// build swaps this module for one backed by the shell's storage NAP.
export const kv = {
  getItem: (key: string): string | null => localStorage.getItem(key),
  setItem: (key: string, value: string): void => localStorage.setItem(key, value),
  removeItem: (key: string): void => localStorage.removeItem(key),
};
