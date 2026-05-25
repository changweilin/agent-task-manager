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
      lanUrl: '',
      tailscaleUrl: '',
      lanMode: false,
      lanReady: false,
      lanIpAtStart: null,
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
        lanUrl: '',
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
  if (url.pathname === '/api/firewall/lan-command') {
    return {
      name: slugifyDemoName(url.searchParams.get('name')),
      port: 'demo',
      lanUrl: '',
      command: '# Demo mode: no firewall command is generated.',
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
const TERMINAL_FAVORITES_KEY = 'agentTaskManager.terminalFavorites.v1';
const TERMINAL_FAVORITES_VERSION_KEY = 'agentTaskManager.terminalFavoritesVersion.v1';
const TERMINAL_FAVORITES_VERSION = 7;
const TERMINAL_CLAUDE_SETTINGS_KEY = 'agentTaskManager.terminalClaudeSettings.v1';
const TERMINAL_CODEX_SETTINGS_KEY = 'agentTaskManager.terminalCodexSettings.v1';
const TERMINAL_ANTIGRAVITY_SETTINGS_KEY = 'agentTaskManager.terminalAntigravitySettings.v1';
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
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'antigravity', label: 'Antigravity CLI' },
];
const DEFAULT_TERMINAL_AGENT_ID = 'claude';
const terminalAgentIds = new Set(TERMINAL_AGENT_TABS.map((agent) => agent.id));
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
  { id: 'favorite-antigravity-logout', command: '/logout', note: '' },
];
const DEFAULT_TERMINAL_FAVORITES_BY_AGENT = {
  claude: TERMINAL_CLAUDE_SLASH_FAVORITES,
  codex: TERMINAL_CODEX_SLASH_FAVORITES,
  antigravity: TERMINAL_ANTIGRAVITY_SLASH_FAVORITES,
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
const DEFAULT_COLUMN_ORDER = ['name', 'status', 'framework', 'port', 'health', 'command', 'started', 'restarted', 'pid'];
const ACTION_URL_COLUMN_IDS = ['local', 'lan', 'tailscale'];
const DEFAULT_COLUMN_WIDTHS = {
  name: 238,
  status: 104,
  framework: 92,
  port: 78,
  health: 108,
  command: 210,
  started: 142,
  restarted: 142,
  pid: 78,
};
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 520;
const MIN_TABLE_WIDTH = 1190;
const COLUMN_REORDER_MOVE_THRESHOLD = 6;
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
  { id: 'lan', label: 'LAN', urlKey: 'lanUrl' },
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
  selectedName: null,
  selectedProfileId: '',
  profileEditorDirty: false,
  firewallProjectName: null,
  theme: 'dark',
  busy: new Set(),
  mobileInstallBusyProject: null,
  mobileInstallLogHoldUntil: 0,
  profileBusy: false,
  expandedPageNames: new Set(),
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
  terminalTabDrag: null,
  suppressTerminalTabClick: false,
  quotaModalOpen: false,
  quotaPayload: null,
  quotaLoading: false,
  quotaError: '',
  quotaRequestId: 0,
};

