import Phaser from 'phaser';
import './styles.css';

const GAME = {
  width: 960,
  height: 540,
  winScore: 5,
  goalDelayMs: 900,
};

const TUNING = {
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
};

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

class Paddle {
  constructor(scene, id, x, y, color, darkColor, controls, limit) {
    this.scene = scene;
    this.id = id;
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.vx = 0;
    this.vy = 0;
    this.color = color;
    this.darkColor = darkColor;
    this.controls = controls;
    this.limit = limit;
    this.lastPowerPressedAt = -Infinity;
    this.lastPowerUsedAt = -Infinity;
    this.flashUntil = 0;

    this.shadow = scene.add.circle(x + 4, y + 5, TUNING.paddleRadius, 0x000000, 0.22);
    this.body = scene.add.circle(x, y, TUNING.paddleRadius, color, 1);
    this.inner = scene.add.circle(x, y, TUNING.paddleRadius * 0.54, darkColor, 0.86);
    this.ring = scene.add.circle(x, y, TUNING.paddleRadius + 4, color, 0);
    this.ring.setStrokeStyle(4, color, 0);
  }

  update(deltaMs, nowMs) {
    this.prevX = this.x;
    this.prevY = this.y;

    const seconds = deltaMs / 1000;
    let ix = 0;
    let iy = 0;
    if (this.controls.left.isDown) ix -= 1;
    if (this.controls.right.isDown) ix += 1;
    if (this.controls.up.isDown) iy -= 1;
    if (this.controls.down.isDown) iy += 1;

    if (ix !== 0 || iy !== 0) {
      const length = Math.hypot(ix, iy);
      ix /= length;
      iy /= length;
    }

    this.x += ix * TUNING.paddleSpeed * seconds;
    this.y += iy * TUNING.paddleSpeed * seconds;
    this.x = Phaser.Math.Clamp(this.x, TUNING.paddleRadius, GAME.width - TUNING.paddleRadius);
    this.y = Phaser.Math.Clamp(this.y, this.limit.minY, this.limit.maxY);

    this.vx = (this.x - this.prevX) / Math.max(seconds, 0.001);
    this.vy = (this.y - this.prevY) / Math.max(seconds, 0.001);

    if (Phaser.Input.Keyboard.JustDown(this.controls.power)) {
      this.lastPowerPressedAt = nowMs;
      this.pulse(0.38);
    }

    this.render(nowMs);
  }

  canPowerHit(nowMs) {
    const pressedRecently = nowMs - this.lastPowerPressedAt <= TUNING.powerHitWindowMs;
    const cooledDown = nowMs - this.lastPowerUsedAt >= TUNING.powerHitCooldownMs;
    return pressedRecently && cooledDown;
  }

  consumePowerHit(nowMs) {
    this.lastPowerUsedAt = nowMs;
    this.flashUntil = nowMs + 150;
    this.pulse(0.95);
  }

  pulse(alpha) {
    this.ring.setAlpha(alpha);
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

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.vx = 0;
    this.vy = 0;
    this.lastPowerPressedAt = -Infinity;
    this.lastPowerUsedAt = -Infinity;
    this.flashUntil = 0;
    this.render(0);
  }
}

class AirHockeyScene extends Phaser.Scene {
  constructor() {
    super('AirHockeyScene');
  }

  preload() {
    this.load.image('tableTexture', 'assets/table-bg.svg');
  }

  create() {
    this.debugState = {
      p1PowerHits: 0,
      p2PowerHits: 0,
      p1Goals: 0,
      p2Goals: 0,
      paddleHits: 0,
      wallHits: 0,
      winner: '',
    };

    this.goalTop = { x: (GAME.width - TUNING.goalWidth) / 2, y: -8, width: TUNING.goalWidth, height: 24 };
    this.goalBottom = { x: (GAME.width - TUNING.goalWidth) / 2, y: GAME.height - 16, width: TUNING.goalWidth, height: 24 };

    this.createTable();
    this.createTexts();
    this.createControls();
    this.createPaddles();
    this.createPuck();

    this.score = { p1: 0, p2: 0 };
    this.gameOver = false;
    this.pausedForGoal = false;
    this.restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.input.keyboard.on('keydown-R', () => this.restartMatch());
    this.resetRound(Phaser.Math.RND.pick([-1, 1]));
    this.installTestHooks();
  }

