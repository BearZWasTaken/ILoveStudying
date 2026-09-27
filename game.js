export const ACTIONS = Object.freeze({
  study: { key: 'Q', kind: 'study', cost: 0, power: 0, defense: 0 },
  homework: { key: '1', kind: 'attack', cost: 1, power: 1, defense: 0 },
  quiz: { key: '2', kind: 'attack', cost: 2, power: 2, defense: 0 },
  exam: { key: '3', kind: 'attack', cost: 3, power: 3, defense: 0 },
  final: { key: '4', kind: 'attack', cost: 4, power: 4, defense: 0 },
  grandFinal: { key: '5', kind: 'attack', cost: 5, power: 5, defense: 0 },
  shield: { key: 'A', kind: 'defense', cost: 0, power: 0, defense: 2 },
  aiShield: { key: 'S', kind: 'defense', cost: 1, power: 0, defense: 4 },
});

export const ACTION_IDS = Object.freeze(Object.keys(ACTIONS));

export function canUse(actionId, gpa) {
  return Number.isInteger(gpa) && gpa >= 0 && Boolean(ACTIONS[actionId]) && gpa >= ACTIONS[actionId].cost;
}

export function roundWinner(leftActionId, rightActionId) {
  const left = ACTIONS[leftActionId];
  const right = ACTIONS[rightActionId];
  if (!left || !right) throw new Error('Unknown action');

  function attackWins(attack, opponent) {
    if (attack.kind !== 'attack') return false;
    if (opponent.kind === 'study') return true;
    if (opponent.kind === 'attack') return attack.power > opponent.power;
    return attack.power > opponent.defense;
  }

  if (attackWins(left, right)) return 0;
  if (attackWins(right, left)) return 1;
  return null;
}

export function resolveRound(players, actionIds) {
  if (!Array.isArray(players) || players.length !== 2 || !Array.isArray(actionIds) || actionIds.length !== 2) {
    throw new Error('A round needs two players and two actions');
  }
  players.forEach((player, index) => {
    if (!Number.isInteger(player.gpa) || player.gpa < 0 || !Number.isInteger(player.lives) || player.lives < 0) {
      throw new Error('Invalid player state');
    }
    if (!canUse(actionIds[index], player.gpa)) throw new Error('Action cannot be used');
  });

  const winner = roundWinner(actionIds[0], actionIds[1]);
  const nextPlayers = players.map((player, index) => ({
    gpa: player.gpa + (actionIds[index] === 'study' ? 1 : -ACTIONS[actionIds[index]].cost),
    lives: Math.max(0, player.lives - (winner !== null && winner !== index ? 1 : 0)),
  }));
  return { players: nextPlayers, winner };
}
