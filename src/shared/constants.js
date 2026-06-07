export const GAME = {
  width: 900,
  height: 900,
  winScore: 5,
  goalDelayMs: 900,
  countdownMs: 5_000,
};

export const TUNING = {
  paddleRadius: 33,
  paddleSpeed: 360,
  puckRadius: 17,
  puckStartSpeed: 270,
  puckMaxSpeed: 760,
  puckFrictionPerSecond: 0.985,
  normalHitBoost: 1.035,
  powerHitMultiplier: 1.45,
  powerHitWindowMs: 150,
  powerHitCooldownMs: 400,
  minAxisVelocity: 70,
  goalWidth: 260,
  armWidth: 430,
  centerFence: 22,
  paddleVelocityInfluence: 0.44,
  cpuSpeedScale: 0.78,
};

export const SERVER = {
  port: 8787,
  tickRate: 60,
  staleRoomMs: 60_000,
  eventTtlMs: 1_200,
};

export const PLAYER_IDS = ['p1', 'p2', 'p3', 'p4'];

export const MAP = {
  margin: 24,
  armWidth: TUNING.armWidth,
  get centerX() {
    return GAME.width / 2;
  },
  get centerY() {
    return GAME.height / 2;
  },
  get leftArmX() {
    return (GAME.width - TUNING.armWidth) / 2;
  },
  get rightArmX() {
    return (GAME.width + TUNING.armWidth) / 2;
  },
  get topArmY() {
    return (GAME.height - TUNING.armWidth) / 2;
  },
  get bottomArmY() {
    return (GAME.height + TUNING.armWidth) / 2;
  },
};

export const LIMITS = {
  p1: {
    minX: MAP.leftArmX + TUNING.paddleRadius,
    maxX: MAP.rightArmX - TUNING.paddleRadius,
    minY: GAME.height / 2 + TUNING.centerFence + TUNING.paddleRadius,
    maxY: GAME.height - MAP.margin - TUNING.paddleRadius,
  },
  p2: {
    minX: MAP.leftArmX + TUNING.paddleRadius,
    maxX: MAP.rightArmX - TUNING.paddleRadius,
    minY: MAP.margin + TUNING.paddleRadius,
    maxY: GAME.height / 2 - TUNING.centerFence - TUNING.paddleRadius,
  },
  p3: {
    minX: MAP.margin + TUNING.paddleRadius,
    maxX: GAME.width / 2 - TUNING.centerFence - TUNING.paddleRadius,
    minY: MAP.topArmY + TUNING.paddleRadius,
    maxY: MAP.bottomArmY - TUNING.paddleRadius,
  },
  p4: {
    minX: GAME.width / 2 + TUNING.centerFence + TUNING.paddleRadius,
    maxX: GAME.width - MAP.margin - TUNING.paddleRadius,
    minY: MAP.topArmY + TUNING.paddleRadius,
    maxY: MAP.bottomArmY - TUNING.paddleRadius,
  },
};

export const START_POSITIONS = {
  p1: { x: GAME.width / 2, y: GAME.height - 115 },
  p2: { x: GAME.width / 2, y: 115 },
  p3: { x: 115, y: GAME.height / 2 },
  p4: { x: GAME.width - 115, y: GAME.height / 2 },
};

export const MESSAGE_TYPES = {
  join: 'join',
  joined: 'joined',
  input: 'input',
  state: 'state',
  start: 'start',
  restart: 'restart',
  peerDisconnected: 'peerDisconnected',
  error: 'error',
  ping: 'ping',
  pong: 'pong',
};
