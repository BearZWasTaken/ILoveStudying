import { ACTIONS, ACTION_IDS, canUse, resolveRound } from './game.js';
import { PeerLink } from './peer.js';

const $ = (id) => document.getElementById(id);
const screens = ['home-screen', 'lobby-screen', 'game-screen', 'result-screen', 'records-screen'];
const keyActions = Object.fromEntries(ACTION_IDS.map((id) => [ACTIONS[id].key.toLowerCase(), id]));
const HISTORY_KEY = 'i-love-studying-matches-v1';
const HISTORY_PREFIX = 'i-love-studying-match-v2:';

let link = null;
let role = null;
let settings = { roundTime: 1.5, lives: 1 };
let phase = 'home';
let round = 0;
let players = [];
let chosen = 'study';
let remoteChoice = 'study';
let deadline = 0;
let timerFrame = 0;
let roundTimer = 0;
let nextTimer = 0;
let match = null;
let viewingRecord = null;
let terminalWinner = null;
let hostWaitingForChoice = false;
let ownName = 'Anonymous';
let opponentName = 'Opponent';
let localReady = false;
let remoteReady = false;
let roomCode = null;

function show(id) {
  screens.forEach((screen) => $(screen).classList.toggle('hidden', screen !== id));
  window.scrollTo(0, 0);
}

