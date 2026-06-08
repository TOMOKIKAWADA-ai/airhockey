import { GAME, LIMITS, MAP, PLAYER_IDS, SERVER, START_POSITIONS, TUNING } from './constants.js';

const emptyInput = () => ({
  up: false,
  down: false,
  left: false,
  right: false,
  power: false,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const length = (x, y) => Math.hypot(x, y);

const scoreForGoal = {
  top: 'p1',
  bottom: 'p2',
  left: 'p4',
  right: 'p3',
};

const serveDirectionAfterScore = {
  p1: { x: 0, y: -1 },
  p2: { x: 0, y: 1 },
  p3: { x: 1, y: 0 },
  p4: { x: -1, y: 0 },
};

const wallSegments = () => {
  const m = MAP.margin;
  const lx = MAP.leftArmX;
  const rx = MAP.rightArmX;
  const ty = MAP.topArmY;
  const by = MAP.bottomArmY;
  const cx = MAP.centerX;
  const cy = MAP.centerY;
  const gw = TUNING.goalWidth / 2;

  return [
    // Goal end walls, split so the center opening can score.
    { x1: lx, y1: m, x2: cx - gw, y2: m },
    { x1: cx + gw, y1: m, x2: rx, y2: m },
    { x1: lx, y1: GAME.height - m, x2: cx - gw, y2: GAME.height - m },
    { x1: cx + gw, y1: GAME.height - m, x2: rx, y2: GAME.height - m },
    { x1: m, y1: ty, x2: m, y2: cy - gw },
    { x1: m, y1: cy + gw, x2: m, y2: by },
    { x1: GAME.width - m, y1: ty, x2: GAME.width - m, y2: cy - gw },
    { x1: GAME.width - m, y1: cy + gw, x2: GAME.width - m, y2: by },

    // The four inside corners of the cross-shaped rink.
    { x1: lx, y1: m, x2: lx, y2: ty },
    { x1: m, y1: ty, x2: lx, y2: ty },
    { x1: rx, y1: m, x2: rx, y2: ty },
    { x1: rx, y1: ty, x2: GAME.width - m, y2: ty },
    { x1: lx, y1: by, x2: lx, y2: GAME.height - m },
    { x1: m, y1: by, x2: lx, y2: by },
    { x1: rx, y1: by, x2: rx, y2: GAME.height - m },
    { x1: rx, y1: by, x2: GAME.width - m, y2: by },
  ];
};

const setVectorLength = (vector, targetLength) => {
  const currentLength = length(vector.vx, vector.vy);
  if (currentLength <= 0.0001) return vector;
  const scale = targetLength / currentLength;
  vector.vx *= scale;
  vector.vy *= scale;
  return vector;
};

const createScore = () => Object.fromEntries(PLAYER_IDS.map((id) => [id, 0]));

const createDebug = () => ({
  ...Object.fromEntries(PLAYER_IDS.map((id) => [`${id}PowerHits`, 0])),
  ...Object.fromEntries(PLAYER_IDS.map((id) => [`${id}Goals`, 0])),
  paddleHits: 0,
  wallHits: 0,
  puckRecoveries: 0,
});

export function createInitialGameState(roomId = '') {
  return {
    version: 2,
    roomId,
    tick: 0,
    status: 'lobby',
    statusText: 'Waiting for players. Press Start to fill empty slots with CPU.',
    winner: null,
    goalResumeAt: 0,
    countdownEndsAt: 0,
    lastScoredBy: null,
    players: Object.fromEntries(PLAYER_IDS.map((id) => [id, createPlayerState(id, false)])),
    puck: {
      x: GAME.width / 2,
      y: GAME.height / 2,
      vx: 0,
      vy: 0,
    },
    score: createScore(),
    debug: createDebug(),
    events: [],
  };
}

export function createPlayerState(id, connected) {
  const start = START_POSITIONS[id];
  return {
    id,
    connected,
    cpu: false,
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

export function startCountdown(state, nowMs = Date.now()) {
  resetScoresAndDebug(state);
  resetPlayerPositions(state);
  centerPuck(state);
  state.winner = null;
  state.lastScoredBy = null;
  state.goalResumeAt = 0;
  state.countdownEndsAt = nowMs + GAME.countdownMs;
  state.status = 'countdown';
  state.statusText = countdownText(state, nowMs);
  pushEvent(state, 'countdown', { at: nowMs, endsAt: state.countdownEndsAt });
}

export function resetMatch(state, nowMs = Date.now()) {
  startCountdown(state, nowMs);
  pushEvent(state, 'restart', { at: nowMs });
}

export function resetRound(state, scoredBy = state.lastScoredBy, nowMs = Date.now()) {
  resetPlayerPositions(state);
  centerPuck(state);
  const velocity = randomRoundVelocity(scoredBy);
  state.puck.vx = velocity.vx;
  state.puck.vy = velocity.vy;
  correctAxisLock(state.puck);
  capPuckSpeed(state.puck);
  state.goalResumeAt = 0;
  state.status = 'playing';
  state.statusText = '';
  pushEvent(state, 'roundStart', { at: nowMs });
}

export function setPlayerConnected(state, playerId, connected, options = {}) {
  const player = state.players[playerId];
  if (!player) return;
  player.connected = connected;
  player.cpu = options.cpu ?? (connected ? false : player.cpu);
  if (!connected) {
    player.cpu = false;
    player.input = emptyInput();
    player.lastInput = emptyInput();
  }
  if (!allPlayerSlotsActive(state) && !state.winner && state.status !== 'lobby') {
    state.status = 'waiting';
    state.statusText = connected ? 'Waiting for players' : `${playerLabel(playerId)} disconnected`;
    centerPuck(state);
  }
}

export function setPlayerCpu(state, playerId, cpu) {
  const player = state.players[playerId];
  if (!player) return;
  player.cpu = cpu;
  player.connected = cpu || player.connected;
  player.input = emptyInput();
  player.lastInput = emptyInput();
}

export function updateInput(state, playerId, input, nowMs = Date.now()) {
  const player = state.players[playerId];
  if (!player || player.cpu) return;
  setInput(player, input, nowMs);
}

export function stepGame(state, deltaMs, nowMs = Date.now()) {
  state.tick += 1;
  pruneEvents(state, nowMs);

  if (state.winner) {
    state.status = 'gameOver';
    state.statusText = `${playerLabel(state.winner)} Wins`;
    return;
  }

  if (state.status === 'lobby' || state.status === 'waiting') {
    return;
  }

  updateCpuInputs(state, nowMs);
  for (const id of PLAYER_IDS) {
    updatePaddle(state.players[id], deltaMs);
  }

  if (!allPlayerSlotsActive(state)) {
    state.status = 'waiting';
    state.statusText = 'Waiting for players';
    centerPuck(state);
    return;
  }

  if (state.status === 'countdown') {
    state.statusText = countdownText(state, nowMs);
    if (nowMs < state.countdownEndsAt) return;
    resetRound(state, null, nowMs);
  }

  if (state.status === 'goal') {
    if (nowMs >= state.goalResumeAt) {
      resetRound(state, state.lastScoredBy, nowMs);
    }
    return;
  }

  state.status = 'playing';
  state.statusText = '';
  updatePuck(state, deltaMs, nowMs);
}

function resetScoresAndDebug(state) {
  state.score = createScore();
  state.debug = createDebug();
}

function resetPlayerPositions(state) {
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
}

function centerPuck(state) {
  state.puck.x = GAME.width / 2;
  state.puck.y = GAME.height / 2;
  state.puck.vx = 0;
  state.puck.vy = 0;
}

function randomRoundVelocity(scoredBy = null) {
  const direction = serveDirectionAfterScore[scoredBy] || randomDirection();
  const baseAngle = Math.atan2(direction.y, direction.x);
  const spread = (Math.random() - 0.5) * (Math.PI / 2.2);
  const angle = baseAngle + spread;
  return {
    vx: Math.cos(angle) * TUNING.puckStartSpeed,
    vy: Math.sin(angle) * TUNING.puckStartSpeed,
  };
}

function randomDirection() {
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function setInput(player, input, nowMs) {
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

function updateCpuInputs(state, nowMs) {
  for (const id of PLAYER_IDS) {
    const player = state.players[id];
    if (!player.cpu) continue;

    const target = cpuTargetFor(id, state.puck);
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const closeToPuck = length(state.puck.x - player.x, state.puck.y - player.y) < TUNING.paddleRadius + TUNING.puckRadius + 42;

    setInput(
      player,
      {
        left: dx < -8,
        right: dx > 8,
        up: dy < -8,
        down: dy > 8,
        power: closeToPuck && nowMs - player.lastPowerUsedAt > TUNING.powerHitCooldownMs,
      },
      nowMs,
    );
  }
}

function cpuTargetFor(playerId, puck) {
  const start = START_POSITIONS[playerId];
  const limit = LIMITS[playerId];
  const centerX = GAME.width / 2;
  const centerY = GAME.height / 2;
  const target = { x: start.x, y: start.y };

  if (playerId === 'p1' && puck.y > centerY - 70) {
    target.x = puck.x;
    target.y = Math.max(puck.y + 28, start.y - 130);
  } else if (playerId === 'p2' && puck.y < centerY + 70) {
    target.x = puck.x;
    target.y = Math.min(puck.y - 28, start.y + 130);
  } else if (playerId === 'p3' && puck.x < centerX + 70) {
    target.x = Math.min(puck.x - 28, start.x + 130);
    target.y = puck.y;
  } else if (playerId === 'p4' && puck.x > centerX - 70) {
    target.x = Math.max(puck.x + 28, start.x - 130);
    target.y = puck.y;
  }

  return {
    x: clamp(target.x, limit.minX, limit.maxX),
    y: clamp(target.y, limit.minY, limit.maxY),
  };
}

function updatePaddle(player, deltaMs) {
  if (!player.connected) return;

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
  const speed = TUNING.paddleSpeed * (player.cpu ? TUNING.cpuSpeedScale : 1);
  const limit = LIMITS[player.id];
  player.x = clamp(player.x + ix * speed * seconds, limit.minX, limit.maxX);
  player.y = clamp(player.y + iy * speed * seconds, limit.minY, limit.maxY);
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

  checkGoal(state, nowMs);
  if (state.status !== 'playing') return;

  resolveWallCollisions(state);
  recoverEscapedPuck(state, nowMs);
  for (const id of PLAYER_IDS) {
    resolvePaddleCollision(state, state.players[id], nowMs);
  }
  correctAxisLock(state.puck);
  capPuckSpeed(state.puck);
  checkGoal(state, nowMs);
  if (state.status === 'playing') {
    recoverEscapedPuck(state, nowMs);
  }
}

function resolveWallCollisions(state) {
  let hit = false;
  for (const segment of wallSegments()) {
    hit = resolveSegmentCollision(state.puck, segment) || hit;
  }
  if (hit) state.debug.wallHits += 1;
}

function resolveSegmentCollision(puck, segment) {
  const r = TUNING.puckRadius;
  const sx = segment.x2 - segment.x1;
  const sy = segment.y2 - segment.y1;
  const segmentLengthSq = sx * sx + sy * sy;
  const t = segmentLengthSq === 0 ? 0 : clamp(((puck.x - segment.x1) * sx + (puck.y - segment.y1) * sy) / segmentLengthSq, 0, 1);
  const closestX = segment.x1 + sx * t;
  const closestY = segment.y1 + sy * t;
  const dx = puck.x - closestX;
  const dy = puck.y - closestY;
  const distanceSq = dx * dx + dy * dy;

  if (distanceSq >= r * r) return false;

  const distance = Math.sqrt(distanceSq);
  let nx = distance > 0.0001 ? dx / distance : 0;
  let ny = distance > 0.0001 ? dy / distance : 0;

  if (distance <= 0.0001) {
    if (Math.abs(sx) < Math.abs(sy)) {
      nx = Math.sign(puck.vx || (puck.x - MAP.centerX)) || 1;
      ny = 0;
    } else {
      nx = 0;
      ny = Math.sign(puck.vy || (puck.y - MAP.centerY)) || 1;
    }
  }

  puck.x = closestX + nx * r;
  puck.y = closestY + ny * r;
  const incoming = puck.vx * nx + puck.vy * ny;
  if (incoming < 0) {
    puck.vx -= 2 * incoming * nx;
    puck.vy -= 2 * incoming * ny;
  }
  return true;
}

function recoverEscapedPuck(state, nowMs) {
  const puck = state.puck;
  if (isPuckInPlayableCenterArea(puck) || isPuckEnteringGoalMouth(puck)) return false;

  const speed = Math.max(length(puck.vx, puck.vy), TUNING.puckStartSpeed * 0.85);
  const nearest = nearestPlayableCenterPoint(puck);
  puck.x = nearest.x;
  puck.y = nearest.y;

  let nx = MAP.centerX - puck.x;
  let ny = MAP.centerY - puck.y;
  const normalLength = length(nx, ny);
  if (normalLength <= 0.001) {
    nx = Math.sign(-puck.vx || 1);
    ny = Math.sign(-puck.vy || 1);
  } else {
    nx /= normalLength;
    ny /= normalLength;
  }

  puck.vx = nx * speed;
  puck.vy = ny * speed;
  correctAxisLock(puck);
  capPuckSpeed(puck);

  state.debug.wallHits += 1;
  state.debug.puckRecoveries += 1;
  pushEvent(state, 'puckRecovered', {
    at: nowMs,
    x: puck.x,
    y: puck.y,
  });
  return true;
}

function isPuckInPlayableCenterArea(puck) {
  return isPointInRect(puck, verticalPlayableCenterRect()) || isPointInRect(puck, horizontalPlayableCenterRect());
}

function isPuckEnteringGoalMouth(puck) {
  const r = TUNING.puckRadius;
  const m = MAP.margin;
  return (
    (isTopBottomGoalLane(puck) && (puck.y < m + r || puck.y > GAME.height - m - r)) ||
    (isLeftRightGoalLane(puck) && (puck.x < m + r || puck.x > GAME.width - m - r))
  );
}

function nearestPlayableCenterPoint(puck) {
  const vertical = closestPointToRect(puck, verticalPlayableCenterRect());
  const horizontal = closestPointToRect(puck, horizontalPlayableCenterRect());
  const verticalDistance = squaredDistance(puck, vertical);
  const horizontalDistance = squaredDistance(puck, horizontal);
  return verticalDistance <= horizontalDistance ? vertical : horizontal;
}

function verticalPlayableCenterRect() {
  const r = TUNING.puckRadius;
  return {
    minX: MAP.leftArmX + r,
    maxX: MAP.rightArmX - r,
    minY: MAP.margin + r,
    maxY: GAME.height - MAP.margin - r,
  };
}

function horizontalPlayableCenterRect() {
  const r = TUNING.puckRadius;
  return {
    minX: MAP.margin + r,
    maxX: GAME.width - MAP.margin - r,
    minY: MAP.topArmY + r,
    maxY: MAP.bottomArmY - r,
  };
}

function isPointInRect(point, rect) {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
}

function closestPointToRect(point, rect) {
  return {
    x: clamp(point.x, rect.minX, rect.maxX),
    y: clamp(point.y, rect.minY, rect.maxY),
  };
}

function squaredDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
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
  const r = TUNING.puckRadius;
  const m = MAP.margin;

  if (isTopBottomGoalLane(puck) && puck.y < m - r) {
    awardPoint(state, scoreForGoal.top, nowMs);
  } else if (isTopBottomGoalLane(puck) && puck.y > GAME.height - m + r) {
    awardPoint(state, scoreForGoal.bottom, nowMs);
  } else if (isLeftRightGoalLane(puck) && puck.x < m - r) {
    awardPoint(state, scoreForGoal.left, nowMs);
  } else if (isLeftRightGoalLane(puck) && puck.x > GAME.width - m + r) {
    awardPoint(state, scoreForGoal.right, nowMs);
  }
}

function awardPoint(state, playerId, nowMs) {
  if (state.status === 'goal' || state.winner) return;
  state.score[playerId] += 1;
  state.debug[`${playerId}Goals`] += 1;
  state.lastScoredBy = playerId;
  centerPuck(state);

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

function isTopBottomGoalLane(puck) {
  return Math.abs(puck.x - GAME.width / 2) <= TUNING.goalWidth / 2 - TUNING.puckRadius * 0.25;
}

function isLeftRightGoalLane(puck) {
  return Math.abs(puck.y - GAME.height / 2) <= TUNING.goalWidth / 2 - TUNING.puckRadius * 0.25;
}

export function allPlayerSlotsActive(state) {
  return PLAYER_IDS.every((id) => state.players[id].connected);
}

export function bothPlayersConnected(state) {
  return allPlayerSlotsActive(state);
}

export function playerLabel(playerId) {
  return `Player ${PLAYER_IDS.indexOf(playerId) + 1}`;
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

function countdownText(state, nowMs) {
  const seconds = Math.max(0, Math.ceil((state.countdownEndsAt - nowMs) / 1000));
  return `Starting in ${seconds}`;
}

export function serializeState(state, roomInfo = {}) {
  const players = Object.fromEntries(PLAYER_IDS.map((id) => [id, publicPlayer(state.players[id])]));
  const humanCount = PLAYER_IDS.filter((id) => state.players[id].connected && !state.players[id].cpu).length;
  const cpuCount = PLAYER_IDS.filter((id) => state.players[id].connected && state.players[id].cpu).length;

  return {
    version: state.version,
    roomId: state.roomId,
    tick: state.tick,
    status: state.status,
    statusText: state.statusText,
    winner: state.winner,
    lastScoredBy: state.lastScoredBy,
    countdownMsRemaining: state.status === 'countdown' ? Math.max(0, state.countdownEndsAt - Date.now()) : 0,
    players,
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
      playerCount: humanCount,
      cpuCount,
      spectatorCount: roomInfo.spectatorCount ?? 0,
    },
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    connected: player.connected,
    cpu: player.cpu,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
  };
}
