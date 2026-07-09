# Hang On, Fren

A browser arcade racer built with Vite, TypeScript, Canvas2D, generated art, and
local-only high scores.

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
