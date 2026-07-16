// Sprite registry. Generated art (gpt-image) is loaded, alpha-floored to kill
// the soft halo gpt-image leaves around "transparent" sprites, and trimmed to
// its bounding box so we know exactly where the wheels/base sit. Every sprite
// has a code-drawn fallback so the game renders even with no art on disk.

import { assetUrl } from './asset-url.js';

export interface SpriteImage {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

const ALPHA_FLOOR = 64; // pixels below this alpha are erased (removes the glow)

// `readback` opts the temporary canvas into a CPU-backed buffer so the
// getImageData() call in loadTrimmed doesn't pay a GPU→CPU readback per sprite
// (103 of them at boot). The trimmed OUTPUT canvas must stay GPU-backed — it's
// blitted every frame — so it is created without this flag.
function makeCanvas(
  w: number,
  h: number,
  readback = false,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d', readback ? { willReadFrequently: true } : undefined)!;
  return { canvas, ctx };
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  const img = await new Promise<HTMLImageElement | null>(res => {
    const el = new Image();
    el.onload = () => res(el);
    el.onerror = () => res(null);
    el.src = url;
  });
  if (!img || !img.width) return null;
  // decode() rasterises off the main thread where supported — without it the
  // first drawImage of a megapixel backdrop pays a synchronous decode.
  await img.decode().catch(() => undefined);
  return img;
}

/** Full-bleed art (backdrops, panoramas) is opaque edge to edge: the alpha
 *  trim below would be a no-op that still costs a full getImageData readback
 *  and a per-pixel JS scan — for a 1280×853 horizon that is real main-thread
 *  time, ×15 panoramas, exactly when the game is starting. Draw it straight
 *  onto a canvas and keep every pixel. */
async function loadFullBleed(url: string): Promise<SpriteImage | null> {
  const img = await loadImage(url);
  if (!img) return null;
  const { canvas, ctx } = makeCanvas(img.width, img.height);
  ctx.drawImage(img, 0, 0);
  return { canvas, w: img.width, h: img.height };
}

/** Art that needs no alpha trim: name prefixes of full-bleed rectangles. */
function isFullBleed(name: string): boolean {
  return name.startsWith('horizon-') || name === 'title-art';
}

/** Load an image, erase sub-floor alpha, and trim to the opaque bounding box. */
async function loadTrimmed(url: string): Promise<SpriteImage | null> {
  const img = await loadImage(url);
  if (!img) return null;

  const { canvas, ctx } = makeCanvas(img.width, img.height, true);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const a = px[(y * canvas.width + x) * 4 + 3];
      if (a < ALPHA_FLOOR) {
        px[(y * canvas.width + x) * 4 + 3] = 0;
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null; // nothing opaque
  ctx.putImageData(data, 0, 0);

  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const trimmed = makeCanvas(tw, th);
  trimmed.ctx.drawImage(canvas, minX, minY, tw, th, 0, 0, tw, th);
  return { canvas: trimmed.canvas, w: tw, h: th };
}

function bake(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): SpriteImage {
  const { canvas, ctx } = makeCanvas(w, h);
  draw(ctx);
  return { canvas, w, h };
}

// ---- code-drawn fallbacks --------------------------------------------------

function fallbackPalm(): SpriteImage {
  return bake(120, 220, ctx => {
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(54, 70, 12, 150);
    ctx.fillStyle = '#2e7d4f';
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(60, 66, 48, 16, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#1f5c3a';
    ctx.beginPath();
    ctx.arc(60, 64, 16, 0, Math.PI * 2);
    ctx.fill();
  });
}

function fallbackCypress(): SpriteImage {
  return bake(70, 210, ctx => {
    ctx.fillStyle = '#1f4d2e';
    ctx.beginPath();
    ctx.moveTo(35, 4);
    ctx.quadraticCurveTo(64, 120, 46, 206);
    ctx.lineTo(24, 206);
    ctx.quadraticCurveTo(6, 120, 35, 4);
    ctx.fill();
  });
}

function fallbackVilla(): SpriteImage {
  return bake(190, 160, ctx => {
    ctx.fillStyle = '#f4e2c8';
    ctx.fillRect(20, 60, 150, 100);
    ctx.fillStyle = '#c65f4a';
    ctx.beginPath();
    ctx.moveTo(10, 62);
    ctx.lineTo(95, 20);
    ctx.lineTo(180, 62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3a5f7a';
    for (let i = 0; i < 3; i += 1) ctx.fillRect(38 + i * 46, 86, 26, 40);
  });
}

// Umbrella / stone pine — the flat-topped Italian roadside pine (BULL/MOON legs).
function fallbackPine(): SpriteImage {
  return bake(160, 210, ctx => {
    ctx.fillStyle = '#5a3d22';
    ctx.fillRect(74, 96, 12, 114);
    // broad flattened canopy from overlapping dark-green blobs
    const blobs: [number, number, number, number][] = [
      [80, 70, 78, 30], [50, 80, 42, 24], [110, 80, 42, 24], [80, 56, 46, 22], [80, 88, 60, 20],
    ];
    ctx.fillStyle = '#20502f';
    for (const [x, y, rx, ry] of blobs) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#2f6b3e';
    ctx.beginPath(); ctx.ellipse(72, 62, 44, 16, 0, 0, Math.PI * 2); ctx.fill();
  });
}

// Pink flowering tree — spring accent for the NEW DAWN leg.
function fallbackBlossom(): SpriteImage {
  return bake(140, 200, ctx => {
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(64, 110, 12, 90);
    ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(70, 130); ctx.lineTo(46, 96); ctx.moveTo(70, 130); ctx.lineTo(96, 100); ctx.stroke();
    const puffs: [number, number, number][] = [[70, 70, 40], [44, 84, 26], [96, 82, 28], [70, 50, 28]];
    ctx.fillStyle = '#f2a6c4';
    for (const [x, y, r] of puffs) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#ffd0e2';
    for (let i = 0; i < 22; i += 1) { ctx.beginPath(); ctx.arc(38 + (i * 37 % 66), 44 + (i * 53 % 60), 4, 0, Math.PI * 2); ctx.fill(); }
  });
}

// Roadside lamp — night accent (TO THE MOON leg). Bulb reads as lit in the dark.
function fallbackLamp(): SpriteImage {
  return bake(64, 220, ctx => {
    ctx.fillStyle = '#2c3038';
    ctx.fillRect(28, 40, 8, 180); // pole
    ctx.fillRect(16, 214, 32, 6); // base
    ctx.fillStyle = '#3a4049';
    ctx.beginPath(); ctx.moveTo(20, 40); ctx.lineTo(44, 40); ctx.lineTo(40, 22); ctx.lineTo(24, 22); ctx.closePath(); ctx.fill(); // lantern housing
    // warm bulb + halo
    ctx.fillStyle = 'rgba(255,220,140,0.5)';
    ctx.beginPath(); ctx.arc(32, 32, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(25, 26, 14, 12);
  });
}

// Café sun-parasol — la-dolce-vita accent for the BULL RUN leg.
function fallbackParasol(): SpriteImage {
  return bake(150, 180, ctx => {
    ctx.fillStyle = '#8a6a45';
    ctx.fillRect(72, 70, 6, 110); // pole
    // striped dome
    const cx = 75, cy = 70, r = 62;
    const cols = ['#e8543f', '#f6ead0'];
    for (let i = 0; i < 8; i += 1) {
      ctx.fillStyle = cols[i % 2];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, Math.PI + (i / 8) * Math.PI, Math.PI + ((i + 1) / 8) * Math.PI);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#c94b3c';
    ctx.fillRect(cx - r, cy - 2, r * 2, 5); // rim
  });
}

// Low flowering bush — verge accent for the rose-strewn day legs (BEAR/DAWN).
function fallbackFlowers(): SpriteImage {
  return bake(130, 90, ctx => {
    ctx.fillStyle = '#2f7d4a';
    ctx.beginPath(); ctx.ellipse(65, 66, 56, 24, 0, 0, Math.PI * 2); ctx.fill();
    const cols = ['#e5344e', '#ff6b81', '#ffd76b', '#ffffff'];
    for (let i = 0; i < 16; i += 1) {
      ctx.fillStyle = cols[i % cols.length];
      const x = 18 + (i * 41 % 94);
      const y = 40 + (i * 27 % 30);
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
  });
}

function fallbackSign(): SpriteImage {
  return bake(120, 150, ctx => {
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(54, 70, 12, 80);
    ctx.fillStyle = '#e8734f';
    ctx.fillRect(14, 14, 92, 58);
    ctx.fillStyle = '#fff3e0';
    ctx.fillRect(22, 22, 76, 42);
  });
}

// Big roadside hoarding for the 600B meme billboards: a wide dark panel on two
// stout legs. Always code-drawn (no art file), so the face rect below is a
// reliable target for the billboard variants to composite text/art onto.
const BILLBOARD_FACE = { x: 16, y: 14, w: 348, h: 176 } as const;

function fallbackBillboard(): SpriteImage {
  return bake(380, 300, ctx => {
    // steel legs + cross braces — deliberately chunky so the hoarding remains
    // grounded and readable when it flashes past at speed.
    ctx.fillStyle = '#343c43';
    ctx.fillRect(54, 194, 22, 106);
    ctx.fillRect(304, 194, 22, 106);
    ctx.fillStyle = '#56616a';
    ctx.fillRect(60, 194, 6, 106);
    ctx.fillRect(310, 194, 6, 106);
    ctx.save();
    ctx.translate(64, 246);
    ctx.rotate(-0.18);
    ctx.fillRect(0, -5, 252, 10);
    ctx.restore();
    // deep gold-edged cabinet frame and inset face.
    ctx.fillStyle = '#111820';
    ctx.fillRect(4, 2, 372, 202);
    ctx.fillStyle = '#d89b32';
    ctx.fillRect(8, 6, 364, 194);
    ctx.fillStyle = '#25313a';
    ctx.fillRect(12, 10, 356, 186);
    ctx.fillStyle = '#0b1620';
    const f = BILLBOARD_FACE;
    ctx.fillRect(f.x, f.y, f.w, f.h);
    // marquee bulbs survive down-scaling better than another hairline border.
    for (let i = 0; i < 12; i += 1) {
      const x = 22 + i * 30;
      ctx.fillStyle = i % 2 ? '#ff5a42' : '#ffd76b';
      ctx.beginPath();
      ctx.arc(x, 9, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, 195, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// Coconut palm — the TROPICO BAY tree: a curved trunk with a burst of fronds and
// a clutch of coconuts at the crown.
function fallbackCoconut(): SpriteImage {
  return bake(150, 230, ctx => {
    ctx.strokeStyle = '#8a6238';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(78, 226);
    ctx.quadraticCurveTo(60, 130, 70, 66); // gentle lean
    ctx.stroke();
    // drooping fronds
    ctx.strokeStyle = '#2f8f57';
    ctx.lineWidth = 9;
    const crown: [number, number] = [70, 62];
    const tips: [number, number][] = [[8, 40], [30, 12], [70, 6], [112, 16], [138, 46], [118, 78]];
    for (const [tx, ty] of tips) {
      ctx.beginPath();
      ctx.moveTo(crown[0], crown[1]);
      ctx.quadraticCurveTo((crown[0] + tx) / 2, ty - 14, tx, ty);
      ctx.stroke();
    }
    // coconuts
    ctx.fillStyle = '#6b4a2b';
    for (const [cx, cy] of [[66, 70], [80, 74], [72, 82]] as [number, number][]) {
      ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
    }
  });
}

// Thatched tiki beach bar — the TROPICO BAY landmark.
function fallbackBeachHut(): SpriteImage {
  return bake(200, 160, ctx => {
    // sand-coloured base + posts
    ctx.fillStyle = '#e9d3a0';
    ctx.fillRect(30, 78, 140, 74);
    ctx.fillStyle = '#b98a52';
    ctx.fillRect(38, 86, 12, 66);
    ctx.fillRect(150, 86, 12, 66);
    // open counter shade
    ctx.fillStyle = '#3aa0a0';
    ctx.fillRect(48, 96, 104, 26);
    // thatched roof
    ctx.fillStyle = '#c89a5a';
    ctx.beginPath();
    ctx.moveTo(12, 82);
    ctx.lineTo(100, 20);
    ctx.lineTo(188, 82);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#9c7440';
    ctx.lineWidth = 3;
    for (let i = 1; i < 6; i += 1) { ctx.beginPath(); ctx.moveTo(12 + i * 15, 82 - i * 2); ctx.lineTo(188 - i * 15, 82 - i * 2); ctx.stroke(); }
  });
}

// Snow-dusted fir — the ALPINE PASS tree.
function fallbackFir(): SpriteImage {
  return bake(150, 230, ctx => {
    ctx.fillStyle = '#5a3d22';
    ctx.fillRect(69, 190, 12, 40);
    const tiers: [number, number, number][] = [[75, 70, 40], [75, 118, 54], [75, 168, 66]];
    for (const [cx, cy, half] of tiers) {
      ctx.fillStyle = '#2c6b48';
      ctx.beginPath(); ctx.moveTo(cx, cy - 44); ctx.lineTo(cx - half, cy + 20); ctx.lineTo(cx + half, cy + 20); ctx.closePath(); ctx.fill();
      // snow cap on each tier
      ctx.fillStyle = '#eef4fb';
      ctx.beginPath(); ctx.moveTo(cx, cy - 44); ctx.lineTo(cx - half * 0.42, cy - 12); ctx.lineTo(cx + half * 0.42, cy - 12); ctx.closePath(); ctx.fill();
    }
  });
}

// Timber chalet with a snow-laden roof — the ALPINE PASS landmark.
function fallbackChalet(): SpriteImage {
  return bake(200, 160, ctx => {
    ctx.fillStyle = '#8a5a34';
    ctx.fillRect(30, 66, 140, 90);
    // log courses
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    for (let y = 78; y < 156; y += 14) { ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(170, y); ctx.stroke(); }
    // windows with warm glow
    ctx.fillStyle = '#ffe6a6';
    ctx.fillRect(56, 92, 30, 30);
    ctx.fillRect(114, 92, 30, 30);
    ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = 3;
    ctx.strokeRect(56, 92, 30, 30); ctx.strokeRect(114, 92, 30, 30);
    // deep snow-laden pitched roof
    ctx.fillStyle = '#f4f8fd';
    ctx.beginPath();
    ctx.moveTo(14, 72);
    ctx.lineTo(100, 14);
    ctx.lineTo(186, 72);
    ctx.lineTo(170, 72);
    ctx.lineTo(100, 30);
    ctx.lineTo(30, 72);
    ctx.closePath();
    ctx.fill();
  });
}

// --- regions 4–9 scenery fallbacks (gpt-image is the shipped look) ----------

// Desert saguaro cactus.
function fallbackCactus(): SpriteImage {
  return bake(140, 220, ctx => {
    ctx.fillStyle = '#3f8f4a';
    ctx.strokeStyle = '#3f8f4a';
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(70, 216); ctx.lineTo(70, 40); ctx.stroke(); // trunk
    ctx.lineWidth = 16;
    ctx.beginPath(); ctx.moveTo(70, 120); ctx.lineTo(36, 120); ctx.lineTo(36, 78); ctx.stroke(); // left arm
    ctx.beginPath(); ctx.moveTo(70, 140); ctx.lineTo(104, 140); ctx.lineTo(104, 96); ctx.stroke(); // right arm
    ctx.fillStyle = '#2f7d3a';
    ctx.fillRect(64, 40, 12, 176); // shading rib
  });
}

// Sun-baked adobe pueblo.
function fallbackAdobe(): SpriteImage {
  return bake(200, 150, ctx => {
    ctx.fillStyle = '#c47a4a';
    ctx.beginPath();
    ctx.moveTo(24, 150); ctx.lineTo(24, 60);
    ctx.quadraticCurveTo(100, 40, 176, 60); ctx.lineTo(176, 150); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a25f36';
    for (const x of [40, 80, 120, 160]) ctx.fillRect(x, 44, 8, 18); // roof beams
    ctx.fillStyle = '#3a2418';
    ctx.fillRect(54, 88, 26, 40); ctx.fillRect(120, 88, 26, 40); // dark openings
  });
}

// Neon-sign pylon (glows against the night city).
function fallbackNeon(): SpriteImage {
  return bake(120, 220, ctx => {
    ctx.fillStyle = '#23262e'; ctx.fillRect(56, 90, 8, 130); // post
    ctx.fillStyle = 'rgba(255,64,160,0.35)'; ctx.fillRect(16, 8, 88, 80); // halo
    ctx.fillStyle = '#101018'; ctx.fillRect(24, 12, 72, 68);
    ctx.strokeStyle = '#ff3ba0'; ctx.lineWidth = 6; ctx.strokeRect(30, 20, 60, 22); // pink bar
    ctx.strokeStyle = '#3bd8ff'; ctx.lineWidth = 6; ctx.strokeRect(30, 50, 60, 22); // cyan bar
  });
}

// Night-city skyscraper with lit windows.
function fallbackSkyscraper(): SpriteImage {
  return bake(150, 240, ctx => {
    ctx.fillStyle = '#1b2233'; ctx.fillRect(30, 20, 90, 220);
    ctx.fillStyle = '#2a3350'; ctx.fillRect(30, 20, 12, 220); // edge shade
    for (let y = 34; y < 230; y += 20) {
      for (let x = 46; x < 116; x += 18) {
        ctx.fillStyle = (x + y) % 3 === 0 ? '#ffe08a' : 'rgba(120,180,255,0.5)';
        ctx.fillRect(x, y, 10, 12);
      }
    }
    ctx.fillStyle = '#ff3ba0'; ctx.fillRect(30, 16, 90, 5); // neon crown
  });
}

// Red-and-gold pagoda.
function fallbackPagoda(): SpriteImage {
  return bake(190, 200, ctx => {
    ctx.fillStyle = '#a8352a';
    ctx.fillRect(78, 120, 34, 80); // body
    const roof = (cy: number, half: number): void => {
      ctx.fillStyle = '#c8402f';
      ctx.beginPath();
      ctx.moveTo(95 - half, cy); ctx.quadraticCurveTo(95 - half * 0.5, cy - 26, 95, cy - 20);
      ctx.quadraticCurveTo(95 + half * 0.5, cy - 26, 95 + half, cy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8b23a'; ctx.fillRect(95 - half, cy - 4, half * 2, 5);
    };
    roof(120, 60); roof(88, 74); roof(52, 88);
    ctx.fillStyle = '#e8b23a'; ctx.fillRect(90, 20, 10, 16); // finial
  });
}

// Autumn maple.
function fallbackMaple(): SpriteImage {
  return bake(160, 210, ctx => {
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(74, 120, 12, 90);
    const puffs: [number, number, number, string][] = [
      [80, 74, 52, '#e8622a'], [50, 90, 34, '#d13f24'], [110, 88, 36, '#f2a02a'], [80, 52, 34, '#f2c23a'],
    ];
    for (const [x, y, r, c] of puffs) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  });
}

// Red countryside barn.
function fallbackBarn(): SpriteImage {
  return bake(200, 160, ctx => {
    ctx.fillStyle = '#b23a2e'; ctx.fillRect(30, 70, 140, 90);
    ctx.fillStyle = '#8f8f96';
    ctx.beginPath(); ctx.moveTo(20, 74); ctx.lineTo(100, 26); ctx.lineTo(180, 74); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f4ead6';
    ctx.fillRect(88, 104, 24, 56); // door
    ctx.strokeStyle = '#f4ead6'; ctx.lineWidth = 5;
    ctx.strokeRect(30, 70, 140, 90);
    ctx.beginPath(); ctx.moveTo(100, 104); ctx.lineTo(100, 160); ctx.stroke();
  });
}

// Golden pampas reeds.
function fallbackReed(): SpriteImage {
  return bake(130, 200, ctx => {
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    const stems: [number, number][] = [[50, 40], [70, 22], [90, 46], [40, 70], [98, 66]];
    for (const [tx, ty] of stems) {
      ctx.beginPath(); ctx.moveTo(65, 200); ctx.quadraticCurveTo((65 + tx) / 2, 120, tx, ty); ctx.stroke();
      ctx.fillStyle = '#efdcae';
      ctx.beginPath(); ctx.ellipse(tx, ty, 9, 22, 0, 0, Math.PI * 2); ctx.fill();
    }
  });
}

// Striped lighthouse.
function fallbackLighthouse(): SpriteImage {
  return bake(120, 230, ctx => {
    ctx.fillStyle = '#f2f2f2';
    ctx.beginPath(); ctx.moveTo(44, 210); ctx.lineTo(52, 60); ctx.lineTo(68, 60); ctx.lineTo(76, 210); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d0342c';
    for (let y = 60; y < 210; y += 40) ctx.fillRect(40, y, 44, 20);
    ctx.fillStyle = '#2c3038'; ctx.fillRect(50, 40, 20, 22); // lantern housing
    ctx.fillStyle = '#ffe08a'; ctx.fillRect(54, 44, 12, 14); // lit lantern
  });
}

// Charred dead tree.
function fallbackDeadTree(): SpriteImage {
  return bake(150, 220, ctx => {
    ctx.strokeStyle = '#1c1416'; ctx.lineWidth = 12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(74, 218); ctx.lineTo(72, 70); ctx.stroke();
    ctx.lineWidth = 7;
    const br: [number, number, number, number][] = [[72, 120, 34, 80], [72, 110, 110, 74], [72, 84, 40, 30], [72, 78, 104, 34]];
    for (const [x1, y1, x2, y2] of br) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  });
}

// --- 600B YEARS BC (prehistoric tour) fallbacks ---------------------------------

// Giant prehistoric tree fern: shaggy trunk, a crown of long arching fronds.
function fallbackFern(): SpriteImage {
  return bake(150, 210, ctx => {
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(69, 90, 14, 120);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 2;
    for (let y = 100; y < 205; y += 12) { ctx.beginPath(); ctx.moveTo(69, y); ctx.lineTo(83, y + 4); ctx.stroke(); } // fibrous rings
    ctx.strokeStyle = '#3f9f4a';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    const crown: [number, number] = [76, 88];
    const tips: [number, number][] = [[8, 60], [26, 22], [76, 8], [126, 22], [142, 60], [116, 96], [36, 96]];
    for (const [tx, ty] of tips) {
      ctx.beginPath();
      ctx.moveTo(crown[0], crown[1]);
      ctx.quadraticCurveTo((crown[0] + tx) / 2, ty - 20, tx, ty);
      ctx.stroke();
    }
    ctx.fillStyle = '#2f7d3a';
    ctx.beginPath(); ctx.arc(76, 86, 13, 0, Math.PI * 2); ctx.fill();
  });
}

// Bleached dinosaur ribcage with a long-toothed skull beside it.
function fallbackBones(): SpriteImage {
  return bake(180, 110, ctx => {
    ctx.strokeStyle = '#efe8d8';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i += 1) { // ribs arcing out of the ground
      const x = 30 + i * 24;
      ctx.beginPath();
      ctx.arc(x, 106, 52 - i * 5, Math.PI * 1.05, Math.PI * 1.72);
      ctx.stroke();
    }
    ctx.fillStyle = '#efe8d8'; // skull
    ctx.beginPath();
    ctx.ellipse(148, 84, 26, 17, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(150, 92, 28, 10); // snout
    ctx.fillStyle = '#2a2420';
    ctx.beginPath(); ctx.arc(146, 80, 5, 0, Math.PI * 2); ctx.fill(); // socket
    for (let t = 0; t < 4; t += 1) { // teeth
      ctx.fillStyle = '#efe8d8';
      ctx.beginPath();
      ctx.moveTo(152 + t * 7, 102);
      ctx.lineTo(155 + t * 7, 110);
      ctx.lineTo(158 + t * 7, 102);
      ctx.closePath();
      ctx.fill();
    }
  });
}

// Smoking volcano cone with lava streaks — the prehistoric tour's landmark.
function fallbackVolcano(): SpriteImage {
  return bake(200, 160, ctx => {
    ctx.fillStyle = '#2e2226';
    ctx.beginPath();
    ctx.moveTo(6, 158); ctx.lineTo(78, 34); ctx.lineTo(122, 34); ctx.lineTo(194, 158);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#443036'; // lit flank
    ctx.beginPath();
    ctx.moveTo(78, 34); ctx.lineTo(122, 34); ctx.lineTo(150, 158); ctx.lineTo(96, 158);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ff6a1a'; // lava streaks
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const [x1, x2] of [[88, 66], [104, 108], [116, 146]] as const) {
      ctx.beginPath();
      ctx.moveTo(x1, 40);
      ctx.quadraticCurveTo((x1 + x2) / 2, 100, x2, 154);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff9d3c'; // crater glow
    ctx.fillRect(80, 30, 40, 7);
    ctx.fillStyle = 'rgba(200,198,192,0.75)'; // smoke plume
    for (const [cx, cy, r] of [[100, 20, 14], [116, 10, 11], [130, 4, 8]] as const) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
  });
}

// The PRIMAL NIGHT visitor — a classic saucer for the sky of the prehistoric
// tour's night leg (render.ts drawUfo). Dome, disc, rim lights: the full cliché.
function fallbackUfo(): SpriteImage {
  return bake(220, 110, ctx => {
    ctx.fillStyle = '#79d9a0'; // glass dome
    ctx.beginPath(); ctx.ellipse(110, 40, 34, 26, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#aeb6c8'; // the disc
    ctx.beginPath(); ctx.ellipse(110, 54, 96, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7d8598'; // underside
    ctx.beginPath(); ctx.ellipse(110, 62, 66, 14, 0, 0, Math.PI); ctx.fill();
    ctx.strokeStyle = '#2a3040';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(110, 54, 96, 22, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffd23f'; // rim lights
    for (let i = 0; i < 7; i += 1) {
      ctx.beginPath(); ctx.arc(34 + i * 25, 56, 4, 0, Math.PI * 2); ctx.fill();
    }
  });
}

// The 600.wtf sacred stone — a river pebble with the twelve digits of
// 600 000 000 000 burnt into it. Fallback approximates the relic; the real
// photo ships in public/pickups/600b/sacred-stone.webp.
function fallbackSacredStone(): SpriteImage {
  return bake(120, 150, ctx => {
    ctx.fillStyle = '#8f8a84'; // the pebble
    ctx.beginPath(); ctx.ellipse(60, 78, 54, 68, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a09a92'; // worn top light
    ctx.beginPath(); ctx.ellipse(48, 52, 30, 34, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2e2a26'; // burnt digits, four rows of three
    ctx.font = '900 26px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rows = ['600', '000', '000', '000'];
    rows.forEach((row, i) => ctx.fillText(row, 60, 40 + i * 27));
  });
}

// Top-down pothole crater decal (the renderer squashes it into the road plane).
function fallbackHole(): SpriteImage {
  return bake(160, 160, ctx => {
    ctx.fillStyle = '#4a3a2c'; // cracked rim
    ctx.beginPath(); ctx.ellipse(80, 80, 74, 62, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#171009'; // the hole
    ctx.beginPath(); ctx.ellipse(80, 84, 58, 48, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5f4b38'; // radiating cracks
    ctx.lineWidth = 4;
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      ctx.beginPath();
      ctx.moveTo(80 + Math.cos(a) * 60, 82 + Math.sin(a) * 50);
      ctx.lineTo(80 + Math.cos(a + 0.12) * 78, 82 + Math.sin(a + 0.12) * 64);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(240,225,190,0.55)'; // sunlit far lip
    ctx.beginPath(); ctx.ellipse(80, 74, 56, 44, 0, Math.PI, Math.PI * 2); ctx.stroke();
  });
}

// Front-view charging T-rex — a wall of teeth coming the other way.
function fallbackTrex(): SpriteImage {
  return bake(150, 150, ctx => {
    ctx.fillStyle = '#3f7d42'; // legs mid-stride
    ctx.fillRect(38, 96, 26, 52);
    ctx.fillRect(88, 90, 26, 58);
    ctx.fillStyle = '#4c934f'; // body
    ctx.beginPath(); ctx.ellipse(75, 78, 44, 40, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#57a55a'; // head, lowered and coming at you
    ctx.beginPath(); ctx.ellipse(75, 40, 34, 28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a1416'; // open jaw
    ctx.beginPath(); ctx.ellipse(75, 52, 24, 14, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#f4efe0'; // teeth
    for (let t = 0; t < 6; t += 1) {
      ctx.beginPath();
      ctx.moveTo(55 + t * 8, 52);
      ctx.lineTo(59 + t * 8, 60);
      ctx.lineTo(63 + t * 8, 52);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#ffd23f'; // eyes
    ctx.fillRect(58, 28, 8, 8);
    ctx.fillRect(84, 28, 8, 8);
    ctx.fillStyle = '#141414';
    ctx.fillRect(60, 30, 4, 4);
    ctx.fillRect(86, 30, 4, 4);
    ctx.fillStyle = '#3f7d42'; // tiny arms
    ctx.fillRect(34, 74, 12, 8);
    ctx.fillRect(104, 74, 12, 8);
  });
}

// Front-view sprinting raptor — low, fast, claws up.
function fallbackRaptor(): SpriteImage {
  return bake(130, 110, ctx => {
    ctx.fillStyle = '#c97a2e'; // legs
    ctx.fillRect(36, 66, 16, 44);
    ctx.fillRect(78, 60, 16, 50);
    ctx.fillStyle = '#dd8f3a'; // lean body
    ctx.beginPath(); ctx.ellipse(65, 56, 34, 26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a7d72'; // teal back stripes
    for (let i = 0; i < 3; i += 1) ctx.fillRect(40 + i * 18, 34 + i * 2, 10, 6);
    ctx.fillStyle = '#e8a04c'; // head
    ctx.beginPath(); ctx.ellipse(65, 26, 22, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a1416';
    ctx.beginPath(); ctx.ellipse(65, 32, 14, 7, 0, 0, Math.PI); ctx.fill(); // jaw
    ctx.fillStyle = '#f4efe0';
    for (let t = 0; t < 4; t += 1) {
      ctx.beginPath();
      ctx.moveTo(54 + t * 7, 32);
      ctx.lineTo(57 + t * 7, 38);
      ctx.lineTo(60 + t * 7, 32);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(54, 16, 7, 7);
    ctx.fillRect(70, 16, 7, 7);
    ctx.fillStyle = '#141414';
    ctx.fillRect(56, 18, 3, 3);
    ctx.fillRect(72, 18, 3, 3);
    ctx.strokeStyle = '#c97a2e'; // raised sickle claws
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(34, 52); ctx.lineTo(22, 38); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(96, 52); ctx.lineTo(108, 38); ctx.stroke();
  });
}

// Rear-view woolly mammoth — a slow shaggy roadblock.
function fallbackMammoth(): SpriteImage {
  return bake(170, 140, ctx => {
    ctx.fillStyle = '#5e4128'; // legs
    for (const x of [28, 62, 96, 126]) ctx.fillRect(x, 96, 20, 42);
    ctx.fillStyle = '#77522f'; // great shaggy rear dome
    ctx.beginPath(); ctx.ellipse(85, 66, 66, 56, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5e4128'; // hanging fur strands
    ctx.lineWidth = 4;
    for (let i = 0; i < 12; i += 1) {
      const x = 28 + i * 10;
      ctx.beginPath(); ctx.moveTo(x, 92); ctx.lineTo(x - 2, 112); ctx.stroke();
    }
    ctx.fillStyle = '#8a6238'; // head hump peeking over the back
    ctx.beginPath(); ctx.ellipse(85, 24, 30, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#f4e8d0'; // tusk tips either side of the head
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(52, 30); ctx.quadraticCurveTo(38, 42, 44, 58); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(118, 30); ctx.quadraticCurveTo(132, 42, 126, 58); ctx.stroke();
    ctx.strokeStyle = '#5e4128'; // ropey tail
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(85, 96); ctx.quadraticCurveTo(89, 116, 82, 128); ctx.stroke();
    ctx.fillStyle = '#3a2a18';
    ctx.beginPath(); ctx.arc(82, 130, 5, 0, Math.PI * 2); ctx.fill(); // tail tuft
  });
}

// The Flintstones-style log car with the two cavemen aboard (rear view). All
// four pose names map here — drawRider's analogue rotation supplies the lean.
function fallbackCavemanCar(): SpriteImage {
  return bake(170, 140, ctx => {
    ctx.fillStyle = '#8a6238'; // log body
    ctx.beginPath();
    ctx.ellipse(85, 92, 62, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(85, 92, 62, 26, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; // log grain rings
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(85, 92, 46, 18, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(85, 92, 28, 11, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#8f8a82'; // stone wheels
    ctx.beginPath(); ctx.arc(38, 116, 22, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(132, 116, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6f6a62';
    ctx.beginPath(); ctx.arc(38, 116, 8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(132, 116, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c9a86a'; // hide canopy on two poles
    ctx.fillRect(30, 8, 110, 12);
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(36, 20); ctx.lineTo(36, 78); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(134, 20); ctx.lineTo(134, 78); ctx.stroke();
    // DNI the caveman (left): long hair, beard, leopard tunic.
    ctx.fillStyle = '#e8b23a';
    ctx.fillRect(42, 52, 34, 30); // tunic
    ctx.fillStyle = '#3a2a18';
    for (const [sx, sy] of [[48, 58], [62, 66], [56, 74]] as const) { ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#a5561f'; // hair
    ctx.beginPath(); ctx.ellipse(59, 36, 17, 20, 0, 0, Math.PI * 2); ctx.fill();
    // The monkey (right): smaller, round ears, curling tail.
    ctx.fillStyle = '#7a5230';
    ctx.beginPath(); ctx.ellipse(112, 62, 15, 18, 0, 0, Math.PI * 2); ctx.fill(); // back
    ctx.beginPath(); ctx.arc(112, 40, 12, 0, Math.PI * 2); ctx.fill(); // head
    ctx.beginPath(); ctx.arc(101, 34, 5, 0, Math.PI * 2); ctx.fill(); // ears
    ctx.beginPath(); ctx.arc(123, 34, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7a5230';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(126, 74); ctx.quadraticCurveTo(150, 66, 146, 46); ctx.stroke(); // tail
  });
}

// Fat hand-rolled joint with a glowing ember and a curl of smoke.
function fallbackJoint(): SpriteImage {
  return bake(90, 100, ctx => {
    ctx.save();
    ctx.translate(45, 58);
    ctx.rotate(-0.6);
    ctx.fillStyle = '#f2ead6'; // paper cone
    ctx.beginPath();
    ctx.moveTo(-34, -5); ctx.lineTo(30, -9); ctx.lineTo(30, 9); ctx.lineTo(-34, 5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#c9b98a'; // twisted tip
    ctx.fillRect(28, -9, 8, 18);
    ctx.fillStyle = '#ff6a1a'; // ember
    ctx.beginPath(); ctx.arc(-36, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(-36, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(220,220,215,0.8)'; // smoke curl
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(18, 34);
    ctx.quadraticCurveTo(6, 24, 16, 14);
    ctx.quadraticCurveTo(26, 6, 18, 2);
    ctx.stroke();
  });
}

// The 600B orange pill.
function fallbackPill(): SpriteImage {
  return bake(80, 90, ctx => {
    ctx.save();
    ctx.translate(40, 46);
    ctx.rotate(-0.5);
    const grad = ctx.createLinearGradient(0, -16, 0, 16);
    grad.addColorStop(0, '#ffb43c');
    grad.addColorStop(0.5, '#ff8c1a');
    grad.addColorStop(1, '#d96a08');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-26, -14);
    ctx.arc(-26, 0, 14, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(26, 14);
    ctx.arc(26, 0, 14, Math.PI / 2, -Math.PI / 2, true);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,50,0,0.5)'; // capsule seam
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, 14); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; // sheen
    ctx.beginPath(); ctx.ellipse(-14, -7, 10, 4, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}

// Bitcoin timelock crystal — the stone age's clock top-up.
function fallbackCrystal(): SpriteImage {
  return bake(90, 104, ctx => {
    ctx.fillStyle = '#6f6a62'; // rocky base
    ctx.beginPath(); ctx.ellipse(45, 94, 30, 9, 0, 0, Math.PI * 2); ctx.fill();
    const shard = (cx: number, top: number, half: number, base: number, light: string, dark: string): void => {
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(cx, top); ctx.lineTo(cx + half, base); ctx.lineTo(cx - half, base);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = light; // lit facet
      ctx.beginPath();
      ctx.moveTo(cx, top); ctx.lineTo(cx - half, base); ctx.lineTo(cx - half * 0.2, base);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, top); ctx.lineTo(cx + half, base); ctx.lineTo(cx - half, base);
      ctx.closePath(); ctx.stroke();
    };
    shard(24, 40, 12, 94, '#ffc978', '#e88a1a');
    shard(66, 32, 13, 94, '#ffc978', '#e88a1a');
    shard(45, 8, 17, 96, '#ffd9a0', '#ff9d2e');
    ctx.fillStyle = '#8a5200'; // the ₿ glowing in the tall shard
    ctx.font = `900 22px 'Trebuchet MS', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('₿', 45, 62);
    ctx.fillStyle = '#fff4d6';
    for (const [sx, sy] of [[36, 22], [72, 44]] as const) { // sparkle glints
      ctx.fillRect(sx - 1, sy - 4, 2, 8);
      ctx.fillRect(sx - 4, sy - 1, 8, 2);
    }
  });
}

// Glowing lava rock.
function fallbackLavaRock(): SpriteImage {
  return bake(180, 130, ctx => {
    ctx.fillStyle = '#1a1416';
    ctx.beginPath();
    ctx.moveTo(20, 128); ctx.lineTo(40, 70); ctx.lineTo(78, 44); ctx.lineTo(120, 60); ctx.lineTo(158, 96); ctx.lineTo(166, 128);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ff6a1a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(60, 120); ctx.lineTo(80, 84); ctx.lineTo(72, 66); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(118, 122); ctx.lineTo(108, 92); ctx.stroke();
  });
}

// --- 600B WORLD TOUR landmarks (all code-drawn — no art files needed) --------

// Victorian cotton mill — Cottonopolis red brick, sawtooth roof, tall chimney.
function fallbackMill(): SpriteImage {
  return bake(240, 230, ctx => {
    ctx.fillStyle = '#8f3b2a';
    ctx.fillRect(24, 96, 170, 134); // mill block
    // sawtooth roofline
    ctx.fillStyle = '#6e2c20';
    for (let i = 0; i < 4; i += 1) {
      const x = 24 + i * 43;
      ctx.beginPath();
      ctx.moveTo(x, 96);
      ctx.lineTo(x + 26, 70);
      ctx.lineTo(x + 43, 96);
      ctx.closePath();
      ctx.fill();
    }
    // brick courses
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 2;
    for (let y = 110; y < 228; y += 14) { ctx.beginPath(); ctx.moveTo(24, y); ctx.lineTo(194, y); ctx.stroke(); }
    // ranks of warm mill windows
    ctx.fillStyle = '#ffdf9a';
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 5; c += 1) ctx.fillRect(38 + c * 32, 112 + r * 36, 18, 24);
    }
    // the chimney stack with a drift of smoke
    ctx.fillStyle = '#7a3226';
    ctx.fillRect(200, 26, 26, 204);
    ctx.fillStyle = '#5f261c';
    ctx.fillRect(196, 20, 34, 12);
    ctx.fillStyle = 'rgba(210,210,205,0.6)';
    ctx.beginPath(); ctx.arc(216, 10, 12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(230, 2, 8, 0, Math.PI * 2); ctx.fill();
  });
}

// Prague astronomical clock tower — gothic stone, the ornate dial, a needle spire.
function fallbackClockTower(): SpriteImage {
  return bake(150, 260, ctx => {
    ctx.fillStyle = '#b7a98e';
    ctx.fillRect(45, 70, 60, 190); // stone shaft
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 2;
    for (let y = 88; y < 256; y += 20) { ctx.beginPath(); ctx.moveTo(45, y); ctx.lineTo(105, y); ctx.stroke(); }
    // the astronomical dial: gold ring, deep-blue face, inner ring
    ctx.fillStyle = '#e8b23a';
    ctx.beginPath(); ctx.arc(75, 150, 27, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1e3a6e';
    ctx.beginPath(); ctx.arc(75, 150, 21, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#e8b23a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(75, 150, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(75, 150); ctx.lineTo(75, 134); ctx.moveTo(75, 150); ctx.lineTo(87, 154); ctx.stroke();
    // parapet + steep verdigris spire with corner pinnacles
    ctx.fillStyle = '#8f8272';
    ctx.fillRect(39, 62, 72, 12);
    ctx.fillStyle = '#3e7d6a';
    ctx.beginPath(); ctx.moveTo(45, 62); ctx.lineTo(75, 4); ctx.lineTo(105, 62); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#356a5a';
    for (const x of [45, 105]) {
      ctx.beginPath(); ctx.moveTo(x - 6, 62); ctx.lineTo(x, 34); ctx.lineTo(x + 6, 62); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#e8b23a';
    ctx.fillRect(72, 0, 6, 10); // gilt finial
  });
}

// Mallorcan stone windmill — the Tramuntana molí: rubble tower, cap, four sails.
function fallbackWindmill(): SpriteImage {
  return bake(190, 230, ctx => {
    ctx.fillStyle = '#c9b490';
    ctx.beginPath(); // gently tapered rubble-stone tower
    ctx.moveTo(64, 230); ctx.lineTo(74, 96); ctx.lineTo(116, 96); ctx.lineTo(126, 230);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    for (let y = 112; y < 226; y += 18) { ctx.beginPath(); ctx.moveTo(68, y); ctx.lineTo(122, y); ctx.stroke(); }
    ctx.fillStyle = '#3a2418';
    ctx.fillRect(86, 176, 20, 54); // doorway
    // conical cap
    ctx.fillStyle = '#8f5a3a';
    ctx.beginPath(); ctx.moveTo(66, 98); ctx.lineTo(95, 74); ctx.lineTo(124, 98); ctx.closePath(); ctx.fill();
    // four lattice sails on the hub
    ctx.strokeStyle = '#f4ead0';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i += 1) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(95, 92);
      ctx.lineTo(95 + Math.cos(a) * 62, 92 + Math.sin(a) * 62);
      ctx.stroke();
    }
    ctx.fillStyle = '#6e4a2e';
    ctx.beginPath(); ctx.arc(95, 92, 7, 0, Math.PI * 2); ctx.fill();
  });
}

// The Taj Mahal — white-marble mausoleum: plinth, iwan arch, onion dome, four
// minarets, and rose beds along the plinth (the world tour finale is a rose
// garden first and a monument second).
function fallbackTajMahal(): SpriteImage {
  return bake(300, 220, ctx => {
    const marble = '#f6f0ea';
    const shade = '#ded2c8';
    ctx.fillStyle = marble;
    ctx.fillRect(30, 190, 240, 20); // plinth
    ctx.fillRect(70, 100, 160, 92); // main block
    ctx.fillStyle = shade;
    ctx.fillRect(70, 100, 14, 92); // block edge shade
    // central iwan arch
    ctx.fillStyle = '#4a3a44';
    ctx.beginPath();
    ctx.moveTo(132, 192); ctx.lineTo(132, 140);
    ctx.quadraticCurveTo(150, 112, 168, 140);
    ctx.lineTo(168, 192);
    ctx.closePath(); ctx.fill();
    // flanking niches
    ctx.fillStyle = shade;
    for (const x of [92, 190]) { ctx.fillRect(x, 130, 18, 30); ctx.fillRect(x, 166, 18, 26); }
    // great onion dome on its drum
    ctx.fillStyle = marble;
    ctx.fillRect(126, 92, 48, 12);
    ctx.beginPath();
    ctx.moveTo(150, 22);
    ctx.quadraticCurveTo(196, 44, 178, 84);
    ctx.quadraticCurveTo(172, 94, 150, 96);
    ctx.quadraticCurveTo(128, 94, 122, 84);
    ctx.quadraticCurveTo(104, 44, 150, 22);
    ctx.fill();
    // small chhatri domes
    for (const x of [96, 204]) {
      ctx.beginPath(); ctx.arc(x, 92, 14, Math.PI, 0); ctx.fill();
      ctx.fillRect(x - 14, 92, 28, 10);
    }
    ctx.fillStyle = '#e8b23a';
    ctx.fillRect(148, 8, 4, 16); // gilt finial
    // four minarets
    ctx.fillStyle = marble;
    for (const x of [38, 62, 238, 262]) {
      ctx.fillRect(x - 5, 96, 10, 96);
      ctx.beginPath(); ctx.arc(x, 94, 8, Math.PI, 0); ctx.fill();
    }
    // rose beds along the plinth
    for (let i = 0; i < 18; i += 1) {
      ctx.fillStyle = i % 3 === 0 ? '#ff6b81' : '#e5344e';
      ctx.beginPath(); ctx.arc(40 + i * 13, 206 + (i % 2) * 5, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#2f7d4a';
    for (let i = 0; i < 9; i += 1) {
      ctx.beginPath(); ctx.ellipse(46 + i * 26, 215, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
    }
  });
}

// Checkpoint gate — two striped posts + a banner, OPEN in the middle to drive through.
function fallbackGate(): SpriteImage {
  return bake(360, 200, ctx => {
    const post = (x: number): void => {
      for (let y = 40; y < 196; y += 24) {
        ctx.fillStyle = (Math.floor(y / 24) % 2) ? '#ffd54a' : '#e5344e';
        ctx.fillRect(x, y, 30, 24);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.strokeRect(x, 40, 30, 156);
    };
    post(18); post(312);
    ctx.fillStyle = '#1f7ac4'; ctx.fillRect(18, 8, 324, 34); // banner
    ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 4; ctx.strokeRect(18, 8, 324, 34);
  });
}

// Finish gate — checkered posts + banner, OPEN in the middle.
function fallbackFinish(): SpriteImage {
  return bake(360, 200, ctx => {
    const checks = (x: number, y: number, w: number, h: number, sq: number): void => {
      for (let yy = 0; yy < h; yy += sq) {
        for (let xx = 0; xx < w; xx += sq) {
          ctx.fillStyle = ((xx / sq + yy / sq) % 2 < 1) ? '#101014' : '#f4f4f4';
          ctx.fillRect(x + xx, y + yy, sq, sq);
        }
      }
    };
    checks(18, 40, 30, 156, 15);
    checks(312, 40, 30, 156, 15);
    checks(18, 6, 324, 34, 17); // banner
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2;
    ctx.strokeRect(18, 40, 30, 156); ctx.strokeRect(312, 40, 30, 156); ctx.strokeRect(18, 6, 324, 34);
  });
}

// Repeating roadside chevrons for the genuinely tight bends. The arrow itself
// is deliberately oversized: at racing speed it must communicate direction in
// a glance, not read like another decorative sign.
function fallbackChevron(direction: 'left' | 'right'): SpriteImage {
  return bake(256, 168, ctx => {
    ctx.imageSmoothingEnabled = false;
    const poly = (points: Array<[number, number]>, fill: string): void => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
      ctx.closePath();
      ctx.fill();
    };

    // Deep arcade drop-shadow, steel feet and striped posts ground the panel.
    ctx.fillStyle = 'rgba(5,9,18,0.45)';
    ctx.fillRect(18, 139, 220, 12);
    for (const x of [37, 207]) {
      ctx.fillStyle = '#07101d'; ctx.fillRect(x - 7, 116, 18, 42);
      ctx.fillStyle = '#34465a'; ctx.fillRect(x - 4, 116, 12, 39);
      ctx.fillStyle = '#a9c2d2'; ctx.fillRect(x - 2, 118, 4, 35);
      ctx.fillStyle = '#07101d'; ctx.fillRect(x - 14, 153, 32, 7);
      ctx.fillStyle = '#f0c54a'; ctx.fillRect(x - 11, 154, 26, 3);
    }

    // Chamfered 32-bit sign cabinet with stepped highlights and chunky pixels.
    const shell: Array<[number, number]> = [[8, 20], [19, 9], [237, 9], [248, 20], [248, 113], [237, 124], [19, 124], [8, 113]];
    poly(shell.map(([x, y]) => [x + 3, y + 5] as [number, number]), '#07101d');
    poly(shell, '#111b2c');
    poly([[13, 23], [23, 14], [233, 14], [243, 23], [243, 109], [233, 119], [23, 119], [13, 109]], '#d9e5e6');
    poly([[18, 26], [26, 19], [230, 19], [238, 26], [238, 106], [230, 114], [26, 114], [18, 106]], '#f2c94d');
    poly([[23, 29], [29, 24], [227, 24], [233, 29], [233, 103], [227, 109], [29, 109], [23, 103]], '#7f1327');
    ctx.fillStyle = '#b61e33'; ctx.fillRect(27, 29, 202, 75);
    ctx.fillStyle = '#e44842'; ctx.fillRect(29, 31, 198, 7);
    ctx.fillStyle = '#741023'; ctx.fillRect(29, 96, 198, 6);

    // Rivets and alternating lamps make each board feel like a real cabinet.
    for (let x = 32; x <= 224; x += 16) {
      ctx.fillStyle = '#4f0a19'; ctx.fillRect(x - 3, 15, 7, 5);
      ctx.fillStyle = x % 32 === 0 ? '#fff4b0' : '#62e8df'; ctx.fillRect(x - 2, 14, 5, 5);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, 14, 2, 2);
    }

    // Four large, outlined direction marks. Draw canonical right arrows, then
    // mirror the whole arrow strip for a left bend so the silhouettes match.
    ctx.save();
    if (direction === 'left') { ctx.translate(256, 0); ctx.scale(-1, 1); }
    for (let i = 0; i < 4; i += 1) {
      const ox = 31 + i * 51;
      const arrow = (dx: number, dy: number): Array<[number, number]> => [
        [ox + dx, 42 + dy], [ox + 19 + dx, 42 + dy], [ox + 43 + dx, 66 + dy],
        [ox + 19 + dx, 90 + dy], [ox + dx, 90 + dy], [ox + 24 + dx, 66 + dy],
      ];
      poly(arrow(3, 4), '#390713');
      poly(arrow(0, 0), '#fff0b5');
      poly([[ox + 7, 49], [ox + 17, 49], [ox + 34, 66], [ox + 17, 83], [ox + 7, 83], [ox + 24, 66]], '#151b2b');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(ox + 8, 49, 10, 4);
      ctx.fillStyle = '#63e4dc'; ctx.fillRect(ox + 26, 62, 5, 5);
    }
    ctx.restore();

    // Small corner shine pixels and bolts complete the era-appropriate finish.
    for (const [x, y] of [[18, 25], [235, 25], [18, 105], [235, 105]] as Array<[number, number]>) {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, 4, 4);
      ctx.fillStyle = '#7fa4b8'; ctx.fillRect(x + 4, y + 4, 3, 3);
    }
  });
}

// Lightweight fallback for the generated finish-line cast: three unmistakably
// adult arcade flag marshals in bright beachwear. The shipped generated sprite
// replaces this, but offline/missing-art play still gets the complete finale.
function fallbackFinishGirls(): SpriteImage {
  return bake(540, 400, ctx => {
    const drawMarshal = (cx: number, suit: string, wave: -1 | 1, flag: boolean): void => {
      ctx.fillStyle = '#e7a36f';
      ctx.beginPath(); ctx.arc(cx, 72, 30, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3b231d';
      ctx.beginPath(); ctx.arc(cx, 62, 32, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = suit;
      ctx.beginPath(); ctx.moveTo(cx - 38, 112); ctx.lineTo(cx + 38, 112); ctx.lineTo(cx + 26, 230); ctx.lineTo(cx - 26, 230); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e7a36f';
      ctx.fillRect(cx - 22, 224, 17, 112); ctx.fillRect(cx + 5, 224, 17, 112);
      ctx.save(); ctx.translate(cx - 28 * wave, 122); ctx.rotate(wave * -0.65); ctx.fillRect(-8, -6, 16, 116); ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 27, 316, 24, 76); ctx.fillRect(cx + 3, 316, 24, 76);
      if (flag) {
        ctx.strokeStyle = '#e9edf2'; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(cx - 76, 125); ctx.lineTo(cx - 105, 6); ctx.stroke();
        const sq = 18;
        for (let y = 0; y < 3; y += 1) for (let x = 0; x < 4; x += 1) {
          ctx.fillStyle = (x + y) % 2 ? '#fff' : '#111';
          ctx.fillRect(cx - 105 + x * sq, 6 + y * sq, sq, sq);
        }
      }
    };
    drawMarshal(115, '#ff4f91', -1, false);
    drawMarshal(270, '#ffd23f', 1, true);
    drawMarshal(425, '#f03b35', 1, false);
  });
}

function fallbackCar(): SpriteImage {
  return bake(150, 110, ctx => {
    ctx.fillStyle = '#e7d3b0';
    ctx.fillRect(24, 40, 102, 56);
    ctx.fillStyle = '#c94b3c';
    ctx.fillRect(24, 40, 102, 20);
    ctx.fillStyle = '#243447';
    ctx.fillRect(38, 20, 74, 30);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(20, 88, 26, 16);
    ctx.fillRect(104, 88, 26, 16);
    ctx.fillStyle = '#ff5a3c';
    ctx.fillRect(30, 66, 16, 12);
    ctx.fillRect(104, 66, 16, 12);
  });
}

// ---- procedural car classes (rear view) ------------------------------------
// Distinct silhouettes + palettes per OutRun-style stage, so traffic reads at a
// glance even before the generated art lands. Every one is a rear view — we
// always catch cars up from behind.

interface CarSpec {
  w: number;
  h: number;
  body: string;
  bodyDark: string;
  roof: string;
  glass: string;
  tail: string;
  trim: string;
  /** `box` is the working-vehicle silhouette: tall, slab-sided, cab up top. */
  stance: 'low' | 'mid' | 'tall' | 'box';
  spoiler?: boolean;
  roundTail?: boolean;
  rust?: boolean;
  // --- working-vehicle dressing (the regional traffic) ---
  /** Roof beacon colour — orange on a plough/tractor, amber on a truck. */
  beacon?: string;
  /** Police light bar (red + blue). */
  lightbar?: boolean;
  /** Snow-plough blade slung across the front. */
  blade?: string;
  /** Roof rack / luggage — campers and holiday traffic. */
  rack?: boolean;
  /** Buggy roll cage over an open body. */
  cage?: boolean;
  /** Fire-truck ladder along the roof. */
  ladder?: boolean;
  /** Fat off-road tyres poking proud of the body. */
  bigWheels?: boolean;
  /** Taxi roof sign colour. */
  taxiSign?: string;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---- 32-bit shading helpers for the code-drawn cars ------------------------
// The regional traffic has no PNG art, so this generator IS the art and has to
// hold its own beside the hand-painted props. A flat fill with one darker band
// reads as programmer-art; what sells a 32-bit sprite is FORM — a body lit from
// above and rounded across, glass that reflects the sky, lamps that sit in a
// recess and glow. These helpers push/pull a spec colour toward white or black
// so every panel can carry its own little ramp.
function carHexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '');
  const f = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}
/** Lift (amt>0) toward white or drop (amt<0) toward black; amt in -1..1. */
function shadeHex(hex: string, amt: number): string {
  const [r, g, b] = carHexToRgb(hex);
  const t = amt < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(amt));
  const c = (x: number): number => Math.round(x + (t - x) * k);
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}
function rgbaFromHex(hex: string, a: number): string {
  const [r, g, b] = carHexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// 4x4 ordered (Bayer) dither matrix, values 0..15.
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * Turn a smoothly-shaded car into DITHERED PIXEL-ART, so the code-drawn traffic
 * sits in the same 32-bit world as the hand-painted PNG cars and props rather
 * than looking like glossy vector art beside them. Two passes in one:
 *  - pixelate to a chunky `cell` grid (the car's art resolution), and
 *  - ordered-dither each colour channel to `step` levels, and the alpha edge to a
 *    stipple — the cross-hatch banding that reads as Mega-Drive/SNES shading.
 * Run once over the finished sprite; the gradients become dither ramps and the
 * additive lamp glows become scattered lit pixels for free.
 */
function pixelDither(ctx: CanvasRenderingContext2D, w: number, h: number, cell: number, step: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const cw = Math.ceil(w / cell);
  const ch = Math.ceil(h / cell);
  for (let cy = 0; cy < ch; cy += 1) {
    for (let cx = 0; cx < cw; cx += 1) {
      const x0 = cx * cell;
      const y0 = cy * cell;
      const x1 = Math.min(w, x0 + cell);
      const y1 = Math.min(h, y0 + cell);
      // average the cell so thin AA/glow fringes survive as coverage
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * w + x) * 4;
          r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; n += 1;
        }
      }
      r /= n; g /= n; b /= n; a /= n;
      const t = (BAYER4[cy & 3][cx & 3] + 0.5) / 16;
      const q = (v: number): number => {
        const level = v / step;
        return Math.min(255, Math.round((Math.floor(level) + (level - Math.floor(level) > t ? 1 : 0)) * step));
      };
      const rr = q(r);
      const gg = q(g);
      const bb = q(b);
      // alpha: HARD silhouette. A stippled edge just reads as a noisy halo around
      // the car; real pixel-art cars have a clean outline with the dither kept to
      // the interior shading. One cell of coverage is the whole pixel or none.
      const aa = a < 128 ? 0 : 255;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * w + x) * 4;
          d[i] = rr; d[i + 1] = gg; d[i + 2] = bb; d[i + 3] = aa;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function makeCarSprite(spec: CarSpec): SpriteImage {
  const { w, h } = spec;
  return bake(w, h, ctx => {
    const cx = w / 2;
    const box = spec.stance === 'box';
    const bodyW = w * (spec.stance === 'low' ? 0.9 : spec.stance === 'tall' ? 0.78 : box ? 0.88 : 0.84);
    const bx = cx - bodyW / 2;
    const tyreH = h * (spec.bigWheels ? 0.27 : 0.2);
    const tyreW = w * (spec.bigWheels ? 0.21 : 0.16);
    const groundY = h - 3;
    const bodyBottom = groundY - tyreH * (spec.bigWheels ? 0.5 : 0.35);
    const bodyTop = h * (spec.stance === 'low' ? 0.5 : spec.stance === 'tall' ? 0.3 : box ? 0.22 : 0.4);
    const cabTop = h * (spec.stance === 'low' ? 0.34 : spec.stance === 'tall' ? 0.12 : box ? 0.08 : 0.22);
    const bodyH = bodyBottom - bodyTop;
    const rad = w * 0.06;
    ctx.lineJoin = 'round';
    // (No contact shadow here — the renderer grounds every car sprite itself, and
    // a soft radial baked in only dithers down to a blobby stipple.)

    // ---- rear tyres: black shoulder + a rim glint so they read as round -----
    const drawTyre = (tx: number): void => {
      ctx.fillStyle = '#0c0c0f';
      roundRectPath(ctx, tx, groundY - tyreH, tyreW, tyreH, 4);
      ctx.fill();
      const rim = ctx.createLinearGradient(tx, 0, tx + tyreW, 0);
      rim.addColorStop(0, 'rgba(120,126,138,0)');
      rim.addColorStop(0.5, 'rgba(150,156,168,0.55)');
      rim.addColorStop(1, 'rgba(120,126,138,0)');
      ctx.fillStyle = rim;
      roundRectPath(ctx, tx + tyreW * 0.16, groundY - tyreH * 0.72, tyreW * 0.68, tyreH * 0.44, 3);
      ctx.fill();
    };
    drawTyre(bx - w * 0.02);
    drawTyre(bx + bodyW - tyreW + w * 0.02);

    // ---- cabin / roof (narrower than the body), lit from above --------------
    const cabW = bodyW * (spec.stance === 'low' ? 0.72 : 0.84);
    const cabX = cx - cabW / 2;
    const cabH = bodyTop - cabTop + h * 0.05;
    const roofGrad = ctx.createLinearGradient(0, cabTop, 0, cabTop + cabH);
    roofGrad.addColorStop(0, shadeHex(spec.roof, 0.26));
    roofGrad.addColorStop(0.55, spec.roof);
    roofGrad.addColorStop(1, shadeHex(spec.roof, -0.26));
    ctx.fillStyle = roofGrad;
    roundRectPath(ctx, cabX, cabTop, cabW, cabH, w * 0.05);
    ctx.fill();

    // rear glass, recessed, with a diagonal sky reflection and a chrome surround
    const gX = cx - cabW * 0.4;
    const gY = cabTop + cabH * 0.18;
    const gW = cabW * 0.8;
    const gH = cabH * 0.52;
    ctx.fillStyle = shadeHex(spec.glass, -0.12);
    roundRectPath(ctx, gX, gY, gW, gH, w * 0.03);
    ctx.fill();
    const sky = ctx.createLinearGradient(gX, gY, gX + gW, gY + gH);
    sky.addColorStop(0, 'rgba(226,240,255,0.42)');
    sky.addColorStop(0.4, 'rgba(226,240,255,0.06)');
    sky.addColorStop(0.62, 'rgba(226,240,255,0)');
    ctx.fillStyle = sky;
    roundRectPath(ctx, gX, gY, gW, gH, w * 0.03);
    ctx.fill();
    ctx.fillStyle = shadeHex(spec.trim, 0.18);
    ctx.fillRect(gX, gY - h * 0.01, gW, Math.max(1, h * 0.012)); // chrome window top

    // ---- main body: a top-lit vertical ramp, rounded across with side AO -----
    const bodyGrad = ctx.createLinearGradient(0, bodyTop, 0, bodyBottom);
    bodyGrad.addColorStop(0, shadeHex(spec.body, 0.3));
    bodyGrad.addColorStop(0.16, shadeHex(spec.body, 0.12));
    bodyGrad.addColorStop(0.5, spec.body);
    bodyGrad.addColorStop(0.82, spec.bodyDark);
    bodyGrad.addColorStop(1, shadeHex(spec.bodyDark, -0.34));
    ctx.fillStyle = bodyGrad;
    roundRectPath(ctx, bx, bodyTop, bodyW, bodyH, rad);
    ctx.fill();

    ctx.save();
    roundRectPath(ctx, bx, bodyTop, bodyW, bodyH, rad);
    ctx.clip();
    // curved-flank shading: darker at both edges → the boot reads as cylindrical
    const flankL = ctx.createLinearGradient(bx, 0, bx + bodyW * 0.42, 0);
    flankL.addColorStop(0, 'rgba(0,0,0,0.26)');
    flankL.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = flankL;
    ctx.fillRect(bx, bodyTop, bodyW * 0.42, bodyH);
    const flankR = ctx.createLinearGradient(bx + bodyW * 0.58, 0, bx + bodyW, 0);
    flankR.addColorStop(0, 'rgba(0,0,0,0)');
    flankR.addColorStop(1, 'rgba(0,0,0,0.26)');
    ctx.fillStyle = flankR;
    ctx.fillRect(bx + bodyW * 0.58, bodyTop, bodyW * 0.42, bodyH);
    // specular sheen across the top shoulder
    const gloss = ctx.createLinearGradient(0, bodyTop, 0, bodyTop + bodyH * 0.26);
    gloss.addColorStop(0, 'rgba(255,255,255,0)');
    gloss.addColorStop(0.55, 'rgba(255,255,255,0.28)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.fillRect(bx + bodyW * 0.06, bodyTop, bodyW * 0.88, bodyH * 0.26);
    // boot shut-line
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(bx + bodyW * 0.05, bodyTop + bodyH * 0.30, bodyW * 0.9, Math.max(1, h * 0.006));
    ctx.restore();

    // ---- box vans: rear doors, handles and a rubbing strip ------------------
    if (box) {
      ctx.strokeStyle = 'rgba(0,0,0,0.30)';
      ctx.lineWidth = Math.max(1.5, w * 0.01);
      ctx.beginPath(); // central door split
      ctx.moveTo(cx, bodyTop + bodyH * 0.06);
      ctx.lineTo(cx, bodyBottom - bodyH * 0.06);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.moveTo(cx + 1.5, bodyTop + bodyH * 0.06);
      ctx.lineTo(cx + 1.5, bodyBottom - bodyH * 0.06);
      ctx.stroke();
      ctx.fillStyle = shadeHex(spec.bodyDark, -0.2); // handles
      ctx.fillRect(cx - bodyW * 0.16, bodyTop + bodyH * 0.5, bodyW * 0.08, h * 0.012);
      ctx.fillRect(cx + bodyW * 0.08, bodyTop + bodyH * 0.5, bodyW * 0.08, h * 0.012);
    }

    // ---- tail lights: recessed housing, lit lens, hot filament core ---------
    const tlY = bodyTop + bodyH * 0.30;
    const tlH = bodyH * 0.24;
    const lensGrad = (y: number): CanvasGradient => {
      const g = ctx.createLinearGradient(0, y, 0, y + tlH);
      g.addColorStop(0, shadeHex(spec.tail, 0.4));
      g.addColorStop(0.5, spec.tail);
      g.addColorStop(1, shadeHex(spec.tail, -0.42));
      return g;
    };
    if (spec.roundTail) {
      for (const fxu of [0.17, 0.83]) {
        const lcx = bx + bodyW * fxu;
        const lcy = tlY + tlH / 2;
        const rr = tlH * 0.62;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.arc(lcx, lcy, rr * 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = lensGrad(lcy - rr);
        ctx.beginPath();
        ctx.arc(lcx, lcy, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shadeHex(spec.tail, 0.7);
        ctx.beginPath();
        ctx.arc(lcx - rr * 0.22, lcy - rr * 0.22, rr * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      for (const fxu of [0.07, 0.69]) {
        const lx = bx + bodyW * fxu;
        const lw = bodyW * 0.24;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        roundRectPath(ctx, lx - lw * 0.08, tlY - tlH * 0.12, lw * 1.16, tlH * 1.24, 3);
        ctx.fill();
        ctx.fillStyle = lensGrad(tlY);
        roundRectPath(ctx, lx, tlY, lw, tlH, 2.5);
        ctx.fill();
        ctx.fillStyle = shadeHex(spec.tail, 0.7);
        roundRectPath(ctx, lx + lw * 0.16, tlY + tlH * 0.24, lw * 0.68, tlH * 0.32, 1.5);
        ctx.fill();
      }
    }
    // emissive bloom off the lamps
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const fxu of spec.roundTail ? [0.17, 0.83] : [0.19, 0.81]) {
      const lcx = bx + bodyW * fxu;
      const lcy = tlY + tlH * 0.5;
      const glow = ctx.createRadialGradient(lcx, lcy, 0, lcx, lcy, tlH * 1.4);
      glow.addColorStop(0, rgbaFromHex(spec.tail, 0.5));
      glow.addColorStop(1, rgbaFromHex(spec.tail, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(lcx - tlH * 1.4, lcy - tlH * 1.4, tlH * 2.8, tlH * 2.8);
    }
    ctx.restore();

    // ---- number plate, then a chromed bumper with a bright top edge ---------
    const bumpH = bodyH * 0.14;
    const bumpY = bodyBottom - bumpH;
    const plW = bodyW * 0.26;
    const plH = bodyH * 0.15;
    ctx.fillStyle = '#ece7d6';
    roundRectPath(ctx, cx - plW / 2, bumpY - plH - h * 0.006, plW, plH, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(40,44,60,0.85)';
    ctx.fillRect(cx - plW * 0.36, bumpY - plH * 0.62 - h * 0.006, plW * 0.72, plH * 0.34);

    const bumpGrad = ctx.createLinearGradient(0, bumpY, 0, bumpY + bumpH);
    bumpGrad.addColorStop(0, shadeHex(spec.trim, 0.42));
    bumpGrad.addColorStop(0.45, spec.trim);
    bumpGrad.addColorStop(1, shadeHex(spec.trim, -0.4));
    ctx.fillStyle = bumpGrad;
    ctx.fillRect(bx, bumpY, bodyW, bumpH);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(bx, bumpY, bodyW, Math.max(1, h * 0.006));

    if (spec.spoiler) {
      ctx.fillStyle = shadeHex(spec.bodyDark, -0.1);
      const spY = bodyTop - h * 0.07;
      ctx.fillRect(cx - bodyW * 0.46, spY, bodyW * 0.92, h * 0.035);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(cx - bodyW * 0.46, spY, bodyW * 0.92, Math.max(1, h * 0.008));
      ctx.fillStyle = shadeHex(spec.bodyDark, -0.1);
      ctx.fillRect(cx - bodyW * 0.36, spY, w * 0.035, h * 0.07);
      ctx.fillRect(cx + bodyW * 0.33, spY, w * 0.035, h * 0.07);
    }

    if (spec.rust) {
      ctx.fillStyle = 'rgba(92,52,26,0.5)';
      ctx.beginPath();
      ctx.arc(bx + bodyW * 0.26, bodyBottom - 6, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx + bodyW * 0.72, bodyTop + 9, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(52,30,14,0.4)';
      ctx.beginPath();
      ctx.arc(bx + bodyW * 0.5, bodyBottom - bumpH - 4, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- regional working-vehicle dressing ---------------------------------
    // Enough silhouette to tell a snow plough from a squad car from a tractor at
    // a glance — which is the whole point of giving each region its own traffic.
    if (spec.rack) {
      ctx.fillStyle = spec.trim;
      ctx.fillRect(cx - bodyW * 0.42, cabTop - h * 0.05, bodyW * 0.84, h * 0.035);
      ctx.fillStyle = spec.bodyDark;
      ctx.fillRect(cx - bodyW * 0.3, cabTop - h * 0.09, bodyW * 0.6, h * 0.045); // luggage
    }
    if (spec.ladder) {
      ctx.fillStyle = '#d8d8d0';
      ctx.fillRect(cx - bodyW * 0.44, cabTop - h * 0.045, bodyW * 0.88, h * 0.03);
      ctx.fillStyle = '#9a9a92';
      for (let i = 0; i < 7; i += 1) {
        ctx.fillRect(cx - bodyW * 0.42 + i * bodyW * 0.14, cabTop - h * 0.045, w * 0.012, h * 0.03);
      }
    }
    if (spec.cage) {
      ctx.strokeStyle = '#2a2a30';
      ctx.lineWidth = Math.max(2, w * 0.028);
      ctx.beginPath(); // roll hoop over an open body
      ctx.moveTo(bx + bodyW * 0.1, bodyTop);
      ctx.lineTo(bx + bodyW * 0.16, cabTop);
      ctx.lineTo(bx + bodyW * 0.84, cabTop);
      ctx.lineTo(bx + bodyW * 0.9, bodyTop);
      ctx.stroke();
    }
    if (spec.blade) {
      ctx.fillStyle = spec.blade;
      roundRectPath(ctx, cx - w * 0.48, bodyBottom - h * 0.06, w * 0.96, h * 0.16, w * 0.03);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; // scraped steel edge
      ctx.fillRect(cx - w * 0.48, bodyBottom + h * 0.07, w * 0.96, h * 0.03);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = Math.max(2, w * 0.012);
      roundRectPath(ctx, cx - w * 0.48, bodyBottom - h * 0.06, w * 0.96, h * 0.16, w * 0.03);
      ctx.stroke();
    }
    if (spec.lightbar) {
      const lw = bodyW * 0.5;
      const lbY = cabTop - h * 0.055;
      ctx.fillStyle = '#20242c'; // black mounting bar
      roundRectPath(ctx, cx - lw / 2 - w * 0.01, lbY - h * 0.012, lw + w * 0.02, h * 0.052, 2);
      ctx.fill();
      ctx.fillStyle = '#e02030';
      ctx.fillRect(cx - lw / 2, lbY, lw / 2, h * 0.04);
      ctx.fillStyle = '#2060e0';
      ctx.fillRect(cx, lbY, lw / 2, h * 0.04);
      ctx.save(); // twin glow, red left / blue right
      ctx.globalCompositeOperation = 'lighter';
      for (const [gx, col] of [[cx - lw * 0.25, '#ff3040'], [cx + lw * 0.25, '#4080ff']] as const) {
        const gg = ctx.createRadialGradient(gx, lbY + h * 0.02, 0, gx, lbY + h * 0.02, lw * 0.5);
        gg.addColorStop(0, rgbaFromHex(col, 0.6));
        gg.addColorStop(1, rgbaFromHex(col, 0));
        ctx.fillStyle = gg;
        ctx.fillRect(gx - lw * 0.5, lbY - lw * 0.5, lw, lw);
      }
      ctx.restore();
    }
    if (spec.beacon) {
      const byc = cabTop - h * 0.035;
      ctx.fillStyle = shadeHex(spec.beacon, -0.35); // dome base
      ctx.beginPath();
      ctx.ellipse(cx, byc + h * 0.012, w * 0.05, h * 0.02, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = spec.beacon;
      ctx.beginPath();
      ctx.ellipse(cx, byc, w * 0.045, h * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shadeHex(spec.beacon, 0.55); // glint
      ctx.beginPath();
      ctx.ellipse(cx - w * 0.012, byc - h * 0.008, w * 0.016, h * 0.012, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const bg = ctx.createRadialGradient(cx, byc, 0, cx, byc, w * 0.12);
      bg.addColorStop(0, rgbaFromHex(spec.beacon, 0.55));
      bg.addColorStop(1, rgbaFromHex(spec.beacon, 0));
      ctx.fillStyle = bg;
      ctx.fillRect(cx - w * 0.12, byc - w * 0.12, w * 0.24, w * 0.24);
      ctx.restore();
    }
    if (spec.taxiSign) {
      ctx.fillStyle = spec.taxiSign;
      roundRectPath(ctx, cx - bodyW * 0.18, cabTop - h * 0.06, bodyW * 0.36, h * 0.05, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = Math.max(1.5, w * 0.01);
      ctx.stroke();
    }

    // dark arcade outline
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(2, w * 0.014);
    roundRectPath(ctx, bx, bodyTop, bodyW, bodyBottom - bodyTop, w * 0.06);
    ctx.stroke();

    // Bake the whole thing down to dithered pixel-art so it matches the PNG cars.
    // cell ≈ 3 native px → ~50px-wide art; step 40 → ~6 shades a channel to dither
    // between. Tuned to read as 32-bit at the sizes traffic is actually drawn.
    pixelDither(ctx, w, h, 3, 40);
  });
}

const CAR_SPECS: Record<string, CarSpec> = {
  'car-lambo': { w: 162, h: 96, body: '#ffcf1a', bodyDark: '#c99b00', roof: '#1b1b24', glass: '#2b3048', tail: '#ff3b3b', trim: '#111', stance: 'low', spoiler: true },
  'car-ferrari': { w: 158, h: 98, body: '#e01122', bodyDark: '#9c0a16', roof: '#2a0e12', glass: '#3a2030', tail: '#ff6161', trim: '#111', stance: 'low', spoiler: true, roundTail: true },
  'car-porsche': { w: 150, h: 100, body: '#d9dee4', bodyDark: '#9aa0a8', roof: '#c2c8ce', glass: '#2b3040', tail: '#e23b3b', trim: '#333', stance: 'mid', spoiler: true, roundTail: true },
  'car-bentley': { w: 150, h: 116, body: '#123f2e', bodyDark: '#0c2a1f', roof: '#0e3325', glass: '#274850', tail: '#e04b4b', trim: '#c9b981', stance: 'tall' },
  'car-banger': { w: 150, h: 112, body: '#7a6a45', bodyDark: '#584c31', roof: '#6a5c3d', glass: '#38402f', tail: '#c05a3a', trim: '#3a3a3a', stance: 'mid', rust: true },
  // --- regional traffic: the vehicles that belong to each place --------------
  // The vehicles you meet belong to the road you are on — coaches and ploughs on
  // the mountain, pickups and buggies in the canyon, cabs and squad cars in the
  // city, tractors in the valley — so the traffic itself tells you where you are.
  'car-camper': { w: 152, h: 126, body: '#f2ede0', bodyDark: '#cfc7b4', roof: '#e8c34a', glass: '#3c4a52', tail: '#e05a4a', trim: '#c9752f', stance: 'box', rack: true },
  'car-bus': { w: 168, h: 134, body: '#2f6fb5', bodyDark: '#204d80', roof: '#e8edf2', glass: '#2b3a4a', tail: '#e04b4b', trim: '#d8dde2', stance: 'box' },
  'car-plough': { w: 166, h: 130, body: '#f2a01e', bodyDark: '#c47a0c', roof: '#d98f16', glass: '#33403c', tail: '#e04b4b', trim: '#2f3338', stance: 'box', blade: '#d94f2a', beacon: '#ffb43c', bigWheels: true },
  'car-pickup': { w: 156, h: 116, body: '#c98a52', bodyDark: '#a06a3a', roof: '#b57a45', glass: '#3e4a44', tail: '#d95a3a', trim: '#3a3a3a', stance: 'mid', bigWheels: true, rust: true },
  'car-buggy': { w: 140, h: 104, body: '#e5484d', bodyDark: '#b52f36', roof: '#2a2a30', glass: '#2a2a30', tail: '#ffb43c', trim: '#2a2a30', stance: 'mid', cage: true, bigWheels: true },
  'car-taxi': { w: 152, h: 106, body: '#f5c518', bodyDark: '#c69c0a', roof: '#f5c518', glass: '#26303f', tail: '#e04b4b', trim: '#1b1b20', stance: 'mid', taxiSign: '#1b1b20' },
  'car-police': { w: 154, h: 106, body: '#f2f4f6', bodyDark: '#c2c6cc', roof: '#1c2740', glass: '#26303f', tail: '#e04b4b', trim: '#1c2740', stance: 'mid', lightbar: true },
  'car-tractor': { w: 148, h: 128, body: '#3f8f3a', bodyDark: '#2c6b28', roof: '#2c6b28', glass: '#3c4a3c', tail: '#e04b4b', trim: '#e8b13c', stance: 'box', beacon: '#ffb43c', bigWheels: true },
  'car-jeep': { w: 148, h: 116, body: '#5a6b46', bodyDark: '#3f4d31', roof: '#3f4d31', glass: '#39433c', tail: '#d95a3a', trim: '#2a2a2a', stance: 'tall', bigWheels: true },
  'car-firetruck': { w: 172, h: 136, body: '#d4232b', bodyDark: '#9c151c', roof: '#e8e8e0', glass: '#2b3a4a', tail: '#ffb43c', trim: '#e8e8e0', stance: 'box', ladder: true, beacon: '#ff4d4d' },
};

function fallbackPetrol(): SpriteImage {
  return bake(80, 100, ctx => {
    // red jerry can
    ctx.fillStyle = '#d32f2f';
    ctx.fillRect(16, 26, 48, 62);
    ctx.fillStyle = '#b71c1c';
    ctx.fillRect(16, 26, 48, 12);
    ctx.fillStyle = '#8a1414';
    ctx.fillRect(24, 12, 32, 16); // handle block
    ctx.fillStyle = '#3a0d0d';
    ctx.fillRect(52, 20, 12, 8); // spout
    // cream label
    ctx.fillStyle = '#f6ead0';
    ctx.fillRect(22, 48, 36, 20);
    ctx.fillStyle = '#c8102e';
    ctx.font = '700 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('600', 40, 54);
    ctx.fillText('.wtf', 40, 63);
  });
}

function fallbackRose(): SpriteImage {
  return bake(80, 100, ctx => {
    ctx.strokeStyle = '#2e7d4f';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(40, 96);
    ctx.lineTo(40, 44);
    ctx.stroke();
    ctx.fillStyle = '#e5344e';
    ctx.beginPath();
    ctx.arc(40, 30, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff6b81';
    ctx.beginPath();
    ctx.arc(40, 28, 11, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Special-pickup icons (small on-road treats). Cake has real art; the rest are
// clean code-drawn icons so they read at a glance.
function fallbackCake(): SpriteImage {
  return bake(80, 100, ctx => {
    ctx.fillStyle = '#e8c48a';
    ctx.beginPath(); ctx.moveTo(16, 82); ctx.lineTo(64, 82); ctx.lineTo(20, 40); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff4e0'; ctx.fillRect(19, 60, 42, 7);
    ctx.fillStyle = '#ffc0cb';
    ctx.beginPath(); ctx.moveTo(20, 40); ctx.lineTo(64, 82); ctx.lineTo(64, 72); ctx.lineTo(24, 36); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e5344e'; ctx.beginPath(); ctx.arc(30, 40, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, 82); ctx.lineTo(64, 82); ctx.lineTo(20, 40); ctx.closePath(); ctx.stroke();
  });
}
function fallbackWholeCake(): SpriteImage {
  return bake(92, 100, ctx => {
    ctx.fillStyle = '#e8c48a'; ctx.fillRect(14, 56, 64, 34);
    ctx.fillStyle = '#ffc0cb'; ctx.fillRect(14, 50, 64, 10);
    for (let i = 0; i < 5; i += 1) { ctx.beginPath(); ctx.arc(22 + i * 13, 60, 5, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 0; i < 3; i += 1) {
      const x = 28 + i * 18;
      ctx.fillStyle = '#4aa3ff'; ctx.fillRect(x, 30, 4, 20);
      ctx.fillStyle = '#ffcf1a'; ctx.beginPath(); ctx.ellipse(x + 2, 28, 3, 6, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(14, 50, 64, 40);
  });
}
function fallbackMeme(): SpriteImage {
  return bake(90, 90, ctx => {
    ctx.fillStyle = '#3fb950'; ctx.beginPath(); ctx.arc(45, 45, 34, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2e8b3f'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(45, 45, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#0a2a12'; ctx.beginPath(); ctx.arc(34, 40, 4, 0, Math.PI * 2); ctx.arc(56, 40, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0a2a12'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(45, 48, 16, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  });
}
function fallbackATH(): SpriteImage {
  return bake(80, 100, ctx => {
    ctx.fillStyle = '#3fb950';
    ctx.fillRect(14, 60, 12, 30); ctx.fillRect(34, 44, 12, 46); ctx.fillRect(54, 24, 12, 66);
    ctx.strokeStyle = '#e8ffe8'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(16, 66); ctx.lineTo(60, 26); ctx.stroke();
    ctx.fillStyle = '#e8ffe8'; ctx.beginPath(); ctx.moveTo(62, 18); ctx.lineTo(68, 34); ctx.lineTo(50, 32); ctx.closePath(); ctx.fill();
  });
}
function fallbackTimelock(): SpriteImage {
  return bake(80, 100, ctx => {
    ctx.strokeStyle = '#c9b981'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(40, 42, 16, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#d9a441'; ctx.fillRect(18, 42, 44, 44);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(18, 42, 44, 44);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(40, 64, 13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(40, 64); ctx.lineTo(40, 56); ctx.moveTo(40, 64); ctx.lineTo(48, 64); ctx.stroke();
  });
}
function fallbackFiatnam(): SpriteImage {
  return bake(96, 80, ctx => {
    ctx.fillStyle = '#7d9b76'; ctx.fillRect(10, 22, 76, 40);
    ctx.strokeStyle = '#4f6b49'; ctx.lineWidth = 3; ctx.strokeRect(10, 22, 76, 40);
    ctx.fillStyle = '#eef5ec'; ctx.beginPath(); ctx.arc(48, 42, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4f6b49'; ctx.font = '700 20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 48, 43);
  });
}
function fallbackShield(): SpriteImage {
  return bake(84, 100, ctx => {
    // Gold-rimmed HODL shield — absorbs one wipeout.
    const path = (): void => {
      ctx.beginPath();
      ctx.moveTo(42, 8);
      ctx.quadraticCurveTo(66, 18, 76, 20);
      ctx.quadraticCurveTo(76, 64, 42, 92);
      ctx.quadraticCurveTo(8, 64, 8, 20);
      ctx.quadraticCurveTo(18, 18, 42, 8);
    };
    path();
    ctx.fillStyle = '#123a4a';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffd76b';
    path();
    ctx.stroke();
    ctx.fillStyle = '#8fe6c4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 19px 'Trebuchet MS', sans-serif`;
    ctx.fillText('HODL', 42, 46);
    ctx.strokeStyle = 'rgba(255,215,107,0.6)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(20, 62);
    ctx.lineTo(64, 62);
    ctx.stroke();
  });
}
function fallbackBeer(): SpriteImage {
  return bake(80, 100, ctx => {
    // Foamy amber pint — the speed-up / wobbly-vision trade-off.
    const glass = ctx.createLinearGradient(18, 0, 62, 0);
    glass.addColorStop(0, '#d98a1e');
    glass.addColorStop(0.5, '#f5b53c');
    glass.addColorStop(1, '#c97c14');
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.moveTo(20, 34);
    ctx.lineTo(24, 90);
    ctx.lineTo(56, 90);
    ctx.lineTo(60, 34);
    ctx.closePath();
    ctx.fill();
    // handle
    ctx.strokeStyle = '#e8a82e';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(63, 58, 13, -Math.PI / 2.6, Math.PI / 2.6);
    ctx.stroke();
    // rising bubbles
    ctx.fillStyle = 'rgba(255,240,200,0.75)';
    for (const [bx, by, r] of [[30, 70, 2.5], [42, 58, 2], [50, 76, 2.5], [36, 46, 1.8], [48, 44, 1.6]] as const) {
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
    }
    // foam head, tumbling over the rim
    ctx.fillStyle = '#fff7e8';
    for (const [fx, fy, r] of [[26, 30, 9], [38, 25, 11], [52, 29, 9], [32, 22, 7], [46, 21, 7]] as const) {
      ctx.beginPath(); ctx.arc(fx, fy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(20, 34);
    ctx.lineTo(24, 90);
    ctx.lineTo(56, 90);
    ctx.lineTo(60, 34);
    ctx.stroke();
  });
}
function fallbackShroom(): SpriteImage {
  return bake(90, 100, ctx => {
    // Fly agaric — red cap, white spots: invincibility + a psychedelic trip.
    ctx.fillStyle = '#f2e8d8';
    ctx.beginPath();
    ctx.moveTo(36, 52);
    ctx.quadraticCurveTo(33, 82, 30, 90);
    ctx.lineTo(60, 90);
    ctx.quadraticCurveTo(57, 82, 54, 52);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,90,60,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(40, 60); ctx.lineTo(39, 84); ctx.stroke();
    // cap
    const cap = ctx.createLinearGradient(0, 14, 0, 56);
    cap.addColorStop(0, '#e5342e');
    cap.addColorStop(1, '#b81f1f');
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.moveTo(8, 54);
    ctx.quadraticCurveTo(10, 16, 45, 14);
    ctx.quadraticCurveTo(80, 16, 82, 54);
    ctx.quadraticCurveTo(45, 62, 8, 54);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // white spots
    ctx.fillStyle = '#fff4ec';
    for (const [sx, sy, r] of [[24, 34, 5], [45, 24, 6], [66, 36, 5], [34, 48, 4], [57, 47, 4]] as const) {
      ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    }
  });
}
function fallbackFourTwenty(): SpriteImage {
  return bake(90, 90, ctx => {
    ctx.fillStyle = '#122018'; ctx.beginPath(); ctx.arc(45, 45, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f4f0e0'; ctx.beginPath(); ctx.arc(45, 45, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#122018'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(45, 45, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#c8102e'; ctx.lineWidth = 4;
    const min = ((120 - 90) * Math.PI) / 180;
    const hr = ((130 - 90) * Math.PI) / 180;
    ctx.beginPath(); ctx.moveTo(45, 45); ctx.lineTo(45 + Math.cos(min) * 20, 45 + Math.sin(min) * 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(45, 45); ctx.lineTo(45 + Math.cos(hr) * 13, 45 + Math.sin(hr) * 13); ctx.stroke();
    ctx.fillStyle = '#122018'; ctx.beginPath(); ctx.arc(45, 45, 3, 0, Math.PI * 2); ctx.fill();
  });
}

const FALLBACKS: Record<string, () => SpriteImage> = {
  'prop-palm': fallbackPalm,
  'prop-coconut': fallbackCoconut,
  'prop-cypress': fallbackCypress,
  'prop-pine': fallbackPine,
  'prop-fir': fallbackFir,
  'prop-blossom': fallbackBlossom,
  'prop-lamp': fallbackLamp,
  'prop-parasol': fallbackParasol,
  'prop-flowers': fallbackFlowers,
  'prop-villa': fallbackVilla,
  'prop-beachhut': fallbackBeachHut,
  'prop-chalet': fallbackChalet,
  'prop-cactus': fallbackCactus,
  'prop-adobe': fallbackAdobe,
  'prop-neon': fallbackNeon,
  'prop-skyscraper': fallbackSkyscraper,
  'prop-pagoda': fallbackPagoda,
  'prop-maple': fallbackMaple,
  'prop-barn': fallbackBarn,
  'prop-reed': fallbackReed,
  'prop-lighthouse': fallbackLighthouse,
  'prop-deadtree': fallbackDeadTree,
  'prop-lavarock': fallbackLavaRock,
  'prop-fern': fallbackFern,
  'prop-bones': fallbackBones,
  'prop-volcano': fallbackVolcano,
  'hazard-hole': fallbackHole,
  ufo: fallbackUfo,
  'dino-trex': fallbackTrex,
  'dino-raptor': fallbackRaptor,
  mammoth: fallbackMammoth,
  'caveman-straight': fallbackCavemanCar,
  'caveman-lean-right': fallbackCavemanCar,
  'caveman-wipeout': fallbackCavemanCar,
  // (No fallbacks for the '-2'/'-3' animation frames or a lean-left: rider.ts
  // must see a MISS for those so it can fall back to frame 1 / mirroring.)
  'finish-line-cavewomen': fallbackFinishGirls,
  'victory-cavemen': fallbackCavemanCar,
  'prop-mill': fallbackMill,
  'prop-clocktower': fallbackClockTower,
  'prop-windmill': fallbackWindmill,
  'prop-tajmahal': fallbackTajMahal,
  'prop-gate': fallbackGate,
  'prop-finish': fallbackFinish,
  'prop-chevron-left': () => fallbackChevron('left'),
  'prop-chevron-right': () => fallbackChevron('right'),
  'finish-line-girls': fallbackFinishGirls,
  'prop-sign': fallbackSign,
  'prop-billboard': fallbackBillboard,
  'car-classic': fallbackCar,
  'car-van': fallbackCar,
  'scooter-rival': fallbackCar,
  'car-lambo': () => makeCarSprite(CAR_SPECS['car-lambo']),
  'car-ferrari': () => makeCarSprite(CAR_SPECS['car-ferrari']),
  'car-porsche': () => makeCarSprite(CAR_SPECS['car-porsche']),
  'car-bentley': () => makeCarSprite(CAR_SPECS['car-bentley']),
  'car-banger': () => makeCarSprite(CAR_SPECS['car-banger']),
  // Regional working vehicles — all code-drawn (no PNG art), so the generator IS
  // the art. Each is dressed to read as its region's traffic at a glance.
  'car-camper': () => makeCarSprite(CAR_SPECS['car-camper']),
  'car-bus': () => makeCarSprite(CAR_SPECS['car-bus']),
  'car-plough': () => makeCarSprite(CAR_SPECS['car-plough']),
  'car-pickup': () => makeCarSprite(CAR_SPECS['car-pickup']),
  'car-buggy': () => makeCarSprite(CAR_SPECS['car-buggy']),
  'car-taxi': () => makeCarSprite(CAR_SPECS['car-taxi']),
  'car-police': () => makeCarSprite(CAR_SPECS['car-police']),
  'car-tractor': () => makeCarSprite(CAR_SPECS['car-tractor']),
  'car-jeep': () => makeCarSprite(CAR_SPECS['car-jeep']),
  'car-firetruck': () => makeCarSprite(CAR_SPECS['car-firetruck']),
  rose: fallbackRose,
  'pickup-petrol': fallbackPetrol,
  'pickup-cake': fallbackCake,
  'pickup-wholecake': fallbackWholeCake,
  'pickup-meme': fallbackMeme,
  'pickup-ath': fallbackATH,
  'pickup-timelock': fallbackTimelock,
  'pickup-fiatnam': fallbackFiatnam,
  'pickup-fourtwenty': fallbackFourTwenty,
  'pickup-shield': fallbackShield,
  'pickup-beer': fallbackBeer,
  'pickup-shroom': fallbackShroom,
  'pickup-joint': fallbackJoint,
  'pickup-pill': fallbackPill,
  'pickup-crystal': fallbackCrystal,
  'pickup-sacredstone': fallbackSacredStone,
};

const ART_URLS: Record<string, string> = {
  'hero-straight': assetUrl('art/hero-straight.webp'),
  'hero-lean-left': assetUrl('art/hero-lean-left.webp'),
  'hero-lean-right': assetUrl('art/hero-lean-right.webp'),
  'hero-wipeout': assetUrl('art/hero-wipeout.webp'),
  // 600B YEARS BC — the prehistoric tour's log car, beasts, pickups and scenery.
  // The '-2' frames flip with frame 1 at speed (turning stone wheels); the
  // wipeout stages animate the tumble. One lean frame, mirrored (hero style).
  'caveman-straight': assetUrl('art/caveman-straight.webp'),
  'caveman-straight-2': assetUrl('art/caveman-straight-2.webp'),
  // ONE lean frame, mirrored for left (no '-2' flip: the generated lean pair
  // drifted too much between frames and the flip read as wobble, not wheels).
  'caveman-lean-right': assetUrl('art/caveman-lean-right.webp'),
  'caveman-wipeout': assetUrl('art/caveman-wipeout.webp'),
  'caveman-wipeout-2': assetUrl('art/caveman-wipeout-2.webp'),
  'caveman-wipeout-3': assetUrl('art/caveman-wipeout-3.webp'),
  'finish-line-cavewomen': assetUrl('art/finish-line-cavewomen.webp'),
  'victory-cavemen': assetUrl('art/victory-cavemen.webp'),
  'dino-trex': assetUrl('art/dino-trex.webp'),
  'dino-raptor': assetUrl('art/dino-raptor.webp'),
  mammoth: assetUrl('art/mammoth.webp'),
  'pickup-joint': assetUrl('art/pickup-joint.webp'),
  'pickup-pill': assetUrl('art/pickup-pill.webp'),
  'pickup-crystal': assetUrl('art/pickup-crystal.webp'),
  // The relic itself, photographed — from 600.wtf/img/sacred-stone.webp.
  'pickup-sacredstone': assetUrl('pickups/600b/sacred-stone.webp'),
  'prop-fern': assetUrl('art/prop-fern.webp'),
  'prop-bones': assetUrl('art/prop-bones.webp'),
  'prop-volcano': assetUrl('art/prop-volcano.webp'),
  'hazard-hole': assetUrl('art/hazard-hole.webp'),
  ufo: assetUrl('art/ufo.webp'),
  'horizon-jurassic': assetUrl('art/horizon-jurassic.webp'),
  'horizon-jurassic-night': assetUrl('art/horizon-jurassic-night.webp'),
  'horizon-jurassic-eruption': assetUrl('art/horizon-jurassic-eruption.webp'),
  'car-classic': assetUrl('art/car-classic.webp'),
  'car-van': assetUrl('art/car-van.webp'),
  'scooter-rival': assetUrl('art/scooter-rival.webp'),
  'car-lambo': assetUrl('art/car-lambo.webp'),
  'car-ferrari': assetUrl('art/car-ferrari.webp'),
  'car-porsche': assetUrl('art/car-porsche.webp'),
  'car-bentley': assetUrl('art/car-bentley.webp'),
  'car-banger': assetUrl('art/car-banger.webp'),
  // Regional working traffic — gpt-image-1.5 sprites (dithered makeCarSprite is
  // the fallback until these load / if the PNG is missing).
  'car-camper': assetUrl('art/car-camper.webp'),
  'car-bus': assetUrl('art/car-bus.webp'),
  'car-plough': assetUrl('art/car-plough.webp'),
  'car-pickup': assetUrl('art/car-pickup.webp'),
  'car-buggy': assetUrl('art/car-buggy.webp'),
  'car-taxi': assetUrl('art/car-taxi.webp'),
  'car-police': assetUrl('art/car-police.webp'),
  'car-tractor': assetUrl('art/car-tractor.webp'),
  'car-jeep': assetUrl('art/car-jeep.webp'),
  'car-firetruck': assetUrl('art/car-firetruck.webp'),
  'prop-palm': assetUrl('art/prop-palm.webp'),
  'prop-coconut': assetUrl('art/prop-coconut.webp'),
  'prop-cypress': assetUrl('art/prop-cypress.webp'),
  'prop-pine': assetUrl('art/prop-pine.webp'),
  'prop-fir': assetUrl('art/prop-fir.webp'),
  'prop-blossom': assetUrl('art/prop-blossom.webp'),
  'prop-lamp': assetUrl('art/prop-lamp.webp'),
  'prop-parasol': assetUrl('art/prop-parasol.webp'),
  'prop-flowers': assetUrl('art/prop-flowers.webp'),
  'prop-villa': assetUrl('art/prop-villa.webp'),
  'prop-beachhut': assetUrl('art/prop-beachhut.webp'),
  'prop-chalet': assetUrl('art/prop-chalet.webp'),
  'prop-cactus': assetUrl('art/prop-cactus.webp'),
  'prop-adobe': assetUrl('art/prop-adobe.webp'),
  'prop-neon': assetUrl('art/prop-neon.webp'),
  'prop-skyscraper': assetUrl('art/prop-skyscraper.webp'),
  'prop-pagoda': assetUrl('art/prop-pagoda.webp'),
  'prop-maple': assetUrl('art/prop-maple.webp'),
  'prop-barn': assetUrl('art/prop-barn.webp'),
  'prop-reed': assetUrl('art/prop-reed.webp'),
  'prop-lighthouse': assetUrl('art/prop-lighthouse.webp'),
  'prop-deadtree': assetUrl('art/prop-deadtree.webp'),
  'prop-lavarock': assetUrl('art/prop-lavarock.webp'),
  'prop-mill': assetUrl('art/prop-mill.webp'),
  'prop-clocktower': assetUrl('art/prop-clocktower.webp'),
  'prop-windmill': assetUrl('art/prop-windmill.webp'),
  'prop-tajmahal': assetUrl('art/prop-tajmahal.webp'),
  'prop-gate': assetUrl('art/prop-gate.webp'),
  'prop-finish': assetUrl('art/prop-finish-decorated.webp'),
  'finish-line-girls': assetUrl('art/finish-line-girls.webp'),
  'prop-sign': assetUrl('art/prop-sign.webp'),
  // Raw sticker art for the rose-meme billboard; composited onto the hoarding
  // by buildBillboardVariants, never drawn directly.
  'billboard-rose-art': assetUrl('art/billboard-rose.webp'),
  // Bespoke wide arcade-poster face: a donkey demolishing an absurdly lavish
  // cake. Text is composited in code so the meme stays perfectly legible.
  'billboard-donkey-cake-art': assetUrl('art/billboard-donkey-cake.webp'),
  rose: assetUrl('pickups/600b/rose.webp'),
  // Ground material textures (gen-textures.mjs → optimise-assets bake). The
  // renderer tints these to the biome palette, so each material ships once.
  'texture-grass': assetUrl('art/texture-grass.webp'),
  'texture-sand': assetUrl('art/texture-sand.webp'),
  'texture-snow': assetUrl('art/texture-snow.webp'),
  'texture-leaves': assetUrl('art/texture-leaves.webp'),
  'texture-ash': assetUrl('art/texture-ash.webp'),
  'texture-asphalt': assetUrl('art/texture-asphalt.webp'),
  'texture-rock': assetUrl('art/texture-rock.webp'),
  'texture-tarmac': assetUrl('art/texture-tarmac.webp'),
  'texture-water': assetUrl('art/texture-water.webp'),
  'pickup-petrol': assetUrl('art/pickup-petrol.webp'),
  'pickup-shield': assetUrl('art/pickup-shield.webp'),
  'pickup-cake': assetUrl('pickups/600b/cake-piece-1.webp'),
  'pickup-wholecake': assetUrl('pickups/600b/whole-cake.webp'),
  'title-art': assetUrl('art/title-art-orig.webp'),
  // Opaque biome backdrops → JPEG (no alpha needed; ~6× smaller than PNG). One
  // panorama per region; the renderer crossfades between adjacent ones at the
  // checkpoint. Amalfi reuses the existing day panorama.
  'horizon-riviera': assetUrl('art/horizon-day.webp'),
  'horizon-beach': assetUrl('art/horizon-beach.webp'),
  'horizon-alpine': assetUrl('art/horizon-alpine.webp'),
  'horizon-desert': assetUrl('art/horizon-desert.webp'),
  'horizon-city': assetUrl('art/horizon-city.webp'),
  'horizon-valley': assetUrl('art/horizon-valley.webp'),
  'horizon-autumn': assetUrl('art/horizon-autumn.webp'),
  'horizon-lake': assetUrl('art/horizon-lake.webp'),
  'horizon-volcano': assetUrl('art/horizon-volcano.webp'),
  'horizon-finale': assetUrl('art/horizon-finale.webp'),
  // 600B world-tour horizons — gpt-image-2 panoramas of the REAL locations:
  // Cottonopolis mills, Old Prague's spires, Palma's La Seu, and the Taj Mahal
  // across its reflecting pool.
  'horizon-manchester': assetUrl('art/horizon-manchester.webp'),
  'horizon-prague': assetUrl('art/horizon-prague.webp'),
  'horizon-mallorca': assetUrl('art/horizon-mallorca.webp'),
  'horizon-tajmahal': assetUrl('art/horizon-tajmahal.webp'),
};

export class SpriteStore {
  private map = new Map<string, SpriteImage>();

  get(name: string): SpriteImage | null {
    const found = this.map.get(name);
    if (found) return found;
    const fallback = FALLBACKS[name];
    if (fallback) {
      const baked = fallback();
      this.map.set(name, baked);
      return baked;
    }
    return null;
  }

  set(name: string, sprite: SpriteImage): void {
    this.map.set(name, sprite);
  }

  has(name: string): boolean {
    return this.map.has(name);
  }
}

// Roadside sign texts — DNI-lore in-jokes. Each becomes a sign variant by
// compositing a legible plaque + text onto the generated (or fallback) sign.
// 'WE ARE NOT A CULT' graduated to the big billboards below.
export const SIGN_TEXTS = ['600.wtf', '4.20 AM', 'GM'] as const;

// Big-billboard texts — the 600 000 000 000 meme lore, writ large. The digits
// stack four rows deep, like the neon sign in the sticker art.
export const BILLBOARD_TEXTS = ['WE ARE\nNOT A CULT', '600\nBILLION', 'LET THEM EAT\n600 BILLION'] as const;

function drawFittedText(ctx: CanvasRenderingContext2D, lines: string[], cx: number, cy: number, maxW: number, maxH: number): void {
  const lineCount = lines.length;
  let size = maxH / lineCount;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (; size > 6; size -= 1) {
    ctx.font = `800 ${size}px 'Trebuchet MS', sans-serif`;
    if (lines.every(l => ctx.measureText(l).width <= maxW)) break;
  }
  const lh = size * 1.05;
  const startY = cy - ((lineCount - 1) * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lh));
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  art: SpriteImage,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const scale = Math.max(w / art.w, h / art.h);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (art.w - sw) / 2;
  const sy = (art.h - sh) / 2;
  ctx.drawImage(art.canvas, sx, sy, sw, sh, x, y, w, h);
}

function billboardFaceGradient(ctx: CanvasRenderingContext2D, top: string, bottom: string): void {
  const f = BILLBOARD_FACE;
  const g = ctx.createLinearGradient(f.x, f.y, f.x, f.y + f.h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(f.x, f.y, f.w, f.h);
}

/** Build sign-N variants by drawing each in-joke onto the billboard sprite. */
export function buildSignVariants(store: SpriteStore): string[] {
  const base = store.get('prop-sign');
  if (!base) return [];
  const names: string[] = [];
  SIGN_TEXTS.forEach((text, i) => {
    const name = `sign-${i}`;
    const { canvas, ctx } = makeCanvas(base.w, base.h);
    ctx.drawImage(base.canvas, 0, 0);
    // Plaque across the panel area (upper ~46% of the billboard).
    const pw = base.w * 0.86;
    const ph = base.h * 0.4;
    const px = (base.w - pw) / 2;
    const py = base.h * 0.05;
    ctx.fillStyle = 'rgba(10, 26, 34, 0.86)';
    ctx.strokeStyle = '#ffd76b';
    ctx.lineWidth = Math.max(2, base.w * 0.012);
    ctx.beginPath();
    const r = ph * 0.16;
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + pw, py, px + pw, py + ph, r);
    ctx.arcTo(px + pw, py + ph, px, py + ph, r);
    ctx.arcTo(px, py + ph, px, py, r);
    ctx.arcTo(px, py, px + pw, py, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffe9a8';
    drawFittedText(ctx, text.split('\n'), base.w / 2, py + ph / 2, pw * 0.86, ph * 0.7);
    store.set(name, { canvas, w: base.w, h: base.h });
    names.push(name);
  });
  return names;
}

/**
 * Build billboard variants as proper one-glance arcade posters rather than text
 * floating on black: strong colour fields, giant type, simple meme imagery and
 * — once loaded — two bespoke illustrated faces.
 */
export function buildBillboardVariants(store: SpriteStore): string[] {
  const base = store.get('prop-billboard');
  if (!base) return [];
  const f = BILLBOARD_FACE;
  const names: string[] = [];
  const make = (name: string, draw: (ctx: CanvasRenderingContext2D) => void): void => {
    const { canvas, ctx } = makeCanvas(base.w, base.h);
    ctx.drawImage(base.canvas, 0, 0);
    draw(ctx);
    store.set(name, { canvas, w: base.w, h: base.h });
    names.push(name);
  };
  // Cult disclaimer: red warning-stripe energy with a deliberately ridiculous
  // halo/rose seal. The joke is readable before the small details are.
  make('billboard-not-a-cult', ctx => {
    billboardFaceGradient(ctx, '#251035', '#090d18');
    ctx.save();
    ctx.translate(f.x + f.w * 0.2, f.y + f.h * 0.5);
    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, f.h * 0.31, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#e52d53';
    for (let i = 0; i < 10; i += 1) {
      ctx.rotate(Math.PI * 2 / 10);
      ctx.beginPath();
      ctx.ellipse(0, -f.h * 0.19, f.h * 0.08, f.h * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd76b';
    ctx.beginPath();
    ctx.arc(0, 0, f.h * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff4d6';
    ctx.shadowColor = '#ff4d6d';
    ctx.shadowBlur = 12;
    drawFittedText(ctx, BILLBOARD_TEXTS[0].split('\n'), f.x + f.w * 0.66, f.y + f.h * 0.5, f.w * 0.57, f.h * 0.68);
    ctx.shadowBlur = 0;
  });

  // The number itself gets a premium banknote / market-ticker treatment instead
  // of four cramped rows of digits.
  make('billboard-600-billion', ctx => {
    billboardFaceGradient(ctx, '#062b30', '#07131c');
    ctx.strokeStyle = 'rgba(143,230,196,0.24)';
    ctx.lineWidth = 2;
    for (let x = f.x - f.h; x < f.x + f.w + f.h; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, f.y + f.h);
      ctx.lineTo(x + f.h, f.y);
      ctx.stroke();
    }
    ctx.fillStyle = '#8fe6c4';
    ctx.font = `900 ${f.h * 0.67}px 'Trebuchet MS', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#16d6af';
    ctx.shadowBlur = 14;
    ctx.fillText('600', f.x + f.w * 0.31, f.y + f.h * 0.49);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd76b';
    drawFittedText(ctx, ['BILLION'], f.x + f.w * 0.72, f.y + f.h * 0.46, f.w * 0.48, f.h * 0.42);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${f.h * 0.105}px 'Trebuchet MS', sans-serif`;
    ctx.fillText('STILL NOT ENOUGH CAKE', f.x + f.w * 0.69, f.y + f.h * 0.77);
  });

  const donkeyCake = store.get('billboard-donkey-cake-art');
  if (donkeyCake) {
    make('billboard-donkey-cake', ctx => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(f.x, f.y, f.w, f.h);
      ctx.clip();
      drawImageCover(ctx, donkeyCake, f.x, f.y, f.w, f.h);
      const shade = ctx.createLinearGradient(f.x, f.y + f.h * 0.52, f.x, f.y + f.h);
      shade.addColorStop(0, 'rgba(0,0,0,0)');
      shade.addColorStop(1, 'rgba(0,0,0,0.88)');
      ctx.fillStyle = shade;
      ctx.fillRect(f.x, f.y, f.w, f.h);
      ctx.restore();
      ctx.fillStyle = '#fff4d6';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 8;
      drawFittedText(ctx, BILLBOARD_TEXTS[2].split('\n'), f.x + f.w / 2, f.y + f.h * 0.79, f.w * 0.9, f.h * 0.3);
      ctx.shadowBlur = 0;
    });
  }

  const art = store.get('billboard-rose-art');
  if (art) {
    make('billboard-rose', ctx => {
      billboardFaceGradient(ctx, '#1d0b0b', '#070a0d');
      const side = f.h * 0.9;
      ctx.save();
      ctx.beginPath();
      ctx.rect(f.x + 4, f.y + 4, side, f.h - 8);
      ctx.clip();
      drawImageCover(ctx, art, f.x + 4, f.y + 4, side, f.h - 8);
      ctx.restore();
      ctx.fillStyle = '#ff5d78';
      ctx.shadowColor = '#ff3b30';
      ctx.shadowBlur = 12;
      drawFittedText(ctx, ['THANKS', 'FOR BUYING', 'ROSE!'], f.x + f.w * 0.72, f.y + f.h * 0.5, f.w * 0.48, f.h * 0.68);
      ctx.shadowBlur = 0;
    });
  }
  return names;
}

/** Stamp "600.wtf" onto the petrol can's blank label (if the art loaded). */
export function brandPetrol(store: SpriteStore): void {
  const base = store.get('pickup-petrol');
  if (!base) return;
  const { canvas, ctx } = makeCanvas(base.w, base.h);
  ctx.drawImage(base.canvas, 0, 0);
  // The generated can's label sits roughly centred, a little below mid-height.
  const cx = base.w * 0.46;
  const cy = base.h * 0.54;
  ctx.fillStyle = '#c8102e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${base.h * 0.12}px 'Trebuchet MS', sans-serif`;
  ctx.fillText('600.wtf', cx, cy);
  store.set('pickup-petrol', { canvas, w: base.w, h: base.h });
}

export async function loadSpriteInto(store: SpriteStore, name: string): Promise<boolean> {
  const url = ART_URLS[name];
  if (!url) return false;
  const sprite = await (isFullBleed(name) ? loadFullBleed(url) : loadTrimmed(url)).catch(() => null);
  if (!sprite) return false;
  store.set(name, sprite);
  return true;
}

/**
 * Load every known art asset into `store` (best-effort; fallbacks cover
 * per-sprite failure). Loaded in small batches, not one big Promise.all: each
 * trimmed sprite still costs a main-thread pixel pass, and a hundred of them
 * landing at once froze phones for seconds. `onProgress` feeds a loading bar.
 */
export async function loadSpritesInto(store: SpriteStore, onProgress?: (done: number, total: number) => void): Promise<void> {
  // No skip-if-present filter: get() bakes code-drawn fallbacks into the map
  // (boot decorates tracks before art lands), and those must be OVERWRITTEN.
  const names = Object.keys(ART_URLS);
  const total = names.length;
  let done = 0;
  const CONCURRENCY = 4;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < names.length) {
      const name = names[next];
      next += 1;
      await loadSpriteInto(store, name).catch(() => undefined);
      done += 1;
      onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, worker));
}

/** Load every known art asset (best-effort); fall back per-sprite on failure. */
export async function loadSprites(): Promise<SpriteStore> {
  const store = new SpriteStore();
  await loadSpritesInto(store);
  return store;
}
