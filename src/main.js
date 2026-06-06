import Phaser from 'phaser';
import { GAME, MESSAGE_TYPES, TUNING } from './shared/constants.js';
import './styles.css';

const COLORS = {
  table: 0x123f56,
  tableDark: 0x082837,
  tableLight: 0x2cc7d2,
  goal: 0xffd166,
  p1: 0xff5f7a,
  p1Dark: 0x9e2840,
  p2: 0x45a6ff,
  p2Dark: 0x1d4f91,
  puck: 0xf7fbff,
  puckShadow: 0xa8b8c8,
  text: '#f7fbff',
  mutedText: '#bfe9ef',
  warning: '#ffd166',
};

const ROLE_LABELS = {
  p1: 'Player 1 / Bottom',
  p2: 'Player 2 / Top',
  spectator: 'Spectator',
  none: 'Not joined',
};

const client = {
  ws: null,
  roomId: '',
  role: 'none',
  connected: false,
  status: 'not-connected',
  lastState: null,
  lastInput: null,
  lastInputSentAt: 0,
  seenEvents: new Set(),
  error: '',
};

const ui = createRoomUi();

class PaddleVisual {
  constructor(scene, color, darkColor) {
    this.scene = scene;
    this.color = color;
    this.darkColor = darkColor;
    this.x = GAME.width / 2;
    this.y = GAME.height / 2;
    this.flashUntil = 0;
    this.shadow = scene.add.circle(this.x + 4, this.y + 5, TUNING.paddleRadius, 0x000000, 0.22);
    this.body = scene.add.circle(this.x, this.y, TUNING.paddleRadius, color, 1);
    this.inner = scene.add.circle(this.x, this.y, TUNING.paddleRadius * 0.54, darkColor, 0.86);
    this.ring = scene.add.circle(this.x, this.y, TUNING.paddleRadius + 4, color, 0);
    this.ring.setStrokeStyle(4, color, 0);
  }

  setTarget(x, y, immediate = false) {
    if (immediate) {
      this.x = x;
      this.y = y;
      return;
    }
    this.x += (x - this.x) * 0.45;
    this.y += (y - this.y) * 0.45;
  }

  flash(nowMs) {
    this.flashUntil = nowMs + 170;
    this.ring.setAlpha(0.95);
  }

  render(nowMs) {
    const isFlashing = nowMs < this.flashUntil;
    const ringAlpha = Phaser.Math.Clamp(this.ring.alpha - 0.045, isFlashing ? 0.65 : 0, 1);
    const scale = isFlashing ? 1.08 : 1;

    this.shadow.setPosition(this.x + 4, this.y + 5);
    this.body.setPosition(this.x, this.y).setFillStyle(isFlashing ? 0xffffff : this.color);
    this.inner.setPosition(this.x, this.y).setScale(scale).setFillStyle(this.darkColor);
    this.ring.setPosition(this.x, this.y).setScale(scale).setAlpha(ringAlpha);
    this.ring.setStrokeStyle(4, isFlashing ? 0xffffff : this.color, ringAlpha);
  }
}

class AirHockeyOnlineScene extends Phaser.Scene {
  constructor() {
    super('AirHockeyOnlineScene');
  }

  preload() {
    this.load.image('tableTexture', 'assets/table-bg.svg');
  }

  create() {
    this.createTable();
    this.createTexts();
    this.createControls();
    this.createPaddles();
    this.createPuck();
    this.displayState = createDisplayState();

    this.input.keyboard.on('keydown-R', () => {
      if (client.role === 'p1' || client.role === 'p2') {
        sendMessage({ type: MESSAGE_TYPES.restart });
      }
    });

    window.__AIR_HOCKEY_CLIENT_STATE__ = () => ({
      roomId: client.roomId,
      role: client.role,
      connected: client.connected,
      status: client.status,
      lastState: client.lastState,
      error: client.error,
    });

    autoJoinFromUrl();
  }

