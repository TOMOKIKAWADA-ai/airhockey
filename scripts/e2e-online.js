import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const cwd = process.cwd();
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const serverUrl = 'http://127.0.0.1:8787';
const frontUrl = 'http://127.0.0.1:4173/';

const server = spawn('node', ['server/index.js'], {
  cwd,
  env: {
    ...process.env,
    AIR_HOCKEY_TEST_API: '1',
    PORT: '8787',
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
  await p1.goto(frontUrl);
  await p1.getByText('Create room', { exact: true }).click();
  await waitForRole(p1, 'p1');
  const roomId = await clientValue(p1, 'roomId');

  const p2 = await newPage();
  await p2.goto(`${frontUrl}?room=${roomId}`);
  await waitForRole(p2, 'p2');

  const p3 = await newPage();
  await p3.goto(`${frontUrl}?room=${roomId}`);
  await waitForRole(p3, 'spectator');

  await check('room_create_and_join', async () => {
    assert(roomId.length > 0, 'room id missing');
    assert((await clientValue(p1, 'role')) === 'p1', 'first page is not p1');
    assert((await clientValue(p2, 'role')) === 'p2', 'second page is not p2');
    return roomId;
  });

  await check('third_client_spectator', async () => {
    assert((await clientValue(p3, 'role')) === 'spectator', 'third page is not spectator');
    return 'spectator';
  });

  await check('p1_moves_only_own_paddle_and_syncs', async () => {
    const before = await gameState(p1);
    await hold(p1, 'd', 260);
    const after1 = await gameState(p1);
    const after2 = await gameState(p2);
    assert(after1.players.p1.x > before.players.p1.x + 12, 'p1 did not move right');
    assert(Math.abs(after1.players.p2.x - before.players.p2.x) < 4, 'p2 moved from p1 input');
    assert(Math.abs(after1.players.p1.x - after2.players.p1.x) < 4, 'p1 state not synced');
    return `p1.x ${before.players.p1.x.toFixed(1)} -> ${after1.players.p1.x.toFixed(1)}`;
  });

  await check('p2_moves_and_syncs', async () => {
    const before = await gameState(p2);
    await hold(p2, 'ArrowLeft', 260);
    const after1 = await gameState(p1);
    const after2 = await gameState(p2);
    assert(after2.players.p2.x < before.players.p2.x - 12, 'p2 did not move left');
    assert(Math.abs(after1.players.p2.x - after2.players.p2.x) < 4, 'p2 state not synced');
    return `p2.x ${before.players.p2.x.toFixed(1)} -> ${after2.players.p2.x.toFixed(1)}`;
  });

  await check('puck_syncs', async () => {
    await delay(200);
    const s1 = await gameState(p1);
    const s2 = await gameState(p2);
    assert(Math.abs(s1.puck.x - s2.puck.x) < 6, 'puck x mismatch');
    assert(Math.abs(s1.puck.y - s2.puck.y) < 6, 'puck y mismatch');
    return `puck ${s1.puck.x.toFixed(1)},${s1.puck.y.toFixed(1)}`;
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

  await check('goal_score_syncs', async () => {
    const before = await gameState(p1);
    await testApi(roomId, {
      action: 'placePuck',
      x: 480,
      y: -24,
      vx: 0,
      vy: -150,
    });
    await delay(180);
    const after1 = await gameState(p1);
    const after2 = await gameState(p2);
    assert(after1.score.p1 === before.score.p1 + 1, 'p1 score did not increase');
    assert(after2.score.p1 === after1.score.p1, 'score not synced');
    return `p1=${after1.score.p1}`;
  });

  await check('win_syncs', async () => {
    await testApi(roomId, { action: 'setScore', p1: 4, p2: 0 });
    await testApi(roomId, {
      action: 'placePuck',
      x: 480,
      y: -24,
      vx: 0,
      vy: -150,
    });
    await delay(180);
    const after1 = await gameState(p1);
    const after2 = await gameState(p2);
    assert(after1.winner === 'p1', `winner is ${after1.winner}`);
    assert(after2.winner === 'p1', 'winner not synced');
    return 'p1';
  });

  await check('restart_request_syncs', async () => {
    await p1.keyboard.press('R');
    await delay(180);
    const after1 = await gameState(p1);
    const after2 = await gameState(p2);
    assert(!after1.winner, 'winner still set after restart');
    assert(after1.score.p1 === 0 && after1.score.p2 === 0, 'p1 score not reset');
    assert(after2.score.p1 === 0 && after2.score.p2 === 0, 'p2 score not reset');
    return 'reset';
  });

  await check('disconnect_notice', async () => {
    await p2.close();
    await delay(350);
    const state = await gameState(p1);
    const message = await p1.locator('[data-message]').innerText({ timeoutMs: 5000 });
    assert(!state.players.p2.connected, 'p2 still connected');
    assert(message.includes('Opponent disconnected') || state.status === 'waiting', 'disconnect notice missing');
    return message || state.status;
  });

  await p1.screenshot({ path: 'artifacts/online-e2e-final.png', fullPage: true });
} finally {
  if (browser) await browser.close();
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
  server.kill();
}

console.log(JSON.stringify({ results, serverLog: serverLog.slice(-1000) }, null, 2));
process.exit(results.every((result) => result.ok) ? 0 : 1);

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
    app.listen(4173, '127.0.0.1', () => resolve(app));
  });
}
