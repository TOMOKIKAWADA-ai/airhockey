import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { GAME, PLAYER_IDS } from '../src/shared/constants.js';

const cwd = process.cwd();
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const wsPort = 9876;
const staticPort = 4174;
const serverUrl = `http://127.0.0.1:${wsPort}`;
const wsUrl = `ws://127.0.0.1:${wsPort}`;
const frontUrl = `http://127.0.0.1:${staticPort}/`;
const frontWithWs = `${frontUrl}?ws=${encodeURIComponent(wsUrl)}`;

const server = spawn('node', ['server/index.js'], {
  cwd,
  env: {
    ...process.env,
    AIR_HOCKEY_TEST_API: '1',
    PORT: String(wsPort),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stdout.on('data', (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  serverLog += chunk.toString();
});

const results = [];
let browser;
let staticServer;

try {
  await waitForHealth();
  staticServer = await startStaticServer();
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });

  await fs.mkdir('artifacts', { recursive: true });

  const p1 = await newPage();
  await p1.goto(frontWithWs);
  await p1.getByText('Create room', { exact: true }).click();
  await waitForRole(p1, 'p1');
  const roomId = await clientValue(p1, 'roomId');

  const p2 = await joinPage(roomId, 'p2');
  const p3 = await joinPage(roomId, 'p3');
  const p4 = await joinPage(roomId, 'p4');
  const spectator = await joinPage(roomId, 'spectator');

  await check('room_create_and_four_player_join', async () => {
    assert(roomId.length > 0, 'room id missing');
    assert((await clientValue(p1, 'role')) === 'p1', 'first page is not p1');
    assert((await clientValue(p2, 'role')) === 'p2', 'second page is not p2');
    assert((await clientValue(p3, 'role')) === 'p3', 'third page is not p3');
    assert((await clientValue(p4, 'role')) === 'p4', 'fourth page is not p4');
    return roomId;
  });

  await check('fifth_client_spectator', async () => {
    assert((await clientValue(spectator, 'role')) === 'spectator', 'fifth page is not spectator');
    return 'spectator';
  });

  await check('start_button_countdown_then_playing', async () => {
    await p1.getByText('Start match', { exact: true }).click();
    await waitForStatus(p1, 'countdown');
    const countdownState = await gameState(p1);
    assert(countdownState.countdownMsRemaining > 3500, 'countdown did not start near five seconds');
    await waitForStatus(p1, 'playing', 8_000);
    const state = await gameState(p1);
    assert(state.room.cpuCount === 0, 'cpu slots should not be used with four humans');
    return state.status;
  });

  await check('p1_moves_only_own_paddle_and_syncs', async () => {
    const before = await gameState(p1);
    await hold(p1, 'd', 260);
    const after1 = await gameState(p1);
    const after2 = await gameState(p2);
    assert(after1.players.p1.x > before.players.p1.x + 12, 'p1 did not move right');
    assert(Math.abs(after1.players.p2.x - before.players.p2.x) < 5, 'p2 moved from p1 input');
    assert(Math.abs(after1.players.p1.x - after2.players.p1.x) < 5, 'p1 state not synced');
    return `p1.x ${before.players.p1.x.toFixed(1)} -> ${after1.players.p1.x.toFixed(1)}`;
  });

  await check('p1_drag_moves_paddle_and_syncs', async () => {
    const before = await gameState(p1);
    await dragGamePoint(
      p1,
      { x: before.players.p1.x, y: before.players.p1.y },
      { x: before.players.p1.x - 130, y: before.players.p1.y - 35 },
      320,
    );
    const after1 = await gameState(p1);
    const after2 = await gameState(p2);
    assert(after1.players.p1.x < before.players.p1.x - 18, 'p1 did not follow drag left');
    assert(after1.players.p1.y < before.players.p1.y - 8, 'p1 did not follow drag up');
    assert(Math.abs(after1.players.p1.x - after2.players.p1.x) < 5, 'drag state not synced');
    return `p1 ${before.players.p1.x.toFixed(1)},${before.players.p1.y.toFixed(1)} -> ${after1.players.p1.x.toFixed(1)},${after1.players.p1.y.toFixed(1)}`;
  });

  await check('p3_moves_and_syncs', async () => {
    const before = await gameState(p3);
    await hold(p3, 'ArrowUp', 260);
    const after1 = await gameState(p1);
    const after3 = await gameState(p3);
    assert(after3.players.p3.y < before.players.p3.y - 12, 'p3 did not move up');
    assert(Math.abs(after1.players.p3.y - after3.players.p3.y) < 5, 'p3 state not synced');
    return `p3.y ${before.players.p3.y.toFixed(1)} -> ${after3.players.p3.y.toFixed(1)}`;
  });

  await check('puck_syncs', async () => {
    await delay(220);
    const s1 = await gameState(p1);
    const s2 = await gameState(p2);
    const s4 = await gameState(p4);
    assert(Math.abs(s1.puck.x - s2.puck.x) < 6, 'puck x mismatch p2');
    assert(Math.abs(s1.puck.y - s4.puck.y) < 6, 'puck y mismatch p4');
    return `puck ${s1.puck.x.toFixed(1)},${s1.puck.y.toFixed(1)}`;
  });

  await check('non_goal_escape_recovers_without_stopping', async () => {
    const before = await gameState(p1);
    await testApi(roomId, {
      action: 'placePuck',
      x: 100,
      y: 100,
      vx: -520,
      vy: -520,
    });
    await delay(220);
    const after1 = await gameState(p1);
    const after3 = await gameState(p3);
    assert(after1.status === 'playing', `status changed to ${after1.status}`);
    assert(after1.debug.puckRecoveries > before.debug.puckRecoveries, 'puck recovery did not run');
    assert(PLAYER_IDS.every((id) => after1.score[id] === before.score[id]), 'escape should not score');
    assert(Math.abs(after1.puck.x - after3.puck.x) < 6, 'recovered puck x not synced');
    return `recovered ${after1.puck.x.toFixed(1)},${after1.puck.y.toFixed(1)}`;
  });

  await check('power_hit_syncs', async () => {
    const before = await gameState(p1);
    await p1.keyboard.down('Shift');
    await p1.keyboard.down('Space');
    await delay(20);
    const s = await gameState(p1);
    await testApi(roomId, {
      action: 'placePuck',
      x: s.players.p1.x,
      y: s.players.p1.y - 62,
      vx: 0,
      vy: 430,
    });
    await delay(320);
    await p1.keyboard.up('Shift');
    await p1.keyboard.up('Space');
    const after1 = await gameState(p1);
    const after2 = await gameState(p2);
    assert(after1.debug.p1PowerHits > before.debug.p1PowerHits, 'p1 power hit did not register');
    assert(after2.debug.p1PowerHits === after1.debug.p1PowerHits, 'power hit not synced');
    return `p1PowerHits=${after1.debug.p1PowerHits}`;
  });

  await check('top_goal_scores_for_p1_and_syncs', async () => {
    const before = await gameState(p1);
    await testApi(roomId, {
      action: 'placePuck',
      x: 450,
      y: -24,
      vx: 0,
      vy: -150,
    });
    await delay(180);
    const after1 = await gameState(p1);
    const after4 = await gameState(p4);
    assert(after1.score.p1 === before.score.p1 + 1, 'p1 score did not increase');
    assert(after4.score.p1 === after1.score.p1, 'score not synced');
    return `p1=${after1.score.p1}`;
  });

  await check('win_syncs', async () => {
    await testApi(roomId, { action: 'setScore', p1: 4, p2: 0, p3: 0, p4: 0 });
    await testApi(roomId, {
      action: 'placePuck',
      x: 450,
      y: -24,
      vx: 0,
      vy: -150,
    });
    await delay(180);
    const after1 = await gameState(p1);
    const after3 = await gameState(p3);
    assert(after1.winner === 'p1', `winner is ${after1.winner}`);
    assert(after3.winner === 'p1', 'winner not synced');
    return 'p1';
  });

  await check('restart_request_starts_new_countdown', async () => {
    await p1.keyboard.press('R');
    await delay(220);
    const after1 = await gameState(p1);
    const after2 = await gameState(p2);
    assert(!after1.winner, 'winner still set after restart');
    assert(after1.status === 'countdown', `restart status is ${after1.status}`);
    assert(PLAYER_IDS.every((id) => after1.score[id] === 0), 'scores not reset');
    assert(after2.status === after1.status, 'restart status not synced');
    return 'countdown';
  });

  await check('disconnect_cpu_takeover_notice', async () => {
    await p2.close();
    await delay(350);
    const state = await gameState(p1);
    const message = await p1.locator('[data-message]').innerText({ timeout: 5000 });
    assert(state.players.p2.connected, 'p2 slot should stay active');
    assert(state.players.p2.cpu, 'p2 should be taken over by CPU');
    assert(message.includes('CPU takes over'), 'disconnect notice missing');
    return message;
  });

  await check('solo_start_fills_empty_slots_with_cpu', async () => {
    const solo = await newPage();
    await solo.goto(frontWithWs);
    await solo.getByText('Create room', { exact: true }).click();
    await waitForRole(solo, 'p1');
    await solo.getByText('Start match', { exact: true }).click();
    await waitForStatus(solo, 'countdown');
    const state = await gameState(solo);
    assert(state.room.cpuCount === 3, `cpu count is ${state.room.cpuCount}`);
    assert(state.players.p2.cpu && state.players.p3.cpu && state.players.p4.cpu, 'empty slots not filled by CPU');
    await solo.close();
    return '3 cpu players';
  });

  await p1.screenshot({ path: 'artifacts/online-e2e-final.png', fullPage: true });

  await Promise.all([p1, p3, p4, spectator].map((page) => page.close().catch(() => {})));
} finally {
  if (browser) await browser.close();
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
  server.kill();
}

console.log(JSON.stringify({ results, serverLog: serverLog.slice(-1000) }, null, 2));
process.exit(results.every((result) => result.ok) ? 0 : 1);

async function joinPage(roomId, role) {
  const page = await newPage();
  await page.goto(roomUrl(roomId));
  await waitForRole(page, role);
  return page;
}

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (error) => {
    results.push({ name: 'pageerror', ok: false, detail: error.message });
  });
  return page;
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      const res = await fetch(`${serverUrl}/health`);
      if (res.ok) return;
    } catch {
      await delay(120);
    }
  }
  throw new Error(`server did not start: ${serverLog}`);
}

