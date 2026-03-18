# Attackplan Filter

Das Repo funktioniert mit dem aktuellen Wrangler-Setup als Cloudflare Worker mit statischen Assets.

## Struktur

- `public/` enthaelt das statische Frontend
- `worker.js` liefert die Assets aus und behandelt `/proxy`
- `functions/` ist fuer ein optionales Pages-Setup vorhanden, wird vom aktuellen Wrangler-Deploy aber nicht genutzt

## Aktuelles Deployment

- Preview lokal: `npm run preview`
- Deploy: `npm run deploy`

Wrangler nutzt `wrangler.jsonc`, serviert die Dateien aus `public/` und beantwortet `/proxy` ueber `worker.js`.
