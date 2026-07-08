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

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

/** Load an image, erase sub-floor alpha, and trim to the opaque bounding box. */
async function loadTrimmed(url: string): Promise<SpriteImage | null> {
  const img = await new Promise<HTMLImageElement | null>(res => {
    const el = new Image();
    el.onload = () => res(el);
    el.onerror = () => res(null);
    el.src = url;
  });
  if (!img || !img.width) return null;

  const { canvas, ctx } = makeCanvas(img.width, img.height);
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
  stance: 'low' | 'mid' | 'tall';
  spoiler?: boolean;
  roundTail?: boolean;
  rust?: boolean;
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

function makeCarSprite(spec: CarSpec): SpriteImage {
  const { w, h } = spec;
  return bake(w, h, ctx => {
    const cx = w / 2;
    const bodyW = w * (spec.stance === 'low' ? 0.9 : spec.stance === 'tall' ? 0.78 : 0.84);
    const bx = cx - bodyW / 2;
    const tyreH = h * 0.2;
    const tyreW = w * 0.16;
    const groundY = h - 3;
    const bodyBottom = groundY - tyreH * 0.35;
    const bodyTop = h * (spec.stance === 'low' ? 0.5 : spec.stance === 'tall' ? 0.3 : 0.4);
    const cabTop = h * (spec.stance === 'low' ? 0.34 : spec.stance === 'tall' ? 0.12 : 0.22);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(cx, groundY, bodyW * 0.56, h * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();

    // rear tyres poking out below the body
    ctx.fillStyle = '#141414';
    roundRectPath(ctx, bx - w * 0.02, groundY - tyreH, tyreW, tyreH, 4);
    ctx.fill();
    roundRectPath(ctx, bx + bodyW - tyreW + w * 0.02, groundY - tyreH, tyreW, tyreH, 4);
    ctx.fill();

    // cabin / roof (narrower than the body)
    const cabW = bodyW * (spec.stance === 'low' ? 0.72 : 0.84);
    ctx.fillStyle = spec.roof;
    roundRectPath(ctx, cx - cabW / 2, cabTop, cabW, bodyTop - cabTop + h * 0.05, w * 0.05);
    ctx.fill();
    // rear glass
    ctx.fillStyle = spec.glass;
    roundRectPath(ctx, cx - cabW * 0.4, cabTop + (bodyTop - cabTop) * 0.2, cabW * 0.8, (bodyTop - cabTop) * 0.5, w * 0.03);
    ctx.fill();

    // main body
    ctx.fillStyle = spec.body;
    roundRectPath(ctx, bx, bodyTop, bodyW, bodyBottom - bodyTop, w * 0.06);
    ctx.fill();
    // lower shading
    ctx.fillStyle = spec.bodyDark;
    ctx.fillRect(bx, bodyBottom - (bodyBottom - bodyTop) * 0.3, bodyW, (bodyBottom - bodyTop) * 0.3);

    // tail lights
    ctx.fillStyle = spec.tail;
    const tlY = bodyTop + (bodyBottom - bodyTop) * 0.28;
    const tlH = (bodyBottom - bodyTop) * 0.22;
    if (spec.roundTail) {
      ctx.beginPath();
      ctx.arc(bx + bodyW * 0.17, tlY + tlH / 2, tlH * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx + bodyW * 0.83, tlY + tlH / 2, tlH * 0.62, 0, Math.PI * 2);
      ctx.fill();
    } else {
      roundRectPath(ctx, bx + bodyW * 0.07, tlY, bodyW * 0.24, tlH, 3);
      ctx.fill();
      roundRectPath(ctx, bx + bodyW * 0.69, tlY, bodyW * 0.24, tlH, 3);
      ctx.fill();
    }

    // bumper / trim strip
    ctx.fillStyle = spec.trim;
    ctx.fillRect(bx, bodyBottom - (bodyBottom - bodyTop) * 0.12, bodyW, (bodyBottom - bodyTop) * 0.12);

    if (spec.spoiler) {
      ctx.fillStyle = spec.bodyDark;
      const spY = bodyTop - h * 0.07;
      ctx.fillRect(cx - bodyW * 0.46, spY, bodyW * 0.92, h * 0.035);
      ctx.fillRect(cx - bodyW * 0.36, spY, w * 0.035, h * 0.07);
      ctx.fillRect(cx + bodyW * 0.33, spY, w * 0.035, h * 0.07);
    }

    if (spec.rust) {
      ctx.fillStyle = 'rgba(92,52,26,0.55)';
      ctx.beginPath();
      ctx.arc(bx + bodyW * 0.26, bodyBottom - 6, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx + bodyW * 0.72, bodyTop + 9, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // dark arcade outline
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(2, w * 0.014);
    roundRectPath(ctx, bx, bodyTop, bodyW, bodyBottom - bodyTop, w * 0.06);
    ctx.stroke();
  });
}

const CAR_SPECS: Record<string, CarSpec> = {
  'car-lambo': { w: 162, h: 96, body: '#ffcf1a', bodyDark: '#c99b00', roof: '#1b1b24', glass: '#2b3048', tail: '#ff3b3b', trim: '#111', stance: 'low', spoiler: true },
  'car-ferrari': { w: 158, h: 98, body: '#e01122', bodyDark: '#9c0a16', roof: '#2a0e12', glass: '#3a2030', tail: '#ff6161', trim: '#111', stance: 'low', spoiler: true, roundTail: true },
  'car-porsche': { w: 150, h: 100, body: '#d9dee4', bodyDark: '#9aa0a8', roof: '#c2c8ce', glass: '#2b3040', tail: '#e23b3b', trim: '#333', stance: 'mid', spoiler: true, roundTail: true },
  'car-bentley': { w: 150, h: 116, body: '#123f2e', bodyDark: '#0c2a1f', roof: '#0e3325', glass: '#274850', tail: '#e04b4b', trim: '#c9b981', stance: 'tall' },
  'car-banger': { w: 150, h: 112, body: '#7a6a45', bodyDark: '#584c31', roof: '#6a5c3d', glass: '#38402f', tail: '#c05a3a', trim: '#3a3a3a', stance: 'mid', rust: true },
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
  'prop-gate': fallbackGate,
  'prop-finish': fallbackFinish,
  'prop-sign': fallbackSign,
  'car-classic': fallbackCar,
  'car-van': fallbackCar,
  'scooter-rival': fallbackCar,
  'car-lambo': () => makeCarSprite(CAR_SPECS['car-lambo']),
  'car-ferrari': () => makeCarSprite(CAR_SPECS['car-ferrari']),
  'car-porsche': () => makeCarSprite(CAR_SPECS['car-porsche']),
  'car-bentley': () => makeCarSprite(CAR_SPECS['car-bentley']),
  'car-banger': () => makeCarSprite(CAR_SPECS['car-banger']),
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
};

const ART_URLS: Record<string, string> = {
  'hero-straight': assetUrl('art/hero-straight.png'),
  'hero-lean-left': assetUrl('art/hero-lean-left.png'),
  'hero-lean-right': assetUrl('art/hero-lean-right.png'),
  'hero-wipeout': assetUrl('art/hero-wipeout.png'),
  'car-classic': assetUrl('art/car-classic.png'),
  'car-van': assetUrl('art/car-van.png'),
  'scooter-rival': assetUrl('art/scooter-rival.png'),
  'car-lambo': assetUrl('art/car-lambo.png'),
  'car-ferrari': assetUrl('art/car-ferrari.png'),
  'car-porsche': assetUrl('art/car-porsche.png'),
  'car-bentley': assetUrl('art/car-bentley.png'),
  'car-banger': assetUrl('art/car-banger.png'),
  'prop-palm': assetUrl('art/prop-palm.png'),
  'prop-coconut': assetUrl('art/prop-coconut.png'),
  'prop-cypress': assetUrl('art/prop-cypress.png'),
  'prop-pine': assetUrl('art/prop-pine.png'),
  'prop-fir': assetUrl('art/prop-fir.png'),
  'prop-blossom': assetUrl('art/prop-blossom.png'),
  'prop-lamp': assetUrl('art/prop-lamp.png'),
  'prop-parasol': assetUrl('art/prop-parasol.png'),
  'prop-flowers': assetUrl('art/prop-flowers.png'),
  'prop-villa': assetUrl('art/prop-villa.png'),
  'prop-beachhut': assetUrl('art/prop-beachhut.png'),
  'prop-chalet': assetUrl('art/prop-chalet.png'),
  'prop-cactus': assetUrl('art/prop-cactus.png'),
  'prop-adobe': assetUrl('art/prop-adobe.png'),
  'prop-neon': assetUrl('art/prop-neon.png'),
  'prop-skyscraper': assetUrl('art/prop-skyscraper.png'),
  'prop-pagoda': assetUrl('art/prop-pagoda.png'),
  'prop-maple': assetUrl('art/prop-maple.png'),
  'prop-barn': assetUrl('art/prop-barn.png'),
  'prop-reed': assetUrl('art/prop-reed.png'),
  'prop-lighthouse': assetUrl('art/prop-lighthouse.png'),
  'prop-deadtree': assetUrl('art/prop-deadtree.png'),
  'prop-lavarock': assetUrl('art/prop-lavarock.png'),
  'prop-gate': assetUrl('art/prop-gate.png'),
  'prop-finish': assetUrl('art/prop-finish.png'),
  'prop-sign': assetUrl('art/prop-sign.png'),
  rose: assetUrl('pickups/600b/rose.png'),
  'pickup-petrol': assetUrl('art/pickup-petrol.png'),
  'pickup-shield': assetUrl('art/pickup-shield.png'),
  'pickup-cake': assetUrl('pickups/600b/cake-piece-1.png'),
  'pickup-wholecake': assetUrl('pickups/600b/whole-cake.png'),
  'title-art': assetUrl('art/title-art-orig.png'),
  // Opaque biome backdrops → JPEG (no alpha needed; ~6× smaller than PNG). One
  // panorama per region; the renderer crossfades between adjacent ones at the
  // checkpoint. Amalfi reuses the existing day panorama.
  'horizon-riviera': assetUrl('art/horizon-day.jpg'),
  'horizon-beach': assetUrl('art/horizon-beach.jpg'),
  'horizon-alpine': assetUrl('art/horizon-alpine.jpg'),
  'horizon-desert': assetUrl('art/horizon-desert.jpg'),
  'horizon-city': assetUrl('art/horizon-city.jpg'),
  'horizon-valley': assetUrl('art/horizon-valley.jpg'),
  'horizon-autumn': assetUrl('art/horizon-autumn.jpg'),
  'horizon-lake': assetUrl('art/horizon-lake.jpg'),
  'horizon-volcano': assetUrl('art/horizon-volcano.jpg'),
  'horizon-finale': assetUrl('art/horizon-finale.jpg'),
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

// Roadside billboard texts — DNI-lore in-jokes. Each becomes a sign variant by
// compositing a legible plaque + text onto the generated (or fallback) sign.
export const SIGN_TEXTS = ['600.wtf', '4.20 AM', 'GM', 'WE ARE\nNOT A CULT'] as const;

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

/** Load every known art asset into `store` (best-effort); fall back per-sprite on failure. */
export async function loadSpritesInto(store: SpriteStore): Promise<void> {
  await Promise.all(
    Object.entries(ART_URLS).map(async ([name, url]) => {
      const sprite = await loadTrimmed(url).catch(() => null);
      if (sprite) store.set(name, sprite);
    }),
  );
}

/** Load every known art asset (best-effort); fall back per-sprite on failure. */
export async function loadSprites(): Promise<SpriteStore> {
  const store = new SpriteStore();
  await loadSpritesInto(store);
  return store;
}
