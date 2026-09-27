# Nexus

Personal procurement manager — paste a product link, get a tidy, auto-tagged item with
price comparison across stores, project budgets, and Excel export.

See `SPEC.md` for the product spec.

## Develop

```bash
npm install
cp .env.example .env.local   # fill in values
npm run db:migrate
npm run dev
```

## Deploy (Vercel)
Import the repo in Vercel, connect a Blob store, and set the env vars from `.env.example`.
Migrations run automatically at build time.
