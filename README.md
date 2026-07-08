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

## Deployment

The public repo deploys to GitHub Pages through `.github/workflows/pages.yml`.
The workflow builds the static Vite app and publishes `dist/`; it does not need
SSH keys, server IPs, Caddy config, or Cloudflare origin details.

Private deployment topology belongs outside this repo.

## Art Sources

The shipped game art lives under `public/`. Local source/reference material in
`.art-ref/` and `art-originals/` is ignored by git and is not required to play
or build the game.
