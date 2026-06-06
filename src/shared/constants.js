export const GAME = {
  width: 960,
  height: 540,
  winScore: 5,
  goalDelayMs: 900,
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
  centerFence: 18,
  paddleVelocityInfluence: 0.44,
};

export const SERVER = {
  port: 8787,
  tickRate: 60,
  staleRoomMs: 60_000,
  eventTtlMs: 1_200,
};

export const PLAYER_IDS = ['p1', 'p2'];

export const LIMITS = {
  p1: {
    minY: GAME.height / 2 + TUNING.centerFence + TUNING.paddleRadius,
    maxY: GAME.height - 34 - TUNING.paddleRadius,
  },
  p2: {
    minY: 34 + TUNING.paddleRadius,
    maxY: GAME.height / 2 - TUNING.centerFence - TUNING.paddleRadius,
  },
};

export const START_POSITIONS = {
  p1: { x: GAME.width / 2, y: GAME.height - 120 },
  p2: { x: GAME.width / 2, y: 120 },
};

export const MESSAGE_TYPES = {
  join: 'join',
  joined: 'joined',
  input: 'input',
  state: 'state',
  restart: 'restart',
  peerDisconnected: 'peerDisconnected',
  error: 'error',
  ping: 'ping',
  pong: 'pong',
};
