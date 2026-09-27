# I ❤️ Studying

A two-player, real-time browser game built as a static site. GitHub Pages can host the files directly. No application server, account, build step, or package install is required. Room codes use the free PeerJS Cloud signaling service to connect browsers.

## Play

1. Each player may enter a name. A blank name displays as **Anonymous**.
2. One player chooses **Create room** and shares the six-character room code.
3. The other player chooses **Join room** and enters that code.
4. Both players select **Ready**. The host can change the round time and lives; changing either setting clears both ready states. Once both are ready, the host starts the match.
5. After the match, both players can return to the same room and get ready for another game. The room code, names, and settings remain in place while the host keeps the room open.

PeerJS Cloud exchanges connection information when a guest enters a room code. Moves then travel over a WebRTC data channel. PeerJS also uses a public STUN service to help establish a direct connection. The game relies on the availability of PeerJS Cloud and a CDN for the PeerJS browser library. Some restrictive networks cannot make a direct connection; this version has no TURN relay and therefore cannot guarantee connectivity everywhere.

## Rules

- Each round lasts **1.5 seconds** by default. The selected move can be changed until the timer ends. An untouched round uses **Study**.
- **Study** (`Q`) earns 1 GPA.
- **Homework**, **Quiz**, **Exam**, **Final**, **Grand Final** (`1`–`5`) cost and have power 1–5 respectively.
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
