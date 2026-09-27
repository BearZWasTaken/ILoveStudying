# I ❤️ Studying

A two-player, real-time browser game built as a static site. GitHub Pages can host the files directly. No server run by you, account, build step, or package install is required. Room codes use a public WebSocket relay, with PeerJS direct connection as a fallback.

## Play

1. Each player may enter a name. A blank name displays as **Anonymous**.
2. One player chooses **Create room** and shares the six-character room code.
3. The other player chooses **Join room** and enters that code.
4. Both players select **Ready**. The host can change the round time and lives; changing either setting clears both ready states. Once both are ready, the host starts the match.
5. After the match, both players can return to the same room and get ready for another game. The room code, names, and settings remain in place while the host keeps the room open.

The game first connects both players to the same room channel on [Websocket Router](https://router.metapage.io/). Messages travel through that public service over encrypted WebSockets, so players on different networks do not need a direct WebRTC path. The service requires no account or API key and stores no messages, but its operators can see room messages while relaying them. The game adds acknowledgements and retries, detects a stalled connection, and attempts to reconnect for up to one minute. Returning to a backgrounded tab also triggers a connection check. If the WebSocket service cannot be reached when joining, the game tries its PeerJS direct connection path. PeerJS Cloud handles signaling, and public STUN servers help establish that direct connection. A public relay can still go offline or lose messages; a match that cannot recover ends as unresolved and saves its completed rounds locally.

## Optional TURN relay

TURN can help the PeerJS fallback when two networks cannot connect directly. The guest's direct-connection error displays the browser's ICE and relay states, and the host displays **Opponent found. Connecting...** when a connection request reaches it.

To use a TURN provider, set `TURN_CREDENTIALS_URL` in `turn-config.js` to an HTTPS endpoint returning an `iceServers` array or `{ "iceServers": [...] }`. Each TURN entry needs `urls`, `username`, and `credential`. Both players load the same published configuration. If the endpoint fails or returns no valid TURN entries, the game uses its original STUN-only connection path. Never put permanent private TURN credentials in this public repository.

## Rules

- Each round lasts **1.5 seconds** by default. The selected move can be changed until the timer ends. An untouched round uses **Study**.
- The host starts its countdown when it announces the round; the guest starts on receipt. Both get the full selection time. The guest submits its final move when its countdown ends, and the host reveals the round after both countdowns and the guest's submission. Network delay may add a waiting period before the reveal.
- **Study** (`Q`) earns 1 GPA.
- **Homework**, **Quiz**, **Exam**, **Final**, **Grand Final** (`1`–`5`) cost and have power 1–5 respectively.
- Attack icons are numbered papers. The number shows the attack's power; the cards show only GPA cost.
- The game UI shows move icons, costs, defense, and keys without move names. Round history shows each player's post-round GPA and marks a lost life with **-❤️**.
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
