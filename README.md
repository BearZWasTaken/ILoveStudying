# I ❤️ Studying

A two-player, real-time browser game built as a static site. GitHub Pages can host the files directly. No application server, account, build step, or package install is required. Room codes use the free PeerJS Cloud signaling service to connect browsers.

## Play

1. Each player may enter a name. A blank name displays as **Anonymous**.
2. One player chooses **Create room** and shares the six-character room code.
3. The other player chooses **Join room** and enters that code.
4. Both players select **Ready**. The host can change the round time and lives; changing either setting clears both ready states. Once both are ready, the host starts the match.
5. After the match, both players can return to the same room and get ready for another game. The room code, names, and settings remain in place while the host keeps the room open.

PeerJS Cloud exchanges connection information when a guest enters a room code. Moves then travel over a WebRTC data channel. The game uses Google's and Cloudflare's public STUN services to help establish a direct connection. The game relies on the availability of PeerJS Cloud and a CDN for the PeerJS browser library. Some restrictive networks cannot make a direct connection. The optional TURN configuration below can relay those connections; it is disabled by default.

## Optional TURN relay

TURN may help when two networks cannot connect directly, but a timeout alone does not prove that TURN is needed. The guest's connection error displays the browser's ICE state, and the host displays **Opponent found. Connecting...** when the connection request reaches it.

To use a TURN provider, set `TURN_CREDENTIALS_URL` in `turn-config.js` to an HTTPS endpoint returning an `iceServers` array or `{ "iceServers": [...] }`. Each TURN entry needs `urls`, `username`, and `credential`. Both players load the same published configuration. If the endpoint fails or returns no valid TURN entries, the game uses its original STUN-only connection path. Never put permanent private TURN credentials in this public repository.

[Metered Open Relay](https://www.metered.ca/tools/openrelay/) currently offers a free account with 20 GB of TURN usage per month and documents a browser-fetchable credentials endpoint. You must create your own account and set its endpoint URL; no account or key is included in this repository. Check the provider's current quota and billing settings before enabling it. GitHub Pages continues to host only the static game files.

For Metered Open Relay, its documented endpoint has the form `https://YOUR_APP.metered.live/api/v1/turn/credentials?apiKey=YOUR_API_KEY`. Put your own endpoint in `turn-config.js` and publish that file with the rest of the site. Since GitHub Pages is public, this URL and its API key will be visible to visitors; use a dedicated free account and do not use a key with access to unrelated projects.

## Rules

- Each round lasts **1.5 seconds** by default. The selected move can be changed until the timer ends. An untouched round uses **Study**.
- **Study** (`Q`) earns 1 GPA.
- **Homework**, **Quiz**, **Exam**, **Final**, **Grand Final** (`1`–`5`) cost and have power 1–5 respectively.
- Attack icons are numbered papers. The number shows the attack's power; the cards show only GPA cost.
- **Shield** (`A`) is free with defense 2. **AI-Shield** (`S`) costs 1 GPA with defense 4.
- An attack beats Study, a weaker attack, or defense lower than its power. Every other pairing has no round winner. The loser loses one life.
- Moves that cost more GPA than a player has are unavailable.

The host controls round resolution. An explicit **Forfeit** is a loss for that player, and the room remains open for a rematch. Unexpected connection loss is recorded as an unresolved match because two peers alone cannot reliably tell whose network failed.

Each browser saves its own match history in `localStorage`, including player names, room code, settings, outcome, and every completed round's actions and player state. Clearing site data removes that browser's history.

## Run locally

Serve this directory with any static HTTP server, for example:

```sh
python -m http.server 8000
```

Open `http://localhost:8000`. For the rules tests, run `node game.test.js`.

## Publish on GitHub Pages

Put these files at the repository root, then enable **Settings → Pages → Build and deployment → Deploy from a branch**, selecting the branch and `/ (root)`. The site will be available at `https://<owner>.github.io/<repository>/` for a project repository. The page must use HTTPS for reliable browser features outside localhost.
