# URL Shortener

Requires Node.js 20 or newer. Run `npm start`, then open [http://localhost:3000](http://localhost:3000).

Create an account, enter a URL and optional title, then click **Shorten**. You can edit a link's title in the analytics list. Each account sees only its own links and click data.

The first account created on this computer receives the links saved before accounts were added. Data is stored in `data/links.json`, `data/users.json`, and `data/sessions.json`.

Opening a short link redirects to the original URL and records a click.

Set `PORT` to change the server port, `BASE_URL` to set the public address for generated links, `DATA_FILE` to change the storage path, and `HOST` to change the listen address. By default it listens only on this computer. Sharing links with others requires a public server and domain.

## Deploy on Vercel

This project has a Vercel Node server entry point (`server.js`). Connect an Upstash Redis database to the Vercel project before deploying. The integration must provide `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Production. The app refuses to start on Vercel without these variables so accounts and click counts are never saved to temporary server files. Vercel supplies the production domain for generated short links; `BASE_URL` can override it.

Local development still uses the JSON files in `data/`. They are excluded from Git and are not automatically copied to the deployed database.
