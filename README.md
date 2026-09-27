# I ❤️ Studying

A two-player, real-time browser game built as a static site. GitHub Pages can host the files directly. No application server, account, build step, or package install is required.

## Play

1. Open the site in two browsers or on two devices.
2. One player chooses **Create room**. They send the generated invite text to the other player through any messenger.
3. The other player chooses **Join room**, pastes the invite, chooses **Make reply**, and sends the generated reply text back.
4. The host pastes the reply and chooses **Use reply**. Once connected, the host can change the round time and lives, then start the match.

The invite and reply are only needed before the match. Moves travel over a WebRTC data channel after that. The app uses a public STUN service to help establish a direct connection. Some restrictive networks cannot make a direct connection; this version has no TURN relay and therefore cannot guarantee connectivity everywhere.

## Rules

- Each round lasts **1.5 seconds** by default. The selected move can be changed until the timer ends. An untouched round uses **Study**.
- **Study** (`Q`) earns 1 GPA.
- **Homework**, **Quiz**, **Exam**, **Final**, **Grand Final** (`1`–`5`) cost and have power 1–5 respectively.
- **Shield** (`A`) is free with defense 2. **AI-Shield** (`S`) costs 1 GPA with defense 4.
- An attack beats Study, a weaker attack, or defense lower than its power. Every other pairing has no round winner. The loser loses one life.
- Moves that cost more GPA than a player has are unavailable.

The host controls round resolution. An explicit **Leave** is a loss for the leaving player. Unexpected connection loss is recorded as an unresolved match because two peers alone cannot reliably tell whose network failed.

Each browser saves its own match history in `localStorage`, including settings, outcome, and every completed round's actions and player state. Clearing site data removes that browser's history.

## Run locally

Serve this directory with any static HTTP server, for example:

```sh
python -m http.server 8000
```

Open `http://localhost:8000`. For the rules tests, run `node game.test.js`.

## Publish on GitHub Pages

Put these files at the repository root, then enable **Settings → Pages → Build and deployment → Deploy from a branch**, selecting the branch and `/ (root)`. The site will be available at `https://<owner>.github.io/<repository>/` for a project repository. The page must use HTTPS for reliable browser features outside localhost.
