// Napplet entry point. Saved state has to be in memory before any game module
// reads it, and modules evaluate in import order within the single bundle, so
// the top-level await in ./preload.ts holds back ../main.ts until it resolves.
import './preload.js';
import '../main.js';
