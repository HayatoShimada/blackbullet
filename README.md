# BlackBullet

A tailnet-only front door for a web app. Only people who are on your [Tailscale](https://tailscale.com) network **and** on an allowlist can open it, and the app itself needs no login screen. You get a normal HTTPS name (`https://app.example.com`) with a real certificate, but the name resolves to a private tailnet address, so nothing is reachable from the public internet.

BlackBullet was written to sit in front of a self-hosted notes app such as [SilverBullet](https://silverbullet.md), but it works for any HTTP app in a Docker network. It is not affiliated with SilverBullet and contains none of its code.

```
tailnet device ─► dedicated tailnet node (tag:blackbullet), port 443
                    └ Caddy (TLS) ─► auth service ─► your app
```

- **Tailscale ACL** limits who can reach the node's port 443.
- The **auth service** asks `tailscaled` who is on the other end (`whois`) and lets only the logins in `ALLOWED_LOGINS` through. A second, independent check.
- Caddy **always drops** any `Tailscale-User-*` header sent by the client before adding the auth service's answer, so the app can trust `Tailscale-User-Login`. Tagged devices (no person) and anything outside the tailnet are refused.
- Certificates come from Let's Encrypt using the DNS-01 challenge (Cloudflare), so no inbound port is needed.

## Requirements
Docker + Docker Compose, a Tailscale account, a domain on Cloudflare, and an app that is already on a Docker network.

## Setup
1. **Tailscale ACL** — add a tag and allow your people to reach it (keep your existing rules):
   ```json
   "tagOwners": { "tag:blackbullet": ["autogroup:admin"] },
   "acls": [ { "action": "accept", "src": ["alice@example.com"], "dst": ["tag:blackbullet:443"] } ]
   ```
   Then **Settings → Keys → Generate auth key** with that tag, pre-approved.
2. **Cloudflare API token** — permissions `Zone / Zone / Read` **and** `Zone / DNS / Edit`, limited to your zone. (Without Zone Read, Caddy fails with `expected 1 zone, got 0`.)
3. **Configure and start** (try the staging CA first — see `.env.example`):
   ```bash
   cp .env.example .env && chmod 600 .env
   $EDITOR .env
   docker compose up -d
   docker compose logs -f caddy      # wait for "certificate obtained successfully"
   ```
4. **Check before touching DNS:**
   ```bash
   IP=$(tailscale ip -4 blackbullet)
   curl -sk --resolve app.example.com:443:$IP https://app.example.com/ -o /dev/null -w "%{http_code}\n"
   ```
5. **Point the name at it** — in Cloudflare add an `A` record `app → $IP`, **DNS only** (grey cloud). Switch `ACME_CA` back to production and `docker compose up -d --force-recreate caddy`.
6. Remove the app's own login, if you want Tailscale to be the only login.

## Things to know
- **Name clashes between Docker networks.** If `tailscale` joins several networks, a service name that exists in more than one resolves to the wrong container. Give your app a unique network alias and use it in `UPSTREAM`.
- Anything that can reach the app directly (a published port, another `tailscale serve`) bypasses this check. Publish the app on `127.0.0.1` only.
- This protects *who can open the site*, not what they can do inside it. Every allowed login gets the same access.
- A free Tailscale plan has a small user limit; each person in `ALLOWED_LOGINS` must be a user in your tailnet.

## Tests
```bash
cd auth && python3 -m unittest -v
```

## License
Copyright (C) 2026 HayatoShimada. Licensed under GPL-2.0-only; see `LICENSE`.
