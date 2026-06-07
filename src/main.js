import Phaser from 'phaser';
import { GAME, MAP, MESSAGE_TYPES, PLAYER_IDS, TUNING } from './shared/constants.js';
import './styles.css';

const COLORS = {
  page: 0x071923,
  table: 0x10394a,
  tableDark: 0x082837,
  tableLight: 0x2cc7d2,
  guide: 0xeefcff,
  goal: 0xffd166,
  p1: 0xff5f7a,
  p1Dark: 0x9e2840,
  p2: 0x45a6ff,
  p2Dark: 0x1d4f91,
  p3: 0x6fe374,
  p3Dark: 0x23773a,
  p4: 0xffa94f,
  p4Dark: 0x9b5018,
  puck: 0xf7fbff,
  puckShadow: 0xa8b8c8,
  text: '#f7fbff',
  mutedText: '#bfe9ef',
  warning: '#ffd166',
};

const ROLE_LABELS = {
  p1: 'Player 1 / Bottom',
  p2: 'Player 2 / Top',
  p3: 'Player 3 / Left',
  p4: 'Player 4 / Right',
  spectator: 'Spectator',
  none: 'Not joined',
};

const PLAYER_COLORS = {
  p1: [COLORS.p1, COLORS.p1Dark],
  p2: [COLORS.p2, COLORS.p2Dark],
  p3: [COLORS.p3, COLORS.p3Dark],
  p4: [COLORS.p4, COLORS.p4Dark],
};

