import { loadPack } from './asset-url.js';
import { loadKv } from './kv.js';

const loading = document.getElementById('napplet-loading');
await Promise.all([loadKv(), loadPack()]);
loading?.remove();