let terminalPollTimer = null;
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
  lan: '<svg viewBox="0 0 24 24" focusable="false"><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 20h.01"/></svg>',
  tailscale: '<svg viewBox="0 0 24 24" focusable="false"><path d="M7 16.5a4.5 4.5 0 0 1 0-9"/><path d="M17 7.5a4.5 4.5 0 0 1 0 9"/><path d="M8.5 12h7"/><path d="M12 8.5v7"/></svg>',
  firewall: '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 3 19 6v5c0 4.5-2.7 8.1-7 10-4.3-1.9-7-5.5-7-10V6l7-3Z"/><path d="M9 12h6"/></svg>',
  stop: '<svg viewBox="0 0 24 24" focusable="false"><path d="M7 7h10v10H7z"/></svg>',
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
  tailscaleIp: document.querySelector('#tailscaleIp'),
  runningCount: document.querySelector('#runningCount'),
  themeToggleButton: document.querySelector('#themeToggleButton'),
  refreshButton: document.querySelector('#refreshButton'),
  quotaMonitorButton: document.querySelector('#quotaMonitorButton'),
  discoverButton: document.querySelector('#discoverButton'),
  rootsInput: document.querySelector('#rootsInput'),
  addRootButton: document.querySelector('#addRootButton'),
  rootList: document.querySelector('#rootList'),
  basePortInput: document.querySelector('#basePortInput'),
  filterButtons: document.querySelector('#filterButtons'),
  projectCount: document.querySelector('#projectCount'),
  searchInput: document.querySelector('#searchInput'),
  sortSelect: document.querySelector('#sortSelect'),
  sortDirectionButton: document.querySelector('#sortDirectionButton'),
  lastUpdated: document.querySelector('#lastUpdated'),
  mainPanel: document.querySelector('.main-panel'),
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
  logOutput: document.querySelector('#logOutput'),
  toast: document.querySelector('#toast'),
  firewallModal: document.querySelector('#firewallModal'),
  closeFirewallModal: document.querySelector('#closeFirewallModal'),
  closeFirewallDone: document.querySelector('#closeFirewallDone'),
  firewallProject: document.querySelector('#firewallProject'),
  firewallUrl: document.querySelector('#firewallUrl'),
  firewallConsent: document.querySelector('#firewallConsent'),
  firewallCommand: document.querySelector('#firewallCommand'),
  copyFirewallCommand: document.querySelector('#copyFirewallCommand'),
  runFirewallCommand: document.querySelector('#runFirewallCommand'),
  terminalModal: document.querySelector('#terminalModal'),
  terminalTitle: document.querySelector('#terminalTitle'),
  backToHomeFromTerminal: document.querySelector('#backToHomeFromTerminal'),
  closeTerminalModal: document.querySelector('#closeTerminalModal'),
  addTerminalSession: document.querySelector('#addTerminalSession'),
  terminalProjectBar: document.querySelector('#terminalProjectBar'),
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
    render: (project) => `<span class="mono-muted">${project.port}</span>`,
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
    id: 'lan',
    label: 'LAN',
    sortable: true,
    getSortValue: (project) => project.lanUrl || '',
    render: (project) => renderUrlLink(project.lanUrl, 'LAN URL'),
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
          <button class="row-action restart" data-action="restart" data-name="${escapeHtml(project.name)}" ${context.busy || DEMO_MODE ? 'disabled' : ''} type="button" title="重啟" aria-label="重啟 ${escapeHtml(project.name)}">${icons.restart}</button>
          <button class="row-action firewall" data-action="firewall" data-name="${escapeHtml(project.name)}" ${!project.lanUrl || DEMO_MODE ? 'disabled' : ''} type="button" title="LAN 防火牆" aria-label="設定 ${escapeHtml(project.name)} 的 LAN 防火牆">${icons.firewall}</button>
          ${renderMobileInstallAction(project, context)}
          <button class="row-action terminal ${terminalCount ? 'has-terminal-sessions' : ''}" data-action="terminal" data-name="${escapeHtml(project.name)}" ${DEMO_MODE ? 'disabled' : ''} type="button" title="執行終端" aria-label="開啟 ${escapeHtml(project.name)} 的終端管理">${icons.terminal}${terminalBadge}</button>
        </div>
      `;
    },
  },
];

const columnsById = new Map(tableColumns.map((column) => [column.id, column]));

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
  return framework === 'generic' ? 'npm' : framework;
}

function projectCommandLabel(project) {
  return project.command || `npm run dev (${project.devScript || 'script'})`;
}

function projectIsManagedRunning(project) {
  return Boolean(project.running || ['running', 'restarting', 'unhealthy'].includes(project.status));
}

function renderProjectPowerAction(project, context = {}) {
  const action = projectIsManagedRunning(project) ? 'stop' : 'start';
  const label = action === 'stop' ? '停止' : '啟動';
  const disabled = DEMO_MODE || context.busy || (action === 'start' && project.status === 'external');
  const disabledAttr = disabled ? 'disabled' : '';
  const title = project.status === 'external' && action === 'start'
    ? '此 port 已有外部服務回應'
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
  return targetId === 'lan' || targetId === 'tailscale' ? targetId : '';
}

function targetNeedsConnection(project, targetId) {
  if (targetId === 'lan') {
    return Boolean(project.lanUrl && !project.lanReady);
  }
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

function renderProjectName(project, context = {}) {
  const pages = getProjectPages(project);
  const pageCount = pages.length;
  const expanded = Boolean(context.pagesExpanded && pageCount > 0);
  const projectExpanded = context.projectPanelExpanded !== false;
  const pageLabel = pageCount === 1 ? '1 page' : `${pageCount} pages`;
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
  const homeControl = homeLink.url
    ? `<a class="project-home-link" href="${escapeHtml(homeLink.url)}" target="_blank" rel="noreferrer" title="${escapeHtml(homeLink.url)}">Home</a>`
    : '<span class="project-home-link is-disabled">Home</span>';

  return `
    <div class="project-name-cell">
      <div class="project-name">
        <div class="project-name-heading">
          <strong>${escapeHtml(project.name)}</strong>
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
        <button class="project-path-button" data-open-folder data-name="${escapeHtml(project.name)}" type="button" title="開啟資料夾：${escapeHtml(project.path)}" ${DEMO_MODE ? 'disabled' : ''}>${escapeHtml(compactPath(project.path))}</button>
        <div class="project-name-links">
          ${pageCountControl}
          ${homeControl}
        </div>
      </div>
    </div>
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
    elements.refreshButton.disabled = true;
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
    elements.refreshButton.disabled = false;
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
  return !terminalIsReadOnly() || terminalRemoteAgentLaunchEnabled();
}