function setText(id, text) { $(id).textContent = text; }
function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${id}`);
  svg.append(use);
  return svg;
}

function actionDisplay(id) {
  const wrap = document.createElement('span');
  wrap.className = 'selected-action';
  const name = document.createElement('span');
  name.className = 'selected-name';
  name.textContent = ACTIONS[id].name;
  wrap.append(icon(id), name);
  return wrap;
}

function resetConnection() {
  clearTimeout(roundTimer);
  clearTimeout(nextTimer);
  cancelAnimationFrame(timerFrame);
  link?.close();
  link = null;
  role = null;
  phase = 'home';
  terminalWinner = null;
  hostWaitingForChoice = false;
  localReady = false;
  remoteReady = false;
  roomCode = null;
  $('connection-pill').classList.remove('online');
  setText('connection-pill', 'OFFLINE');
}

function goHome() {
  resetConnection();
  show('home-screen');
}

function openLobby(asHost) {
  resetConnection();
  role = asHost ? 'host' : 'guest';
  ownName = $('player-name').value.trim().slice(0, 24) || 'Anonymous';
  opponentName = 'Opponent';
  phase = 'lobby';
  show('lobby-screen');
  settings = { roundTime: 1.5, lives: 1 };
  $('round-time').value = '1.5';
  $('lives-count').value = '1';
  $('round-time').disabled = !asHost;
  $('lives-count').disabled = !asHost;
  $('start-button').classList.toggle('hidden', !asHost);
  $('start-button').disabled = true;
  $('host-code-area').classList.toggle('hidden', !asHost);
  $('guest-code-area').classList.toggle('hidden', asHost);
  $('room-code-input').value = '';
  $('room-code-input').disabled = false;
  $('connect-button').disabled = false;
  $('ready-button').disabled = true;
  setText('room-code-display', '······');
  setText('lobby-your-name', ownName);
  setText('lobby-opponent-name', 'Opponent');
  setText('opponent-state', 'Waiting...');
  setText('connection-message', '');
  $('connection-message').classList.remove('success');
  setText('lobby-message', '');
  setText('lobby-title', asHost ? 'Your room' : 'Join a room');
  setText('connection-help', asHost ? 'Share this code with your opponent.' : 'Enter the code from your host.');
  updateReadyUi();

  if (asHost) try {
    link = new PeerLink(handleMessage, handleStatus);
    const creatingLink = link;
    creatingLink.createRoom().then((code) => {
      if (link !== creatingLink) return;
      roomCode = code;
      setText('room-code-display', code);
      setText('connection-message', 'Room ready. Waiting for opponent.');
      $('connection-message').classList.add('success');
    }).catch((error) => { if (link === creatingLink) setText('connection-message', error.message); });
  } catch (error) {
    setText('connection-message', error.message);
  }
}

function updateReadyUi() {
  setText('your-ready-state', localReady ? 'Ready!' : 'Not ready');
  $('your-ready-state').classList.toggle('ready-state', localReady);
  setText('opponent-state', !link?.connected ? 'Waiting...' : remoteReady ? 'Ready!' : 'Not ready');
  $('opponent-state').classList.toggle('ready-state', remoteReady && Boolean(link?.connected));
  setText('ready-button', localReady ? 'Cancel ready' : 'Ready');
  $('ready-button').disabled = !link?.connected || phase !== 'lobby';
  $('start-button').disabled = role !== 'host' || !link?.connected || !localReady || !remoteReady || !validSettings();
}

function resetReady(announce = false) {
  localReady = false;
  remoteReady = false;
  if (announce) link?.send({ type: 'ready-reset' });
  updateReadyUi();
}

function validSettings() {
  const roundTime = Number($('round-time').value);
  const lives = Number($('lives-count').value);
  if (!Number.isFinite(roundTime) || roundTime <= 0 || !Number.isInteger(lives) || lives < 1) return null;
  return { roundTime, lives };
}

function updateSettings() {
  if (role !== 'host') return;
  const next = validSettings();
  if (!next) {
    setText('lobby-message', 'Use a positive round time and a whole number of lives.');
    $('start-button').disabled = true;
    return;
  }
  settings = next;
  setText('lobby-message', '');
  resetReady(true);
  link?.send({ type: 'settings', settings });
}

async function copyCode() {
  if (!roomCode) return;
  try {
    await navigator.clipboard.writeText(roomCode);
    setText('connection-message', 'Code copied. Share it with your opponent.');
  } catch {
    setText('connection-message', 'Could not copy. Select the code above.');
  }
}

async function connect() {
  if (role !== 'guest' || link?.connected) return;
  $('connect-button').disabled = true;
  setText('connection-message', 'Connecting...');
  $('connection-message').classList.remove('success');
  try {
    link?.close();
    link = new PeerLink(handleMessage, handleStatus);
    await link.joinRoom($('room-code-input').value);
    roomCode = link.code;
  } catch (error) {
    link?.close();
    link = null;
    setText('connection-message', error.message);
    $('connect-button').disabled = false;
  }
}

function handleStatus(status, detail) {
  if (status === 'incoming') {
    setText('connection-message', 'Opponent found. Connecting...');
    return;
  }
  if (status === 'connected') {
    $('connection-pill').classList.add('online');
    setText('connection-pill', 'CONNECTED');
    setText('connection-message', 'Connected!');
    $('connection-message').classList.add('success');
    if (role === 'guest') $('room-code-input').disabled = true;
    link?.send({ type: 'hello', name: ownName });
    if (role === 'host') {
      updateSettings();
    }
    updateReadyUi();
    return;
  }
  if (status === 'room-not-found' || status === 'service-error' || status === 'connection-timeout') {
    $('connection-message').classList.remove('success');
    setText('connection-message', status === 'room-not-found' ? 'Room not found. Check the code.' : status === 'connection-timeout' ? `Could not connect (ICE: ${detail}). Try again.` : 'Connection service unavailable. Try again.');
    if (role === 'guest' && phase === 'lobby') {
      link?.close();
      link = null;
      $('connect-button').disabled = false;
    }
    return;
  }
  if (phase === 'result') {
    $('connection-pill').classList.remove('online');
    setText('connection-pill', 'OFFLINE');
    resetReady(false);
    if (role === 'guest') {
      $('room-code-input').disabled = false;
      $('connect-button').disabled = false;
    }
    return;
  }
  $('connection-pill').classList.remove('online');
  setText('connection-pill', 'OFFLINE');
  if (phase === 'game' || phase === 'reveal') {
    if (terminalWinner !== null) finish('lives', terminalWinner);
    else finish('disconnect', null);
  } else if (phase === 'lobby') {
    opponentName = 'Opponent';
    setText('lobby-opponent-name', opponentName);
    resetReady(false);
    setText('connection-message', role === 'host' ? 'Opponent left. Room is still open.' : 'Host left the room.');
    $('connection-message').classList.remove('success');
    if (role === 'guest') {
      $('room-code-input').disabled = false;
      $('connect-button').disabled = false;
    }
  }
}

function handleMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'hello' && typeof message.name === 'string') {
    opponentName = message.name.trim().slice(0, 24) || 'Anonymous';
    setText('lobby-opponent-name', opponentName);
    setText('game-opponent-name', opponentName);
  } else if (message.type === 'room-full' && role === 'guest' && phase === 'lobby') {
    setText('connection-message', 'Room is full.');
    link?.close();
    link = null;
    $('connect-button').disabled = false;
  } else if (message.type === 'ready' && phase === 'lobby') {
    remoteReady = message.ready === true;
    updateReadyUi();
  } else if (message.type === 'ready-reset') {
    resetReady(false);
  } else if (message.type === 'request-settings' && role === 'host') {
    link?.send({ type: 'settings', settings });
  } else if (message.type === 'settings' && role === 'guest' && phase === 'lobby') {
    const { roundTime, lives } = message.settings || {};
    if (Number.isFinite(roundTime) && roundTime > 0 && Number.isInteger(lives) && lives >= 1) {
      settings = { roundTime, lives };
      $('round-time').value = String(roundTime);
      $('lives-count').value = String(lives);
      resetReady(false);
    }
  } else if (message.type === 'start' && role === 'guest' && phase === 'lobby' && localReady && remoteReady) {
    const { roundTime, lives } = message.settings || {};
    if (!Number.isFinite(roundTime) || roundTime <= 0 || !Number.isInteger(lives) || lives < 1) return;
    settings = { roundTime, lives };
    beginMatch();
  } else if (message.type === 'round-start' && role === 'guest' && (phase === 'game' || phase === 'reveal')) {
    if (message.round === round + 1) beginRound();
  } else if (message.type === 'choice' && role === 'host' && (phase === 'game' || hostWaitingForChoice) && message.round === round && canUse(message.action, players[1].gpa)) {
    remoteChoice = message.action;
  } else if (message.type === 'round-result' && role === 'guest' && (phase === 'game' || phase === 'reveal') && message.round === round) {
    acceptResult(message);
  } else if (message.type === 'leave' && (phase === 'game' || phase === 'reveal')) {
    finish('opponent-left', 0);
  }
}

function beginMatch() {
  phase = 'game';
  round = 0;
  players = [{ gpa: 0, lives: settings.lives }, { gpa: 0, lives: settings.lives }];
  match = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), settings: { ...settings }, role, roomCode, players: [ownName, opponentName], rounds: [], outcome: null, reason: null };
  terminalWinner = null;
  setText('room-role', `ROOM ${roomCode}`);
  setText('game-your-name', ownName);
  setText('game-opponent-name', opponentName);
  show('game-screen');
  drawStats();
  clearReveals();
  if (role === 'host') startRoundFromHost();
}

function startRoundFromHost() {
  if (phase !== 'game' && phase !== 'reveal') return;
  link?.send({ type: 'round-start', round: round + 1 });
  beginRound();
}

function beginRound() {
  clearTimeout(roundTimer);
  clearTimeout(nextTimer);
  phase = 'game';
  round += 1;
  chosen = 'study';
  remoteChoice = 'study';
  hostWaitingForChoice = false;
  deadline = performance.now() + settings.roundTime * 1000;
  setText('round-number', `ROUND ${String(round).padStart(2, '0')}`);
  setText('phase-label', 'CHOOSE YOUR MOVE');
  setText('game-message', '');
  clearReveals();
  drawActions();
  tick();
  roundTimer = setTimeout(() => {
    phase = 'reveal';
    setText('phase-label', 'REVEALING...');
    drawActions();
    if (role === 'host') {
      hostWaitingForChoice = true;
      roundTimer = setTimeout(resolveAsHost, 170);
    }
  }, settings.roundTime * 1000);
}

function tick() {
  cancelAnimationFrame(timerFrame);
  function frame() {
    const left = Math.max(0, deadline - performance.now());
    setText('time-left', `${(left / 1000).toFixed(1)}s`);
    $('timer-fill').style.width = `${(left / (settings.roundTime * 1000)) * 100}%`;
    if (left > 0 && phase === 'game') timerFrame = requestAnimationFrame(frame);
  }
  frame();
}

function selectAction(id) {
  if (phase !== 'game' || !canUse(id, players[0].gpa)) return;
  chosen = id;
  drawActions();
  if (role === 'guest') link?.send({ type: 'choice', round, action: id });
}

function resolveAsHost() {
  if (phase !== 'reveal') return;
  hostWaitingForChoice = false;
  const actions = [chosen, remoteChoice];
  const result = resolveRound(players, actions);
  link?.send({ type: 'round-result', round, actions, players: result.players, winner: result.winner });
  applyResult(actions, result.players, result.winner);
}

function acceptResult(message) {
  if (!Array.isArray(message.actions) || message.actions.length !== 2 || !Array.isArray(message.players) || message.players.length !== 2) return;
  const actions = [message.actions[1], message.actions[0]];
  const expected = resolveRound(players, actions);
  const winner = expected.winner;
  if (JSON.stringify(expected.players) !== JSON.stringify([message.players[1], message.players[0]]) || (winner === null ? message.winner !== null : message.winner !== 1 - winner)) return;
  applyResult(actions, expected.players, winner);
}

function applyResult(actions, nextPlayers, winner) {
  phase = 'reveal';
  const before = players.map((player) => ({ ...player }));
  players = nextPlayers;
  match.rounds.push({ round, actions: [...actions], before, after: players.map((player) => ({ ...player })), winner });
  drawStats();
  reveal('your-reveal', actions[0], winner === 0 ? 'win' : winner === 1 ? 'lose' : '');
  reveal('opponent-reveal', actions[1], winner === 1 ? 'win' : winner === 0 ? 'lose' : '');
  setText('phase-label', 'ROUND COMPLETE');
  setText('game-message', winner === null ? 'No winner this round' : winner === 0 ? 'You won this round!' : 'Opponent won this round!');
  if (players.some((player) => player.lives === 0)) {
    terminalWinner = players[0].lives > 0 ? 0 : 1;
    nextTimer = setTimeout(() => finish('lives', terminalWinner), 1300);
  } else if (role === 'host') {
    nextTimer = setTimeout(startRoundFromHost, 1300);
  }
}

function drawStats() {
  setText('your-gpa', players[0].gpa);
  setText('opponent-gpa', players[1].gpa);
  setText('your-lives', '♥'.repeat(Math.min(players[0].lives, 8)) + (players[0].lives > 8 ? ` ×${players[0].lives}` : ''));
  setText('opponent-lives', '♥'.repeat(Math.min(players[1].lives, 8)) + (players[1].lives > 8 ? ` ×${players[1].lives}` : ''));
}

function clearReveals() {
  for (const id of ['your-reveal', 'opponent-reveal']) {
    $(id).replaceChildren(document.createTextNode('?'));
    $(id).className = 'reveal-slot';
    $(id).setAttribute('aria-label', id === 'your-reveal' ? 'Your move hidden' : 'Opponent move hidden');
  }
}

function reveal(elementId, actionId, result) {
  $(elementId).replaceChildren(icon(actionId));
  $(elementId).className = `reveal-slot ${result}`;
  $(elementId).setAttribute('aria-label', `${elementId === 'your-reveal' ? 'Your' : 'Opponent'} move: ${ACTIONS[actionId].name}`);
}

function drawActions() {
  const grid = $('action-grid');
  grid.replaceChildren();
  const layout = ['study', null, null, 'shield', 'aiShield', 'homework', 'quiz', 'exam', 'final', 'grandFinal'];
  for (const id of layout) {
    if (id === null) {
      const empty = document.createElement('div');
      empty.className = 'action-empty';
      empty.setAttribute('aria-hidden', 'true');
      grid.append(empty);
      continue;
    }
    const action = ACTIONS[id];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `action-card${chosen === id ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(chosen === id));
    button.disabled = phase !== 'game' || !canUse(id, players[0].gpa);
    button.setAttribute('aria-label', `${action.name}, ${action.kind === 'study' ? 'plus 1 GPA' : action.cost ? `minus ${action.cost} GPA` : 'free'}, key ${action.key}`);
    const info = document.createElement('span');
    info.className = 'action-info';
    const name = document.createElement('span');
    name.className = 'action-name';
    name.textContent = action.name;
    const meta = document.createElement('span');
    meta.className = `action-meta ${action.kind === 'study' ? 'gain' : action.cost ? 'cost' : 'defense'}`;
    meta.textContent = action.kind === 'study' ? '+1 GPA' : action.kind === 'attack' ? `−${action.cost} GPA` : action.cost ? `−${action.cost} GPA` : `DEF ${action.defense}`;
    info.append(name, meta);
    if (id === 'aiShield') {
      const defense = document.createElement('span');
      defense.className = 'action-defense';
      defense.textContent = `DEF ${action.defense}`;
      info.append(defense);
    }
    const key = document.createElement('span');
    key.className = 'keycap';
    key.textContent = action.key;
    button.append(icon(id), info, key);
    button.addEventListener('click', () => selectAction(id));
    grid.append(button);
  }
  $('selected-action').replaceChildren(actionDisplay(chosen));
}

