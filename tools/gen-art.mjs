// Reproducible art generation for Hang On, Fren.
//
// Sprites (need alpha) use gpt-image-1.5 with background=transparent.
// gpt-image-2 does NOT support transparent backgrounds, so it is used only for
// the opaque title/key art.
//
// Usage:
//   node tools/gen-art.mjs                 # generate any missing assets
//   node tools/gen-art.mjs --only hero     # only assets whose name starts "hero"
//   node tools/gen-art.mjs --force         # regenerate even if the file exists
//
// The game runs without these files (code-drawn fallbacks), so generation is
// always optional and safe to re-run.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'public/art');

const KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;
if (!KEY) {
  console.error('No OPENAI_API_KEY / OPEN_API_KEY in env.');
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

const SPRITE_STYLE =
  'Clean cel-shaded pixel-art arcade sprite, bold dark outlines, bright saturated Sega OutRun / Hang-On colours, ' +
  'transparent background, NO ground, NO drop shadow, NO text, subject centred and fully in frame.';

// name -> spec. ref: array of image paths (relative to ROOT) for edits; absent = generation.
const ASSETS = [
  {
    name: 'hero-straight', model: 'gpt-image-1.5', size: '1024x1024', quality: 'high', ref: ['.art-ref/dni.jpeg'],
    prompt:
      'Retro arcade racing-game sprite of THIS man riding a pastel mint-green Vespa scooter, seen from directly BEHIND ' +
      '(rear view — we see his back and the back of the scooter). Keep his likeness: long reddish-brown hair streaming ' +
      'back in the wind, full bushy beard, all-black t-shirt and black shorts, black sandals, a black crossbody bag ' +
      'strap across his back. Perfectly UPRIGHT and CENTRED, riding straight ahead, consistent full-body scale, the ' +
      'WHOLE scooter visible including BOTH round wheels at the bottom. ' + SPRITE_STYLE,
  },
  {
    name: 'hero-lean-left', model: 'gpt-image-1.5', size: '1024x1024', ref: ['public/art/hero-straight.png'],
    prompt:
      'The SAME rear-view character on the SAME mint-green Vespa scooter, now LEANING to his LEFT into a left-hand bend: ' +
      'rider and scooter tilted to the left, hair blown to one side, weight into the corner. Same likeness, same colours. ' + SPRITE_STYLE,
  },
  {
    name: 'hero-lean-right', model: 'gpt-image-1.5', size: '1024x1024', ref: ['public/art/hero-straight.png'],
    prompt:
      'The SAME rear-view character on the SAME mint-green Vespa scooter, now LEANING to his RIGHT into a right-hand bend: ' +
      'rider and scooter tilted to the right, hair blown to one side, weight into the corner. Same likeness, same colours. ' + SPRITE_STYLE,
  },
  {
    name: 'hero-wipeout', model: 'gpt-image-1.5', size: '1024x1024', ref: ['public/art/hero-straight.png'],
    prompt:
      'The SAME character crashing off the SAME mint-green Vespa: comedic arcade wipeout, scooter tipping over, rider ' +
      'tumbling with arms and long hair flailing, still clearly recognisable, all-black outfit. Rear/side view. ' + SPRITE_STYLE,
  },
  {
    name: 'pickup-petrol', model: 'gpt-image-1.5', size: '1024x1024',
    prompt:
      'A bright glossy RED metal jerry can / petrol fuel can standing upright, with a carry handle on top and a pour ' +
      'spout, and a clean blank cream rectangular label panel on the front face (leave the label BLANK, no text). ' +
      'Viewed straight on from a slight low angle, centred. ' + SPRITE_STYLE,
  },
  {
    name: 'pickup-shield', model: 'gpt-image-1.5', size: '1024x1024',
    prompt:
      'A bright arcade power-up SHIELD pickup: a classic heater-style shield with a thick glossy GOLD rim, a deep ' +
      'teal-blue face and a large gleaming CYAN DIAMOND gem set in the centre (a diamond-hands emblem), with a couple ' +
      'of tiny white sparkle glints. Viewed straight on, centred. ' + SPRITE_STYLE,
  },
  {
    name: 'car-classic', model: 'gpt-image-1.5', size: '1024x1024',
    prompt:
      'Rear view of a small cute classic Italian city car (Fiat 500 style) in cream and coral red, tail lights lit, ' +
      'as seen by a rider catching up behind it on the road. ' + SPRITE_STYLE,
  },
  {
    name: 'car-van', model: 'gpt-image-1.5', size: '1024x1024',
    prompt:
      'Rear view of a small vintage pastel-blue Piaggio Ape three-wheeler delivery van stacked with flower crates, ' +
      'as seen by a rider catching up behind it. ' + SPRITE_STYLE,
  },
  {
    name: 'scooter-rival', model: 'gpt-image-1.5', size: '1024x1024',
    prompt:
      'Rear view of a vintage cream Vespa scooter ridden by a generic rider in a red open-face helmet and blue jacket, ' +
      'seen from behind on the road. ' + SPRITE_STYLE,
  },
  // OutRun-style traffic classes (rear view — we always catch cars up from behind).
  {
    name: 'car-banger', model: 'gpt-image-1.5', size: '1024x1024',
    prompt:
      'Rear view of a battered rusty old brown hatchback banger — dents, mismatched panels, a little exhaust smoke — ' +
      'a scruffy bear-market beater, seen by a rider catching it up from behind. ' + SPRITE_STYLE,
  },
  {
    name: 'car-porsche', model: 'gpt-image-1.5', size: '1024x1024',
    prompt:
      'Rear view of a curvy silver German sports coupe (911 style) with round twin tail lights and a ducktail spoiler, ' +
      'seen by a rider catching it up from behind. ' + SPRITE_STYLE,
  },
  {
    name: 'car-bentley', model: 'gpt-image-1.5', size: '1024x1024',
    prompt:
      'Rear view of a large stately British luxury saloon in deep british-racing-green with chrome bumpers and tall ' +
      'rectangular tail lights, seen by a rider catching it up from behind. ' + SPRITE_STYLE,
  },
  {
    name: 'car-ferrari', model: 'gpt-image-1.5', size: '1024x1024',
    prompt:
      'Rear view of a sleek low bright-red Italian supercar with round twin tail lights and a subtle rear spoiler, ' +
      'seen by a rider catching it up from behind. ' + SPRITE_STYLE,
  },
  {
    name: 'car-lambo', model: 'gpt-image-1.5', size: '1024x1024',
    prompt:
      'Rear view of a wide, low, angular bright-yellow Italian supercar with a big rear wing, quad exhausts and slim ' +
      'red tail lights, seen by a rider catching it up from behind. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-palm', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A single tall Mediterranean palm tree, full height, roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-cypress', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A single tall dark-green Italian cypress tree, full height, roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-villa', model: 'gpt-image-1.5', size: '1024x1024',
    prompt:
      'A small pastel Amalfi-coast villa house with a terracotta roof and a couple of arched windows, roadside building. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-sign', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A retro road-side billboard sign on a post, blank coral-and-cream panel, no text, roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-pine', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A single Italian stone / umbrella pine tree: tall bare reddish trunk and a broad flat umbrella-shaped ' +
      'dark-green canopy on top, full height, roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-blossom', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A single flowering cherry-blossom tree in full bloom, round canopy of soft pink and white blossom, ' +
      'slender trunk, full height, roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-lamp', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A single ornate wrought-iron Mediterranean street lamp post, tall dark pole with a glowing warm-yellow ' +
      'lantern at the top, roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-parasol', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A single Italian seaside café sun parasol on a pole, dome canopy with alternating cream and red stripes, ' +
      'roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-flowers', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A low roadside flower bush bursting with bright red, pink and yellow Mediterranean flowers and green ' +
      'leaves, roadside decoration. ' + SPRITE_STYLE,
  },
  // TROPICO BAY (beach) scenery.
  {
    name: 'prop-coconut', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A single tall tropical COCONUT palm tree with a slender curved leaning trunk, a burst of long arching ' +
      'green fronds at the very top and a clutch of brown coconuts nestled under the crown, full height, roadside ' +
      'decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-beachhut', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A small tropical tiki BEACH BAR hut: open wooden counter on stilts with a shaggy golden THATCHED roof, ' +
      'a couple of bamboo posts, bright and cheerful, roadside building. ' + SPRITE_STYLE,
  },
  // ALPINE PASS (mountain) scenery.
  {
    name: 'prop-fir', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A single tall conical alpine FIR / spruce conifer, dark blue-green tiered branches heavily DUSTED WITH ' +
      'SNOW, a slim brown trunk, full height, roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-chalet', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A cosy Swiss timber alpine CHALET: warm brown log walls, a couple of glowing yellow windows and a deep ' +
      'steep pitched roof piled thick with SNOW, roadside building. ' + SPRITE_STYLE,
  },
  // DESERT MESA scenery.
  {
    name: 'prop-cactus', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A single tall green desert SAGUARO cactus with a thick ribbed trunk and a couple of upraised arms, ' +
      'full height, roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-adobe', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A small sun-baked ADOBE pueblo house: rounded earth-red clay walls, a flat roof with protruding wooden ' +
      'beams and a couple of small dark window openings, roadside building. ' + SPRITE_STYLE,
  },
  // NEON CITY scenery.
  {
    name: 'prop-neon', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A tall roadside NEON SIGN pylon on a slim dark post, a bright retro arcade sign glowing hot pink and ' +
      'electric cyan, night-city look, full height, roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-skyscraper', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A single tall glassy night-city SKYSCRAPER tower with rows of lit warm-yellow windows and pink and cyan ' +
      'neon accent stripes, full height, roadside building. ' + SPRITE_STYLE,
  },
  // CHERRY VALLEY scenery.
  {
    name: 'prop-pagoda', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A small ornate red-and-gold multi-tiered Japanese PAGODA temple with upturned tiled eaves, roadside ' +
      'building. ' + SPRITE_STYLE,
  },
  // AUTUMN FOREST scenery.
  {
    name: 'prop-maple', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A single AUTUMN MAPLE tree in full autumn colour: a round canopy of fiery red, orange and gold leaves ' +
      'on a slender brown trunk, full height, roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-barn', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A classic red countryside BARN with a pitched grey roof, white trim and a tall hayloft door, roadside ' +
      'building. ' + SPRITE_STYLE,
  },
  // SALT LAKE scenery.
  {
    name: 'prop-reed', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A tall clump of golden PAMPAS-GRASS reeds and bulrushes by the water, feathery cream plumes on slim ' +
      'stems, full height, roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-lighthouse', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A tall red-and-white striped LIGHTHOUSE with a glass lantern room glowing warm yellow at the top, ' +
      'roadside building. ' + SPRITE_STYLE,
  },
  // VOLCANO ROAD scenery.
  {
    name: 'prop-deadtree', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A single bare charred BLACK DEAD TREE with twisted leafless branches, scorched volcanic look, full ' +
      'height, roadside decoration. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-lavarock', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A rugged black volcanic LAVA ROCK outcrop with glowing molten orange cracks and a faint rising ' +
      'heat-glow, roadside decoration. ' + SPRITE_STYLE,
  },
  // Checkpoint + finish gates — wide arches you drive THROUGH; the open middle
  // must be see-through so the road shows between the posts.
  {
    name: 'prop-gate', model: 'gpt-image-1.5', size: '1536x1024',
    prompt: 'A wide arcade CHECKPOINT ARCH that spans a road: two sturdy bright striped posts, one at the far left ' +
      'and one at the far right, joined by a bold horizontal banner across the very top. The whole MIDDLE is OPEN and ' +
      'empty (see-through) so a vehicle can drive between the posts and under the banner. Bright chevron-striped, no ' +
      'text. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-finish', model: 'gpt-image-1.5', size: '1536x1024',
    prompt: 'A wide racing FINISH-LINE ARCH that spans a road: two posts at the far left and far right joined by a ' +
      'horizontal banner across the very top, the posts and banner covered in a bold BLACK-AND-WHITE CHECKERED flag ' +
      'pattern. The whole MIDDLE is OPEN and empty (see-through) so a vehicle can drive between the posts and under ' +
      'the banner. No text. ' + SPRITE_STYLE,
  },
  {
    name: 'finish-line-girls', model: 'gpt-image-1.5', size: '1536x1024', quality: 'high',
    prompt:
      'Three glamorous adult women, all clearly age 25 or older, celebrating at a Mediterranean road-race finish ' +
      'line. Full-body standing group with all feet on one baseline: fashionable bright bikinis with tasteful opaque ' +
      'coverage, white boots and flower accessories; one waves a black-and-white checkered racing flag while the ' +
      'others cheer and wave. Confident, playful, non-explicit pin-up energy, lively distinct poses, crisp hand-pixeled ' +
      '32-bit late-1980s/early-1990s Japanese racing-cabinet character art, chunky readable colour clusters. Every ' +
      'character must unmistakably be an adult; no nudity, no transparent fabric, no explicit sexual pose. ' + SPRITE_STYLE,
  },
  // Horizon backdrops — one per time of day. Wide Amalfi-coast panoramas with a
  // clean central horizon line; the renderer crossfades between them by distance
  // and scrolls them for parallax. Opaque, so gpt-image-2.
  // NOTE: after generating, horizon PNGs are converted to JPEG for the web (the
  // game loads horizon-*.jpg — see ART_URLS) and the source PNG deleted. The
  // biome backdrops are: riviera(=day) beach alpine desert city valley autumn
  // lake volcano finale. GOTCHA: the skip-check tests for <name>.png, but these
  // ship as .jpg, so a no-force run REGENERATES the old day/sunset/night/dawn/
  // beach/alpine PNGs too — delete those stray PNGs WITHOUT reconverting (their
  // jpgs are already shipped). Convert only the NEW ones:
  //   for f in desert city valley autumn lake volcano finale; do \
  //     sips -Z 1280 -s format jpeg -s formatOptions 86 public/art/horizon-$f.png \
  //     --out public/art/horizon-$f.jpg && rm public/art/horizon-$f.png; done
  //   rm -f public/art/horizon-{day,sunset,night,dawn,beach,alpine}.png
  // Sprites (props/hero/cars) are likewise downscaled to 512px: sips -Z 512 public/art/<name>.png
  ...['day', 'sunset', 'night', 'dawn'].map(tod => {
    const sky = {
      day: 'a bright clear cerulean-blue daytime sky with a small blazing white sun high up',
      sunset: 'a vivid orange, coral and pink sunset sky with a large low golden sun sitting just above the horizon',
      night: 'a deep navy starry night sky with a big pale full moon and its reflection on the water, the town windows glowing warm',
      dawn: 'a soft pastel pink and lavender dawn sky with a pale rising sun low over the sea',
    }[tod];
    const sea = { day: 'deep sparkling blue', sunset: 'warm coppery orange', night: 'dark moonlit navy', dawn: 'calm pink-tinged silver' }[tod];
    return {
      name: `horizon-${tod}`, model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
      prompt:
        `Wide panoramic arcade-game background illustration of the Italian Amalfi coast seen across a bay. A ${sea} sea ` +
        `meets ${sky} along a single straight HORIZON LINE running horizontally across the VERTICAL MIDDLE of the image. ` +
        'Behind the water, layered hazy coastal mountains, and on the LEFT a pastel cliff-side town of stacked terracotta-' +
        'roofed houses tumbling down the headland to the water. Flat, clean, bright saturated Sega OutRun / Hang-On style ' +
        'illustration. NO road, NO cars, NO people, NO foreground objects, NO text, NO watermark, NO frame or border.',
    };
  }),
  // Biome horizon backdrops for the two NEW regions (Amalfi reuses horizon-day).
  // Same framing rules as above: a single straight horizon across the vertical
  // middle, no road/cars/people/foreground/text. Converted to JPEG like the rest.
  {
    name: 'horizon-beach', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of a bright TROPICAL BAY. A vivid turquoise-and-jade lagoon ' +
      'meets a clear sunny sky along a single straight HORIZON LINE running horizontally across the VERTICAL MIDDLE of ' +
      'the image. On the far shore a low headland fringed with COCONUT PALMS and a strip of white sand; a couple of soft ' +
      'fair-weather clouds. Flat, clean, bright saturated Sega OutRun / Hang-On style illustration. NO road, NO cars, ' +
      'NO people, NO foreground objects, NO text, NO watermark, NO frame or border.',
  },
  {
    name: 'horizon-alpine', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of a cold ALPINE valley. Jagged SNOW-CAPPED mountain peaks ' +
      'under a crisp pale blue winter sky meet the land along a single straight HORIZON LINE running horizontally across ' +
      'the VERTICAL MIDDLE of the image. Dark green SNOW-DUSTED pine forest on the lower slopes, hazy far ranges behind. ' +
      'Flat, clean, bright saturated Sega OutRun / Hang-On style illustration. NO road, NO cars, NO people, NO ' +
      'foreground objects, NO text, NO watermark, NO frame or border.',
  },
  // Horizon backdrops for regions 4–10 of the ten-level journey. Same framing
  // rules throughout: a single straight horizon across the vertical middle, no
  // road/cars/people/foreground/text. Converted to JPEG like the rest.
  {
    name: 'horizon-desert', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of a hot DESERT MESA landscape. Towering red-orange sandstone ' +
      'BUTTES and flat-topped mesas on the far horizon under a hazy pale-blue desert sky meet the sandy plain along a ' +
      'single straight HORIZON LINE running horizontally across the VERTICAL MIDDLE of the image. A few distant tall ' +
      'saguaro cacti, warm dusty haze. Flat, clean, bright saturated Sega OutRun / Hang-On style illustration. NO road, ' +
      'NO cars, NO people, NO foreground objects, NO text, NO watermark, NO frame or border.',
  },
  {
    name: 'horizon-city', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of a NEON NIGHT CITY skyline. A silhouette of glowing ' +
      'skyscrapers with pink, cyan and gold lit windows and neon signs, under a deep purple starry night sky, meets the ' +
      'ground along a single straight HORIZON LINE running horizontally across the VERTICAL MIDDLE of the image. Retro ' +
      'synthwave glow on the horizon. Flat, clean, saturated Sega OutRun style illustration. NO road, NO cars, NO ' +
      'people, NO foreground objects, NO text, NO watermark, NO frame or border.',
  },
  {
    name: 'horizon-valley', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of a lush green CHERRY-BLOSSOM VALLEY. Rolling green hills ' +
      'covered in soft pink and white flowering cherry trees, a distant snow-tipped peak, under a bright clear blue ' +
      'spring sky, meeting along a single straight HORIZON LINE running horizontally across the VERTICAL MIDDLE of the ' +
      'image. Flat, clean, bright saturated Sega OutRun style illustration. NO road, NO cars, NO people, NO foreground ' +
      'objects, NO text, NO watermark, NO frame or border.',
  },
  {
    name: 'horizon-autumn', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of an AUTUMN FOREST landscape. Rolling hills of fiery red, ' +
      'orange and gold autumn trees under a soft hazy amber sky, distant blue ridges behind, meeting along a single ' +
      'straight HORIZON LINE running horizontally across the VERTICAL MIDDLE of the image. Flat, clean, warm saturated ' +
      'Sega OutRun style illustration. NO road, NO cars, NO people, NO foreground objects, NO text, NO watermark, NO ' +
      'frame or border.',
  },
  {
    name: 'horizon-lake', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of a still PINK SALT LAKE and mirror flats. A mirror-calm ' +
      'lilac-and-turquoise lake reflecting distant soft pastel mountains under a hazy pale sky, meeting along a single ' +
      'straight HORIZON LINE running horizontally across the VERTICAL MIDDLE of the image. Serene and pale. Flat, ' +
      'clean, saturated Sega OutRun style illustration. NO road, NO cars, NO people, NO foreground objects, NO text, ' +
      'NO watermark, NO frame or border.',
  },
  {
    name: 'horizon-volcano', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of a dramatic VOLCANO landscape. A dark smoking volcanic peak ' +
      'streaked with glowing orange lava under an ashen red-and-charcoal sky, black lava fields, meeting along a single ' +
      'straight HORIZON LINE running horizontally across the VERTICAL MIDDLE of the image. Moody, with an ember glow on ' +
      'the horizon. Flat, clean, saturated Sega OutRun style illustration. NO road, NO cars, NO people, NO foreground ' +
      'objects, NO text, NO watermark, NO frame or border.',
  },
  {
    name: 'horizon-finale', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of a triumphant GOLDEN-HOUR RIVIERA coast. A sparkling ' +
      'deep-blue sea under a glorious warm golden sunset sky with soft rainbow-tinged clouds, lush green headlands and ' +
      'pastel villas on the LEFT, meeting along a single straight HORIZON LINE running horizontally across the VERTICAL ' +
      'MIDDLE of the image. Joyful, warm, celebratory. Flat, clean, bright saturated Sega OutRun style illustration. ' +
      'NO road, NO cars, NO people, NO foreground objects, NO text, NO watermark, NO frame or border.',
  },
  // Horizon backdrops for the 600B WORLD TOUR (the conference circuit): REAL
  // locations, same framing rules as every other panorama. Converted to JPEG
  // like the rest (see the sips one-liner above).
  {
    name: 'horizon-manchester', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of HISTORICAL VICTORIAN MANCHESTER, England — Cottonopolis. ' +
      'A skyline of red-brick COTTON MILLS with sawtooth roofs, tall smoking factory chimneys and a Victorian gothic ' +
      'clock tower, behind a calm dark CANAL, under a soft pale overcast silver-and-amber industrial sky, meeting along ' +
      'a single straight HORIZON LINE running horizontally across the VERTICAL MIDDLE of the image. Warm gaslight glow ' +
      'in a few mill windows. Flat, clean, saturated Sega OutRun style illustration. NO road, NO cars, NO people, NO ' +
      'foreground objects, NO text, NO watermark, NO frame or border.',
  },
  {
    name: 'horizon-prague', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of OLD PRAGUE, the city of a hundred spires, in warm golden ' +
      'light. The Vltava river with the arched stone CHARLES BRIDGE and its statues, and behind it a skyline of gothic ' +
      'needle SPIRES, baroque green domes, terracotta rooftops and Prague Castle on its hill, under a golden late-' +
      'afternoon sky, meeting along a single straight HORIZON LINE running horizontally across the VERTICAL MIDDLE of ' +
      'the image. Flat, clean, bright saturated Sega OutRun style illustration. NO road, NO cars, NO people, NO ' +
      'foreground objects, NO text, NO watermark, NO frame or border.',
  },
  {
    name: 'horizon-mallorca', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of HISTORIC MALLORCA, Spain. The bright turquoise ' +
      'Mediterranean bay of Palma with the great sandstone gothic LA SEU CATHEDRAL rising on the shoreline, honey-' +
      'coloured old town walls, a couple of old stone WINDMILLS on the headland and the hazy Tramuntana mountains ' +
      'behind, under a brilliant clear blue summer sky, meeting along a single straight HORIZON LINE running ' +
      'horizontally across the VERTICAL MIDDLE of the image. Flat, clean, bright saturated Sega OutRun style ' +
      'illustration. NO road, NO cars, NO people, NO foreground objects, NO text, NO watermark, NO frame or border.',
  },
  {
    name: 'horizon-tajmahal', model: 'gpt-image-2', size: '1536x1024', background: 'opaque',
    prompt:
      'Wide panoramic arcade-game background illustration of the TAJ MAHAL at rose-pink dawn. The white-marble ' +
      'mausoleum with its great onion dome and four minarets glowing softly, mirrored in the long still REFLECTING ' +
      'POOL, flanked by dark cypress trees and lush gardens bursting with RED ROSES, under a soft pink-and-gold dawn ' +
      'sky, meeting along a single straight HORIZON LINE running horizontally across the VERTICAL MIDDLE of the image. ' +
      'Serene and romantic. Flat, clean, saturated Sega OutRun style illustration. NO road, NO cars, NO people, NO ' +
      'foreground objects, NO text, NO watermark, NO frame or border.',
  },
  // 600B WORLD TOUR roadside landmarks (one per conference city).
  {
    name: 'prop-mill', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A Victorian red-brick Manchester COTTON MILL building with a sawtooth roof, rows of warm lit windows and ' +
      'one tall round brick chimney with a wisp of smoke, roadside building. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-clocktower', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'A gothic stone Prague clock tower with an ornate ASTRONOMICAL CLOCK dial in gold and deep blue on its ' +
      'face and a steep verdigris-green spire with gilt finial, full height, roadside building. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-windmill', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'An old Mallorcan STONE WINDMILL: a round tapered rubble-stone tower with a small conical cap and four ' +
      'wooden lattice sails, sun-baked and rustic, full height, roadside building. ' + SPRITE_STYLE,
  },
  {
    name: 'prop-tajmahal', model: 'gpt-image-1.5', size: '1024x1024',
    prompt: 'The TAJ MAHAL in miniature as a roadside landmark: white marble mausoleum on its plinth with a great ' +
      'onion dome, pointed arch portal and four slender minarets, beds of bright red roses along the base, roadside ' +
      'building. ' + SPRITE_STYLE,
  },
  {
    name: 'title-art-orig', model: 'gpt-image-2', size: '1536x1024', background: 'opaque', ref: ['.art-ref/dni.jpeg'],
    prompt:
      'Vibrant Sega OutRun / Hang-On style arcade key art. THIS man — long reddish-brown hair, full beard, all-black ' +
      't-shirt and shorts, black sandals, black crossbody bag — rides a pastel mint-green Vespa scooter toward camera ' +
      'along a sunny Italian Amalfi-coast clifftop road strewn with bright red roses, deep blue sea and pastel villas ' +
      'behind, warm golden light, dynamic speed lines. Leave clear sky space across the top third for a title. ' +
      'Bright, saturated, joyful, cinematic. No text.',
  },
];

mkdirSync(OUT, { recursive: true });

async function generate(spec) {
  const outPath = resolve(OUT, `${spec.name}.png`);
  if (!force && existsSync(outPath)) {
    console.log(`skip  ${spec.name} (exists)`);
    return;
  }
  const isEdit = Array.isArray(spec.ref) && spec.ref.length > 0;
  // Sprites need alpha; only models that allow it get background=transparent.
  const background = spec.model === 'gpt-image-2' ? spec.background : spec.background || 'transparent';
  process.stdout.write(`gen   ${spec.name} (${spec.model}, ${isEdit ? 'edit' : 'generate'}) ... `);

  let res;
  if (isEdit) {
    // /v1/images/edits is multipart with the reference image(s).
    const form = new FormData();
    form.set('model', spec.model);
    form.set('prompt', spec.prompt);
    form.set('size', spec.size || '1024x1024');
    form.set('quality', spec.quality || 'high');
    if (background) form.set('background', background);
    for (const rel of spec.ref) {
      const p = resolve(ROOT, rel);
      if (!existsSync(p)) throw new Error(`reference image missing: ${rel} (generate its dependency first)`);
      const buf = readFileSync(p);
      const type = p.endsWith('.png') ? 'image/png' : 'image/jpeg';
      form.append('image[]', new Blob([buf], { type }), rel.split('/').pop());
    }
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}` },
      body: form,
    });
  } else {
    // /v1/images/generations is application/json.
    const body = {
      model: spec.model,
      prompt: spec.prompt,
      size: spec.size || '1024x1024',
      quality: spec.quality || 'high',
      ...(background ? { background } : {}),
    };
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  const json = await res.json();
  if (!json.data || !json.data[0]?.b64_json) {
    console.log('FAILED');
    console.error(JSON.stringify(json).slice(0, 400));
    throw new Error(`generation failed for ${spec.name}`);
  }
  writeFileSync(outPath, Buffer.from(json.data[0].b64_json, 'base64'));
  console.log(`ok (${json.usage?.total_tokens ?? '?'} tok)`);
}

const queue = ASSETS.filter(a => !only || a.name.startsWith(only));
console.log(`generating ${queue.length} asset(s)${only ? ` matching "${only}"` : ''}${force ? ' [force]' : ''}`);
for (const spec of queue) {
  try {
    await generate(spec);
  } catch (err) {
    console.error(`  ${err.message}`);
  }
}
console.log('done.');
