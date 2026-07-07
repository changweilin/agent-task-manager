import { Terminal } from './vendor/xterm/xterm.mjs';
import { FitAddon } from './vendor/xterm/addon-fit.mjs';

const DEMO_MODE = window.AGENT_TASK_MANAGER_DEMO === true
  || window.location.hostname.endsWith('.github.io')
  || window.location.protocol === 'file:';
const DEMO_NOTICE = '展示模式僅使用去識別化樣本資料，不會連線到本機、LAN、Tailscale，也不會執行任何指令。';
const DEFAULT_DEMO_PAYLOAD = {
  manager: {
    name: 'Agent Task Manager (ATM)',
    host: 'demo-static',
    port: 8787,
    localUrl: 'display-only://manager',
    lanUrl: '',
    tailscaleUrl: '',
    tailscaleIp: 'demo',
    terminalReadOnly: true,
  },
  config: {
    defaultRoots: ['/demo/workspace'],
    basePort: 5173,
    autoRestoreOnStartup: true,
    health: {
      autoRestart: false,
      failureThreshold: 3,
    },
    profiles: [
      {
        id: 'demo-core',
        name: 'Demo Stack',
        projectNames: ['frontend-shell', 'docs-portal'],
      },
    ],
  },
  projects: [
    {
      name: 'frontend-shell',
      path: '/demo/workspace/frontend-shell',
      framework: 'vite',
      devScript: 'vite --host demo --port 5173',
      port: 5173,
      status: 'running',
      running: true,
      command: 'npm run dev -- --host demo --port 5173',
      pages: [
        { path: '/', title: 'Dashboard', source: 'demo-route', file: 'src/routes/dashboard.tsx' },
        { path: '/projects', title: 'Project list', source: 'demo-route', file: 'src/routes/projects.tsx' },
      ],
      healthFailures: 0,
      restartCount: 0,
      mobileInstall: { supported: false, reason: '展示資料不包含 Android build 流程。' },
    },
    {
      name: 'docs-portal',
      path: '/demo/workspace/docs-portal',
      framework: 'astro',
      devScript: 'astro dev --host demo --port 5174',
      port: 5174,
      status: 'stopped',
      running: false,
      command: 'npm run dev -- --host demo --port 5174',
      pages: [
        { path: '/', title: 'Overview', source: 'demo-route', file: 'src/pages/index.astro' },
        { path: '/guides/security', title: 'Security guide', source: 'demo-route', file: 'src/pages/guides/security.astro' },
      ],
      healthFailures: 0,
      restartCount: 0,
      mobileInstall: { supported: false, reason: '展示資料不包含 Android build 流程。' },
    },
    {
      name: 'api-console',
      path: '/demo/workspace/api-console',
      framework: 'generic',
      devScript: 'node server.js --host demo --port 5175',
      port: 5175,
      status: 'unhealthy',
      running: true,
      command: 'node server.js --host demo --port 5175',
      pages: [
        { path: '/', title: 'Console', source: 'demo-route', file: 'public/index.html' },
      ],
      healthFailures: 2,
      restartCount: 1,
      mobileInstall: { supported: false, reason: '展示資料不包含 Android build 流程。' },
    },
  ],
};
const DEFAULT_DEMO_LOGS = {
  'frontend-shell': {
    stdout: '[demo] Vite ready on a redacted preview endpoint.\n[demo] No local URL, LAN IP, Tailscale IP, PID, or filesystem path is included.',
    stderr: '',
  },
  'docs-portal': {
    stdout: '[demo] Service is stopped in the sample dataset.',
    stderr: '',
  },
  'api-console': {
    stdout: '[demo] Health probe returned a sample warning.',
    stderr: '[demo] Warning: simulated health check failure for display only.',
  },
};

function cloneDemoData(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugifyDemoName(value, fallback = 'demo-project') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || fallback;
}

function demoPreviewUrl(projectName, routePath = '') {
  const slug = slugifyDemoName(projectName);
  const route = String(routePath || '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  return `https://demo.invalid/${slug}${route ? `/${route}` : ''}`;
}

function sanitizeDemoCommand(command) {
  const text = String(command || 'npm run dev')
    .replace(/[A-Za-z]:\\[^\s"']+/g, '[local-path]')
    .replace(/\/(?:Users|home)\/[^\s"']+/g, '[local-path]')
    .replace(/--host\s+\S+/g, '--host demo')
    .replace(/--hostname\s+\S+/g, '--hostname demo')
    .slice(0, 180);
  return text || 'npm run dev';
}

function sanitizeDemoPayload(rawPayload = DEFAULT_DEMO_PAYLOAD) {
  const source = cloneDemoData(rawPayload || DEFAULT_DEMO_PAYLOAD);
  const now = new Date().toISOString();
  const projects = Array.isArray(source.projects) ? source.projects : [];
  const safeProjects = projects.map((project, index) => {
    const name = slugifyDemoName(project.name, `demo-project-${index + 1}`);
    const localUrl = demoPreviewUrl(name);
    const pages = Array.isArray(project.pages) ? project.pages : [];
    return {
      ...project,
      name,
      path: `/demo/workspace/${name}`,
      devScript: sanitizeDemoCommand(project.devScript),
      command: sanitizeDemoCommand(project.command || project.devScript),
      pid: null,
      stdout: '',
      stderr: '',
      localUrl,
      tailscaleUrl: '',
      tailscaleMode: false,
      tailscaleReady: false,
      tailscaleIpAtStart: null,
      probe: {
        ok: project.status !== 'unhealthy',
        checkedAt: now,
        error: project.status === 'unhealthy' ? 'demo health warning' : '',
      },
      lastHealthAt: now,
      lastHealthOk: project.status !== 'unhealthy',
      lastHealthError: project.status === 'unhealthy' ? 'demo health warning' : '',
      startedAt: project.running ? now : null,
      lastRestartAt: project.restartCount ? now : null,
      pages: pages.map((page) => ({
        ...page,
        localUrl: page.pattern ? '' : demoPreviewUrl(name, page.path),
        tailscaleUrl: '',
      })),
      mobileInstall: project.mobileInstall || { supported: false, reason: '展示資料不包含 Android build 流程。' },
    };
  });
  const safeNames = new Set(safeProjects.map((project) => project.name));

  return {
    manager: {
      name: 'Agent Task Manager (ATM)',
      host: 'demo-static',
      port: Number(source.manager?.port || 8787),
      localUrl: 'display-only://manager',
      lanUrl: '',
      tailscaleUrl: '',
      tailscaleIp: 'demo',
      terminalReadOnly: true,
    },
    config: {
      defaultRoots: ['/demo/workspace'],
      basePort: Number(source.config?.basePort || 5173),
      autoRestoreOnStartup: source.config?.autoRestoreOnStartup !== false,
      health: {
        autoRestart: source.config?.health?.autoRestart === true,
        failureThreshold: Number(source.config?.health?.failureThreshold || 3),
      },
      profiles: (Array.isArray(source.config?.profiles) ? source.config.profiles : [])
        .map((profile, index) => ({
          id: slugifyDemoName(profile.id, `demo-profile-${index + 1}`),
          name: String(profile.name || `Demo Profile ${index + 1}`).slice(0, 80),
          projectNames: (Array.isArray(profile.projectNames) ? profile.projectNames : [])
            .map((name) => slugifyDemoName(name))
            .filter((name) => safeNames.has(name)),
        }))
        .filter((profile) => profile.projectNames.length),
    },
    projects: safeProjects,
  };
}

function demoStatusPayload() {
  return sanitizeDemoPayload(window.AGENT_TASK_MANAGER_DEMO_PAYLOAD || DEFAULT_DEMO_PAYLOAD);
}

function demoLogPayload(projectName) {
  const logs = {
    ...DEFAULT_DEMO_LOGS,
    ...(window.AGENT_TASK_MANAGER_DEMO_LOGS || {}),
  };
  const safeName = slugifyDemoName(projectName);
  return logs[safeName] || {
    stdout: `[demo] ${safeName || 'project'} uses display-only logs with all local identifiers removed.`,
    stderr: '',
  };
}

async function demoApi(path, options = {}) {
  const url = new URL(path, window.location.origin);
  const method = String(options.method || 'GET').toUpperCase();

  if (url.pathname === '/api/status') {
    return demoStatusPayload();
  }
  if (url.pathname === '/api/logs') {
    return demoLogPayload(url.searchParams.get('name'));
  }
  if (url.pathname === '/api/terminals') {
    return { sessions: [] };
  }
  if (url.pathname === '/api/terminal-preferences') {
    return method === 'GET' ? { saved: false } : { ok: true };
  }
  if (url.pathname === '/api/ai-quotas') {
    return {
      checkedAt: new Date().toISOString(),
      safeMode: {
        tokenSafe: true,
        summary: 'Demo mode uses mocked quota data.',
      },
      agents: AI_QUOTA_MONITOR_AGENTS.map((agent, index) => ({
        id: agent.id,
        label: agent.label,
        provider: agent.provider,
        status: 'ok',
        percent: [42, 27, 64][index],
        percentLabel: `${[42, 27, 64][index]}%`,
        probe: agent.probe,
        summary: 'Mocked demo usage signal.',
        signals: [{ label: 'Demo usage', percent: [42, 27, 64][index], percentLabel: `${[42, 27, 64][index]}% 已用` }],
        checkedAt: new Date().toISOString(),
      })),
    };
  }
  if (url.pathname.startsWith('/api/')) {
    return demoStatusPayload();
  }

  throw new Error('Demo mode only serves local mock API responses.');
}

function showDemoNotice() {
  showToast(DEMO_NOTICE);
}

function applyDemoModeUi() {
  if (!DEMO_MODE) {
    return;
  }

  document.body.classList.add('is-demo-mode');
  if (document.querySelector('.demo-banner')) {
    return;
  }

  const banner = document.createElement('div');
  banner.className = 'demo-banner';
  banner.innerHTML = `
    <strong>GitHub Pages 展示模式</strong>
    <span>${DEMO_NOTICE}</span>
  `;
  document.querySelector('.topbar')?.insertAdjacentElement('afterend', banner);
}

const TABLE_PREFERENCES_KEY = 'agentTaskManager.tablePreferences.v3';
const THEME_PREFERENCE_KEY = 'agentTaskManager.theme.v1';
const LEFT_RAIL_WIDTH_KEY = 'agentTaskManager.leftRailWidth.v1';
const LEFT_RAIL_MIN_WIDTH = 220;
const LEFT_RAIL_MAX_WIDTH = 560;
const TERMINAL_FAVORITES_KEY = 'agentTaskManager.terminalFavorites.v1';
const TERMINAL_FAVORITES_VERSION_KEY = 'agentTaskManager.terminalFavoritesVersion.v1';
const TERMINAL_FAVORITES_VERSION = 8;
const TERMINAL_CLAUDE_SETTINGS_KEY = 'agentTaskManager.terminalClaudeSettings.v1';
const TERMINAL_CODEX_SETTINGS_KEY = 'agentTaskManager.terminalCodexSettings.v1';
const TERMINAL_ANTIGRAVITY_SETTINGS_KEY = 'agentTaskManager.terminalAntigravitySettings.v1';
const TERMINAL_OPENCODE_SETTINGS_KEY = 'agentTaskManager.terminalOpencodeSettings.v1';
const TERMINAL_WORKSPACE_KEY = 'agentTaskManager.terminalWorkspace.v1';
const LEGACY_STORAGE_KEYS = new Map([
  [TABLE_PREFERENCES_KEY, 'devDock.tablePreferences.v3'],
  [THEME_PREFERENCE_KEY, 'devDock.theme.v1'],
  [TERMINAL_FAVORITES_KEY, 'devDock.terminalFavorites.v1'],
  [TERMINAL_FAVORITES_VERSION_KEY, 'devDock.terminalFavoritesVersion.v1'],
  [TERMINAL_CLAUDE_SETTINGS_KEY, 'devDock.terminalClaudeSettings.v1'],
  [TERMINAL_CODEX_SETTINGS_KEY, 'devDock.terminalCodexSettings.v1'],
  [TERMINAL_ANTIGRAVITY_SETTINGS_KEY, 'devDock.terminalAntigravitySettings.v1'],
  [TERMINAL_WORKSPACE_KEY, 'devDock.terminalWorkspace.v1'],
]);
const TERMINAL_PREFERENCE_TEXT_LIMIT = 4096;
const TERMINAL_FAVORITE_COLLAPSED_ROWS = 2;
const TERMINAL_AGENT_TABS = [
  // `tab` is the compact one-row label; `label` is the full name used elsewhere (logs etc.).
  { id: 'claude', label: 'Claude Code', tab: 'Claude Code' },
  { id: 'codex', label: 'Codex CLI', tab: 'Codex' },
  { id: 'antigravity', label: 'Antigravity CLI', tab: 'Antigravity' },
  { id: 'opencode', label: 'opencode', tab: 'opencode' },
];
const DEFAULT_TERMINAL_AGENT_ID = 'claude';
const terminalAgentIds = new Set(TERMINAL_AGENT_TABS.map((agent) => agent.id));
const TERMINAL_PIPELINE_KEY = 'agentTaskManager.terminalPipeline.v1';
// 記事本:一份不會被執行的 pipeline 草稿(只有段落 prompt,沒有 pipeline 參數)。
const TERMINAL_NOTEPAD_KEY = 'agentTaskManager.terminalNotepad.v1';
// Sentinel <option> value in the per-step project pickers that triggers the
// 「新增專案」 flow instead of selecting an existing project.
const TERMINAL_NEW_PROJECT_OPTION = '__new_project__';
// ATM itself, openable as a terminal target (must match the server's name).
const ATM_TERMINAL_PROJECT_NAME = 'ATM (本機)';
// Slash command each agent uses to start a fresh conversation while the same
// CLI process keeps running. Used when a pipeline step is set to 「開新對話」.
const TERMINAL_PIPELINE_AGENT_RESET = {
  claude: '/clear',
  codex: '/new',
  antigravity: '/clear',
  opencode: '/new',
};
const TERMINAL_PIPELINE_CONVERSATIONS = new Set(['same', 'new']);
const TERMINAL_PIPELINE_IDLE_MIN = 3;
const TERMINAL_PIPELINE_IDLE_MAX = 120;
const TERMINAL_PIPELINE_MAXWAIT_MIN = 30;
const TERMINAL_PIPELINE_MAXWAIT_MAX = 7200;
// 5h-limit quota pacing: countdown seconds-per-percent (C) and safety buffer % (S).
const TERMINAL_PIPELINE_COUNTDOWN_MIN = 0;
const TERMINAL_PIPELINE_COUNTDOWN_MAX = 600;
const TERMINAL_PIPELINE_SAFETY_MIN = 0;
const TERMINAL_PIPELINE_SAFETY_MAX = 90;
const TERMINAL_PIPELINE_PROMPT_LIMIT = 16000;
const TERMINAL_CONTENT_TABS = [
  // 「終端」分頁本身會視狀態切換內容:尚未啟動時顯示啟動設定 + agent 啟動器,
  // 啟動後切換成終端畫面,關閉後再切回啟動設定。名稱一律叫「終端」。
  // Pipeline 已升級為 modal 的頂層模式(終端管理 / Pipeline 管理切換),不再是分頁。
  { id: 'terminal', label: '終端' },
  { id: 'favorites', label: '指令' },
];
const TERMINAL_CONTENT_TAB_IDS = new Set(TERMINAL_CONTENT_TABS.map((tab) => tab.id));
const AI_QUOTA_MONITOR_AGENTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    provider: 'Anthropic',
    probe: 'claude auth status + /usage',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    provider: 'OpenAI',
    probe: 'codex login status + /status',
  },
  {
    id: 'antigravity',
    label: 'Antigravity CLI',
    provider: 'Google',
    probe: 'agy + /usage',
  },
];
const AI_QUOTA_MONITOR_STALE_MS = 5 * 60 * 60 * 1000;
const TERMINAL_LEGACY_CLAUDE_FAVORITES = ['claude', 'claude -r', 'claude -c'];
const TERMINAL_CLAUDE_SLASH_FAVORITES = [
  { id: 'favorite-claude-init', command: '/init', note: '' },
  { id: 'favorite-claude-memory', command: '/memory', note: '' },
  { id: 'favorite-claude-mcp', command: '/mcp', note: '' },
  { id: 'favorite-claude-permissions', command: '/permissions', note: '' },
  { id: 'favorite-claude-model', command: '/model', note: '' },
  { id: 'favorite-claude-effort', command: '/effort', note: '' },
  { id: 'favorite-claude-plan', command: '/plan', note: '' },
  { id: 'favorite-claude-context', command: '/context', note: '' },
  { id: 'favorite-claude-compact', command: '/compact', note: '' },
  { id: 'favorite-claude-btw', command: '/btw', note: '' },
  { id: 'favorite-claude-agents', command: '/agents', note: '' },
  { id: 'favorite-claude-tasks', command: '/tasks', note: '' },
  { id: 'favorite-claude-batch', command: '/batch', note: '' },
  { id: 'favorite-claude-diff', command: '/diff', note: '' },
  { id: 'favorite-claude-code-review', command: '/code-review', note: '' },
  { id: 'favorite-claude-review', command: '/review', note: '' },
  { id: 'favorite-claude-rewind', command: '/rewind', note: '' },
  { id: 'favorite-claude-clear', command: '/clear', note: '' },
  { id: 'favorite-claude-resume', command: '/resume', note: '' },
  { id: 'favorite-claude-branch', command: '/branch', note: '' },
  { id: 'favorite-claude-doctor', command: '/doctor', note: '' },
  { id: 'favorite-claude-debug', command: '/debug', note: '' },
  { id: 'favorite-claude-schedule', command: '/schedule', note: '' },
  { id: 'favorite-claude-exit', command: '/exit', note: '' },
];
const TERMINAL_CODEX_SLASH_FAVORITES = [
  { id: 'favorite-codex-permissions', command: '/permissions', note: '' },
  { id: 'favorite-codex-approve', command: '/approve', note: '' },
  { id: 'favorite-codex-model', command: '/model', note: '' },
  { id: 'favorite-codex-fast', command: '/fast', note: '' },
  { id: 'favorite-codex-plan', command: '/plan', note: '' },
  { id: 'favorite-codex-personality', command: '/personality', note: '' },
  { id: 'favorite-codex-compact', command: '/compact', note: '' },
  { id: 'favorite-codex-diff', command: '/diff', note: '' },
  { id: 'favorite-codex-review', command: '/review', note: '' },
  { id: 'favorite-codex-init', command: '/init', note: '' },
  { id: 'favorite-codex-mcp', command: '/mcp', note: '' },
  { id: 'favorite-codex-plugins', command: '/plugins', note: '' },
  { id: 'favorite-codex-apps', command: '/apps', note: '' },
  { id: 'favorite-codex-hooks', command: '/hooks', note: '' },
  { id: 'favorite-codex-skills', command: '/skills', note: '' },
  { id: 'favorite-codex-agent', command: '/agent', note: '' },
  { id: 'favorite-codex-goal', command: '/goal', note: '' },
  { id: 'favorite-codex-fork', command: '/fork', note: '' },
  { id: 'favorite-codex-side', command: '/side', note: '' },
  { id: 'favorite-codex-ide', command: '/ide', note: '' },
  { id: 'favorite-codex-mention', command: '/mention', note: '' },
  { id: 'favorite-codex-copy', command: '/copy', note: '' },
  { id: 'favorite-codex-sandbox-add-read-dir', command: '/sandbox-add-read-dir', note: '' },
  { id: 'favorite-codex-resume', command: '/resume', note: '' },
  { id: 'favorite-codex-status', command: '/status', note: '' },
  { id: 'favorite-codex-statusline', command: '/statusline', note: '' },
  { id: 'favorite-codex-title', command: '/title', note: '' },
  { id: 'favorite-codex-keymap', command: '/keymap', note: '' },
  { id: 'favorite-codex-theme', command: '/theme', note: '' },
  { id: 'favorite-codex-memories', command: '/memories', note: '' },
  { id: 'favorite-codex-experimental', command: '/experimental', note: '' },
  { id: 'favorite-codex-ps', command: '/ps', note: '' },
  { id: 'favorite-codex-stop', command: '/stop', note: '' },
  { id: 'favorite-codex-raw', command: '/raw', note: '' },
  { id: 'favorite-codex-vim', command: '/vim', note: '' },
  { id: 'favorite-codex-debug-config', command: '/debug-config', note: '' },
  { id: 'favorite-codex-clear', command: '/clear', note: '' },
  { id: 'favorite-codex-new', command: '/new', note: '' },
  { id: 'favorite-codex-undo', command: '/undo', note: '' },
  { id: 'favorite-codex-help', command: '/help', note: '' },
  { id: 'favorite-codex-login', command: '/login', note: '' },
  { id: 'favorite-codex-logout', command: '/logout', note: '' },
  { id: 'favorite-codex-feedback', command: '/feedback', note: '' },
  { id: 'favorite-codex-exit', command: '/exit', note: '' },
  { id: 'favorite-codex-quit', command: '/quit', note: '' },
];
const TERMINAL_ANTIGRAVITY_SLASH_FAVORITES = [
  { id: 'favorite-antigravity-resume', command: '/resume', note: '' },
  { id: 'favorite-antigravity-switch', command: '/switch', note: '' },
  { id: 'favorite-antigravity-rewind', command: '/rewind', note: '' },
  { id: 'favorite-antigravity-undo', command: '/undo', note: '' },
  { id: 'favorite-antigravity-rename', command: '/rename', note: '' },
  { id: 'favorite-antigravity-permissions', command: '/permissions', note: '' },
  { id: 'favorite-antigravity-model', command: '/model', note: '' },
  { id: 'favorite-antigravity-config', command: '/config', note: '' },
  { id: 'favorite-antigravity-settings', command: '/settings', note: '' },
  { id: 'favorite-antigravity-keybindings', command: '/keybindings', note: '' },
  { id: 'favorite-antigravity-statusline', command: '/statusline', note: '' },
  { id: 'favorite-antigravity-tasks', command: '/tasks', note: '' },
  { id: 'favorite-antigravity-agents', command: '/agents', note: '' },
  { id: 'favorite-antigravity-skills', command: '/skills', note: '' },
  { id: 'favorite-antigravity-mcp', command: '/mcp', note: '' },
  { id: 'favorite-antigravity-open', command: '/open', note: '' },
  { id: 'favorite-antigravity-usage', command: '/usage', note: '' },
  { id: 'favorite-antigravity-clear', command: '/clear', note: '' },
  { id: 'favorite-antigravity-fork', command: '/fork', note: '' },
  { id: 'favorite-antigravity-help', command: '/help', note: '' },
  { id: 'favorite-antigravity-init', command: '/init', note: '' },
  { id: 'favorite-antigravity-compact', command: '/compact', note: '' },
  { id: 'favorite-antigravity-diff', command: '/diff', note: '' },
  { id: 'favorite-antigravity-login', command: '/login', note: '' },
  { id: 'favorite-antigravity-logout', command: '/logout', note: '' },
  { id: 'favorite-antigravity-exit', command: '/exit', note: '' },
];
const TERMINAL_OPENCODE_SLASH_FAVORITES = [
  { id: 'favorite-opencode-help', command: '/help', note: '' },
  { id: 'favorite-opencode-new', command: '/new', note: '' },
  { id: 'favorite-opencode-sessions', command: '/sessions', note: '' },
  { id: 'favorite-opencode-share', command: '/share', note: '' },
  { id: 'favorite-opencode-unshare', command: '/unshare', note: '' },
  { id: 'favorite-opencode-init', command: '/init', note: '' },
  { id: 'favorite-opencode-compact', command: '/compact', note: '' },
  { id: 'favorite-opencode-summarize', command: '/summarize', note: '' },
  { id: 'favorite-opencode-undo', command: '/undo', note: '' },
  { id: 'favorite-opencode-redo', command: '/redo', note: '' },
  { id: 'favorite-opencode-models', command: '/models', note: '' },
  { id: 'favorite-opencode-agent', command: '/agent', note: '' },
  { id: 'favorite-opencode-editor', command: '/editor', note: '' },
  { id: 'favorite-opencode-themes', command: '/themes', note: '' },
  { id: 'favorite-opencode-details', command: '/details', note: '' },
  { id: 'favorite-opencode-export', command: '/export', note: '' },
  { id: 'favorite-opencode-exit', command: '/exit', note: '' },
];
const DEFAULT_TERMINAL_FAVORITES_BY_AGENT = {
  claude: TERMINAL_CLAUDE_SLASH_FAVORITES,
  codex: TERMINAL_CODEX_SLASH_FAVORITES,
  antigravity: TERMINAL_ANTIGRAVITY_SLASH_FAVORITES,
  opencode: TERMINAL_OPENCODE_SLASH_FAVORITES,
};
const TERMINAL_CODEX_FAVORITE_MIGRATION_7_COMMANDS = [
  '/approve',
  '/fast',
  '/personality',
  '/plugins',
  '/apps',
  '/hooks',
  '/ide',
  '/mention',
  '/copy',
  '/sandbox-add-read-dir',
  '/statusline',
  '/title',
  '/keymap',
  '/theme',
  '/memories',
  '/experimental',
  '/raw',
  '/vim',
  '/debug-config',
  '/new',
  '/logout',
  '/feedback',
  '/quit',
];
const TERMINAL_ANTIGRAVITY_FAVORITE_MIGRATION_7_COMMANDS = [
  '/switch',
  '/undo',
  '/settings',
  '/agents',
];
const TERMINAL_SLASH_FAVORITES = TERMINAL_CLAUDE_SLASH_FAVORITES;
const TERMINAL_FAVORITE_MIGRATIONS = [
  { version: 2, favorites: TERMINAL_CLAUDE_SLASH_FAVORITES.slice(0, 4) },
  { version: 3, favorites: TERMINAL_CLAUDE_SLASH_FAVORITES.filter((favorite) => ['/compact', '/clear'].includes(favorite.command)) },
  { version: 4, removeCommands: TERMINAL_LEGACY_CLAUDE_FAVORITES },
  {
    version: 5,
    favorites: TERMINAL_CLAUDE_SLASH_FAVORITES.filter((favorite) => ['/btw', '/rewind', '/schedule', '/tasks'].includes(favorite.command)),
    reorderCommands: TERMINAL_CLAUDE_SLASH_FAVORITES.map((favorite) => favorite.command),
  },
  {
    version: 6,
    favorites: TERMINAL_CLAUDE_SLASH_FAVORITES,
    reorderCommands: TERMINAL_CLAUDE_SLASH_FAVORITES.map((favorite) => favorite.command),
  },
  {
    version: 7,
    favoritesByAgent: {
      codex: TERMINAL_CODEX_SLASH_FAVORITES.filter((favorite) => TERMINAL_CODEX_FAVORITE_MIGRATION_7_COMMANDS.includes(favorite.command)),
      antigravity: TERMINAL_ANTIGRAVITY_SLASH_FAVORITES.filter((favorite) => TERMINAL_ANTIGRAVITY_FAVORITE_MIGRATION_7_COMMANDS.includes(favorite.command)),
    },
    reorderCommandsByAgent: {
      codex: TERMINAL_CODEX_SLASH_FAVORITES.map((favorite) => favorite.command),
      antigravity: TERMINAL_ANTIGRAVITY_SLASH_FAVORITES.map((favorite) => favorite.command),
    },
  },
  {
    // v8: add opencode (new agent) defaults, and backfill commonly-missing codex /
    // antigravity commands for users who already have stored favorites.
    version: 8,
    favoritesByAgent: {
      codex: TERMINAL_CODEX_SLASH_FAVORITES.filter((favorite) => ['/undo', '/help', '/login'].includes(favorite.command)),
      antigravity: TERMINAL_ANTIGRAVITY_SLASH_FAVORITES.filter((favorite) => ['/help', '/init', '/compact', '/diff', '/login', '/exit'].includes(favorite.command)),
      opencode: TERMINAL_OPENCODE_SLASH_FAVORITES,
    },
    reorderCommandsByAgent: {
      codex: TERMINAL_CODEX_SLASH_FAVORITES.map((favorite) => favorite.command),
      antigravity: TERMINAL_ANTIGRAVITY_SLASH_FAVORITES.map((favorite) => favorite.command),
      opencode: TERMINAL_OPENCODE_SLASH_FAVORITES.map((favorite) => favorite.command),
    },
  },
];
const DEFAULT_TERMINAL_FAVORITES = [
  ...TERMINAL_CLAUDE_SLASH_FAVORITES,
];

function readLocalPreference(key) {
  const current = localStorage.getItem(key);
  if (current !== null) {
    return current;
  }

  const legacyKey = LEGACY_STORAGE_KEYS.get(key);
  if (!legacyKey) {
    return null;
  }

  const legacy = localStorage.getItem(legacyKey);
  if (legacy !== null) {
    try {
      localStorage.setItem(key, legacy);
    } catch {
      // Existing preferences can still be read even when migration cannot persist.
    }
  }
  return legacy;
}

function writeLocalPreference(key, value) {
  localStorage.setItem(key, value);
}

function removeLocalPreference(key) {
  localStorage.removeItem(key);
  const legacyKey = LEGACY_STORAGE_KEYS.get(key);
  if (legacyKey) {
    localStorage.removeItem(legacyKey);
  }
}

const TERMINAL_CLAUDE_COMMANDS = ['claude', 'claude -r', 'claude -c'];
const TERMINAL_CLAUDE_DEFAULT_FLAG_FAVORITES = [
  { id: 'claude-flag-remote-control', flag: '--remote-control' },
  { id: 'claude-flag-chrome', flag: '--chrome' },
  { id: 'claude-flag-worktree', flag: '--worktree' },
  { id: 'claude-flag-init', flag: '--init' },
  { id: 'claude-flag-advisor', flag: '--advisor' },
];
const TERMINAL_CLAUDE_CUSTOM_MODEL_VALUE = '__custom__';
const TERMINAL_CLAUDE_MODEL_OPTIONS = [
  { value: '', label: 'Configured default' },
  { value: 'default', label: 'default' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'opus', label: 'opus' },
  { value: 'haiku', label: 'haiku' },
  { value: 'opusplan', label: 'opusplan' },
  { value: 'sonnet[1m]', label: 'sonnet[1m]' },
];
const TERMINAL_CLAUDE_EFFORT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
];
const TERMINAL_CLAUDE_PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: 'default - confirm each action' },
  { value: 'acceptEdits', label: 'acceptEdits - auto edits' },
  { value: 'plan', label: 'plan - review all actions' },
  { value: 'auto', label: 'auto - classifier review' },
  { value: 'dontAsk', label: 'dontAsk - allowlist only' },
  { value: 'bypassPermissions', label: 'bypassPermissions - danger' },
];
const DEFAULT_TERMINAL_CLAUDE_SETTINGS = {
  command: 'claude',
  model: '',
  customModel: false,
  effort: '',
  permissionMode: 'default',
  favoriteFlags: TERMINAL_CLAUDE_DEFAULT_FLAG_FAVORITES,
  activeFlags: [],
};
const TERMINAL_CODEX_COMMANDS = ['codex', 'codex resume --last', 'codex fork --last'];
const TERMINAL_CODEX_SANDBOX_OPTIONS = [
  { value: '', label: 'Configured default' },
  { value: 'read-only', label: 'read-only' },
  { value: 'workspace-write', label: 'workspace-write' },
  { value: 'danger-full-access', label: 'danger-full-access' },
];
const TERMINAL_CODEX_APPROVAL_OPTIONS = [
  { value: '', label: 'Configured default' },
  { value: 'untrusted', label: 'untrusted' },
  { value: 'on-request', label: 'on-request' },
  { value: 'never', label: 'never' },
];
const TERMINAL_CODEX_DEFAULT_FLAG_FAVORITES = [
  { id: 'codex-flag-search', flag: '--search' },
  { id: 'codex-flag-no-alt-screen', flag: '--no-alt-screen' },
  { id: 'codex-flag-oss', flag: '--oss' },
  { id: 'codex-flag-yolo', flag: '--yolo' },
];
const DEFAULT_TERMINAL_CODEX_SETTINGS = {
  command: 'codex',
  model: '',
  sandbox: '',
  approval: '',
  favoriteFlags: TERMINAL_CODEX_DEFAULT_FLAG_FAVORITES,
  activeFlags: [],
};
const TERMINAL_ANTIGRAVITY_COMMANDS = ['agy'];
const TERMINAL_ANTIGRAVITY_DEFAULT_FLAG_FAVORITES = [
  { id: 'antigravity-flag-sandbox', flag: '--sandbox' },
  { id: 'antigravity-flag-dangerously-skip-permissions', flag: '--dangerously-skip-permissions' },
];
const DEFAULT_TERMINAL_ANTIGRAVITY_SETTINGS = {
  command: 'agy',
  favoriteFlags: TERMINAL_ANTIGRAVITY_DEFAULT_FLAG_FAVORITES,
  activeFlags: [],
};
// opencode (github.com/sst/opencode): `opencode` opens the TUI in the cwd; `-c` /
// `--continue` resumes the last session; `-m/--model provider/model` picks a model.
const TERMINAL_OPENCODE_COMMANDS = ['opencode', 'opencode --continue'];
const TERMINAL_OPENCODE_DEFAULT_FLAG_FAVORITES = [
  { id: 'opencode-flag-share', flag: '--share' },
  { id: 'opencode-flag-print-logs', flag: '--print-logs' },
  { id: 'opencode-flag-agent', flag: '--agent build' },
];
const DEFAULT_TERMINAL_OPENCODE_SETTINGS = {
  command: 'opencode',
  model: '',
  favoriteFlags: TERMINAL_OPENCODE_DEFAULT_FLAG_FAVORITES,
  activeFlags: [],
};
const DEFAULT_COLUMN_ORDER = ['name', 'status', 'framework', 'port', 'tailscale', 'health', 'command', 'started', 'restarted', 'pid'];
const ACTION_URL_COLUMN_IDS = ['local'];
const DEFAULT_COLUMN_WIDTHS = {
  name: 238,
  status: 104,
  framework: 92,
  port: 78,
  tailscale: 270,
  health: 108,
  command: 210,
  started: 142,
  restarted: 142,
  pid: 78,
};
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 520;
const MIN_TABLE_WIDTH = 1460;
const COLUMN_REORDER_MOVE_THRESHOLD = 6;
const ROOT_REORDER_MOVE_THRESHOLD = 6;
const ROOT_REORDER_FLIP_MS = 200;
const SOURCE_ORDER_SORT_ID = 'sourceOrder';
const STATUS_SORT_ORDER = {
  running: 0,
  restarting: 1,
  unhealthy: 2,
  external: 3,
  stale: 4,
  stopped: 5,
};
const PAGE_LINK_TARGETS = [
  { id: 'local', label: 'Local', urlKey: 'localUrl' },
  { id: 'tailscale', label: 'Tailscale', urlKey: 'tailscaleUrl' },
];
const DEFAULT_PAGE_LINK_TARGET_ID = 'local';
const MOBILE_DEFAULT_PAGE_LINK_TARGET_ID = 'tailscale';
const pageLinkTargetIds = new Set(PAGE_LINK_TARGETS.map((target) => target.id));
const actionUrlColumnIds = new Set(ACTION_URL_COLUMN_IDS);
const mobileLayoutMedia = window.matchMedia('(max-width: 820px)');

const state = {
  payload: null,
  filter: 'all',
  search: '',
  sortKey: 'name',
  sortDirection: 'asc',
  columnOrder: [...DEFAULT_COLUMN_ORDER],
  frozenColumnId: null,
  columnWidths: {},
  columnDrag: null,
  columnResize: null,
  sortClickTimer: null,
  suppressNextTableClick: false,
  rootPaths: [],
  rootEditorDirty: false,
  rootDrag: null,
  rootReorderPending: false,
  suppressNextRootClick: false,
  discoverLoading: false,
  selectedName: null,
  // The Log 面板 follows the highlighted (selected) project; logText keeps the raw
  // text for 複製.
  logText: '',
  selectedProfileId: '',
  profileEditorDirty: false,
  theme: 'dark',
  restartMenuOpen: false,
  busy: new Set(),
  mobileInstallBusyProject: null,
  mobileInstallLogHoldUntil: 0,
  profileBusy: false,
  expandedPageNames: new Set(),
  expandedBranchNames: new Set(),
  expandedProjectNames: new Set(),
  projectPanelExpansionInitialized: false,
  mobileProjectTopAligned: false,
  pageTargetByProject: new Map(),
  terminalModalOpen: false,
  terminalProjectName: null,
  terminalActiveSessionId: null,
  terminalActiveSessionByProject: new Map(),
  terminalSessions: [],
  terminalWorkspaceMetaBySessionId: new Map(),
  terminalWorkspaceLoaded: false,
  terminalPreferencesLoaded: false,
  terminalPreferencesSaved: false,
  terminalOptionsByProject: new Map(),
  terminalTitleEditingId: null,
  terminalTitleDraft: '',
  terminalFavorites: [],
  terminalFavoriteEditingId: null,
  terminalFavoriteDraftCommand: '',
  terminalFavoriteDraftNote: '',
  terminalFavoritesExpanded: false,
  terminalFavoriteAgent: DEFAULT_TERMINAL_AGENT_ID,
  terminalFavoritesByAgent: {},
  terminalClaude: { ...DEFAULT_TERMINAL_CLAUDE_SETTINGS },
  terminalClaudeFlagDraft: '',
  terminalCodex: { ...DEFAULT_TERMINAL_CODEX_SETTINGS },
  terminalCodexFlagDraft: '',
  terminalAntigravity: { ...DEFAULT_TERMINAL_ANTIGRAVITY_SETTINGS },
  terminalAntigravityFlagDraft: '',
  terminalOpencode: { ...DEFAULT_TERMINAL_OPENCODE_SETTINGS },
  terminalOpencodeFlagDraft: '',
  terminalTabDrag: null,
  suppressTerminalTabClick: false,
  quotaModalOpen: false,
  quotaPayload: null,
  quotaLoading: false,
  quotaError: '',
  quotaRequestId: 0,
  terminalPipeline: null,
  // 記事本草稿(不會執行,只暫存段落 prompt;可整批加入 Pipeline)。
  terminalNotepad: null,
  terminalPipelineRun: {
    active: false,
    sessionLocalId: null,
    stepIndex: -1,
    activeStepId: null,
    total: 0,
    status: 'idle',
    message: '',
    log: [],
  },
  // Server-persisted run progress (survives reload / quota wait) so an interrupted
  // pipeline can be resumed. null = nothing to resume.
  terminalPipelineRunSaved: null,
  // Which content tab (終端 / 啟動 / Pipeline / 設定 / 指令) is showing. null = derive
  // from the session (launcher before a CLI is live, terminal once it is).
  terminalContentTab: null,
  // Tracks the session we already auto-switched to the 終端 tab for, so we don't
  // keep yanking the user back while a process stays live.
  terminalFocusAppliedSessionId: null,
  // Manual full-width toggle (放大), independent of the live auto full-width.
  terminalManualFocus: false,
  // Top-level modal mode: 'terminal' (終端管理) or 'pipeline' (Pipeline 管理).
  terminalModalMode: 'terminal',
  terminalPipelineLogExpanded: false,
};

let terminalPipelineToken = 0;

let terminalPollTimer = null;
let terminalListSyncTick = 0;
let terminalPreferencesSaveTimer = null;
let nextTerminalLocalId = 1;
const terminalViews = new Map();
const TERMINAL_TITLE_MARQUEE_LENGTH = 18;
const TERMINAL_FAVORITE_MARQUEE_LENGTH = 32;
const TERMINAL_TAB_DRAG_THRESHOLD = 6;
const TERMINAL_CLIENT_OUTPUT_LIMIT = 2 * 1024 * 1024;
const TERMINAL_SCROLLBACK_ROWS = 50000;
const TERMINAL_TOUCH_DESKTOP_WIDTH = 1040;
const TERMINAL_TOUCH_DESKTOP_FALLBACK_COLS = 130;
const TERMINAL_TOUCH_DESKTOP_FALLBACK_ROWS = 28;
const TERMINAL_TOUCH_MAX_COLS = 220;
const TERMINAL_TOUCH_MIN_SCALE = 0.45;
const TERMINAL_TOUCH_MAX_SCALE = 1.6;
const TERMINAL_TOUCH_DRAG_TOLERANCE = 6;
const TERMINAL_TOUCH_DRAG_WHEEL_MULTIPLIER = 3;
const TERMINAL_SCROLLBAR_WIDTH = 14;

const icons = {
  start: '<svg viewBox="0 0 24 24" focusable="false"><path d="M8 5v14l11-7-11-7Z"/></svg>',
  tailscale: '<svg viewBox="0 0 24 24" focusable="false"><path d="M7 16.5a4.5 4.5 0 0 1 0-9"/><path d="M17 7.5a4.5 4.5 0 0 1 0 9"/><path d="M8.5 12h7"/><path d="M12 8.5v7"/></svg>',
  stop: '<svg viewBox="0 0 24 24" focusable="false"><path d="M7 7h10v10H7z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" focusable="false"><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M19 11a7 7 0 0 0-12.1-4.8L4 9"/><path d="M5 13a7 7 0 0 0 12.1 4.8L20 15"/></svg>',
  restart: '<svg viewBox="0 0 24 24" focusable="false"><path d="M20 6v5h-5"/><path d="M19 11a7 7 0 0 0-12.1-4.8L4 9"/><path d="M5 13a7 7 0 0 0 12.1 4.8L20 15"/></svg>',
  apk: '<svg viewBox="0 0 24 24" focusable="false"><path d="M8 4h8l3 3v13H5V4h3Z"/><path d="M16 4v4h4"/><path d="M8 12h8"/><path d="M8 16h5"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" focusable="false"><path d="M4 5h16v14H4z"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/></svg>',
  remove: '<svg viewBox="0 0 24 24" focusable="false"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>',
  add: '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  save: '<svg viewBox="0 0 24 24" focusable="false"><path d="m5 13 4 4L19 7"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" focusable="false"><path d="m9 18 6-6-6-6"/></svg>',
  grip: '<svg viewBox="0 0 24 24" focusable="false"><path d="M9 6h.01"/><path d="M15 6h.01"/><path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M9 18h.01"/><path d="M15 18h.01"/></svg>',
  scrollTop: '<svg viewBox="0 0 24 24" focusable="false"><path d="M6 5h12"/><path d="m8 14 4-4 4 4"/><path d="M12 10v9"/></svg>',
  scrollUp: '<svg viewBox="0 0 24 24" focusable="false"><path d="m8 15 4-4 4 4"/><path d="M12 11v8"/></svg>',
  scrollDown: '<svg viewBox="0 0 24 24" focusable="false"><path d="m8 9 4 4 4-4"/><path d="M12 5v8"/></svg>',
  scrollBottom: '<svg viewBox="0 0 24 24" focusable="false"><path d="M6 19h12"/><path d="m8 10 4 4 4-4"/><path d="M12 5v9"/></svg>',
};

const elements = {
  managerUrl: document.querySelector('#managerUrl'),
  managerLocalLink: document.querySelector('#managerLocalLink'),
  managerLanLink: document.querySelector('#managerLanLink'),
  managerTailLink: document.querySelector('#managerTailLink'),
  tailscaleIp: document.querySelector('#tailscaleIp'),
  runningCount: document.querySelector('#runningCount'),
  themeToggleButton: document.querySelector('#themeToggleButton'),
  restartMenuButton: document.querySelector('#restartMenuButton'),
  restartMenuPopover: document.querySelector('#restartMenuPopover'),
  quotaMonitorButton: document.querySelector('#quotaMonitorButton'),
  pipelineOpenButton: document.querySelector('#pipelineOpenButton'),
  openAtmTerminalButton: document.querySelector('#openAtmTerminalButton'),
  rootsInput: document.querySelector('#rootsInput'),
  addRootButton: document.querySelector('#addRootButton'),
  newRootButton: document.querySelector('#newRootButton'),
  rootList: document.querySelector('#rootList'),
  basePortInput: document.querySelector('#basePortInput'),
  filterButtons: document.querySelector('#filterButtons'),
  projectCount: document.querySelector('#projectCount'),
  searchInput: document.querySelector('#searchInput'),
  sortSelect: document.querySelector('#sortSelect'),
  sortDirectionButton: document.querySelector('#sortDirectionButton'),
  lastUpdated: document.querySelector('#lastUpdated'),
  mainPanel: document.querySelector('.main-panel'),
  leftRail: document.querySelector('.left-rail'),
  workspace: document.querySelector('.workspace'),
  railResizer: document.querySelector('#railResizer'),
  tableWrap: document.querySelector('.table-wrap'),
  projectTable: document.querySelector('#projectTable'),
  projectColGroup: document.querySelector('#projectColGroup'),
  projectHeaderRow: document.querySelector('#projectHeaderRow'),
  projectRows: document.querySelector('#projectRows'),
  emptyState: document.querySelector('#emptyState'),
  profileSelect: document.querySelector('#profileSelect'),
  profileNameInput: document.querySelector('#profileNameInput'),
  profileProjectsInput: document.querySelector('#profileProjectsInput'),
  useFilteredProjects: document.querySelector('#useFilteredProjects'),
  saveProfileButton: document.querySelector('#saveProfileButton'),
  deleteProfileButton: document.querySelector('#deleteProfileButton'),
  startProfileButton: document.querySelector('#startProfileButton'),
  stopProfileButton: document.querySelector('#stopProfileButton'),
  restartProfileButton: document.querySelector('#restartProfileButton'),
  copyManagerLocal: document.querySelector('#copyManagerLocal'),
  copyManagerLan: document.querySelector('#copyManagerLan'),
  copyManagerTail: document.querySelector('#copyManagerTail'),
  autoRestoreInput: document.querySelector('#autoRestoreInput'),
  autoRestartInput: document.querySelector('#autoRestartInput'),
  healthThresholdInput: document.querySelector('#healthThresholdInput'),
  autoLogInput: document.querySelector('#autoLogInput'),
  reloadLogsButton: document.querySelector('#reloadLogsButton'),
  copyLogsButton: document.querySelector('#copyLogsButton'),
  logOutput: document.querySelector('#logOutput'),
  toast: document.querySelector('#toast'),
  terminalModal: document.querySelector('#terminalModal'),
  terminalTitle: document.querySelector('#terminalTitle'),
  terminalModeTerminalButton: document.querySelector('#terminalModeTerminalButton'),
  terminalModePipelineButton: document.querySelector('#terminalModePipelineButton'),
  terminalModeNotepadButton: document.querySelector('#terminalModeNotepadButton'),
  closeTerminalModal: document.querySelector('#closeTerminalModal'),
  addTerminalSession: document.querySelector('#addTerminalSession'),
  terminalTabsRow: document.querySelector('#terminalTabsRow'),
  terminalTabs: document.querySelector('#terminalTabs'),
  terminalWorkspace: document.querySelector('#terminalWorkspace'),
  terminalEmpty: document.querySelector('#terminalEmpty'),
  quotaModal: document.querySelector('#quotaModal'),
  closeQuotaModal: document.querySelector('#closeQuotaModal'),
  backToHomeFromQuota: document.querySelector('#backToHomeFromQuota'),
  refreshQuotaButton: document.querySelector('#refreshQuotaButton'),
  quotaSafetyNote: document.querySelector('#quotaSafetyNote'),
  quotaSummary: document.querySelector('#quotaSummary'),
  quotaCards: document.querySelector('#quotaCards'),
};

const tableColumns = [
  {
    id: 'name',
    label: '專案',
    sortable: true,
    getSortValue: (project) => project.name,
    render: (project, context) => renderProjectName(project, context),
  },
  {
    id: 'status',
    label: '狀態',
    sortable: true,
    getSortValue: (project) => STATUS_SORT_ORDER[project.status] ?? 99,
    render: (project) => `<span class="status-chip ${escapeHtml(project.status)}">${statusLabel(project.status)}</span>`,
  },
  {
    id: 'framework',
    label: '框架',
    sortable: true,
    getSortValue: (project) => frameworkLabel(project.framework),
    render: (project) => escapeHtml(frameworkLabel(project.framework)),
  },
  {
    id: 'port',
    label: 'Port',
    sortable: true,
    getSortValue: (project) => Number(project.port) || 0,
    render: (project) => renderPortCell(project),
  },
  {
    id: 'health',
    label: '健康',
    sortable: true,
    getSortValue: (project) => Number(project.healthFailures || 0) * 100 + Number(project.restartCount || 0),
    render: (project) => renderHealth(project),
  },
  {
    id: 'command',
    label: '命令',
    sortable: true,
    getSortValue: (project) => projectCommandLabel(project),
    render: (project) => `<span class="mono-muted" title="${escapeHtml(projectCommandLabel(project))}">${escapeHtml(projectCommandLabel(project))}</span>`,
  },
  {
    id: 'started',
    label: '啟動時間',
    sortable: true,
    getSortValue: (project) => project.startedAt || '',
    render: (project) => `<span class="mono-muted">${escapeHtml(formatDate(project.startedAt))}</span>`,
  },
  {
    id: 'restarted',
    label: '最近重啟',
    sortable: true,
    getSortValue: (project) => project.lastRestartAt || '',
    render: (project) => `<span class="mono-muted">${escapeHtml(formatDate(project.lastRestartAt))}</span>`,
  },
  {
    id: 'local',
    label: '本機',
    sortable: true,
    getSortValue: (project) => project.localUrl || '',
    render: (project) => renderUrlLink(project.localUrl, '本機 URL'),
  },
  {
    id: 'tailscale',
    label: 'Tailscale',
    sortable: true,
    getSortValue: (project) => project.tailscaleUrl || '',
    render: (project) => renderUrlLink(project.tailscaleUrl, 'Tailscale URL'),
  },
  {
    id: 'pid',
    label: 'PID',
    sortable: true,
    getSortValue: (project) => Number(project.pid) || 0,
    render: (project) => `<span class="mono-muted">${project.pid || '--'}</span>`,
  },
  {
    id: 'actions',
    label: '操作',
    sortable: false,
    fixed: true,
    className: 'actions-col',
    render: (project, context) => {
      const terminalCount = startedTerminalSessionsForProject(project.name).length;
      const terminalBadge = terminalCount
        ? `<span class="terminal-session-badge">${terminalCount}</span>`
        : '';
      return `
        <div class="row-actions">
          ${renderProjectPowerAction(project, context)}
          <button class="row-action refresh" data-action="refresh" data-name="${escapeHtml(project.name)}" ${context.busy || state.discoverLoading || DEMO_MODE ? 'disabled' : ''} type="button" title="重新整理:重新掃描此專案的頁面、port 與健康狀態,不會重啟伺服器或終端" aria-label="掃描並重新整理 ${escapeHtml(project.name)}">${icons.refresh}</button>
          <button class="row-action restart" data-action="restart" data-name="${escapeHtml(project.name)}" ${context.busy || DEMO_MODE || project.canStart === false ? 'disabled' : ''} type="button" title="重啟:先停止這個專案的開發伺服器,再依原本的啟動指令重新啟動" aria-label="重啟 ${escapeHtml(project.name)}">${icons.restart}</button>
          ${renderMobileInstallAction(project, context)}
          <button class="row-action terminal ${terminalCount ? 'has-terminal-sessions' : ''}" data-action="terminal" data-name="${escapeHtml(project.name)}" ${DEMO_MODE ? 'disabled' : ''} type="button" title="執行終端" aria-label="開啟 ${escapeHtml(project.name)} 的終端管理">${icons.terminal}${terminalBadge}</button>
        </div>
      `;
    },
  },
];

const columnsById = new Map(tableColumns.map((column) => [column.id, column]));
const extraSortOptions = [
  {
    id: SOURCE_ORDER_SORT_ID,
    label: '\u5c08\u6848\u4f86\u6e90\u9806\u5e8f',
    sortable: true,
    getSortValue: (project) => projectSourceOrderIndex(project),
  },
];
const sortOptionsById = new Map([
  ...tableColumns
    .filter((column) => column.sortable)
    .map((column) => [column.id, column]),
  ...extraSortOptions.map((option) => [option.id, option]),
]);

function statusLabel(status) {
  const labels = {
    running: '執行中',
    restarting: '重啟中',
    unhealthy: '需注意',
    stopped: '已停止',
    stale: '殘留',
    external: '外部',
  };

  return labels[status] || status;
}

function frameworkLabel(framework) {
  if (!framework) {
    return 'project';
  }
  return framework === 'generic' ? 'npm' : framework;
}

function projectCommandLabel(project) {
  if (project.command) {
    return project.command;
  }
  if (project.canStart !== false && project.devScript) {
    return `npm run dev (${project.devScript})`;
  }
  if (project.devScript) {
    return project.devScript;
  }
  return 'Terminal only';
}

function projectIsManagedRunning(project) {
  return Boolean(project.running || ['running', 'restarting', 'unhealthy'].includes(project.status));
}

function renderPortCell(project) {
  // A marker project (hasWebTarget === false) still exposes an editable port when a
  // branch is promoted as its web root (derivedHome): the port belongs to that branch.
  const derivedHome = project.hasWebTarget === false ? project.derivedHome : null;
  if ((project.hasWebTarget === false && !derivedHome) || !project.port) {
    return '<span class="mono-muted">--</span>';
  }

  const disabledAttr = DEMO_MODE ? 'disabled' : '';
  const title = derivedHome
    ? `修改 ${derivedHome.name} 分支 port（按 Enter 套用）`
    : '修改 port（按 Enter 套用）';
  return `<input
    class="port-input mono-muted"
    type="number"
    inputmode="numeric"
    min="1"
    max="65535"
    step="1"
    value="${escapeHtml(String(project.port))}"
    data-port-input
    data-name="${escapeHtml(project.name)}"
    aria-label="${escapeHtml(project.name)} port"
    title="${escapeHtml(title)}"
    ${disabledAttr}
  />`;
}

function renderProjectPowerAction(project, context = {}) {
  const action = projectIsManagedRunning(project) ? 'stop' : 'start';
  const label = action === 'stop' ? '停止' : '啟動';
  const noStartCommand = action === 'start' && project.canStart === false;
  const disabled = DEMO_MODE || context.busy || noStartCommand;
  const disabledAttr = disabled ? 'disabled' : '';
  const title = noStartCommand
    ? '開啟終端後手動執行此專案'
    : project.status === 'external' && action === 'start'
      ? '接管已開啟的 server'
      : label;

  return `<button class="row-action ${action}" data-action="${action}" data-name="${escapeHtml(project.name)}" ${disabledAttr} type="button" title="${escapeHtml(title)}" aria-label="${label} ${escapeHtml(project.name)}">${icons[action]}</button>`;
}

function mobileInstallInfo(project) {
  return project.mobileInstall && typeof project.mobileInstall === 'object'
    ? project.mobileInstall
    : { supported: false, reason: '此專案沒有可用的 Android APK build 流程。' };
}

function renderMobileInstallAction(project, context = {}) {
  const mobile = mobileInstallInfo(project);
  const disabled = DEMO_MODE || context.busy || !mobile.supported;
  const reason = mobile.supported
    ? mobile.buildCommand || 'Build + APK'
    : mobile.reason || '此專案沒有可用的 Android APK build 流程。';
  const disabledAttr = disabled ? 'disabled' : '';

  return `<button class="row-action apk" data-action="mobile-install" data-name="${escapeHtml(project.name)}" ${disabledAttr} type="button" title="${escapeHtml(reason)}" aria-label="Build + APK ${escapeHtml(project.name)}">${icons.apk}</button>`;
}

function renderHealth(project) {
  if (project.hasWebTarget === false && !project.derivedHome) {
    return '<span class="mono-muted">--</span>';
  }

  const failures = Number(project.healthFailures || 0);
  const restarts = Number(project.restartCount || 0);
  const title = [
    project.lastHealthAt ? `最近檢查：${formatDate(project.lastHealthAt)}` : '',
    project.lastHealthError ? `訊息：${project.lastHealthError}` : '',
    restarts ? `自動重啟：${restarts}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  if (project.status === 'restarting') {
    return `<span class="health-pill restarting" title="${escapeHtml(title)}">重啟中</span>`;
  }
  if (failures > 0 || project.status === 'unhealthy') {
    return `<span class="health-pill warning" title="${escapeHtml(title)}">失敗 ${failures}</span>`;
  }
  if (restarts > 0) {
    return `<span class="health-pill ok" title="${escapeHtml(title)}">重啟 ${restarts}</span>`;
  }

  return `<span class="health-pill ok" title="${escapeHtml(title)}">正常</span>`;
}

function formatDate(value) {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function compactPath(value) {
  if (!value) {
    return '--';
  }

  const parts = value.split(/[\\/]+/);
  if (parts.length <= 3) {
    return value;
  }

  return `.../${parts.slice(-3).join('/')}`;
}

function normalizeComparablePath(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function projectSourceMatch(project) {
  const projectPath = normalizeComparablePath(project?.path);
  const roots = state.rootEditorDirty ? state.rootPaths : state.payload?.config?.defaultRoots || [];
  if (!projectPath || !roots.length) {
    return { index: roots.length, relativePath: projectPath };
  }

  for (let index = 0; index < roots.length; index += 1) {
    const rootPath = normalizeComparablePath(roots[index]);
    if (!rootPath) {
      continue;
    }
    if (projectPath === rootPath) {
      return { index, relativePath: '' };
    }
    if (projectPath.startsWith(`${rootPath}/`)) {
      return { index, relativePath: projectPath.slice(rootPath.length + 1) };
    }
  }

  return { index: roots.length, relativePath: projectPath };
}

function projectSourceOrderIndex(project) {
  return projectSourceMatch(project).index;
}

function projectSourceRelativePath(project) {
  return projectSourceMatch(project).relativePath;
}

function renderUrlLink(value, label) {
  if (!value) {
    return '<span class="mono-muted">--</span>';
  }

  if (DEMO_MODE) {
    return `<span class="mono-muted" title="${escapeHtml(label)}">${escapeHtml(value)}</span>`;
  }

  return `<a class="url-link" href="${escapeHtml(value)}" target="_blank" rel="noreferrer" title="開啟 ${escapeHtml(label)}">${escapeHtml(value)}</a>`;
}

function renderProjectActionUrls(project) {
  const pages = getProjectPages(project);
  const hasAnyUrl = PAGE_LINK_TARGETS.some((target) => project[target.urlKey]);
  if (project.hasWebTarget === false && !hasAnyUrl && pages.length === 0) {
    return '';
  }

  const hasPages = pages.length > 0;
  const selectedTarget = getProjectPageTarget(project);

  return `
    <div class="project-action-urls" aria-label="${escapeHtml(project.name)} connection URLs">
      ${PAGE_LINK_TARGETS.map((target) => {
        const value = project[target.urlKey];
        const active = hasPages && selectedTarget === target.id;
        const needsConnection = targetNeedsConnection(project, target.id);
        const className = [
          'project-action-url',
          target.id,
          active ? 'is-active' : '',
          needsConnection ? 'needs-connection' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const targetTitle = needsConnection
          ? `切換並啟用 ${target.label}`
          : hasPages
            ? `Use ${target.label} for page links`
            : value;
        if (!value) {
          return hasPages
            ? `
              <button class="project-action-url ${escapeHtml(target.id)} is-disabled" type="button" disabled>
                ${escapeHtml(target.label)}
              </button>
            `
            : `
              <span class="project-action-url ${escapeHtml(target.id)} is-disabled" aria-disabled="true">
                ${escapeHtml(target.label)}
              </span>
            `;
        }

        if (hasPages) {
          return `
            <button
              class="${escapeHtml(className)}"
              data-page-target="${escapeHtml(target.id)}"
              data-name="${escapeHtml(project.name)}"
              type="button"
              title="${escapeHtml(targetTitle)}"
              aria-pressed="${active ? 'true' : 'false'}"
              ${DEMO_MODE ? 'disabled' : ''}
            >
              ${escapeHtml(target.label)}
            </button>
          `;
        }

        if (needsConnection) {
          return `
            <button
              class="${escapeHtml(className)}"
              data-connection-target="${escapeHtml(target.id)}"
              data-name="${escapeHtml(project.name)}"
              type="button"
              title="${escapeHtml(targetTitle)}"
            >
              ${escapeHtml(target.label)}
            </button>
          `;
        }

        return `
          ${DEMO_MODE
            ? `<span class="${escapeHtml(className)} is-disabled" aria-disabled="true" title="${escapeHtml(targetTitle)}">${escapeHtml(target.label)}</span>`
            : `<a class="${escapeHtml(className)}" href="${escapeHtml(value)}" target="_blank" rel="noreferrer" title="${escapeHtml(targetTitle)}" aria-label="開啟 ${escapeHtml(target.label)} URL">
            ${escapeHtml(target.label)}
          </a>`}
        `;
      }).join('')}
    </div>
  `;
}

function connectionActionForTarget(targetId) {
  return targetId === 'tailscale' ? targetId : '';
}

function targetNeedsConnection(project, targetId) {
  if (targetId === 'tailscale') {
    return Boolean(project.tailscaleUrl && !project.tailscaleReady);
  }
  return false;
}

async function activateConnectionTarget(projectName, targetId) {
  const project = state.payload?.projects.find((item) => item.name === projectName);
  const action = connectionActionForTarget(targetId);
  if (!project || !action || !targetNeedsConnection(project, targetId)) {
    return true;
  }

  return runAction(projectName, action);
}

async function selectProjectPageTarget(projectName, targetId) {
  if (!projectName || !pageLinkTargetIds.has(targetId)) {
    return;
  }

  const connected = await activateConnectionTarget(projectName, targetId);
  if (!connected) {
    return;
  }

  state.pageTargetByProject.set(projectName, targetId);
  render();
}

function getProjectPages(project) {
  return Array.isArray(project?.pages) ? project.pages : [];
}

function getProjectBranches(project) {
  return Array.isArray(project?.branches) ? project.branches : [];
}

function getProjectBackends(project) {
  return Array.isArray(project?.backends) ? project.backends : [];
}

// Branches shown in the plain 分支 list, excluding any that are already surfaced as
// richer backend management items (so a backend never shows up twice).
function getProjectNonBackendBranches(project) {
  const backendPaths = new Set(getProjectBackends(project).map((backend) => String(backend.path || '').toLowerCase()));
  return getProjectBranches(project).filter((branch) => !backendPaths.has(String(branch.path || '').toLowerCase()));
}

function roleBadgeHtml(role) {
  if (role === 'backend') {
    return '<span class="role-badge role-backend" title="後端服務">後端</span>';
  }
  if (role === 'crawler') {
    return '<span class="role-badge role-crawler" title="爬蟲腳本">爬蟲</span>';
  }
  if (role === 'frontend') {
    return '<span class="role-badge role-frontend" title="前端網頁">前端</span>';
  }
  return '';
}

function getPageTargetDefinition(targetId) {
  return PAGE_LINK_TARGETS.find((target) => target.id === targetId) || PAGE_LINK_TARGETS[0];
}

function getDefaultProjectPageTargetId(project) {
  if (isMobileLayout() && project?.tailscaleUrl) {
    return MOBILE_DEFAULT_PAGE_LINK_TARGET_ID;
  }

  return DEFAULT_PAGE_LINK_TARGET_ID;
}

function getProjectPageTarget(project) {
  const selectedTarget = state.pageTargetByProject.get(project.name) || getDefaultProjectPageTargetId(project);
  const target = getPageTargetDefinition(selectedTarget);
  if (pageLinkTargetIds.has(selectedTarget) && project[target.urlKey]) {
    return selectedTarget;
  }

  return PAGE_LINK_TARGETS.find((item) => project[item.urlKey])?.id || DEFAULT_PAGE_LINK_TARGET_ID;
}

function getProjectHomeLink(project) {
  const target = getPageTargetDefinition(getProjectPageTarget(project));
  if (project[target.urlKey]) {
    return { label: target.label, url: project[target.urlKey] };
  }

  const fallback = PAGE_LINK_TARGETS.find((item) => project[item.urlKey]) || PAGE_LINK_TARGETS[0];
  return { label: fallback.label, url: project[fallback.urlKey] || '' };
}

function renderProjectQuickActions(project, context = {}) {
  const refreshDisabled = context.busy || state.discoverLoading || DEMO_MODE ? 'disabled' : '';
  const restartDisabled = context.busy || DEMO_MODE || project.canStart === false ? 'disabled' : '';
  const terminalCount = startedTerminalSessionsForProject(project.name).length;
  const terminalBadge = terminalCount
    ? `<span class="terminal-session-badge">${terminalCount}</span>`
    : '';

  return `
    <div class="project-quick-actions" aria-label="${escapeHtml(project.name)} 快速操作">
      ${renderProjectPowerAction(project, context)}
      <button class="row-action refresh" data-action="refresh" data-name="${escapeHtml(project.name)}" ${refreshDisabled} type="button" title="重新整理:重新掃描此專案的頁面、port 與健康狀態,不會重啟伺服器或終端" aria-label="掃描並重新整理 ${escapeHtml(project.name)}">${icons.refresh}</button>
      <button class="row-action restart" data-action="restart" data-name="${escapeHtml(project.name)}" ${restartDisabled} type="button" title="重啟:先停止這個專案的開發伺服器,再依原本的啟動指令重新啟動" aria-label="重啟 ${escapeHtml(project.name)}">${icons.restart}</button>
      <button class="row-action terminal ${terminalCount ? 'has-terminal-sessions' : ''}" data-action="terminal" data-name="${escapeHtml(project.name)}" ${DEMO_MODE ? 'disabled' : ''} type="button" title="執行終端" aria-label="開啟 ${escapeHtml(project.name)} 的終端管理">${icons.terminal}${terminalBadge}</button>
    </div>
  `;
}

function renderProjectName(project, context = {}) {
  const pages = getProjectPages(project);
  const branches = getProjectNonBackendBranches(project);
  const backends = getProjectBackends(project);
  const pageCount = pages.length;
  const branchCount = branches.length;
  const backendCount = backends.filter((backend) => backend.role !== 'crawler').length;
  const crawlerCount = backends.filter((backend) => backend.role === 'crawler').length;
  const expanded = Boolean(context.pagesExpanded && pageCount > 0);
  const branchesExpanded = Boolean(context.branchesExpanded && branchCount > 0);
  const projectExpanded = context.projectPanelExpanded !== false;
  const pageLabel = pageCount === 1 ? '1 page' : `${pageCount} pages`;
  const branchLabel = branchCount === 1 ? '1 分支' : `${branchCount} 分支`;
  const backendLabel = [
    backendCount > 0 ? `${backendCount} 後端` : '',
    crawlerCount > 0 ? `${crawlerCount} 爬蟲` : '',
  ].filter(Boolean).join('・');
  const homeLink = getProjectHomeLink(project);
  const pageCountControl = pageCount > 0
    ? `
      <button
        class="page-count page-count-button ${expanded ? 'is-expanded' : ''}"
        data-page-toggle
        data-name="${escapeHtml(project.name)}"
        type="button"
        title="${expanded ? 'Collapse pages' : 'Expand pages'}"
        aria-label="${expanded ? 'Collapse' : 'Expand'} ${escapeHtml(project.name)} pages"
        aria-expanded="${expanded ? 'true' : 'false'}"
      >${escapeHtml(pageLabel)}</button>
    `
    : `<span class="page-count is-empty">${escapeHtml(pageLabel)}</span>`;
  const branchCountControl = branchCount > 0
    ? `
      <button
        class="page-count page-count-button ${branchesExpanded ? 'is-expanded' : ''}"
        data-branch-toggle
        data-name="${escapeHtml(project.name)}"
        type="button"
        title="${branchesExpanded ? '收合分支' : '展開分支'}"
        aria-label="${branchesExpanded ? '收合' : '展開'} ${escapeHtml(project.name)} 分支"
        aria-expanded="${branchesExpanded ? 'true' : 'false'}"
      >${escapeHtml(branchLabel)}</button>
    `
    : '';
  const backendCountControl = backends.length > 0
    ? `<span class="page-count backend-count" title="此專案的後端服務與爬蟲腳本數量">${escapeHtml(backendLabel)}</span>`
    : '';
  const homeControl = homeLink.url
    ? `<a class="project-home-link" href="${escapeHtml(homeLink.url)}" target="_blank" rel="noreferrer" title="${escapeHtml(homeLink.url)}">Home</a>`
    : '<span class="project-home-link is-disabled">Home</span>';

  return `
    <div class="project-name-cell">
      <div class="project-name">
        <div class="project-name-heading">
          <strong>${escapeHtml(project.name)}</strong>
          ${roleBadgeHtml(project.role)}
          <button
            class="project-panel-toggle ${projectExpanded ? 'is-expanded' : ''}"
            data-panel-toggle
            data-name="${escapeHtml(project.name)}"
            type="button"
            title="${projectExpanded ? 'Collapse project panel' : 'Expand project panel'}"
            aria-label="${projectExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(project.name)} project panel"
            aria-expanded="${projectExpanded ? 'true' : 'false'}"
          >${icons.chevron}</button>
        </div>
        <span class="project-path-text" title="${escapeHtml(project.path)}">${escapeHtml(compactPath(project.path))}</span>
        <div class="project-name-links">
          ${branchCountControl}
          ${backendCountControl}
          ${pageCountControl}
          ${homeControl}
        </div>
        ${renderProjectQuickActions(project, context)}
      </div>
    </div>
  `;
}

// A backend management item mirrors the project's own (frontend) controls —
// 狀態 / 框架 / port / 啟動·停止 / 重啟 / 重新整理 — but every action is pinned to the
// backend branch via data-target-path so the server acts on that branch only.
function renderBackendItem(project, backend, context = {}) {
  const relativePath = backend.relativePath || compactPath(backend.path);
  const command = projectCommandLabel(backend);
  const title = [backend.path, command].filter(Boolean).join('\n');
  const targetPathAttr = escapeHtml(backend.path || '');
  const busy = Boolean(context.busy);
  const running = projectIsManagedRunning(backend);
  const powerAction = running ? 'stop' : 'start';
  const powerLabel = powerAction === 'stop' ? '停止' : '啟動';
  const powerDisabled = DEMO_MODE || busy || (powerAction === 'start' && backend.canStart === false);
  const restartDisabled = busy || DEMO_MODE || backend.canStart === false;
  const refreshDisabled = busy || state.discoverLoading || DEMO_MODE;
  const roleLabel = backend.role === 'crawler' ? '爬蟲' : '後端';
  const portCell = backend.port
    ? `<input
        class="port-input mono-muted backend-port-input"
        type="number"
        inputmode="numeric"
        min="1"
        max="65535"
        step="1"
        value="${escapeHtml(String(backend.port))}"
        data-port-input
        data-name="${escapeHtml(project.name)}"
        data-target-path="${targetPathAttr}"
        aria-label="${escapeHtml(backend.name)} port"
        title="修改 ${escapeHtml(backend.name)} port（按 Enter 套用）"
        ${DEMO_MODE ? 'disabled' : ''}
      />`
    : '<span class="mono-muted">--</span>';

  return `
    <div class="page-branch-item project-backend-item" data-backend-path="${targetPathAttr}">
      <span class="page-branch-marker" aria-hidden="true"></span>
      <div class="page-route project-branch-main">
        <strong title="${escapeHtml(title)}">${escapeHtml(backend.name)} ${roleBadgeHtml(backend.role || 'backend')}</strong>
        <span>${escapeHtml(relativePath)}</span>
      </div>
      <span class="backend-status"><span class="status-chip ${escapeHtml(backend.status)}">${statusLabel(backend.status)}</span></span>
      <span class="page-link-mode backend-framework">${escapeHtml(frameworkLabel(backend.framework))}</span>
      <span class="backend-port-cell">${portCell}</span>
      <div class="project-quick-actions backend-quick-actions" aria-label="${escapeHtml(backend.name)} ${roleLabel}操作">
        <button class="row-action ${powerAction}" data-action="${powerAction}" data-name="${escapeHtml(project.name)}" data-target-path="${targetPathAttr}" ${powerDisabled ? 'disabled' : ''} type="button" title="${powerLabel}" aria-label="${powerLabel} ${escapeHtml(backend.name)}">${icons[powerAction]}</button>
        <button class="row-action refresh" data-action="refresh" data-name="${escapeHtml(project.name)}" ${refreshDisabled ? 'disabled' : ''} type="button" title="重新整理:重新掃描此${roleLabel}的 port 與健康狀態,不會重啟服務" aria-label="掃描並重新整理 ${escapeHtml(project.name)}">${icons.refresh}</button>
        <button class="row-action restart" data-action="restart" data-name="${escapeHtml(project.name)}" data-target-path="${targetPathAttr}" ${restartDisabled ? 'disabled' : ''} type="button" title="重啟:先停止這個${roleLabel},再依原本的啟動指令重新啟動" aria-label="重啟 ${escapeHtml(backend.name)}">${icons.restart}</button>
      </div>
    </div>
  `;
}

function renderProjectBackends(project, columnCount, expanded, selectedClass, context = {}) {
  if (!expanded) {
    return '';
  }

  const backends = getProjectBackends(project);
  if (!backends.length) {
    return '';
  }

  const items = backends.map((backend) => renderBackendItem(project, backend, context)).join('');

  return `
    <tr class="project-pages-row project-backends-row ${selectedClass}" data-backends-for="${escapeHtml(project.name)}">
      <td colspan="${columnCount}">
        <div class="project-pages-branch project-backends">
          ${items}
        </div>
      </td>
    </tr>
  `;
}

function renderProjectBranches(project, columnCount, expanded, selectedClass) {
  if (!expanded) {
    return '';
  }

  const branches = getProjectNonBackendBranches(project);
  if (!branches.length) {
    return '';
  }

  const branchItems = branches
    .map((branch) => {
      const relativePath = branch.relativePath || compactPath(branch.path);
      const command = projectCommandLabel(branch);
      const title = [branch.path, command].filter(Boolean).join('\n');

      return `
        <div class="page-branch-item project-branch-item">
          <span class="page-branch-marker" aria-hidden="true"></span>
          <div class="page-route project-branch-main">
            <strong title="${escapeHtml(title)}">${escapeHtml(branch.name)}</strong>
            <span>${escapeHtml(relativePath)}</span>
          </div>
          <span class="page-link-mode">${escapeHtml(frameworkLabel(branch.framework))}</span>
          <span class="page-meta" title="${escapeHtml(command)}">${escapeHtml(command)}</span>
        </div>
      `;
    })
    .join('');

  return `
    <tr class="project-pages-row project-branches-row ${selectedClass}" data-branches-for="${escapeHtml(project.name)}">
      <td colspan="${columnCount}">
        <div class="project-pages-branch project-branches">
          ${branchItems}
        </div>
      </td>
    </tr>
  `;
}

function renderProjectPages(project, columnCount, expanded, selectedClass) {
  if (!expanded) {
    return '';
  }

  const pages = getProjectPages(project);
  if (!pages.length) {
    return '';
  }

  const pageItems = pages
    .map((page) => {
      const routeLabel = page.path || page.title || '/';
      const target = getPageTargetDefinition(getProjectPageTarget(project));
      const pageUrl = page[target.urlKey] || '';
      const sourceLabel = [page.source, page.pattern ? 'pattern' : '', page.file]
        .filter(Boolean)
        .join(' / ');
      const routeContent = pageUrl && !page.pattern
        ? DEMO_MODE
          ? `<span class="page-link is-disabled" title="${escapeHtml(pageUrl)}">${escapeHtml(routeLabel)}</span>`
          : `<a class="page-link" href="${escapeHtml(pageUrl)}" target="_blank" rel="noreferrer" title="${escapeHtml(pageUrl)}">${escapeHtml(routeLabel)}</a>`
        : `<span class="page-link ${page.pattern ? 'is-pattern' : 'is-disabled'}" title="${page.pattern ? 'Route pattern' : `${target.label} URL unavailable`}">${escapeHtml(routeLabel)}</span>`;

      return `
        <div class="page-branch-item">
          <span class="page-branch-marker" aria-hidden="true"></span>
          <div class="page-route">
            ${routeContent}
            <span>${escapeHtml(page.title || routeLabel)}</span>
          </div>
          <span class="page-link-mode ${pageUrl && !page.pattern ? '' : 'is-disabled'}">${escapeHtml(target.label)}</span>
          <span class="page-meta" title="${escapeHtml(sourceLabel)}">${escapeHtml(sourceLabel)}</span>
        </div>
      `;
    })
    .join('');

  return `
    <tr class="project-pages-row ${selectedClass}" data-pages-for="${escapeHtml(project.name)}">
      <td colspan="${columnCount}">
        <div class="project-pages-branch">
          ${pageItems}
        </div>
      </td>
    </tr>
  `;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.classList.remove('is-visible');
  }, 2200);
}

function readThemePreference() {
  try {
    return readLocalPreference(THEME_PREFERENCE_KEY) === 'light' ? 'light' : 'dark';
  } catch (error) {
    return 'dark';
  }
}

function applyTheme(theme, { persist = false } = {}) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;

  const isLight = state.theme === 'light';
  elements.themeToggleButton.setAttribute('aria-pressed', String(isLight));
  elements.themeToggleButton.setAttribute('aria-label', isLight ? '切換深色主題' : '切換淺色主題');
  elements.themeToggleButton.setAttribute('title', isLight ? '切換深色主題' : '切換淺色主題');

  if (!persist) {
    return;
  }

  try {
    writeLocalPreference(THEME_PREFERENCE_KEY, state.theme);
  } catch (error) {
    // Theme switching should still work for the current session.
  }
}

async function api(path, options = {}) {
  if (DEMO_MODE) {
    return demoApi(path, options);
  }

  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || 'Request failed.');
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function loadStatus({ silent = false } = {}) {
  if (!silent) {
    elements.restartMenuButton.disabled = true;
  }

  try {
    state.payload = await api('/api/status');
    if (!state.selectedName && state.payload.projects.length) {
      state.selectedName = state.payload.projects[0].name;
    }
    if (state.selectedName && !state.payload.projects.some((project) => project.name === state.selectedName)) {
      state.selectedName = state.payload.projects[0]?.name || null;
    }
    if (state.selectedProfileId && !getProfiles().some((profile) => profile.id === state.selectedProfileId)) {
      state.selectedProfileId = '';
      state.profileEditorDirty = false;
    }
    render();
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.restartMenuButton.disabled = false;
  }
}

function getProfiles() {
  return state.payload?.config?.profiles || [];
}

function terminalIsReadOnly() {
  return state.payload?.manager?.terminalReadOnly === true;
}

function terminalRemoteClaudeLaunchEnabled() {
  return state.payload?.manager?.terminalClaudeRemoteLaunch === true;
}

function terminalRemoteAgentLaunchEnabled() {
  return terminalRemoteClaudeLaunchEnabled() || state.payload?.manager?.terminalAgentRemoteLaunch === true;
}

function terminalCanAddSession() {
  // A draft is just UI scaffolding — a read-only (remote) device still needs one to
  // reach the Pipeline config tab. Actually launching/typing is gated separately.
  return true;
}

function terminalCanUseAgentLauncher(session) {
  // Launching a CLI is execution, which is only allowed on the local machine.
  return Boolean(session)
    && !session.busy
    && !session.exitedAt
    && !session.readOnly
    && !terminalIsReadOnly();
}

function terminalCanUseClaudeLauncher(session) {
  return terminalCanUseAgentLauncher(session);
}

function filteredProjects() {
  const payload = state.payload;
  if (!payload) {
    return [];
  }

  return payload.projects.filter((project) => {
    const matchesFilter =
      state.filter === 'all' ||
      project.status === state.filter ||
      (state.filter === 'unhealthy' && ['unhealthy', 'restarting'].includes(project.status)) ||
      (state.filter === 'stale' && ['stale', 'external'].includes(project.status));
    const pageHaystack = getProjectPages(project)
      .map((page) => `${page.path || ''} ${page.title || ''} ${page.file || ''}`)
      .join(' ');
    const branchHaystack = getProjectBranches(project)
      .map((branch) => `${branch.name || ''} ${branch.framework || ''} ${branch.sourceType || ''} ${branch.relativePath || ''} ${branch.path || ''} ${branch.port || ''} ${branch.devScript || ''}`)
      .join(' ');
    const haystack = `${project.name} ${project.framework} ${project.sourceType || ''} ${project.path} ${project.port || ''} ${pageHaystack} ${branchHaystack}`.toLowerCase();
    return matchesFilter && haystack.includes(state.search.toLowerCase());
  });
}

function selectedProject() {
  return state.payload?.projects.find((project) => project.name === state.selectedName) || null;
}

function selectedProfile() {
  return getProfiles().find((profile) => profile.id === state.selectedProfileId) || null;
}

function normalizeRootPaths(paths) {
  const seen = new Set();
  return paths
    .map((root) => String(root || '').trim())
    .filter(Boolean)
    .filter((root) => {
      const key = root.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function syncRootPathsFromPayload(payload) {
  if (state.rootEditorDirty) {
    return;
  }

  state.rootPaths = normalizeRootPaths(payload.config.defaultRoots || []);
  renderRootList();
}

function commitRootInput() {
  const root = elements.rootsInput.value.trim();
  if (!root) {
    return false;
  }

  state.rootPaths = normalizeRootPaths([...state.rootPaths, root]);
  state.rootEditorDirty = true;
  elements.rootsInput.value = '';
  renderRootList();
  return true;
}

function readRootPathsForDiscover() {
  const draft = elements.rootsInput.value.trim();
  return normalizeRootPaths([...state.rootPaths, draft]);
}

function removeRootPath(index) {
  state.rootPaths = state.rootPaths.filter((_, currentIndex) => currentIndex !== index);
  state.rootEditorDirty = true;
  renderRootList();
}

// Re-order the existing DOM nodes in place (no innerHTML rebuild, no marquee
// recalculation) so dragging doesn't stutter. Only used while a drag is active;
// finishRootReorder() does a full renderRootList() afterwards to resync everything.
function reorderRootListDomInPlace(nextPaths) {
  if (!elements.rootList) {
    return;
  }

  const previousRects = captureRootItemRects();
  const itemsByRoot = new Map();
  elements.rootList.querySelectorAll('.root-list-item[data-root]').forEach((item) => {
    itemsByRoot.set(item.dataset.root, item);
  });

  let anchor = null;
  nextPaths.forEach((root, index) => {
    const item = itemsByRoot.get(root);
    if (!item) {
      return;
    }
    item.dataset.rootIndex = String(index);
    if (anchor) {
      anchor.after(item);
    } else if (elements.rootList.firstElementChild !== item) {
      elements.rootList.prepend(item);
    }
    anchor = item;
  });

  animateRootReorder(previousRects);
}

function moveRootPathNear(sourceRoot, targetIndex, placeAfter) {
  const sourceIndex = state.rootPaths.findIndex((root) => root === sourceRoot);
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= state.rootPaths.length) {
    return false;
  }

  let insertIndex = targetIndex + (placeAfter ? 1 : 0);
  if (sourceIndex < insertIndex) {
    insertIndex -= 1;
  }
  insertIndex = Math.max(0, Math.min(insertIndex, state.rootPaths.length - 1));
  if (insertIndex === sourceIndex) {
    return false;
  }

  const nextPaths = [...state.rootPaths];
  const [movedRoot] = nextPaths.splice(sourceIndex, 1);
  nextPaths.splice(insertIndex, 0, movedRoot);
  if (nextPaths.join('\n') === state.rootPaths.join('\n')) {
    return false;
  }

  state.rootPaths = nextPaths;
  state.rootEditorDirty = true;
  if (state.rootDrag) {
    state.rootDrag.changed = true;
  }
  if (state.rootDrag?.active) {
    // Mid-drag: move the existing nodes instead of rebuilding the whole list
    // (innerHTML rebuild + marquee width recalculation on every swap was the stutter).
    reorderRootListDomInPlace(nextPaths);
  } else {
    renderRootList();
  }
  return true;
}

function suppressRootClick() {
  state.suppressNextRootClick = true;
  window.setTimeout(() => {
    state.suppressNextRootClick = false;
  }, 450);
}

function startRootReorder(event) {
  if (DEMO_MODE || state.discoverLoading) {
    return;
  }
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }
  if (event.target.closest('[data-remove-root]')) {
    return;
  }

  const item = event.target.closest('.root-list-item[data-root-index]');
  const index = Number(item?.dataset.rootIndex);
  const root = state.rootPaths[index];
  if (!root) {
    return;
  }

  const rect = item.getBoundingClientRect();
  state.rootDrag = {
    active: false,
    changed: false,
    root,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    // Where inside the item the pointer grabbed it, so the card stays under the cursor.
    grabOffsetY: event.clientY - rect.top,
    // Latest pointer position + pending rAF id for frame-throttled reordering.
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    rafId: 0,
  };
}

// Keep the lifted item pinned under the pointer while neighbours reflow around it.
function applyRootDragFollow(clientY) {
  const drag = state.rootDrag;
  if (!drag?.active || !elements.rootList) {
    return;
  }

  const draggedEl = elements.rootList.querySelector('.root-list-item.is-dragging');
  if (!draggedEl) {
    return;
  }

  draggedEl.style.transition = 'none';
  draggedEl.style.transform = '';
  const slotTop = draggedEl.getBoundingClientRect().top;
  const offset = (clientY - drag.grabOffsetY) - slotTop;
  draggedEl.style.transform = `translateY(${offset}px)`;
}

function handleRootPointerMove(event) {
  const drag = state.rootDrag;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }

  const deltaX = Math.abs(event.clientX - drag.startX);
  const deltaY = Math.abs(event.clientY - drag.startY);
  if (!drag.active && Math.max(deltaX, deltaY) < ROOT_REORDER_MOVE_THRESHOLD) {
    return;
  }

  if (!drag.active) {
    drag.active = true;
    document.body.classList.add('is-root-reordering');
    renderRootList();
  }

  event.preventDefault();
  // pointermove can fire several times per frame; record the latest position and process
  // it once per animation frame. Re-running elementFromPoint + reorder + re-render on
  // every raw event is what made the drag stutter.
  drag.lastClientX = event.clientX;
  drag.lastClientY = event.clientY;
  if (drag.rafId) {
    return;
  }
  drag.rafId = window.requestAnimationFrame(() => {
    drag.rafId = null;
    processRootDragMove();
  });
}

function processRootDragMove() {
  const drag = state.rootDrag;
  if (!drag?.active) {
    return;
  }

  const { lastClientX, lastClientY } = drag;
  const targetItem = document.elementFromPoint(lastClientX, lastClientY)?.closest('.root-list-item[data-root-index]');
  const targetIndex = Number(targetItem?.dataset.rootIndex);
  if (targetItem && !Number.isNaN(targetIndex)) {
    const rect = targetItem.getBoundingClientRect();
    moveRootPathNear(drag.root, targetIndex, lastClientY > rect.top + rect.height / 2);
  }

  applyRootDragFollow(lastClientY);
}

function finishRootReorder({ suppressClick = false } = {}) {
  const drag = state.rootDrag;
  if (!drag) {
    return;
  }

  if (drag.rafId) {
    window.cancelAnimationFrame(drag.rafId);
    drag.rafId = 0;
  }

  const shouldPersist = drag.active && drag.changed;
  const shouldSuppressClick = suppressClick || drag.active;
  state.rootDrag = null;
  document.body.classList.remove('is-root-reordering');
  if (shouldSuppressClick) {
    suppressRootClick();
  }
  renderRootList();

  if (shouldPersist) {
    persistRootOrder();
  }
}

// A drag that finishes while a previous reorder's persist request is still in
// flight must not be silently dropped by discover()'s in-flight guard — otherwise
// the earlier request's stale response overwrites the newer order once it resolves.
// Queue one retry so the latest order always gets persisted.
async function persistRootOrder() {
  if (state.discoverLoading) {
    state.rootReorderPending = true;
    return;
  }

  await discover({ commitDraft: false, includeDraft: false, showToastOnSuccess: false });
  if (state.rootReorderPending) {
    state.rootReorderPending = false;
    persistRootOrder();
  }
}

function applyLeftRailWidth(width) {
  const clamped = Math.round(Math.min(LEFT_RAIL_MAX_WIDTH, Math.max(LEFT_RAIL_MIN_WIDTH, width)));
  document.documentElement.style.setProperty('--left-rail-width', `${clamped}px`);
  return clamped;
}

function restoreLeftRailWidth() {
  const stored = Number(readLocalPreference(LEFT_RAIL_WIDTH_KEY));
  if (Number.isFinite(stored) && stored > 0) {
    applyLeftRailWidth(stored);
  }
}

function setupRailResizer() {
  const resizer = elements.railResizer;
  const rail = elements.leftRail;
  if (!resizer || !rail) {
    return;
  }

  restoreLeftRailWidth();

  let pointerId = null;
  let lastWidth = null;

  const persistWidth = () => {
    if (Number.isFinite(lastWidth)) {
      writeLocalPreference(LEFT_RAIL_WIDTH_KEY, String(lastWidth));
    }
  };

  const onMove = (event) => {
    if (pointerId === null || event.pointerId !== pointerId) {
      return;
    }
    // Rail width tracks the pointer relative to the rail's left edge.
    lastWidth = applyLeftRailWidth(event.clientX - rail.getBoundingClientRect().left);
  };

  const end = (event) => {
    if (pointerId === null || (event && event.pointerId !== pointerId)) {
      return;
    }
    try {
      resizer.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released; ignore.
    }
    pointerId = null;
    resizer.classList.remove('is-dragging');
    document.body.classList.remove('is-rail-resizing');
    persistWidth();
  };

  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isMobileLayout()) {
      return;
    }
    pointerId = event.pointerId;
    resizer.setPointerCapture(pointerId);
    resizer.classList.add('is-dragging');
    document.body.classList.add('is-rail-resizing');
    event.preventDefault();
  });
  resizer.addEventListener('pointermove', onMove);
  resizer.addEventListener('pointerup', end);
  resizer.addEventListener('pointercancel', end);

  // Keyboard accessibility: arrow keys nudge the divider.
  resizer.addEventListener('keydown', (event) => {
    if (isMobileLayout()) {
      return;
    }
    const step = event.shiftKey ? 32 : 12;
    let delta = 0;
    if (event.key === 'ArrowLeft') {
      delta = -step;
    } else if (event.key === 'ArrowRight') {
      delta = step;
    } else {
      return;
    }
    event.preventDefault();
    lastWidth = applyLeftRailWidth(rail.getBoundingClientRect().width + delta);
    persistWidth();
  });
}

function formatRootLabel(root) {
  const value = String(root || '').trim();
  if (!value) {
    return '';
  }

  // Paths under the user's Documents folder show only the part after Documents;
  // anything outside Documents keeps its full path so it stays unambiguous.
  const afterDocuments = value.match(/[\\/]?Documents[\\/]+(.+)$/i);
  if (afterDocuments && afterDocuments[1]) {
    return afterDocuments[1];
  }
  if (/[\\/]?Documents[\\/]?$/i.test(value)) {
    return 'Documents';
  }

  return value;
}

function captureRootItemRects() {
  const rects = new Map();
  if (!elements.rootList) {
    return rects;
  }

  elements.rootList.querySelectorAll('.root-list-item[data-root]').forEach((item) => {
    rects.set(item.dataset.root, item.getBoundingClientRect());
  });
  return rects;
}

function animateRootReorder(previousRects) {
  if (!previousRects || !previousRects.size || !elements.rootList) {
    return;
  }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  elements.rootList.querySelectorAll('.root-list-item[data-root]').forEach((item) => {
    // The lifted item follows the pointer directly; don't fight it with a FLIP tween.
    if (item.classList.contains('is-dragging')) {
      return;
    }

    const previous = previousRects.get(item.dataset.root);
    if (!previous) {
      return;
    }

    const next = item.getBoundingClientRect();
    const deltaX = previous.left - next.left;
    const deltaY = previous.top - next.top;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
      return;
    }

    // FLIP: snap the item back to its previous spot, then transition to the new one.
    item.style.transition = 'none';
    item.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    void item.offsetWidth;
    window.requestAnimationFrame(() => {
      item.style.transition = `transform ${ROOT_REORDER_FLIP_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
      item.style.transform = '';
    });
    item.addEventListener(
      'transitionend',
      () => {
        item.style.transition = '';
        item.style.transform = '';
      },
      { once: true },
    );
  });
}

function renderRootList() {
  if (!elements.rootList) {
    return;
  }

  if (!state.rootPaths.length) {
    elements.rootList.innerHTML = '<div class="root-list-empty">尚未加入來源</div>';
    return;
  }

  const previousRects = captureRootItemRects();
  elements.rootList.innerHTML = state.rootPaths
    .map((root, index) => {
      const dragging = state.rootDrag?.active && state.rootDrag.root === root;
      const disabled = DEMO_MODE || state.discoverLoading ? 'disabled' : '';
      const label = formatRootLabel(root);
      return `
      <div class="root-list-item ${dragging ? 'is-dragging' : ''}" data-root-index="${index}" data-root="${escapeHtml(root)}">
        <button class="root-path-button" data-open-root data-root-index="${index}" type="button" title="\u958b\u555f\u5c08\u6848\u4f86\u6e90\uff1a${escapeHtml(root)}" aria-label="\u958b\u555f ${escapeHtml(root)}" ${disabled}>
          <span class="root-drag-handle" aria-hidden="true">${icons.grip}</span>
          <span class="root-path-marquee" title="${escapeHtml(root)}">
            <span class="root-path-text">${escapeHtml(label)}</span>
          </span>
        </button>
        <button class="root-remove-button" data-remove-root data-root-index="${index}" type="button" title="移除來源" aria-label="移除 ${escapeHtml(root)}" ${disabled}>${icons.remove}</button>
      </div>
    `;
    })
    .join('');
  animateRootReorder(previousRects);
  window.requestAnimationFrame(updateRootPathMarquees);
}

function updateRootPathMarquees() {
  if (!elements.rootList) {
    return;
  }

  elements.rootList.querySelectorAll('.root-path-marquee').forEach((marquee) => {
    const text = marquee.querySelector('.root-path-text');
    if (!text) {
      return;
    }

    marquee.classList.remove('is-overflowing');
    text.style.removeProperty('--root-path-scroll');
    text.style.removeProperty('--root-path-duration');

    const overflow = Math.ceil(text.scrollWidth - marquee.clientWidth);
    if (overflow <= 2) {
      return;
    }

    text.style.setProperty('--root-path-scroll', `${overflow}px`);
    text.style.setProperty('--root-path-duration', `${Math.min(18, Math.max(7, overflow / 18))}s`);
    marquee.classList.add('is-overflowing');
  });
}

function getVisibleColumns() {
  const orderedColumns = state.columnOrder
    .map((columnId) => columnsById.get(columnId))
    .filter(Boolean);
  const regularColumns = orderedColumns.filter((column) => !actionUrlColumnIds.has(column.id));
  const leftFrozenColumn = state.frozenColumnId && !actionUrlColumnIds.has(state.frozenColumnId)
    ? columnsById.get(state.frozenColumnId)
    : null;

  return [
    ...(leftFrozenColumn ? [leftFrozenColumn] : []),
    ...regularColumns.filter((column) => column.id !== leftFrozenColumn?.id),
  ];
}

function getSortOptions() {
  const columnOptions = tableColumns
    .filter((column) => column.sortable && state.columnOrder.includes(column.id));
  return [...columnOptions, ...extraSortOptions];
}

function clampColumnWidth(width) {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(Number(width) || 0)));
}

function getColumnWidth(columnId) {
  return clampColumnWidth(state.columnWidths[columnId] || DEFAULT_COLUMN_WIDTHS[columnId] || 120);
}

function getVisibleTableWidth() {
  return getVisibleColumns().reduce((total, column) => total + getColumnWidth(column.id), 0);
}

function renderColumnGroup() {
  const columns = getVisibleColumns();
  elements.projectColGroup.innerHTML = columns
    .map((column) => `<col style="width: ${getColumnWidth(column.id)}px" />`)
    .join('');
  elements.projectTable.style.width = `${Math.max(getVisibleTableWidth(), MIN_TABLE_WIDTH)}px`;
  elements.projectTable.style.setProperty('--project-actions-panel-width', `${Math.max(280, Math.floor(elements.tableWrap?.clientWidth || 0) - 24)}px`);
}

function compareValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  return String(left ?? '').localeCompare(String(right ?? ''), 'zh-Hant', {
    numeric: true,
    sensitivity: 'base',
  });
}

function sortedProjects(projects) {
  const sortOption = sortOptionsById.get(state.sortKey) || columnsById.get('name');
  const direction = state.sortDirection === 'desc' ? -1 : 1;

  return [...projects].sort((leftProject, rightProject) => {
    const primary = compareValues(sortOption.getSortValue(leftProject), sortOption.getSortValue(rightProject));
    if (primary !== 0) {
      return primary * direction;
    }

    if (state.sortKey === SOURCE_ORDER_SORT_ID) {
      const relativePath = compareValues(projectSourceRelativePath(leftProject), projectSourceRelativePath(rightProject));
      if (relativePath !== 0) {
        return relativePath;
      }
    }

    return compareValues(leftProject.name, rightProject.name);
  });
}

function saveTablePreferences() {
  try {
    writeLocalPreference(
      TABLE_PREFERENCES_KEY,
      JSON.stringify({
        sortKey: state.sortKey,
        sortDirection: state.sortDirection,
        columnOrder: state.columnOrder,
        frozenColumnId: state.frozenColumnId,
        columnWidths: state.columnWidths,
      }),
    );
  } catch (error) {
    // Sorting still works even if the browser blocks localStorage.
  }
}

function loadTablePreferences() {
  try {
    const preferences = JSON.parse(readLocalPreference(TABLE_PREFERENCES_KEY) || '{}');
    const sortableKeys = new Set([
      ...tableColumns
        .filter((column) => column.sortable && DEFAULT_COLUMN_ORDER.includes(column.id))
        .map((column) => column.id),
      ...extraSortOptions.map((option) => option.id),
    ]);
    const validColumnIds = new Set(DEFAULT_COLUMN_ORDER);

    if (sortableKeys.has(preferences.sortKey)) {
      state.sortKey = preferences.sortKey;
    }
    if (preferences.sortDirection === 'asc' || preferences.sortDirection === 'desc') {
      state.sortDirection = preferences.sortDirection;
    }
    if (Array.isArray(preferences.columnOrder)) {
      const ordered = preferences.columnOrder.filter((columnId) => validColumnIds.has(columnId));
      const missing = DEFAULT_COLUMN_ORDER.filter((columnId) => !ordered.includes(columnId));
      state.columnOrder = [...ordered, ...missing];
    }
    if (validColumnIds.has(preferences.frozenColumnId) && !actionUrlColumnIds.has(preferences.frozenColumnId)) {
      state.frozenColumnId = preferences.frozenColumnId;
    }
    if (preferences.columnWidths && typeof preferences.columnWidths === 'object') {
      state.columnWidths = Object.fromEntries(
        Object.entries(preferences.columnWidths)
          .filter(([columnId]) => validColumnIds.has(columnId))
          .map(([columnId, width]) => [columnId, clampColumnWidth(width)]),
      );
    }
  } catch (error) {
    state.columnOrder = [...DEFAULT_COLUMN_ORDER];
    state.frozenColumnId = null;
    state.columnWidths = {};
  }
}

function setSort(columnId) {
  const sortOption = sortOptionsById.get(columnId);
  if (!sortOption?.sortable) {
    return;
  }

  if (state.sortKey === columnId) {
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortKey = columnId;
    state.sortDirection = 'asc';
  }

  saveTablePreferences();
  render();
}

function cancelScheduledSort() {
  if (!state.sortClickTimer) {
    return;
  }

  window.clearTimeout(state.sortClickTimer);
  state.sortClickTimer = null;
}

function scheduleSort(columnId) {
  cancelScheduledSort();
  state.sortClickTimer = window.setTimeout(() => {
    state.sortClickTimer = null;
    setSort(columnId);
  }, 220);
}

function toggleFrozenColumn(columnId) {
  if (!state.columnOrder.includes(columnId) || actionUrlColumnIds.has(columnId)) {
    return;
  }

  const column = columnsById.get(columnId);
  if (state.frozenColumnId === columnId) {
    state.frozenColumnId = null;
    saveTablePreferences();
    showToast(`已取消凍結 ${column?.label || '欄位'}`);
    render();
    return;
  }

  state.frozenColumnId = columnId;
  state.columnOrder = [columnId, ...state.columnOrder.filter((id) => id !== columnId)];
  saveTablePreferences();
  showToast(`已凍結 ${column?.label || '欄位'} 到最左側`);
  render();
}

function moveColumnNear(sourceId, targetId, placeAfter) {
  if (!sourceId || sourceId === targetId || !state.columnOrder.includes(sourceId) || !state.columnOrder.includes(targetId)) {
    return;
  }
  if (sourceId === state.frozenColumnId || actionUrlColumnIds.has(sourceId)) {
    return;
  }

  const nextOrder = state.columnOrder.filter((columnId) => columnId !== sourceId);
  const targetIndex = nextOrder.indexOf(targetId);
  nextOrder.splice(targetIndex + (placeAfter ? 1 : 0), 0, sourceId);

  if (nextOrder.join('\n') === state.columnOrder.join('\n')) {
    return;
  }

  state.columnOrder = nextOrder;
  saveTablePreferences();
  render();
}

function suppressTableClick() {
  state.suppressNextTableClick = true;
  setTimeout(() => {
    state.suppressNextTableClick = false;
  }, 500);
}

function endColumnDrag({ suppressClick = false } = {}) {
  const wasActive = Boolean(state.columnDrag?.active);
  state.columnDrag = null;
  document.body.classList.remove('is-column-reordering');

  if (suppressClick || wasActive) {
    suppressTableClick();
  }

  if (wasActive) {
    render();
  }
}

function endColumnResize({ suppressClick = false } = {}) {
  const wasActive = Boolean(state.columnResize?.active);
  state.columnResize = null;
  document.body.classList.remove('is-column-resizing');

  if (suppressClick || wasActive) {
    suppressTableClick();
  }

  if (wasActive) {
    saveTablePreferences();
  }
}

function startColumnResize(event) {
  if (isMobileLayout()) {
    return;
  }

  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }

  const handle = event.target.closest('[data-resize-column]');
  const columnId = handle?.dataset.resizeColumn;
  if (!columnId || !state.columnOrder.includes(columnId)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  cancelScheduledSort();
  endColumnDrag({ suppressClick: true });
  state.columnResize = {
    active: false,
    columnId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: getColumnWidth(columnId),
  };
}

function startColumnReorder(event) {
  if (isMobileLayout()) {
    return;
  }

  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }
  if (state.columnResize || event.target.closest('[data-resize-column]')) {
    return;
  }

  const cell = event.target.closest('th[data-column], td[data-column]');
  const columnId = cell?.dataset.column;
  if (!columnId || !state.columnOrder.includes(columnId)) {
    return;
  }
  if (columnId === state.frozenColumnId || actionUrlColumnIds.has(columnId)) {
    return;
  }

  state.columnDrag = {
    active: false,
    columnId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
  };
}

function handleColumnDoubleClick(event) {
  if (isMobileLayout()) {
    return;
  }

  if (event.detail < 2) {
    return;
  }
  if (event.target.closest('[data-resize-column]')) {
    return;
  }
  if (event.target.closest('a.url-link')) {
    return;
  }

  const cell = event.target.closest('th[data-column], td[data-column]');
  const columnId = cell?.dataset.column;
  if (!columnId || !state.columnOrder.includes(columnId)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  cancelScheduledSort();
  endColumnDrag({ suppressClick: true });
  toggleFrozenColumn(columnId);
}

function handleColumnResizePointerMove(event) {
  const resize = state.columnResize;
  if (!resize || resize.pointerId !== event.pointerId) {
    return;
  }

  const deltaX = event.clientX - resize.startX;
  if (!resize.active && Math.abs(deltaX) < COLUMN_REORDER_MOVE_THRESHOLD) {
    return;
  }

  if (!resize.active) {
    resize.active = true;
    document.body.classList.add('is-column-resizing');
  }

  event.preventDefault();
  state.columnWidths = {
    ...state.columnWidths,
    [resize.columnId]: clampColumnWidth(resize.startWidth + deltaX),
  };
  renderColumnGroup();
}

function handleColumnPointerMove(event) {
  if (state.columnResize) {
    return;
  }

  const drag = state.columnDrag;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }

  const deltaX = Math.abs(event.clientX - drag.startX);
  const deltaY = Math.abs(event.clientY - drag.startY);

  if (!drag.active && deltaX < COLUMN_REORDER_MOVE_THRESHOLD) {
    return;
  }

  if (!drag.active) {
    if (deltaY > deltaX) {
      endColumnDrag();
      return;
    }

    drag.active = true;
    document.body.classList.add('is-column-reordering');
    render();
  }

  event.preventDefault();
  const targetCell = document.elementFromPoint(event.clientX, event.clientY)?.closest('th[data-column], td[data-column]');
  const targetId = targetCell?.dataset.column;
  if (!targetId || !state.columnOrder.includes(targetId)) {
    return;
  }

  const rect = targetCell.getBoundingClientRect();
  moveColumnNear(drag.columnId, targetId, event.clientX > rect.left + rect.width / 2);
}

function handleColumnPointerUp(event) {
  if (state.columnResize?.pointerId === event.pointerId) {
    endColumnResize({ suppressClick: state.columnResize.active });
    return;
  }

  if (state.columnDrag?.pointerId !== event.pointerId) {
    return;
  }

  endColumnDrag({ suppressClick: state.columnDrag.active });
}

function isMobileLayout() {
  return mobileLayoutMedia.matches;
}

function syncProjectPanelState(projects) {
  const projectNames = new Set(projects.map((project) => project.name));
  state.expandedProjectNames.forEach((projectName) => {
    if (!projectNames.has(projectName)) {
      state.expandedProjectNames.delete(projectName);
    }
  });
  state.expandedBranchNames.forEach((projectName) => {
    if (!projectNames.has(projectName)) {
      state.expandedBranchNames.delete(projectName);
    }
  });
  state.expandedPageNames.forEach((projectName) => {
    if (!projectNames.has(projectName)) {
      state.expandedPageNames.delete(projectName);
    }
  });

  if (!isMobileLayout() || state.projectPanelExpansionInitialized) {
    return;
  }

  state.expandedProjectNames.clear();
  state.projectPanelExpansionInitialized = true;
}

function alignMobileProjectTop() {
  if (!isMobileLayout() || state.mobileProjectTopAligned || !elements.mainPanel) {
    return;
  }

  state.mobileProjectTopAligned = true;
  window.requestAnimationFrame(() => {
    const topbarHeight = document.querySelector('.topbar')?.getBoundingClientRect().height || 0;
    const panelTop = elements.mainPanel.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: Math.max(0, Math.round(panelTop - topbarHeight)),
      behavior: 'auto',
    });
  });
}

function toggleProjectPanel(projectName) {
  if (!projectName) {
    return;
  }

  if (state.expandedProjectNames.has(projectName)) {
    state.expandedProjectNames.delete(projectName);
  } else {
    state.expandedProjectNames.add(projectName);
  }

  render();
}

function updateManagerConnectionLink(link, copyButton, value, label) {
  const hasUrl = Boolean(value);
  link.textContent = hasUrl ? value : '--';
  link.title = hasUrl ? value : `${label} 連結尚未就緒`;
  link.setAttribute('aria-disabled', hasUrl && !DEMO_MODE ? 'false' : 'true');
  link.classList.toggle('is-disabled', !hasUrl || DEMO_MODE);

  if (hasUrl && !DEMO_MODE) {
    link.href = value;
  } else {
    link.removeAttribute('href');
  }

  copyButton.disabled = DEMO_MODE || !hasUrl;
  copyButton.textContent = '複製';
  copyButton.title = hasUrl ? `複製 ${label} 連結` : `${label} 連結尚未就緒`;
  copyButton.setAttribute('aria-label', copyButton.title);
}

function render() {
  const payload = state.payload;
  if (!payload) {
    return;
  }

  const projects = sortedProjects(filteredProjects());
  syncProjectPanelState(projects);
  const runningCount = payload.projects.filter((project) => ['running', 'restarting', 'unhealthy'].includes(project.status)).length;

  elements.managerUrl.textContent = DEMO_MODE
    ? 'GitHub Pages 展示模式'
    : payload.manager.tailscaleUrl || payload.manager.lanUrl || payload.manager.localUrl || '管理介面尚未就緒';
  elements.tailscaleIp.textContent = payload.manager.tailscaleIp || '未連線';
  elements.runningCount.textContent = String(runningCount);
  elements.projectCount.textContent = `${payload.projects.length} 個`;
  syncRootPathsFromPayload(payload);
  if (document.activeElement !== elements.basePortInput) {
    elements.basePortInput.value = payload.config.basePort || 5173;
  }
  updateManagerConnectionLink(elements.managerLocalLink, elements.copyManagerLocal, payload.manager.localUrl, '本機');
  updateManagerConnectionLink(elements.managerLanLink, elements.copyManagerLan, payload.manager.lanUrl, 'LAN');
  updateManagerConnectionLink(elements.managerTailLink, elements.copyManagerTail, payload.manager.tailscaleUrl, 'Tailscale');
  if (document.activeElement !== elements.autoRestoreInput) {
    elements.autoRestoreInput.checked = payload.config.autoRestoreOnStartup !== false;
  }
  if (document.activeElement !== elements.autoRestartInput) {
    elements.autoRestartInput.checked = payload.config.health?.autoRestart === true;
  }
  if (document.activeElement !== elements.healthThresholdInput) {
    elements.healthThresholdInput.value = payload.config.health?.failureThreshold || 3;
  }
  elements.rootsInput.disabled = DEMO_MODE || state.discoverLoading;
  elements.addRootButton.disabled = DEMO_MODE || state.discoverLoading;
  if (elements.newRootButton) {
    elements.newRootButton.disabled = DEMO_MODE || state.discoverLoading;
  }
  elements.basePortInput.disabled = DEMO_MODE || state.discoverLoading;
  elements.copyManagerLocal.disabled = DEMO_MODE || !payload.manager.localUrl;
  elements.copyManagerLan.disabled = DEMO_MODE || !payload.manager.lanUrl;
  elements.copyManagerTail.disabled = DEMO_MODE || !payload.manager.tailscaleUrl;
  elements.autoRestoreInput.disabled = DEMO_MODE;
  elements.autoRestartInput.disabled = DEMO_MODE;
  elements.healthThresholdInput.disabled = DEMO_MODE;
  elements.lastUpdated.textContent = `更新 ${new Intl.DateTimeFormat('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date())}`;

  renderProfiles();
  renderSortControls();
  renderColumnGroup();
  renderHeader();
  renderRows(projects);
  alignMobileProjectTop();
}

function renderProfiles() {
  const profiles = getProfiles();
  const currentId = state.selectedProfileId;
  elements.profileSelect.innerHTML = [
    '<option value="">新增或選擇 Profile</option>',
    ...profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)} (${profile.projectNames.length})</option>`),
  ].join('');
  elements.profileSelect.value = profiles.some((profile) => profile.id === currentId) ? currentId : '';

  const profile = selectedProfile();
  if (!state.profileEditorDirty && document.activeElement !== elements.profileNameInput && document.activeElement !== elements.profileProjectsInput) {
    elements.profileNameInput.value = profile?.name || '';
    elements.profileProjectsInput.value = profile?.projectNames?.join('\n') || '';
  }

  const hasProfile = Boolean(profile);
  elements.profileSelect.disabled = DEMO_MODE;
  elements.profileNameInput.disabled = DEMO_MODE;
  elements.profileProjectsInput.disabled = DEMO_MODE;
  elements.useFilteredProjects.disabled = DEMO_MODE;
  elements.deleteProfileButton.disabled = DEMO_MODE || !hasProfile || state.profileBusy;
  elements.startProfileButton.disabled = DEMO_MODE || !hasProfile || state.profileBusy;
  elements.stopProfileButton.disabled = DEMO_MODE || !hasProfile || state.profileBusy;
  elements.restartProfileButton.disabled = DEMO_MODE || !hasProfile || state.profileBusy;
  elements.saveProfileButton.disabled = DEMO_MODE || state.profileBusy;
}

function renderSortControls() {
  elements.sortSelect.innerHTML = getSortOptions()
    .map((option) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`)
    .join('');
  if (!sortOptionsById.has(state.sortKey)) {
    state.sortKey = 'name';
  }
  elements.sortSelect.value = state.sortKey;
  elements.sortDirectionButton.textContent = state.sortDirection === 'asc' ? '↑' : '↓';
  elements.sortDirectionButton.setAttribute('aria-label', state.sortDirection === 'asc' ? '改為遞減排序' : '改為遞增排序');
}

function renderHeader() {
  elements.projectHeaderRow.innerHTML = getVisibleColumns()
    .map((column) => {
      const sorted = state.sortKey === column.id;
      const reordering = Boolean(state.columnDrag?.active && state.columnDrag.columnId === column.id);
      const frozen = state.frozenColumnId === column.id;
      const className = [column.className || '', sorted ? 'is-sorted' : '', reordering ? 'is-reorder-source' : '', frozen ? 'is-frozen-column' : '']
        .filter(Boolean)
        .join(' ');
      const freezeTitle = frozen ? '雙擊取消凍結欄位' : '雙擊凍結到最左側';
      const content = column.sortable
        ? `<button class="sort-header" data-sort="${escapeHtml(column.id)}" type="button" title="排序 ${escapeHtml(column.label)}，${freezeTitle}">${escapeHtml(column.label)}<span class="sort-indicator">${sorted ? (state.sortDirection === 'asc' ? '↑' : '↓') : ''}</span></button>`
        : escapeHtml(column.label);
      return `<th class="${escapeHtml(className)}" data-column="${escapeHtml(column.id)}" title="${escapeHtml(freezeTitle)}">${content}<span class="column-resize-handle" data-resize-column="${escapeHtml(column.id)}" role="separator" aria-orientation="vertical" title="拖曳調整欄寬"></span></th>`;
    })
    .join('');
}

function renderRows(projects) {
  const columns = getVisibleColumns();
  const actionsColumn = columnsById.get('actions');
  const mobileLayout = isMobileLayout();

  const activeElement = document.activeElement;
  const editingPort = activeElement && activeElement.matches?.('[data-port-input]')
    ? {
        name: activeElement.dataset.name,
        targetPath: activeElement.dataset.targetPath || '',
        value: activeElement.value,
      }
    : null;

  elements.projectRows.innerHTML = projects
    .map((project) => {
      const busy = state.busy.has(project.name) || state.mobileInstallBusyProject === project.name;
      const isSelected = project.name === state.selectedName;
      const projectPanelExpanded = !mobileLayout || state.expandedProjectNames.has(project.name);
      const panelClass = projectPanelExpanded ? 'is-panel-expanded' : 'is-panel-collapsed';
      const branchesExpanded = projectPanelExpanded && state.expandedBranchNames.has(project.name) && getProjectBranches(project).length > 0;
      const pagesExpanded = projectPanelExpanded && state.expandedPageNames.has(project.name) && getProjectPages(project).length > 0;
      const cells = columns
        .map((column) => {
          const frozen = state.frozenColumnId === column.id;
          const className = [column.className || '', frozen ? 'is-frozen-column' : '']
            .filter(Boolean)
            .join(' ');
          return `<td class="${escapeHtml(className)}" data-column="${escapeHtml(column.id)}">${column.render(project, { busy, branchesExpanded, pagesExpanded, projectPanelExpanded })}</td>`;
        })
        .join('');
      const selectedClass = isSelected ? 'is-selected' : '';
      return `
        <tr class="project-data-row ${selectedClass} ${panelClass}" data-name="${escapeHtml(project.name)}">${cells}</tr>
        ${renderProjectBranches(project, columns.length, branchesExpanded, selectedClass)}
        ${renderProjectPages(project, columns.length, pagesExpanded, selectedClass)}
        <tr class="project-actions-row ${selectedClass} ${panelClass}" data-actions-for="${escapeHtml(project.name)}">
          <td colspan="${columns.length}">
            <div class="project-row-actions-panel">
              ${actionsColumn.render(project, { busy })}
              ${renderProjectActionUrls(project)}
            </div>
          </td>
        </tr>
        ${renderProjectBackends(project, columns.length, projectPanelExpanded, selectedClass, { busy })}
      `;
    })
    .join('');

  if (editingPort?.name) {
    const targetSelector = editingPort.targetPath
      ? `input[data-port-input][data-name="${cssAttrValue(editingPort.name)}"][data-target-path="${cssAttrValue(editingPort.targetPath)}"]`
      : `input[data-port-input][data-name="${cssAttrValue(editingPort.name)}"]:not([data-target-path])`;
    const restored = elements.projectRows.querySelector(targetSelector)
      || elements.projectRows.querySelector(`input[data-port-input][data-name="${cssAttrValue(editingPort.name)}"]`);
    if (restored) {
      restored.value = editingPort.value;
      restored.focus();
    }
  }

  elements.emptyState.hidden = projects.length > 0;
}

async function runAction(name, action, options = {}) {
  if (DEMO_MODE) {
    showDemoNotice();
    return false;
  }

  if (action === 'terminal') {
    openTerminalManager(name);
    return true;
  }

  if (action === 'mobile-install') {
    await runMobileInstall(name);
    return true;
  }

  if (action === 'refresh') {
    return refreshProject(name);
  }

  const targetPath = String(options.targetPath || '').trim();
  state.busy.add(name);
  render();

  try {
    state.payload = await api(`/api/projects/${encodeURIComponent(name)}/${action}`, {
      method: 'POST',
      body: JSON.stringify(targetPath ? { targetPath } : {}),
    });
    state.selectedName = name;
    showToast(actionMessage(action));
    render();
    if (action !== 'stop') {
      setTimeout(() => loadStatus({ silent: true }), 1200);
    }
    return true;
  } catch (error) {
    showToast(error.message);
    return false;
  } finally {
    state.busy.delete(name);
    render();
  }
}

async function commitProjectPort(name, rawValue, explicitTargetPath = '') {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  const project = state.payload?.projects.find((item) => item.name === name);
  const pinnedTarget = String(explicitTargetPath || '').trim();
  const backend = pinnedTarget
    ? getProjectBackends(project).find((item) => String(item.path || '').toLowerCase() === pinnedTarget.toLowerCase())
    : null;
  const currentTarget = backend || project;
  const port = Number(rawValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    showToast('Port 需介於 1-65535');
    render();
    return;
  }

  if (currentTarget && Number(currentTarget.port) === port) {
    return;
  }

  try {
    // For a backend item the port belongs to its branch; for a marker row it belongs
    // to the promoted web branch (derivedHome). Pin the edit to that branch so the
    // server updates the right project even with multiple branches.
    const targetPath = pinnedTarget
      || (project?.hasWebTarget === false ? project?.derivedHome?.path || '' : '');
    state.payload = await api(`/api/projects/${encodeURIComponent(name)}/port`, {
      method: 'POST',
      body: JSON.stringify(targetPath ? { port, targetPath } : { port }),
    });
    state.selectedName = name;
    const updated = state.payload?.projects.find((item) => item.name === name);
    showToast(projectIsManagedRunning(updated) ? '已更新 port（重啟後生效）' : '已更新 port');
    render();
  } catch (error) {
    showToast(error.message);
    loadStatus({ silent: true });
  }
}

function actionMessage(action) {
  const messages = {
    start: '已送出啟動',
    stop: '已停止',
    restart: '已重啟',
    tailscale: '已啟用 Tailscale',
  };

  return messages[action] || '已完成';
}

async function openRootFolder(rootPath) {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  const path = String(rootPath || '').trim();
  if (!path) {
    showToast('\u627e\u4e0d\u5230\u5c08\u6848\u4f86\u6e90');
    return;
  }

  try {
    await api('/api/roots/open-folder', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    showToast('\u5df2\u958b\u555f\u5c08\u6848\u4f86\u6e90');
  } catch (error) {
    showToast(error.message);
  }
}

// Create a brand-new project folder under Documents\app (with .git + .github via the
// server), add it to the project sources, and refresh. Returns the created project's
// name, or null when the user cancels or it fails.
async function createNewProject({ defaultName = '' } = {}) {
  if (DEMO_MODE) {
    showDemoNotice();
    return null;
  }

  const input = window.prompt(
    '輸入新專案名稱\n會在 C:\\Users\\user\\Documents\\app 建立資料夾,並生成 .git 與 .github。',
    defaultName,
  );
  if (input === null) {
    return null;
  }
  const name = input.trim();
  if (!name) {
    showToast('請輸入專案名稱');
    return null;
  }

  try {
    const payload = await api('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    state.rootEditorDirty = false;
    state.payload = payload;
    const createdName = payload.created?.name || name;
    if (!state.selectedName) {
      state.selectedName = createdName;
    }
    render();
    if (state.terminalModalOpen) {
      renderTerminalModal();
    }
    showToast(payload.created?.gitInitialized === false
      ? `已建立專案「${createdName}」(git init 未完成,請手動初始化)`
      : `已建立專案「${createdName}」`);
    return createdName;
  } catch (error) {
    showToast(error.message);
    return null;
  }
}

async function discover({ commitDraft = true, includeDraft = true, showToastOnSuccess = true, clean = false } = {}) {
  if (DEMO_MODE) {
    showDemoNotice();
    return false;
  }

  if (state.discoverLoading) {
    return false;
  }

  state.discoverLoading = true;
  render();
  try {
    if (commitDraft) {
      commitRootInput();
    }
    const roots = includeDraft ? readRootPathsForDiscover() : normalizeRootPaths(state.rootPaths);
    const basePort = Number(elements.basePortInput.value || state.payload?.config?.basePort || 5173);
    state.payload = await api('/api/discover', {
      method: 'POST',
      body: JSON.stringify({ roots, basePort, clean }),
    });
    state.rootPaths = normalizeRootPaths(state.payload.config.defaultRoots || roots);
    state.rootEditorDirty = false;
    renderRootList();
    if (!state.selectedName && state.payload.projects.length) {
      state.selectedName = state.payload.projects[0].name;
    }
    if (showToastOnSuccess) {
      showToast('掃描完成');
    }
    render();
    return true;
  } catch (error) {
    showToast(error.message);
    return false;
  } finally {
    state.discoverLoading = false;
    render();
  }
}

async function forceRescan() {
  if (DEMO_MODE) {
    showDemoNotice();
    return false;
  }

  const scanned = await discover({
    commitDraft: false,
    includeDraft: false,
    showToastOnSuccess: false,
    clean: true,
  });
  if (!scanned) {
    return false;
  }

  await loadStatus({ silent: true });
  showToast('已清理並重新掃描整個資料夾');
  return true;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Dispatch for the header 重啟 dropdown.
function runRestartMenuAction(action) {
  if (action === 'all-servers') {
    return restartAllProjectServers();
  }
  if (action === 'all-terminals') {
    return restartAllProjectTerminals();
  }
  if (action === 'atm') {
    return restartAtmServer();
  }
  if (action === 'atm-terminal') {
    return restartAtmTerminals();
  }
}

// 重啟所有專案 server(含 ATM):先清理重掃(讓新專案/程式碼變更生效),記住目前
// 執行中的 server 與終端,再重啟 ATM 本身。ATM 重新啟動後會自動還原這些服務。
async function restartAllProjectServers() {
  const scanned = await forceRescan();
  if (!scanned) {
    return;
  }
  await restartAtmServer({
    confirmMessage: '重啟所有專案 server(含 ATM)會關閉所有開發伺服器與終端後重新啟動並還原,確定要繼續嗎?',
  });
}

// 重啟所有專案終端(含 ATM):關閉每個正在執行的終端 pty,再以相同 shell/目錄重新
// 開啟。不會重啟 ATM 本身。
async function restartAllProjectTerminals() {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }
  const confirmed = window.confirm('重啟所有專案終端(含 ATM)會關閉並重新開啟所有正在執行的終端,確定要繼續嗎?');
  if (!confirmed) {
    return;
  }

  await loadTerminalSessions({ silent: true });
  const liveLocalIds = (state.terminalSessions || [])
    .filter((session) => session.id && !session.readOnly && session.localId)
    .map((session) => session.localId);
  if (!liveLocalIds.length) {
    showToast('沒有正在執行的終端可重啟');
    return;
  }

  showToast('正在重啟所有終端…');
  let restarted = 0;
  for (const localId of liveLocalIds) {
    try {
      await restartTerminalSessionByLocalId(localId);
      restarted += 1;
    } catch (error) {
      // Best-effort per terminal; keep going.
    }
  }
  await loadTerminalSessions({ silent: true });
  if (state.terminalModalOpen) {
    renderTerminalModal();
  } else {
    render();
  }
  showToast(`已重啟 ${restarted} 個終端`);
}

// 重啟 ATM 終端:只關閉並重新開啟 ATM (本機) 的終端 pty,不重啟 ATM server。
// 與「重啟 ATM server」分開,讓使用者能在不重啟整個 ATM 的情況下重整 ATM 終端。
async function restartAtmTerminals() {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  const atmName = atmTerminalProject()?.name || ATM_TERMINAL_PROJECT_NAME;
  await loadTerminalSessions({ silent: true });
  const liveLocalIds = (state.terminalSessions || [])
    .filter((session) => session.id && !session.readOnly && session.localId
      && session.projectName === atmName)
    .map((session) => session.localId);
  if (!liveLocalIds.length) {
    showToast('沒有正在執行的 ATM 終端可重啟');
    return;
  }

  const confirmed = window.confirm('重啟 ATM 終端會關閉並重新開啟 ATM 終端,確定要繼續嗎?');
  if (!confirmed) {
    return;
  }

  showToast('正在重啟 ATM 終端…');
  let restarted = 0;
  for (const localId of liveLocalIds) {
    try {
      await restartTerminalSessionByLocalId(localId);
      restarted += 1;
    } catch (error) {
      // Best-effort per terminal; keep going.
    }
  }
  await loadTerminalSessions({ silent: true });
  if (state.terminalModalOpen) {
    renderTerminalModal();
  } else {
    render();
  }
  showToast(`已重啟 ${restarted} 個 ATM 終端`);
}

// Kill a session's live server pty and spawn a fresh one with the same shell/cwd,
// reusing the same tab (localId) so no duplicate tabs appear.
async function restartTerminalSessionByLocalId(localId) {
  const session = findTerminalSession(localId);
  if (!session || session.readOnly) {
    return;
  }
  if (session.id) {
    try {
      await api(`/api/terminals/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
      state.terminalWorkspaceMetaBySessionId.delete(session.id);
    } catch (error) {
      // Even if the close call fails, the spawn below still opens a fresh session.
    }
    session.id = null;
    session.running = false;
    session.interactive = false;
    session.cursor = 0;
    session.output = '';
  }
  await spawnTerminalSessionPty(session);
}

// POST /api/terminals to open a fresh shell for an existing (draft) session object.
async function spawnTerminalSessionPty(session) {
  const options = terminalOptionsForProject(session.projectName);
  const cwd = selectedTerminalCwd(session, options);
  const shellId = selectedTerminalShellId(session, options);
  const payload = await api('/api/terminals', {
    method: 'POST',
    body: JSON.stringify({
      name: session.projectName,
      command: '',
      cwd,
      shellId,
      cols: session.cols,
      rows: session.rows,
    }),
  });
  applyTerminalPayload(session, payload);
  saveTerminalWorkspaceState();
  return session;
}

async function restartAtmServer({ confirmMessage } = {}) {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  const confirmed = window.confirm(confirmMessage
    || '重啟 ATM 伺服器會關閉所有開發伺服器與終端後重新啟動,確定要繼續嗎?');
  if (!confirmed) {
    return;
  }

  // Remember everything currently running so the freshly launched ATM can bring the
  // same servers and terminals back (see applyAtmResumeSnapshot on startup).
  saveAtmResumeSnapshot(captureAtmResumeSnapshot());

  try {
    await api('/api/restart', { method: 'POST' });
  } catch (error) {
    // The connection usually drops as the server exits — that's expected, the
    // replacement is already launching.
  }
  showToast('正在重啟 ATM 伺服器…');
  await waitForAtmServer();
}

// ---------------------------------------------------------------------------
// ATM restart memory: snapshot which servers and terminals are running before an
// ATM restart, persist it across the page reload, then restore them once the new
// ATM is up.
// ---------------------------------------------------------------------------
const ATM_RESUME_KEY = 'atm-resume-snapshot';
const ATM_RESUME_MAX_AGE_MS = 5 * 60 * 1000;

function captureAtmResumeSnapshot() {
  const projects = state.payload?.projects || [];
  const servers = [];
  for (const project of projects) {
    if (projectIsManagedRunning(project)) {
      servers.push({
        name: project.name,
        targetPath: '',
        tailscaleMode: Boolean(project.tailscaleMode),
      });
    }
    for (const backend of getProjectBackends(project)) {
      if (projectIsManagedRunning(backend)) {
        servers.push({ name: project.name, targetPath: backend.path || '', tailscaleMode: false });
      }
    }
  }

  // Live terminal sessions become relaunchable drafts (same localId) after the reload,
  // so localId is a stable key for reviving exactly those tabs.
  const terminals = (state.terminalSessions || [])
    .filter((session) => session.id && !session.readOnly && session.localId)
    .map((session) => ({ localId: session.localId, projectName: session.projectName }));

  return { servers, terminals, at: Date.now() };
}

function saveAtmResumeSnapshot(snapshot) {
  try {
    writeLocalPreference(ATM_RESUME_KEY, JSON.stringify(snapshot));
  } catch (error) {
    // Resume is best-effort; ignore storage failures.
  }
}

function readAtmResumeSnapshot() {
  try {
    const raw = readLocalPreference(ATM_RESUME_KEY);
    if (!raw) {
      return null;
    }
    const snapshot = JSON.parse(raw);
    if (!snapshot || Date.now() - Number(snapshot.at || 0) > ATM_RESUME_MAX_AGE_MS) {
      return null;
    }
    return snapshot;
  } catch (error) {
    return null;
  }
}

function clearAtmResumeSnapshot() {
  try {
    removeLocalPreference(ATM_RESUME_KEY);
  } catch (error) {
    // Ignore.
  }
}

async function applyAtmResumeSnapshot() {
  if (DEMO_MODE) {
    return;
  }
  const snapshot = readAtmResumeSnapshot();
  if (!snapshot) {
    return;
  }
  clearAtmResumeSnapshot();

  let restoredServers = 0;
  for (const server of snapshot.servers || []) {
    const project = state.payload?.projects.find((item) => item.name === server.name);
    if (!project) {
      continue;
    }
    const targetPath = String(server.targetPath || '').trim();
    const target = targetPath
      ? getProjectBackends(project).find((item) => String(item.path || '').toLowerCase() === targetPath.toLowerCase())
      : project;
    if (!target || projectIsManagedRunning(target)) {
      continue;
    }

    const action = server.tailscaleMode ? 'tailscale' : 'start';
    try {
      await api(`/api/projects/${encodeURIComponent(server.name)}/${action}`, {
        method: 'POST',
        body: JSON.stringify(targetPath ? { targetPath } : {}),
      });
      restoredServers += 1;
    } catch (error) {
      // Skip a server that won't come back; restore the rest.
    }
  }
  if (restoredServers) {
    await loadStatus({ silent: true });
  }

  let restoredTerminals = 0;
  for (const terminal of snapshot.terminals || []) {
    const session = terminal.localId ? findTerminalSession(terminal.localId) : null;
    if (!session || session.id || session.readOnly) {
      continue;
    }
    try {
      await spawnTerminalSessionPty(session);
      restoredTerminals += 1;
    } catch (error) {
      // Tab stays as a relaunchable draft if the shell can't be respawned.
    }
  }

  if (restoredServers || restoredTerminals) {
    if (state.terminalModalOpen) {
      renderTerminalModal();
    } else {
      render();
    }
    showToast(`已還原 ${restoredServers} 個 server、${restoredTerminals} 個終端`);
  }
}

// Poll /api/status until the freshly launched server answers, then reload so the
// UI re-syncs with it.
async function waitForAtmServer() {
  const deadline = Date.now() + 90000;
  // Give the old instance a moment to release the port before we start polling.
  await delay(2000);
  while (Date.now() < deadline) {
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      if (response.ok) {
        showToast('ATM 伺服器已重啟,重新載入頁面…');
        await delay(700);
        window.location.reload();
        return;
      }
    } catch (error) {
      // Server is still coming back up.
    }
    await delay(1200);
  }
  showToast('ATM 伺服器重啟逾時,請手動重新整理頁面。');
}

async function refreshProject(name) {
  if (DEMO_MODE) {
    showDemoNotice();
    return false;
  }

  state.selectedName = name;
  state.busy.add(name);
  render();

  try {
    // Tear down old terminal/agent processes for this project before re-reading it.
    const closed = await closeProjectTerminalSessions(name);

    const scanned = await discover({
      commitDraft: false,
      includeDraft: false,
      showToastOnSuccess: false,
      clean: true,
    });
    if (!scanned) {
      return false;
    }

    await loadStatus({ silent: true });
    if (state.payload?.projects.some((project) => project.name === name)) {
      state.selectedName = name;
    }
    showToast(closed ? `已關閉 ${closed} 個終端並重新整理` : '已掃描並重新整理');
    render();
    return true;
  } finally {
    state.busy.delete(name);
    render();
  }
}

async function updateSettings() {
  if (DEMO_MODE) {
    showDemoNotice();
    render();
    return;
  }

  try {
    state.payload = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        autoRestoreOnStartup: elements.autoRestoreInput.checked,
        health: {
          autoRestart: elements.autoRestartInput.checked,
          failureThreshold: Number(elements.healthThresholdInput.value || 3),
        },
      }),
    });
    showToast('設定已儲存');
    render();
  } catch (error) {
    showToast(error.message);
    loadStatus({ silent: true });
  }
}

function fillProfileEditor(profile) {
  elements.profileNameInput.value = profile?.name || '';
  elements.profileProjectsInput.value = profile?.projectNames?.join('\n') || '';
  state.profileEditorDirty = false;
}

function parseProfileProjectNames() {
  return elements.profileProjectsInput.value
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

async function saveProfile() {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  const name = elements.profileNameInput.value.trim();
  const projectNames = parseProfileProjectNames();

  if (!name) {
    showToast('請輸入 Profile 名稱');
    return;
  }
  if (!projectNames.length) {
    showToast('請至少加入一個專案');
    return;
  }

  state.profileBusy = true;
  renderProfiles();
  try {
    const previousId = state.selectedProfileId;
    state.payload = await api('/api/profiles', {
      method: 'POST',
      body: JSON.stringify({
        id: previousId || undefined,
        name,
        projectNames,
      }),
    });
    const saved = getProfiles().find((profile) => profile.id === previousId) || getProfiles().find((profile) => profile.name === name);
    state.selectedProfileId = saved?.id || '';
    state.profileEditorDirty = false;
    showToast('Profile 已儲存');
    render();
  } catch (error) {
    showToast(error.message);
  } finally {
    state.profileBusy = false;
    renderProfiles();
  }
}

async function deleteProfile() {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  const profile = selectedProfile();
  if (!profile) {
    return;
  }

  state.profileBusy = true;
  renderProfiles();
  try {
    state.payload = await api(`/api/profiles/${encodeURIComponent(profile.id)}`, {
      method: 'DELETE',
    });
    state.selectedProfileId = '';
    state.profileEditorDirty = false;
    fillProfileEditor(null);
    showToast('Profile 已刪除');
    render();
  } catch (error) {
    showToast(error.message);
  } finally {
    state.profileBusy = false;
    renderProfiles();
  }
}

async function runProfileAction(action) {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  const profile = selectedProfile();
  if (!profile) {
    showToast('請先選擇 Profile');
    return;
  }

  state.profileBusy = true;
  renderProfiles();
  try {
    state.payload = await api(`/api/profiles/${encodeURIComponent(profile.id)}/${action}`, {
      method: 'POST',
      body: '{}',
    });
    showToast(action === 'start' ? 'Profile 已啟動' : action === 'stop' ? 'Profile 已停止' : 'Profile 已重啟');
    render();
    if (action !== 'stop') {
      setTimeout(() => loadStatus({ silent: true }), 1200);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    state.profileBusy = false;
    renderProfiles();
  }
}

function renderMobileInstallLog(payload) {
  const lines = [];
  if (payload.error) {
    lines.push(`Build + APK 失敗：${payload.error}`);
  } else if (payload.ok) {
    lines.push(`Build + APK 完成：${payload.project}`);
    lines.push(`裝置：${payload.device || 'default adb device'}`);
    lines.push(`APK：${payload.relativeApk || payload.apk || '(unknown)'}`);
  }
  if (payload.log) {
    lines.push('');
    lines.push(payload.log);
  }

  renderLogText(lines.join('\n') || 'Build + APK 沒有輸出。');
  state.mobileInstallLogHoldUntil = Date.now() + 120000;
}

async function runMobileInstall(name) {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  if (!name || state.mobileInstallBusyProject) {
    return;
  }

  state.selectedName = name;
  state.mobileInstallBusyProject = name;
  render();
  renderLogText(`Build + APK 執行中：${name}\n這可能需要幾分鐘。`);
  state.mobileInstallLogHoldUntil = Date.now() + 120000;

  try {
    const payload = await api(`/api/projects/${encodeURIComponent(name)}/mobile-install`, {
      method: 'POST',
      body: '{}',
    });
    renderMobileInstallLog(payload);
    showToast('Build + APK 完成');
  } catch (error) {
    renderMobileInstallLog(error.payload || { error: error.message });
    showToast(error.message || 'Build + APK 失敗');
  } finally {
    state.mobileInstallBusyProject = null;
    render();
  }
}

function useCurrentFilteredProjects() {
  const names = sortedProjects(filteredProjects()).map((project) => project.name);
  elements.profileProjectsInput.value = names.join('\n');
  if (!elements.profileNameInput.value.trim()) {
    elements.profileNameInput.value = state.filter === 'all' ? '全部專案' : `${statusLabel(state.filter)}專案`;
  }
  state.profileEditorDirty = true;
}

// The Log 面板 follows whichever project is highlighted (selected) in the main table,
// falling back to the first project.
function logViewProject() {
  const projects = state.payload?.projects || [];
  const name = (state.selectedName && projects.some((project) => project.name === state.selectedName))
    ? state.selectedName
    : projects[0]?.name || null;
  return projects.find((project) => project.name === name) || null;
}

async function loadLogs({ silent = false } = {}) {
  const project = logViewProject();
  if (!project) {
    if (!silent) {
      renderLogText('選擇專案後會顯示最近的 stdout/stderr。');
    }
    return;
  }

  if (silent && (state.mobileInstallBusyProject || Date.now() < state.mobileInstallLogHoldUntil)) {
    return;
  }

  if (!silent) {
    state.logText = '';
    elements.logOutput.textContent = '讀取中...';
  }

  try {
    const logs = await api(`/api/logs?name=${encodeURIComponent(project.name)}&lines=240`);
    const sections = [];
    if (logs.stdout) {
      sections.push(`stdout\n${logs.stdout}`);
    }
    if (logs.stderr) {
      sections.push(`stderr\n${logs.stderr}`);
    }
    renderLogText(sections.join('\n\n') || '目前沒有 log。');
  } catch (error) {
    state.logText = '';
    elements.logOutput.textContent = error.message;
  }
}

function renderLogText(text) {
  state.logText = text;
  elements.logOutput.innerHTML = text
    .split(/\r?\n/)
    .map((line) => {
      const className = ['log-line', logLineTone(line)].filter(Boolean).join(' ');
      return `<span class="${className}">${escapeHtml(line) || ' '}</span>`;
    })
    .join('\n');
}

async function copyLogs() {
  const project = logViewProject();
  const header = project ? `# ${project.name}\n` : '';
  const body = state.logText && state.logText.trim() ? state.logText : '';
  if (!body) {
    showToast('沒有可複製的 log');
    return;
  }
  await copyText(`${header}${body}`);
}

function logLineTone(line) {
  if (/error|failed|failure|exception|eaddrinuse|eacces|enoent|elifecycle|npm err|stack trace/i.test(line)) {
    return 'error';
  }
  if (/warn|warning|deprecated/i.test(line)) {
    return 'warning';
  }
  if (/ready|running|started|local:|network:|localhost|http:\/\/127\.0\.0\.1/i.test(line)) {
    return 'ok';
  }

  return '';
}

function readTerminalWorkspaceState() {
  try {
    const raw = readLocalPreference(TERMINAL_WORKSPACE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function hasTerminalPreferenceLocalState() {
  try {
    return readLocalPreference(TERMINAL_FAVORITES_KEY) !== null
      || readLocalPreference(TERMINAL_WORKSPACE_KEY) !== null;
  } catch {
    return false;
  }
}

function normalizeTerminalWorkspaceSession(session, index = 0) {
  const id = String(session?.id || '').replace(/\0/g, '').slice(0, 128);
  const localId = String(session?.localId || '').replace(/\0/g, '').slice(0, 128) || (id ? `server-${id}` : `draft-${index + 1}`);
  const projectName = String(session?.projectName || '').replace(/\0/g, '').slice(0, 240);
  if (!projectName) {
    return null;
  }

  return {
    id: id || null,
    localId,
    projectName,
    title: String(session?.title || '').replace(/\0/g, '').slice(0, 120),
    titleEdited: session?.titleEdited === true,
    input: String(session?.input || '').replace(/\0/g, '').slice(0, TERMINAL_PREFERENCE_TEXT_LIMIT),
    cwdRelativePath: String(session?.cwdRelativePath || '').replace(/\0/g, '').slice(0, 1000),
    shellId: String(session?.shellId || '').replace(/\0/g, '').slice(0, 64),
  };
}

function createTerminalSessionFromMetadata(meta) {
  return {
    localId: meta.localId,
    id: meta.id || null,
    projectName: meta.projectName,
    title: meta.title || `${meta.projectName || 'Terminal'} terminal`,
    titleEdited: meta.titleEdited === true,
    input: meta.input || '',
    output: '',
    cursor: 0,
    cols: 100,
    rows: 28,
    cwd: '',
    cwdRelativePath: meta.cwdRelativePath,
    shellId: meta.shellId || '',
    shellLabel: '',
    projectPort: null,
    projectLocalUrl: '',
    running: false,
    interactive: false,
    readOnly: false,
    exitedAt: null,
    exitCode: null,
    exitSignal: null,
    busy: false,
  };
}

function restoreTerminalWorkspaceState(workspace = readTerminalWorkspaceState(), { replace = false } = {}) {
  if (typeof workspace.activeProjectName === 'string') {
    state.terminalProjectName = workspace.activeProjectName || null;
  } else if (replace) {
    state.terminalProjectName = null;
  }
  if (typeof workspace.activeSessionId === 'string') {
    state.terminalActiveSessionId = workspace.activeSessionId || null;
  } else if (replace) {
    state.terminalActiveSessionId = null;
  }
  if (workspace.activeSessionIdsByProject && typeof workspace.activeSessionIdsByProject === 'object') {
    state.terminalActiveSessionByProject = new Map(
      Object.entries(workspace.activeSessionIdsByProject)
        .filter(([projectName, localId]) => projectName && typeof localId === 'string'),
    );
  } else if (replace) {
    state.terminalActiveSessionByProject = new Map();
  }
  if (Array.isArray(workspace.sessions)) {
    const sessions = workspace.sessions
      .map((session, index) => normalizeTerminalWorkspaceSession(session, index))
      .filter(Boolean);
    state.terminalWorkspaceMetaBySessionId = new Map(sessions
      .filter((session) => session.id)
      .map((session) => [session.id, session]));

    if (replace) {
      state.terminalSessions = [];
    }

    const currentLocalIds = new Set(state.terminalSessions.map((session) => session.localId));
    sessions.forEach((session) => {
      const existing = state.terminalSessions.find((item) => item.localId === session.localId);
      if (existing) {
        existing.id = session.id || existing.id;
        existing.projectName = session.projectName;
        existing.title = session.title || existing.title;
        existing.titleEdited = session.titleEdited === true;
        existing.input = session.input || '';
        existing.cwdRelativePath = session.cwdRelativePath;
        existing.shellId = session.shellId || existing.shellId;
      } else {
        state.terminalSessions.push(createTerminalSessionFromMetadata(session));
        currentLocalIds.add(session.localId);
      }
    });
  } else if (replace) {
    state.terminalWorkspaceMetaBySessionId = new Map();
    state.terminalSessions = [];
  }
}

function terminalSessionMetadata(session) {
  return {
    id: session.id || null,
    localId: session.localId,
    projectName: session.projectName,
    title: session.title || '',
    titleEdited: session.titleEdited === true,
    input: session.input || '',
    cwdRelativePath: session.cwdRelativePath,
    shellId: session.shellId || '',
  };
}

function buildTerminalWorkspaceState() {
  const currentSessionMeta = state.terminalSessions
    .filter((session) => !session.readOnly)
    .map((session) => terminalSessionMetadata(session))
    .filter((session) => session.localId && session.projectName);
  const readOnlyKeys = new Set(state.terminalSessions
    .filter((session) => session.readOnly)
    .flatMap((session) => [
      session.id ? `id:${session.id}` : '',
      session.localId ? `local:${session.localId}` : '',
    ])
    .filter(Boolean));
  const sessionsByKey = new Map();
  state.terminalWorkspaceMetaBySessionId.forEach((session) => {
    const key = session.id ? `id:${session.id}` : `local:${session.localId}`;
    if (!readOnlyKeys.has(key)) {
      sessionsByKey.set(key, session);
    }
  });
  currentSessionMeta.forEach((session) => {
    const key = session.id ? `id:${session.id}` : `local:${session.localId}`;
    sessionsByKey.set(key, session);
  });
  const sessions = [...sessionsByKey.values()];

  const sessionLocalIds = new Set(sessions.map((session) => session.localId));
  const sessionProjectNames = new Set(sessions.map((session) => session.projectName));
  const activeProjectName = sessionProjectNames.has(state.terminalProjectName)
    ? state.terminalProjectName
    : sessions[0]?.projectName || '';
  const activeSessionId = sessionLocalIds.has(state.terminalActiveSessionId)
    ? state.terminalActiveSessionId
    : sessions.find((session) => session.projectName === activeProjectName)?.localId || '';
  const activeSessionIdsByProject = {};
  state.terminalActiveSessionByProject.forEach((localId, projectName) => {
    if (projectName && sessionProjectNames.has(projectName) && sessionLocalIds.has(localId)) {
      activeSessionIdsByProject[projectName] = localId;
    }
  });

  return {
    activeProjectName,
    activeSessionId,
    activeSessionIdsByProject,
    sessions,
  };
}

function saveTerminalWorkspaceState({ sync = true } = {}) {
  const workspace = buildTerminalWorkspaceState();
  try {
    if (!workspace.sessions.length) {
      removeLocalPreference(TERMINAL_WORKSPACE_KEY);
    } else {
      writeLocalPreference(TERMINAL_WORKSPACE_KEY, JSON.stringify(workspace));
    }
  } catch {
    // Terminal workspace state is best-effort; running shells remain server-side.
  }

  const shouldSync = sync && (
    workspace.sessions.length
    || state.terminalPreferencesSaved
    || hasTerminalPreferenceLocalState()
  );
  if (shouldSync) {
    scheduleTerminalPreferencesSave();
  } else if (sync) {
    window.clearTimeout(terminalPreferencesSaveTimer);
  }
}

function rememberTerminalActiveSession(projectName = state.terminalProjectName, localId = state.terminalActiveSessionId) {
  if (projectName && localId) {
    state.terminalActiveSessionByProject.set(projectName, localId);
  }
}

function terminalSessionsForProject(projectName = state.terminalProjectName) {
  return state.terminalSessions.filter((session) => session.projectName === projectName);
}

function startedTerminalSessionsForProject(projectName = state.terminalProjectName) {
  return terminalSessionsForProject(projectName).filter((session) => session.id);
}

function findTerminalSession(localId) {
  return state.terminalSessions.find((session) => session.localId === localId) || null;
}

function findTerminalSessionByServerId(id) {
  return state.terminalSessions.find((session) => session.id === id) || null;
}

function createTerminalSessionFromSnapshot(snapshot, meta = {}) {
  const title = meta.title || `${snapshot.projectName || 'Terminal'} terminal`;
  return {
    localId: meta.localId || `server-${snapshot.id}`,
    id: snapshot.id,
    projectName: snapshot.projectName,
    title,
    titleEdited: meta.titleEdited === true,
    input: meta.input || '',
    output: snapshot.output || '',
    cursor: Number(snapshot.cursor || 0),
    cols: Number(snapshot.cols || 100),
    rows: Number(snapshot.rows || 28),
    cwd: snapshot.cwd || '',
    cwdRelativePath: meta.cwdRelativePath,
    shellId: meta.shellId || snapshot.shellId || '',
    shellLabel: snapshot.shellLabel || '',
    projectPort: snapshot.projectPort || null,
    projectLocalUrl: snapshot.projectLocalUrl || '',
    running: snapshot.running === true,
    interactive: snapshot.interactive === true,
    readOnly: snapshot.readOnly === true,
    exitedAt: snapshot.exitedAt || null,
    exitCode: snapshot.exitCode ?? null,
    exitSignal: snapshot.exitSignal ?? null,
    busy: false,
  };
}

function mergeTerminalSessionSnapshot(snapshot) {
  if (!snapshot?.id) {
    return null;
  }

  const meta = state.terminalWorkspaceMetaBySessionId.get(snapshot.id) || {};
  let session = findTerminalSessionByServerId(snapshot.id);
  if (!session) {
    session = createTerminalSessionFromSnapshot(snapshot, meta);
    state.terminalSessions.push(session);
  } else {
    session.projectName = snapshot.projectName || session.projectName;
    session.projectPort = snapshot.projectPort || session.projectPort;
    session.projectLocalUrl = snapshot.projectLocalUrl || session.projectLocalUrl;
    session.cwd = snapshot.cwd || session.cwd;
    session.shellId = session.shellId || meta.shellId || snapshot.shellId || '';
    session.shellLabel = snapshot.shellLabel || session.shellLabel;
    session.output = snapshot.output || '';
    session.cursor = Number(snapshot.cursor || session.cursor || 0);
    session.cols = Number(snapshot.cols || session.cols || 100);
    session.rows = Number(snapshot.rows || session.rows || 28);
    session.running = snapshot.running === true;
    session.interactive = snapshot.interactive === true;
    session.readOnly = snapshot.readOnly === true;
    session.exitedAt = snapshot.exitedAt || null;
    session.exitCode = snapshot.exitCode ?? null;
    session.exitSignal = snapshot.exitSignal ?? null;
    session.input = session.input || meta.input || '';
    if (!session.titleEdited && meta.title) {
      session.title = meta.title;
      session.titleEdited = meta.titleEdited === true;
    }
  }

  if (session.readOnly) {
    state.terminalWorkspaceMetaBySessionId.delete(snapshot.id);
  } else {
    state.terminalWorkspaceMetaBySessionId.set(snapshot.id, terminalSessionMetadata(session));
  }
  return session;
}

async function loadTerminalSessions({ silent = false } = {}) {
  try {
    const payload = await api('/api/terminals');
    const snapshots = Array.isArray(payload.sessions) ? payload.sessions : [];
    const liveIds = new Set();
    snapshots.forEach((snapshot) => {
      const session = mergeTerminalSessionSnapshot(snapshot);
      if (session?.id) {
        liveIds.add(session.id);
      }
    });
    // On the first load after a page (re)load, terminals we had open whose server
    // process is gone — e.g. ATM was restarted by a 全專案重新整理 — are turned back
    // into relaunchable drafts so the open tabs/layout are remembered instead of
    // vanishing. (Ongoing cross-device sync still drops sessions closed elsewhere.)
    if (!state.terminalWorkspaceLoaded) {
      state.terminalSessions.forEach((session) => {
        if (session.id && !liveIds.has(session.id) && !session.readOnly) {
          session.id = null;
          session.running = false;
          session.interactive = false;
          session.exitedAt = null;
          session.exitCode = null;
          session.exitSignal = null;
          session.cursor = 0;
          session.output = '';
        }
      });
    }
    state.terminalSessions = state.terminalSessions.filter((session) => !session.id || liveIds.has(session.id));
    state.terminalWorkspaceMetaBySessionId = new Map(
      [...state.terminalWorkspaceMetaBySessionId.entries()].filter(([id]) => liveIds.has(id)),
    );
    state.terminalWorkspaceLoaded = true;

    if (terminalCanAddSession() && state.terminalModalOpen && state.terminalProjectName && !terminalSessionsForProject(state.terminalProjectName).length) {
      createTerminalDraft(state.terminalProjectName, { readOnly: terminalIsReadOnly() });
    }
    if (!state.terminalProjectName && state.terminalSessions.length) {
      state.terminalProjectName = state.terminalSessions[0].projectName;
    }
    if (state.terminalProjectName) {
      const sessions = terminalSessionsForProject(state.terminalProjectName);
      const rememberedId = state.terminalActiveSessionByProject.get(state.terminalProjectName);
      state.terminalActiveSessionId = sessions.some((session) => session.localId === rememberedId)
        ? rememberedId
        : sessions.find((session) => session.localId === state.terminalActiveSessionId)?.localId || sessions[0]?.localId || null;
      rememberTerminalActiveSession();
    }

    saveTerminalWorkspaceState();
    if (state.terminalModalOpen) {
      renderTerminalModal();
    } else {
      render();
    }
  } catch (error) {
    state.terminalWorkspaceLoaded = true;
    if (terminalCanAddSession() && state.terminalModalOpen && state.terminalProjectName && !terminalSessionsForProject(state.terminalProjectName).length) {
      createTerminalDraft(state.terminalProjectName, { readOnly: terminalIsReadOnly() });
      renderTerminalModal();
    }
    if (!silent) {
      showToast(error.message);
    }
  }
}

function terminalTitleFromCommand(command) {
  const firstLine = String(command || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || '';
}

function setTerminalTitleFromCommand(session, command) {
  if (!session || session.titleEdited) {
    return;
  }

  const nextTitle = terminalTitleFromCommand(command);
  if (nextTitle) {
    session.title = nextTitle;
  }
}

function normalizeTerminalFavorites(favorites) {
  if (!Array.isArray(favorites)) {
    return [];
  }

  const ids = new Set();
  return favorites
    .map((favorite, index) => {
      const command = String(favorite?.command || '').replace(/\0/g, '').trim().slice(0, TERMINAL_PREFERENCE_TEXT_LIMIT);
      if (!command) {
        return null;
      }

      const note = String(favorite?.note || '').replace(/\0/g, '').trim();
      const rawId = String(favorite?.id || `favorite-${index + 1}`).trim();
      const baseId = rawId
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || `favorite-${index + 1}`;
      let id = baseId;
      let duplicate = 2;
      while (ids.has(id)) {
        id = `${baseId}-${duplicate}`;
        duplicate += 1;
      }
      ids.add(id);
      return { id, command, note };
    })
    .filter(Boolean);
}

function terminalFavoriteCommandKey(command) {
  return String(command || '').trim().toLowerCase();
}

function normalizeTerminalAgentId(value) {
  const agentId = String(value || '').trim().toLowerCase();
  return terminalAgentIds.has(agentId) ? agentId : DEFAULT_TERMINAL_AGENT_ID;
}

function terminalAgentLabel(agentId = state.terminalFavoriteAgent) {
  return TERMINAL_AGENT_TABS.find((agent) => agent.id === normalizeTerminalAgentId(agentId))?.label || 'Claude Code';
}

function defaultTerminalFavoritesForAgent(agentId) {
  return normalizeTerminalFavorites(DEFAULT_TERMINAL_FAVORITES_BY_AGENT[normalizeTerminalAgentId(agentId)] || DEFAULT_TERMINAL_FAVORITES);
}

function defaultTerminalFavoritesByAgent() {
  return Object.fromEntries(TERMINAL_AGENT_TABS.map((agent) => [agent.id, defaultTerminalFavoritesForAgent(agent.id)]));
}

function terminalClaudeModelOptionValue(model) {
  const value = String(model || '');
  return TERMINAL_CLAUDE_MODEL_OPTIONS.some((option) => option.value === value)
    ? value
    : TERMINAL_CLAUDE_CUSTOM_MODEL_VALUE;
}

function normalizeTerminalClaudeEffort(value) {
  const effort = String(value || '').replace(/\0/g, '').trim().toLowerCase();
  return TERMINAL_CLAUDE_EFFORT_OPTIONS.some((option) => option.value === effort) ? effort : '';
}

function normalizeTerminalClaudePermissionMode(settings) {
  const fallback = settings?.permissionModeAuto === true ? 'auto' : DEFAULT_TERMINAL_CLAUDE_SETTINGS.permissionMode;
  const permissionMode = String(settings?.permissionMode || fallback).replace(/\0/g, '').trim();
  return TERMINAL_CLAUDE_PERMISSION_MODE_OPTIONS.some((option) => option.value === permissionMode)
    ? permissionMode
    : DEFAULT_TERMINAL_CLAUDE_SETTINGS.permissionMode;
}

function normalizeTerminalClaudeFlagText(value) {
  let text = String(value || '').replace(/\0/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 320);
  if (!text) {
    return '';
  }
  if (!text.startsWith('-')) {
    text = `--${text}`;
  }
  return text;
}

function terminalClaudeFlagKey(flag) {
  return normalizeTerminalClaudeFlagText(flag).toLowerCase();
}

function createTerminalClaudeFlagId(flag, existingIds = new Set()) {
  const slug = normalizeTerminalClaudeFlagText(flag)
    .toLowerCase()
    .replace(/^-+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
    || 'flag';
  let id = `claude-flag-${slug}`;
  let duplicate = 2;
  while (existingIds.has(id)) {
    id = `claude-flag-${slug}-${duplicate}`;
    duplicate += 1;
  }
  return id;
}

function normalizeTerminalClaudeFavoriteFlags(flags) {
  const source = Array.isArray(flags) && flags.length ? flags : TERMINAL_CLAUDE_DEFAULT_FLAG_FAVORITES;
  const ids = new Set();
  const keys = new Set();
  return source
    .map((item) => {
      const flag = normalizeTerminalClaudeFlagText(typeof item === 'string' ? item : item?.flag);
      const key = terminalClaudeFlagKey(flag);
      if (!flag || keys.has(key)) {
        return null;
      }
      keys.add(key);

      const rawId = String(typeof item === 'string' ? '' : item?.id || '').trim();
      const id = rawId
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || createTerminalClaudeFlagId(flag, ids);
      let nextId = id;
      let duplicate = 2;
      while (ids.has(nextId)) {
        nextId = `${id}-${duplicate}`;
        duplicate += 1;
      }
      ids.add(nextId);
      return { id: nextId, flag };
    })
    .filter(Boolean);
}

function normalizeTerminalClaudeActiveFlags(flags, favoriteFlags = []) {
  const source = Array.isArray(flags) ? flags : [];
  const favoriteByKey = new Map(favoriteFlags.map((item) => [terminalClaudeFlagKey(item.flag), item.flag]));
  const keys = new Set();
  return source
    .map((flag) => {
      const text = normalizeTerminalClaudeFlagText(flag);
      const key = terminalClaudeFlagKey(text);
      if (!text || keys.has(key)) {
        return null;
      }
      keys.add(key);
      return favoriteByKey.get(key) || text;
    })
    .filter(Boolean);
}

function createTerminalAgentFlagId(agentId, flag, existingIds = new Set()) {
  const slug = normalizeTerminalClaudeFlagText(flag)
    .toLowerCase()
    .replace(/^-+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
    || 'flag';
  let id = `${normalizeTerminalAgentId(agentId)}-flag-${slug}`;
  let duplicate = 2;
  while (existingIds.has(id)) {
    id = `${normalizeTerminalAgentId(agentId)}-flag-${slug}-${duplicate}`;
    duplicate += 1;
  }
  return id;
}

function normalizeTerminalAgentFavoriteFlags(flags, defaultFlags, agentId) {
  const source = Array.isArray(flags) && flags.length ? flags : defaultFlags;
  const ids = new Set();
  const keys = new Set();
  return source
    .map((item) => {
      const flag = normalizeTerminalClaudeFlagText(typeof item === 'string' ? item : item?.flag);
      const key = terminalClaudeFlagKey(flag);
      if (!flag || keys.has(key)) {
        return null;
      }
      keys.add(key);

      const rawId = String(typeof item === 'string' ? '' : item?.id || '').trim();
      const id = rawId
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || createTerminalAgentFlagId(agentId, flag, ids);
      let nextId = id;
      let duplicate = 2;
      while (ids.has(nextId)) {
        nextId = `${id}-${duplicate}`;
        duplicate += 1;
      }
      ids.add(nextId);
      return { id: nextId, flag };
    })
    .filter(Boolean);
}

function normalizeTerminalAgentActiveFlags(flags, favoriteFlags = []) {
  const source = Array.isArray(flags) ? flags : [];
  const favoriteByKey = new Map(favoriteFlags.map((item) => [terminalClaudeFlagKey(item.flag), item.flag]));
  const keys = new Set();
  return source
    .map((flag) => {
      const text = normalizeTerminalClaudeFlagText(flag);
      const key = terminalClaudeFlagKey(text);
      if (!text || keys.has(key)) {
        return null;
      }
      keys.add(key);
      return favoriteByKey.get(key) || text;
    })
    .filter(Boolean);
}

function normalizeTerminalClaudeSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    return {
      ...DEFAULT_TERMINAL_CLAUDE_SETTINGS,
      favoriteFlags: normalizeTerminalClaudeFavoriteFlags(DEFAULT_TERMINAL_CLAUDE_SETTINGS.favoriteFlags),
      activeFlags: [],
    };
  }

  const model = String(settings.model || '').replace(/\0/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
  const command = TERMINAL_CLAUDE_COMMANDS.includes(settings.command)
    ? settings.command
    : DEFAULT_TERMINAL_CLAUDE_SETTINGS.command;
  const legacyFlags = [
    settings.remoteControl === true ? '--remote-control' : '',
    settings.chrome === true ? '--chrome' : '',
    settings.worktree === true ? '--worktree' : '',
  ].filter(Boolean);
  const favoriteFlags = normalizeTerminalClaudeFavoriteFlags([
    ...TERMINAL_CLAUDE_DEFAULT_FLAG_FAVORITES,
    ...(Array.isArray(settings.favoriteFlags) ? settings.favoriteFlags : []),
    ...legacyFlags,
    ...(Array.isArray(settings.activeFlags) ? settings.activeFlags : []),
  ]);
  const activeFlags = normalizeTerminalClaudeActiveFlags([
    ...(Array.isArray(settings.activeFlags) ? settings.activeFlags : []),
    ...legacyFlags,
  ], favoriteFlags);

  return {
    ...DEFAULT_TERMINAL_CLAUDE_SETTINGS,
    command,
    model,
    customModel: settings.customModel === true || terminalClaudeModelOptionValue(model) === TERMINAL_CLAUDE_CUSTOM_MODEL_VALUE,
    effort: normalizeTerminalClaudeEffort(settings.effort),
    permissionMode: normalizeTerminalClaudePermissionMode(settings),
    favoriteFlags,
    activeFlags,
  };
}

function readTerminalClaudeSettings() {
  try {
    return normalizeTerminalClaudeSettings(JSON.parse(readLocalPreference(TERMINAL_CLAUDE_SETTINGS_KEY) || 'null'));
  } catch {
    return normalizeTerminalClaudeSettings(DEFAULT_TERMINAL_CLAUDE_SETTINGS);
  }
}

function saveTerminalClaudeSettings() {
  try {
    writeLocalPreference(TERMINAL_CLAUDE_SETTINGS_KEY, JSON.stringify(normalizeTerminalClaudeSettings(state.terminalClaude)));
  } catch {
    // Claude launcher settings remain usable for this session if localStorage is blocked.
  }
}

function normalizeTerminalCodexSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const command = TERMINAL_CODEX_COMMANDS.includes(source.command)
    ? source.command
    : DEFAULT_TERMINAL_CODEX_SETTINGS.command;
  const model = String(source.model || '').replace(/\0/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
  const sandbox = TERMINAL_CODEX_SANDBOX_OPTIONS.some((option) => option.value === source.sandbox)
    ? source.sandbox
    : DEFAULT_TERMINAL_CODEX_SETTINGS.sandbox;
  const approval = TERMINAL_CODEX_APPROVAL_OPTIONS.some((option) => option.value === source.approval)
    ? source.approval
    : DEFAULT_TERMINAL_CODEX_SETTINGS.approval;
  const legacyFlags = source.search === true ? ['--search'] : [];
  const favoriteSource = Array.isArray(source.favoriteFlags)
    ? [
        ...source.favoriteFlags,
        ...(Array.isArray(source.activeFlags) ? source.activeFlags : []),
        ...legacyFlags,
      ]
    : TERMINAL_CODEX_DEFAULT_FLAG_FAVORITES;
  const favoriteFlags = normalizeTerminalAgentFavoriteFlags(favoriteSource, TERMINAL_CODEX_DEFAULT_FLAG_FAVORITES, 'codex');
  const activeFlags = normalizeTerminalAgentActiveFlags([
    ...(Array.isArray(source.activeFlags) ? source.activeFlags : []),
    ...legacyFlags,
  ], favoriteFlags);

  return {
    ...DEFAULT_TERMINAL_CODEX_SETTINGS,
    command,
    model,
    sandbox,
    approval,
    favoriteFlags,
    activeFlags,
  };
}

function readTerminalCodexSettings() {
  try {
    return normalizeTerminalCodexSettings(JSON.parse(readLocalPreference(TERMINAL_CODEX_SETTINGS_KEY) || 'null'));
  } catch {
    return normalizeTerminalCodexSettings(DEFAULT_TERMINAL_CODEX_SETTINGS);
  }
}

function saveTerminalCodexSettings() {
  try {
    writeLocalPreference(TERMINAL_CODEX_SETTINGS_KEY, JSON.stringify(normalizeTerminalCodexSettings(state.terminalCodex)));
  } catch {
    // Codex launcher settings remain usable for this session if localStorage is blocked.
  }
}

function normalizeTerminalAntigravitySettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const command = TERMINAL_ANTIGRAVITY_COMMANDS.includes(source.command)
    ? source.command
    : DEFAULT_TERMINAL_ANTIGRAVITY_SETTINGS.command;
  const favoriteSource = Array.isArray(source.favoriteFlags)
    ? [
        ...source.favoriteFlags,
        ...(Array.isArray(source.activeFlags) ? source.activeFlags : []),
      ]
    : TERMINAL_ANTIGRAVITY_DEFAULT_FLAG_FAVORITES;
  const favoriteFlags = normalizeTerminalAgentFavoriteFlags(favoriteSource, TERMINAL_ANTIGRAVITY_DEFAULT_FLAG_FAVORITES, 'antigravity');
  const activeFlags = normalizeTerminalAgentActiveFlags(Array.isArray(source.activeFlags) ? source.activeFlags : [], favoriteFlags);

  return {
    ...DEFAULT_TERMINAL_ANTIGRAVITY_SETTINGS,
    command,
    favoriteFlags,
    activeFlags,
  };
}

function readTerminalAntigravitySettings() {
  try {
    return normalizeTerminalAntigravitySettings(JSON.parse(readLocalPreference(TERMINAL_ANTIGRAVITY_SETTINGS_KEY) || 'null'));
  } catch {
    return normalizeTerminalAntigravitySettings(DEFAULT_TERMINAL_ANTIGRAVITY_SETTINGS);
  }
}

function saveTerminalAntigravitySettings() {
  try {
    writeLocalPreference(TERMINAL_ANTIGRAVITY_SETTINGS_KEY, JSON.stringify(normalizeTerminalAntigravitySettings(state.terminalAntigravity)));
  } catch {
    // Antigravity launcher settings remain usable for this session if localStorage is blocked.
  }
}

function normalizeTerminalOpencodeSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const command = TERMINAL_OPENCODE_COMMANDS.includes(source.command)
    ? source.command
    : DEFAULT_TERMINAL_OPENCODE_SETTINGS.command;
  const model = String(source.model || '').replace(/\0/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
  const favoriteSource = Array.isArray(source.favoriteFlags)
    ? [
        ...source.favoriteFlags,
        ...(Array.isArray(source.activeFlags) ? source.activeFlags : []),
      ]
    : TERMINAL_OPENCODE_DEFAULT_FLAG_FAVORITES;
  const favoriteFlags = normalizeTerminalAgentFavoriteFlags(favoriteSource, TERMINAL_OPENCODE_DEFAULT_FLAG_FAVORITES, 'opencode');
  const activeFlags = normalizeTerminalAgentActiveFlags(Array.isArray(source.activeFlags) ? source.activeFlags : [], favoriteFlags);

  return {
    ...DEFAULT_TERMINAL_OPENCODE_SETTINGS,
    command,
    model,
    favoriteFlags,
    activeFlags,
  };
}

function readTerminalOpencodeSettings() {
  try {
    return normalizeTerminalOpencodeSettings(JSON.parse(readLocalPreference(TERMINAL_OPENCODE_SETTINGS_KEY) || 'null'));
  } catch {
    return normalizeTerminalOpencodeSettings(DEFAULT_TERMINAL_OPENCODE_SETTINGS);
  }
}

function saveTerminalOpencodeSettings() {
  try {
    writeLocalPreference(TERMINAL_OPENCODE_SETTINGS_KEY, JSON.stringify(normalizeTerminalOpencodeSettings(state.terminalOpencode)));
  } catch {
    // opencode launcher settings remain usable for this session if localStorage is blocked.
  }
}

function terminalQuoteArgument(value) {
  const text = String(value || '').replace(/\0/g, '').replace(/[\r\n]+/g, ' ').trim();
  if (!text) {
    return '';
  }
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) {
    return text;
  }
  return `"${text.replace(/(["\\])/g, '\\$1')}"`;
}

function buildTerminalClaudeCommand() {
  const settings = normalizeTerminalClaudeSettings(state.terminalClaude);
  const parts = [settings.command];
  const model = terminalQuoteArgument(settings.model);
  const effort = terminalQuoteArgument(settings.effort);

  if (model) {
    parts.push('--model', model);
  }
  if (effort) {
    parts.push('--effort', effort);
  }
  if (settings.permissionMode) {
    parts.push('--permission-mode', settings.permissionMode);
  }
  settings.activeFlags.forEach((flag) => {
    parts.push(flag);
  });

  return parts.join(' ');
}

function terminalClaudeLaunchPayload() {
  const settings = normalizeTerminalClaudeSettings(state.terminalClaude);
  return {
    command: settings.command,
    model: settings.model,
    effort: settings.effort,
    permissionMode: settings.permissionMode,
    activeFlags: settings.activeFlags,
  };
}

function buildTerminalCodexCommand() {
  const settings = normalizeTerminalCodexSettings(state.terminalCodex);
  const parts = [settings.command];
  const model = terminalQuoteArgument(settings.model);

  if (model) {
    parts.push('--model', model);
  }
  if (settings.sandbox) {
    parts.push('--sandbox', settings.sandbox);
  }
  if (settings.approval) {
    parts.push('--ask-for-approval', settings.approval);
  }
  settings.activeFlags.forEach((flag) => {
    parts.push(flag);
  });

  return parts.join(' ');
}

function terminalCodexLaunchPayload() {
  const settings = normalizeTerminalCodexSettings(state.terminalCodex);
  return {
    command: settings.command,
    model: settings.model,
    sandbox: settings.sandbox,
    approval: settings.approval,
    activeFlags: settings.activeFlags,
  };
}

function buildTerminalAntigravityCommand() {
  const settings = normalizeTerminalAntigravitySettings(state.terminalAntigravity);
  return [settings.command, ...settings.activeFlags].join(' ');
}

function terminalAntigravityLaunchPayload() {
  const settings = normalizeTerminalAntigravitySettings(state.terminalAntigravity);
  return {
    command: settings.command,
    activeFlags: settings.activeFlags,
  };
}

function buildTerminalOpencodeCommand() {
  const settings = normalizeTerminalOpencodeSettings(state.terminalOpencode);
  const parts = [settings.command];
  const model = terminalQuoteArgument(settings.model);

  if (model) {
    parts.push('--model', model);
  }
  settings.activeFlags.forEach((flag) => {
    parts.push(flag);
  });

  return parts.join(' ');
}

function terminalOpencodeLaunchPayload() {
  const settings = normalizeTerminalOpencodeSettings(state.terminalOpencode);
  return {
    command: settings.command,
    model: settings.model,
    activeFlags: settings.activeFlags,
  };
}

function terminalPipelineStepId() {
  return `pstep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTerminalPipelineStep(step) {
  const source = step && typeof step === 'object' ? step : {};
  const prompt = String(source.prompt ?? '')
    .replace(/\0/g, '')
    .slice(0, TERMINAL_PIPELINE_PROMPT_LIMIT);
  const conversation = TERMINAL_PIPELINE_CONVERSATIONS.has(source.conversation)
    ? source.conversation
    : 'same';
  return {
    id: typeof source.id === 'string' && source.id ? source.id : terminalPipelineStepId(),
    // Which project's terminal this prompt runs against. '' = use the pipeline's
    // current/default project. The pipeline orchestrates across projects.
    project: String(source.project ?? '').replace(/\0/g, '').slice(0, 240),
    prompt,
    conversation,
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(number)));
}

function defaultTerminalPipeline() {
  return {
    steps: [{ id: terminalPipelineStepId(), prompt: '', conversation: 'new' }],
    idleSeconds: 12,
    maxWaitSeconds: 900,
    resetCommand: '',
    quotaGate: {
      enabled: false,
      agent: DEFAULT_TERMINAL_AGENT_ID,
      minRemaining: 15,
      countdownPerPercent: 15,
      safetyBuffer: 5,
      stopOnUnknown: false,
    },
  };
}

function normalizeTerminalPipeline(pipeline) {
  const fallback = defaultTerminalPipeline();
  const source = pipeline && typeof pipeline === 'object' ? pipeline : {};
  const steps = Array.isArray(source.steps) && source.steps.length
    ? source.steps.map((step) => normalizeTerminalPipelineStep(step))
    : fallback.steps;
  const quotaSource = source.quotaGate && typeof source.quotaGate === 'object' ? source.quotaGate : {};
  const quotaAgent = terminalAgentIds.has(quotaSource.agent) ? quotaSource.agent : fallback.quotaGate.agent;
  return {
    steps,
    idleSeconds: clampNumber(source.idleSeconds, TERMINAL_PIPELINE_IDLE_MIN, TERMINAL_PIPELINE_IDLE_MAX, fallback.idleSeconds),
    maxWaitSeconds: clampNumber(source.maxWaitSeconds, TERMINAL_PIPELINE_MAXWAIT_MIN, TERMINAL_PIPELINE_MAXWAIT_MAX, fallback.maxWaitSeconds),
    resetCommand: String(source.resetCommand ?? '').replace(/\0/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120),
    quotaGate: {
      enabled: quotaSource.enabled === true,
      agent: quotaAgent,
      minRemaining: clampNumber(quotaSource.minRemaining, 0, 100, fallback.quotaGate.minRemaining),
      countdownPerPercent: clampNumber(quotaSource.countdownPerPercent, TERMINAL_PIPELINE_COUNTDOWN_MIN, TERMINAL_PIPELINE_COUNTDOWN_MAX, fallback.quotaGate.countdownPerPercent),
      safetyBuffer: clampNumber(quotaSource.safetyBuffer, TERMINAL_PIPELINE_SAFETY_MIN, TERMINAL_PIPELINE_SAFETY_MAX, fallback.quotaGate.safetyBuffer),
      stopOnUnknown: quotaSource.stopOnUnknown === true,
    },
  };
}

function getTerminalPipeline() {
  state.terminalPipeline = normalizeTerminalPipeline(state.terminalPipeline);
  return state.terminalPipeline;
}

function readTerminalPipeline() {
  try {
    return normalizeTerminalPipeline(JSON.parse(readLocalPreference(TERMINAL_PIPELINE_KEY) || 'null'));
  } catch {
    return defaultTerminalPipeline();
  }
}

function saveTerminalPipeline({ sync = true } = {}) {
  try {
    writeLocalPreference(TERMINAL_PIPELINE_KEY, JSON.stringify(normalizeTerminalPipeline(state.terminalPipeline)));
  } catch {
    // The pipeline stays usable for this session even if localStorage is blocked.
  }

  // Sync the pipeline config to the server so it can be set on a phone and run locally.
  if (sync) {
    scheduleTerminalPreferencesSave();
  }
}

// 記事本:一份不會被執行的 pipeline 草稿。共用 pipeline 的段落結構(project /
// prompt / conversation),但沒有 idle/逾時/quota 等執行參數,也不會被執行。
function defaultTerminalNotepad() {
  return { steps: [normalizeTerminalPipelineStep({ conversation: 'same' })] };
}

function normalizeTerminalNotepad(notepad) {
  const source = notepad && typeof notepad === 'object' ? notepad : {};
  const steps = Array.isArray(source.steps) && source.steps.length
    ? source.steps.map((step) => normalizeTerminalPipelineStep(step))
    : defaultTerminalNotepad().steps;
  return { steps };
}

function getTerminalNotepad() {
  state.terminalNotepad = normalizeTerminalNotepad(state.terminalNotepad);
  return state.terminalNotepad;
}

function readTerminalNotepad() {
  try {
    return normalizeTerminalNotepad(JSON.parse(readLocalPreference(TERMINAL_NOTEPAD_KEY) || 'null'));
  } catch {
    return defaultTerminalNotepad();
  }
}

function saveTerminalNotepad() {
  try {
    writeLocalPreference(TERMINAL_NOTEPAD_KEY, JSON.stringify(normalizeTerminalNotepad(state.terminalNotepad)));
  } catch {
    // The notepad stays usable for this session even if localStorage is blocked.
  }
}

function syncTerminalClaudePreview() {
  const preview = elements.terminalWorkspace.querySelector('[data-terminal-claude-preview]');
  if (preview) {
    preview.textContent = buildTerminalClaudeCommand();
  }
}

function syncTerminalAgentPreview(agentId, command) {
  const preview = elements.terminalWorkspace.querySelector(`[data-terminal-agent-preview="${CSS.escape(agentId)}"]`);
  if (preview) {
    preview.textContent = command;
  }
}

function reorderTerminalFavorites(favorites, commandOrder) {
  if (!Array.isArray(commandOrder) || !commandOrder.length) {
    return favorites;
  }

  const orderMap = new Map(commandOrder.map((command, index) => [terminalFavoriteCommandKey(command), index]));
  const ordered = new Array(commandOrder.length).fill(null);
  const others = [];
  favorites.forEach((favorite) => {
    const orderIndex = orderMap.get(terminalFavoriteCommandKey(favorite.command));
    if (orderIndex === undefined || ordered[orderIndex]) {
      others.push(favorite);
      return;
    }
    ordered[orderIndex] = favorite;
  });

  return normalizeTerminalFavorites([...ordered.filter(Boolean), ...others]);
}

function migrateTerminalFavorites(favorites, fromVersion = 0, agentId = DEFAULT_TERMINAL_AGENT_ID) {
  const version = Number(fromVersion) || 0;
  const normalizedAgentId = normalizeTerminalAgentId(agentId);
  let next = normalizeTerminalFavorites(favorites);

  TERMINAL_FAVORITE_MIGRATIONS.forEach((migration) => {
    if (version >= migration.version) {
      return;
    }

    if (Array.isArray(migration.removeCommands) && migration.removeCommands.length) {
      const removeCommands = new Set(migration.removeCommands.map((command) => terminalFavoriteCommandKey(command)));
      next = normalizeTerminalFavorites(next.filter((favorite) => !removeCommands.has(terminalFavoriteCommandKey(favorite.command))));
    }

    const migrationFavorites = Array.isArray(migration.favoritesByAgent?.[normalizedAgentId])
      ? migration.favoritesByAgent[normalizedAgentId]
      : migration.favorites;
    if (!Array.isArray(migrationFavorites) || !migrationFavorites.length) {
      return;
    }

    const existingCommands = new Set(next.map((favorite) => terminalFavoriteCommandKey(favorite.command)));
    const additions = migrationFavorites.filter((favorite) => {
      const key = terminalFavoriteCommandKey(favorite.command);
      if (!key || existingCommands.has(key)) {
        return false;
      }
      existingCommands.add(key);
      return true;
    });

    if (additions.length) {
      next = normalizeTerminalFavorites([...next, ...additions]);
    }

    const reorderCommands = Array.isArray(migration.reorderCommandsByAgent?.[normalizedAgentId])
      ? migration.reorderCommandsByAgent[normalizedAgentId]
      : migration.reorderCommands;
    if (Array.isArray(reorderCommands) && reorderCommands.length) {
      next = reorderTerminalFavorites(next, reorderCommands);
    }
  });

  return next;
}

function readTerminalFavorites() {
  try {
    const raw = readLocalPreference(TERMINAL_FAVORITES_KEY);
    const version = Number(readLocalPreference(TERMINAL_FAVORITES_VERSION_KEY) || 0) || 0;
    if (raw === null) {
      return {
        activeAgent: DEFAULT_TERMINAL_AGENT_ID,
        favoritesByAgent: defaultTerminalFavoritesByAgent(),
      };
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        activeAgent: DEFAULT_TERMINAL_AGENT_ID,
        favoritesByAgent: {
          ...defaultTerminalFavoritesByAgent(),
      claude: migrateTerminalFavorites(parsed, version, 'claude'),
        },
      };
    }

    const source = parsed && typeof parsed === 'object' ? parsed : {};
    const sourceAgents = source.agents && typeof source.agents === 'object'
      ? source.agents
      : source.favoritesByAgent && typeof source.favoritesByAgent === 'object'
        ? source.favoritesByAgent
        : {};
    const favoritesByAgent = defaultTerminalFavoritesByAgent();
    TERMINAL_AGENT_TABS.forEach((agent) => {
      if (!Array.isArray(sourceAgents[agent.id])) {
        return;
      }
      favoritesByAgent[agent.id] = migrateTerminalFavorites(sourceAgents[agent.id], version, agent.id);
    });

    return {
      activeAgent: normalizeTerminalAgentId(source.activeAgent || source.agent),
      favoritesByAgent,
    };
  } catch {
    return {
      activeAgent: DEFAULT_TERMINAL_AGENT_ID,
      favoritesByAgent: defaultTerminalFavoritesByAgent(),
    };
  }
}

function terminalFavoriteAgentId() {
  return normalizeTerminalAgentId(state.terminalFavoriteAgent);
}

function setTerminalFavoritesForAgent(agentId, favorites) {
  const normalizedAgentId = normalizeTerminalAgentId(agentId);
  const normalizedFavorites = normalizeTerminalFavorites(favorites);
  state.terminalFavoritesByAgent = {
    ...defaultTerminalFavoritesByAgent(),
    ...state.terminalFavoritesByAgent,
    [normalizedAgentId]: normalizedFavorites,
  };
  if (terminalFavoriteAgentId() === normalizedAgentId) {
    state.terminalFavorites = normalizedFavorites;
  }
}

function syncTerminalFavoritesFromActiveAgent() {
  const agentId = terminalFavoriteAgentId();
  const favorites = Array.isArray(state.terminalFavoritesByAgent[agentId])
    ? state.terminalFavoritesByAgent[agentId]
    : defaultTerminalFavoritesForAgent(agentId);
  setTerminalFavoritesForAgent(agentId, favorites);
  return state.terminalFavorites;
}

function switchTerminalFavoriteAgent(agentId, { save = true } = {}) {
  const nextAgentId = normalizeTerminalAgentId(agentId);
  if (terminalFavoriteAgentId() === nextAgentId) {
    return;
  }

  state.terminalFavoriteAgent = nextAgentId;
  state.terminalFavoritesExpanded = false;
  clearTerminalFavoriteEditor();
  syncTerminalFavoritesFromActiveAgent();
  if (save) {
    saveTerminalFavorites();
  }
  renderTerminalModal();
}

function saveTerminalFavorites({ sync = true } = {}) {
  setTerminalFavoritesForAgent(terminalFavoriteAgentId(), state.terminalFavorites);
  try {
    writeLocalPreference(TERMINAL_FAVORITES_KEY, JSON.stringify({
      activeAgent: terminalFavoriteAgentId(),
      agents: state.terminalFavoritesByAgent,
    }));
    writeLocalPreference(TERMINAL_FAVORITES_VERSION_KEY, String(TERMINAL_FAVORITES_VERSION));
  } catch {
    // Favorites remain usable for this session if localStorage is blocked.
  }

  if (sync) {
    scheduleTerminalPreferencesSave();
  }
}

function terminalPreferencesPayload() {
  setTerminalFavoritesForAgent(terminalFavoriteAgentId(), state.terminalFavorites);
  return {
    favoritesVersion: TERMINAL_FAVORITES_VERSION,
    favorites: state.terminalFavorites,
    activeAgent: terminalFavoriteAgentId(),
    favoritesByAgent: state.terminalFavoritesByAgent,
    pipeline: getTerminalPipeline(),
    pipelineRun: state.terminalPipelineRunSaved || null,
    // A read-only (remote) client can't own writable sessions, so it must not overwrite
    // the shared workspace — that would wipe the local machine's terminal tabs.
    ...(terminalIsReadOnly() ? {} : { workspace: buildTerminalWorkspaceState() }),
  };
}

function scheduleTerminalPreferencesSave(delay = 500) {
  if (!state.terminalPreferencesLoaded) {
    return;
  }

  window.clearTimeout(terminalPreferencesSaveTimer);
  terminalPreferencesSaveTimer = window.setTimeout(saveTerminalPreferencesToServer, delay);
}

async function saveTerminalPreferencesToServer() {
  if (!state.terminalPreferencesLoaded) {
    return;
  }

  try {
    await api('/api/terminal-preferences', {
      method: 'PUT',
      body: JSON.stringify(terminalPreferencesPayload()),
    });
    state.terminalPreferencesSaved = true;
  } catch (error) {
    console.warn('Terminal preferences sync failed:', error);
  }
}

function applyTerminalPreferences(payload) {
  let needsSave = false;
  if (payload.favoritesByAgent && typeof payload.favoritesByAgent === 'object') {
    const favoritesVersion = Number(payload.favoritesVersion || 0) || 0;
    const nextFavoritesByAgent = defaultTerminalFavoritesByAgent();
    TERMINAL_AGENT_TABS.forEach((agent) => {
      if (!Array.isArray(payload.favoritesByAgent[agent.id])) {
        return;
      }
      nextFavoritesByAgent[agent.id] = migrateTerminalFavorites(payload.favoritesByAgent[agent.id], favoritesVersion, agent.id);
    });
    state.terminalFavoritesByAgent = nextFavoritesByAgent;
    state.terminalFavoriteAgent = normalizeTerminalAgentId(payload.activeAgent);
    syncTerminalFavoritesFromActiveAgent();
    needsSave = needsSave || favoritesVersion < TERMINAL_FAVORITES_VERSION;
  } else if (Array.isArray(payload.favorites)) {
    const favoritesVersion = Number(payload.favoritesVersion || 0) || 0;
    state.terminalFavoriteAgent = DEFAULT_TERMINAL_AGENT_ID;
    state.terminalFavoritesByAgent = {
      ...defaultTerminalFavoritesByAgent(),
      claude: migrateTerminalFavorites(payload.favorites, favoritesVersion, 'claude'),
    };
    syncTerminalFavoritesFromActiveAgent();
    needsSave = needsSave || favoritesVersion < TERMINAL_FAVORITES_VERSION;
  }
  if (payload.workspace && typeof payload.workspace === 'object') {
    restoreTerminalWorkspaceState(payload.workspace, { replace: true });
  }
  if (payload.pipeline && typeof payload.pipeline === 'object') {
    state.terminalPipeline = normalizeTerminalPipeline(payload.pipeline);
    saveTerminalPipeline({ sync: false });
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'pipelineRun')) {
    state.terminalPipelineRunSaved = normalizePipelineRunSaved(payload.pipelineRun);
  }

  saveTerminalFavorites({ sync: false });
  saveTerminalWorkspaceState({ sync: false });
  return needsSave;
}

async function loadTerminalPreferences({ silent = false } = {}) {
  try {
    const shouldMigrateLocalPreferences = hasTerminalPreferenceLocalState();
    const payload = await api('/api/terminal-preferences');
    let shouldSavePreferences = false;
    if (payload.saved) {
      shouldSavePreferences = applyTerminalPreferences(payload);
    }
    state.terminalPreferencesSaved = payload.saved === true;
    state.terminalPreferencesLoaded = true;
    if ((!payload.saved && shouldMigrateLocalPreferences) || shouldSavePreferences) {
      scheduleTerminalPreferencesSave(0);
    }
    if (state.terminalModalOpen) {
      renderTerminalModal();
    }
  } catch (error) {
    if (!silent) {
      showToast(error.message);
    }
  }
}

function createTerminalFavoriteId(command) {
  const existing = new Set(state.terminalFavorites.map((favorite) => favorite.id));
  const slug = String(command || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    || 'command';
  let id = `favorite-${slug}`;
  let duplicate = 2;
  while (existing.has(id)) {
    id = `favorite-${slug}-${duplicate}`;
    duplicate += 1;
  }
  return id;
}

function clearTerminalFavoriteEditor() {
  state.terminalFavoriteEditingId = null;
  state.terminalFavoriteDraftCommand = '';
  state.terminalFavoriteDraftNote = '';
}

function beginTerminalFavoriteCreate(command = '') {
  state.terminalFavoriteEditingId = 'new';
  state.terminalFavoriteDraftCommand = String(command || '');
  state.terminalFavoriteDraftNote = '';
  renderTerminalModal();
  window.requestAnimationFrame(() => {
    const input = elements.terminalWorkspace.querySelector('[data-terminal-favorite-command]');
    if (input) {
      input.focus();
      input.select();
    }
  });
}

function beginTerminalFavoriteEdit(id) {
  const favorite = state.terminalFavorites.find((item) => item.id === id);
  if (!favorite) {
    return;
  }

  state.terminalFavoriteEditingId = id;
  state.terminalFavoriteDraftCommand = favorite.command;
  state.terminalFavoriteDraftNote = favorite.note || '';
  renderTerminalModal();
  window.requestAnimationFrame(() => {
    const input = elements.terminalWorkspace.querySelector('[data-terminal-favorite-command]');
    if (input) {
      input.focus();
      input.select();
    }
  });
}

function commitTerminalFavoriteEdit() {
  const command = state.terminalFavoriteDraftCommand.trim();
  const note = state.terminalFavoriteDraftNote.trim();
  if (!command) {
    showToast('請輸入我的最愛指令');
    return;
  }

  if (state.terminalFavoriteEditingId === 'new') {
    setTerminalFavoritesForAgent(terminalFavoriteAgentId(), [
      ...state.terminalFavorites,
      {
        id: createTerminalFavoriteId(command),
        command,
        note,
      },
    ]);
  } else {
    setTerminalFavoritesForAgent(terminalFavoriteAgentId(), state.terminalFavorites.map((favorite) => (
      favorite.id === state.terminalFavoriteEditingId
        ? { ...favorite, command, note }
        : favorite
    )));
  }

  saveTerminalFavorites();
  clearTerminalFavoriteEditor();
  renderTerminalModal();
  showToast('我的最愛指令已儲存');
}

function deleteTerminalFavorite(id) {
  setTerminalFavoritesForAgent(terminalFavoriteAgentId(), state.terminalFavorites.filter((favorite) => favorite.id !== id));
  if (state.terminalFavoriteEditingId === id) {
    clearTerminalFavoriteEditor();
  }
  saveTerminalFavorites();
  renderTerminalModal();
  showToast('我的最愛指令已刪除');
}

function applyTerminalFavorite(id) {
  const favorite = state.terminalFavorites.find((item) => item.id === id);
  const session = findTerminalSession(state.terminalActiveSessionId);
  if (!favorite || !session) {
    return;
  }

  if (session.readOnly) {
    showToast('Terminal is read-only from LAN/Tailscale.');
    return;
  }

  if (session.id) {
    setTerminalTitleFromCommand(session, favorite.command);
    if (sendTerminalSocketMessage(session, { type: 'input', data: `${favorite.command}\r` })) {
      state.terminalWorkspaceMetaBySessionId.set(session.id, terminalSessionMetadata(session));
      saveTerminalWorkspaceState();
      return;
    }
  }

  session.input = favorite.command;
  if (session.id) {
    state.terminalWorkspaceMetaBySessionId.set(session.id, terminalSessionMetadata(session));
  }
  saveTerminalWorkspaceState();
  renderTerminalModal();
  window.requestAnimationFrame(() => {
    const input = elements.terminalWorkspace.querySelector(`[data-terminal-input="${CSS.escape(session.localId)}"]`);
    input?.focus();
  });
}

function setTerminalSessionInput(session, command) {
  if (!session || session.readOnly) {
    return false;
  }

  session.input = command;
  if (session.id) {
    state.terminalWorkspaceMetaBySessionId.set(session.id, terminalSessionMetadata(session));
  }
  saveTerminalWorkspaceState();

  const input = elements.terminalWorkspace.querySelector(`[data-terminal-input="${CSS.escape(session.localId)}"]`);
  if (input) {
    input.value = command;
  }
  return true;
}

async function launchRemoteTerminalClaude(session) {
  if (!session || !terminalCanUseClaudeLauncher(session)) {
    showToast('Terminal is read-only from LAN/Tailscale.');
    return;
  }

  const command = buildTerminalClaudeCommand();
  session.input = command;
  setTerminalTitleFromCommand(session, command);
  const signal = beginTerminalSessionBusy(session, '啟動 Claude Code…');
  renderTerminalModal();

  try {
    const payload = await api(`/api/projects/${encodeURIComponent(session.projectName)}/terminal-claude`, {
      method: 'POST',
      body: JSON.stringify({
        settings: terminalClaudeLaunchPayload(),
        cols: session.cols,
        rows: session.rows,
      }),
      signal,
    });

    session.input = '';
    applyTerminalPayload(session, payload);
    startTerminalPolling();
  } catch (error) {
    if (!isAbortError(error)) {
      showToast(error.message);
    }
  } finally {
    endTerminalSessionBusy(session);
    renderTerminalModal();
  }
}

async function launchRemoteTerminalAgent(session, agent, command, settings) {
  if (!session || !terminalCanUseAgentLauncher(session)) {
    showToast('Terminal is read-only from LAN/Tailscale.');
    return;
  }

  session.input = command;
  setTerminalTitleFromCommand(session, command);
  const signal = beginTerminalSessionBusy(session, `啟動 ${terminalAgentLabel(agent)}…`);
  renderTerminalModal();

  try {
    const payload = await api(`/api/projects/${encodeURIComponent(session.projectName)}/terminal-agent`, {
      method: 'POST',
      body: JSON.stringify({
        agent,
        settings,
        cols: session.cols,
        rows: session.rows,
      }),
      signal,
    });

    session.input = '';
    applyTerminalPayload(session, payload);
    startTerminalPolling();
  } catch (error) {
    if (!isAbortError(error)) {
      showToast(error.message);
    }
  } finally {
    endTerminalSessionBusy(session);
    renderTerminalModal();
  }
}

function applyTerminalAgentCommand(agent, command, settings, { run = false } = {}) {
  const session = findTerminalSession(state.terminalActiveSessionId);
  if (!session) {
    return;
  }

  if (session.readOnly) {
    if (run && terminalCanUseAgentLauncher(session)) {
      launchRemoteTerminalAgent(session, agent, command, settings);
      return;
    }
    showToast('Terminal is read-only from LAN/Tailscale.');
    return;
  }

  if (!setTerminalSessionInput(session, command)) {
    return;
  }

  if (run) {
    runTerminalCommand(session.localId);
    return;
  }

  window.requestAnimationFrame(() => {
    const input = elements.terminalWorkspace.querySelector(`[data-terminal-input="${CSS.escape(session.localId)}"]`);
    input?.focus();
  });
}

function applyTerminalClaudeCommand({ run = false } = {}) {
  const session = findTerminalSession(state.terminalActiveSessionId);
  if (!session) {
    return;
  }

  if (session.readOnly) {
    if (run && terminalCanUseClaudeLauncher(session)) {
      launchRemoteTerminalClaude(session);
      return;
    }
    showToast('Terminal is read-only from LAN/Tailscale.');
    return;
  }

  const command = buildTerminalClaudeCommand();
  if (!setTerminalSessionInput(session, command)) {
    return;
  }

  if (run) {
    runTerminalCommand(session.localId);
    return;
  }

  window.requestAnimationFrame(() => {
    const input = elements.terminalWorkspace.querySelector(`[data-terminal-input="${CSS.escape(session.localId)}"]`);
    input?.focus();
  });
}

function applyTerminalCodexCommand({ run = false } = {}) {
  applyTerminalAgentCommand('codex', buildTerminalCodexCommand(), terminalCodexLaunchPayload(), { run });
}

function applyTerminalAntigravityCommand({ run = false } = {}) {
  applyTerminalAgentCommand('antigravity', buildTerminalAntigravityCommand(), terminalAntigravityLaunchPayload(), { run });
}

function applyTerminalOpencodeCommand({ run = false } = {}) {
  applyTerminalAgentCommand('opencode', buildTerminalOpencodeCommand(), terminalOpencodeLaunchPayload(), { run });
}

function toggleTerminalClaudeFavoriteFlag(id) {
  const settings = normalizeTerminalClaudeSettings(state.terminalClaude);
  const favorite = settings.favoriteFlags.find((item) => item.id === id);
  if (!favorite) {
    return;
  }

  const key = terminalClaudeFlagKey(favorite.flag);
  const nextActiveFlags = settings.activeFlags.some((flag) => terminalClaudeFlagKey(flag) === key)
    ? settings.activeFlags.filter((flag) => terminalClaudeFlagKey(flag) !== key)
    : [...settings.activeFlags, favorite.flag];

  state.terminalClaude = normalizeTerminalClaudeSettings({
    ...settings,
    activeFlags: nextActiveFlags,
  });
  saveTerminalClaudeSettings();
  renderTerminalModal();
}

function addTerminalClaudeFavoriteFlag() {
  const flag = normalizeTerminalClaudeFlagText(state.terminalClaudeFlagDraft);
  if (!flag) {
    showToast('請輸入啟動旗標');
    return;
  }

  const settings = normalizeTerminalClaudeSettings(state.terminalClaude);
  const existing = settings.favoriteFlags.find((item) => terminalClaudeFlagKey(item.flag) === terminalClaudeFlagKey(flag));
  const favoriteFlags = existing
    ? settings.favoriteFlags
    : [
        ...settings.favoriteFlags,
        {
          id: createTerminalClaudeFlagId(flag, new Set(settings.favoriteFlags.map((item) => item.id))),
          flag,
        },
      ];
  const activeFlags = settings.activeFlags.some((item) => terminalClaudeFlagKey(item) === terminalClaudeFlagKey(flag))
    ? settings.activeFlags
    : [...settings.activeFlags, flag];

  state.terminalClaude = normalizeTerminalClaudeSettings({
    ...settings,
    favoriteFlags,
    activeFlags,
  });
  state.terminalClaudeFlagDraft = '';
  saveTerminalClaudeSettings();
  renderTerminalModal();
}

function deleteTerminalClaudeFavoriteFlag(id) {
  const settings = normalizeTerminalClaudeSettings(state.terminalClaude);
  const favorite = settings.favoriteFlags.find((item) => item.id === id);
  if (!favorite) {
    return;
  }

  const key = terminalClaudeFlagKey(favorite.flag);
  state.terminalClaude = normalizeTerminalClaudeSettings({
    ...settings,
    favoriteFlags: settings.favoriteFlags.filter((item) => item.id !== id),
    activeFlags: settings.activeFlags.filter((flag) => terminalClaudeFlagKey(flag) !== key),
  });
  saveTerminalClaudeSettings();
  renderTerminalModal();
}

function toggleTerminalCodexFavoriteFlag(id) {
  const settings = normalizeTerminalCodexSettings(state.terminalCodex);
  const favorite = settings.favoriteFlags.find((item) => item.id === id);
  if (!favorite) {
    return;
  }

  const key = terminalClaudeFlagKey(favorite.flag);
  const nextActiveFlags = settings.activeFlags.some((flag) => terminalClaudeFlagKey(flag) === key)
    ? settings.activeFlags.filter((flag) => terminalClaudeFlagKey(flag) !== key)
    : [...settings.activeFlags, favorite.flag];

  state.terminalCodex = normalizeTerminalCodexSettings({
    ...settings,
    activeFlags: nextActiveFlags,
  });
  saveTerminalCodexSettings();
  renderTerminalModal();
}

function addTerminalCodexFavoriteFlag() {
  const flag = normalizeTerminalClaudeFlagText(state.terminalCodexFlagDraft);
  if (!flag) {
    showToast('請輸入啟動旗標');
    return;
  }

  const settings = normalizeTerminalCodexSettings(state.terminalCodex);
  const existing = settings.favoriteFlags.find((item) => terminalClaudeFlagKey(item.flag) === terminalClaudeFlagKey(flag));
  const favoriteFlags = existing
    ? settings.favoriteFlags
    : [
        ...settings.favoriteFlags,
        {
          id: createTerminalAgentFlagId('codex', flag, new Set(settings.favoriteFlags.map((item) => item.id))),
          flag,
        },
      ];
  const activeFlags = settings.activeFlags.some((item) => terminalClaudeFlagKey(item) === terminalClaudeFlagKey(flag))
    ? settings.activeFlags
    : [...settings.activeFlags, flag];

  state.terminalCodex = normalizeTerminalCodexSettings({
    ...settings,
    favoriteFlags,
    activeFlags,
  });
  state.terminalCodexFlagDraft = '';
  saveTerminalCodexSettings();
  renderTerminalModal();
}

function deleteTerminalCodexFavoriteFlag(id) {
  const settings = normalizeTerminalCodexSettings(state.terminalCodex);
  const favorite = settings.favoriteFlags.find((item) => item.id === id);
  if (!favorite) {
    return;
  }

  const key = terminalClaudeFlagKey(favorite.flag);
  state.terminalCodex = normalizeTerminalCodexSettings({
    ...settings,
    favoriteFlags: settings.favoriteFlags.filter((item) => item.id !== id),
    activeFlags: settings.activeFlags.filter((flag) => terminalClaudeFlagKey(flag) !== key),
  });
  saveTerminalCodexSettings();
  renderTerminalModal();
}

function toggleTerminalAntigravityFavoriteFlag(id) {
  const settings = normalizeTerminalAntigravitySettings(state.terminalAntigravity);
  const favorite = settings.favoriteFlags.find((item) => item.id === id);
  if (!favorite) {
    return;
  }

  const key = terminalClaudeFlagKey(favorite.flag);
  const nextActiveFlags = settings.activeFlags.some((flag) => terminalClaudeFlagKey(flag) === key)
    ? settings.activeFlags.filter((flag) => terminalClaudeFlagKey(flag) !== key)
    : [...settings.activeFlags, favorite.flag];

  state.terminalAntigravity = normalizeTerminalAntigravitySettings({
    ...settings,
    activeFlags: nextActiveFlags,
  });
  saveTerminalAntigravitySettings();
  renderTerminalModal();
}

function addTerminalAntigravityFavoriteFlag() {
  const flag = normalizeTerminalClaudeFlagText(state.terminalAntigravityFlagDraft);
  if (!flag) {
    showToast('請輸入啟動旗標');
    return;
  }

  const settings = normalizeTerminalAntigravitySettings(state.terminalAntigravity);
  const existing = settings.favoriteFlags.find((item) => terminalClaudeFlagKey(item.flag) === terminalClaudeFlagKey(flag));
  const favoriteFlags = existing
    ? settings.favoriteFlags
    : [
        ...settings.favoriteFlags,
        {
          id: createTerminalAgentFlagId('antigravity', flag, new Set(settings.favoriteFlags.map((item) => item.id))),
          flag,
        },
      ];
  const activeFlags = settings.activeFlags.some((item) => terminalClaudeFlagKey(item) === terminalClaudeFlagKey(flag))
    ? settings.activeFlags
    : [...settings.activeFlags, flag];

  state.terminalAntigravity = normalizeTerminalAntigravitySettings({
    ...settings,
    favoriteFlags,
    activeFlags,
  });
  state.terminalAntigravityFlagDraft = '';
  saveTerminalAntigravitySettings();
  renderTerminalModal();
}

function deleteTerminalAntigravityFavoriteFlag(id) {
  const settings = normalizeTerminalAntigravitySettings(state.terminalAntigravity);
  const favorite = settings.favoriteFlags.find((item) => item.id === id);
  if (!favorite) {
    return;
  }

  const key = terminalClaudeFlagKey(favorite.flag);
  state.terminalAntigravity = normalizeTerminalAntigravitySettings({
    ...settings,
    favoriteFlags: settings.favoriteFlags.filter((item) => item.id !== id),
    activeFlags: settings.activeFlags.filter((flag) => terminalClaudeFlagKey(flag) !== key),
  });
  saveTerminalAntigravitySettings();
  renderTerminalModal();
}

function toggleTerminalOpencodeFavoriteFlag(id) {
  const settings = normalizeTerminalOpencodeSettings(state.terminalOpencode);
  const favorite = settings.favoriteFlags.find((item) => item.id === id);
  if (!favorite) {
    return;
  }

  const key = terminalClaudeFlagKey(favorite.flag);
  const nextActiveFlags = settings.activeFlags.some((flag) => terminalClaudeFlagKey(flag) === key)
    ? settings.activeFlags.filter((flag) => terminalClaudeFlagKey(flag) !== key)
    : [...settings.activeFlags, favorite.flag];

  state.terminalOpencode = normalizeTerminalOpencodeSettings({
    ...settings,
    activeFlags: nextActiveFlags,
  });
  saveTerminalOpencodeSettings();
  renderTerminalModal();
}

function addTerminalOpencodeFavoriteFlag() {
  const flag = normalizeTerminalClaudeFlagText(state.terminalOpencodeFlagDraft);
  if (!flag) {
    showToast('請輸入啟動旗標');
    return;
  }

  const settings = normalizeTerminalOpencodeSettings(state.terminalOpencode);
  const existing = settings.favoriteFlags.find((item) => terminalClaudeFlagKey(item.flag) === terminalClaudeFlagKey(flag));
  const favoriteFlags = existing
    ? settings.favoriteFlags
    : [
        ...settings.favoriteFlags,
        {
          id: createTerminalAgentFlagId('opencode', flag, new Set(settings.favoriteFlags.map((item) => item.id))),
          flag,
        },
      ];
  const activeFlags = settings.activeFlags.some((item) => terminalClaudeFlagKey(item) === terminalClaudeFlagKey(flag))
    ? settings.activeFlags
    : [...settings.activeFlags, flag];

  state.terminalOpencode = normalizeTerminalOpencodeSettings({
    ...settings,
    favoriteFlags,
    activeFlags,
  });
  state.terminalOpencodeFlagDraft = '';
  saveTerminalOpencodeSettings();
  renderTerminalModal();
}

function deleteTerminalOpencodeFavoriteFlag(id) {
  const settings = normalizeTerminalOpencodeSettings(state.terminalOpencode);
  const favorite = settings.favoriteFlags.find((item) => item.id === id);
  if (!favorite) {
    return;
  }

  const key = terminalClaudeFlagKey(favorite.flag);
  state.terminalOpencode = normalizeTerminalOpencodeSettings({
    ...settings,
    favoriteFlags: settings.favoriteFlags.filter((item) => item.id !== id),
    activeFlags: settings.activeFlags.filter((flag) => terminalClaudeFlagKey(flag) !== key),
  });
  saveTerminalOpencodeSettings();
  renderTerminalModal();
}

function beginTerminalTitleEdit(localId) {
  const session = findTerminalSession(localId);
  if (!session) {
    return;
  }
  if (session.readOnly) {
    showToast('Terminal is read-only from LAN/Tailscale.');
    return;
  }

  state.terminalActiveSessionId = localId;
  state.terminalTitleEditingId = localId;
  state.terminalTitleDraft = session.title || '';
  renderTerminalModal();
  window.requestAnimationFrame(() => {
    const input = elements.terminalWorkspace.querySelector(`[data-terminal-title-input="${CSS.escape(localId)}"]`);
    if (input) {
      input.focus();
      input.select();
    }
  });
}

function commitTerminalTitleEdit(localId) {
  if (state.terminalTitleEditingId !== localId) {
    return;
  }

  const session = findTerminalSession(localId);
  if (session) {
    const nextTitle = state.terminalTitleDraft.trim();
    if (nextTitle) {
      session.title = nextTitle;
      session.titleEdited = true;
      if (session.id) {
        state.terminalWorkspaceMetaBySessionId.set(session.id, terminalSessionMetadata(session));
      }
    }
  }
  state.terminalTitleEditingId = null;
  state.terminalTitleDraft = '';
  saveTerminalWorkspaceState();
  renderTerminalModal();
}

function cancelTerminalTitleEdit(localId) {
  if (state.terminalTitleEditingId !== localId) {
    return;
  }

  state.terminalTitleEditingId = null;
  state.terminalTitleDraft = '';
  renderTerminalModal();
}

function reorderTerminalSession(projectName, sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) {
    return false;
  }

  const projectSessions = terminalSessionsForProject(projectName);
  const sourceIndex = projectSessions.findIndex((session) => session.localId === sourceId);
  const targetIndex = projectSessions.findIndex((session) => session.localId === targetId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return false;
  }

  const reordered = [...projectSessions];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  let replacementIndex = 0;
  state.terminalSessions = state.terminalSessions.map((session) => {
    if (session.projectName !== projectName) {
      return session;
    }
    const replacement = reordered[replacementIndex];
    replacementIndex += 1;
    return replacement;
  });
  return true;
}

function clearTerminalTabDragClasses() {
  elements.terminalTabs.querySelectorAll('.is-dragging, .is-drag-over').forEach((node) => {
    node.classList.remove('is-dragging', 'is-drag-over');
  });
}

function terminalTabAtPoint(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  const directTab = element?.closest?.('[data-terminal-tab]');
  if (directTab) {
    return directTab;
  }

  const tabs = Array.from(elements.terminalTabs.querySelectorAll('[data-terminal-tab]'));
  return tabs
    .map((tab) => {
      const rect = tab.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return {
        tab,
        distance: Math.hypot(clientX - centerX, clientY - centerY),
        verticalMiss: Math.max(rect.top - clientY, clientY - rect.bottom, 0),
      };
    })
    .filter((item) => item.verticalMiss < 28)
    .sort((left, right) => left.distance - right.distance)[0]?.tab || null;
}

function updateTerminalTabDragTarget(targetTab) {
  elements.terminalTabs.querySelectorAll('.is-drag-over').forEach((node) => {
    if (node !== targetTab) {
      node.classList.remove('is-drag-over');
    }
  });
  if (targetTab) {
    targetTab.classList.add('is-drag-over');
  }
}

// ATM as a synthetic terminal project (its own install dir), surfaced via the status
// payload's manager.atm. Not part of the scanned project list.
function atmTerminalProject() {
  const atm = state.payload?.manager?.atm;
  if (!atm?.path) {
    return null;
  }
  return { name: atm.name || ATM_TERMINAL_PROJECT_NAME, path: atm.path, port: null, localUrl: atm.localUrl || '', isAtm: true };
}

// Projects selectable in the terminal manager / pipeline = scanned projects + ATM.
function terminalProjectList() {
  const projects = state.payload?.projects ? [...state.payload.projects] : [];
  const atm = atmTerminalProject();
  if (atm && !projects.some((project) => project.name === atm.name)) {
    projects.push(atm);
  }
  return projects;
}

function terminalProjectByName(name) {
  const atm = atmTerminalProject();
  if (atm && name === atm.name) {
    return atm;
  }
  return state.payload?.projects?.find((project) => project.name === name) || null;
}

function terminalOptionsForProject(projectName = state.terminalProjectName) {
  const project = terminalProjectByName(projectName);
  const rootDirectory = project ? { relativePath: '', label: '專案根目錄', path: project.path, hasChildren: true } : null;
  return state.terminalOptionsByProject.get(projectName) || {
    loading: false,
    directories: rootDirectory ? [rootDirectory] : [],
    directoryNodes: rootDirectory ? new Map([['', { ...rootDirectory, children: [], expanded: false, loaded: false, loading: false }]]) : new Map(),
    shells: [{ id: 'powershell', label: 'PowerShell' }],
    port: project?.port || null,
    localUrl: project?.localUrl || '',
  };
}

function selectedTerminalShellId(session, options = terminalOptionsForProject(session.projectName)) {
  return session.shellId || options.shells?.[0]?.id || 'powershell';
}

function selectedTerminalCwd(session, options = terminalOptionsForProject(session.projectName)) {
  if (session.cwdRelativePath !== undefined) {
    return session.cwdRelativePath;
  }

  return options.directories?.[0]?.relativePath || '';
}

function terminalShellLabel(shellId, options) {
  return options.shells?.find((shell) => shell.id === shellId)?.label || shellId || '終端';
}

function terminalDirectoryNode(relativePath, options) {
  return options.directoryNodes?.get(relativePath || '') || null;
}

function terminalSelectedDirectoryPath(session, options, project) {
  const relativePath = selectedTerminalCwd(session, options);
  const directory = terminalDirectoryNode(relativePath, options) || options.directories?.find((item) => (item.relativePath || '') === relativePath);
  if (directory?.path) {
    return directory.path;
  }

  return relativePath && project?.path ? `${project.path.replace(/[\\/]+$/g, '')}/${relativePath}` : project?.path || '';
}

function makeTerminalDirectoryNode(directory, patch = {}) {
  const relativePath = directory.relativePath || '';
  return {
    path: directory.path || '',
    relativePath,
    label: directory.label || relativePath || '專案根目錄',
    hasChildren: directory.hasChildren === true,
    children: [],
    expanded: false,
    loaded: false,
    loading: false,
    ...patch,
  };
}

async function loadTerminalOptions(projectName) {
  const current = state.terminalOptionsByProject.get(projectName);
  if (current && !current.loading && !current.error) {
    return current;
  }

  state.terminalOptionsByProject.set(projectName, {
    ...terminalOptionsForProject(projectName),
    loading: true,
    error: '',
  });
  renderTerminalModal();

  try {
    const options = await api(`/api/projects/${encodeURIComponent(projectName)}/terminal-options`);
    const rootDirectory = options.rootDirectory || options.directories?.[0] || { relativePath: '', label: '專案根目錄', path: options.defaultCwd || '' };
    const rootNode = makeTerminalDirectoryNode(rootDirectory, {
      expanded: false,
      loaded: false,
    });
    const normalized = {
      loading: false,
      error: '',
      directories: [rootNode],
      directoryNodes: new Map([[rootNode.relativePath, rootNode]]),
      shells: Array.isArray(options.shells) && options.shells.length ? options.shells : [{ id: 'powershell', label: 'PowerShell' }],
      port: options.port || state.payload?.projects.find((item) => item.name === projectName)?.port || null,
      localUrl: options.localUrl || state.payload?.projects.find((item) => item.name === projectName)?.localUrl || '',
    };
    state.terminalOptionsByProject.set(projectName, normalized);
    terminalSessionsForProject(projectName)
      .filter((session) => !session.id)
      .forEach((session) => {
        if (!session.shellId) {
          session.shellId = normalized.shells[0]?.id || '';
        }
        if (session.cwdRelativePath === undefined) {
          session.cwdRelativePath = normalized.directories[0]?.relativePath || '';
        }
      });
    renderTerminalModal();
    return normalized;
  } catch (error) {
    state.terminalOptionsByProject.set(projectName, {
      ...terminalOptionsForProject(projectName),
      loading: false,
      error: error.message,
    });
    showToast(error.message);
    renderTerminalModal();
    return state.terminalOptionsByProject.get(projectName);
  }
}

async function loadTerminalDirectory(projectName, relativePath = '') {
  const options = terminalOptionsForProject(projectName);
  const key = relativePath || '';
  const node = terminalDirectoryNode(key, options);
  if (!node || node.loading || node.loaded || !node.hasChildren) {
    return;
  }

  node.loading = true;
  node.expanded = true;
  renderTerminalModal();

  try {
    const payload = await api(`/api/projects/${encodeURIComponent(projectName)}/terminal-directories?path=${encodeURIComponent(key)}`);
    const children = Array.isArray(payload.children) ? payload.children : [];
    node.children = children.map((child) => child.relativePath || '');
    node.loaded = true;
    node.loading = false;
    node.error = '';
    children.forEach((child) => {
      const childKey = child.relativePath || '';
      const existing = options.directoryNodes.get(childKey);
      options.directoryNodes.set(childKey, {
        ...makeTerminalDirectoryNode(child),
        expanded: existing?.expanded || false,
        loaded: existing?.loaded || false,
        loading: false,
        children: existing?.children || [],
      });
    });
  } catch (error) {
    node.loading = false;
    node.error = error.message;
    showToast(error.message);
  } finally {
    renderTerminalModal();
  }
}

function createTerminalDraft(projectName, draftOptions = {}) {
  const options = terminalOptionsForProject(projectName);
  const sessionNumber = terminalSessionsForProject(projectName).length + 1;
  const readOnly = draftOptions.readOnly === true;
  const session = {
    localId: `terminal-${Date.now()}-${nextTerminalLocalId}`,
    id: null,
    projectName,
    title: readOnly ? `Claude launch ${sessionNumber}` : `對話 ${sessionNumber}`,
    titleEdited: false,
    input: '',
    output: '',
    cursor: 0,
    cols: 100,
    rows: 28,
    cwdRelativePath: options.directories?.[0]?.relativePath || '',
    shellId: options.shells?.[0]?.id || '',
    shellLabel: '',
    projectPort: options.port || null,
    projectLocalUrl: options.localUrl || '',
    running: false,
    interactive: false,
    readOnly,
    exitedAt: null,
    exitCode: null,
    exitSignal: null,
    busy: false,
  };

  nextTerminalLocalId += 1;
  state.terminalSessions.push(session);
  state.terminalActiveSessionId = session.localId;
  rememberTerminalActiveSession(projectName, session.localId);
  return session;
}

function ensureTerminalDraft(projectName, options = {}) {
  const sessions = terminalSessionsForProject(projectName);
  if (sessions.length) {
    const rememberedId = state.terminalActiveSessionByProject.get(projectName);
    state.terminalActiveSessionId = sessions.some((session) => session.localId === rememberedId)
      ? rememberedId
      : sessions.some((session) => session.localId === state.terminalActiveSessionId)
        ? state.terminalActiveSessionId
        : sessions[0].localId;
    rememberTerminalActiveSession(projectName, state.terminalActiveSessionId);
    return;
  }

  createTerminalDraft(projectName, options);
}

function switchTerminalProject(projectName, { ensureDraft = true } = {}) {
  if (!projectName) {
    return;
  }

  rememberTerminalActiveSession();
  state.selectedName = projectName;
  state.terminalProjectName = projectName;
  if (terminalCanAddSession() && ensureDraft && (state.terminalWorkspaceLoaded || !hasRestorableTerminalProject(projectName))) {
    ensureTerminalDraft(projectName, { readOnly: terminalIsReadOnly() });
  } else {
    const sessions = terminalSessionsForProject(projectName);
    const rememberedId = state.terminalActiveSessionByProject.get(projectName);
    state.terminalActiveSessionId = sessions.some((session) => session.localId === rememberedId)
      ? rememberedId
      : sessions[0]?.localId || null;
    rememberTerminalActiveSession(projectName, state.terminalActiveSessionId);
  }
  if (!terminalIsReadOnly()) {
    loadTerminalOptions(projectName);
  }
  saveTerminalWorkspaceState();
}

function openTerminalManager(projectName) {
  state.terminalProjectName = projectName;
  state.terminalModalOpen = true;
  state.terminalModalMode = 'terminal';
  // 開啟時就維持最大寬度,切換頁籤(設定/啟動/Pipeline...)時尺寸不會再縮回,
  // 與選到「終端」分頁時一致。使用者仍可用「放大」按鈕切回收合檢視。
  state.terminalManualFocus = true;
  elements.terminalModal.hidden = false;
  switchTerminalProject(projectName, { ensureDraft: true });
  renderTerminalModal();
  startTerminalPolling();
  loadTerminalSessions({ silent: true });
  // Pull the latest shared pipeline config (e.g. edited on a phone) right away.
  syncTerminalPipelineFromServer();
}

// Opens the terminal manager straight onto the Pipeline view (連續提示),
// e.g. from the homepage Pipeline button.
function openPipelineManager() {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }
  const projectName = state.terminalProjectName
    || state.selectedName
    || state.payload?.projects?.[0]?.name
    || '';
  openTerminalManager(projectName);
  state.terminalModalMode = 'pipeline';
  renderTerminalModal();
}

function hideTerminalManager() {
  rememberTerminalActiveSession();
  saveTerminalWorkspaceState();
  state.terminalModalOpen = false;
  elements.terminalModal.hidden = true;
  stopTerminalPolling();
  disposeUnusedTerminalViews();
}

function terminalProjectSessionCounts(projectName) {
  const sessions = startedTerminalSessionsForProject(projectName);
  return {
    total: sessions.length,
    running: sessions.filter((session) => !session.exitedAt && (session.running || session.id)).length,
  };
}

function terminalProjectNames() {
  const names = [];
  const add = (name) => {
    if (name && !names.includes(name)) {
      names.push(name);
    }
  };
  if (state.terminalModalOpen) {
    add(state.terminalProjectName);
  }
  state.terminalSessions.forEach((session) => add(session.projectName));
  return names;
}

function hasRestorableTerminalProject(projectName) {
  if (state.terminalSessions.some((session) => session.projectName === projectName)) {
    return true;
  }

  return [...state.terminalWorkspaceMetaBySessionId.values()]
    .some((session) => session.projectName === projectName);
}

// The 切換專案 cluster now lives inside the active tab's page (workspace) instead of a
// bar above the conversation tabs. Returns markup; renderTerminalModal injects it into
// the workspace. The 1s poll no longer rebuilds the workspace, so an open <select> is
// not snapped shut mid-interaction.
function renderTerminalProjectSwitcher() {
  const projects = terminalProjectList();
  const selectedProjectName = state.terminalProjectName || projects[0]?.name || '';
  const openProjectNames = terminalProjectNames();

  return `
    <div class="terminal-project-bar" aria-label="切換專案">
      <label class="terminal-project-picker">
        <span>切換專案</span>
        <select data-terminal-project-picker aria-label="切換終端專案">
          ${projects.map((project) => `
            <option value="${escapeHtml(project.name)}" ${project.name === selectedProjectName ? 'selected' : ''}>
              ${escapeHtml(project.name)}
            </option>
          `).join('')}
        </select>
      </label>
      <div class="terminal-project-windows" role="tablist" aria-label="已開啟的終端視窗">
        ${openProjectNames.map((projectName) => {
          const counts = terminalProjectSessionCounts(projectName);
          const active = projectName === state.terminalProjectName;
          return `
            <button
              class="terminal-project-window ${active ? 'is-active' : ''}"
              data-terminal-project-window="${escapeHtml(projectName)}"
              type="button"
              role="tab"
              aria-selected="${active ? 'true' : 'false'}"
              title="${escapeHtml(projectName)}"
            >
              <span>${escapeHtml(projectName)}</span>
              <strong>${counts.total}</strong>
              ${counts.running ? '<i aria-hidden="true"></i>' : ''}
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// A small indeterminate progress bar + 中斷 button shown while a session is waiting on a
// server round-trip (launch / send / close). The abort button cancels the in-flight
// request via the AbortController stashed on the session.
function renderTerminalBusyBar(session) {
  if (!session?.busy) {
    return '';
  }
  const label = session.busyLabel || '處理中…';
  const canAbort = Boolean(session.busyAbort);
  return `
    <div class="terminal-busy-bar" role="status" aria-live="polite">
      <div class="terminal-busy-track"><div class="terminal-busy-fill"></div></div>
      <span class="terminal-busy-label">${escapeHtml(label)}</span>
      ${canAbort ? `<button class="copy-url danger-action terminal-busy-abort" data-terminal-busy-abort="${escapeHtml(session.localId)}" type="button">${icons.stop}<span>中斷</span></button>` : ''}
    </div>
  `;
}

// Marks a session busy with a label + a fresh AbortController so the 中斷 button can
// cancel the in-flight request. Returns the controller's signal to pass to api().
function beginTerminalSessionBusy(session, label) {
  const controller = new AbortController();
  session.busy = true;
  session.busyLabel = label || '處理中…';
  session.busyAbort = controller;
  session.busyAborted = false;
  return controller.signal;
}

function endTerminalSessionBusy(session) {
  if (!session) {
    return;
  }
  session.busy = false;
  session.busyLabel = '';
  session.busyAbort = null;
}

function abortTerminalSessionBusy(localId) {
  const session = findTerminalSession(localId);
  if (!session || !session.busy || !session.busyAbort) {
    return;
  }
  session.busyAborted = true;
  try {
    session.busyAbort.abort();
  } catch {
    // The request may already have settled.
  }
  showToast('已中斷');
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function renderTerminalTabs() {
  const sessions = terminalSessionsForProject();
  elements.terminalTabs.innerHTML = sessions
    .map((session) => {
      const active = session.localId === state.terminalActiveSessionId;
      const statusClass = session.exitedAt ? 'is-closed' : session.running ? 'is-running' : 'is-draft';
      const title = session.title;
      const longTitle = String(title || '').length > TERMINAL_TITLE_MARQUEE_LENGTH;
      const titleContent = longTitle
        ? `<span class="terminal-tab-title-track"><span>${escapeHtml(title)}</span><span aria-hidden="true">${escapeHtml(title)}</span></span>`
        : `<span class="terminal-tab-title-text">${escapeHtml(title)}</span>`;
      return `
        <div
          class="terminal-tab ${active ? 'is-active' : ''}"
          data-terminal-tab="${escapeHtml(session.localId)}"
          role="tab"
          tabindex="0"
          aria-selected="${active ? 'true' : 'false'}"
        >
          <button class="terminal-tab-drag-handle" data-terminal-tab-drag-handle type="button" title="拖曳調整順序" aria-label="拖曳調整 ${escapeHtml(session.title)} 的順序">${icons.grip}</button>
          <span class="terminal-tab-dot ${statusClass}" aria-hidden="true"></span>
          <span class="terminal-tab-title">
            <span class="terminal-tab-title-label ${longTitle ? 'is-marquee' : ''}" title="${escapeHtml(session.title)}">${titleContent}</span>
          </span>
          <button class="terminal-tab-close" data-terminal-tab-close="${escapeHtml(session.localId)}" type="button" title="關閉頁籤" aria-label="關閉 ${escapeHtml(session.title)}">${icons.remove}</button>
        </div>
      `;
    })
    .join('');
}

function terminalStatusLabel(session) {
  if (session.busy) {
    return '處理中';
  }
  if (session.exitedAt) {
    return '已關閉';
  }
  if (session.running) {
    return '已連線';
  }
  return '尚未開啟';
}

function renderTerminalDirectoryTree(session, options) {
  const root = terminalDirectoryNode('', options);
  if (!root) {
    return '<div class="terminal-directory-empty">尚未讀取目錄</div>';
  }

  const selectedCwd = selectedTerminalCwd(session, options);
  const renderNode = (node, depth = 0) => {
    const selected = selectedCwd === node.relativePath;
    const expanded = Boolean(node.expanded);
    const canExpand = Boolean(node.hasChildren);
    const children = canExpand && expanded
      ? (node.children || [])
          .map((childPath) => terminalDirectoryNode(childPath, options))
          .filter(Boolean)
          .map((childNode) => renderNode(childNode, depth + 1))
          .join('')
      : '';
    const note = canExpand && expanded && node.loaded && !node.children?.length
      ? `<div class="terminal-directory-note" style="--depth: ${depth + 1}">沒有子資料夾</div>`
      : node.error
        ? `<div class="terminal-directory-note is-error" style="--depth: ${depth + 1}">${escapeHtml(node.error)}</div>`
        : '';

    return `
      <div class="terminal-directory-node">
        <div class="terminal-directory-row ${selected ? 'is-selected' : ''}" style="--depth: ${depth}">
          <button
            class="terminal-directory-toggle ${canExpand ? '' : 'is-placeholder'} ${expanded ? 'is-expanded' : ''}"
            data-terminal-dir-toggle="${escapeHtml(node.relativePath)}"
            type="button"
            title="${canExpand ? (expanded ? '收合目錄' : '展開目錄') : ''}"
            aria-label="${canExpand ? `${expanded ? '收合' : '展開'} ${escapeHtml(node.label)}` : ''}"
            ${canExpand ? '' : 'disabled'}
          >${canExpand ? '<span class="terminal-directory-arrow" aria-hidden="true"></span>' : ''}</button>
          <button
            class="terminal-directory-name"
            data-terminal-dir-select="${escapeHtml(node.relativePath)}"
            type="button"
            aria-pressed="${selected ? 'true' : 'false'}"
            title="${escapeHtml(node.path || node.label)}"
          >
            <span>${escapeHtml(node.label)}</span>
            ${node.loading ? '<span class="terminal-directory-loading">讀取中</span>' : ''}
          </button>
        </div>
        ${children}
        ${note}
      </div>
    `;
  };

  return `<div class="terminal-directory-tree">${renderNode(root)}</div>`;
}

function renderTerminalSetup(session, options, project, sessionTitleControl, projectPort) {
  const shells = options.shells?.length
    ? options.shells
    : [{ id: 'powershell', label: 'PowerShell' }];
  const selectedShellId = selectedTerminalShellId(session, options);
  const selectedPath = session.cwd || terminalSelectedDirectoryPath(session, options, project);
  const shellLabel = session.shellLabel || terminalShellLabel(selectedShellId, options);
  const disabled = session.readOnly || session.busy || options.loading ? 'disabled' : '';
  const shellControl = session.id
    ? `<div class="terminal-shell-value" title="${escapeHtml(shellLabel)}">${escapeHtml(shellLabel)}</div>`
    : `<select data-terminal-shell="${escapeHtml(session.localId)}" ${disabled}>
        ${shells.map((shell) => `
          <option value="${escapeHtml(shell.id)}" ${selectedShellId === shell.id ? 'selected' : ''}>
            ${escapeHtml(shell.label || shell.id)}
          </option>
        `).join('')}
      </select>`;

  return `
    <div class="terminal-setup">
      <div class="terminal-config-row">
        <div class="terminal-title-field">
          <span class="terminal-setup-label">對話名稱</span>
          ${sessionTitleControl}
        </div>
        <div class="terminal-path-field">
          <span class="terminal-setup-label">開啟位置</span>
          <div class="terminal-directory-path" title="${escapeHtml(selectedPath)}">${escapeHtml(selectedPath || '--')}</div>
        </div>
        <div class="terminal-port-field">
          <span class="terminal-setup-label">Port</span>
          <div class="terminal-port-value">${escapeHtml(projectPort)}</div>
        </div>
        <label class="terminal-shell-field">
          <span>終端類型</span>
          ${shellControl}
        </label>
      </div>
      ${session.id || session.readOnly ? '' : `
        <div class="terminal-directory-panel">
          ${renderTerminalDirectoryTree(session, options)}
        </div>
      `}
    </div>
  `;
}

function renderTerminalAgentTabs() {
  const activeAgentId = terminalFavoriteAgentId();
  return `
    <div class="terminal-agent-tabs" role="tablist" aria-label="Agent quick launch">
      ${TERMINAL_AGENT_TABS.map((agent) => {
        const active = activeAgentId === agent.id;
        return `
          <button
            class="terminal-agent-tab ${active ? 'is-active' : ''}"
            data-terminal-agent-tab="${escapeHtml(agent.id)}"
            type="button"
            role="tab"
            aria-selected="${active ? 'true' : 'false'}"
            title="${escapeHtml(agent.label)}"
          >${escapeHtml(agent.tab || agent.label)}</button>
        `;
      }).join('')}
    </div>
  `;
}

function renderTerminalActiveAgentLauncher(session, options) {
  const activeAgentId = terminalFavoriteAgentId();
  if (activeAgentId === 'codex') {
    return renderTerminalCodexLauncher(session, options);
  }
  if (activeAgentId === 'antigravity') {
    return renderTerminalAntigravityLauncher(session, options);
  }
  if (activeAgentId === 'opencode') {
    return renderTerminalOpencodeLauncher(session, options);
  }
  return renderTerminalClaudeLauncher(session, options);
}

function renderTerminalClaudeLauncher(session, options) {
  const settings = normalizeTerminalClaudeSettings(state.terminalClaude);
  const preview = buildTerminalClaudeCommand();
  const canUseClaude = terminalCanUseClaudeLauncher(session);
  const disabled = canUseClaude ? '' : 'disabled';
  const commandDisabled = canUseClaude && !(!session.id && options.loading) ? '' : 'disabled';
  const selectedModelOption = settings.customModel
    ? TERMINAL_CLAUDE_CUSTOM_MODEL_VALUE
    : terminalClaudeModelOptionValue(settings.model);
  const modelOptions = [
    ...TERMINAL_CLAUDE_MODEL_OPTIONS,
    { value: TERMINAL_CLAUDE_CUSTOM_MODEL_VALUE, label: 'Custom full model' },
  ];
  const customModelInput = selectedModelOption === TERMINAL_CLAUDE_CUSTOM_MODEL_VALUE
    ? `<input class="terminal-claude-custom-model" data-terminal-claude-custom-model type="text" value="${escapeHtml(settings.model)}" placeholder="claude-sonnet-4-6" spellcheck="false" ${disabled} />`
    : '';
  const activeFlagKeys = new Set(settings.activeFlags.map((flag) => terminalClaudeFlagKey(flag)));
  const favoriteFlags = settings.favoriteFlags.map((item) => {
    const active = activeFlagKeys.has(terminalClaudeFlagKey(item.flag));
    return `
      <div class="terminal-claude-flag-item ${active ? 'is-active' : ''}">
        <button
          class="terminal-claude-flag-toggle"
          data-terminal-claude-favorite-flag="${escapeHtml(item.id)}"
          type="button"
          aria-pressed="${active ? 'true' : 'false'}"
          ${disabled}
        ><span>${escapeHtml(item.flag)}</span></button>
        <button
          class="terminal-claude-flag-delete"
          data-terminal-claude-delete-flag="${escapeHtml(item.id)}"
          type="button"
          title="刪除旗標"
          aria-label="刪除旗標 ${escapeHtml(item.flag)}"
          ${disabled}
        >${icons.remove}</button>
      </div>
    `;
  }).join('');
  const commandButtons = TERMINAL_CLAUDE_COMMANDS.map((command) => {
    const active = settings.command === command;
    return `
      <button
        class="terminal-claude-command-button ${active ? 'is-active' : ''}"
        data-terminal-claude-command="${escapeHtml(command)}"
        type="button"
        aria-label="啟動 ${escapeHtml(command)}"
        aria-pressed="${active ? 'true' : 'false'}"
        ${commandDisabled}
      >${escapeHtml(command)}</button>
    `;
  }).join('');

  return `
    <section class="terminal-claude-launcher" aria-label="Claude Code">
      <div class="terminal-claude-header">
        <div>
          <strong>Claude Code</strong>
          <span data-terminal-claude-preview>${escapeHtml(preview)}</span>
        </div>
      </div>
      <div class="terminal-claude-grid">
        <div class="terminal-claude-command" role="group" aria-label="Claude command">
          ${commandButtons}
        </div>
        <label class="terminal-claude-field terminal-claude-model-field">
          <span>--model</span>
          <select data-terminal-claude-model ${disabled}>
            ${modelOptions.map((option) => `
              <option value="${escapeHtml(option.value)}" ${selectedModelOption === option.value ? 'selected' : ''}>
                ${escapeHtml(option.label)}
              </option>
            `).join('')}
          </select>
          ${customModelInput}
        </label>
        <label class="terminal-claude-field terminal-claude-effort-field">
          <span>--effort</span>
          <select data-terminal-claude-effort ${disabled}>
            ${TERMINAL_CLAUDE_EFFORT_OPTIONS.map((option) => `
              <option value="${escapeHtml(option.value)}" ${settings.effort === option.value ? 'selected' : ''}>
                ${escapeHtml(option.label)}
              </option>
            `).join('')}
          </select>
        </label>
        <label class="terminal-claude-field terminal-claude-permission-field">
          <span>--permission-mode</span>
          <select data-terminal-claude-permission-mode ${disabled}>
            ${TERMINAL_CLAUDE_PERMISSION_MODE_OPTIONS.map((option) => `
              <option value="${escapeHtml(option.value)}" ${settings.permissionMode === option.value ? 'selected' : ''}>
                ${escapeHtml(option.label)}
              </option>
            `).join('')}
          </select>
        </label>
      </div>
      <div class="terminal-claude-flags">
        <div class="terminal-claude-flags-heading">其他啟動旗標</div>
        <div class="terminal-claude-flag-list">
          ${favoriteFlags}
        </div>
        <div class="terminal-claude-flag-add">
          <input data-terminal-claude-flag-draft type="text" value="${escapeHtml(state.terminalClaudeFlagDraft)}" placeholder="--flag value" spellcheck="false" ${disabled} />
          <button class="copy-url" data-terminal-claude-add-flag type="button" ${disabled}>${icons.add}<span>加入最愛</span></button>
        </div>
      </div>
    </section>
  `;
}

function renderTerminalAgentFlagControls({
  agentId,
  activeFlags,
  favoriteFlags,
  draft,
  disabled,
}) {
  const activeFlagKeys = new Set(activeFlags.map((flag) => terminalClaudeFlagKey(flag)));
  const flags = favoriteFlags.map((item) => {
    const active = activeFlagKeys.has(terminalClaudeFlagKey(item.flag));
    return `
      <div class="terminal-claude-flag-item ${active ? 'is-active' : ''}">
        <button
          class="terminal-claude-flag-toggle"
          data-terminal-${agentId}-favorite-flag="${escapeHtml(item.id)}"
          type="button"
          aria-pressed="${active ? 'true' : 'false'}"
          ${disabled}
        ><span>${escapeHtml(item.flag)}</span></button>
        <button
          class="terminal-claude-flag-delete"
          data-terminal-${agentId}-delete-flag="${escapeHtml(item.id)}"
          type="button"
          title="刪除旗標"
          aria-label="刪除旗標 ${escapeHtml(item.flag)}"
          ${disabled}
        >${icons.remove}</button>
      </div>
    `;
  }).join('');

  return `
    <div class="terminal-claude-flags">
      <div class="terminal-claude-flags-heading">其他啟動旗標</div>
      <div class="terminal-claude-flag-list">
        ${flags}
      </div>
      <div class="terminal-claude-flag-add">
        <input data-terminal-${agentId}-flag-draft type="text" value="${escapeHtml(draft)}" placeholder="--flag value" spellcheck="false" ${disabled} />
        <button class="copy-url" data-terminal-${agentId}-add-flag type="button" ${disabled}>${icons.add}<span>加入最愛</span></button>
      </div>
    </div>
  `;
}

function renderTerminalCodexLauncher(session, options) {
  const settings = normalizeTerminalCodexSettings(state.terminalCodex);
  const preview = buildTerminalCodexCommand();
  const canUseCodex = terminalCanUseAgentLauncher(session);
  const disabled = canUseCodex ? '' : 'disabled';
  const commandDisabled = canUseCodex && !(!session.id && options.loading) ? '' : 'disabled';
  const commandButtons = TERMINAL_CODEX_COMMANDS.map((command) => {
    const active = settings.command === command;
    return `
      <button
        class="terminal-claude-command-button ${active ? 'is-active' : ''}"
        data-terminal-codex-command="${escapeHtml(command)}"
        type="button"
        aria-label="Launch ${escapeHtml(command)}"
        aria-pressed="${active ? 'true' : 'false'}"
        ${commandDisabled}
      >${escapeHtml(command)}</button>
    `;
  }).join('');
  const flags = renderTerminalAgentFlagControls({
    agentId: 'codex',
    activeFlags: settings.activeFlags,
    favoriteFlags: settings.favoriteFlags,
    draft: state.terminalCodexFlagDraft,
    disabled,
  });

  return `
    <section class="terminal-claude-launcher terminal-agent-launcher" aria-label="Codex CLI">
      <div class="terminal-claude-header">
        <div>
          <strong>Codex CLI</strong>
          <span data-terminal-agent-preview="codex">${escapeHtml(preview)}</span>
        </div>
      </div>
      <div class="terminal-claude-grid terminal-agent-grid">
        <div class="terminal-claude-command" role="group" aria-label="Codex command">
          ${commandButtons}
        </div>
        <label class="terminal-claude-field">
          <span>--model</span>
          <input data-terminal-codex-model type="text" value="${escapeHtml(settings.model)}" placeholder="gpt-5.4" spellcheck="false" ${disabled} />
        </label>
        <label class="terminal-claude-field">
          <span>--sandbox</span>
          <select data-terminal-codex-sandbox ${disabled}>
            ${TERMINAL_CODEX_SANDBOX_OPTIONS.map((option) => `
              <option value="${escapeHtml(option.value)}" ${settings.sandbox === option.value ? 'selected' : ''}>
                ${escapeHtml(option.label)}
              </option>
            `).join('')}
          </select>
        </label>
        <label class="terminal-claude-field terminal-agent-wide-field">
          <span>--ask-for-approval</span>
          <select data-terminal-codex-approval ${disabled}>
            ${TERMINAL_CODEX_APPROVAL_OPTIONS.map((option) => `
              <option value="${escapeHtml(option.value)}" ${settings.approval === option.value ? 'selected' : ''}>
                ${escapeHtml(option.label)}
              </option>
            `).join('')}
          </select>
        </label>
      </div>
      ${flags}
    </section>
  `;
}

function renderTerminalAntigravityLauncher(session, options) {
  const settings = normalizeTerminalAntigravitySettings(state.terminalAntigravity);
  const preview = buildTerminalAntigravityCommand();
  const canUseAntigravity = terminalCanUseAgentLauncher(session);
  const disabled = canUseAntigravity ? '' : 'disabled';
  const commandDisabled = canUseAntigravity && !(!session.id && options.loading) ? '' : 'disabled';
  const commandButtons = TERMINAL_ANTIGRAVITY_COMMANDS.map((command) => {
    const active = settings.command === command;
    return `
      <button
        class="terminal-claude-command-button ${active ? 'is-active' : ''}"
        data-terminal-antigravity-command="${escapeHtml(command)}"
        type="button"
        aria-label="Launch ${escapeHtml(command)}"
        aria-pressed="${active ? 'true' : 'false'}"
        ${commandDisabled}
      >${escapeHtml(command)}</button>
    `;
  }).join('');
  const flags = renderTerminalAgentFlagControls({
    agentId: 'antigravity',
    activeFlags: settings.activeFlags,
    favoriteFlags: settings.favoriteFlags,
    draft: state.terminalAntigravityFlagDraft,
    disabled,
  });

  return `
    <section class="terminal-claude-launcher terminal-agent-launcher" aria-label="Antigravity CLI">
      <div class="terminal-claude-header">
        <div>
          <strong>Antigravity CLI</strong>
          <span data-terminal-agent-preview="antigravity">${escapeHtml(preview)}</span>
        </div>
      </div>
      <div class="terminal-agent-compact-grid">
        <div class="terminal-claude-command terminal-agent-single-command" role="group" aria-label="Antigravity command">
          ${commandButtons}
        </div>
        ${flags}
      </div>
    </section>
  `;
}

function renderTerminalOpencodeLauncher(session, options) {
  const settings = normalizeTerminalOpencodeSettings(state.terminalOpencode);
  const preview = buildTerminalOpencodeCommand();
  const canUseOpencode = terminalCanUseAgentLauncher(session);
  const disabled = canUseOpencode ? '' : 'disabled';
  const commandDisabled = canUseOpencode && !(!session.id && options.loading) ? '' : 'disabled';
  const commandButtons = TERMINAL_OPENCODE_COMMANDS.map((command) => {
    const active = settings.command === command;
    return `
      <button
        class="terminal-claude-command-button ${active ? 'is-active' : ''}"
        data-terminal-opencode-command="${escapeHtml(command)}"
        type="button"
        aria-label="Launch ${escapeHtml(command)}"
        aria-pressed="${active ? 'true' : 'false'}"
        ${commandDisabled}
      >${escapeHtml(command)}</button>
    `;
  }).join('');
  const flags = renderTerminalAgentFlagControls({
    agentId: 'opencode',
    activeFlags: settings.activeFlags,
    favoriteFlags: settings.favoriteFlags,
    draft: state.terminalOpencodeFlagDraft,
    disabled,
  });

  return `
    <section class="terminal-claude-launcher terminal-agent-launcher" aria-label="opencode">
      <div class="terminal-claude-header">
        <div>
          <strong>opencode</strong>
          <span data-terminal-agent-preview="opencode">${escapeHtml(preview)}</span>
        </div>
      </div>
      <div class="terminal-claude-grid terminal-agent-grid">
        <div class="terminal-claude-command" role="group" aria-label="opencode command">
          ${commandButtons}
        </div>
        <label class="terminal-claude-field terminal-agent-wide-field">
          <span>--model</span>
          <input data-terminal-opencode-model type="text" value="${escapeHtml(settings.model)}" placeholder="anthropic/claude-sonnet-4-6" spellcheck="false" ${disabled} />
        </label>
      </div>
      ${flags}
    </section>
  `;
}

function renderTerminalFavorites(session) {
  const editing = Boolean(state.terminalFavoriteEditingId);
  const activeAgentLabel = terminalAgentLabel();
  const editor = editing
    ? `
      <div class="terminal-favorite-editor">
        <label class="terminal-favorite-command-field">
          <span>指令</span>
          <textarea data-terminal-favorite-command rows="2" spellcheck="false" aria-label="我的最愛指令">${escapeHtml(state.terminalFavoriteDraftCommand)}</textarea>
        </label>
        <label class="terminal-favorite-note-field">
          <span>附註</span>
          <input data-terminal-favorite-note type="text" value="${escapeHtml(state.terminalFavoriteDraftNote)}" aria-label="我的最愛指令附註" placeholder="例如：延續目前對話" />
        </label>
        <div class="terminal-favorite-editor-actions">
          <button class="copy-url primary-action" data-terminal-favorite-save type="button">${icons.save}<span>儲存</span></button>
          <button class="copy-url" data-terminal-favorite-cancel type="button">取消</button>
        </div>
      </div>
    `
    : '';

  const hasFavoriteOverflow = state.terminalFavorites.length > TERMINAL_FAVORITE_COLLAPSED_ROWS;
  const favoritesCollapsed = hasFavoriteOverflow && !state.terminalFavoritesExpanded;
  const overflowControl = hasFavoriteOverflow
    ? `
      <button class="terminal-favorite-overflow-button" data-terminal-favorite-toggle type="button">
        ${state.terminalFavoritesExpanded ? '收合' : `展開全部 ${state.terminalFavorites.length}`}
      </button>
    `
    : '';

  const list = state.terminalFavorites.length
    ? state.terminalFavorites.map((favorite) => {
      const longCommand = favorite.command.length > TERMINAL_FAVORITE_MARQUEE_LENGTH;
      const commandContent = longCommand
        ? `<span class="terminal-favorite-command-track"><span>${escapeHtml(favorite.command)}</span><span aria-hidden="true">${escapeHtml(favorite.command)}</span></span>`
        : `<span class="terminal-favorite-command-text">${escapeHtml(favorite.command)}</span>`;
      return `
        <div class="terminal-favorite-item">
          <button class="terminal-favorite-apply" data-terminal-favorite-apply="${escapeHtml(favorite.id)}" type="button" aria-label="套用我的最愛指令 ${escapeHtml(favorite.command)}">
            <span class="terminal-favorite-command ${longCommand ? 'is-marquee' : ''}">${commandContent}</span>
            ${favorite.note ? `<span class="terminal-favorite-note">${escapeHtml(favorite.note)}</span>` : ''}
          </button>
          <div class="terminal-favorite-actions">
            <button class="terminal-favorite-icon-button" data-terminal-favorite-edit="${escapeHtml(favorite.id)}" type="button" title="編輯" aria-label="編輯我的最愛指令">${icons.edit}</button>
            <button class="terminal-favorite-icon-button is-danger" data-terminal-favorite-delete="${escapeHtml(favorite.id)}" type="button" title="刪除" aria-label="刪除我的最愛指令">${icons.remove}</button>
          </div>
        </div>
      `;
    }).join('')
    : '<div class="terminal-favorite-empty">尚未加入我的最愛指令</div>';

  return `
    <section class="terminal-favorites" aria-label="我的最愛指令">
      <div class="terminal-favorites-heading">
        <span>${escapeHtml(activeAgentLabel)} 我的最愛指令</span>
        <div>
          <button class="copy-url terminal-favorite-current-button" data-terminal-favorite-current type="button">${icons.add}<span>加入目前</span></button>
          <button class="copy-url terminal-favorite-add-button" data-terminal-favorite-add type="button">${icons.add}<span>新增</span></button>
        </div>
      </div>
      ${editor}
      <div class="terminal-favorite-list ${favoritesCollapsed ? 'is-collapsed' : ''}">
        ${list}
      </div>
      ${overflowControl}
    </section>
  `;
}

function renderTerminalScrollControls(session) {
  if (!session.id || !session.interactive) {
    return '';
  }

  const localId = escapeHtml(session.localId);
  const controls = [
    ['top', '到最上方', icons.scrollTop],
    ['up', '往上翻一頁', icons.scrollUp],
    ['down', '往下翻一頁', icons.scrollDown],
    ['bottom', '到最下方', icons.scrollBottom],
  ];

  return `
    <div class="terminal-scroll-controls" aria-label="終端捲動控制">
      ${controls.map(([direction, label, icon]) => `
        <button class="terminal-scroll-button" data-terminal-scroll="${direction}" data-terminal-scroll-session="${localId}" type="button" title="${label}" aria-label="${label}">
          ${icon}
        </button>
      `).join('')}
    </div>
  `;
}

function effectiveTerminalContentTab(session) {
  if (state.terminalContentTab && TERMINAL_CONTENT_TAB_IDS.has(state.terminalContentTab)) {
    return state.terminalContentTab;
  }
  // The 終端 tab is the default for every state — it shows launch settings until a
  // terminal is live, then the terminal surface.
  return 'terminal';
}

// Whether the 終端 tab should show the terminal surface (true) or the launch settings
// + agent launcher (false). Any launched session (has a server id) shows the surface;
// an un-launched draft shows the settings. Mirrors the old terminal/agent split.
function terminalTabIsLive(session) {
  return Boolean(session?.id);
}

function renderTerminalContentTabBar(activeTab) {
  return `
    <div class="terminal-content-tabs" role="tablist" aria-label="終端內容分頁">
      ${TERMINAL_CONTENT_TABS.map((tab) => {
        const active = tab.id === activeTab;
        const running = tab.id === 'pipeline' && state.terminalPipelineRun.active;
        return `
          <button
            class="terminal-content-tab ${active ? 'is-active' : ''}"
            data-terminal-content-tab-button="${escapeHtml(tab.id)}"
            type="button"
            role="tab"
            aria-selected="${active ? 'true' : 'false'}"
          >${escapeHtml(tab.label)}${running ? '<span class="terminal-content-tab-dot" aria-hidden="true"></span>' : ''}</button>
        `;
      }).join('')}
    </div>
  `;
}

function terminalFocusActive(session) {
  if (state.terminalManualFocus) {
    return true;
  }
  if (!session) {
    return false;
  }
  if (state.terminalPipelineRun.active && state.terminalPipelineRun.sessionLocalId === session.localId) {
    return true;
  }
  return Boolean(session.id && session.running && session.interactive);
}

// When a process becomes live we switch to the 終端 tab once (unless a pipeline
// is driving the run, where the user likely wants the Pipeline tab).
function applyTerminalFocusAuto(session) {
  const live = Boolean(session?.id && session.running && session.interactive);
  if (live) {
    if (state.terminalFocusAppliedSessionId !== session.localId) {
      if (!state.terminalPipelineRun.active) {
        state.terminalContentTab = 'terminal';
      }
      state.terminalFocusAppliedSessionId = session.localId;
    }
  } else if (state.terminalFocusAppliedSessionId === session.localId) {
    state.terminalFocusAppliedSessionId = null;
  }
}

function pipelineStatusMeta() {
  const map = {
    idle: { label: '待命', cls: 'is-idle' },
    running: { label: '執行中', cls: 'is-running' },
    quota: { label: '檢查配額', cls: 'is-running' },
    'quota-stopped': { label: '配額不足', cls: 'is-warn' },
    done: { label: '完成', cls: 'is-done' },
    stopped: { label: '已停止', cls: 'is-warn' },
    error: { label: '錯誤', cls: 'is-error' },
  };
  return map[state.terminalPipelineRun.status] || map.idle;
}

function renderPipelineStatusBadge() {
  const run = state.terminalPipelineRun;
  const meta = pipelineStatusMeta();
  const progress = run.total ? `${Math.max(0, run.stepIndex + 1)}/${run.total}` : '';
  return `
    <div class="terminal-pipeline-status">
      <span class="terminal-pipeline-badge ${meta.cls}" data-pipeline-status-badge>${escapeHtml(meta.label)}</span>
      <span class="terminal-pipeline-progress" data-pipeline-progress>${escapeHtml(progress)}</span>
      <span class="terminal-pipeline-message" data-pipeline-status-message>${escapeHtml(run.message || '')}</span>
    </div>
  `;
}

function renderPipelineLogEntries() {
  const log = state.terminalPipelineRun.log;
  if (!log.length) {
    return '<div class="terminal-pipeline-log-empty">尚無執行紀錄</div>';
  }
  return log
    .map((entry) => `
      <div class="terminal-pipeline-log-entry is-${escapeHtml(entry.level)}">
        <span class="terminal-pipeline-log-time">${escapeHtml(entry.time)}</span>
        <span class="terminal-pipeline-log-text">${escapeHtml(entry.text)}</span>
      </div>
    `)
    .join('');
}

// Lightweight DOM refresh for the pipeline header/log that avoids rebuilding the
// terminal surface (which would re-mount xterm and reconnect the socket).
function renderPipelineRunState() {
  if (!state.terminalModalOpen) {
    return;
  }
  const run = state.terminalPipelineRun;
  const meta = pipelineStatusMeta();
  const progressText = run.total ? `${Math.max(0, run.stepIndex + 1)}/${run.total}` : '';
  // The status badge/progress/message can appear both in the Pipeline tab and in
  // the persistent run bar, so update every matching node.
  elements.terminalWorkspace.querySelectorAll('[data-pipeline-status-badge]').forEach((badge) => {
    badge.textContent = meta.label;
    badge.className = `terminal-pipeline-badge ${meta.cls}`;
  });
  elements.terminalWorkspace.querySelectorAll('[data-pipeline-progress]').forEach((progress) => {
    progress.textContent = progressText;
  });
  elements.terminalWorkspace.querySelectorAll('[data-pipeline-status-message]').forEach((message) => {
    message.textContent = run.message || '';
  });
  const log = elements.terminalWorkspace.querySelector('[data-pipeline-log]');
  if (log) {
    log.innerHTML = renderPipelineLogEntries();
    log.scrollTop = log.scrollHeight;
  }
  elements.terminalWorkspace.querySelectorAll('[data-pipeline-step]').forEach((node) => {
    node.classList.toggle('is-active', run.active && node.dataset.pipelineStep === run.activeStepId);
  });
  // Keep the Pipeline tab's running dot in sync.
  const pipelineTabButton = elements.terminalWorkspace.querySelector('[data-terminal-content-tab-button="pipeline"]');
  if (pipelineTabButton) {
    const hasDot = Boolean(pipelineTabButton.querySelector('.terminal-content-tab-dot'));
    if (run.active && !hasDot) {
      pipelineTabButton.insertAdjacentHTML('beforeend', '<span class="terminal-content-tab-dot" aria-hidden="true"></span>');
    } else if (!run.active && hasDot) {
      pipelineTabButton.querySelector('.terminal-content-tab-dot')?.remove();
    }
  }
}

function renderPipelineControls(session, { compact = false } = {}) {
  const running = state.terminalPipelineRun.active;
  const readOnly = terminalIsReadOnly();
  const resumable = hasResumablePipelineRun();
  return `
    <div class="terminal-pipeline-controls ${compact ? 'is-compact' : ''}">
      ${renderPipelineStatusBadge()}
      ${running
        ? `<button class="copy-url danger-action terminal-pipeline-stop" data-pipeline-stop type="button">${icons.stop}<span>停止</span></button>`
        : (compact
          ? ''
          : `
            ${resumable ? `<button class="copy-url terminal-pipeline-resume" data-pipeline-resume type="button" ${readOnly ? 'disabled' : ''} title="從上次未完成的段落接續">${icons.start}<span>接續</span></button>` : ''}
            <button class="copy-url primary-action terminal-pipeline-run" data-pipeline-run type="button" ${readOnly ? 'disabled' : ''}>${icons.start}<span>執行</span></button>
          `)}
    </div>
  `;
}

function renderTerminalPipeline(session) {
  const config = getTerminalPipeline();
  const run = state.terminalPipelineRun;
  const running = run.active;
  const agentId = terminalFavoriteAgentId();
  const agentLabel = terminalAgentLabel(agentId);
  const quota = config.quotaGate;

  const projects = terminalProjectList();
  const projectOptions = (selected) => `
    <option value="" ${selected ? '' : 'selected'}>預設專案</option>
    ${projects.map((project) => `<option value="${escapeHtml(project.name)}" ${project.name === selected ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
    <option value="${TERMINAL_NEW_PROJECT_OPTION}">＋ 新增專案…</option>
  `;

  const stepsHtml = config.steps.map((step, index) => {
    const isActive = running && run.activeStepId === step.id;
    return `
      <div class="terminal-pipeline-step ${isActive ? 'is-active' : ''}" data-pipeline-step="${escapeHtml(step.id)}">
        <div class="terminal-pipeline-step-head">
          <span class="terminal-pipeline-step-index">${index + 1}</span>
          <label class="terminal-pipeline-step-project" title="這段 prompt 要在哪個專案的終端執行">
            <span class="terminal-pipeline-step-project-icon" aria-hidden="true">${icons.terminal}</span>
            <select data-pipeline-project="${escapeHtml(step.id)}" aria-label="第 ${index + 1} 段專案" ${running ? 'disabled' : ''}>
              ${projectOptions(step.project)}
            </select>
          </label>
          <div class="terminal-pipeline-conversation" role="group" aria-label="第 ${index + 1} 段對話模式">
            <button class="terminal-pipeline-conv-button ${step.conversation === 'same' ? 'is-active' : ''}" data-pipeline-conversation="${escapeHtml(step.id)}" data-pipeline-conversation-mode="same" type="button" aria-pressed="${step.conversation === 'same'}" ${running ? 'disabled' : ''}>延續對話</button>
            <button class="terminal-pipeline-conv-button ${step.conversation === 'new' ? 'is-active' : ''}" data-pipeline-conversation="${escapeHtml(step.id)}" data-pipeline-conversation-mode="new" type="button" aria-pressed="${step.conversation === 'new'}" ${running ? 'disabled' : ''}>開新對話</button>
          </div>
          <button class="terminal-pipeline-step-delete" data-pipeline-delete="${escapeHtml(step.id)}" type="button" title="刪除這段" aria-label="刪除第 ${index + 1} 段" ${running || config.steps.length <= 1 ? 'disabled' : ''}>${icons.remove}</button>
        </div>
        <textarea class="terminal-pipeline-prompt" data-pipeline-prompt="${escapeHtml(step.id)}" rows="3" spellcheck="false" placeholder="第 ${index + 1} 段 prompt…" ${running ? 'disabled' : ''}>${escapeHtml(step.prompt)}</textarea>
      </div>
    `;
  }).join('');

  return `
    <div class="terminal-pipeline">
      ${renderPipelineControls(session)}
      <p class="terminal-pipeline-hint">每段 prompt 會依序送給目前的 ${escapeHtml(agentLabel)}；可逐段設定延續同一對話或切換新對話，並依剩餘配額自動停止。</p>
      <div class="terminal-pipeline-settings">
        <label class="terminal-pipeline-field">
          <span>完成判定閒置秒數</span>
          <input data-pipeline-idle type="number" min="${TERMINAL_PIPELINE_IDLE_MIN}" max="${TERMINAL_PIPELINE_IDLE_MAX}" step="1" value="${config.idleSeconds}" ${running ? 'disabled' : ''} />
        </label>
        <label class="terminal-pipeline-field">
          <span>單段逾時秒數</span>
          <input data-pipeline-maxwait type="number" min="${TERMINAL_PIPELINE_MAXWAIT_MIN}" max="${TERMINAL_PIPELINE_MAXWAIT_MAX}" step="10" value="${config.maxWaitSeconds}" ${running ? 'disabled' : ''} />
        </label>
        <label class="terminal-pipeline-field">
          <span>開新對話指令</span>
          <input data-pipeline-reset type="text" spellcheck="false" value="${escapeHtml(config.resetCommand)}" placeholder="${escapeHtml(TERMINAL_PIPELINE_AGENT_RESET[agentId] || '/clear')}" ${running ? 'disabled' : ''} />
        </label>
      </div>
      <div class="terminal-pipeline-quota">
        <div class="terminal-pipeline-quota-main">
          <div class="terminal-pipeline-quota-options ${quota.enabled ? '' : 'is-disabled'}">
            <label class="terminal-pipeline-field">
              <span>檢查對象</span>
              <select data-pipeline-quota-agent ${running || !quota.enabled ? 'disabled' : ''}>
                ${AI_QUOTA_MONITOR_AGENTS.map((agent) => `<option value="${escapeHtml(agent.id)}" ${quota.agent === agent.id ? 'selected' : ''}>${escapeHtml(agent.label)}</option>`).join('')}
              </select>
            </label>
            <label class="terminal-pipeline-field">
              <span>剩餘門檻 T %</span>
              <input data-pipeline-quota-threshold type="number" min="0" max="100" step="1" value="${quota.minRemaining}" ${running || !quota.enabled ? 'disabled' : ''} title="剩餘配額 ≤ T 時開始等待至接近重置" />
            </label>
            <label class="terminal-pipeline-field">
              <span>倒數秒/% C</span>
              <input data-pipeline-quota-countdown type="number" min="${TERMINAL_PIPELINE_COUNTDOWN_MIN}" max="${TERMINAL_PIPELINE_COUNTDOWN_MAX}" step="1" value="${quota.countdownPerPercent}" ${running || !quota.enabled ? 'disabled' : ''} title="重置前 (剩餘−S)×C 秒開始續跑" />
            </label>
            <label class="terminal-pipeline-field">
              <span>安全緩衝 S %</span>
              <input data-pipeline-quota-safety type="number" min="${TERMINAL_PIPELINE_SAFETY_MIN}" max="${TERMINAL_PIPELINE_SAFETY_MAX}" step="1" value="${quota.safetyBuffer}" ${running || !quota.enabled ? 'disabled' : ''} title="預留不使用的配額百分比" />
            </label>
          </div>
          <div class="terminal-pipeline-quota-checks">
            <label class="terminal-pipeline-quota-toggle" title="達門檻時等到接近重置再續跑">
              <input type="checkbox" data-pipeline-quota-enabled ${quota.enabled ? 'checked' : ''} ${running ? 'disabled' : ''} />
              <span>5h 配額調節</span>
            </label>
            <label class="terminal-pipeline-quota-strict" title="無法判斷配額時停止（否則照舊續跑）">
              <input type="checkbox" data-pipeline-quota-strict ${quota.stopOnUnknown ? 'checked' : ''} ${running || !quota.enabled ? 'disabled' : ''} />
              <span>無法判斷時停止</span>
            </label>
          </div>
        </div>
      </div>
      <div class="terminal-pipeline-steps">${stepsHtml}</div>
      <button class="copy-url terminal-pipeline-add" data-pipeline-add type="button" ${running ? 'disabled' : ''}>${icons.add}<span>新增一段</span></button>
      <div class="terminal-pipeline-log-controls">
        <button class="terminal-pipeline-log-toggle" data-pipeline-log-toggle type="button">${state.terminalPipelineLogExpanded ? '隱藏執行紀錄' : '顯示執行紀錄'}</button>
      </div>
      ${state.terminalPipelineLogExpanded ? `<div class="terminal-pipeline-log" data-pipeline-log>${renderPipelineLogEntries()}</div>` : ''}
    </div>
  `;
}

// Pipeline 管理 is a top-level modal mode: the full cross-project pipeline editor,
// without the per-project terminal bar/tabs.
function renderTerminalPipelineMode() {
  elements.terminalWorkspace.innerHTML = `
    <section class="terminal-session is-focus-mode terminal-pipeline-mode" data-terminal-pipeline-mode>
      <div class="terminal-pipeline-scroll">
        ${renderTerminalPipeline(null)}
      </div>
    </section>
  `;
}

// 記事本:不會被執行的 pipeline 草稿。只有段落(project / prompt / 對話模式),沒有
// 執行參數與執行/接續/停止控制;提供「加入 Pipeline」與「加入並保留副本」。
function renderTerminalNotepad() {
  const notepad = getTerminalNotepad();
  const projects = terminalProjectList();
  const projectOptions = (selected) => `
    <option value="" ${selected ? '' : 'selected'}>預設專案</option>
    ${projects.map((project) => `<option value="${escapeHtml(project.name)}" ${project.name === selected ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
    <option value="${TERMINAL_NEW_PROJECT_OPTION}">＋ 新增專案…</option>
  `;

  const stepsHtml = notepad.steps.map((step, index) => `
    <div class="terminal-pipeline-step" data-notepad-step="${escapeHtml(step.id)}">
      <div class="terminal-pipeline-step-head">
        <span class="terminal-pipeline-step-index">${index + 1}</span>
        <label class="terminal-pipeline-step-project" title="加入 Pipeline 後,這段 prompt 要在哪個專案的終端執行">
          <span class="terminal-pipeline-step-project-icon" aria-hidden="true">${icons.terminal}</span>
          <select data-notepad-project="${escapeHtml(step.id)}" aria-label="第 ${index + 1} 段專案">
            ${projectOptions(step.project)}
          </select>
        </label>
        <div class="terminal-pipeline-conversation" role="group" aria-label="第 ${index + 1} 段對話模式">
          <button class="terminal-pipeline-conv-button ${step.conversation === 'same' ? 'is-active' : ''}" data-notepad-conversation="${escapeHtml(step.id)}" data-notepad-conversation-mode="same" type="button" aria-pressed="${step.conversation === 'same'}">延續對話</button>
          <button class="terminal-pipeline-conv-button ${step.conversation === 'new' ? 'is-active' : ''}" data-notepad-conversation="${escapeHtml(step.id)}" data-notepad-conversation-mode="new" type="button" aria-pressed="${step.conversation === 'new'}">開新對話</button>
        </div>
        <button class="terminal-pipeline-step-delete" data-notepad-delete="${escapeHtml(step.id)}" type="button" title="刪除這段" aria-label="刪除第 ${index + 1} 段" ${notepad.steps.length <= 1 ? 'disabled' : ''}>${icons.remove}</button>
      </div>
      <textarea class="terminal-pipeline-prompt" data-notepad-prompt="${escapeHtml(step.id)}" rows="3" spellcheck="false" placeholder="第 ${index + 1} 段筆記 / prompt…">${escapeHtml(step.prompt)}</textarea>
      <div class="terminal-notepad-step-actions">
        <button class="copy-url terminal-notepad-step-action" data-notepad-step-to-pipeline="${escapeHtml(step.id)}" type="button" title="只把這一段加入 Pipeline(加入後從記事本移除)">${icons.add}<span>加入 Pipeline</span></button>
        <button class="copy-url terminal-notepad-step-action" data-notepad-step-to-pipeline-copy="${escapeHtml(step.id)}" type="button" title="把這一段加入 Pipeline,並在記事本保留副本">${icons.save}<span>加入並保留副本</span></button>
      </div>
    </div>
  `).join('');

  return `
    <div class="terminal-pipeline terminal-notepad">
      <div class="terminal-notepad-bar">
        <p class="terminal-pipeline-hint">記事本只是暫存區,不會被執行。整理好後可整批加入 Pipeline 再去設定執行參數。</p>
        <div class="terminal-notepad-actions">
          <button class="copy-url primary-action" data-notepad-to-pipeline type="button">${icons.add}<span>加入 Pipeline</span></button>
          <button class="copy-url" data-notepad-to-pipeline-copy type="button">${icons.save}<span>加入並保留副本</span></button>
        </div>
      </div>
      <div class="terminal-pipeline-steps">${stepsHtml}</div>
      <button class="copy-url terminal-pipeline-add" data-notepad-add type="button">${icons.add}<span>新增一段</span></button>
    </div>
  `;
}

function renderTerminalNotepadMode() {
  elements.terminalWorkspace.innerHTML = `
    <section class="terminal-session is-focus-mode terminal-pipeline-mode" data-terminal-notepad-mode>
      <div class="terminal-pipeline-scroll">
        ${renderTerminalNotepad()}
      </div>
    </section>
  `;
}

function renderTerminalModal() {
  if (!state.terminalModalOpen) {
    return;
  }

  const project = terminalProjectByName(state.terminalProjectName);
  const options = terminalOptionsForProject();
  const sessions = terminalSessionsForProject();
  const activeSession = sessions.find((session) => session.localId === state.terminalActiveSessionId) || sessions[0] || null;
  state.terminalActiveSessionId = activeSession?.localId || null;
  rememberTerminalActiveSession();

  const mode = state.terminalModalMode === 'pipeline'
    ? 'pipeline'
    : state.terminalModalMode === 'notepad'
      ? 'notepad'
      : 'terminal';
  const terminalMode = mode === 'terminal';
  elements.terminalTitle.textContent = mode === 'pipeline'
    ? 'Pipeline 管理'
    : mode === 'notepad'
      ? '記事本'
      : (project ? `終端管理：${project.name}` : '終端管理');

  // Mode toggle (終端管理 / Pipeline 管理 / 記事本) button states.
  elements.terminalModeTerminalButton?.classList.toggle('is-active', mode === 'terminal');
  elements.terminalModeTerminalButton?.setAttribute('aria-selected', mode === 'terminal' ? 'true' : 'false');
  elements.terminalModePipelineButton?.classList.toggle('is-active', mode === 'pipeline');
  elements.terminalModePipelineButton?.setAttribute('aria-selected', mode === 'pipeline' ? 'true' : 'false');
  elements.terminalModeNotepadButton?.classList.toggle('is-active', mode === 'notepad');
  elements.terminalModeNotepadButton?.setAttribute('aria-selected', mode === 'notepad' ? 'true' : 'false');

  // The modal is always maximised now (the 放大 toggle was replaced by the mode toggle).
  elements.terminalModal.querySelector('.terminal-modal-panel')?.classList.add('is-focus-mode');

  // The conversation tabs row (含「新增對話」)belongs to 終端管理 mode only. The 切換專案
  // cluster moved into the workspace page, so Pipeline 管理 / 記事本 (no tabs/page) hide it.
  elements.terminalTabsRow.hidden = !terminalMode;

  if (mode === 'pipeline') {
    elements.terminalEmpty.hidden = true;
    renderTerminalPipelineMode();
    // The terminal surfaces were just detached; tear down their orphaned xterm views.
    disposeUnusedTerminalViews();
    return;
  }

  if (mode === 'notepad') {
    elements.terminalEmpty.hidden = true;
    renderTerminalNotepadMode();
    disposeUnusedTerminalViews();
    return;
  }

  elements.addTerminalSession.disabled = !terminalCanAddSession();
  elements.terminalEmpty.hidden = sessions.length > 0;
  renderTerminalTabs();

  if (!activeSession) {
    // No conversation yet — still show the 切換專案 cluster so the page is never blank.
    elements.terminalWorkspace.innerHTML = `
      <section class="terminal-session">
        ${renderTerminalProjectSwitcher()}
      </section>
    `;
    return;
  }

  applyTerminalFocusAuto(activeSession);
  const focusActive = terminalFocusActive(activeSession);

  const editingTitle = state.terminalTitleEditingId === activeSession.localId;
  const sessionTitleControl = editingTitle
    ? `<input class="terminal-session-title-input" data-terminal-title-input="${escapeHtml(activeSession.localId)}" type="text" value="${escapeHtml(state.terminalTitleDraft)}" aria-label="編輯終端名稱" />`
    : `<button class="terminal-session-title-button" data-terminal-title-edit="${escapeHtml(activeSession.localId)}" type="button" title="點擊改名">${escapeHtml(activeSession.title)}</button>`;
  const projectPort = activeSession.projectPort || options.port || project?.port || '--';
  const footerUrl = activeSession.projectLocalUrl || options.localUrl || project?.localUrl || '';
  const terminalSurface = activeSession.id && activeSession.interactive
    ? `
      <div class="terminal-touch-viewport" data-terminal-touch-viewport="${escapeHtml(activeSession.localId)}" aria-label="終端檢視區">
        <div class="terminal-touch-canvas" data-terminal-touch-canvas="${escapeHtml(activeSession.localId)}">
          <div class="terminal-xterm ${activeSession.readOnly ? 'is-readonly' : ''}" data-terminal-xterm="${escapeHtml(activeSession.localId)}" aria-label="Interactive terminal"></div>
        </div>
      </div>
    `
    : `<pre class="terminal-output" data-terminal-output="${escapeHtml(activeSession.localId)}"></pre>`;
  const agentLaunchOnly = activeSession.readOnly && !activeSession.id && terminalCanUseAgentLauncher(activeSession);
  const commandReadOnly = activeSession.readOnly ? 'readonly disabled' : '';
  const commandDisabled = activeSession.readOnly || activeSession.busy || activeSession.exitedAt || (!activeSession.id && options.loading) ? 'disabled' : '';
  const commandPlaceholder = activeSession.readOnly
    ? agentLaunchOnly
      ? 'Use the quick-launch buttons above to start from mobile'
      : 'Read-only from LAN/Tailscale'
    : activeSession.id
      ? 'Send command to terminal'
      : 'Optional command, e.g. claude';
  const commandButtonLabel = activeSession.readOnly ? (agentLaunchOnly ? 'Launch only' : 'Read-only') : activeSession.id ? 'Send' : 'Start';

  // The workspace shows one content tab at a time (終端 / 啟動 / Pipeline / 設定 /
  // 指令) so the terminal can use the full height. We leave state.terminalContentTab
  // as null until the user (or a live transition) picks one, so a fresh draft
  // defaults to the launcher and a live session to the terminal.
  const activeTab = effectiveTerminalContentTab(activeSession);

  const commandRow = `
    <div class="terminal-command-row">
      <textarea class="terminal-command-input" data-terminal-input="${escapeHtml(activeSession.localId)}" rows="2" spellcheck="false" aria-label="Terminal command" placeholder="${commandPlaceholder}" ${commandReadOnly}></textarea>
      <button class="copy-url primary-action terminal-run-button" data-terminal-run="${escapeHtml(activeSession.localId)}" type="button" ${commandDisabled}>
        <span class="terminal-run-button-content">${icons.start}<span>${commandButtonLabel}</span></span>
      </button>
    </div>
  `;

  // The 終端 tab shows the live terminal surface once a terminal is running, otherwise
  // the launch settings + agent launcher (which is what starts a terminal).
  const terminalLive = terminalTabIsLive(activeSession);

  let tabBody = '';
  if (activeTab === 'pipeline') {
    tabBody = renderTerminalPipeline(activeSession);
  } else if (activeTab === 'favorites') {
    tabBody = renderTerminalFavorites(activeSession);
  } else if (terminalLive) {
    tabBody = `
      ${renderTerminalScrollControls(activeSession)}
      ${terminalSurface}
      ${commandRow}
    `;
  } else {
    // 啟動設定:對話名稱/位置/Port/終端類型 + 目錄樹,接著 agent 啟動器,
    // 最後保留指令列(可直接輸入指令或開純終端後啟動)。
    tabBody = `
      ${renderTerminalSetup(activeSession, options, project, sessionTitleControl, projectPort)}
      ${renderTerminalAgentTabs()}
      ${renderTerminalActiveAgentLauncher(activeSession, options)}
      ${commandRow}
    `;
  }

  // While a pipeline runs, keep its status + stop control visible on every tab.
  const pipelineBar = state.terminalPipelineRun.active && activeTab !== 'pipeline'
    ? `<div class="terminal-pipeline-runbar">${renderPipelineControls(activeSession, { compact: true })}</div>`
    : '';

  elements.terminalWorkspace.innerHTML = `
    <section class="terminal-session ${focusActive ? 'is-focus-mode' : ''}" data-terminal-panel="${escapeHtml(activeSession.localId)}">
      ${renderTerminalProjectSwitcher()}
      ${renderTerminalContentTabBar(activeTab)}
      ${pipelineBar}
      ${renderTerminalBusyBar(activeSession)}
      <div class="terminal-tab-content terminal-tab-${escapeHtml(activeTab)} ${activeTab === 'terminal' && terminalLive ? 'is-terminal-live' : ''}" data-terminal-content="${escapeHtml(activeTab)}">
        ${tabBody}
      </div>
      <div class="terminal-session-footer">
        <span data-terminal-status class="terminal-status ${activeSession.exitedAt ? 'is-closed' : activeSession.running ? 'is-running' : 'is-draft'}">${terminalStatusLabel(activeSession)}</span>
        <span>${escapeHtml(footerUrl)}</span>
      </div>
    </section>
  `;

  const input = elements.terminalWorkspace.querySelector(`[data-terminal-input="${CSS.escape(activeSession.localId)}"]`);
  if (input) {
    input.value = activeSession.input;
  }
  if (activeTab === 'terminal' && terminalLive) {
    if (activeSession.interactive) {
      mountTerminalView(activeSession);
    } else {
      updateTerminalSessionView(activeSession);
    }
  }
  disposeUnusedTerminalViews();
}

function updateTerminalSessionView(session) {
  const output = elements.terminalWorkspace.querySelector(`[data-terminal-output="${CSS.escape(session.localId)}"]`);
  if (!output) {
    return;
  }

  const shouldStickToBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 80;
  output.textContent = session.output || (session.id ? '終端已開啟。' : '尚未開啟終端。');
  if (shouldStickToBottom) {
    output.scrollTop = output.scrollHeight;
  }
}

function updateTerminalFooter(session) {
  const panel = elements.terminalWorkspace.querySelector(`[data-terminal-panel="${CSS.escape(session.localId)}"]`);
  const status = panel?.querySelector('[data-terminal-status]');
  if (status) {
    status.className = `terminal-status ${session.exitedAt ? 'is-closed' : session.running ? 'is-running' : 'is-draft'}`;
    status.textContent = terminalStatusLabel(session);
  }
}

function applyTerminalPayload(session, payload) {
  const previousCursor = Number(session.cursor || 0) || 0;
  const payloadOutput = String(payload.output || '');
  const nextCursor = Number(payload.cursor || previousCursor || 0) || previousCursor;
  let outputToAppend = payloadOutput;
  if (payloadOutput && previousCursor && nextCursor <= previousCursor) {
    outputToAppend = '';
  } else if (payloadOutput && previousCursor && nextCursor > previousCursor) {
    const newLength = nextCursor - previousCursor;
    if (newLength < payloadOutput.length) {
      outputToAppend = payloadOutput.slice(payloadOutput.length - newLength);
    }
  }

  session.id = payload.id || session.id;
  session.projectPort = payload.projectPort || session.projectPort;
  session.projectLocalUrl = payload.projectLocalUrl || session.projectLocalUrl;
  session.cwd = payload.cwd || session.cwd;
  session.shellId = payload.shellId || session.shellId;
  session.shellLabel = payload.shellLabel || session.shellLabel;
  session.cursor = nextCursor;
  session.cols = Number(payload.cols || session.cols || 100);
  session.rows = Number(payload.rows || session.rows || 28);
  session.running = payload.running === true;
  session.interactive = payload.interactive === true;
  session.readOnly = payload.readOnly === true;
  session.exitedAt = payload.exitedAt || null;
  session.exitCode = payload.exitCode ?? null;
  session.exitSignal = payload.exitSignal ?? null;
  if (outputToAppend) {
    session.output += outputToAppend;
    session.lastOutputAt = Date.now();
  }
  if (session.id && !session.readOnly) {
    state.terminalWorkspaceMetaBySessionId.set(session.id, terminalSessionMetadata(session));
  } else if (session.id && session.readOnly) {
    state.terminalWorkspaceMetaBySessionId.delete(session.id);
  }

  return outputToAppend;
}

function appendTerminalSessionOutput(session, text, cursor) {
  const chunk = String(text || '');
  if (!chunk) {
    return '';
  }

  const previousCursor = Number(session.cursor || 0) || 0;
  const nextCursor = Number(cursor || 0) || (previousCursor + chunk.length);
  let outputToAppend = chunk;
  if (previousCursor && nextCursor <= previousCursor) {
    return '';
  }
  if (previousCursor && nextCursor > previousCursor) {
    const newLength = nextCursor - previousCursor;
    if (newLength < chunk.length) {
      outputToAppend = chunk.slice(chunk.length - newLength);
    }
  }

  session.output = `${session.output || ''}${outputToAppend}`;
  if (session.output.length > TERMINAL_CLIENT_OUTPUT_LIMIT) {
    session.output = session.output.slice(session.output.length - TERMINAL_CLIENT_OUTPUT_LIMIT);
  }
  session.cursor = nextCursor;
  if (outputToAppend) {
    session.lastOutputAt = Date.now();
  }
  return outputToAppend;
}

function terminalSocketUrl(session) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const cursor = encodeURIComponent(session.cursor || 0);
  return `${protocol}//${window.location.host}/api/terminals/${encodeURIComponent(session.id)}/socket?cursor=${cursor}`;
}

function disposeTerminalView(localId) {
  const view = terminalViews.get(localId);
  if (!view) {
    return;
  }

  try {
    if (view.fitRaf) {
      window.cancelAnimationFrame(view.fitRaf);
      view.fitRaf = null;
    }
    view.resizeObserver?.disconnect();
    view.dataDisposable?.dispose();
    view.panCleanup?.();
    view.socket?.close(1000, 'Terminal view disposed');
    view.terminal?.dispose();
  } catch {
    // The view may already be detached by a modal re-render.
  }
  terminalViews.delete(localId);
}

function disposeUnusedTerminalViews() {
  const activeIds = new Set(state.terminalSessions.map((session) => session.localId));
  terminalViews.forEach((view, localId) => {
    if (!state.terminalModalOpen || !activeIds.has(localId) || !view.container?.isConnected) {
      disposeTerminalView(localId);
    }
  });
}

function sendTerminalSocketMessage(session, payload) {
  if (session.readOnly && (payload?.type === 'input' || payload?.type === 'resize')) {
    return false;
  }

  const view = terminalViews.get(session.localId);
  if (!view?.socket || view.socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  view.socket.send(JSON.stringify(payload));
  return true;
}

function hasLiveTerminalSocket(session) {
  return terminalViews.get(session.localId)?.socket?.readyState === WebSocket.OPEN;
}

function averageTouchPoint(touches) {
  const points = Array.from(touches || []);
  if (points.length < 2) {
    return null;
  }

  return {
    x: (points[0].clientX + points[1].clientX) / 2,
    y: (points[0].clientY + points[1].clientY) / 2,
  };
}

function singleTouchPoint(touches) {
  const touch = touches?.[0];
  if (!touch) {
    return null;
  }

  return {
    x: touch.clientX,
    y: touch.clientY,
  };
}

function touchDistance(touches) {
  const points = Array.from(touches || []);
  if (points.length < 2) {
    return 0;
  }

  return Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
}

function clampTerminalTouchScale(scale) {
  return Math.max(TERMINAL_TOUCH_MIN_SCALE, Math.min(TERMINAL_TOUCH_MAX_SCALE, Number(scale) || 1));
}

function terminalTouchViewportEnabled() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function syncTerminalTouchCanvas(view) {
  const viewport = view?.viewport;
  if (!viewport) {
    return;
  }

  if (!terminalTouchViewportEnabled()) {
    viewport.style.removeProperty('--terminal-touch-width');
    viewport.style.removeProperty('--terminal-touch-height');
    viewport.style.removeProperty('--terminal-touch-canvas-width');
    viewport.style.removeProperty('--terminal-touch-canvas-height');
    return;
  }

  const scale = view.touchScale || 1;
  const width = view.touchBaseWidth || TERMINAL_TOUCH_DESKTOP_WIDTH;
  const viewportHeight = viewport.clientHeight || view.touchViewportHeight || view.container?.clientHeight || 360;
  const height = Math.max(viewportHeight, Math.ceil(viewportHeight / scale));
  view.touchViewportHeight = viewportHeight;
  view.touchBaseHeight = height;
  viewport.style.setProperty('--terminal-touch-width', `${Math.round(width)}px`);
  viewport.style.setProperty('--terminal-touch-height', `${Math.round(height)}px`);
  viewport.style.setProperty('--terminal-touch-canvas-width', `${Math.round(width * scale)}px`);
  viewport.style.setProperty('--terminal-touch-canvas-height', `${Math.round(height * scale)}px`);
}

function setTerminalTouchScale(view, scale, anchor = null) {
  const viewport = view?.viewport;
  if (!viewport) {
    return;
  }

  const previousScale = view.touchScale || 1;
  const nextScale = clampTerminalTouchScale(scale);
  const anchorX = anchor?.x ?? viewport.clientWidth / 2;
  const anchorY = anchor?.y ?? viewport.clientHeight / 2;
  const contentX = (viewport.scrollLeft + anchorX) / previousScale;
  const contentY = (viewport.scrollTop + anchorY) / previousScale;

  view.touchScale = nextScale;
  viewport.style.setProperty('--terminal-touch-scale', nextScale.toFixed(3));
  viewport.dataset.terminalScale = nextScale.toFixed(3);
  syncTerminalTouchCanvas(view);
  viewport.scrollLeft = contentX * nextScale - anchorX;
  viewport.scrollTop = contentY * nextScale - anchorY;
}

function initializeTerminalTouchScale(view, { force = false } = {}) {
  const viewport = view?.viewport;
  if (!viewport) {
    return;
  }

  if (!terminalTouchViewportEnabled()) {
    view.touchScale = 1;
    view.touchScaleEdited = false;
    viewport.style.setProperty('--terminal-touch-scale', '1');
    delete viewport.dataset.terminalScale;
    syncTerminalTouchCanvas(view);
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    return;
  }

  view.touchViewportHeight = viewport.clientHeight || view.touchViewportHeight || view.container?.clientHeight || 360;
  if (view.touchScaleEdited && !force) {
    syncTerminalTouchCanvas(view);
    return;
  }

  const width = view.touchBaseWidth || TERMINAL_TOUCH_DESKTOP_WIDTH;
  const fitScale = viewport.clientWidth
    ? Math.min(1, viewport.clientWidth / width)
    : 1;
  setTerminalTouchScale(view, fitScale);
}

function bindTerminalPan(view, session) {
  if (!view?.viewport) {
    return null;
  }

  const viewport = view.viewport;
  let pan = null;
  let drag = null;
  const stopDragTouch = () => {
    drag = null;
    viewport.classList.remove('is-touch-panning');
  };
  const beginDragTouch = (event) => {
    const point = singleTouchPoint(event.touches);
    if (!point) {
      stopDragTouch();
      return;
    }

    stopDragTouch();
    drag = {
      startX: point.x,
      startY: point.y,
      lastY: point.y,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      moved: false,
    };
  };
  const moveDragTouch = (point) => {
    if (!drag) {
      return;
    }

    const totalX = point.x - drag.startX;
    const totalY = point.y - drag.startY;
    const moved = Math.hypot(totalX, totalY);
    if (!drag.moved && moved <= TERMINAL_TOUCH_DRAG_TOLERANCE) {
      return;
    }

    drag.moved = true;
    viewport.classList.add('is-touch-panning');
    const beforeTop = viewport.scrollTop;
    viewport.scrollLeft = drag.scrollLeft - totalX;
    viewport.scrollTop = drag.scrollTop - totalY;

    const deltaY = point.y - drag.lastY;
    drag.lastY = point.y;
    if (Math.abs(deltaY) >= 1 && viewport.scrollTop === beforeTop) {
      wheelTerminalSession(view, session, -deltaY * TERMINAL_TOUCH_DRAG_WHEEL_MULTIPLIER, point);
    }
  };
  const beginPinchPan = (event) => {
    const point = averageTouchPoint(event.touches);
    if (!point) {
      pan = null;
      return;
    }

    const rect = viewport.getBoundingClientRect();
    pan = {
      x: point.x - rect.left,
      y: point.y - rect.top,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      scale: view.touchScale || 1,
      distance: touchDistance(event.touches) || 1,
    };
    viewport.classList.add('is-touch-panning');
  };
  const updatePinchPan = (event) => {
    if (!pan || event.touches.length < 2) {
      return;
    }

    const point = averageTouchPoint(event.touches);
    if (!point) {
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const x = point.x - rect.left;
    const y = point.y - rect.top;
    const distance = touchDistance(event.touches) || pan.distance;
    const nextScale = clampTerminalTouchScale(pan.scale * (distance / pan.distance));
    const contentX = (pan.scrollLeft + pan.x) / pan.scale;
    const contentY = (pan.scrollTop + pan.y) / pan.scale;

    view.touchScale = nextScale;
    view.touchScaleEdited = true;
    viewport.style.setProperty('--terminal-touch-scale', nextScale.toFixed(3));
    viewport.dataset.terminalScale = nextScale.toFixed(3);
    syncTerminalTouchCanvas(view);
    viewport.scrollLeft = contentX * nextScale - x;
    viewport.scrollTop = contentY * nextScale - y;
  };
  const updatePinchStart = (event) => {
    const point = averageTouchPoint(event.touches);
    if (point) {
      const rect = viewport.getBoundingClientRect();
      pan = {
        x: point.x - rect.left,
        y: point.y - rect.top,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
        scale: view.touchScale || 1,
        distance: touchDistance(event.touches) || 1,
      };
    }
  };
  const focusTerminalFromTap = () => {
    if (!session.readOnly) {
      window.requestAnimationFrame(() => view.terminal?.focus());
    }
  };
  const stopMobileTerminalFocus = (event) => {
    if (terminalTouchViewportEnabled() && event.pointerType === 'touch') {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onTouchStart = (event) => {
    if (!terminalTouchViewportEnabled()) {
      pan = null;
      stopDragTouch();
      return;
    }

    if (event.touches.length === 1) {
      pan = null;
      beginDragTouch(event);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.touches.length < 2) {
      pan = null;
      stopDragTouch();
      return;
    }

    stopDragTouch();
    beginPinchPan(event);
    event.preventDefault();
    event.stopPropagation();
  };
  const onTouchMove = (event) => {
    if (!terminalTouchViewportEnabled()) {
      return;
    }

    if (event.touches.length === 1 && drag) {
      const point = singleTouchPoint(event.touches);
      if (!point) {
        stopDragTouch();
        return;
      }

      moveDragTouch(point);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!pan || event.touches.length < 2) {
      return;
    }

    stopDragTouch();
    updatePinchPan(event);
    event.preventDefault();
    event.stopPropagation();
  };
  const onTouchEnd = (event) => {
    const tapShouldFocus = terminalTouchViewportEnabled()
      && event.touches.length === 0
      && drag
      && !drag.moved;

    if (event.touches.length >= 2) {
      updatePinchStart(event);
      if (terminalTouchViewportEnabled()) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (event.touches.length === 1) {
      pan = null;
      beginDragTouch(event);
      if (terminalTouchViewportEnabled()) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    pan = null;
    stopDragTouch();
    if (terminalTouchViewportEnabled()) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (tapShouldFocus) {
      focusTerminalFromTap();
    }
  };
  const onContextMenu = (event) => {
    if (terminalTouchViewportEnabled()) {
      event.preventDefault();
    }
  };
  const onResize = () => {
    initializeTerminalTouchScale(view);
  };

  initializeTerminalTouchScale(view, { force: true });
  viewport.addEventListener('pointerdown', stopMobileTerminalFocus, { capture: true });
  viewport.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
  viewport.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
  viewport.addEventListener('touchend', onTouchEnd, { capture: true });
  viewport.addEventListener('touchcancel', onTouchEnd, { capture: true });
  viewport.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('resize', onResize);

  return () => {
    stopDragTouch();
    viewport.removeEventListener('pointerdown', stopMobileTerminalFocus, { capture: true });
    viewport.removeEventListener('touchstart', onTouchStart, { capture: true });
    viewport.removeEventListener('touchmove', onTouchMove, { capture: true });
    viewport.removeEventListener('touchend', onTouchEnd, { capture: true });
    viewport.removeEventListener('touchcancel', onTouchEnd, { capture: true });
    viewport.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('resize', onResize);
    viewport.classList.remove('is-touch-panning');
  };
}

function terminalDesktopSize(session) {
  return {
    cols: Math.max(20, Math.min(400, Number(session.cols || 100))),
    rows: Math.max(5, Math.min(120, Number(session.rows || 28))),
  };
}

function terminalPaddingSize(element) {
  const style = window.getComputedStyle(element);
  const numberValue = (name) => Number.parseFloat(style.getPropertyValue(name)) || 0;
  return {
    horizontal: numberValue('padding-left') + numberValue('padding-right'),
    vertical: numberValue('padding-top') + numberValue('padding-bottom'),
  };
}

function terminalRenderCellSize(terminal) {
  const cell = terminal?._core?._renderService?.dimensions?.css?.cell;
  if (!cell?.width || !cell?.height) {
    return null;
  }

  return {
    width: cell.width,
    height: cell.height,
  };
}

function terminalTouchTargetCols(session) {
  return Math.max(
    TERMINAL_TOUCH_DESKTOP_FALLBACK_COLS,
    Math.min(TERMINAL_TOUCH_MAX_COLS, Number(session?.cols || 0) || TERMINAL_TOUCH_DESKTOP_FALLBACK_COLS),
  );
}

function terminalTouchPixelWidth(view, cols) {
  const cell = terminalRenderCellSize(view?.terminal);
  if (!cell || !view?.container) {
    return TERMINAL_TOUCH_DESKTOP_WIDTH;
  }

  const padding = terminalPaddingSize(view.container);
  const scrollbarWidth = view.terminal.options.scrollback === 0
    ? 0
    : (view.terminal.options.overviewRuler?.width || TERMINAL_SCROLLBAR_WIDTH);
  return Math.max(
    TERMINAL_TOUCH_DESKTOP_WIDTH,
    Math.ceil((cols * cell.width) + padding.horizontal + scrollbarWidth),
  );
}

function terminalTouchDesktopDimensions(view, session) {
  if (!terminalTouchViewportEnabled() || !view?.terminal || !view?.container) {
    return null;
  }

  const cols = terminalTouchTargetCols(session);
  const cell = terminalRenderCellSize(view.terminal);
  if (!cell) {
    return {
      cols,
      rows: Math.max(5, Math.min(120, view.terminal.rows || TERMINAL_TOUCH_DESKTOP_FALLBACK_ROWS)),
    };
  }

  const style = window.getComputedStyle(view.container);
  const height = Number.parseFloat(style.getPropertyValue('height'))
    || view.touchBaseHeight
    || view.touchViewportHeight
    || 360;
  const padding = terminalPaddingSize(view.container);
  const availableHeight = Math.max(0, height - padding.vertical);

  return {
    cols,
    rows: Math.max(1, Math.floor(availableHeight / cell.height)),
  };
}

function fitTerminalView(session) {
  const view = terminalViews.get(session.localId);
  if (!view) {
    return;
  }

  try {
    const mobileDesktopDimensions = terminalTouchDesktopDimensions(view, session);
    if (mobileDesktopDimensions) {
      const previousTouchBaseWidth = view.touchBaseWidth || TERMINAL_TOUCH_DESKTOP_WIDTH;
      view.touchBaseWidth = terminalTouchPixelWidth(view, mobileDesktopDimensions.cols);
      if (!view.touchScaleEdited && previousTouchBaseWidth !== view.touchBaseWidth && view.viewport?.clientWidth) {
        setTerminalTouchScale(view, Math.min(1, view.viewport.clientWidth / view.touchBaseWidth));
      } else {
        syncTerminalTouchCanvas(view);
      }
      if (view.terminal.cols !== mobileDesktopDimensions.cols || view.terminal.rows !== mobileDesktopDimensions.rows) {
        view.terminal.resize(mobileDesktopDimensions.cols, mobileDesktopDimensions.rows);
      }
    } else {
      view.fitAddon.fit();
    }
    session.cols = view.terminal.cols;
    session.rows = view.terminal.rows;
    if (!session.readOnly) {
      sendTerminalSocketMessage(session, {
        type: 'resize',
        cols: view.terminal.cols,
        rows: view.terminal.rows,
      });
    }
  } catch {
    // Fit can fail while the element is hidden or mid-render.
  }
}

function terminalCanScrollHistory(terminal, deltaY) {
  const buffer = terminal?.buffer?.active;
  if (!buffer || !deltaY) {
    return false;
  }

  return deltaY < 0
    ? buffer.viewportY > 0
    : buffer.viewportY < buffer.baseY;
}

function terminalUsesMouseEvents(terminal) {
  return terminal?.element?.classList.contains('enable-mouse-events') === true;
}

function terminalCanUsePageScrollFallback(terminal) {
  return terminal?.buffer?.active?.type === 'alternate' || terminalUsesMouseEvents(terminal);
}

function dispatchTerminalWheelEvent(view, deltaY, point = null) {
  const target = view?.container?.querySelector('.xterm-viewport')
    || view?.container?.querySelector('.xterm')
    || view?.container;
  if (!target || !deltaY) {
    return false;
  }

  const rect = target.getBoundingClientRect();
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaMode: 0,
    deltaX: 0,
    deltaY,
    clientX: point?.x ?? (rect.left + rect.width / 2),
    clientY: point?.y ?? (rect.top + rect.height / 2),
  });

  return !target.dispatchEvent(event);
}

function wheelTerminalSession(view, session, deltaY, point = null) {
  const terminal = view?.terminal;
  if (!session || !terminal || !deltaY) {
    return;
  }

  const before = terminal.buffer?.active?.viewportY ?? 0;
  const dispatchedNativeWheel = terminalUsesMouseEvents(terminal);
  if (dispatchedNativeWheel) {
    dispatchTerminalWheelEvent(view, deltaY, point);
  }

  const afterNative = terminal.buffer?.active?.viewportY ?? before;
  if (afterNative !== before) {
    return;
  }

  if (terminalCanScrollHistory(terminal, deltaY)) {
    const lines = Math.max(1, Math.round(Math.abs(deltaY) / 32));
    terminal.scrollLines(deltaY > 0 ? lines : -lines);
    return;
  }

  if (!dispatchedNativeWheel) {
    dispatchTerminalWheelEvent(view, deltaY, point);
  }
}

function scrollTerminalSession(localId, direction) {
  const session = findTerminalSession(localId);
  const view = session ? terminalViews.get(session.localId) : null;
  const terminal = view?.terminal;
  if (!session || !terminal) {
    return;
  }

  const before = terminal.buffer?.active?.viewportY ?? 0;
  if (direction === 'top') {
    terminal.scrollToTop();
  } else if (direction === 'up') {
    terminal.scrollPages(-1);
  } else if (direction === 'down') {
    terminal.scrollPages(1);
  } else if (direction === 'bottom') {
    terminal.scrollToBottom();
  }

  const after = terminal.buffer?.active?.viewportY ?? before;
  const didMoveViewport = after !== before;
  if (!didMoveViewport && !session.readOnly && terminalCanUsePageScrollFallback(terminal)) {
    if (direction === 'up') {
      sendTerminalSocketMessage(session, { type: 'input', data: '\x1b[5~' });
    } else if (direction === 'down') {
      sendTerminalSocketMessage(session, { type: 'input', data: '\x1b[6~' });
    }
  }

  if (!session.readOnly && !terminalTouchViewportEnabled()) {
    terminal.focus();
  }
}

function mountTerminalView(session) {
  if (!session?.id || !session.interactive) {
    return;
  }

  if (terminalTouchViewportEnabled()) {
    session.cols = terminalTouchTargetCols(session);
  }

  const container = elements.terminalWorkspace.querySelector(`[data-terminal-xterm="${CSS.escape(session.localId)}"]`);
  if (!container) {
    return;
  }
  const viewport = elements.terminalWorkspace.querySelector(`[data-terminal-touch-viewport="${CSS.escape(session.localId)}"]`);
  const canvas = elements.terminalWorkspace.querySelector(`[data-terminal-touch-canvas="${CSS.escape(session.localId)}"]`);

  const existing = terminalViews.get(session.localId);
  if (existing?.container === container && existing.terminal) {
    initializeTerminalTouchScale(existing);
    window.requestAnimationFrame(() => fitTerminalView(session));
    return;
  }

  disposeTerminalView(session.localId);

  const terminal = new Terminal({
    ...terminalDesktopSize(session),
    cursorBlink: true,
    convertEol: false,
    fontFamily: '"Cascadia Mono", "Consolas", "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.12,
    scrollback: TERMINAL_SCROLLBACK_ROWS,
    scrollOnEraseInDisplay: true,
    theme: {
      background: '#101418',
      foreground: '#e6edf3',
      cursor: '#f4d35e',
      selectionBackground: '#30506d',
      black: '#0b0f14',
      red: '#f07178',
      green: '#7fd88f',
      yellow: '#f4d35e',
      blue: '#82aaff',
      magenta: '#c792ea',
      cyan: '#89ddff',
      white: '#d6deeb',
      brightBlack: '#5c6773',
      brightRed: '#ff8b92',
      brightGreen: '#9be7a8',
      brightYellow: '#ffe082',
      brightBlue: '#9ab8ff',
      brightMagenta: '#d7aefb',
      brightCyan: '#a6e9ff',
      brightWhite: '#ffffff',
    },
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  terminal.attachCustomWheelEventHandler((event) => {
    return terminalCanScrollHistory(terminal, event.deltaY) || terminalUsesMouseEvents(terminal);
  });

  const socket = new WebSocket(terminalSocketUrl(session));
  const view = {
    terminal,
    fitAddon,
    socket,
    container,
    viewport,
    canvas,
    resizeObserver: null,
    dataDisposable: null,
    panCleanup: null,
    touchScale: 1,
    touchScaleEdited: false,
  };
  terminalViews.set(session.localId, view);
  view.panCleanup = bindTerminalPan(view, session);
  fitTerminalView(session);
  if (session.output) {
    terminal.write(session.output, () => {
      view.renderedCursor = Number(session.cursor || 0) || session.output.length;
      terminal.scrollToBottom();
    });
  } else {
    view.renderedCursor = Number(session.cursor || 0) || 0;
  }

  if (!session.readOnly) {
    view.dataDisposable = terminal.onData((data) => {
      sendTerminalSocketMessage(session, { type: 'input', data });
    });
  }

  socket.addEventListener('open', () => {
    fitTerminalView(session);
    if (!session.readOnly && !terminalTouchViewportEnabled()) {
      terminal.focus();
    }
  });
  socket.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === 'snapshot' && payload.session) {
      const output = applyTerminalPayload(session, payload.session);
      fitTerminalView(session);
      if (session.readOnly && view.dataDisposable) {
        view.dataDisposable.dispose();
        view.dataDisposable = null;
      }
      if (output) {
        terminal.write(output, () => {
          view.renderedCursor = Number(session.cursor || 0) || view.renderedCursor || 0;
          terminal.scrollToBottom();
        });
      }
    } else if (payload.type === 'output') {
      const output = appendTerminalSessionOutput(session, payload.data, payload.cursor);
      if (output) {
        terminal.write(output, () => {
          view.renderedCursor = Number(session.cursor || 0) || view.renderedCursor || 0;
        });
      }
    } else if (payload.type === 'exit') {
      session.running = false;
      session.exitedAt = payload.exitedAt || new Date().toISOString();
      session.exitCode = payload.exitCode ?? null;
      session.exitSignal = payload.exitSignal ?? null;
      renderTerminalTabs();
      updateTerminalFooter(session);
    } else if (payload.type === 'error') {
      showToast(payload.message || 'Terminal socket error.');
    }
  });
  socket.addEventListener('close', () => {
    updateTerminalFooter(session);
  });

  // Coalesce resize callbacks to one fit per frame. Without this, fit() resizing the
  // terminal can re-trigger the observer in a tight loop and make the surface "shake".
  view.resizeObserver = new ResizeObserver(() => {
    if (view.fitRaf) {
      return;
    }
    view.fitRaf = window.requestAnimationFrame(() => {
      view.fitRaf = null;
      fitTerminalView(session);
    });
  });
  view.resizeObserver.observe(container);
  if (!session.readOnly) {
    container.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' && terminalTouchViewportEnabled()) {
        return;
      }
      terminal.focus();
    });
  }
  window.requestAnimationFrame(() => fitTerminalView(session));
}

async function runTerminalCommand(localId) {
  const session = findTerminalSession(localId);
  if (!session) {
    return;
  }

  if (session.readOnly) {
    showToast('Terminal is read-only from LAN/Tailscale.');
    return;
  }

  const command = session.input;
  const options = terminalOptionsForProject(session.projectName);
  const cwd = selectedTerminalCwd(session, options);
  const shellId = selectedTerminalShellId(session, options);
  if (command.trim()) {
    setTerminalTitleFromCommand(session, command);
  } else if (!session.titleEdited) {
    session.title = terminalShellLabel(shellId, options);
  }

  if (session.id && sendTerminalSocketMessage(session, {
    type: 'input',
    data: `${command.replace(/\r?\n/g, '\r')}\r`,
  })) {
    session.input = '';
    state.terminalWorkspaceMetaBySessionId.set(session.id, terminalSessionMetadata(session));
    saveTerminalWorkspaceState();
    const input = elements.terminalWorkspace.querySelector(`[data-terminal-input="${CSS.escape(session.localId)}"]`);
    if (input) {
      input.value = '';
    }
    return;
  }

  const signal = beginTerminalSessionBusy(session, session.id ? '送出指令…' : '開啟終端…');
  renderTerminalModal();
  try {
    const payload = session.id
      ? await api(`/api/terminals/${encodeURIComponent(session.id)}`, {
          method: 'POST',
          body: JSON.stringify({ input: command, cursor: session.cursor }),
          signal,
        })
      : await api('/api/terminals', {
          method: 'POST',
          signal,
          body: JSON.stringify({
            name: session.projectName,
            command,
            cwd,
            shellId,
            cols: session.cols,
            rows: session.rows,
          }),
        });

    session.input = '';
    applyTerminalPayload(session, payload);
    saveTerminalWorkspaceState();
    startTerminalPolling();
  } catch (error) {
    if (!isAbortError(error)) {
      showToast(error.message);
    }
  } finally {
    endTerminalSessionBusy(session);
    renderTerminalModal();
  }
}

// ---------------------------------------------------------------------------
// Pipeline prompting
//
// A pipeline drives the active interactive agent session through a sequence of
// prompts. Each step declares whether it should continue the running
// conversation (「延續對話」) or reset to a new one (「開新對話」). Between steps the
// orchestrator detects completion by watching for the terminal output going
// idle, and optionally checks the agent's remaining quota before continuing.
// ---------------------------------------------------------------------------

function pipelineSleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function pipelineIsCurrent(token) {
  return token === terminalPipelineToken && state.terminalPipelineRun.active;
}

function pipelineLog(level, text) {
  const entry = {
    time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    level,
    text: String(text || ''),
  };
  const log = state.terminalPipelineRun.log;
  log.push(entry);
  if (log.length > 200) {
    log.splice(0, log.length - 200);
  }
}

function setPipelineStatus(status, message) {
  state.terminalPipelineRun.status = status;
  if (message !== undefined) {
    state.terminalPipelineRun.message = message;
  }
  renderPipelineRunState();
}

function pipelineActiveSession() {
  return findTerminalSession(state.terminalPipelineRun.sessionLocalId)
    || findTerminalSession(state.terminalActiveSessionId);
}

async function pipelineWaitForSocket(localId, token, timeoutMs = 20000) {
  const start = Date.now();
  while (pipelineIsCurrent(token)) {
    const session = findTerminalSession(localId);
    if (session && hasLiveTerminalSocket(session)) {
      return true;
    }
    if (Date.now() - start >= timeoutMs) {
      return false;
    }
    await pipelineSleep(300);
  }
  return false;
}

// Waits until the session has a server id (created), used when no client socket will
// mount (Pipeline 管理 mode drives the session over POST + polling).
async function pipelineWaitForSessionId(localId, token, timeoutMs = 12000) {
  const start = Date.now();
  while (pipelineIsCurrent(token)) {
    const session = findTerminalSession(localId);
    if (session && session.id) {
      return true;
    }
    if (Date.now() - start >= timeoutMs) {
      return false;
    }
    await pipelineSleep(300);
  }
  return false;
}

// Resolves once output has stayed quiet for idleMs (after waiting at least
// minMs and giving up after maxMs). Returns 'idle' | 'timeout' | 'exited'.
async function pipelineWaitForCompletion(localId, token, { idleMs, minMs, maxMs }) {
  const start = Date.now();
  const session = findTerminalSession(localId);
  if (session) {
    session.lastOutputAt = Date.now();
  }
  await pipelineSleep(Math.min(minMs, maxMs));

  while (pipelineIsCurrent(token)) {
    const live = findTerminalSession(localId);
    if (!live || live.exitedAt) {
      return 'exited';
    }
    const now = Date.now();
    if (now - start >= maxMs) {
      return 'timeout';
    }
    const idleFor = now - (live.lastOutputAt || start);
    if (idleFor >= idleMs) {
      return 'idle';
    }
    await pipelineSleep(500);
  }
  return 'cancelled';
}

async function pipelineSendLine(localId, text, token) {
  const session = findTerminalSession(localId);
  if (!session || session.exitedAt) {
    throw new Error('終端對話已關閉');
  }
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const multiline = normalized.includes('\n');

  if (session.id && hasLiveTerminalSocket(session)) {
    if (multiline) {
      // Bracketed paste keeps embedded newlines as newlines instead of
      // submitting after every line, then a trailing Enter sends the prompt.
      sendTerminalSocketMessage(session, { type: 'input', data: `[200~${normalized}[201~` });
      await pipelineSleep(150);
      if (!pipelineIsCurrent(token)) {
        return false;
      }
      sendTerminalSocketMessage(session, { type: 'input', data: '\r' });
    } else {
      sendTerminalSocketMessage(session, { type: 'input', data: `${normalized}\r` });
    }
    session.lastOutputAt = Date.now();
    return true;
  }

  // No live socket (e.g. the user is on another content tab): send over REST
  // with raw writes so multi-line prompts still use bracketed paste.
  if (session.id) {
    const post = (payload) => api(`/api/terminals/${encodeURIComponent(session.id)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (multiline) {
      await post({ input: `[200~${normalized}[201~`, raw: true });
      await pipelineSleep(150);
      if (!pipelineIsCurrent(token)) {
        return false;
      }
      await post({ input: '\r', raw: true });
    } else {
      await post({ input: `${normalized}\r`, raw: true });
    }
    session.lastOutputAt = Date.now();
    return true;
  }
  throw new Error('終端尚未啟動');
}

function pipelineLaunchAgentCommand() {
  const agentId = terminalFavoriteAgentId();
  if (agentId === 'codex') {
    applyTerminalCodexCommand({ run: true });
    return buildTerminalCodexCommand();
  }
  if (agentId === 'antigravity') {
    applyTerminalAntigravityCommand({ run: true });
    return buildTerminalAntigravityCommand();
  }
  if (agentId === 'opencode') {
    applyTerminalOpencodeCommand({ run: true });
    return buildTerminalOpencodeCommand();
  }
  applyTerminalClaudeCommand({ run: true });
  return buildTerminalClaudeCommand();
}

async function pipelineCheckQuota(agentId) {
  try {
    const payload = await api(`/api/ai-quotas?agent=${encodeURIComponent(agentId)}`);
    const agent = (payload.agents || []).find((item) => item.id === agentId) || (payload.agents || [])[0];
    const resetSeconds = Number.isFinite(Number(agent?.resetSeconds)) ? Number(agent.resetSeconds) : null;
    if (!agent || agent.status !== 'ok') {
      return { remaining: null, status: agent?.status || 'error', resetSeconds };
    }
    const used = Number(agent.usedPercent);
    if (Number.isFinite(used)) {
      return { remaining: Math.round(100 - used), status: 'ok', resetSeconds };
    }
    const display = Number(agent.percent);
    if (agent.direction === 'remaining' && Number.isFinite(display)) {
      return { remaining: Math.round(display), status: 'ok', resetSeconds };
    }
    return { remaining: null, status: 'unknown', resetSeconds };
  } catch (error) {
    return { remaining: null, status: 'error', error: error.message, resetSeconds: null };
  }
}

function normalizePipelineRunSaved(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps) || !raw.steps.length) {
    return null;
  }
  const steps = raw.steps
    .filter((step) => step && typeof step.id === 'string')
    .map((step) => ({
      id: step.id,
      project: String(step.project || ''),
      conversation: TERMINAL_PIPELINE_CONVERSATIONS.has(step.conversation) ? step.conversation : 'same',
      status: step.status === 'done' ? 'done' : 'pending',
    }));
  if (!steps.length || steps.every((step) => step.status === 'done')) {
    return null;
  }
  return {
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    status: typeof raw.status === 'string' ? raw.status : 'interrupted',
    stepIndex: Number.isFinite(Number(raw.stepIndex)) ? Number(raw.stepIndex) : 0,
    total: Number(raw.total) || steps.length,
    agentId: typeof raw.agentId === 'string' ? raw.agentId : null,
    steps,
  };
}

// Persist the live run's progress to the server so it survives a reload / long quota
// wait and can be resumed.
function persistPipelineRunProgress() {
  const run = state.terminalPipelineRun;
  state.terminalPipelineRunSaved = {
    startedAt: run.startedAt || new Date().toISOString(),
    status: run.status,
    stepIndex: run.stepIndex,
    total: run.total,
    agentId: terminalFavoriteAgentId(),
    steps: (run.steps || []).map((step) => ({
      id: step.id,
      project: step.project,
      conversation: step.conversation,
      status: step.status,
    })),
  };
  scheduleTerminalPreferencesSave();
}

function clearPipelineRunSaved() {
  if (!state.terminalPipelineRunSaved) {
    return;
  }
  state.terminalPipelineRunSaved = null;
  scheduleTerminalPreferencesSave();
}

// True when there's saved progress with at least one not-yet-done step that still
// maps to a current pipeline step.
function hasResumablePipelineRun() {
  const saved = state.terminalPipelineRunSaved;
  if (!saved || state.terminalPipelineRun.active) {
    return false;
  }
  const configIds = new Set(getTerminalPipeline().steps.filter((step) => step.prompt.trim()).map((step) => step.id));
  return saved.steps.some((step) => step.status !== 'done' && configIds.has(step.id));
}

// Sleeps `totalSeconds` while showing a live countdown; returns false if the run was
// stopped/superseded mid-wait.
async function pipelineCountdownSleep(totalSeconds, token, label) {
  let remaining = Math.ceil(totalSeconds);
  while (remaining > 0) {
    if (!pipelineIsCurrent(token)) {
      return false;
    }
    const mm = Math.floor(remaining / 60);
    const ss = remaining % 60;
    setPipelineStatus('quota', `${label}：${mm}:${String(ss).padStart(2, '0')} 後續跑`);
    const tick = Math.min(remaining, 5);
    await pipelineSleep(tick * 1000);
    remaining -= tick;
  }
  return pipelineIsCurrent(token);
}

// 5h-limit pacing: returns 'proceed' to run the step now, or 'stop' to halt. When the
// remaining quota is at/under the threshold T, it waits until (reset − (remaining−S)×C)
// so the run resumes right before the window resets.
async function pipelineQuotaWaitOrStop(config, token) {
  const q = config.quotaGate;
  const overallDeadline = Date.now() + 6 * 3600 * 1000;
  while (pipelineIsCurrent(token)) {
    setPipelineStatus('quota', `檢查 ${terminalAgentLabel(q.agent)} 配額中…`);
    pipelineLog('info', '查詢剩餘配額（安全模式，不送出 prompt）');
    const quota = await pipelineCheckQuota(q.agent);
    if (!pipelineIsCurrent(token)) {
      return 'stop';
    }
    if (quota.remaining == null) {
      pipelineLog('warn', `無法判斷配額（${quota.status}）`);
      return q.stopOnUnknown ? 'stop' : 'proceed';
    }
    pipelineLog('info', `剩餘配額 ${quota.remaining}%（門檻 T=${q.minRemaining}%）`);
    if (quota.remaining > q.minRemaining) {
      return 'proceed';
    }

    let waitSec;
    if (quota.resetSeconds != null) {
      const resumeBefore = Math.max(0, quota.remaining - q.safetyBuffer) * q.countdownPerPercent;
      waitSec = Math.max(0, quota.resetSeconds - resumeBefore);
      pipelineLog('info', `重置約 ${Math.round(quota.resetSeconds)}s 後；(剩餘${quota.remaining}−S${q.safetyBuffer})×C${q.countdownPerPercent}=${Math.round(resumeBefore)}s，等待 ${Math.round(waitSec)}s 後續跑`);
    } else {
      waitSec = 60;
      pipelineLog('warn', '查無重置時間，改為每 60s 重新查詢配額直到恢復');
    }

    if (waitSec <= 0) {
      return 'proceed';
    }
    if (Date.now() + waitSec * 1000 > overallDeadline) {
      pipelineLog('warn', '配額等待超過 6 小時上限，停止');
      return 'stop';
    }
    state.terminalPipelineRun.status = 'quota';
    persistPipelineRunProgress();
    const completed = await pipelineCountdownSleep(waitSec, token, '配額調節');
    if (!completed) {
      return 'stop';
    }
    // Loop re-probes; if reset has happened, remaining recovers > T and we proceed.
  }
  return 'stop';
}

// Resolves a live agent terminal for `projectName`, launching one (configured agent +
// flags) if none is running. Returns { localId, justLaunched } or null on failure.
async function pipelinePrepareStepSession(projectName, token) {
  const project = projectName || state.terminalProjectName;
  if (project) {
    switchTerminalProject(project, { ensureDraft: true });
  }

  const live = terminalSessionsForProject(project).find(
    (item) => item.id && item.interactive && !item.exitedAt,
  );
  if (live) {
    state.terminalActiveSessionId = live.localId;
    rememberTerminalActiveSession(project, live.localId);
    renderTerminalModal();
    await pipelineWaitForSocket(live.localId, token, 8000);
    return { localId: live.localId, justLaunched: false };
  }

  ensureTerminalDraft(project, { readOnly: false });
  renderTerminalModal();
  const localId = state.terminalActiveSessionId;
  pipelineLog('info', `啟動 ${terminalAgentLabel(terminalFavoriteAgentId())}（${project || '預設'}）…`);
  const launched = pipelineLaunchAgentCommand();
  if (launched) {
    pipelineLog('info', launched);
  }
  // In Pipeline 管理 mode the terminal surface (and its socket) isn't mounted; we drive
  // the session over POST + polling. Wait briefly for the server session id, then rely
  // on the idle-settle wait below — no need to block for a socket that won't connect.
  const ready = await pipelineWaitForSessionId(localId, token, 12000);
  if (!pipelineIsCurrent(token)) {
    return null;
  }
  if (!ready) {
    pipelineLog('warn', '終端建立較慢，仍嘗試送出 prompt');
  }
  const idleMs = getTerminalPipeline().idleSeconds * 1000;
  await pipelineWaitForCompletion(localId, token, {
    idleMs: Math.max(2500, Math.min(idleMs, 6000)),
    minMs: 2000,
    maxMs: 60000,
  });
  return { localId, justLaunched: true };
}

function resumeTerminalPipeline() {
  runTerminalPipeline({ resume: true });
}

async function runTerminalPipeline({ resume = false } = {}) {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }
  if (state.terminalPipelineRun.active) {
    return;
  }
  if (terminalIsReadOnly()) {
    showToast('Pipeline 執行只能在本機啟動（手機可編輯設定）。');
    return;
  }

  const config = getTerminalPipeline();
  const allSteps = config.steps.filter((step) => step.prompt.trim());
  if (!allSteps.length) {
    showToast('請先輸入至少一段 prompt');
    return;
  }

  const defaultProject = state.terminalProjectName
    || state.selectedName
    || state.payload?.projects?.[0]?.name
    || '';

  // Apply saved 'done' statuses when resuming so we skip completed steps.
  const savedDone = new Set();
  if (resume && Array.isArray(state.terminalPipelineRunSaved?.steps)) {
    state.terminalPipelineRunSaved.steps.forEach((step) => {
      if (step.status === 'done') {
        savedDone.add(step.id);
      }
    });
  }
  const runSteps = allSteps.map((step) => ({
    id: step.id,
    project: step.project || defaultProject,
    conversation: step.conversation,
    prompt: step.prompt,
    status: savedDone.has(step.id) ? 'done' : 'pending',
  }));
  const startIndex = runSteps.findIndex((step) => step.status !== 'done');
  if (startIndex < 0) {
    showToast('這個 pipeline 的所有段落都已完成');
    clearPipelineRunSaved();
    return;
  }

  const token = ++terminalPipelineToken;
  state.terminalPipelineRun = {
    active: true,
    sessionLocalId: null,
    stepIndex: -1,
    activeStepId: null,
    total: runSteps.length,
    status: 'running',
    message: resume ? '接續中…' : '準備中…',
    log: [],
    startedAt: new Date().toISOString(),
    steps: runSteps,
  };
  state.terminalModalMode = 'pipeline';
  const agentLabel = terminalAgentLabel(terminalFavoriteAgentId());
  const resetCommand = config.resetCommand || TERMINAL_PIPELINE_AGENT_RESET[terminalFavoriteAgentId()] || '/clear';
  const idleMs = config.idleSeconds * 1000;
  const maxMs = config.maxWaitSeconds * 1000;
  pipelineLog('info', `${resume ? '接續' : '啟動'} Pipeline（${agentLabel}），共 ${runSteps.length} 段，自第 ${startIndex + 1} 段開始`);
  persistPipelineRunProgress();
  renderTerminalModal();

  // Projects whose agent we've already launched in this run (so 延續對話 reuses it).
  const launchedProjects = new Set();

  try {
    for (let i = startIndex; i < runSteps.length; i += 1) {
      if (!pipelineIsCurrent(token)) {
        break;
      }
      const step = runSteps[i];
      if (step.status === 'done') {
        continue;
      }
      const projectName = step.project || defaultProject;
      state.terminalPipelineRun.stepIndex = i;
      state.terminalPipelineRun.activeStepId = step.id;
      setPipelineStatus('running', `第 ${i + 1}/${runSteps.length} 段（${projectName || '預設'}）`);

      // 5h-limit pacing: wait until near the reset when remaining ≤ T.
      if (config.quotaGate.enabled) {
        const gate = await pipelineQuotaWaitOrStop(config, token);
        if (!pipelineIsCurrent(token)) {
          break;
        }
        if (gate === 'stop') {
          pipelineLog('warn', '配額不足，停止 pipeline（可於恢復後接續）');
          setPipelineStatus('quota-stopped', '配額不足，已停止（之後可接續）');
          persistPipelineRunProgress();
          return;
        }
      }

      // Ensure a live agent terminal for this step's project (launch if needed).
      setPipelineStatus('running', `準備 ${projectName || '預設'} 終端…`);
      const prep = await pipelinePrepareStepSession(projectName, token);
      if (!pipelineIsCurrent(token)) {
        break;
      }
      if (!prep) {
        pipelineLog('error', `無法啟動 ${projectName || '預設'} 終端`);
        setPipelineStatus('error', `無法啟動 ${projectName || '預設'} 終端`);
        persistPipelineRunProgress();
        return;
      }
      state.terminalPipelineRun.sessionLocalId = prep.localId;
      if (prep.justLaunched) {
        launchedProjects.add(projectName);
      }

      // On a reused session, honour the conversation mode.
      if (!prep.justLaunched && step.conversation === 'new') {
        pipelineLog('info', `開新對話：送出 ${resetCommand}`);
        await pipelineSendLine(prep.localId, resetCommand, token);
        await pipelineWaitForCompletion(prep.localId, token, { idleMs: 2500, minMs: 1200, maxMs: 30000 });
        if (!pipelineIsCurrent(token)) {
          break;
        }
      } else if (!prep.justLaunched) {
        pipelineLog('info', '延續目前對話');
      }

      pipelineLog('info', `送出第 ${i + 1} 段 prompt → ${projectName || '預設'}`);
      await pipelineSendLine(prep.localId, step.prompt, token);
      setPipelineStatus('running', `等待第 ${i + 1}/${runSteps.length} 段完成…`);
      const result = await pipelineWaitForCompletion(prep.localId, token, { idleMs, minMs: 2500, maxMs });
      if (!pipelineIsCurrent(token)) {
        break;
      }
      if (result === 'exited') {
        pipelineLog('warn', `Agent 已結束（${projectName || '預設'}），停止 pipeline`);
        setPipelineStatus('error', 'Agent 已結束');
        persistPipelineRunProgress();
        return;
      }
      step.status = 'done';
      persistPipelineRunProgress();
      pipelineLog(result === 'timeout' ? 'warn' : 'info', `第 ${i + 1} 段完成（${result === 'timeout' ? '逾時' : '偵測到閒置'}）`);
    }

    if (pipelineIsCurrent(token)) {
      pipelineLog('info', '全部 prompt 已送出完成');
      setPipelineStatus('done', '全部完成');
      clearPipelineRunSaved();
    }
  } catch (error) {
    if (token === terminalPipelineToken) {
      pipelineLog('error', error.message);
      setPipelineStatus('error', error.message);
      persistPipelineRunProgress();
    }
  } finally {
    if (token === terminalPipelineToken) {
      state.terminalPipelineRun.active = false;
      renderTerminalModal();
    }
  }
}

function stopTerminalPipeline() {
  if (!state.terminalPipelineRun.active) {
    return;
  }
  terminalPipelineToken += 1;
  state.terminalPipelineRun.active = false;
  state.terminalPipelineRun.status = 'stopped';
  pipelineLog('warn', '使用者已停止 pipeline（可稍後接續）');
  // Keep the progress so the user can resume the remaining steps later.
  persistPipelineRunProgress();
  setPipelineStatus('stopped', '已停止（可接續）');
  renderTerminalModal();
}

function setTerminalContentTab(tabId) {
  if (!TERMINAL_CONTENT_TAB_IDS.has(tabId) || state.terminalContentTab === tabId) {
    return;
  }
  state.terminalContentTab = tabId;
  renderTerminalModal();
}

function setTerminalModalMode(mode) {
  const next = mode === 'pipeline' ? 'pipeline' : mode === 'notepad' ? 'notepad' : 'terminal';
  if (state.terminalModalMode === next) {
    return;
  }
  state.terminalModalMode = next;
  renderTerminalModal();
}

// ---- 記事本(不執行的 pipeline 草稿)----
function addTerminalNotepadStep() {
  const notepad = getTerminalNotepad();
  notepad.steps.push(normalizeTerminalPipelineStep({ conversation: 'same' }));
  saveTerminalNotepad();
  renderTerminalModal();
}

function deleteTerminalNotepadStep(id) {
  const notepad = getTerminalNotepad();
  if (notepad.steps.length <= 1) {
    return;
  }
  notepad.steps = notepad.steps.filter((step) => step.id !== id);
  saveTerminalNotepad();
  renderTerminalModal();
}

function setTerminalNotepadConversation(id, conversationMode) {
  if (!TERMINAL_PIPELINE_CONVERSATIONS.has(conversationMode)) {
    return;
  }
  const notepad = getTerminalNotepad();
  const step = notepad.steps.find((item) => item.id === id);
  if (!step || step.conversation === conversationMode) {
    return;
  }
  step.conversation = conversationMode;
  saveTerminalNotepad();
  renderTerminalModal();
}

// Save edits from the notepad prompt/project controls without re-rendering, so the
// field the user is typing in keeps focus.
function updateTerminalNotepadFromInput(target) {
  if (target.dataset.notepadPrompt === undefined) {
    return false;
  }
  const notepad = getTerminalNotepad();
  const step = notepad.steps.find((item) => item.id === target.dataset.notepadPrompt);
  if (step) {
    step.prompt = String(target.value || '').slice(0, TERMINAL_PIPELINE_PROMPT_LIMIT);
    saveTerminalNotepad();
  }
  return true;
}

function updateTerminalNotepadFromChange(target) {
  if (target.dataset.notepadProject === undefined) {
    return false;
  }
  if (target.value === TERMINAL_NEW_PROJECT_OPTION) {
    chooseNewProjectForStep('notepad', target.dataset.notepadProject);
    return true;
  }
  const notepad = getTerminalNotepad();
  const step = notepad.steps.find((item) => item.id === target.dataset.notepadProject);
  if (step) {
    step.project = terminalProjectList().some((project) => project.name === target.value) ? target.value : '';
    saveTerminalNotepad();
  }
  return true;
}

// Triggered when a per-step project picker selects 「＋ 新增專案…」. Creates the project,
// then points that step at the freshly created project (or reverts on cancel/failure).
async function chooseNewProjectForStep(scope, stepId) {
  const createdName = await createNewProject();
  const container = scope === 'pipeline' ? getTerminalPipeline() : getTerminalNotepad();
  const step = container.steps.find((item) => item.id === stepId);
  if (step && createdName) {
    step.project = createdName;
    if (scope === 'pipeline') {
      saveTerminalPipeline();
    } else {
      saveTerminalNotepad();
    }
  }
  renderTerminalModal();
}

// Append the notepad's (non-empty) steps to the real Pipeline. With keepCopy the
// notepad keeps its steps; otherwise it is reset to a single blank step.
function addTerminalNotepadToPipeline({ keepCopy = false } = {}) {
  if (state.terminalPipelineRun.active) {
    showToast('Pipeline 執行中,請先停止再加入段落');
    return;
  }
  const notepad = getTerminalNotepad();
  const steps = notepad.steps.filter((step) => step.prompt.trim());
  if (!steps.length) {
    showToast('記事本沒有可加入的段落(每段需有 prompt)');
    return;
  }

  const pipeline = getTerminalPipeline();
  // Drop the pipeline's leftover blank steps, then append fresh copies of the notepad
  // steps with new ids so the two lists never share step identities.
  const kept = pipeline.steps.filter((step) => step.prompt.trim());
  const additions = steps.map((step) => normalizeTerminalPipelineStep({ ...step, id: terminalPipelineStepId() }));
  pipeline.steps = [...kept, ...additions];
  saveTerminalPipeline();

  if (!keepCopy) {
    state.terminalNotepad = defaultTerminalNotepad();
    saveTerminalNotepad();
  }

  showToast(keepCopy
    ? `已加入 Pipeline(保留副本),共 ${additions.length} 段`
    : `已加入 Pipeline,共 ${additions.length} 段`);
  state.terminalModalMode = 'pipeline';
  renderTerminalModal();
}

// Append a single notepad step to the real Pipeline. Stays in the notepad afterwards so
// the user can keep curating; with keepCopy the step is kept, otherwise it is removed.
function addTerminalNotepadStepToPipeline(stepId, { keepCopy = false } = {}) {
  if (state.terminalPipelineRun.active) {
    showToast('Pipeline 執行中,請先停止再加入段落');
    return;
  }
  const notepad = getTerminalNotepad();
  const step = notepad.steps.find((item) => item.id === stepId);
  if (!step || !step.prompt.trim()) {
    showToast('這段沒有可加入的 prompt');
    return;
  }

  const pipeline = getTerminalPipeline();
  const kept = pipeline.steps.filter((item) => item.prompt.trim());
  pipeline.steps = [...kept, normalizeTerminalPipelineStep({ ...step, id: terminalPipelineStepId() })];
  saveTerminalPipeline();

  if (!keepCopy) {
    if (notepad.steps.length <= 1) {
      state.terminalNotepad = defaultTerminalNotepad();
    } else {
      notepad.steps = notepad.steps.filter((item) => item.id !== stepId);
    }
    saveTerminalNotepad();
  }

  showToast(keepCopy ? '已加入 Pipeline(保留副本)' : '已加入 Pipeline');
  renderTerminalModal();
}

function addTerminalPipelineStep() {
  if (state.terminalPipelineRun.active) {
    return;
  }
  const config = getTerminalPipeline();
  config.steps.push(normalizeTerminalPipelineStep({ conversation: 'same' }));
  saveTerminalPipeline();
  state.terminalModalMode = 'pipeline';
  renderTerminalModal();
}

function deleteTerminalPipelineStep(id) {
  if (state.terminalPipelineRun.active) {
    return;
  }
  const config = getTerminalPipeline();
  if (config.steps.length <= 1) {
    return;
  }
  config.steps = config.steps.filter((step) => step.id !== id);
  saveTerminalPipeline();
  state.terminalModalMode = 'pipeline';
  renderTerminalModal();
}

function setTerminalPipelineConversation(id, mode) {
  if (state.terminalPipelineRun.active || !TERMINAL_PIPELINE_CONVERSATIONS.has(mode)) {
    return;
  }
  const config = getTerminalPipeline();
  const step = config.steps.find((item) => item.id === id);
  if (!step || step.conversation === mode) {
    return;
  }
  step.conversation = mode;
  saveTerminalPipeline();
  state.terminalModalMode = 'pipeline';
  renderTerminalModal();
}

// Save edits from the pipeline prompt/settings controls without re-rendering, so
// the field the user is typing in keeps focus.
function updateTerminalPipelineFromInput(target) {
  const config = getTerminalPipeline();
  if (target.dataset.pipelinePrompt !== undefined) {
    const step = config.steps.find((item) => item.id === target.dataset.pipelinePrompt);
    if (step) {
      step.prompt = String(target.value || '').slice(0, TERMINAL_PIPELINE_PROMPT_LIMIT);
      saveTerminalPipeline();
    }
    return true;
  }
  if (target.dataset.pipelineIdle !== undefined) {
    config.idleSeconds = clampNumber(target.value, TERMINAL_PIPELINE_IDLE_MIN, TERMINAL_PIPELINE_IDLE_MAX, config.idleSeconds);
    saveTerminalPipeline();
    return true;
  }
  if (target.dataset.pipelineMaxwait !== undefined) {
    config.maxWaitSeconds = clampNumber(target.value, TERMINAL_PIPELINE_MAXWAIT_MIN, TERMINAL_PIPELINE_MAXWAIT_MAX, config.maxWaitSeconds);
    saveTerminalPipeline();
    return true;
  }
  if (target.dataset.pipelineReset !== undefined) {
    config.resetCommand = String(target.value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
    saveTerminalPipeline();
    return true;
  }
  if (target.dataset.pipelineQuotaThreshold !== undefined) {
    config.quotaGate.minRemaining = clampNumber(target.value, 0, 100, config.quotaGate.minRemaining);
    saveTerminalPipeline();
    return true;
  }
  if (target.dataset.pipelineQuotaCountdown !== undefined) {
    config.quotaGate.countdownPerPercent = clampNumber(target.value, TERMINAL_PIPELINE_COUNTDOWN_MIN, TERMINAL_PIPELINE_COUNTDOWN_MAX, config.quotaGate.countdownPerPercent);
    saveTerminalPipeline();
    return true;
  }
  if (target.dataset.pipelineQuotaSafety !== undefined) {
    config.quotaGate.safetyBuffer = clampNumber(target.value, TERMINAL_PIPELINE_SAFETY_MIN, TERMINAL_PIPELINE_SAFETY_MAX, config.quotaGate.safetyBuffer);
    saveTerminalPipeline();
    return true;
  }
  return false;
}

// Toggle-style controls re-render so dependent fields enable/disable correctly.
function updateTerminalPipelineFromChange(target) {
  const config = getTerminalPipeline();
  if (target.dataset.pipelineQuotaEnabled !== undefined) {
    config.quotaGate.enabled = target.checked === true;
    saveTerminalPipeline();
    renderTerminalModal();
    return true;
  }
  if (target.dataset.pipelineQuotaStrict !== undefined) {
    config.quotaGate.stopOnUnknown = target.checked === true;
    saveTerminalPipeline();
    return true;
  }
  if (target.dataset.pipelineQuotaAgent !== undefined) {
    config.quotaGate.agent = terminalAgentIds.has(target.value) ? target.value : config.quotaGate.agent;
    saveTerminalPipeline();
    return true;
  }
  if (target.dataset.pipelineProject !== undefined) {
    if (target.value === TERMINAL_NEW_PROJECT_OPTION) {
      chooseNewProjectForStep('pipeline', target.dataset.pipelineProject);
      return true;
    }
    const step = config.steps.find((item) => item.id === target.dataset.pipelineProject);
    if (step) {
      step.project = terminalProjectList().some((project) => project.name === target.value) ? target.value : '';
      saveTerminalPipeline();
    }
    return true;
  }
  return false;
}

// Closes every terminal session that belongs to a project (and stops a pipeline
// running against it). Used when a project is refreshed so stale agent/dev
// processes are torn down before the project is re-read.
async function closeProjectTerminalSessions(projectName) {
  if (DEMO_MODE || !projectName) {
    return 0;
  }

  if (state.terminalPipelineRun.active) {
    const runSession = findTerminalSession(state.terminalPipelineRun.sessionLocalId);
    if (runSession && runSession.projectName === projectName) {
      stopTerminalPipeline();
    }
  }

  const sessions = state.terminalSessions.filter((session) => session.projectName === projectName);
  sessions.forEach((session) => disposeTerminalView(session.localId));

  try {
    await api(`/api/projects/${encodeURIComponent(projectName)}/terminals/close`, {
      method: 'POST',
      body: '{}',
    });
  } catch (error) {
    // Best-effort: even if the server call fails we still drop local references.
  }

  const localIds = new Set(sessions.map((session) => session.localId));
  sessions.forEach((session) => {
    if (session.id) {
      state.terminalWorkspaceMetaBySessionId.delete(session.id);
    }
  });
  state.terminalSessions = state.terminalSessions.filter((session) => !localIds.has(session.localId));

  if (localIds.has(state.terminalActiveSessionId)) {
    const remaining = terminalSessionsForProject(state.terminalProjectName);
    state.terminalActiveSessionId = remaining[0]?.localId || null;
    rememberTerminalActiveSession();
  }
  if (state.terminalFocusAppliedSessionId && localIds.has(state.terminalFocusAppliedSessionId)) {
    state.terminalFocusAppliedSessionId = null;
  }

  saveTerminalWorkspaceState();
  if (state.terminalModalOpen) {
    renderTerminalModal();
  }
  return sessions.length;
}

async function closeTerminalDialog(localId) {
  const session = findTerminalSession(localId);
  if (!session) {
    return;
  }

  if (session.readOnly && session.id) {
    showToast('Terminal is read-only from LAN/Tailscale.');
    return;
  }

  const closingActiveSession = state.terminalActiveSessionId === localId;
  const signal = beginTerminalSessionBusy(session, '關閉對話…');
  renderTerminalModal();
  try {
    if (session.id) {
      await api(`/api/terminals/${encodeURIComponent(session.id)}`, {
        method: 'DELETE',
        signal,
      });
      state.terminalWorkspaceMetaBySessionId.delete(session.id);
    }

    disposeTerminalView(localId);
    state.terminalSessions = state.terminalSessions.filter((item) => item.localId !== localId);
    const sessions = terminalSessionsForProject();
    if (state.terminalTitleEditingId === localId) {
      state.terminalTitleEditingId = null;
      state.terminalTitleDraft = '';
    }
    if (closingActiveSession || !sessions.some((item) => item.localId === state.terminalActiveSessionId)) {
      state.terminalActiveSessionId = sessions[0]?.localId || null;
    }
    rememberTerminalActiveSession();
    saveTerminalWorkspaceState();
    renderTerminalModal();
  } catch (error) {
    // 中斷 or failure: keep the conversation; just clear the busy state.
    endTerminalSessionBusy(session);
    if (!isAbortError(error)) {
      showToast(error.message);
    }
    renderTerminalModal();
  }
}

// Pick up terminal sessions launched on another device (e.g. desktop) so the phone's
// view stays connected to the same live terminals, and drop ones closed elsewhere.
async function discoverRemoteTerminalSessions() {
  try {
    const payload = await api('/api/terminals');
    const snapshots = Array.isArray(payload.sessions) ? payload.sessions : [];
    const liveIds = new Set(snapshots.map((snapshot) => snapshot && snapshot.id).filter(Boolean));
    const knownIds = new Set(state.terminalSessions.filter((session) => session.id).map((session) => session.id));

    let changed = false;
    snapshots.forEach((snapshot) => {
      if (snapshot?.id && !knownIds.has(snapshot.id)) {
        mergeTerminalSessionSnapshot(snapshot);
        changed = true;
      }
    });

    const before = state.terminalSessions.length;
    state.terminalSessions = state.terminalSessions.filter((session) => !session.id || liveIds.has(session.id));
    if (state.terminalSessions.length !== before) {
      changed = true;
    }
    state.terminalWorkspaceMetaBySessionId = new Map(
      [...state.terminalWorkspaceMetaBySessionId.entries()].filter(([id]) => liveIds.has(id)),
    );

    if (!changed) {
      return;
    }

    if (!state.terminalProjectName && state.terminalSessions.length) {
      state.terminalProjectName = state.terminalSessions[0].projectName;
    }
    if (state.terminalProjectName) {
      const sessions = terminalSessionsForProject(state.terminalProjectName);
      if (sessions.length && !sessions.some((session) => session.localId === state.terminalActiveSessionId)) {
        state.terminalActiveSessionId = sessions[0].localId;
        rememberTerminalActiveSession();
      }
    }

    saveTerminalWorkspaceState();
    renderTerminalModal();
  } catch {
    // Best-effort cross-device discovery; ignore transient network errors.
  }
}

// Keep this device's pipeline config in step with edits made elsewhere (e.g. set on the
// phone, run on the local machine) without clobbering an in-progress run or an active edit.
async function syncTerminalPipelineFromServer() {
  if (state.terminalPipelineRun.active) {
    return;
  }
  const active = document.activeElement;
  if (active?.closest?.('.terminal-pipeline')) {
    return;
  }

  try {
    const payload = await api('/api/terminal-preferences');
    if (!payload?.pipeline || typeof payload.pipeline !== 'object') {
      return;
    }
    const incoming = JSON.stringify(normalizeTerminalPipeline(payload.pipeline));
    if (incoming === JSON.stringify(normalizeTerminalPipeline(state.terminalPipeline))) {
      return;
    }
    state.terminalPipeline = JSON.parse(incoming);
    saveTerminalPipeline({ sync: false });
    renderTerminalModal();
  } catch {
    // Best-effort; ignore transient network errors.
  }
}

async function pollTerminalSessions() {
  if (!state.terminalModalOpen) {
    return;
  }

  terminalListSyncTick += 1;
  if (terminalListSyncTick % 4 === 0) {
    await discoverRemoteTerminalSessions();
  }
  if (terminalListSyncTick % 6 === 0) {
    await syncTerminalPipelineFromServer();
  }

  const sessions = state.terminalSessions.filter((session) => session.id && !session.exitedAt && !hasLiveTerminalSocket(session));
  let needsRender = false;
  await Promise.all(
    sessions.map(async (session) => {
      try {
        const wasRunning = session.running;
        const payload = await api(`/api/terminals/${encodeURIComponent(session.id)}?cursor=${encodeURIComponent(session.cursor || 0)}`);
        applyTerminalPayload(session, payload);
        needsRender = needsRender || wasRunning !== session.running || Boolean(session.exitedAt);
        if (session.localId === state.terminalActiveSessionId) {
          updateTerminalSessionView(session);
        }
      } catch (error) {
        session.output += `\n[Agent Task Manager (ATM)] ${error.message}\n`;
        session.exitedAt = new Date().toISOString();
        session.running = false;
        needsRender = true;
      }
    }),
  );
  if (needsRender) {
    saveTerminalWorkspaceState();
    renderTerminalModal();
  } else {
    renderTerminalTabs();
  }
}

function startTerminalPolling() {
  if (terminalPollTimer) {
    return;
  }

  terminalPollTimer = window.setInterval(pollTerminalSessions, 1000);
  pollTerminalSessions();
}

function stopTerminalPolling() {
  if (!terminalPollTimer) {
    return;
  }

  window.clearInterval(terminalPollTimer);
  terminalPollTimer = null;
}

async function copyText(value) {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  if (!value || value === '--') {
    showToast('沒有可複製的內容');
    return;
  }

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      fallbackCopyText(value);
    }
    showToast('已複製');
  } catch (error) {
    try {
      fallbackCopyText(value);
      showToast('已複製');
    } catch (fallbackError) {
      showToast('複製失敗，請手動選取內容');
    }
  }
}

function fallbackCopyText(value) {
  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textArea);
  if (!ok) {
    throw new Error('execCommand copy failed');
  }
}

function quotaStatusLabel(status) {
  const labels = {
    ok: '已讀取',
    loading: '檢查中',
    pending: '等待檢查',
    missing: '未安裝',
    auth: '需要登入',
    timeout: '逾時',
    tty: '需互動終端',
    unknown: '未找到百分比',
    error: '讀取失敗',
    canceled: '已中斷',
  };
  return labels[status] || status || '未知';
}

function quotaAgentFromPayload(agentId) {
  return state.quotaPayload?.agents?.find((agent) => agent.id === agentId) || null;
}

function quotaPayloadIsStale(payload = state.quotaPayload) {
  const checkedAt = payload?.checkedAt ? new Date(payload.checkedAt).getTime() : 0;
  if (!Number.isFinite(checkedAt) || checkedAt <= 0) {
    return true;
  }
  return Date.now() - checkedAt >= AI_QUOTA_MONITOR_STALE_MS;
}

function quotaPercentLabel(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) {
    return '--%';
  }
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function renderQuotaMonitor() {
  if (!state.quotaModalOpen) {
    return;
  }

  elements.refreshQuotaButton.disabled = state.quotaLoading;
  const checkedAt = state.quotaPayload?.checkedAt
    ? new Intl.DateTimeFormat('zh-TW', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(state.quotaPayload.checkedAt))
    : '--';
  const safety = state.quotaPayload?.safeMode?.summary
    || '安全模式：只執行登入/狀態查詢與 CLI slash 指令，沒有送出自然語言 prompt。';
  elements.quotaSafetyNote.textContent = safety;
  elements.quotaSummary.innerHTML = `
    <span>更新時間 ${escapeHtml(checkedAt)}</span>
    ${state.quotaError ? `<strong>${escapeHtml(state.quotaError)}</strong>` : ''}
  `;

  elements.quotaCards.innerHTML = AI_QUOTA_MONITOR_AGENTS.map((agent) => {
    const payloadAgent = quotaAgentFromPayload(agent.id);
    const status = state.quotaLoading && !payloadAgent ? 'loading' : (payloadAgent?.status || 'pending');
    const percent = payloadAgent?.percent;
    const percentText = payloadAgent?.percentLabel || quotaPercentLabel(percent);
    const progressValue = Number.isFinite(Number(percent)) ? Math.max(0, Math.min(100, Number(percent))) : 0;
    const signals = Array.isArray(payloadAgent?.signals) && payloadAgent.signals.length
      ? payloadAgent.signals.slice(0, 3)
      : [];
    const signalRows = signals.length
      ? signals.map((signal) => `
          <li>
            <span>${escapeHtml(signal.label || 'usage')}</span>
            <strong>${escapeHtml(signal.percentLabel || quotaPercentLabel(signal.percent))}</strong>
          </li>
        `).join('')
      : '<li><span>usage</span><strong>--%</strong></li>';
    const summary = payloadAgent?.summary || (state.quotaLoading ? '正在啟動 CLI 查詢用量。' : '開啟後會自動檢查。');

    return `
      <article class="quota-card quota-card-${escapeHtml(agent.id)}">
        <div class="quota-card-header">
          <div>
            <strong>${escapeHtml(agent.label)}</strong>
            <span>${escapeHtml(agent.provider)}</span>
          </div>
          <span class="quota-status ${escapeHtml(status)}">${escapeHtml(quotaStatusLabel(status))}</span>
        </div>
        <div class="quota-meter">
          <div
            class="quota-meter-ring"
            style="--quota-percent: ${progressValue}%"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${Math.round(progressValue)}"
            aria-label="${escapeHtml(agent.label)} quota ${escapeHtml(percentText)}"
          >
            <span>${escapeHtml(percentText)}</span>
          </div>
          <div class="quota-meter-body">
            <span>${escapeHtml(agent.probe)}</span>
            <p>${escapeHtml(summary)}</p>
          </div>
        </div>
        <ul class="quota-signal-list">
          ${signalRows}
        </ul>
      </article>
    `;
  }).join('');
}

async function loadAiQuotas() {
  if (state.quotaLoading) {
    return;
  }

  const requestId = state.quotaRequestId + 1;
  state.quotaRequestId = requestId;
  state.quotaLoading = true;
  state.quotaError = '';
  renderQuotaMonitor();

  try {
    const payload = await api('/api/ai-quotas');
    if (state.quotaRequestId === requestId) {
      state.quotaPayload = payload;
    }
  } catch (error) {
    if (state.quotaRequestId === requestId) {
      state.quotaError = error.message;
    }
  } finally {
    if (state.quotaRequestId === requestId) {
      state.quotaLoading = false;
      renderQuotaMonitor();
    }
  }
}

function cancelAiQuotaProbe() {
  if (!state.quotaLoading) {
    return;
  }

  state.quotaRequestId += 1;
  state.quotaLoading = false;
  if (DEMO_MODE) {
    return;
  }

  fetch('/api/ai-quotas/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    keepalive: true,
  }).catch(() => {
    // Closing the monitor should stay fast even if the cancel request is interrupted.
  });
}

function openQuotaMonitor({ syncHash = true, refresh = true } = {}) {
  if (syncHash && window.location.hash !== '#ai-quota') {
    window.location.hash = 'ai-quota';
    return;
  }

  state.quotaModalOpen = true;
  elements.quotaModal.hidden = false;
  renderQuotaMonitor();
  if (refresh || quotaPayloadIsStale()) {
    loadAiQuotas();
  }
}

function hideQuotaMonitor({ syncHash = true } = {}) {
  cancelAiQuotaProbe();
  state.quotaModalOpen = false;
  elements.quotaModal.hidden = true;
  if (syncHash && window.location.hash === '#ai-quota') {
    history.pushState('', document.title, `${window.location.pathname}${window.location.search}`);
  }
}

function syncQuotaRouteFromHash() {
  if (window.location.hash === '#ai-quota') {
    openQuotaMonitor({ syncHash: false, refresh: quotaPayloadIsStale() });
  } else if (state.quotaModalOpen) {
    hideQuotaMonitor({ syncHash: false });
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cssAttrValue(value) {
  return String(value ?? '').replace(/(["\\])/g, '\\$1');
}

function setRestartMenuOpen(open) {
  state.restartMenuOpen = Boolean(open);
  elements.restartMenuPopover.hidden = !state.restartMenuOpen;
  elements.restartMenuButton.setAttribute('aria-expanded', String(state.restartMenuOpen));
}

function toggleRestartMenu() {
  setRestartMenuOpen(!state.restartMenuOpen);
}

elements.restartMenuButton.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleRestartMenu();
});

elements.restartMenuPopover.addEventListener('click', (event) => {
  const item = event.target.closest('[data-restart-action]');
  if (!item) {
    return;
  }
  event.stopPropagation();
  setRestartMenuOpen(false);
  runRestartMenuAction(item.dataset.restartAction);
});

// Dismiss the menu on an outside click or Escape.
document.addEventListener('click', (event) => {
  if (state.restartMenuOpen && !elements.restartMenuButton.parentElement.contains(event.target)) {
    setRestartMenuOpen(false);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.restartMenuOpen) {
    setRestartMenuOpen(false);
  }
});

elements.quotaMonitorButton.addEventListener('click', () => openQuotaMonitor());
elements.pipelineOpenButton.addEventListener('click', () => openPipelineManager());
elements.openAtmTerminalButton?.addEventListener('click', () => {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }
  openTerminalManager(ATM_TERMINAL_PROJECT_NAME);
});
elements.themeToggleButton.addEventListener('click', () => {
  const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme, { persist: true });
  showToast(nextTheme === 'dark' ? '已切換深色主題' : '已切換淺色主題');
});
elements.addRootButton.addEventListener('click', () => {
  if (!commitRootInput()) {
    showToast('請輸入專案位置');
    return;
  }
  discover({ commitDraft: false });
});
elements.newRootButton?.addEventListener('click', () => {
  createNewProject({ defaultName: elements.rootsInput.value.trim() });
});
elements.rootsInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }

  event.preventDefault();
  if (!commitRootInput()) {
    showToast('請輸入專案位置');
    return;
  }
  discover({ commitDraft: false });
});
elements.rootList.addEventListener('click', (event) => {
  if (state.suppressNextRootClick) {
    event.preventDefault();
    event.stopPropagation();
    state.suppressNextRootClick = false;
    return;
  }

  const removeButton = event.target.closest('button[data-remove-root]');
  if (removeButton) {
    event.stopPropagation();
    removeRootPath(Number(removeButton.dataset.rootIndex));
    discover({ commitDraft: false });
    return;
  }

  const openButton = event.target.closest('[data-open-root]');
  if (openButton) {
    event.stopPropagation();
    openRootFolder(state.rootPaths[Number(openButton.dataset.rootIndex)]);
  }
});
elements.rootList.addEventListener('pointerdown', startRootReorder);
setupRailResizer();
elements.basePortInput.addEventListener('change', () => discover());
elements.searchInput.addEventListener('input', (event) => {
  state.search = event.target.value;
  render();
});

elements.sortSelect.addEventListener('change', (event) => {
  state.sortKey = event.target.value;
  saveTablePreferences();
  render();
});

elements.sortDirectionButton.addEventListener('click', () => {
  state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  saveTablePreferences();
  render();
});

elements.projectHeaderRow.addEventListener('click', (event) => {
  const sortButton = event.target.closest('button[data-sort]');
  if (!sortButton) {
    return;
  }
  if (event.detail > 1) {
    cancelScheduledSort();
    return;
  }

  scheduleSort(sortButton.dataset.sort);
});

elements.tableWrap.addEventListener('pointerdown', startColumnResize);
elements.tableWrap.addEventListener('pointerdown', startColumnReorder);
elements.tableWrap.addEventListener('click', handleColumnDoubleClick, true);
elements.tableWrap.addEventListener(
  'click',
  (event) => {
    if (!state.suppressNextTableClick) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    state.suppressNextTableClick = false;
  },
  true,
);
elements.tableWrap.addEventListener('dragstart', (event) => {
  if (!state.columnDrag?.active) {
    return;
  }

  event.preventDefault();
});

window.addEventListener('pointermove', handleColumnPointerMove);
window.addEventListener('pointermove', handleColumnResizePointerMove);
window.addEventListener('pointermove', handleRootPointerMove);
window.addEventListener('pointerup', handleColumnPointerUp);
window.addEventListener('pointerup', (event) => {
  if (state.rootDrag?.pointerId === event.pointerId) {
    finishRootReorder({ suppressClick: state.rootDrag.active });
  }
});
window.addEventListener('pointercancel', (event) => {
  if (state.columnResize?.pointerId === event.pointerId) {
    endColumnResize({ suppressClick: state.columnResize.active });
    return;
  }
  if (state.columnDrag?.pointerId === event.pointerId) {
    endColumnDrag({ suppressClick: state.columnDrag.active });
  }
  if (state.rootDrag?.pointerId === event.pointerId) {
    finishRootReorder({ suppressClick: state.rootDrag.active });
  }
});
window.addEventListener('blur', () => {
  endColumnResize({ suppressClick: state.columnResize?.active });
  endColumnDrag({ suppressClick: state.columnDrag?.active });
  finishRootReorder({ suppressClick: state.rootDrag?.active });
});
window.addEventListener('resize', renderColumnGroup);
window.addEventListener('resize', () => window.requestAnimationFrame(updateRootPathMarquees));
window.addEventListener('hashchange', syncQuotaRouteFromHash);
window.addEventListener('beforeunload', cancelAiQuotaProbe);
const handleMobileLayoutChange = () => {
  if (isMobileLayout()) {
    state.expandedProjectNames.clear();
    state.projectPanelExpansionInitialized = false;
    state.mobileProjectTopAligned = false;
  }
  render();
};
if (typeof mobileLayoutMedia.addEventListener === 'function') {
  mobileLayoutMedia.addEventListener('change', handleMobileLayoutChange);
} else {
  mobileLayoutMedia.addListener(handleMobileLayoutChange);
}

elements.tableWrap.addEventListener('contextmenu', (event) => {
  if (state.columnDrag?.active || state.columnResize?.active) {
    event.preventDefault();
  }
});

elements.filterButtons.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-filter]');
  if (!button) {
    return;
  }

  state.filter = button.dataset.filter;
  elements.filterButtons.querySelectorAll('button').forEach((item) => {
    item.classList.toggle('is-active', item === button);
  });
  render();
});

elements.projectRows.addEventListener('click', (event) => {
  if (event.target.closest('[data-port-input]')) {
    return;
  }

  const panelToggleButton = event.target.closest('button[data-panel-toggle]');
  if (panelToggleButton) {
    event.stopPropagation();
    toggleProjectPanel(panelToggleButton.dataset.name);
    return;
  }

  const pageToggleButton = event.target.closest('button[data-page-toggle]');
  if (pageToggleButton) {
    event.stopPropagation();
    const projectName = pageToggleButton.dataset.name;
    if (state.expandedPageNames.has(projectName)) {
      state.expandedPageNames.delete(projectName);
    } else {
      state.expandedPageNames.add(projectName);
      if (isMobileLayout()) {
        state.expandedProjectNames.add(projectName);
      }
    }
    render();
    return;
  }

  const branchToggleButton = event.target.closest('button[data-branch-toggle]');
  if (branchToggleButton) {
    event.stopPropagation();
    const projectName = branchToggleButton.dataset.name;
    if (state.expandedBranchNames.has(projectName)) {
      state.expandedBranchNames.delete(projectName);
    } else {
      state.expandedBranchNames.add(projectName);
      if (isMobileLayout()) {
        state.expandedProjectNames.add(projectName);
      }
    }
    render();
    return;
  }

  const pageTargetButton = event.target.closest('button[data-page-target]');
  if (pageTargetButton) {
    event.stopPropagation();
    selectProjectPageTarget(pageTargetButton.dataset.name, pageTargetButton.dataset.pageTarget);
    return;
  }

  const connectionTargetButton = event.target.closest('button[data-connection-target]');
  if (connectionTargetButton) {
    event.stopPropagation();
    activateConnectionTarget(connectionTargetButton.dataset.name, connectionTargetButton.dataset.connectionTarget);
    return;
  }

  const actionButton = event.target.closest('button[data-action]');
  if (actionButton) {
    event.stopPropagation();
    runAction(actionButton.dataset.name, actionButton.dataset.action, { targetPath: actionButton.dataset.targetPath || '' });
    return;
  }

  const urlLink = event.target.closest('a.url-link, a.page-link, a.project-action-url, a.project-home-link');
  if (urlLink) {
    event.stopPropagation();
    return;
  }

  if (event.target.closest('tr[data-pages-for]')) {
    event.stopPropagation();
    return;
  }

  const row = event.target.closest('tr[data-name]');
  if (!row) {
    return;
  }

  // Selecting/highlighting a project row points the Log 面板 at it.
  state.selectedName = row.dataset.name;
  if (isMobileLayout()) {
    toggleProjectPanel(row.dataset.name);
  } else {
    render();
  }
  loadLogs();
});

elements.projectRows.addEventListener('keydown', (event) => {
  const portInput = event.target.closest('[data-port-input]');
  if (!portInput) {
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    portInput.blur();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    const project = state.payload?.projects.find((item) => item.name === portInput.dataset.name);
    const targetPath = String(portInput.dataset.targetPath || '').trim();
    const target = targetPath
      ? getProjectBackends(project).find((item) => String(item.path || '').toLowerCase() === targetPath.toLowerCase())
      : project;
    portInput.value = target?.port != null ? String(target.port) : '';
    portInput.blur();
  }
});

elements.projectRows.addEventListener('change', (event) => {
  const portInput = event.target.closest('[data-port-input]');
  if (!portInput) {
    return;
  }

  commitProjectPort(portInput.dataset.name, portInput.value, portInput.dataset.targetPath || '');
});

elements.profileSelect.addEventListener('change', (event) => {
  state.selectedProfileId = event.target.value;
  fillProfileEditor(selectedProfile());
  renderProfiles();
});
elements.profileNameInput.addEventListener('input', () => {
  state.profileEditorDirty = true;
});
elements.profileProjectsInput.addEventListener('input', () => {
  state.profileEditorDirty = true;
});
elements.useFilteredProjects.addEventListener('click', useCurrentFilteredProjects);
elements.saveProfileButton.addEventListener('click', saveProfile);
elements.deleteProfileButton.addEventListener('click', deleteProfile);
elements.startProfileButton.addEventListener('click', () => runProfileAction('start'));
elements.stopProfileButton.addEventListener('click', () => runProfileAction('stop'));
elements.restartProfileButton.addEventListener('click', () => runProfileAction('restart'));

elements.closeQuotaModal.addEventListener('click', () => hideQuotaMonitor());
elements.backToHomeFromQuota.addEventListener('click', () => hideQuotaMonitor());
elements.refreshQuotaButton.addEventListener('click', () => loadAiQuotas());
elements.quotaModal.addEventListener('click', (event) => {
  if (event.target === elements.quotaModal) {
    hideQuotaMonitor();
  }
});
elements.closeTerminalModal.addEventListener('click', hideTerminalManager);
elements.terminalModeTerminalButton?.addEventListener('click', () => setTerminalModalMode('terminal'));
elements.terminalModePipelineButton?.addEventListener('click', () => setTerminalModalMode('pipeline'));
elements.terminalModeNotepadButton?.addEventListener('click', () => setTerminalModalMode('notepad'));
elements.addTerminalSession.addEventListener('click', () => {
  if (!terminalCanAddSession()) {
    showToast('Terminal is read-only from LAN/Tailscale.');
    return;
  }

  if (!state.terminalProjectName) {
    showToast('請先選擇專案');
    return;
  }

  createTerminalDraft(state.terminalProjectName, { readOnly: terminalIsReadOnly() });
  saveTerminalWorkspaceState();
  renderTerminalModal();
});
elements.terminalTabs.addEventListener('click', (event) => {
  if (state.suppressTerminalTabClick) {
    event.preventDefault();
    event.stopPropagation();
    state.suppressTerminalTabClick = false;
    return;
  }

  const closeButton = event.target.closest('button[data-terminal-tab-close]');
  if (closeButton) {
    event.stopPropagation();
    closeTerminalDialog(closeButton.dataset.terminalTabClose);
    return;
  }

  const tab = event.target.closest('[data-terminal-tab]');
  if (!tab) {
    return;
  }

  state.terminalActiveSessionId = tab.dataset.terminalTab;
  rememberTerminalActiveSession();
  saveTerminalWorkspaceState();
  cancelTerminalTitleEdit(state.terminalTitleEditingId);
  renderTerminalModal();
});
elements.terminalTabs.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[data-terminal-tab]');
  if (!tab) {
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    state.terminalActiveSessionId = tab.dataset.terminalTab;
    rememberTerminalActiveSession();
    saveTerminalWorkspaceState();
    cancelTerminalTitleEdit(state.terminalTitleEditingId);
    renderTerminalModal();
  }
});
elements.terminalTabs.addEventListener('pointerdown', (event) => {
  const tab = event.target.closest('[data-terminal-tab]');
  if (!tab || event.button !== 0 || event.target.closest('button[data-terminal-tab-close]')) {
    return;
  }

  state.terminalTabDrag = {
    projectName: state.terminalProjectName,
    sourceId: tab.dataset.terminalTab,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
  };
  tab.setPointerCapture?.(event.pointerId);
});
elements.terminalTabs.addEventListener('pointermove', (event) => {
  const drag = state.terminalTabDrag;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }

  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.dragging && distance < TERMINAL_TAB_DRAG_THRESHOLD) {
    return;
  }

  drag.dragging = true;
  event.preventDefault();
  const sourceTab = elements.terminalTabs.querySelector(`[data-terminal-tab="${CSS.escape(drag.sourceId)}"]`);
  sourceTab?.classList.add('is-dragging');
  const targetTab = terminalTabAtPoint(event.clientX, event.clientY);
  updateTerminalTabDragTarget(targetTab && targetTab.dataset.terminalTab !== drag.sourceId ? targetTab : null);
});
elements.terminalTabs.addEventListener('pointerup', (event) => {
  const drag = state.terminalTabDrag;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }

  const sourceTab = elements.terminalTabs.querySelector(`[data-terminal-tab="${CSS.escape(drag.sourceId)}"]`);
  sourceTab?.releasePointerCapture?.(event.pointerId);
  if (drag.dragging) {
    event.preventDefault();
    state.suppressTerminalTabClick = true;
    const targetTab = terminalTabAtPoint(event.clientX, event.clientY);
    if (targetTab && reorderTerminalSession(drag.projectName, drag.sourceId, targetTab.dataset.terminalTab)) {
      state.terminalActiveSessionId = drag.sourceId;
      rememberTerminalActiveSession(drag.projectName, drag.sourceId);
      saveTerminalWorkspaceState();
      renderTerminalModal();
    } else {
      clearTerminalTabDragClasses();
    }
    window.setTimeout(() => {
      state.suppressTerminalTabClick = false;
    }, 0);
  }
  state.terminalTabDrag = null;
});
elements.terminalTabs.addEventListener('pointercancel', () => {
  state.terminalTabDrag = null;
  state.suppressTerminalTabClick = false;
  clearTerminalTabDragClasses();
});
elements.terminalWorkspace.addEventListener('change', (event) => {
  if (updateTerminalPipelineFromChange(event.target)) {
    return;
  }
  if (updateTerminalNotepadFromChange(event.target)) {
    return;
  }

  // 切換專案 picker now lives inside the page (workspace).
  const projectPicker = event.target.closest('select[data-terminal-project-picker]');
  if (projectPicker) {
    switchTerminalProject(projectPicker.value, { ensureDraft: true });
    renderTerminalModal();
    startTerminalPolling();
    return;
  }

  const shellSelect = event.target.closest('select[data-terminal-shell]');
  if (shellSelect) {
    const session = findTerminalSession(shellSelect.dataset.terminalShell);
    if (session && !session.id) {
      session.shellId = shellSelect.value;
      saveTerminalWorkspaceState();
      renderTerminalModal();
    }
  }

  const claudeModelSelect = event.target.closest('select[data-terminal-claude-model]');
  if (claudeModelSelect) {
    const customModel = claudeModelSelect.value === TERMINAL_CLAUDE_CUSTOM_MODEL_VALUE;
    const selectedModel = customModel
      ? (terminalClaudeModelOptionValue(state.terminalClaude.model) === TERMINAL_CLAUDE_CUSTOM_MODEL_VALUE ? state.terminalClaude.model : '')
      : claudeModelSelect.value;
    state.terminalClaude = normalizeTerminalClaudeSettings({
      ...state.terminalClaude,
      model: selectedModel,
      customModel,
    });
    saveTerminalClaudeSettings();
    renderTerminalModal();
    window.requestAnimationFrame(() => {
      const input = elements.terminalWorkspace.querySelector('[data-terminal-claude-custom-model]');
      input?.focus();
    });
    return;
  }

  const claudeEffortSelect = event.target.closest('select[data-terminal-claude-effort]');
  if (claudeEffortSelect) {
    state.terminalClaude = normalizeTerminalClaudeSettings({
      ...state.terminalClaude,
      effort: claudeEffortSelect.value,
    });
    saveTerminalClaudeSettings();
    syncTerminalClaudePreview();
    return;
  }

  const claudePermissionModeSelect = event.target.closest('select[data-terminal-claude-permission-mode]');
  if (claudePermissionModeSelect) {
    state.terminalClaude = normalizeTerminalClaudeSettings({
      ...state.terminalClaude,
      permissionMode: claudePermissionModeSelect.value,
    });
    saveTerminalClaudeSettings();
    syncTerminalClaudePreview();
    return;
  }

  const codexSandboxSelect = event.target.closest('select[data-terminal-codex-sandbox]');
  if (codexSandboxSelect) {
    state.terminalCodex = normalizeTerminalCodexSettings({
      ...state.terminalCodex,
      sandbox: codexSandboxSelect.value,
    });
    saveTerminalCodexSettings();
    syncTerminalAgentPreview('codex', buildTerminalCodexCommand());
    return;
  }

  const codexApprovalSelect = event.target.closest('select[data-terminal-codex-approval]');
  if (codexApprovalSelect) {
    state.terminalCodex = normalizeTerminalCodexSettings({
      ...state.terminalCodex,
      approval: codexApprovalSelect.value,
    });
    saveTerminalCodexSettings();
    syncTerminalAgentPreview('codex', buildTerminalCodexCommand());
    return;
  }

});
elements.terminalWorkspace.addEventListener('input', (event) => {
  if (updateTerminalPipelineFromInput(event.target)) {
    return;
  }
  if (updateTerminalNotepadFromInput(event.target)) {
    return;
  }

  const claudeCustomModelInput = event.target.closest('[data-terminal-claude-custom-model]');
  if (claudeCustomModelInput) {
    state.terminalClaude = normalizeTerminalClaudeSettings({
      ...state.terminalClaude,
      model: claudeCustomModelInput.value,
      customModel: true,
    });
    saveTerminalClaudeSettings();
    syncTerminalClaudePreview();
    return;
  }

  const claudeFlagDraftInput = event.target.closest('[data-terminal-claude-flag-draft]');
  if (claudeFlagDraftInput) {
    state.terminalClaudeFlagDraft = claudeFlagDraftInput.value;
    return;
  }

  const codexModelInput = event.target.closest('[data-terminal-codex-model]');
  if (codexModelInput) {
    state.terminalCodex = normalizeTerminalCodexSettings({
      ...state.terminalCodex,
      model: codexModelInput.value,
    });
    saveTerminalCodexSettings();
    syncTerminalAgentPreview('codex', buildTerminalCodexCommand());
    return;
  }

  const codexFlagDraftInput = event.target.closest('[data-terminal-codex-flag-draft]');
  if (codexFlagDraftInput) {
    state.terminalCodexFlagDraft = codexFlagDraftInput.value;
    return;
  }

  const antigravityFlagDraftInput = event.target.closest('[data-terminal-antigravity-flag-draft]');
  if (antigravityFlagDraftInput) {
    state.terminalAntigravityFlagDraft = antigravityFlagDraftInput.value;
    return;
  }

  const opencodeModelInput = event.target.closest('[data-terminal-opencode-model]');
  if (opencodeModelInput) {
    state.terminalOpencode = normalizeTerminalOpencodeSettings({
      ...state.terminalOpencode,
      model: opencodeModelInput.value,
    });
    saveTerminalOpencodeSettings();
    syncTerminalAgentPreview('opencode', buildTerminalOpencodeCommand());
    return;
  }

  const opencodeFlagDraftInput = event.target.closest('[data-terminal-opencode-flag-draft]');
  if (opencodeFlagDraftInput) {
    state.terminalOpencodeFlagDraft = opencodeFlagDraftInput.value;
    return;
  }

  const favoriteCommandInput = event.target.closest('[data-terminal-favorite-command]');
  if (favoriteCommandInput) {
    state.terminalFavoriteDraftCommand = favoriteCommandInput.value;
    return;
  }

  const favoriteNoteInput = event.target.closest('[data-terminal-favorite-note]');
  if (favoriteNoteInput) {
    state.terminalFavoriteDraftNote = favoriteNoteInput.value;
    return;
  }

  const titleInput = event.target.closest('input[data-terminal-title-input]');
  if (titleInput) {
    state.terminalTitleDraft = titleInput.value;
    return;
  }

  const input = event.target.closest('textarea[data-terminal-input]');
  if (!input) {
    return;
  }

  const session = findTerminalSession(input.dataset.terminalInput);
  if (session) {
    if (session.readOnly) {
      input.value = session.input || '';
      return;
    }
    session.input = input.value;
    if (session.id) {
      state.terminalWorkspaceMetaBySessionId.set(session.id, terminalSessionMetadata(session));
    }
    saveTerminalWorkspaceState();
  }
});
elements.terminalWorkspace.addEventListener('focusout', (event) => {
  const titleInput = event.target.closest('input[data-terminal-title-input]');
  if (titleInput) {
    commitTerminalTitleEdit(titleInput.dataset.terminalTitleInput);
  }
});
elements.terminalWorkspace.addEventListener('click', (event) => {
  // 切換專案 window buttons now live inside the page (workspace).
  const projectWindowButton = event.target.closest('button[data-terminal-project-window]');
  if (projectWindowButton) {
    switchTerminalProject(projectWindowButton.dataset.terminalProjectWindow, { ensureDraft: true });
    renderTerminalModal();
    startTerminalPolling();
    return;
  }

  // 中斷 a session that's waiting on a server round-trip (launch / send / close).
  const busyAbortButton = event.target.closest('button[data-terminal-busy-abort]');
  if (busyAbortButton) {
    abortTerminalSessionBusy(busyAbortButton.dataset.terminalBusyAbort);
    return;
  }

  const contentTabButton = event.target.closest('button[data-terminal-content-tab-button]');
  if (contentTabButton) {
    setTerminalContentTab(contentTabButton.dataset.terminalContentTabButton);
    return;
  }

  const pipelineRunButton = event.target.closest('button[data-pipeline-run]');
  if (pipelineRunButton) {
    runTerminalPipeline();
    return;
  }

  const pipelineResumeButton = event.target.closest('button[data-pipeline-resume]');
  if (pipelineResumeButton) {
    resumeTerminalPipeline();
    return;
  }

  const pipelineStopButton = event.target.closest('button[data-pipeline-stop]');
  if (pipelineStopButton) {
    stopTerminalPipeline();
    return;
  }

  const pipelineAddButton = event.target.closest('button[data-pipeline-add]');
  if (pipelineAddButton) {
    addTerminalPipelineStep();
    return;
  }

  const pipelineDeleteButton = event.target.closest('button[data-pipeline-delete]');
  if (pipelineDeleteButton) {
    deleteTerminalPipelineStep(pipelineDeleteButton.dataset.pipelineDelete);
    return;
  }

  const pipelineConversationButton = event.target.closest('button[data-pipeline-conversation]');
  if (pipelineConversationButton) {
    setTerminalPipelineConversation(
      pipelineConversationButton.dataset.pipelineConversation,
      pipelineConversationButton.dataset.pipelineConversationMode,
    );
    return;
  }

  const pipelineLogToggle = event.target.closest('button[data-pipeline-log-toggle]');
  if (pipelineLogToggle) {
    state.terminalPipelineLogExpanded = !state.terminalPipelineLogExpanded;
    renderTerminalModal();
    return;
  }

  const notepadAddButton = event.target.closest('button[data-notepad-add]');
  if (notepadAddButton) {
    addTerminalNotepadStep();
    return;
  }

  const notepadDeleteButton = event.target.closest('button[data-notepad-delete]');
  if (notepadDeleteButton) {
    deleteTerminalNotepadStep(notepadDeleteButton.dataset.notepadDelete);
    return;
  }

  const notepadConversationButton = event.target.closest('button[data-notepad-conversation]');
  if (notepadConversationButton) {
    setTerminalNotepadConversation(
      notepadConversationButton.dataset.notepadConversation,
      notepadConversationButton.dataset.notepadConversationMode,
    );
    return;
  }

  const notepadToPipelineButton = event.target.closest('button[data-notepad-to-pipeline]');
  if (notepadToPipelineButton) {
    addTerminalNotepadToPipeline({ keepCopy: false });
    return;
  }

  const notepadToPipelineCopyButton = event.target.closest('button[data-notepad-to-pipeline-copy]');
  if (notepadToPipelineCopyButton) {
    addTerminalNotepadToPipeline({ keepCopy: true });
    return;
  }

  const notepadStepToPipelineCopyButton = event.target.closest('button[data-notepad-step-to-pipeline-copy]');
  if (notepadStepToPipelineCopyButton) {
    addTerminalNotepadStepToPipeline(notepadStepToPipelineCopyButton.dataset.notepadStepToPipelineCopy, { keepCopy: true });
    return;
  }

  const notepadStepToPipelineButton = event.target.closest('button[data-notepad-step-to-pipeline]');
  if (notepadStepToPipelineButton) {
    addTerminalNotepadStepToPipeline(notepadStepToPipelineButton.dataset.notepadStepToPipeline, { keepCopy: false });
    return;
  }

  const agentTabButton = event.target.closest('button[data-terminal-agent-tab]');
  if (agentTabButton) {
    switchTerminalFavoriteAgent(agentTabButton.dataset.terminalAgentTab);
    return;
  }

  const claudeCommandButton = event.target.closest('button[data-terminal-claude-command]');
  if (claudeCommandButton) {
    state.terminalClaude = normalizeTerminalClaudeSettings({
      ...state.terminalClaude,
      command: claudeCommandButton.dataset.terminalClaudeCommand,
    });
    saveTerminalClaudeSettings();
    applyTerminalClaudeCommand({ run: true });
    return;
  }

  const claudeFavoriteFlagButton = event.target.closest('button[data-terminal-claude-favorite-flag]');
  if (claudeFavoriteFlagButton) {
    toggleTerminalClaudeFavoriteFlag(claudeFavoriteFlagButton.dataset.terminalClaudeFavoriteFlag);
    return;
  }

  const claudeDeleteFlagButton = event.target.closest('button[data-terminal-claude-delete-flag]');
  if (claudeDeleteFlagButton) {
    deleteTerminalClaudeFavoriteFlag(claudeDeleteFlagButton.dataset.terminalClaudeDeleteFlag);
    return;
  }

  const claudeAddFlagButton = event.target.closest('button[data-terminal-claude-add-flag]');
  if (claudeAddFlagButton) {
    addTerminalClaudeFavoriteFlag();
    return;
  }

  const codexCommandButton = event.target.closest('button[data-terminal-codex-command]');
  if (codexCommandButton) {
    state.terminalCodex = normalizeTerminalCodexSettings({
      ...state.terminalCodex,
      command: codexCommandButton.dataset.terminalCodexCommand,
    });
    saveTerminalCodexSettings();
    applyTerminalCodexCommand({ run: true });
    return;
  }

  const codexFavoriteFlagButton = event.target.closest('button[data-terminal-codex-favorite-flag]');
  if (codexFavoriteFlagButton) {
    toggleTerminalCodexFavoriteFlag(codexFavoriteFlagButton.dataset.terminalCodexFavoriteFlag);
    return;
  }

  const codexDeleteFlagButton = event.target.closest('button[data-terminal-codex-delete-flag]');
  if (codexDeleteFlagButton) {
    deleteTerminalCodexFavoriteFlag(codexDeleteFlagButton.dataset.terminalCodexDeleteFlag);
    return;
  }

  const codexAddFlagButton = event.target.closest('button[data-terminal-codex-add-flag]');
  if (codexAddFlagButton) {
    addTerminalCodexFavoriteFlag();
    return;
  }

  const antigravityCommandButton = event.target.closest('button[data-terminal-antigravity-command]');
  if (antigravityCommandButton) {
    state.terminalAntigravity = normalizeTerminalAntigravitySettings({
      ...state.terminalAntigravity,
      command: antigravityCommandButton.dataset.terminalAntigravityCommand,
    });
    saveTerminalAntigravitySettings();
    applyTerminalAntigravityCommand({ run: true });
    return;
  }

  const antigravityFavoriteFlagButton = event.target.closest('button[data-terminal-antigravity-favorite-flag]');
  if (antigravityFavoriteFlagButton) {
    toggleTerminalAntigravityFavoriteFlag(antigravityFavoriteFlagButton.dataset.terminalAntigravityFavoriteFlag);
    return;
  }

  const antigravityDeleteFlagButton = event.target.closest('button[data-terminal-antigravity-delete-flag]');
  if (antigravityDeleteFlagButton) {
    deleteTerminalAntigravityFavoriteFlag(antigravityDeleteFlagButton.dataset.terminalAntigravityDeleteFlag);
    return;
  }

  const antigravityAddFlagButton = event.target.closest('button[data-terminal-antigravity-add-flag]');
  if (antigravityAddFlagButton) {
    addTerminalAntigravityFavoriteFlag();
    return;
  }

  const opencodeCommandButton = event.target.closest('button[data-terminal-opencode-command]');
  if (opencodeCommandButton) {
    state.terminalOpencode = normalizeTerminalOpencodeSettings({
      ...state.terminalOpencode,
      command: opencodeCommandButton.dataset.terminalOpencodeCommand,
    });
    saveTerminalOpencodeSettings();
    applyTerminalOpencodeCommand({ run: true });
    return;
  }

  const opencodeFavoriteFlagButton = event.target.closest('button[data-terminal-opencode-favorite-flag]');
  if (opencodeFavoriteFlagButton) {
    toggleTerminalOpencodeFavoriteFlag(opencodeFavoriteFlagButton.dataset.terminalOpencodeFavoriteFlag);
    return;
  }

  const opencodeDeleteFlagButton = event.target.closest('button[data-terminal-opencode-delete-flag]');
  if (opencodeDeleteFlagButton) {
    deleteTerminalOpencodeFavoriteFlag(opencodeDeleteFlagButton.dataset.terminalOpencodeDeleteFlag);
    return;
  }

  const opencodeAddFlagButton = event.target.closest('button[data-terminal-opencode-add-flag]');
  if (opencodeAddFlagButton) {
    addTerminalOpencodeFavoriteFlag();
    return;
  }

  const favoriteAddButton = event.target.closest('button[data-terminal-favorite-add]');
  if (favoriteAddButton) {
    beginTerminalFavoriteCreate();
    return;
  }

  const favoriteCurrentButton = event.target.closest('button[data-terminal-favorite-current]');
  if (favoriteCurrentButton) {
    const session = findTerminalSession(state.terminalActiveSessionId);
    const currentInput = elements.terminalWorkspace.querySelector(`[data-terminal-input="${CSS.escape(state.terminalActiveSessionId || '')}"]`);
    const command = (currentInput?.value || session?.input || '').trim();
    if (!command) {
      showToast('請先輸入要加入的指令');
      return;
    }
    beginTerminalFavoriteCreate(command);
    return;
  }

  const favoriteSaveButton = event.target.closest('button[data-terminal-favorite-save]');
  if (favoriteSaveButton) {
    commitTerminalFavoriteEdit();
    return;
  }

  const favoriteCancelButton = event.target.closest('button[data-terminal-favorite-cancel]');
  if (favoriteCancelButton) {
    clearTerminalFavoriteEditor();
    renderTerminalModal();
    return;
  }

  const favoriteToggleButton = event.target.closest('button[data-terminal-favorite-toggle]');
  if (favoriteToggleButton) {
    state.terminalFavoritesExpanded = !state.terminalFavoritesExpanded;
    renderTerminalModal();
    return;
  }

  const favoriteApplyButton = event.target.closest('button[data-terminal-favorite-apply]');
  if (favoriteApplyButton) {
    applyTerminalFavorite(favoriteApplyButton.dataset.terminalFavoriteApply);
    return;
  }

  const favoriteEditButton = event.target.closest('button[data-terminal-favorite-edit]');
  if (favoriteEditButton) {
    beginTerminalFavoriteEdit(favoriteEditButton.dataset.terminalFavoriteEdit);
    return;
  }

  const favoriteDeleteButton = event.target.closest('button[data-terminal-favorite-delete]');
  if (favoriteDeleteButton) {
    deleteTerminalFavorite(favoriteDeleteButton.dataset.terminalFavoriteDelete);
    return;
  }

  const titleButton = event.target.closest('button[data-terminal-title-edit]');
  if (titleButton) {
    beginTerminalTitleEdit(titleButton.dataset.terminalTitleEdit);
    return;
  }

  const directoryToggle = event.target.closest('button[data-terminal-dir-toggle]');
  if (directoryToggle) {
    const options = terminalOptionsForProject();
    const relativePath = directoryToggle.dataset.terminalDirToggle || '';
    const node = terminalDirectoryNode(relativePath, options);
    if (node?.hasChildren) {
      if (node.expanded && node.loaded) {
        node.expanded = false;
        renderTerminalModal();
      } else {
        node.expanded = true;
        if (node.loaded) {
          renderTerminalModal();
        } else {
          loadTerminalDirectory(state.terminalProjectName, relativePath);
        }
      }
    }
    return;
  }

  const directorySelect = event.target.closest('button[data-terminal-dir-select]');
  if (directorySelect) {
    const session = findTerminalSession(state.terminalActiveSessionId);
    if (session && !session.id) {
      session.cwdRelativePath = directorySelect.dataset.terminalDirSelect || '';
      saveTerminalWorkspaceState();
      renderTerminalModal();
    }
    return;
  }

  const scrollButton = event.target.closest('button[data-terminal-scroll]');
  if (scrollButton) {
    scrollTerminalSession(scrollButton.dataset.terminalScrollSession, scrollButton.dataset.terminalScroll);
    return;
  }

  const runButton = event.target.closest('button[data-terminal-run]');
  if (runButton) {
    runTerminalCommand(runButton.dataset.terminalRun);
    return;
  }

  const closeButton = event.target.closest('button[data-terminal-close]');
  if (closeButton) {
    closeTerminalDialog(closeButton.dataset.terminalClose);
  }
});
elements.terminalWorkspace.addEventListener('keydown', (event) => {
  const pipelinePrompt = event.target.closest('[data-pipeline-prompt]');
  if (pipelinePrompt) {
    if (event.key === 'Enter' && event.ctrlKey && !state.terminalPipelineRun.active) {
      event.preventDefault();
      runTerminalPipeline();
    }
    return;
  }

  const claudeFlagDraftInput = event.target.closest('[data-terminal-claude-flag-draft]');
  if (claudeFlagDraftInput) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTerminalClaudeFavoriteFlag();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      state.terminalClaudeFlagDraft = '';
      renderTerminalModal();
    }
    return;
  }

  const codexFlagDraftInput = event.target.closest('[data-terminal-codex-flag-draft]');
  if (codexFlagDraftInput) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTerminalCodexFavoriteFlag();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      state.terminalCodexFlagDraft = '';
      renderTerminalModal();
    }
    return;
  }

  const antigravityFlagDraftInput = event.target.closest('[data-terminal-antigravity-flag-draft]');
  if (antigravityFlagDraftInput) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTerminalAntigravityFavoriteFlag();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      state.terminalAntigravityFlagDraft = '';
      renderTerminalModal();
    }
    return;
  }

  const opencodeFlagDraftInput = event.target.closest('[data-terminal-opencode-flag-draft]');
  if (opencodeFlagDraftInput) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTerminalOpencodeFavoriteFlag();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      state.terminalOpencodeFlagDraft = '';
      renderTerminalModal();
    }
    return;
  }

  const favoriteCommandInput = event.target.closest('[data-terminal-favorite-command]');
  const favoriteNoteInput = event.target.closest('[data-terminal-favorite-note]');
  if (favoriteCommandInput || favoriteNoteInput) {
    if (event.key === 'Enter' && (event.ctrlKey || favoriteNoteInput)) {
      event.preventDefault();
      commitTerminalFavoriteEdit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      clearTerminalFavoriteEditor();
      renderTerminalModal();
    }
    return;
  }

  const titleInput = event.target.closest('input[data-terminal-title-input]');
  if (titleInput) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTerminalTitleEdit(titleInput.dataset.terminalTitleInput);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelTerminalTitleEdit(titleInput.dataset.terminalTitleInput);
    }
    return;
  }

  const input = event.target.closest('textarea[data-terminal-input]');
  if (!input || event.key !== 'Enter' || !event.ctrlKey) {
    return;
  }

  event.preventDefault();
  runTerminalCommand(input.dataset.terminalInput);
});
elements.terminalModal.addEventListener('click', (event) => {
  if (event.target === elements.terminalModal) {
    hideTerminalManager();
  }
});
elements.copyManagerLocal.addEventListener('click', () => copyText(state.payload?.manager.localUrl));
elements.copyManagerLan.addEventListener('click', () => copyText(state.payload?.manager.lanUrl));
elements.copyManagerTail.addEventListener('click', () => copyText(state.payload?.manager.tailscaleUrl));
elements.autoRestoreInput.addEventListener('change', updateSettings);
elements.autoRestartInput.addEventListener('change', updateSettings);
elements.healthThresholdInput.addEventListener('change', updateSettings);
elements.reloadLogsButton.addEventListener('click', loadLogs);
elements.copyLogsButton.addEventListener('click', copyLogs);

// ---------------------------------------------------------------------------
// Hover tooltips for the project-list action buttons. We reuse each button's
// existing `title` (suppressing the slow native tooltip while hovered) and show
// a styled bubble immediately instead.
// ---------------------------------------------------------------------------
const appTooltip = document.createElement('div');
appTooltip.className = 'app-tooltip';
appTooltip.hidden = true;
document.body.appendChild(appTooltip);
let appTooltipTarget = null;

function positionAppTooltip(el) {
  const rect = el.getBoundingClientRect();
  const tipRect = appTooltip.getBoundingClientRect();
  let top = rect.top - tipRect.height - 8;
  if (top < 4) {
    top = rect.bottom + 8;
  }
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - tipRect.width - 6));
  appTooltip.style.top = `${Math.round(top)}px`;
  appTooltip.style.left = `${Math.round(left)}px`;
}

function showAppTooltip(el) {
  const text = el.getAttribute('title') || el.dataset.appTooltip || el.getAttribute('aria-label') || '';
  if (!text) {
    return;
  }
  // Stash + remove the native title so the browser's own tooltip stays hidden.
  if (el.hasAttribute('title')) {
    el.dataset.appTooltip = el.getAttribute('title');
    el.removeAttribute('title');
  }
  appTooltipTarget = el;
  appTooltip.textContent = el.dataset.appTooltip || text;
  appTooltip.hidden = false;
  positionAppTooltip(el);
}

function hideAppTooltip() {
  if (appTooltipTarget && appTooltipTarget.dataset.appTooltip && !appTooltipTarget.hasAttribute('title')) {
    appTooltipTarget.setAttribute('title', appTooltipTarget.dataset.appTooltip);
    delete appTooltipTarget.dataset.appTooltip;
  }
  appTooltipTarget = null;
  appTooltip.hidden = true;
}

elements.mainPanel?.addEventListener('pointerover', (event) => {
  if (event.pointerType === 'touch') {
    return;
  }
  const button = event.target.closest('.row-action');
  if (!button || button === appTooltipTarget) {
    return;
  }
  hideAppTooltip();
  showAppTooltip(button);
});
elements.mainPanel?.addEventListener('pointerout', (event) => {
  if (!appTooltipTarget) {
    return;
  }
  const related = event.relatedTarget;
  if (related && appTooltipTarget.contains(related)) {
    return;
  }
  if (event.target === appTooltipTarget || appTooltipTarget.contains(event.target)) {
    hideAppTooltip();
  }
});
elements.mainPanel?.addEventListener('pointerdown', hideAppTooltip);
window.addEventListener('scroll', hideAppTooltip, true);

applyDemoModeUi();
const terminalFavoriteState = readTerminalFavorites();
state.terminalFavoriteAgent = terminalFavoriteState.activeAgent;
state.terminalFavoritesByAgent = terminalFavoriteState.favoritesByAgent;
syncTerminalFavoritesFromActiveAgent();
state.terminalClaude = readTerminalClaudeSettings();
state.terminalCodex = readTerminalCodexSettings();
state.terminalAntigravity = readTerminalAntigravitySettings();
state.terminalOpencode = readTerminalOpencodeSettings();
state.terminalPipeline = readTerminalPipeline();
state.terminalNotepad = readTerminalNotepad();
restoreTerminalWorkspaceState();
const terminalPreferencesReady = loadTerminalPreferences({ silent: true });
applyTheme(readThemePreference());
loadTablePreferences();
syncQuotaRouteFromHash();
loadStatus().then(() => {
  loadLogs();
  terminalPreferencesReady
    .finally(() => loadTerminalSessions({ silent: true }))
    // After the new ATM is up and terminals have reconciled, bring back whatever was
    // running before a 重啟 ATM server (servers + terminals).
    .finally(() => applyAtmResumeSnapshot());
});
setInterval(() => loadStatus({ silent: true }), 6000);
setInterval(() => {
  if (state.quotaModalOpen && !state.quotaLoading && quotaPayloadIsStale()) {
    loadAiQuotas();
  }
}, 60 * 1000);
setInterval(() => {
  if (elements.autoLogInput.checked && !document.hidden) {
    loadLogs({ silent: true });
  }
}, 3000);
