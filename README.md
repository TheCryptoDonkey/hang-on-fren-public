# Hang On, Fren

A browser arcade racer built with Vite, TypeScript, Canvas2D, generated art, and
local-only high scores.

The main run is a 42 km grand tour through ten 4.2 km regions. Its 10.4 km road
loop includes two blind-summit traps and the two-kilometre Billion Bend: a long
tightening left that snaps through a hard transition into a long right.

The opening three regions form a 12.6 km Fren Rival Tour against a persistent
red-helmet rider, with live gaps and checkpoint ranks. Clean overtakes, near
misses, pickups, and slipstream slingshots build FREN FLOW for up to a 2× action
score multiplier; wipeouts break the chain, but the full grand tour continues.

A second journey, the 600B WORLD TOUR, rides the conference circuit: 16.8 km
through historical Manchester (Cottonopolis mills), Old Prague (the
astronomical clock), Old Mallorca (Tramuntana windmills), and a Taj Mahal
finale drenched in roses. Pick the tour from the title screen (▲▼ / T or tap);
the choice persists locally. Some regions carry bespoke music beds — the
Amalfi opener and all four world-tour cities — switching on the checkpoint.

Double-tapping `+` mid-run skips to the next level. It's a cheat and the game
treats it as one: a cheated run keeps its local score but is never submitted
to gamestr.

## Development

```sh
npm ci
npm run dev
```

## Checks

```sh
npm test
npm run build
```

## Support

Hang On, Fren follows a value-for-value model. Support links are optional and
separate from gameplay score:

- Lightning: `profusemeat89@walletofsatoshi.com`
- Geyser: <https://geyser.fund/project/forgesworn?hero=geyserannually1>
- Ko-fi: <https://ko-fi.com/brays>

The same links are available on the public support page at `/support.html`.

## Deployment

The public repo deploys to GitHub Pages through `.github/workflows/pages.yml`.
The workflow builds the static Vite app and publishes `dist/`; it does not need
SSH keys, server IPs, Caddy config, or Cloudflare origin details.

Private deployment topology belongs outside this repo.

## Art Sources

The shipped game art lives under `public/`. Local source/reference material in
`.art-ref/` and `art-originals/` is ignored by git and is not required to play
or build the game.

## License

MIT. See [LICENSE](LICENSE).
