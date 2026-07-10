# Deployment

Public deployments are handled by GitHub Pages from `.github/workflows/pages.yml`.

Do not commit origin hosts, IP addresses, SSH users, Caddy vhosts, Cloudflare DNS
mode notes, or private release paths here. If a private VPS deployment is needed,
keep the host-specific config in a private repo or inject it through GitHub
Actions secrets.

## Score-claim service (game-signed leaderboard)

Gamestr scores are game-signed (like neon-sentinel/pallasite): the browser
POSTs a finished run to `/api/claim` with NIP-98 auth and the claim service
(`server/index.ts`) validates it, signs the kind-30762 with the game key and
publishes to the write relays. Without the service, scores stay local.

Build a self-contained bundle (nostr-tools inlined — the VPS only needs node):

```
npm run build:server        # → server-dist/index.js
```

On the VPS:

1. Copy `server-dist/index.js` somewhere stable (e.g. `/opt/hangonfren/api/`).
2. Create `/etc/hangonfren-api.env` (mode **0600**, owner root):

   ```
   HANGONFREN_GAME_NSEC=nsec1…        # REQUIRED — nsec-tree path hang-on-fren@0
   HANGONFREN_SITE_URL=https://…      # public play URL for the event's r/source tags
   HANGONFREN_ALLOWED_ORIGINS=https://…   # the public origin(s), comma-separated
   # HANGONFREN_API_PORT=3191
   # HANGONFREN_PUBLISH=0             # sign without publishing (testing)
   ```

   The service refuses to start if the nsec does not derive to the committed
   game npub (`HANGONFREN_GAME_NPUB` overrides the expected key for testing).

3. Systemd unit (`/etc/systemd/system/hangonfren-api.service`):

   ```ini
   [Unit]
   Description=Hang On, Fren score-claim service
   After=network-online.target

   [Service]
   ExecStart=/usr/bin/node /opt/hangonfren/api/index.js
   EnvironmentFile=/etc/hangonfren-api.env
   User=hangonfren
   StateDirectory=hangonfren
   Environment=HANGONFREN_DATA_DIR=/var/lib/hangonfren
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

4. Reverse-proxy `/api/*` on the public vhost to `127.0.0.1:3191` (keep the
   standard forwarded headers — NIP-98 validates the public URL). GitHub Pages
   deployments have no `/api`, so they gracefully keep scores local.

Local dev: `npm run dev:api` (builds + runs the service with publishing off)
alongside `npm run dev` — the vite dev server proxies `/api` to it.