function readHistory() {
  try {
    const records = [];
    const legacy = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (Array.isArray(legacy)) records.push(...legacy);
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(HISTORY_PREFIX)) {
        try { records.push(JSON.parse(localStorage.getItem(key))); } catch { /* Skip damaged records. */ }
      }
    }
    return records.filter((record) => record && Array.isArray(record.rounds)).sort((a, b) => (b.endedAt || '').localeCompare(a.endedAt || ''));
  } catch { return []; }
}

function saveMatch() {
  if (!match) return;
  match.endedAt = new Date().toISOString();
  try {
    localStorage.setItem(`${HISTORY_PREFIX}${match.id}`, JSON.stringify(match));
  } catch { /* The result remains reviewable during this visit. */ }
}

function finish(reason, winner) {
  if (phase !== 'game' && phase !== 'reveal') return;
  clearTimeout(roundTimer);
  clearTimeout(nextTimer);
  cancelAnimationFrame(timerFrame);
  phase = 'result';
  hostWaitingForChoice = false;
  match.reason = reason;
  match.outcome = winner === 0 ? 'win' : winner === 1 ? 'loss' : 'unresolved';
  saveMatch();
  resetReady(true);
  viewingRecord = match;
  renderResult(match);
  show('result-screen');
}

function renderResult(record) {
  const outcome = record.outcome;
  setText('result-title', outcome === 'win' ? 'You win!' : outcome === 'loss' ? 'You lose!' : 'Disconnected');
  setText('result-detail', record.reason === 'lives' ? 'No lives left.' : record.reason === 'opponent-left' ? 'Opponent left the game.' : record.reason === 'left' ? 'You left the game.' : 'Connection lost. Result unresolved.');
  setText('again-button', link && viewingRecord === match ? 'Back to room' : 'Back to history');
  $('round-history').classList.add('hidden');
  setText('review-button', 'Review rounds');
  $('round-history').replaceChildren();
}

