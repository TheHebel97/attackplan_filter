# Attackplan Filter

Das Repo ist fuer Cloudflare Pages im GitHub-Flow vorbereitet.

## Struktur

- `public/` enthaelt das statische Frontend
- `functions/proxy.ts` ist die Cloudflare Pages Function fuer die Proxy-Requests

## Cloudflare Pages

- Framework preset: `None`
- Build command: `npm run build`
- Build output directory: `public`

Die App nutzt die Function `/proxy?url=...` fuer erlaubte `die-staemme.de`-Requests.