  createTable() {
    this.add.rectangle(GAME.width / 2, GAME.height / 2, GAME.width, GAME.height, COLORS.table);

    const texture = this.textures.exists('tableTexture') ? this.add.image(GAME.width / 2, GAME.height / 2, 'tableTexture') : null;
    if (texture) {
      texture.setDisplaySize(GAME.width, GAME.height);
      texture.setAlpha(0.36);
    }

    const goalTop = { x: (GAME.width - TUNING.goalWidth) / 2, width: TUNING.goalWidth };
    const goalBottom = { x: (GAME.width - TUNING.goalWidth) / 2, width: TUNING.goalWidth };

    this.field = this.add.graphics();
    this.field.fillStyle(COLORS.tableDark, 1);
    this.field.fillRoundedRect(20, 20, GAME.width - 40, GAME.height - 40, 28);
    this.field.lineStyle(4, COLORS.tableLight, 1);
    this.field.strokeRoundedRect(20, 20, GAME.width - 40, GAME.height - 40, 28);

    this.field.lineStyle(3, 0xeefcff, 0.7);
    this.field.lineBetween(42, GAME.height / 2, GAME.width - 42, GAME.height / 2);
    this.field.strokeCircle(GAME.width / 2, GAME.height / 2, 72);
    this.field.strokeCircle(GAME.width / 2, GAME.height / 2, 8);

    this.field.fillStyle(COLORS.goal, 0.95);
    this.field.fillRoundedRect(goalTop.x, 20, goalTop.width, 14, 7);
    this.field.fillRoundedRect(goalBottom.x, GAME.height - 34, goalBottom.width, 14, 7);

    this.field.lineStyle(5, COLORS.goal, 0.85);
    this.field.lineBetween(goalTop.x, 20, goalTop.x + goalTop.width, 20);
    this.field.lineBetween(goalBottom.x, GAME.height - 20, goalBottom.x + goalBottom.width, GAME.height - 20);

    this.add.text(GAME.width / 2, 45, 'P1 SCORES', {
      color: '#ffe8a3',
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(GAME.width / 2, GAME.height - 46, 'P2 SCORES', {
      color: '#ffe8a3',
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      fontStyle: 'bold',
    }).setOrigin(0.5);
  }

  createTexts() {
    this.scoreText = this.add.text(58, 98, 'P2 0\nP1 0', {
      color: COLORS.text,
      fontFamily: 'Arial, sans-serif',
      fontSize: '30px',
      fontStyle: 'bold',
      stroke: '#05212d',
      strokeThickness: 5,
      align: 'left',
      lineSpacing: 4,
    }).setOrigin(0, 0.5);

    this.roleText = this.add.text(GAME.width - 46, 44, 'Not joined', {
      color: COLORS.mutedText,
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      fontStyle: 'bold',
      align: 'right',
    }).setOrigin(1, 0);

    this.roomText = this.add.text(46, 40, '', {
      color: COLORS.mutedText,
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
    }).setOrigin(0, 0);

    this.stateText = this.add.text(GAME.width / 2, GAME.height / 2 + 112, 'Create or join a room', {
      color: COLORS.warning,
      fontFamily: 'Arial, sans-serif',
      fontSize: '26px',
      fontStyle: 'bold',
      stroke: '#05212d',
      strokeThickness: 5,
      align: 'center',
    }).setOrigin(0.5);

    this.helpP1Text = this.add.text(46, GAME.height - 13, 'Move: WASD / Arrow keys   Power: Shift / Space', {
      color: COLORS.mutedText,
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
    }).setOrigin(0, 1);

    this.helpP2Text = this.add.text(GAME.width - 46, GAME.height - 13, 'R: Restart request', {
      color: COLORS.mutedText,
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
    }).setOrigin(1, 1);
  }

  createControls() {
    this.keys = this.input.keyboard.addKeys({
      w: Phaser.Input.Keyboard.KeyCodes.W,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      shift: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
    });
  }

  createPaddles() {
    this.paddles = {
      p1: new PaddleVisual(this, COLORS.p1, COLORS.p1Dark),
      p2: new PaddleVisual(this, COLORS.p2, COLORS.p2Dark),
    };
  }

  createPuck() {
    this.puckTrail = this.add.graphics();
    this.hitRing = this.add.circle(GAME.width / 2, GAME.height / 2, TUNING.puckRadius + 12, 0xffffff, 0);
    this.hitRing.setStrokeStyle(4, 0xffffff, 0);
    this.puckShadow = this.add.circle(GAME.width / 2 + 3, GAME.height / 2 + 4, TUNING.puckRadius, 0x000000, 0.24);
    this.puck = this.add.circle(GAME.width / 2, GAME.height / 2, TUNING.puckRadius, COLORS.puck, 1);
    this.puck.setStrokeStyle(4, COLORS.puckShadow, 0.9);
    this.lastPuckPositions = [];
    this.lastHitRing = { at: -Infinity, x: GAME.width / 2, y: GAME.height / 2 };
  }

  update(time) {
    this.sendInput(time);
    this.consumeServerState(time);
    this.renderPaddles(time);
    this.renderPuck(time);
    this.updateTexts();
  }

  sendInput(nowMs) {
    if (!client.connected || (client.role !== 'p1' && client.role !== 'p2')) return;
    const input = {
      up: this.keys.w.isDown || this.keys.up.isDown,
      down: this.keys.s.isDown || this.keys.down.isDown,
      left: this.keys.a.isDown || this.keys.left.isDown,
      right: this.keys.d.isDown || this.keys.right.isDown,
      power: this.keys.shift.isDown || this.keys.space.isDown,
    };

    const changed = !client.lastInput || Object.keys(input).some((key) => input[key] !== client.lastInput[key]);
    if (changed || nowMs - client.lastInputSentAt > 50) {
      client.lastInput = input;
      client.lastInputSentAt = nowMs;
      sendMessage({ type: MESSAGE_TYPES.input, input });
    }
  }

  consumeServerState(nowMs) {
    const state = client.lastState;
    if (!state) return;

    if (!this.displayState.initialized) {
      this.displayState = createDisplayState(state);
    }

    for (const id of ['p1', 'p2']) {
      this.displayState.players[id].x += (state.players[id].x - this.displayState.players[id].x) * 0.45;
      this.displayState.players[id].y += (state.players[id].y - this.displayState.players[id].y) * 0.45;
    }
    this.displayState.puck.x += (state.puck.x - this.displayState.puck.x) * 0.5;
    this.displayState.puck.y += (state.puck.y - this.displayState.puck.y) * 0.5;

    for (const event of state.events || []) {
      if (client.seenEvents.has(event.id)) continue;
      client.seenEvents.add(event.id);
      if (event.type === 'powerHit') {
        this.paddles[event.player]?.flash(nowMs);
        this.lastHitRing = { at: nowMs, x: event.x, y: event.y };
        this.cameras.main.shake(90, 0.006);
      }
      if (event.type === 'goal') {
        this.cameras.main.shake(80, 0.004);
      }
      if (client.seenEvents.size > 200) {
        client.seenEvents = new Set([...client.seenEvents].slice(-120));
      }
    }
  }

  renderPaddles(nowMs) {
    for (const id of ['p1', 'p2']) {
      const target = this.displayState.players[id];
      this.paddles[id].setTarget(target.x, target.y, !this.displayState.initialized);
      this.paddles[id].render(nowMs);
    }
  }

  renderPuck(nowMs) {
    const puck = this.displayState.puck;
    this.lastPuckPositions.push({ x: puck.x, y: puck.y });
    if (this.lastPuckPositions.length > 9) this.lastPuckPositions.shift();

    this.puckTrail.clear();
    this.lastPuckPositions.forEach((p, i) => {
      const alpha = (i + 1) / this.lastPuckPositions.length;
      this.puckTrail.fillStyle(COLORS.puck, alpha * 0.08);
      this.puckTrail.fillCircle(p.x, p.y, TUNING.puckRadius * alpha);
    });

    this.puckShadow.setPosition(puck.x + 3, puck.y + 4);
    this.puck.setPosition(puck.x, puck.y);

    const ringAge = nowMs - this.lastHitRing.at;
    if (ringAge < 190) {
      const t = ringAge / 190;
      this.hitRing.setPosition(this.lastHitRing.x, this.lastHitRing.y);
      this.hitRing.setRadius(TUNING.puckRadius + 12 + t * 22);
      this.hitRing.setStrokeStyle(4, 0xffffff, 1 - t);
      this.hitRing.setAlpha(1 - t);
    } else {
      this.hitRing.setAlpha(0);
    }
  }

  updateTexts() {
    const state = client.lastState;
    const score = state?.score || { p1: 0, p2: 0 };
    this.scoreText.setText(`P2 ${score.p2}\nP1 ${score.p1}`);
    this.roleText.setText(`${ROLE_LABELS[client.role] || ROLE_LABELS.none}\n${connectionLabel()}`);
    this.roomText.setText(client.roomId ? `Room: ${client.roomId}` : '');

    let message = 'Create or join a room';
    if (client.error) {
      message = client.error;
    } else if (client.status === 'connecting') {
      message = 'Connecting...';
    } else if (client.status === 'disconnected') {
      message = 'Disconnected';
    } else if (state?.winner) {
      message = `${ROLE_LABELS[state.winner].split(' / ')[0]} Wins!\nPress R to restart`;
    } else if (state?.statusText) {
      message = state.statusText;
    } else if (client.role === 'spectator') {
      message = 'Spectating';
    } else if (client.role === 'p1' || client.role === 'p2') {
      message = 'Online match';
    }
    this.stateText.setText(message);
  }
}

function createDisplayState(state = null) {
  return {
    initialized: Boolean(state),
    players: {
      p1: {
        x: state?.players?.p1?.x ?? GAME.width / 2,
        y: state?.players?.p1?.y ?? GAME.height - 120,
      },
      p2: {
        x: state?.players?.p2?.x ?? GAME.width / 2,
        y: state?.players?.p2?.y ?? 120,
      },
    },
    puck: {
      x: state?.puck?.x ?? GAME.width / 2,
      y: state?.puck?.y ?? GAME.height / 2,
    },
  };
}

function createRoomUi() {
  const overlay = document.createElement('section');
  overlay.className = 'room-panel';
  overlay.innerHTML = `
    <div class="room-panel__row">
      <button type="button" data-action="create">Create room</button>
      <input type="text" data-room-input placeholder="Room ID" maxlength="32" />
      <button type="button" data-action="join">Join</button>
    </div>
    <div class="room-panel__share" data-share hidden>
      <span data-share-url></span>
      <button type="button" data-action="copy">Copy URL</button>
    </div>
    <div class="room-panel__message" data-message></div>
  `;
  document.body.appendChild(overlay);

  const roomInput = overlay.querySelector('[data-room-input]');
  const share = overlay.querySelector('[data-share]');
  const shareUrl = overlay.querySelector('[data-share-url]');
  const message = overlay.querySelector('[data-message]');

  overlay.querySelector('[data-action="create"]').addEventListener('click', () => {
    const roomId = createRoomId();
    roomInput.value = roomId;
    setRoomInUrl(roomId);
    connectToRoom(roomId);
  });

  overlay.querySelector('[data-action="join"]').addEventListener('click', () => {
    const roomId = sanitizeRoomId(roomInput.value);
    if (!roomId) {
      setUiMessage('Enter a room ID');
      return;
    }
    setRoomInUrl(roomId);
    connectToRoom(roomId);
  });

  overlay.querySelector('[data-action="copy"]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl.textContent);
      setUiMessage('Share URL copied');
    } catch {
      setUiMessage('Copy failed. Select the URL manually.');
    }
  });

  roomInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      overlay.querySelector('[data-action="join"]').click();
    }
  });

  return {
    overlay,
    roomInput,
    share,
    shareUrl,
    message,
  };
}

function autoJoinFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const roomId = sanitizeRoomId(params.get('room') || '');
  if (roomId) {
    ui.roomInput.value = roomId;
    connectToRoom(roomId);
  }
}

function connectToRoom(roomId) {
  const wsUrl = resolveWsUrl();
  client.roomId = roomId;
  client.role = 'none';
  client.status = 'connecting';
  client.connected = false;
  client.error = '';
  client.lastState = null;
  client.lastInput = null;
  client.seenEvents.clear();
  updateShareUi(roomId);

  if (!wsUrl) {
    client.status = 'disconnected';
    client.error = 'WebSocket URL is not configured';
    setUiMessage('Deploy the WebSocket server, then set VITE_WS_URL on Vercel.');
    return;
  }

  if (client.ws) {
    client.ws.close();
  }

  const ws = new WebSocket(wsUrl);
  client.ws = ws;
  setUiMessage(`Connecting to ${wsUrl}`);

  ws.addEventListener('open', () => {
    client.connected = true;
    client.status = 'connected';
    sendMessage({
      type: MESSAGE_TYPES.join,
      roomId,
    });
  });

  ws.addEventListener('message', (event) => {
    handleServerMessage(JSON.parse(event.data));
  });

  ws.addEventListener('close', () => {
    client.connected = false;
    client.status = 'disconnected';
    setUiMessage('Disconnected from server');
  });

  ws.addEventListener('error', () => {
    client.error = 'WebSocket connection failed';
    setUiMessage(client.error);
  });
}