function renderRoundHistory(record) {
  const list = $('round-history');
  list.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'history-heading';
  heading.textContent = `${record.rounds.length} ROUNDS · ${record.settings.roundTime}s · ${record.settings.lives} ${record.settings.lives === 1 ? 'LIFE' : 'LIVES'}`;
  list.append(heading);
  if (!record.rounds.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No completed rounds.';
    list.append(empty);
  }
  for (const entry of record.rounds) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const number = document.createElement('span');
    number.className = 'history-round';
    number.textContent = `#${entry.round}`;
    const you = document.createElement('span');
    const opponent = document.createElement('span');
    you.append(icon(entry.actions[0]), document.createTextNode(`You: ${ACTIONS[entry.actions[0]].name}`));
    opponent.append(icon(entry.actions[1]), document.createTextNode(`Opponent: ${ACTIONS[entry.actions[1]].name}`));
    row.append(number, you, opponent);
    list.append(row);
  }
}

function renderRecords() {
  const container = $('records-list');
  container.replaceChildren();
  const records = readHistory();
  if (!records.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No matches yet.';
    container.append(empty);
  }
  records.forEach((record) => {
    const button = document.createElement('button');
    button.className = 'record-card';
    const date = new Date(record.startedAt);
    button.textContent = `${record.outcome === 'win' ? 'WIN' : record.outcome === 'loss' ? 'LOSS' : 'UNRESOLVED'}  ·  ${record.role?.toUpperCase() || 'PLAYER'}  ·  ${Number.isNaN(date.getTime()) ? '' : date.toLocaleString()}  ·  ${record.rounds?.length || 0} rounds`;
    button.addEventListener('click', () => {
      viewingRecord = record;
      renderResult(record);
      show('result-screen');
    });
    container.append(button);
  });
}

