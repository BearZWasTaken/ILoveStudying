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
  wrap.append(icon(id), document.createTextNode(ACTIONS[id].name));
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
  phase = 'lobby';
  show('lobby-screen');
  settings = { roundTime: 1.5, lives: 1 };
  $('round-time').value = '1.5';
  $('lives-count').value = '1';
  $('round-time').disabled = !asHost;
  $('lives-count').disabled = !asHost;
  $('start-button').classList.toggle('hidden', !asHost);
  $('start-button').disabled = true;
  $('outgoing-signal').value = '';
  $('incoming-signal').value = '';
  setText('opponent-state', 'Waiting...');
  setText('connection-message', '');
  setText('lobby-message', '');
  setText('lobby-title', asHost ? 'Your room' : 'Join a room');
  setText('connection-help', asHost ? 'Send the invite to your opponent. Paste their reply below.' : 'Paste the invite from your host. Send the reply back.');
  setText('outgoing-label', asHost ? 'INVITE · SEND TO OPPONENT' : 'REPLY · SEND TO HOST');
  setText('incoming-label', asHost ? 'REPLY · PASTE HERE' : 'INVITE · PASTE HERE');
  setText('connect-button', asHost ? 'Use reply' : 'Make reply');
  $('outgoing-signal').placeholder = asHost ? 'Creating invite...' : 'Your reply will appear here';
  $('incoming-signal').placeholder = asHost ? 'Paste their reply' : 'Paste the host invite';

  try {
    link = new PeerLink(handleMessage, handleStatus);
    if (asHost) {
      link.createInvite().then((invite) => {
        if (role === 'host' && phase === 'lobby') $('outgoing-signal').value = invite;
      }).catch((error) => setText('connection-message', error.message));
    }
  } catch {
    setText('connection-message', 'WebRTC is unavailable in this browser.');
  }
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
  $('start-button').disabled = !link?.connected;
  link?.send({ type: 'settings', settings });
}

async function copySignal() {
  const value = $('outgoing-signal').value;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    $('outgoing-signal').select();
    document.execCommand('copy');
  }
  setText('connection-message', 'Copied. Send it to the other player.');
}

async function connect() {
  if (!link) return;
  const signal = $('incoming-signal').value.trim();
  if (!signal) { setText('connection-message', 'Paste the text first.'); return; }
  $('connect-button').disabled = true;
  setText('connection-message', 'Connecting...');
  try {
    if (role === 'host') {
      await link.acceptReply(signal);
      setText('connection-message', 'Reply accepted. Waiting for connection...');
    } else {
      const reply = await link.acceptInvite(signal);
      $('outgoing-signal').value = reply;
      setText('connection-message', 'Send this reply to your host.');
    }
  } catch (error) {
    setText('connection-message', error.message);
    $('connect-button').disabled = false;
  }
}

function handleStatus(status) {
  if (status === 'connected') {
    $('connection-pill').classList.add('online');
    setText('connection-pill', 'CONNECTED');
    setText('opponent-state', 'Connected');
    setText('connection-message', 'Connected!');
    if (role === 'host') {
      updateSettings();
      $('start-button').disabled = !validSettings();
    }
    return;
  }
  if (phase === 'result') return;
  $('connection-pill').classList.remove('online');
  setText('connection-pill', 'OFFLINE');
  if (phase === 'game' || phase === 'reveal') {
    if (terminalWinner !== null) finish('lives', terminalWinner);
    else finish('disconnect', null);
  } else if (phase === 'lobby') {
    setText('opponent-state', 'Disconnected');
    setText('connection-message', 'Connection lost. Return home to make a new room.');
    $('start-button').disabled = true;
  }
}

function handleMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'settings' && role === 'guest' && phase === 'lobby') {
    const { roundTime, lives } = message.settings || {};
    if (Number.isFinite(roundTime) && roundTime > 0 && Number.isInteger(lives) && lives >= 1) {
      settings = { roundTime, lives };
      $('round-time').value = String(roundTime);
      $('lives-count').value = String(lives);
    }
  } else if (message.type === 'start' && role === 'guest' && phase === 'lobby') {
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
  match = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), settings: { ...settings }, role, rounds: [], outcome: null, reason: null };
  terminalWinner = null;
  setText('room-role', role === 'host' ? 'HOST' : 'GUEST');
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
  }
}

function reveal(elementId, actionId, result) {
  $(elementId).replaceChildren(icon(actionId), document.createTextNode(ACTIONS[actionId].name));
  $(elementId).className = `reveal-slot ${result}`;
}

function drawActions() {
  const grid = $('action-grid');
  grid.replaceChildren();
  for (const id of ACTION_IDS) {
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
    meta.textContent = action.kind === 'study' ? '+1 GPA' : action.kind === 'attack' ? `−${action.cost} GPA · PWR ${action.power}` : action.cost ? `−${action.cost} GPA · DEF ${action.defense}` : `FREE · DEF ${action.defense}`;
    info.append(name, meta);
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
  viewingRecord = match;
  renderResult(match);
  show('result-screen');
  $('connection-pill').classList.remove('online');
  setText('connection-pill', 'MATCH ENDED');
  if (reason === 'left') {
    const leavingLink = link;
    setTimeout(() => leavingLink?.close(), 250);
  }
  else link?.close();
}

function renderResult(record) {
  const outcome = record.outcome;
  setText('result-title', outcome === 'win' ? 'You win!' : outcome === 'loss' ? 'You lose!' : 'Disconnected');
  setText('result-detail', record.reason === 'lives' ? 'No lives left.' : record.reason === 'opponent-left' ? 'Opponent left the game.' : record.reason === 'left' ? 'You left the game.' : 'Connection lost. Result unresolved.');
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
$('copy-button').addEventListener('click', copySignal);
$('connect-button').addEventListener('click', connect);
$('round-time').addEventListener('input', updateSettings);
$('lives-count').addEventListener('input', updateSettings);
$('start-button').addEventListener('click', () => {
  if (role !== 'host' || !link?.connected) return;
  const current = validSettings();
  if (!current) return;
  settings = current;
  if (link.send({ type: 'start', settings })) beginMatch();
});
$('again-button').addEventListener('click', goHome);
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
