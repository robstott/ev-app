# EV Charger Backend

A small TypeScript/Express backend for an iPhone EV charger app.

The backend is designed to:

1. Fetch charger data from charge point operator open-data / OCPI-style feeds.
2. Normalise each operator's data into one clean format.
3. Expose a simple API for a SwiftUI iPhone app.

The first version does **not** use a database. It fetches and normalises feed data on request. That is fine for a proof of concept, but a real app should add caching and eventually PostgreSQL/PostGIS.

## Folder structure

```text
ev-charger-backend/
  package.json
  tsconfig.json
  render.yaml
  .env.example
  .gitignore
  README.md
  src/
    server.ts
    types.ts
    cpoFeeds.ts
    normalise.ts
    geo.ts
```

## Local setup

Install Node.js 20 or later, then run:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000/health
```

Expected response:

```json
{
  "ok": true
}
```

## Environment variables

Create a local `.env` file if you want to store feed URLs locally. This starter project does not load `.env` automatically because hosting platforms such as Render provide environment variables directly.

For local use, you can run with an environment variable inline:

```bash
GENIEPOINT_LOCATIONS_URL="paste-real-feed-url-here" npm run dev
```

On Render, add this as an environment variable in the service settings:

```text
GENIEPOINT_LOCATIONS_URL=paste-real-feed-url-here
```

## API endpoints

### Health check

```http
GET /health
```

Returns:

```json
{
  "ok": true
}
```

### Charger search

```http
GET /chargers?lat=54.0&lon=-0.4&radiusKm=25
```

Returns:

```json
{
  "locations": []
}
```

The `locations` array will be populated once you configure at least one real CPO feed URL.

## Deploying on Render

Create a new Render Web Service connected to your GitHub repo.

Use:

```text
Build Command: npm install && npm run build
Start Command: npm start
```

Add environment variables in Render, especially:

```text
NODE_ENV=production
GENIEPOINT_LOCATIONS_URL=paste-real-feed-url-here
```

Then test:

```text
https://your-service-name.onrender.com/health
```

## Next improvements

Suggested order:

1. Configure one real CPO feed.
2. Add in-memory caching.
3. Add more CPO feed configs.
4. Add structured logging.
5. Add PostgreSQL/PostGIS for proper spatial search and reliability history.
6. Add simple API authentication for the iPhone app.