$('create-button').addEventListener('click', () => openLobby(true));
$('join-button').addEventListener('click', () => openLobby(false));
$('history-button').addEventListener('click', () => { renderRecords(); show('records-screen'); });
document.querySelectorAll('[data-back]').forEach((button) => button.addEventListener('click', goHome));
$('copy-button').addEventListener('click', copyCode);
$('connect-button').addEventListener('click', connect);
$('room-code-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') connect(); });
$('ready-button').addEventListener('click', () => {
  if (phase !== 'lobby' || !link?.connected) return;
  localReady = !localReady;
  link.send({ type: 'ready', ready: localReady });
  updateReadyUi();
});
$('round-time').addEventListener('input', updateSettings);
$('lives-count').addEventListener('input', updateSettings);
$('start-button').addEventListener('click', () => {
  if (role !== 'host' || !link?.connected || !localReady || !remoteReady) return;
  const current = validSettings();
  if (!current) return;
  settings = current;
  if (link.send({ type: 'start', settings })) beginMatch();
});
$('again-button').addEventListener('click', () => {
  if (link && viewingRecord === match) {
    phase = 'lobby';
    show('lobby-screen');
    updateReadyUi();
    if (role === 'guest') link.send({ type: 'request-settings' });
  } else {
    renderRecords();
    show('records-screen');
  }
});
$('leave-button').addEventListener('click', () => {
  if (phase !== 'game' && phase !== 'reveal') return;
  link?.send({ type: 'leave' });
  finish('left', 1);
});
$('review-button').addEventListener('click', () => {
  const history = $('round-history');
  const opening = history.classList.contains('hidden');
  if (opening && viewingRecord) renderRoundHistory(viewingRecord);
  history.classList.toggle('hidden', !opening);
  setText('review-button', opening ? 'Hide rounds' : 'Review rounds');
});
document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  const actionId = keyActions[event.key.toLowerCase()];
  if (actionId) selectAction(actionId);
});
window.addEventListener('beforeunload', () => { if (phase === 'game' || phase === 'reveal') link?.send({ type: 'leave' }); });
