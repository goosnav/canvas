# Goosnav Canvas

A public, persistent 3000 × 3000 pixel canvas with the window chrome, font, and cursors from Goosnav Paint. The small goose pond at the center is editable down to its last pixel.

Choose a swatch and double-click or double-tap a pixel to paint. Drag to pan, scroll or pinch to zoom, or drag the viewport in the lower-right Navigator. Its zoom slider and **Fit** button let you move between individual pixels and the whole sheet. With the canvas focused, the arrow keys select a cell and Enter places the pixel.

## Run locally

Use Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Open the local address Wrangler prints. It saves development artwork in `.wrangler/state`. Run `npm test` to check synchronization, simultaneous writes, cooldown expiry, and storage after a Worker restart in an isolated temporary board.

## Publish on Cloudflare

From the checkout, sign in to the target Workers Free account and deploy.

```sh
npx wrangler login
npm run deploy
```

Wrangler publishes the static site, Worker, and SQLite-backed Durable Object together and prints its public workers.dev address. Keep the Worker name, object binding, class, and board name stable when redeploying. Production has its own artwork, independent of the local board.

One named Durable Object serializes placements for the whole site. It stores changed rows and each active cooldown in SQLite, then broadcasts each saved pixel over hibernating WebSockets. Reconnecting clients receive a fresh snapshot. The starter artwork and palette indices define the initial board and should remain stable across deployments.

Visitors draw anonymously. The server permits seven changed pixels per browser profile in a 27-second window. Tabs in the same profile share an allowance through a first-party cookie. Visitors who block cookies use the public IP allowance. The first change starts the window, and all seven slots refill together at expiry. Selecting the existing color costs no turn.

To switch every visitor back to the shared public IP limit, set `PIXEL_RATE_LIMIT` to `ip` in the Worker's Variables and Secrets settings or in `wrangler.jsonc`, then deploy. Set it to `browser` to restore browser allowances. Keep the value in `wrangler.jsonc` in sync with any dashboard change for future Wrangler deploys. Both modes use the same board.

Workers Free supports this storage and WebSocket configuration. Traffic above the account's free allowances can temporarily interrupt service. See [Cloudflare's Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