function terminalCanUseAgentLauncher(session) {
  return Boolean(session)
    && !session.busy
    && !session.exitedAt
    && (!session.readOnly || (terminalRemoteAgentLaunchEnabled() && !session.id));
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
    const haystack = `${project.name} ${project.framework} ${project.path} ${project.port} ${pageHaystack}`.toLowerCase();
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

function renderRootList() {
  if (!elements.rootList) {
    return;
  }

  if (!state.rootPaths.length) {
    elements.rootList.innerHTML = '<div class="root-list-empty">尚未加入來源</div>';
    return;
  }

  elements.rootList.innerHTML = state.rootPaths
    .map((root, index) => `
      <div class="root-list-item">
        <div class="root-path-marquee" title="${escapeHtml(root)}" aria-label="${escapeHtml(root)}">
          <span class="root-path-text">${escapeHtml(root)}</span>
        </div>
        <button class="root-remove-button" data-root-index="${index}" type="button" title="移除來源" aria-label="移除 ${escapeHtml(root)}">${icons.remove}</button>
      </div>
    `)
    .join('');
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
  const column = columnsById.get(state.sortKey) || columnsById.get('name');
  const direction = state.sortDirection === 'desc' ? -1 : 1;

  return [...projects].sort((leftProject, rightProject) => {
    const primary = compareValues(column.getSortValue(leftProject), column.getSortValue(rightProject));
    if (primary !== 0) {
      return primary * direction;
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
    const sortableKeys = new Set(tableColumns
      .filter((column) => column.sortable && DEFAULT_COLUMN_ORDER.includes(column.id))
      .map((column) => column.id));
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
  const column = columnsById.get(columnId);
  if (!column?.sortable) {
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
  elements.copyManagerLocal.textContent = payload.manager.localUrl || '--';
  elements.copyManagerLan.textContent = payload.manager.lanUrl || '--';
  elements.copyManagerTail.textContent = payload.manager.tailscaleUrl || '--';
  if (document.activeElement !== elements.autoRestoreInput) {
    elements.autoRestoreInput.checked = payload.config.autoRestoreOnStartup !== false;
  }
  if (document.activeElement !== elements.autoRestartInput) {
    elements.autoRestartInput.checked = payload.config.health?.autoRestart === true;
  }
  if (document.activeElement !== elements.healthThresholdInput) {
    elements.healthThresholdInput.value = payload.config.health?.failureThreshold || 3;
  }
  elements.discoverButton.disabled = DEMO_MODE;
  elements.rootsInput.disabled = DEMO_MODE;
  elements.addRootButton.disabled = DEMO_MODE;
  elements.basePortInput.disabled = DEMO_MODE;
  elements.copyManagerLocal.disabled = DEMO_MODE;
  elements.copyManagerLan.disabled = DEMO_MODE;
  elements.copyManagerTail.disabled = DEMO_MODE;
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
  elements.sortSelect.innerHTML = tableColumns
    .filter((column) => column.sortable && state.columnOrder.includes(column.id))
    .map((column) => `<option value="${escapeHtml(column.id)}">${escapeHtml(column.label)}</option>`)
    .join('');
  if (!state.columnOrder.includes(state.sortKey)) {
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

  elements.projectRows.innerHTML = projects
    .map((project) => {
      const busy = state.busy.has(project.name) || state.mobileInstallBusyProject === project.name;
      const isSelected = project.name === state.selectedName;
      const projectPanelExpanded = !mobileLayout || state.expandedProjectNames.has(project.name);
      const panelClass = projectPanelExpanded ? 'is-panel-expanded' : 'is-panel-collapsed';
      const pagesExpanded = projectPanelExpanded && state.expandedPageNames.has(project.name) && getProjectPages(project).length > 0;
      const cells = columns
        .map((column) => {
          const frozen = state.frozenColumnId === column.id;
          const className = [column.className || '', frozen ? 'is-frozen-column' : '']
            .filter(Boolean)
            .join(' ');
          return `<td class="${escapeHtml(className)}" data-column="${escapeHtml(column.id)}">${column.render(project, { busy, pagesExpanded, projectPanelExpanded })}</td>`;
        })
        .join('');
      const selectedClass = isSelected ? 'is-selected' : '';
      return `
        <tr class="project-data-row ${selectedClass} ${panelClass}" data-name="${escapeHtml(project.name)}">${cells}</tr>
        ${renderProjectPages(project, columns.length, pagesExpanded, selectedClass)}
        <tr class="project-actions-row ${selectedClass} ${panelClass}" data-actions-for="${escapeHtml(project.name)}">
          <td colspan="${columns.length}">
            <div class="project-row-actions-panel">
              ${actionsColumn.render(project, { busy })}
              ${renderProjectActionUrls(project)}
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  elements.emptyState.hidden = projects.length > 0;
}

async function runAction(name, action) {
  if (DEMO_MODE) {
    showDemoNotice();
    return false;
  }

  if (action === 'terminal') {
    openTerminalManager(name);
    return true;
  }

  if (action === 'firewall') {
    state.selectedName = name;
    render();
    await showLanFirewallConsent();
    return true;
  }

  if (action === 'mobile-install') {
    await runMobileInstall(name);
    return true;
  }

  state.busy.add(name);
  render();

  try {
    state.payload = await api(`/api/projects/${encodeURIComponent(name)}/${action}`, {
      method: 'POST',
      body: '{}',
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

function actionMessage(action) {
  const messages = {
    start: '已送出啟動',
    stop: '已停止',
    restart: '已重啟',
    lan: '已啟用 LAN 分享',
    tailscale: '已啟用 Tailscale',
  };

  return messages[action] || '已完成';
}

async function openProjectFolder(name) {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  try {
    await api(`/api/projects/${encodeURIComponent(name)}/open-folder`, {
      method: 'POST',
      body: '{}',
    });
    showToast('已開啟資料夾');
  } catch (error) {
    showToast(error.message);
  }
}

async function discover() {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  elements.discoverButton.disabled = true;
  try {
    commitRootInput();
    const roots = readRootPathsForDiscover();
    const basePort = Number(elements.basePortInput.value || state.payload?.config?.basePort || 5173);
    state.payload = await api('/api/discover', {
      method: 'POST',
      body: JSON.stringify({ roots, basePort }),
    });
    state.rootPaths = normalizeRootPaths(state.payload.config.defaultRoots || roots);
    state.rootEditorDirty = false;
    renderRootList();
    if (!state.selectedName && state.payload.projects.length) {
      state.selectedName = state.payload.projects[0].name;
    }
    showToast('掃描完成');
    render();
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.discoverButton.disabled = false;
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

async function loadLogs({ silent = false } = {}) {
  const project = selectedProject();
  if (!project) {
    return;
  }

  if (silent && (state.mobileInstallBusyProject || Date.now() < state.mobileInstallLogHoldUntil)) {
    return;
  }

  if (!silent) {
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
    elements.logOutput.textContent = error.message;
  }
}

function renderLogText(text) {
  elements.logOutput.innerHTML = text
    .split(/\r?\n/)
    .map((line) => {
      const className = ['log-line', logLineTone(line)].filter(Boolean).join(' ');
      return `<span class="${className}">${escapeHtml(line) || ' '}</span>`;
    })
    .join('\n');
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
    workspace: buildTerminalWorkspaceState(),
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
  session.busy = true;
  renderTerminalModal();

  try {
    const payload = await api(`/api/projects/${encodeURIComponent(session.projectName)}/terminal-claude`, {
      method: 'POST',
      body: JSON.stringify({
        settings: terminalClaudeLaunchPayload(),
        cols: session.cols,
        rows: session.rows,
      }),
    });

    session.input = '';
    applyTerminalPayload(session, payload);
    startTerminalPolling();
  } catch (error) {
    showToast(error.message);
  } finally {
    session.busy = false;
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
  session.busy = true;
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
    });

    session.input = '';
    applyTerminalPayload(session, payload);
    startTerminalPolling();
  } catch (error) {
    showToast(error.message);
  } finally {
    session.busy = false;
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

function terminalOptionsForProject(projectName = state.terminalProjectName) {
  const project = state.payload?.projects.find((item) => item.name === projectName);
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
  elements.terminalModal.hidden = false;
  switchTerminalProject(projectName, { ensureDraft: true });
  renderTerminalModal();
  startTerminalPolling();
  loadTerminalSessions({ silent: true });
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

function renderTerminalProjectBar() {
  const projects = state.payload?.projects || [];
  const selectedProjectName = state.terminalProjectName || projects[0]?.name || '';
  const openProjectNames = terminalProjectNames();

  elements.terminalProjectBar.innerHTML = `
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
  `;
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
          >${escapeHtml(agent.label)}</button>
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

function renderTerminalModal() {
  if (!state.terminalModalOpen) {
    return;
  }

  const project = state.payload?.projects.find((item) => item.name === state.terminalProjectName);
  const options = terminalOptionsForProject();
  const sessions = terminalSessionsForProject();
  const activeSession = sessions.find((session) => session.localId === state.terminalActiveSessionId) || sessions[0] || null;
  state.terminalActiveSessionId = activeSession?.localId || null;
  rememberTerminalActiveSession();

  elements.terminalTitle.textContent = project ? `終端管理：${project.name}` : '終端管理';
  elements.addTerminalSession.disabled = !terminalCanAddSession();
  elements.terminalEmpty.hidden = sessions.length > 0;
  renderTerminalProjectBar();
  renderTerminalTabs();

  if (!activeSession) {
    elements.terminalWorkspace.innerHTML = '';
    return;
  }

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

  elements.terminalWorkspace.innerHTML = `
    <section class="terminal-session" data-terminal-panel="${escapeHtml(activeSession.localId)}">
      ${renderTerminalSetup(activeSession, options, project, sessionTitleControl, projectPort)}
      ${renderTerminalAgentTabs()}
      ${renderTerminalActiveAgentLauncher(activeSession, options)}
      ${renderTerminalFavorites(activeSession)}
      ${renderTerminalScrollControls(activeSession)}
      ${terminalSurface}
      <div class="terminal-command-row">
        <textarea class="terminal-command-input" data-terminal-input="${escapeHtml(activeSession.localId)}" rows="2" spellcheck="false" aria-label="Terminal command" placeholder="${commandPlaceholder}" ${commandReadOnly}></textarea>
        <button class="copy-url primary-action terminal-run-button" data-terminal-run="${escapeHtml(activeSession.localId)}" type="button" ${commandDisabled}>
          <span class="terminal-run-button-content">${icons.start}<span>${commandButtonLabel}</span></span>
        </button>
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
  if (activeSession.id && activeSession.interactive) {
    mountTerminalView(activeSession);
  } else {
    updateTerminalSessionView(activeSession);
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

  view.resizeObserver = new ResizeObserver(() => fitTerminalView(session));
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

  session.busy = true;
  renderTerminalModal();
  try {
    const payload = session.id
      ? await api(`/api/terminals/${encodeURIComponent(session.id)}`, {
          method: 'POST',
          body: JSON.stringify({ input: command, cursor: session.cursor }),
        })
      : await api('/api/terminals', {
          method: 'POST',
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
    showToast(error.message);
  } finally {
    session.busy = false;
    renderTerminalModal();
  }
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
  session.busy = true;
  renderTerminalModal();
  try {
    disposeTerminalView(localId);
    if (session.id) {
      await api(`/api/terminals/${encodeURIComponent(session.id)}`, {
        method: 'DELETE',
      });
      state.terminalWorkspaceMetaBySessionId.delete(session.id);
    }

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
    session.busy = false;
    showToast(error.message);
    renderTerminalModal();
  }
}

async function pollTerminalSessions() {
  if (!state.terminalModalOpen) {
    return;
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
    renderTerminalProjectBar();
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

async function showLanFirewallConsent() {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  const project = selectedProject();
  if (!project) {
    showToast('請先選擇專案');
    return;
  }

  try {
    const payload = await api(`/api/firewall/lan-command?name=${encodeURIComponent(project.name)}`);
    elements.firewallProject.textContent = `${payload.name} : ${payload.port}`;
    elements.firewallUrl.textContent = payload.lanUrl || project.lanUrl || '--';
    elements.firewallCommand.value = payload.command;
    state.firewallProjectName = payload.name;
    elements.firewallConsent.checked = false;
    elements.copyFirewallCommand.disabled = true;
    elements.runFirewallCommand.disabled = true;
    elements.firewallModal.hidden = false;
  } catch (error) {
    showToast(error.message);
  }
}

function hideLanFirewallConsent() {
  elements.firewallModal.hidden = true;
  state.firewallProjectName = null;
}

async function runLanFirewallCommand() {
  if (DEMO_MODE) {
    showDemoNotice();
    return;
  }

  if (!elements.firewallConsent.checked || !state.firewallProjectName) {
    showToast('請先勾選確認');
    return;
  }

  elements.runFirewallCommand.disabled = true;
  try {
    await api('/api/firewall/lan-run', {
      method: 'POST',
      body: JSON.stringify({
        name: state.firewallProjectName,
        consent: true,
      }),
    });
    showToast('已開啟系統管理員 PowerShell');
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.runFirewallCommand.disabled = !elements.firewallConsent.checked;
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

elements.refreshButton.addEventListener('click', () => loadStatus());
elements.quotaMonitorButton.addEventListener('click', () => openQuotaMonitor());
elements.themeToggleButton.addEventListener('click', () => {
  const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme, { persist: true });
  showToast(nextTheme === 'dark' ? '已切換深色主題' : '已切換淺色主題');
});
elements.discoverButton.addEventListener('click', discover);
elements.addRootButton.addEventListener('click', () => {
  if (!commitRootInput()) {
    showToast('請輸入專案位置');
  }
});
elements.rootsInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }

  event.preventDefault();
  commitRootInput();
});
elements.rootList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-root-index]');
  if (!button) {
    return;
  }

  removeRootPath(Number(button.dataset.rootIndex));
});
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
window.addEventListener('pointerup', handleColumnPointerUp);
window.addEventListener('pointercancel', (event) => {
  if (state.columnResize?.pointerId === event.pointerId) {
    endColumnResize({ suppressClick: state.columnResize.active });
    return;
  }
  if (state.columnDrag?.pointerId === event.pointerId) {
    endColumnDrag({ suppressClick: state.columnDrag.active });
  }
});
window.addEventListener('blur', () => {
  endColumnResize({ suppressClick: state.columnResize?.active });
  endColumnDrag({ suppressClick: state.columnDrag?.active });
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

  const openFolderButton = event.target.closest('button[data-open-folder]');
  if (openFolderButton) {
    event.stopPropagation();
    openProjectFolder(openFolderButton.dataset.name);
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
    runAction(actionButton.dataset.name, actionButton.dataset.action);
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

  state.selectedName = row.dataset.name;
  if (isMobileLayout()) {
    toggleProjectPanel(row.dataset.name);
  } else {
    render();
  }
  loadLogs();
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

elements.closeFirewallModal.addEventListener('click', hideLanFirewallConsent);
elements.closeFirewallDone.addEventListener('click', hideLanFirewallConsent);
elements.firewallConsent.addEventListener('change', () => {
  const allowed = elements.firewallConsent.checked;
  elements.copyFirewallCommand.disabled = !allowed;
  elements.runFirewallCommand.disabled = !allowed;
});
elements.copyFirewallCommand.addEventListener('click', () => copyText(elements.firewallCommand.value));
elements.runFirewallCommand.addEventListener('click', runLanFirewallCommand);
elements.firewallModal.addEventListener('click', (event) => {
  if (event.target === elements.firewallModal) {
    hideLanFirewallConsent();
  }
});
elements.closeQuotaModal.addEventListener('click', () => hideQuotaMonitor());
elements.backToHomeFromQuota.addEventListener('click', () => hideQuotaMonitor());
elements.refreshQuotaButton.addEventListener('click', () => loadAiQuotas());
elements.quotaModal.addEventListener('click', (event) => {
  if (event.target === elements.quotaModal) {
    hideQuotaMonitor();
  }
});
elements.closeTerminalModal.addEventListener('click', hideTerminalManager);
elements.backToHomeFromTerminal.addEventListener('click', hideTerminalManager);
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
elements.terminalProjectBar.addEventListener('change', (event) => {
  const picker = event.target.closest('select[data-terminal-project-picker]');
  if (!picker) {
    return;
  }

  switchTerminalProject(picker.value, { ensureDraft: true });
  renderTerminalModal();
  startTerminalPolling();
});
elements.terminalProjectBar.addEventListener('click', (event) => {
  const projectButton = event.target.closest('button[data-terminal-project-window]');
  if (!projectButton) {
    return;
  }

  switchTerminalProject(projectButton.dataset.terminalProjectWindow, { ensureDraft: true });
  renderTerminalModal();
  startTerminalPolling();
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

applyDemoModeUi();
const terminalFavoriteState = readTerminalFavorites();
state.terminalFavoriteAgent = terminalFavoriteState.activeAgent;
state.terminalFavoritesByAgent = terminalFavoriteState.favoritesByAgent;
syncTerminalFavoritesFromActiveAgent();
state.terminalClaude = readTerminalClaudeSettings();
state.terminalCodex = readTerminalCodexSettings();
state.terminalAntigravity = readTerminalAntigravitySettings();
restoreTerminalWorkspaceState();
const terminalPreferencesReady = loadTerminalPreferences({ silent: true });
applyTheme(readThemePreference());
loadTablePreferences();
syncQuotaRouteFromHash();
loadStatus().then(() => {
  loadLogs();
  terminalPreferencesReady.finally(() => loadTerminalSessions({ silent: true }));
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