async function waitForRole(page, role) {
  await page.waitForFunction(
    (expectedRole) => window.__AIR_HOCKEY_CLIENT_STATE__?.().role === expectedRole,
    role,
    { timeout: 10_000 },
  );
}

async function waitForStatus(page, status, timeout = 10_000) {
  await page.waitForFunction(
    (expectedStatus) => window.__AIR_HOCKEY_CLIENT_STATE__?.().lastState?.status === expectedStatus,
    status,
    { timeout },
  );
}

async function clientValue(page, key) {
  return page.evaluate((valueKey) => window.__AIR_HOCKEY_CLIENT_STATE__()[valueKey], key);
}

async function gameState(page) {
  return page.evaluate(() => window.__AIR_HOCKEY_CLIENT_STATE__().lastState);
}

async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await delay(ms);
  await page.keyboard.up(key);
  await delay(80);
}

async function dragGamePoint(page, from, to, ms) {
  const start = await gameToScreenPoint(page, from);
  const end = await gameToScreenPoint(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await delay(ms);
  await page.mouse.up();
  await delay(100);
}

async function gameToScreenPoint(page, point) {
  const rect = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const box = canvas.getBoundingClientRect();
    return {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    };
  });
  return {
    x: rect.left + (point.x / GAME.width) * rect.width,
    y: rect.top + (point.y / GAME.height) * rect.height,
  };
}

async function testApi(roomId, body) {
  const res = await fetch(`${serverUrl}/__test/${roomId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`test api failed: ${res.status} ${await res.text()}`);
  }
}

function roomUrl(roomId) {
  return `${frontUrl}?room=${encodeURIComponent(roomId)}&ws=${encodeURIComponent(wsUrl)}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startStaticServer() {
  const distDir = path.join(cwd, 'dist');
  const mime = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
  };

  const app = http.createServer(async (req, res) => {
    const url = new URL(req.url, frontUrl);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.normalize(path.join(distDir, pathname));

    if (!filePath.startsWith(distDir)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }

    try {
      const file = await fs.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
      });
      res.end(file);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });

  return new Promise((resolve) => {
    app.listen(staticPort, '127.0.0.1', () => resolve(app));
  });
}
