import { GAME, LIMITS, PLAYER_IDS, SERVER, START_POSITIONS, TUNING } from './constants.js';

const emptyInput = () => ({
  up: false,
  down: false,
  left: false,
  right: false,
  power: false,
});

const randomRoundVelocity = (directionY = Math.random() < 0.5 ? -1 : 1) => {
  const degrees = 58 + Math.random() * 64;
  const angle = (degrees * Math.PI) / 180;
  const side = Math.random() < 0.5 ? -1 : 1;
  return {
    vx: Math.cos(angle) * TUNING.puckStartSpeed * side,
    vy: Math.sin(angle) * TUNING.puckStartSpeed * directionY,
  };
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const length = (x, y) => Math.hypot(x, y);

const setVectorLength = (vector, targetLength) => {
  const currentLength = length(vector.vx, vector.vy);
  if (currentLength <= 0.0001) return vector;
  const scale = targetLength / currentLength;
  vector.vx *= scale;
  vector.vy *= scale;
  return vector;
};

export function createInitialGameState(roomId = '') {
  const velocity = randomRoundVelocity();
  return {
    version: 1,
    roomId,
    tick: 0,
    status: 'waiting',
    statusText: 'Waiting for opponent',
    winner: null,
    goalResumeAt: 0,
    players: {
      p1: createPlayerState('p1', false),
      p2: createPlayerState('p2', false),
    },
    puck: {
      x: GAME.width / 2,
      y: GAME.height / 2,
      vx: velocity.vx,
      vy: velocity.vy,
    },
    score: { p1: 0, p2: 0 },
    debug: {
      p1PowerHits: 0,
      p2PowerHits: 0,
      p1Goals: 0,
      p2Goals: 0,
      paddleHits: 0,
      wallHits: 0,
    },
    events: [],
  };
}

export function createPlayerState(id, connected) {
  const start = START_POSITIONS[id];
  return {
    id,
    connected,
    x: start.x,
    y: start.y,
    vx: 0,
    vy: 0,
    input: emptyInput(),
    lastInput: emptyInput(),
    lastPowerPressedAt: -Infinity,
    lastPowerUsedAt: -Infinity,
  };
}

export function resetMatch(state, nowMs = Date.now()) {
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  state.status = bothPlayersConnected(state) ? 'playing' : 'waiting';
  state.statusText = state.status === 'playing' ? '' : 'Waiting for opponent';
  state.goalResumeAt = 0;
  state.debug.p1PowerHits = 0;
  state.debug.p2PowerHits = 0;
  state.debug.p1Goals = 0;
  state.debug.p2Goals = 0;
  state.debug.paddleHits = 0;
  state.debug.wallHits = 0;
  resetRound(state, Math.random() < 0.5 ? -1 : 1, nowMs);
  pushEvent(state, 'restart', { at: nowMs });
}

export function resetRound(state, directionY = Math.random() < 0.5 ? -1 : 1, nowMs = Date.now()) {
  for (const id of PLAYER_IDS) {
    const player = state.players[id];
    const start = START_POSITIONS[id];
    player.x = start.x;
    player.y = start.y;
    player.vx = 0;
    player.vy = 0;
    player.input = emptyInput();
    player.lastInput = emptyInput();
    player.lastPowerPressedAt = -Infinity;
    player.lastPowerUsedAt = -Infinity;
  }

  const velocity = randomRoundVelocity(directionY);
  state.puck.x = GAME.width / 2;
  state.puck.y = GAME.height / 2;
  state.puck.vx = velocity.vx;
  state.puck.vy = velocity.vy;
  correctAxisLock(state.puck);
  capPuckSpeed(state.puck);

  if (bothPlayersConnected(state) && !state.winner) {
    state.status = 'playing';
    state.statusText = '';
  }
  state.goalResumeAt = 0;
  pushEvent(state, 'roundStart', { at: nowMs });
}

export function setPlayerConnected(state, playerId, connected) {
  state.players[playerId].connected = connected;
  if (!connected) {
    state.players[playerId].input = emptyInput();
  }
  if (!bothPlayersConnected(state) && !state.winner) {
    state.status = 'waiting';
    state.statusText = connected ? 'Waiting for opponent' : `${playerLabel(playerId)} disconnected`;
    state.puck.vx = 0;
    state.puck.vy = 0;
  } else if (bothPlayersConnected(state) && state.status === 'waiting' && !state.winner) {
    resetRound(state, Math.random() < 0.5 ? -1 : 1);
  }
}

export function updateInput(state, playerId, input, nowMs = Date.now()) {
  const player = state.players[playerId];
  const nextInput = {
    up: Boolean(input.up),
    down: Boolean(input.down),
    left: Boolean(input.left),
    right: Boolean(input.right),
    power: Boolean(input.power),
  };

  if (nextInput.power && !player.input.power) {
    player.lastPowerPressedAt = nowMs;
  }
  player.lastInput = player.input;
  player.input = nextInput;
}

export function stepGame(state, deltaMs, nowMs = Date.now()) {
  state.tick += 1;
  pruneEvents(state, nowMs);

  if (!bothPlayersConnected(state)) {
    if (!state.winner) {
      state.status = 'waiting';
      state.statusText = 'Waiting for opponent';
    }
    return;
  }

  if (state.winner) {
    state.status = 'gameOver';
    state.statusText = `${playerLabel(state.winner)} Wins`;
    return;
  }

  if (state.status === 'goal') {
    if (nowMs >= state.goalResumeAt) {
      const directionY = state.lastScoredBy === 'p1' ? -1 : 1;
      resetRound(state, directionY, nowMs);
    }
    return;
  }

  state.status = 'playing';
  state.statusText = '';

  for (const id of PLAYER_IDS) {
    updatePaddle(state.players[id], deltaMs);
  }

  updatePuck(state, deltaMs, nowMs);
}

function updatePaddle(player, deltaMs) {
  const seconds = deltaMs / 1000;
  let ix = 0;
  let iy = 0;
  if (player.input.left) ix -= 1;
  if (player.input.right) ix += 1;
  if (player.input.up) iy -= 1;
  if (player.input.down) iy += 1;
  if (ix !== 0 || iy !== 0) {
    const inputLength = length(ix, iy);
    ix /= inputLength;
    iy /= inputLength;
  }

  const previousX = player.x;
  const previousY = player.y;
  player.x = clamp(player.x + ix * TUNING.paddleSpeed * seconds, TUNING.paddleRadius, GAME.width - TUNING.paddleRadius);
  player.y = clamp(player.y + iy * TUNING.paddleSpeed * seconds, LIMITS[player.id].minY, LIMITS[player.id].maxY);
  player.vx = (player.x - previousX) / Math.max(seconds, 0.001);
  player.vy = (player.y - previousY) / Math.max(seconds, 0.001);
}

function updatePuck(state, deltaMs, nowMs) {
  const seconds = deltaMs / 1000;
  state.puck.x += state.puck.vx * seconds;
  state.puck.y += state.puck.vy * seconds;

  const friction = Math.pow(TUNING.puckFrictionPerSecond, seconds);
  state.puck.vx *= friction;
  state.puck.vy *= friction;

  resolveWallCollisions(state);
  resolvePaddleCollision(state, state.players.p1, nowMs);
  resolvePaddleCollision(state, state.players.p2, nowMs);
  correctAxisLock(state.puck);
  capPuckSpeed(state.puck);
  checkGoal(state, nowMs);
}

function resolveWallCollisions(state) {
  const puck = state.puck;
  const r = TUNING.puckRadius;
  const left = 24 + r;
  const right = GAME.width - 24 - r;
  const topWall = 20 + r;
  const bottomWall = GAME.height - 20 - r;

  if (puck.x < left) {
    puck.x = left;
    puck.vx = Math.abs(puck.vx);
    state.debug.wallHits += 1;
  } else if (puck.x > right) {
    puck.x = right;
    puck.vx = -Math.abs(puck.vx);
    state.debug.wallHits += 1;
  }

  const inGoal = isPuckInGoalLane(puck);
  if (!inGoal && puck.y < topWall) {
    puck.y = topWall;
    puck.vy = Math.abs(puck.vy);
    state.debug.wallHits += 1;
  } else if (!inGoal && puck.y > bottomWall) {
    puck.y = bottomWall;
    puck.vy = -Math.abs(puck.vy);
    state.debug.wallHits += 1;
  }
}

function resolvePaddleCollision(state, paddle, nowMs) {
  if (!paddle.connected) return;

  const puck = state.puck;
  const dx = puck.x - paddle.x;
  const dy = puck.y - paddle.y;
  const minDistance = TUNING.puckRadius + TUNING.paddleRadius;
  const distance = length(dx, dy);
  if (distance <= 0 || distance >= minDistance) return;

  const nx = dx / distance;
  const ny = dy / distance;
  puck.x = paddle.x + nx * minDistance;
  puck.y = paddle.y + ny * minDistance;

  const incoming = puck.vx * nx + puck.vy * ny;
  if (incoming < 0) {
    puck.vx -= 2 * incoming * nx;
    puck.vy -= 2 * incoming * ny;
  }

  puck.vx += paddle.vx * TUNING.paddleVelocityInfluence;
  puck.vy += paddle.vy * TUNING.paddleVelocityInfluence;

  const powerHit = canPowerHit(paddle, nowMs);
  const boost = powerHit ? TUNING.powerHitMultiplier : TUNING.normalHitBoost;
  puck.vx *= boost;
  puck.vy *= boost;

  if (powerHit) {
    paddle.lastPowerUsedAt = nowMs;
    state.debug[`${paddle.id}PowerHits`] += 1;
    pushEvent(state, 'powerHit', {
      at: nowMs,
      player: paddle.id,
      x: puck.x,
      y: puck.y,
    });
  }

  state.debug.paddleHits += 1;
}

function canPowerHit(paddle, nowMs) {
  return (
    nowMs - paddle.lastPowerPressedAt <= TUNING.powerHitWindowMs &&
    nowMs - paddle.lastPowerUsedAt >= TUNING.powerHitCooldownMs
  );
}

function checkGoal(state, nowMs) {
  const puck = state.puck;
  if (!isPuckInGoalLane(puck)) return;

  if (puck.y < -TUNING.puckRadius) {
    awardPoint(state, 'p1', nowMs);
  } else if (puck.y > GAME.height + TUNING.puckRadius) {
    awardPoint(state, 'p2', nowMs);
  }
}

function awardPoint(state, playerId, nowMs) {
  if (state.status === 'goal' || state.winner) return;
  state.score[playerId] += 1;
  state.debug[`${playerId}Goals`] += 1;
  state.lastScoredBy = playerId;
  state.puck.vx = 0;
  state.puck.vy = 0;

  pushEvent(state, 'goal', {
    at: nowMs,
    player: playerId,
    score: { ...state.score },
  });

  if (state.score[playerId] >= GAME.winScore) {
    state.winner = playerId;
    state.status = 'gameOver';
    state.statusText = `${playerLabel(playerId)} Wins`;
    pushEvent(state, 'winner', {
      at: nowMs,
      player: playerId,
    });
    return;
  }

  state.status = 'goal';
  state.statusText = `${playerLabel(playerId)} scored`;
  state.goalResumeAt = nowMs + GAME.goalDelayMs;
}

function correctAxisLock(puck) {
  const speed = length(puck.vx, puck.vy);
  if (speed < 1) return;

  if (Math.abs(puck.vx) < TUNING.minAxisVelocity) {
    puck.vx = Math.sign(puck.vx || (Math.random() < 0.5 ? -1 : 1)) * TUNING.minAxisVelocity;
  }
  if (Math.abs(puck.vy) < TUNING.minAxisVelocity) {
    puck.vy = Math.sign(puck.vy || (Math.random() < 0.5 ? -1 : 1)) * TUNING.minAxisVelocity;
  }

  setVectorLength(puck, Math.max(speed, TUNING.puckStartSpeed * 0.7));
}

function capPuckSpeed(puck) {
  const speed = length(puck.vx, puck.vy);
  if (speed > TUNING.puckMaxSpeed) {
    setVectorLength(puck, TUNING.puckMaxSpeed);
  }
}

function isPuckInGoalLane(puck) {
  return Math.abs(puck.x - GAME.width / 2) <= TUNING.goalWidth / 2 - TUNING.puckRadius * 0.25;
}

export function bothPlayersConnected(state) {
  return state.players.p1.connected && state.players.p2.connected;
}

export function playerLabel(playerId) {
  return playerId === 'p1' ? 'Player 1' : 'Player 2';
}

export function pushEvent(state, type, payload = {}) {
  const event = {
    id: `${state.tick}-${state.events.length}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    ...payload,
  };
  state.events.push(event);
  return event;
}

function pruneEvents(state, nowMs) {
  state.events = state.events.filter((event) => !event.at || nowMs - event.at <= SERVER.eventTtlMs);
}

export function serializeState(state, roomInfo = {}) {
  return {
    version: state.version,
    roomId: state.roomId,
    tick: state.tick,
    status: state.status,
    statusText: state.statusText,
    winner: state.winner,
    players: {
      p1: publicPlayer(state.players.p1),
      p2: publicPlayer(state.players.p2),
    },
    puck: {
      x: state.puck.x,
      y: state.puck.y,
      vx: state.puck.vx,
      vy: state.puck.vy,
      speed: length(state.puck.vx, state.puck.vy),
    },
    score: { ...state.score },
    debug: { ...state.debug },
    events: state.events.map((event) => ({ ...event })),
    room: {
      playerCount: Number(state.players.p1.connected) + Number(state.players.p2.connected),
      spectatorCount: roomInfo.spectatorCount ?? 0,
    },
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    connected: player.connected,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
  };
}
