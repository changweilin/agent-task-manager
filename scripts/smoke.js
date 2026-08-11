// ATM 冒煙測試：這個專案沒有測試框架，也不打算引入依賴，所以這裡直接把真的
// server 開起來，只驗證「壞掉時不會有人發現」的幾條不變量：
//   1. server 能開起來、/api/status 回得出合法 payload
//   2. 請求來源信任 gate（Host / Origin / sec-fetch-site）會擋掉 DNS rebinding 與跨站
//   3. 封存中的終端 API 全部 404、WS 升級不會被接受
//   4. GitHub Pages 產物真的有翻到展示模式，且沒帶進本機輔助檔
// 執行類 endpoint 的 403（非本機來源）無法在單機 CI 內偽造 socket 來源，仍需照
// CLAUDE.md §4 手動用非 localhost 來源驗證。
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const BOOT_TIMEOUT_MS = 90000;

let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok   ${name}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function request(port, options) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method || 'GET',
        path: options.path,
        headers: { host: `127.0.0.1:${port}`, ...(options.headers || {}) },
        timeout: 20000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
      },
    );

    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function upgradeAttempt(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/terminals/smoke/socket',
      headers: {
        host: `127.0.0.1:${port}`,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': crypto.randomBytes(16).toString('base64'),
        'sec-websocket-version': '13',
      },
      timeout: 20000,
    });

    req.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve({ upgraded: true, status: response.statusCode });
    });
    req.on('response', (response) => {
      response.resume();
      resolve({ upgraded: false, status: response.statusCode });
    });
    req.on('timeout', () => req.destroy(new Error('upgrade timeout')));
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(port, child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await request(port, { path: '/api/status' });
      if (response.status === 200) {
        return response;
      }
    } catch (error) {
      // Not listening yet.
    }
    await sleep(500);
  }

  throw new Error(`server did not answer /api/status within ${BOOT_TIMEOUT_MS}ms`);
}

// 用臨時設定檔 + 空的掃描根目錄開機，避免 CI/本機跑測試時動到 dev-projects.json
// 或真的把某個專案的 dev server 拉起來。
function createSandboxConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-smoke-'));
  const scanRoot = path.join(dir, 'projects');
  const configPath = path.join(dir, 'dev-projects.json');
  fs.mkdirSync(scanRoot);
  fs.writeFileSync(
    configPath,
    JSON.stringify({ defaultRoots: [scanRoot], basePort: 5173, projects: [], profiles: [], autoRestoreOnStartup: false }, null, 2),
  );

  return { dir, configPath };
}

async function runServerChecks() {
  console.log('server:');
  const port = await findFreePort();
  const sandbox = createSandboxConfig();
  const env = { ...process.env, DEV_DOCK_CONFIG: sandbox.configPath };
  delete env.ATM_TERMINALS;
  delete env.ATM_RESTART;

  const child = spawn(process.execPath, ['server.js', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: ROOT_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (chunk) => {
    serverLog += chunk;
  });
  child.stderr.on('data', (chunk) => {
    serverLog += chunk;
  });

  try {
    const status = await waitForServer(port, child);
    let payload = null;
    try {
      payload = JSON.parse(status.body);
    } catch (error) {
      payload = null;
    }

    check('GET /api/status → 200 JSON', Boolean(payload), status.body.slice(0, 120));
    check('status payload has projects[]', Array.isArray(payload?.projects));
    check('terminal features report archived', payload?.manager?.terminalFeatures === false, String(payload?.manager?.terminalFeatures));

    const rebind = await request(port, { path: '/api/status', headers: { host: 'evil.example.com' } });
    check('untrusted Host → 403', rebind.status === 403, `got ${rebind.status}`);

    const crossSite = await request(port, { path: '/api/status', headers: { 'sec-fetch-site': 'cross-site' } });
    check('cross-site fetch → 403', crossSite.status === 403, `got ${crossSite.status}`);

    const foreignOrigin = await request(port, { path: '/api/status', headers: { origin: 'http://evil.example.com' } });
    check('foreign Origin → 403', foreignOrigin.status === 403, `got ${foreignOrigin.status}`);

    const sameOrigin = await request(port, {
      path: '/api/status',
      headers: { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' },
    });
    check('same-origin browser request → 200', sameOrigin.status === 200, `got ${sameOrigin.status}`);

    const terminals = await request(port, { path: '/api/terminals' });
    check('archived GET /api/terminals → 404', terminals.status === 404, `got ${terminals.status}`);

    const preferences = await request(port, {
      method: 'PUT',
      path: '/api/terminal-preferences',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    check('archived PUT /api/terminal-preferences → 404', preferences.status === 404, `got ${preferences.status}`);

    const upgrade = await upgradeAttempt(port);
    check('archived WS upgrade refused', upgrade.upgraded === false && upgrade.status === 404, `upgraded=${upgrade.upgraded} status=${upgrade.status}`);

    const index = await request(port, { path: '/' });
    check('GET / serves the UI', index.status === 200 && /<title>/i.test(index.body), `got ${index.status}`);

    const appJs = await request(port, { path: '/app.js' });
    check('GET /app.js served', appJs.status === 200, `got ${appJs.status}`);

    const traversal = await request(port, { path: '/../package.json' });
    check('path traversal blocked', traversal.status !== 200, `got ${traversal.status}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL server boot — ${error.message}`);
    if (serverLog.trim()) {
      console.log(serverLog.trim().split('\n').map((line) => `       ${line}`).join('\n'));
    }
  } finally {
    child.kill();
    fs.rmSync(sandbox.dir, { recursive: true, force: true });
  }
}

function runBuildChecks() {
  console.log('pages build:');
  try {
    execFileSync(process.execPath, [path.join('scripts', 'build-pages.js')], { cwd: ROOT_DIR, stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    console.log(`  FAIL build:pages — ${(error.stderr || error.message || '').toString().trim()}`);
    return;
  }

  const exists = (relative) => fs.existsSync(path.join(DIST_DIR, relative));
  for (const asset of ['index.html', 'app.js', 'styles.css', '.nojekyll', 'vendor/xterm/xterm.mjs', 'vendor/xterm/addon-fit.mjs', 'vendor/xterm/xterm.css']) {
    check(`dist/${asset} exists`, exists(asset));
  }

  // build-pages.js 用字串 replace 翻開關，字串一改就會靜默失敗、把「假資料展示頁」
  // 變成一個對 /api 發真請求的頁面，所以這條一定要驗。
  const demoConfig = exists('demo-config.js') ? fs.readFileSync(path.join(DIST_DIR, 'demo-config.js'), 'utf8') : '';
  check('dist demo flag flipped to true', /window\.AGENT_TASK_MANAGER_DEMO\s*=\s*true;/.test(demoConfig));
  check('dist has no false demo flag left', !/window\.AGENT_TASK_MANAGER_DEMO\s*=\s*false;/.test(demoConfig));

  check('dist excludes mobile-install.js', !exists('mobile-install.js'));
  for (const leak of ['dev-projects.json', '.dev-manager', 'server.js']) {
    check(`dist excludes ${leak}`, !exists(leak));
  }
}

(async () => {
  await runServerChecks();
  runBuildChecks();

  if (failed > 0) {
    console.error(`\nsmoke: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nsmoke: all checks passed');
})().catch((error) => {
  console.error(`smoke: unexpected failure — ${error.stack || error.message}`);
  process.exit(1);
});
