# Attackplan Filter

Das Repo ist fuer Cloudflare Pages im GitHub-Flow vorbereitet.

## Struktur

- `public/` enthaelt das statische Frontend
- `functions/proxy.ts` ist die Cloudflare Pages Function fuer die Proxy-Requests

## Cloudflare Pages

- Framework preset: `None`
- Build command: `npm run build`
- Build output directory: `public`
- Kein `wrangler.toml` noetig fuer GitHub-basiertes Pages-Hosting
- Kein Deploy-Command noetig; Cloudflare Pages deployed direkt aus dem Repository

## Hinweis

Wenn Cloudflare stattdessen `npx wrangler deploy` ausfuehrt, ist das ein Worker-Deploypfad und fuer dieses Repo falsch. In dem Fall im Cloudflare-Projekt den Pages/Git-Deploy verwenden, nicht Wrangler-Deploy.