  createTable() {
    this.add.rectangle(GAME.width / 2, GAME.height / 2, GAME.width, GAME.height, COLORS.table);

    const texture = this.textures.exists('tableTexture') ? this.add.image(GAME.width / 2, GAME.height / 2, 'tableTexture') : null;
    if (texture) {
      texture.setDisplaySize(GAME.width, GAME.height);
      texture.setAlpha(0.36);
    }

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
    this.field.fillRoundedRect(this.goalTop.x, 20, this.goalTop.width, 14, 7);
    this.field.fillRoundedRect(this.goalBottom.x, GAME.height - 34, this.goalBottom.width, 14, 7);

    this.field.lineStyle(5, COLORS.goal, 0.85);
    this.field.lineBetween(this.goalTop.x, 20, this.goalTop.x + this.goalTop.width, 20);
    this.field.lineBetween(this.goalBottom.x, GAME.height - 20, this.goalBottom.x + this.goalBottom.width, GAME.height - 20);

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

    this.stateText = this.add.text(GAME.width / 2, GAME.height / 2 + 112, '', {
      color: COLORS.warning,
      fontFamily: 'Arial, sans-serif',
      fontSize: '28px',
      fontStyle: 'bold',
      stroke: '#05212d',
      strokeThickness: 5,
      align: 'center',
    }).setOrigin(0.5);

    this.helpP1Text = this.add.text(46, GAME.height - 13, 'P1: WASD + Shift', {
      color: COLORS.mutedText,
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
    }).setOrigin(0, 1);

    this.helpP2Text = this.add.text(GAME.width - 46, GAME.height - 13, 'P2: Arrow keys + Space   R: Restart', {
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
    this.p1Start = { x: GAME.width / 2, y: GAME.height - 120 };
    this.p2Start = { x: GAME.width / 2, y: 120 };

    this.p1 = new Paddle(
      this,
      'p1',
      this.p1Start.x,
      this.p1Start.y,
      COLORS.p1,
      COLORS.p1Dark,
      {
        up: this.keys.w,
        left: this.keys.a,
        down: this.keys.s,
        right: this.keys.d,
        power: this.keys.shift,
      },
      {
        minY: GAME.height / 2 + TUNING.centerFence + TUNING.paddleRadius,
        maxY: GAME.height - 34 - TUNING.paddleRadius,
      },
    );

    this.p2 = new Paddle(
      this,
      'p2',
      this.p2Start.x,
      this.p2Start.y,
      COLORS.p2,
      COLORS.p2Dark,
      {
        up: this.keys.up,
        left: this.keys.left,
        down: this.keys.down,
        right: this.keys.right,
        power: this.keys.space,
      },
      {
        minY: 34 + TUNING.paddleRadius,
        maxY: GAME.height / 2 - TUNING.centerFence - TUNING.paddleRadius,
      },
    );
  }

  createPuck() {
    this.puckTrail = this.add.graphics();
    this.hitRing = this.add.circle(GAME.width / 2, GAME.height / 2, TUNING.puckRadius + 12, 0xffffff, 0);
    this.hitRing.setStrokeStyle(4, 0xffffff, 0);
    this.puckShadow = this.add.circle(GAME.width / 2 + 3, GAME.height / 2 + 4, TUNING.puckRadius, 0x000000, 0.24);
    this.puck = this.add.circle(GAME.width / 2, GAME.height / 2, TUNING.puckRadius, COLORS.puck, 1);
    this.puck.setStrokeStyle(4, COLORS.puckShadow, 0.9);
    this.puckVel = new Phaser.Math.Vector2();
    this.puckPos = new Phaser.Math.Vector2(GAME.width / 2, GAME.height / 2);
    this.lastPuckPositions = [];
    this.lastHitRingAt = -Infinity;
  }

  update(time, delta) {
    if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
      this.restartMatch();
      return;
    }

    this.p1.update(delta, time);
    this.p2.update(delta, time);

    if (!this.pausedForGoal && !this.gameOver) {
      this.updatePuck(delta, time);
    }

    this.renderPuck(time);
    this.updateTexts();
  }

  updatePuck(deltaMs, nowMs) {
    const seconds = deltaMs / 1000;
    this.puckPos.x += this.puckVel.x * seconds;
    this.puckPos.y += this.puckVel.y * seconds;
    this.puckVel.scale(Math.pow(TUNING.puckFrictionPerSecond, seconds));

    this.resolveWallCollisions();
    this.resolvePaddleCollision(this.p1, nowMs);
    this.resolvePaddleCollision(this.p2, nowMs);
    this.correctAxisLock();
    this.capPuckSpeed();
    this.checkGoal();
  }

  resolveWallCollisions() {
    const r = TUNING.puckRadius;
    const left = 24 + r;
    const right = GAME.width - 24 - r;
    const topWall = 20 + r;
    const bottomWall = GAME.height - 20 - r;

    if (this.puckPos.x < left) {
      this.puckPos.x = left;
      this.puckVel.x = Math.abs(this.puckVel.x);
      this.debugState.wallHits += 1;
    } else if (this.puckPos.x > right) {
      this.puckPos.x = right;
      this.puckVel.x = -Math.abs(this.puckVel.x);
      this.debugState.wallHits += 1;
    }

    const inGoal = this.isPuckInGoalLane();
    if (!inGoal && this.puckPos.y < topWall) {
      this.puckPos.y = topWall;
      this.puckVel.y = Math.abs(this.puckVel.y);
      this.debugState.wallHits += 1;
    } else if (!inGoal && this.puckPos.y > bottomWall) {
      this.puckPos.y = bottomWall;
      this.puckVel.y = -Math.abs(this.puckVel.y);
      this.debugState.wallHits += 1;
    }
  }

  resolvePaddleCollision(paddle, nowMs) {
    const dx = this.puckPos.x - paddle.x;
    const dy = this.puckPos.y - paddle.y;
    const minDistance = TUNING.puckRadius + TUNING.paddleRadius;
    const distance = Math.hypot(dx, dy);

    if (distance <= 0 || distance >= minDistance) return;

    const nx = dx / distance;
    const ny = dy / distance;
    this.puckPos.x = paddle.x + nx * minDistance;
    this.puckPos.y = paddle.y + ny * minDistance;

    const incoming = this.puckVel.dot(new Phaser.Math.Vector2(nx, ny));
    if (incoming < 0) {
      this.puckVel.x -= 2 * incoming * nx;
      this.puckVel.y -= 2 * incoming * ny;
    }

    this.puckVel.x += paddle.vx * 0.44;
    this.puckVel.y += paddle.vy * 0.44;

    const powerHit = paddle.canPowerHit(nowMs);
    const boost = powerHit ? TUNING.powerHitMultiplier : TUNING.normalHitBoost;
    this.puckVel.scale(boost);

    if (powerHit) {
      paddle.consumePowerHit(nowMs);
      this.lastHitRingAt = nowMs;
      this.hitRing.setPosition(this.puckPos.x, this.puckPos.y);
      this.hitRing.setAlpha(1);
      this.cameras.main.shake(90, 0.006);
      if (paddle.id === 'p1') this.debugState.p1PowerHits += 1;
      if (paddle.id === 'p2') this.debugState.p2PowerHits += 1;
    }

    this.debugState.paddleHits += 1;
    this.correctAxisLock();
    this.capPuckSpeed();
  }

  isPuckInGoalLane() {
    const centerX = GAME.width / 2;
    return Math.abs(this.puckPos.x - centerX) <= TUNING.goalWidth / 2 - TUNING.puckRadius * 0.25;
  }

  checkGoal() {
    if (!this.isPuckInGoalLane()) return;

    if (this.puckPos.y < -TUNING.puckRadius) {
      this.awardPoint('p1');
    } else if (this.puckPos.y > GAME.height + TUNING.puckRadius) {
      this.awardPoint('p2');
    }
  }

  awardPoint(playerId) {
    if (this.pausedForGoal || this.gameOver) return;

    if (playerId === 'p1') {
      this.score.p1 += 1;
      this.debugState.p1Goals += 1;
    } else {
      this.score.p2 += 1;
      this.debugState.p2Goals += 1;
    }

    this.pausedForGoal = true;
    this.puckVel.set(0, 0);
    this.stateText.setText(`${playerId.toUpperCase()} SCORED`);

    const winner = this.score.p1 >= GAME.winScore ? 'Player 1' : this.score.p2 >= GAME.winScore ? 'Player 2' : '';
    if (winner) {
      this.finishMatch(winner);
      return;
    }

    this.time.delayedCall(GAME.goalDelayMs, () => {
      this.pausedForGoal = false;
      this.resetRound(playerId === 'p1' ? -1 : 1);
    });
  }

  finishMatch(winner) {
    this.gameOver = true;
    this.pausedForGoal = false;
    this.debugState.winner = winner;
    this.stateText.setText(`${winner} Wins!\nPress R`);
  }

  resetRound(directionY) {
    this.p1.reset(this.p1Start.x, this.p1Start.y);
    this.p2.reset(this.p2Start.x, this.p2Start.y);
    this.puckPos.set(GAME.width / 2, GAME.height / 2);

    const angle = Phaser.Math.DegToRad(Phaser.Math.Between(58, 122)) * directionY;
    const side = Phaser.Math.RND.pick([-1, 1]);
    this.puckVel.set(Math.cos(angle) * TUNING.puckStartSpeed * side, Math.sin(angle) * TUNING.puckStartSpeed);
    this.correctAxisLock();
    this.lastPuckPositions = [];
    this.stateText.setText('');
  }

  restartMatch() {
    this.score = { p1: 0, p2: 0 };
    this.gameOver = false;
    this.pausedForGoal = false;
    this.debugState.p1PowerHits = 0;
    this.debugState.p2PowerHits = 0;
    this.debugState.p1Goals = 0;
    this.debugState.p2Goals = 0;
    this.debugState.paddleHits = 0;
    this.debugState.wallHits = 0;
    this.debugState.winner = '';
    this.resetRound(Phaser.Math.RND.pick([-1, 1]));
  }

  installTestHooks() {
    window.__AIR_HOCKEY_TEST__ = {
      placePuck: (x, y, vx, vy) => {
        this.pausedForGoal = false;
        if (!this.gameOver) this.stateText.setText('');
        this.puckPos.set(x, y);
        this.puckVel.set(vx, vy);
      },
      setScore: (p1, p2) => {
        this.score.p1 = p1;
        this.score.p2 = p2;
      },
      getState: () => window.__AIR_HOCKEY_STATE__,
    };
  }

  correctAxisLock() {
    const speed = this.puckVel.length();
    if (speed < 1) return;

    if (Math.abs(this.puckVel.x) < TUNING.minAxisVelocity) {
      this.puckVel.x = Math.sign(this.puckVel.x || Phaser.Math.RND.pick([-1, 1])) * TUNING.minAxisVelocity;
    }
    if (Math.abs(this.puckVel.y) < TUNING.minAxisVelocity) {
      this.puckVel.y = Math.sign(this.puckVel.y || Phaser.Math.RND.pick([-1, 1])) * TUNING.minAxisVelocity;
    }

    this.puckVel.setLength(Math.max(speed, TUNING.puckStartSpeed * 0.7));
  }

  capPuckSpeed() {
    const speed = this.puckVel.length();
    if (speed > TUNING.puckMaxSpeed) {
      this.puckVel.setLength(TUNING.puckMaxSpeed);
    }
  }

  renderPuck(nowMs) {
    this.lastPuckPositions.push({ x: this.puckPos.x, y: this.puckPos.y });
    if (this.lastPuckPositions.length > 9) this.lastPuckPositions.shift();

    this.puckTrail.clear();
    this.lastPuckPositions.forEach((p, i) => {
      const alpha = (i + 1) / this.lastPuckPositions.length;
      this.puckTrail.fillStyle(COLORS.puck, alpha * 0.08);
      this.puckTrail.fillCircle(p.x, p.y, TUNING.puckRadius * alpha);
    });

    this.puckShadow.setPosition(this.puckPos.x + 3, this.puckPos.y + 4);
    this.puck.setPosition(this.puckPos.x, this.puckPos.y);

    const ringAge = nowMs - this.lastHitRingAt;
    if (ringAge < 190) {
      const t = ringAge / 190;
      this.hitRing.setPosition(this.puckPos.x, this.puckPos.y);
      this.hitRing.setRadius(TUNING.puckRadius + 12 + t * 22);
      this.hitRing.setStrokeStyle(4, 0xffffff, 1 - t);
      this.hitRing.setAlpha(1 - t);
    } else {
      this.hitRing.setAlpha(0);
    }
  }

  updateTexts() {
    this.scoreText.setText(`P2 ${this.score.p2}\nP1 ${this.score.p1}`);
    window.__AIR_HOCKEY_STATE__ = {
      p1: { x: Math.round(this.p1.x), y: Math.round(this.p1.y) },
      p2: { x: Math.round(this.p2.x), y: Math.round(this.p2.y) },
      puck: {
        x: Math.round(this.puckPos.x),
        y: Math.round(this.puckPos.y),
        vx: Math.round(this.puckVel.x),
        vy: Math.round(this.puckVel.y),
        speed: Math.round(this.puckVel.length()),
      },
      score: { ...this.score },
      pausedForGoal: this.pausedForGoal,
      gameOver: this.gameOver,
      debug: { ...this.debugState },
    };
  }
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
  scene: AirHockeyScene,
};

new Phaser.Game(config);