const DRAG_DEADZONE = 10;

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
  constructor(scene, id, color, darkColor) {
    this.scene = scene;
    this.id = id;
    this.color = color;
    this.darkColor = darkColor;
    this.x = GAME.width / 2;
    this.y = GAME.height / 2;
    this.flashUntil = 0;
    this.shadow = scene.add.circle(this.x + 4, this.y + 5, TUNING.paddleRadius, 0x000000, 0.22).setDepth(3);
    this.body = scene.add.circle(this.x, this.y, TUNING.paddleRadius, color, 1).setDepth(4);
    this.inner = scene.add.circle(this.x, this.y, TUNING.paddleRadius * 0.54, darkColor, 0.86).setDepth(5);
    this.ring = scene.add.circle(this.x, this.y, TUNING.paddleRadius + 4, color, 0).setDepth(6);
    this.label = scene.add.text(this.x, this.y, id.toUpperCase(), {
      color: '#ffffff',
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      stroke: '#05212d',
      strokeThickness: 3,
      align: 'center',
    }).setOrigin(0.5).setDepth(7);
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

  render(nowMs, player) {
    const isFlashing = nowMs < this.flashUntil;
    const connected = Boolean(player?.connected);
    const alpha = connected ? 1 : 0.28;
    const ringAlpha = Phaser.Math.Clamp(this.ring.alpha - 0.045, isFlashing ? 0.65 : 0, 1);
    const scale = isFlashing ? 1.08 : 1;

    this.shadow.setPosition(this.x + 4, this.y + 5).setAlpha(connected ? 0.22 : 0.08);
    this.body.setPosition(this.x, this.y).setAlpha(alpha).setFillStyle(isFlashing ? 0xffffff : this.color);
    this.inner.setPosition(this.x, this.y).setAlpha(alpha).setScale(scale).setFillStyle(this.darkColor);
    this.ring.setPosition(this.x, this.y).setScale(scale).setAlpha(ringAlpha);
    this.ring.setStrokeStyle(4, isFlashing ? 0xffffff : this.color, ringAlpha);
    this.label.setPosition(this.x, this.y).setAlpha(connected ? 1 : 0.45).setText(player?.cpu ? `${this.id.toUpperCase()}\nCPU` : this.id.toUpperCase());
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
    this.createControls();
    this.createPaddles();
    this.createPuck();
    this.createTexts();
    this.displayState = createDisplayState();

    this.input.keyboard.on('keydown-R', () => {
      if (PLAYER_IDS.includes(client.role)) {
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
    this.add.rectangle(GAME.width / 2, GAME.height / 2, GAME.width, GAME.height, COLORS.page).setDepth(0);

    const texture = this.textures.exists('tableTexture') ? this.add.image(GAME.width / 2, GAME.height / 2, 'tableTexture') : null;
    if (texture) {
      texture.setDisplaySize(GAME.width, GAME.height);
      texture.setAlpha(0.2);
      texture.setDepth(1);
    }

    this.field = this.add.graphics().setDepth(2);
    this.field.fillStyle(COLORS.tableDark, 1);
    this.field.fillRect(MAP.leftArmX, MAP.margin, MAP.armWidth, GAME.height - MAP.margin * 2);
    this.field.fillRect(MAP.margin, MAP.topArmY, GAME.width - MAP.margin * 2, MAP.armWidth);

    this.field.fillStyle(COLORS.table, 0.72);
    this.field.fillCircle(MAP.centerX, MAP.centerY, 145);

    this.drawBoundary();
    this.drawGuides();
    this.drawGoalLabels();
  }

  drawBoundary() {
    const m = MAP.margin;
    const lx = MAP.leftArmX;
    const rx = MAP.rightArmX;
    const ty = MAP.topArmY;
    const by = MAP.bottomArmY;
    const w = GAME.width;
    const h = GAME.height;
    const cx = MAP.centerX;
    const cy = MAP.centerY;
    const gw = TUNING.goalWidth / 2;

    const segments = [
      [lx, m, cx - gw, m],
      [cx + gw, m, rx, m],
      [lx, h - m, cx - gw, h - m],
      [cx + gw, h - m, rx, h - m],
      [m, ty, m, cy - gw],
      [m, cy + gw, m, by],
      [w - m, ty, w - m, cy - gw],
      [w - m, cy + gw, w - m, by],
      [lx, m, lx, ty],
      [m, ty, lx, ty],
      [rx, m, rx, ty],
      [rx, ty, w - m, ty],
      [lx, by, lx, h - m],
      [m, by, lx, by],
      [rx, by, rx, h - m],
      [rx, by, w - m, by],
    ];

    this.field.lineStyle(5, COLORS.tableLight, 1);
    for (const [x1, y1, x2, y2] of segments) {
      this.field.lineBetween(x1, y1, x2, y2);
    }

    this.field.lineStyle(8, COLORS.goal, 0.95);
    this.field.lineBetween(cx - gw, m, cx + gw, m);
    this.field.lineBetween(cx - gw, h - m, cx + gw, h - m);
    this.field.lineBetween(m, cy - gw, m, cy + gw);
    this.field.lineBetween(w - m, cy - gw, w - m, cy + gw);
  }

  drawGuides() {
    this.field.lineStyle(3, COLORS.guide, 0.55);
    this.field.lineBetween(MAP.centerX, MAP.margin + 30, MAP.centerX, GAME.height - MAP.margin - 30);
    this.field.lineBetween(MAP.margin + 30, MAP.centerY, GAME.width - MAP.margin - 30, MAP.centerY);
    this.field.strokeCircle(MAP.centerX, MAP.centerY, 82);
    this.field.strokeCircle(MAP.centerX, MAP.centerY, 10);
  }

  drawGoalLabels() {
    const textStyle = {
      color: '#ffe8a3',
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      fontStyle: 'bold',
      stroke: '#05212d',
      strokeThickness: 3,
    };

    this.add.text(MAP.centerX, 48, 'P1 SCORES', textStyle).setOrigin(0.5).setDepth(9);
    this.add.text(MAP.centerX, GAME.height - 48, 'P2 SCORES', textStyle).setOrigin(0.5).setDepth(9);
    this.add.text(54, MAP.centerY, 'P4 SCORES', textStyle).setOrigin(0.5).setRotation(-Math.PI / 2).setDepth(9);
    this.add.text(GAME.width - 54, MAP.centerY, 'P3 SCORES', textStyle).setOrigin(0.5).setRotation(Math.PI / 2).setDepth(9);
  }

  createTexts() {
    this.scoreText = this.add.text(52, 84, 'P2 0\nP3 0\nP4 0\nP1 0', {
      color: COLORS.text,
      fontFamily: 'Arial, sans-serif',
      fontSize: '27px',
      fontStyle: 'bold',
      stroke: '#05212d',
      strokeThickness: 5,
      align: 'left',
      lineSpacing: 3,
    }).setOrigin(0, 0).setDepth(20);

    this.roleText = this.add.text(GAME.width - 46, 44, 'Not joined', {
      color: COLORS.mutedText,
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      fontStyle: 'bold',
      align: 'right',
    }).setOrigin(1, 0).setDepth(20);

    this.roomText = this.add.text(46, 40, '', {
      color: COLORS.mutedText,
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
    }).setOrigin(0, 0).setDepth(20);

    this.stateText = this.add.text(GAME.width / 2, GAME.height / 2 + 118, 'Create or join a room', {
      color: COLORS.warning,
      fontFamily: 'Arial, sans-serif',
      fontSize: '28px',
      fontStyle: 'bold',
      stroke: '#05212d',
      strokeThickness: 5,
      align: 'center',
    }).setOrigin(0.5).setDepth(20);

    this.helpText = this.add.text(52, GAME.height - 74, 'Move: WASD / Arrow keys / Drag or touch   Power: Shift / Space   R: Restart request', {
      color: COLORS.mutedText,
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
    }).setOrigin(0, 1).setDepth(20);
  }

  createControls() {
    this.dragControl = {
      active: false,
      x: GAME.width / 2,
      y: GAME.height / 2,
    };

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

    this.input.on('pointerdown', (pointer) => {
      this.startDragControl(pointer);
    });
    this.input.on('pointermove', (pointer) => {
      if (this.dragControl.active) this.updateDragTarget(pointer);
    });
    this.input.on('pointerup', () => {
      this.stopDragControl();
    });
    this.input.on('pointerupoutside', () => {
      this.stopDragControl();
    });
    window.addEventListener('blur', () => {
      this.stopDragControl();
    });
  }

  createPaddles() {
    this.paddles = Object.fromEntries(
      PLAYER_IDS.map((id) => {
        const [color, darkColor] = PLAYER_COLORS[id];
        return [id, new PaddleVisual(this, id, color, darkColor)];
      }),
    );
  }

  createPuck() {
    this.puckTrail = this.add.graphics().setDepth(8);
    this.hitRing = this.add.circle(GAME.width / 2, GAME.height / 2, TUNING.puckRadius + 12, 0xffffff, 0).setDepth(11);
    this.hitRing.setStrokeStyle(4, 0xffffff, 0);
    this.puckShadow = this.add.circle(GAME.width / 2 + 3, GAME.height / 2 + 4, TUNING.puckRadius, 0x000000, 0.24).setDepth(9);
    this.puck = this.add.circle(GAME.width / 2, GAME.height / 2, TUNING.puckRadius, COLORS.puck, 1).setDepth(10);
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
    if (!client.connected || !PLAYER_IDS.includes(client.role)) return;
    if (this.dragControl.active && !this.input.activePointer.isDown) {
      this.stopDragControl();
    }

    const keyboardInput = {
      up: this.keys.w.isDown || this.keys.up.isDown,
      down: this.keys.s.isDown || this.keys.down.isDown,
      left: this.keys.a.isDown || this.keys.left.isDown,
      right: this.keys.d.isDown || this.keys.right.isDown,
      power: this.keys.shift.isDown || this.keys.space.isDown,
    };
    const dragInput = this.dragControl.active ? this.getDragInput() : {};
    const input = {
      up: keyboardInput.up || Boolean(dragInput.up),
      down: keyboardInput.down || Boolean(dragInput.down),
      left: keyboardInput.left || Boolean(dragInput.left),
      right: keyboardInput.right || Boolean(dragInput.right),
      power: keyboardInput.power,
    };

    const changed = !client.lastInput || Object.keys(input).some((key) => input[key] !== client.lastInput[key]);
    if (changed || nowMs - client.lastInputSentAt > 50) {
      client.lastInput = input;
      client.lastInputSentAt = nowMs;
      sendMessage({ type: MESSAGE_TYPES.input, input });
    }
  }

  startDragControl(pointer) {
    if (!PLAYER_IDS.includes(client.role)) return;
    this.dragControl.active = true;
    this.updateDragTarget(pointer);
  }

  updateDragTarget(pointer) {
    this.dragControl.x = Phaser.Math.Clamp(pointer.worldX ?? pointer.x, 0, GAME.width);
    this.dragControl.y = Phaser.Math.Clamp(pointer.worldY ?? pointer.y, 0, GAME.height);
  }

  stopDragControl() {
    if (!this.dragControl) return;
    this.dragControl.active = false;
  }

  getDragInput() {
    const player = this.displayState.players[client.role] || client.lastState?.players?.[client.role];
    if (!player) return {};
    const dx = this.dragControl.x - player.x;
    const dy = this.dragControl.y - player.y;
    return {
      left: dx < -DRAG_DEADZONE,
      right: dx > DRAG_DEADZONE,
      up: dy < -DRAG_DEADZONE,
      down: dy > DRAG_DEADZONE,
    };
  }

  consumeServerState(nowMs) {
    const state = client.lastState;
    if (!state) return;

    if (!this.displayState.initialized) {
      this.displayState = createDisplayState(state);
    }

    for (const id of PLAYER_IDS) {
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
    for (const id of PLAYER_IDS) {
      const target = this.displayState.players[id];
      const serverPlayer = client.lastState?.players?.[id] || target;
      this.paddles[id].setTarget(target.x, target.y, !this.displayState.initialized);
      this.paddles[id].render(nowMs, serverPlayer);
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
    const score = state?.score || {};
    this.scoreText.setText(`P2 ${score.p2 ?? 0}\nP3 ${score.p3 ?? 0}\nP4 ${score.p4 ?? 0}\nP1 ${score.p1 ?? 0}`);

    const roomLine = state?.room
      ? `Humans ${state.room.playerCount}/4  CPU ${state.room.cpuCount}  Spectators ${state.room.spectatorCount}`
      : connectionLabel();
    this.roleText.setText(`${ROLE_LABELS[client.role] || ROLE_LABELS.none}\n${roomLine}`);
    this.roomText.setText(client.roomId ? `Room: ${client.roomId}` : '');

    let message = 'Create or join a room';
    if (client.error) {
      message = client.error;
    } else if (client.status === 'connecting') {
      message = 'Connecting...';
    } else if (client.status === 'disconnected') {
      message = 'Disconnected';
    } else if (state?.status === 'countdown') {
      message = `Starting in ${Math.ceil((state.countdownMsRemaining || 0) / 1000)}`;
    } else if (state?.winner) {
      message = `${ROLE_LABELS[state.winner].split(' / ')[0]} Wins!\nPress R to restart`;
    } else if (state?.statusText) {
      message = state.statusText;
    } else if (client.role === 'spectator') {
      message = 'Spectating';
    } else if (PLAYER_IDS.includes(client.role)) {
      message = '4-player online match';
    }
    this.stateText.setText(message);
  }
}

function createDisplayState(state = null) {
  return {
    initialized: Boolean(state),
    players: Object.fromEntries(
      PLAYER_IDS.map((id) => [
        id,
        {
          x: state?.players?.[id]?.x ?? GAME.width / 2,
          y: state?.players?.[id]?.y ?? GAME.height / 2,
        },
      ]),
    ),
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
      <button type="button" data-action="start">Start match</button>
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

  overlay.querySelector('[data-action="start"]').addEventListener('click', () => {
    if (!client.roomId || !client.connected) {
      setUiMessage('Create or join a room first');
      return;
    }
    if (!PLAYER_IDS.includes(client.role)) {
      setUiMessage('Only players can start the match');
      return;
    }
    sendMessage({ type: MESSAGE_TYPES.start });
    setUiMessage('Start requested. Empty slots will use CPU.');
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
    setUiMessage(`${ROLE_LABELS[message.role] || message.role} disconnected. CPU takes over during a match.`);
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
  const params = new URLSearchParams(window.location.search);
  const wsFromUrl = params.get('ws');
  if (wsFromUrl) return wsFromUrl;
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
