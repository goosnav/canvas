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

Visitors draw anonymously. By default the server permits seven changed pixels per browser profile in a 27-second window. Tabs in the same profile share an allowance through a first-party cookie. Visitors who block cookies use the public IP allowance. The first change starts the window, and all seven slots refill together at expiry. Selecting the existing color costs no turn.

## Admin controls

On the Worker serving the canvas, open **Settings → Variables and Secrets → Add**, select **Secret**, and name it `CANVAS_ADMIN_KEY`. Set the value to a long, randomly generated password dedicated to Canvas and deploy the secret. For local development use the same name in an ignored `.dev.vars` file. Public drawing works with the secret unset.

Click **Log in** beside **Live** and enter the secret. Set pixels per turn (1–1000), seconds per turn (1–3600), and whether browsers on the same public IP share a countdown. Shared IP mode also groups devices behind the same public address. Save to apply the rules to connected editors immediately. A changed rule starts a fresh allowance for everyone and preserves the artwork. Saving identical values preserves active countdowns.

Rules persist in the board's SQLite storage. Before the first change, `PIXEL_RATE_LIMIT` supplies the initial mode. The admin key stays in tab memory until logout or reload. Rotating or removing the Worker secret revokes the previous key.

Workers Free supports this storage and WebSocket configuration. Traffic above the account's free allowances can temporarily interrupt service. See [Cloudflare's Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
