# Deployment

Public deployments are handled by GitHub Pages from `.github/workflows/pages.yml`.

Do not commit origin hosts, IP addresses, SSH users, Caddy vhosts, Cloudflare DNS
mode notes, or private release paths here. If a private VPS deployment is needed,
keep the host-specific config in a private repo or inject it through GitHub
Actions secrets.