function handleServerMessage(message) {
  if (message.type === MESSAGE_TYPES.joined) {
    client.role = message.role;
    client.roomId = message.roomId;
    setUiMessage(message.role === 'spectator' ? 'Room is full. You are spectating.' : `Joined as ${ROLE_LABELS[message.role]}`);
    updateShareUi(message.roomId);
    return;
  }

  if (message.type === MESSAGE_TYPES.state) {
    client.lastState = message.state;
    client.error = '';
    return;
  }

  if (message.type === MESSAGE_TYPES.peerDisconnected) {
    setUiMessage('Opponent disconnected');
    return;
  }

  if (message.type === MESSAGE_TYPES.error) {
    client.error = message.message || 'Server error';
    setUiMessage(client.error);
  }
}

function sendMessage(message) {
  if (client.ws?.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}

function resolveWsUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (['localhost', '127.0.0.1', ''].includes(window.location.hostname) || window.location.protocol === 'file:') {
    return 'ws://127.0.0.1:8787';
  }
  return '';
}

function createRoomId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

function sanitizeRoomId(roomId) {
  return String(roomId || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function setRoomInUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  window.history.replaceState({}, '', url);
}

function updateShareUi(roomId) {
  if (!roomId) {
    ui.share.hidden = true;
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  ui.shareUrl.textContent = url.toString();
  ui.share.hidden = false;
}

function setUiMessage(message) {
  ui.message.textContent = message;
}

function connectionLabel() {
  if (client.status === 'connecting') return 'Connecting';
  if (client.connected) return 'Connected';
  if (client.status === 'disconnected') return 'Disconnected';
  return 'Offline';
}

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#071923',
  width: GAME.width,
  height: GAME.height,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    pixelArt: false,
  },
  scene: AirHockeyOnlineScene,
};

new Phaser.Game(config);
