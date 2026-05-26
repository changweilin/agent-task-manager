const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { WebSocketServer } = require('ws');

let pty = null;
try {
  pty = require('node-pty');
} catch (error) {
  pty = null;
}

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CONFIG_PATH = process.env.DEV_DOCK_CONFIG || path.join(ROOT_DIR, 'dev-projects.json');
const MANAGER_DIR = path.join(ROOT_DIR, '.dev-manager');
const LOG_DIR = path.join(MANAGER_DIR, 'logs');
const STATE_PATH = path.join(MANAGER_DIR, 'state.json');
const TERMINAL_PREFERENCES_PATH = path.join(MANAGER_DIR, 'terminal-preferences.json');
const DEFAULT_BASE_PORT = 5173;
const DEFAULT_MANAGER_PORT = 8787;
const DEFAULT_HEALTH_FAILURE_THRESHOLD = 3;
const PAGE_SCAN_TTL_MS = 30000;
const PAGE_SCAN_MAX_FILES = 800;
const PAGE_SCAN_MAX_PAGES = 80;
const PAGE_SCAN_MAX_DEPTH = 8;
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.uv-cache',
  '.hf-cache',
  '.ultralytics',
  'target',
  'dist',
  'build',
  'coverage',
  'out',
  '.output',
]);
const PROJECT_MARKER_FILES = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'deno.json',
  'bun.lockb',
  'uv.lock',
]);
const PAGE_SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.astro']);
const ROUTE_PAGE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.astro', '.md', '.mdx', '.html', '.htm']);
const STATIC_PAGE_EXTENSIONS = new Set(['.html', '.htm']);
const SPECIAL_ROUTE_FILES = new Set([
  'layout',
  'template',
  'loading',
  'error',
  'not-found',
  'head',
  'default',
  'middleware',
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const childProcesses = new Map();
const terminalSessions = new Map();
let aiQuotaProbeInFlight = null;
const mobileInstallLocks = new Set();
const restartLocks = new Set();
const pageScanCache = new Map();
const TERMINAL_BUFFER_LIMIT = 2 * 1024 * 1024;
const TERMINAL_INPUT_LIMIT = 16 * 1024;
const TERMINAL_PREFERENCE_TEXT_LIMIT = 4096;
const TERMINAL_FAVORITE_LIMIT = 60;
const TERMINAL_WORKSPACE_SESSION_LIMIT = 80;
const TERMINAL_DEFAULT_COLS = 100;
const TERMINAL_DEFAULT_ROWS = 28;
const TERMINAL_MAX_ROWS = 120;
const TERMINAL_FAVORITES_VERSION = 7;
const TERMINAL_AGENT_IDS = ['claude', 'codex', 'antigravity'];
const DEFAULT_TERMINAL_AGENT_ID = 'claude';
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
const TERMINAL_CLAUDE_COMMANDS = new Set(['claude', 'claude -r', 'claude -c']);
const TERMINAL_CLAUDE_EFFORTS = new Set(['', 'low', 'medium', 'high', 'xhigh', 'max']);
const TERMINAL_CLAUDE_PERMISSION_MODES = new Set(['default', 'acceptEdits', 'plan', 'auto', 'dontAsk']);
const TERMINAL_REMOTE_CLAUDE_FLAGS = new Set(['--remote-control', '--chrome', '--worktree', '--init']);
const TERMINAL_CODEX_COMMANDS = new Set(['codex', 'codex resume --last', 'codex fork --last']);
const TERMINAL_CODEX_SANDBOXES = new Set(['', 'read-only', 'workspace-write', 'danger-full-access']);
const TERMINAL_CODEX_APPROVALS = new Set(['', 'untrusted', 'on-request', 'never']);
const TERMINAL_REMOTE_CODEX_FLAGS = new Set([
  '--search',
  '--no-alt-screen',
  '--oss',
  '--yolo',
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-bypass-hook-trust',
]);
const TERMINAL_ANTIGRAVITY_COMMANDS = new Set(['agy']);
const TERMINAL_REMOTE_ANTIGRAVITY_FLAGS = new Set(['--sandbox', '--dangerously-skip-permissions']);
const AI_QUOTA_PROBE_TIMEOUT_MS = 14000;
const AI_QUOTA_PTY_PROBE_TIMEOUT_MS = 32000;
const AI_QUOTA_AUTH_TIMEOUT_MS = 3500;
const AI_QUOTA_OUTPUT_LIMIT = 96 * 1024;
const AI_QUOTA_AGENTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    provider: 'Anthropic',
    command: 'claude',
    authCommand: { args: ['auth', 'status', '--text'], label: 'claude auth status --text' },
    interactiveCommands: ['/usage'],
    exitCommand: '/exit',
    ptyStartupDelayMs: 9000,
    ptySettleDelayMs: 14000,
    minSignalCollectDelayMs: 12000,
    probe: 'claude auth status + /usage',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    provider: 'OpenAI',
    command: 'codex',
    authCommand: { args: ['login', 'status'], label: 'codex login status' },
    authCommands: [{ args: ['auth', 'status'], label: 'codex auth status' }],
    interactiveCommands: ['/status'],
    exitCommand: '/quit',
    confirmInteractiveCommand: true,
    ptyStartupDelayMs: 9000,
    ptySettleDelayMs: 12000,
    minSignalCollectDelayMs: 8000,
    probe: 'codex login status + /status',
  },
  {
    id: 'antigravity',
    label: 'Antigravity CLI',
    provider: 'Google',
    command: 'agy',
    interactiveCommands: ['/usage'],
    exitCommand: '/quit',
    ptyStartupDelayMs: 10000,
    ptySettleDelayMs: 20000,
    minSignalCollectDelayMs: 4000,
    probe: 'agy + /usage',
  },
];
const VENDOR_ASSETS = new Map([
  ['/vendor/xterm/xterm.css', path.join(ROOT_DIR, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css')],
  ['/vendor/xterm/xterm.mjs', path.join(ROOT_DIR, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.mjs')],
  ['/vendor/xterm/addon-fit.mjs', path.join(ROOT_DIR, 'node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.mjs')],
]);

ensureDir(MANAGER_DIR);
ensureDir(LOG_DIR);

function parseArgValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }

  const pair = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (pair) {
    return pair.slice(name.length + 1);
  }

  return fallback;
}

const host = parseArgValue('--host', process.env.HOST || '0.0.0.0');
const port = Number(parseArgValue('--port', process.env.PORT || DEFAULT_MANAGER_PORT));

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function getConfig() {
  const config = readJson(CONFIG_PATH, null);
  if (!config) {
    return {
      defaultRoots: [ROOT_DIR],
      basePort: DEFAULT_BASE_PORT,
      projects: [],
      profiles: [],
      autoRestoreOnStartup: true,
      health: normalizeHealthSettings(),
    };
  }

  const basePort = Number(config.basePort || DEFAULT_BASE_PORT);
  const defaultRoots = Array.isArray(config.defaultRoots) && config.defaultRoots.length ? config.defaultRoots : [ROOT_DIR];
  const projects = Array.isArray(config.projects) ? config.projects : [];
  const collapsedProjects = collapseProjectsToRoots(projects, defaultRoots);
  const normalizedProjects = normalizeProjects(collapsedProjects, basePort);

  return {
    defaultRoots,
    basePort,
    projects: collapsedProjects,
    profiles: normalizeProfiles(config.profiles, normalizedProjects),
    autoRestoreOnStartup: config.autoRestoreOnStartup !== false,
    health: normalizeHealthSettings(config.health),
  };
}

function saveConfig(config) {
  const basePort = Number(config.basePort || DEFAULT_BASE_PORT);
  const defaultRoots = config.defaultRoots || [ROOT_DIR];
  const projects = normalizeProjects(collapseProjectsToRoots(config.projects || [], defaultRoots), basePort);

  writeJson(CONFIG_PATH, {
    defaultRoots,
    basePort,
    autoRestoreOnStartup: config.autoRestoreOnStartup !== false,
    health: normalizeHealthSettings(config.health),
    profiles: normalizeProfiles(config.profiles || [], projects),
    projects,
  });
}

function getState() {
  const state = readJson(STATE_PATH, null);
  return {
    updatedAt: state?.updatedAt || new Date().toISOString(),
    projects: Array.isArray(state?.projects) ? state.projects : [],
  };
}

function saveState(state) {
  writeJson(STATE_PATH, {
    updatedAt: new Date().toISOString(),
    projects: Array.isArray(state.projects) ? state.projects : [],
  });
}

function cleanPreferenceString(value, maxLength) {
  return String(value ?? '')
    .replace(/\0/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizeTerminalFavorites(favorites) {
  if (!Array.isArray(favorites)) {
    return [];
  }

  const ids = new Set();
  return favorites
    .slice(0, TERMINAL_FAVORITE_LIMIT)
    .map((favorite, index) => {
      const command = cleanPreferenceString(favorite?.command, TERMINAL_PREFERENCE_TEXT_LIMIT);
      if (!command) {
        return null;
      }

      const note = cleanPreferenceString(favorite?.note, 240);
      const rawId = cleanPreferenceString(favorite?.id || `favorite-${index + 1}`, 80);
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
      const orderMap = new Map(reorderCommands.map((command, index) => [terminalFavoriteCommandKey(command), index]));
      const ordered = new Array(reorderCommands.length).fill(null);
      const others = [];
      next.forEach((favorite) => {
        const orderIndex = orderMap.get(terminalFavoriteCommandKey(favorite.command));
        if (orderIndex === undefined || ordered[orderIndex]) {
          others.push(favorite);
          return;
        }
        ordered[orderIndex] = favorite;
      });
      next = normalizeTerminalFavorites([...ordered.filter(Boolean), ...others]);
    }
  });

  return next;
}

function normalizeTerminalAgentId(value) {
  const agentId = cleanPreferenceString(value, 32).toLowerCase();
  return TERMINAL_AGENT_IDS.includes(agentId) ? agentId : DEFAULT_TERMINAL_AGENT_ID;
}

function defaultTerminalFavoritesForAgent(agentId) {
  return normalizeTerminalFavorites(DEFAULT_TERMINAL_FAVORITES_BY_AGENT[normalizeTerminalAgentId(agentId)] || DEFAULT_TERMINAL_FAVORITES);
}

function defaultTerminalFavoritesByAgent() {
  return Object.fromEntries(TERMINAL_AGENT_IDS.map((agentId) => [agentId, defaultTerminalFavoritesForAgent(agentId)]));
}

function normalizeTerminalFavoritesByAgent(source, favoritesVersion = 0) {
  const agents = source && typeof source === 'object' ? source : {};
  const favoritesByAgent = defaultTerminalFavoritesByAgent();

  TERMINAL_AGENT_IDS.forEach((agentId) => {
    if (!Array.isArray(agents[agentId])) {
      return;
    }
    favoritesByAgent[agentId] = migrateTerminalFavorites(agents[agentId], favoritesVersion, agentId);
  });

  return favoritesByAgent;
}

function normalizeTerminalWorkspace(workspace) {
  const source = workspace && typeof workspace === 'object' ? workspace : {};
  const sessions = (Array.isArray(source.sessions) ? source.sessions : [])
    .slice(0, TERMINAL_WORKSPACE_SESSION_LIMIT)
    .map((session, index) => {
      const id = cleanPreferenceString(session?.id, 128);
      const localId = cleanPreferenceString(session?.localId, 128) || (id ? `server-${id}` : `draft-${index + 1}`);
      const projectName = cleanPreferenceString(session?.projectName, 240);
      if (!projectName) {
        return null;
      }

      return {
        id: id || null,
        localId,
        projectName,
        title: cleanPreferenceString(session?.title, 120),
        titleEdited: session?.titleEdited === true,
        input: cleanPreferenceString(session?.input, TERMINAL_PREFERENCE_TEXT_LIMIT),
        cwdRelativePath: cleanPreferenceString(session?.cwdRelativePath, 1000),
        shellId: cleanPreferenceString(session?.shellId, 64),
      };
    })
    .filter(Boolean);

  const localIds = new Set(sessions.map((session) => session.localId));
  const projectNames = new Set(sessions.map((session) => session.projectName));
  const requestedProjectName = cleanPreferenceString(source.activeProjectName, 240);
  const activeProjectName = projectNames.has(requestedProjectName)
    ? requestedProjectName
    : sessions[0]?.projectName || '';
  const requestedSessionId = cleanPreferenceString(source.activeSessionId, 128);
  const activeSessionId = localIds.has(requestedSessionId)
    ? requestedSessionId
    : sessions.find((session) => session.projectName === activeProjectName)?.localId || '';
  const activeSessionIdsByProject = {};

  if (source.activeSessionIdsByProject && typeof source.activeSessionIdsByProject === 'object') {
    Object.entries(source.activeSessionIdsByProject)
      .slice(0, TERMINAL_WORKSPACE_SESSION_LIMIT)
      .forEach(([projectName, localId]) => {
        const cleanProjectName = cleanPreferenceString(projectName, 240);
        const cleanLocalId = cleanPreferenceString(localId, 128);
        if (projectNames.has(cleanProjectName) && localIds.has(cleanLocalId)) {
          activeSessionIdsByProject[cleanProjectName] = cleanLocalId;
        }
      });
  }

  return {
    activeProjectName,
    activeSessionId,
    activeSessionIdsByProject,
    sessions,
  };
}

function defaultTerminalPreferences() {
  const favoritesByAgent = defaultTerminalFavoritesByAgent();
  return {
    favoritesVersion: TERMINAL_FAVORITES_VERSION,
    activeAgent: DEFAULT_TERMINAL_AGENT_ID,
    favorites: favoritesByAgent[DEFAULT_TERMINAL_AGENT_ID],
    favoritesByAgent,
    workspace: normalizeTerminalWorkspace({}),
    updatedAt: null,
  };
}

function readTerminalPreferences() {
  const saved = fs.existsSync(TERMINAL_PREFERENCES_PATH);
  const stored = saved ? readJson(TERMINAL_PREFERENCES_PATH, {}) : {};
  const defaults = defaultTerminalPreferences();
  const favoritesVersion = Number(stored?.favoritesVersion || 0) || 0;
  const savedFavoritesByAgent = saved && stored?.favoritesByAgent && typeof stored.favoritesByAgent === 'object'
    ? normalizeTerminalFavoritesByAgent(stored.favoritesByAgent, favoritesVersion)
    : saved && Array.isArray(stored?.favorites)
      ? {
          ...defaultTerminalFavoritesByAgent(),
          claude: migrateTerminalFavorites(stored.favorites, favoritesVersion, 'claude'),
        }
      : defaults.favoritesByAgent;
  const activeAgent = saved ? normalizeTerminalAgentId(stored?.activeAgent) : defaults.activeAgent;

  return {
    saved,
    updatedAt: stored?.updatedAt || null,
    favoritesVersion: saved ? favoritesVersion : defaults.favoritesVersion,
    activeAgent,
    favorites: savedFavoritesByAgent[activeAgent] || defaults.favorites,
    favoritesByAgent: savedFavoritesByAgent,
    workspace: saved && stored?.workspace
      ? normalizeTerminalWorkspace(stored.workspace)
      : defaults.workspace,
  };
}

function saveTerminalPreferences(patch) {
  const source = patch && typeof patch === 'object' ? patch : {};
  const current = readTerminalPreferences();
  const activeAgent = Object.prototype.hasOwnProperty.call(source, 'activeAgent')
    ? normalizeTerminalAgentId(source.activeAgent)
    : current.activeAgent;
  const sourceFavoritesByAgent = source.favoritesByAgent && typeof source.favoritesByAgent === 'object'
    ? source.favoritesByAgent
    : null;
  const favoritesByAgent = sourceFavoritesByAgent
    ? normalizeTerminalFavoritesByAgent(sourceFavoritesByAgent, TERMINAL_FAVORITES_VERSION)
    : Object.prototype.hasOwnProperty.call(source, 'favorites')
      ? {
          ...current.favoritesByAgent,
          [activeAgent]: normalizeTerminalFavorites(source.favorites),
        }
      : current.favoritesByAgent;
  const next = {
    favoritesVersion: TERMINAL_FAVORITES_VERSION,
    activeAgent,
    favorites: favoritesByAgent[activeAgent] || defaultTerminalFavoritesForAgent(activeAgent),
    favoritesByAgent,
    workspace: Object.prototype.hasOwnProperty.call(source, 'workspace')
      ? normalizeTerminalWorkspace(source.workspace)
      : current.workspace,
    updatedAt: new Date().toISOString(),
  };

  writeJson(TERMINAL_PREFERENCES_PATH, next);
  return { ...next, saved: true };
}

function normalizePath(inputPath) {
  return path.resolve(inputPath);
}

function safeName(name) {
  const cleaned = String(name || 'project')
    .replace(/^@/, '')
    .replace(/[\\/]/g, '-')
    .replace(/[^\w.-]/g, '-')
    .replace(/^-+|-+$/g, '');

  return cleaned || 'project';
}

function normalizeHealthSettings(health = {}) {
  const threshold = Number(health.failureThreshold || DEFAULT_HEALTH_FAILURE_THRESHOLD);

  return {
    autoRestart: Boolean(health.autoRestart),
    failureThreshold: Math.max(1, Math.min(10, Number.isInteger(threshold) ? threshold : DEFAULT_HEALTH_FAILURE_THRESHOLD)),
  };
}

function normalizeProfiles(profiles = [], projects = []) {
  const validProjectNames = new Set(projects.map((project) => project.name));
  const seenIds = new Set();

  if (!Array.isArray(profiles)) {
    return [];
  }

  return profiles
    .filter(Boolean)
    .map((profile, index) => {
      const rawName = String(profile.name || profile.id || `Profile ${index + 1}`).trim();
      const name = rawName || `Profile ${index + 1}`;
      const idSeed = safeName(profile.id || name).toLowerCase();
      let id = idSeed || `profile-${index + 1}`;
      let count = 2;

      while (seenIds.has(id)) {
        id = `${idSeed || 'profile'}-${count}`;
        count += 1;
      }
      seenIds.add(id);

      const rawProjectNames = Array.isArray(profile.projectNames)
        ? profile.projectNames
        : Array.isArray(profile.projects)
          ? profile.projects
          : [];
      const projectNames = [...new Set(rawProjectNames.map((value) => String(value).trim()).filter(Boolean))]
        .filter((projectName) => !validProjectNames.size || validProjectNames.has(projectName));

      return {
        id,
        name,
        projectNames,
      };
    })
    .filter((profile) => profile.projectNames.length > 0);
}

function objectValue(object, key) {
  return object && Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
}

function hasDependency(packageJson, packageName) {
  return ['dependencies', 'devDependencies', 'peerDependencies'].some((section) => {
    const dependencies = objectValue(packageJson, section);
    return Boolean(dependencies && objectValue(dependencies, packageName));
  });
}

function detectFramework(packageJson, devScript) {
  if (hasDependency(packageJson, 'next') || /(^|\s)next\s+dev(\s|$)/.test(devScript)) {
    return 'next';
  }

  if (hasDependency(packageJson, 'astro') || /(^|\s)astro\s+dev(\s|$)/.test(devScript)) {
    return 'astro';
  }

  if (hasDependency(packageJson, 'nuxt') || hasDependency(packageJson, 'nuxi') || /(^|\s)(nuxt|nuxi)\s+dev(\s|$)/.test(devScript)) {
    return 'nuxt';
  }

  if (hasDependency(packageJson, 'vite') || /(^|\s)vite(\s|$)/.test(devScript)) {
    return 'vite';
  }

  return 'generic';
}

function normalizePort(value) {
  const portNumber = Number(value);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    return null;
  }

  return portNumber;
}

function detectPortFromDevScript(devScript) {
  if (!devScript || typeof devScript !== 'string') {
    return null;
  }

  const patterns = [
    /(?:^|\s)--port(?:=|\s+)(\d{1,5})(?=\s|$)/i,
    /(?:^|\s)-Port(?:=|\s+)(\d{1,5})(?=\s|$)/i,
    /(?:^|\s)-p(?:=|\s+)(\d{1,5})(?=\s|$)/i,
    /(?:^|\s)(?:PORT|VITE_PORT)=(\d{1,5})(?=\s|$)/i,
  ];

  for (const pattern of patterns) {
    const match = devScript.match(pattern);
    const portNumber = normalizePort(match?.[1]);
    if (portNumber) {
      return portNumber;
    }
  }

  return null;
}

function projectHasStartCommand(project) {
  return Boolean(String(project?.devScript || '').trim());
}

function projectHasWebTarget(project) {
  return project?.hasWebTarget !== false && Boolean(normalizePort(project?.port));
}

function projectCanStart(project) {
  return projectHasStartCommand(project) && projectHasWebTarget(project);
}

function normalizeUrlPath(routePath) {
  const raw = String(routePath || '/').trim().replace(/\\/g, '/');
  if (!raw || raw === '/') {
    return '/';
  }

  if (raw.startsWith('#')) {
    return `/${raw}`;
  }

  const [pathnamePart, hashPart] = raw.split('#');
  let pathname = pathnamePart || '/';
  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }
  pathname = pathname.replace(/\/+/g, '/');
  if (pathname.length > 1) {
    pathname = pathname.replace(/\/+$/g, '');
  }

  return hashPart ? `${pathname}#${hashPart}` : pathname;
}

function buildPageUrl(baseUrl, pagePath) {
  if (!baseUrl) {
    return '';
  }

  return `${baseUrl.replace(/\/+$/g, '')}${normalizeUrlPath(pagePath)}`;
}

function normalizeRouteSegment(segment) {
  const value = String(segment || '').trim();
  if (!value || value === 'index' || value.startsWith('@') || /^\(.+\)$/.test(value)) {
    return '';
  }

  const optionalCatchAll = value.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll) {
    return `*${optionalCatchAll[1]}?`;
  }

  const catchAll = value.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll) {
    return `*${catchAll[1]}`;
  }

  const dynamicSegment = value.match(/^\[(.+)\]$/);
  if (dynamicSegment) {
    return `:${dynamicSegment[1]}`;
  }

  const svelteDynamic = value.match(/^\$(.+)$/);
  if (svelteDynamic) {
    return `:${svelteDynamic[1]}`;
  }

  return value;
}

function routeFromSegments(segments) {
  const normalizedSegments = segments
    .map(normalizeRouteSegment)
    .filter(Boolean);

  return normalizedSegments.length ? normalizeUrlPath(normalizedSegments.join('/')) : '/';
}

function isInternalRouteCandidate(value) {
  const routePath = String(value || '').trim();
  if (!routePath || routePath.length > 160 || routePath.includes('${') || /\s/.test(routePath)) {
    return false;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(routePath) || routePath.startsWith('//')) {
    return false;
  }

  if (!routePath.startsWith('/') && !routePath.startsWith('#')) {
    return false;
  }

  const pathname = normalizeUrlPath(routePath).split(/[?#]/)[0].toLowerCase();
  if (/^\/(?:api|assets?|static|images?|img|fonts?)\b/.test(pathname)) {
    return false;
  }

  if (/\.[a-z0-9]{2,6}$/i.test(pathname) && !/\.html?$/i.test(pathname)) {
    return false;
  }

  return true;
}

function isPatternRoute(routePath) {
  return /(^|\/)(?::|\*)/.test(String(routePath || ''));
}

function pageTitleFromPath(routePath) {
  const normalizedPath = normalizeUrlPath(routePath);
  if (normalizedPath === '/') {
    return 'Home';
  }

  return normalizedPath
    .replace(/^\//, '')
    .replace(/^#/, '')
    .replace(/[/:*?#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || normalizedPath;
}

function addDiscoveredPage(pagesByPath, project, routePath, source, filePath) {
  if (!isInternalRouteCandidate(routePath)) {
    return;
  }

  const normalizedPath = normalizeUrlPath(routePath);
  const key = normalizedPath.toLowerCase();
  if (pagesByPath.has(key) || pagesByPath.size >= PAGE_SCAN_MAX_PAGES) {
    return;
  }

  pagesByPath.set(key, {
    path: normalizedPath,
    title: pageTitleFromPath(normalizedPath),
    source,
    file: filePath ? path.relative(project.path, filePath).replace(/\\/g, '/') : '',
    pattern: isPatternRoute(normalizedPath),
  });
}

function collectFiles(rootPath, extensions, options = {}) {
  const files = [];
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : PAGE_SCAN_MAX_DEPTH;
  const maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : PAGE_SCAN_MAX_FILES;
  const stack = [{ dirPath: rootPath, depth: 0 }];

  while (stack.length && files.length < maxFiles) {
    const current = stack.pop();
    let entries;

    try {
      entries = fs.readdirSync(current.dirPath, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = path.join(current.dirPath, entry.name);
      if (shouldIgnore(entryPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (current.depth < maxDepth) {
          stack.push({ dirPath: entryPath, depth: current.depth + 1 });
        }
        continue;
      }

      if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(entryPath);
        if (files.length >= maxFiles) {
          break;
        }
      }
    }
  }

  return files;
}

function uniqueExistingDirs(paths) {
  const seen = new Set();
  return paths
    .filter(Boolean)
    .map((dirPath) => normalizePath(dirPath))
    .filter((dirPath) => {
      if (seen.has(dirPath.toLowerCase()) || !fs.existsSync(dirPath)) {
        return false;
      }

      try {
        if (!fs.statSync(dirPath).isDirectory()) {
          return false;
        }
      } catch (error) {
        return false;
      }

      seen.add(dirPath.toLowerCase());
      return true;
    });
}

function detectExplicitServedRoot(project) {
  const match = String(project.devScript || '').match(/(?:^|\s)--root(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
  const rootValue = match?.[1] || match?.[2] || match?.[3];
  if (!rootValue) {
    return null;
  }

  return path.resolve(project.path, rootValue);
}

function getServedRootCandidates(project) {
  const explicitRoot = detectExplicitServedRoot(project);
  return uniqueExistingDirs(explicitRoot ? [explicitRoot] : [project.path]);
}

function routeFromHtmlFile(rootPath, filePath) {
  const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');
  const extension = path.extname(relativePath);
  const withoutExtension = relativePath.slice(0, -extension.length);
  const segments = withoutExtension.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];

  if (lastSegment === 'index') {
    segments.pop();
  }

  return routeFromSegments(segments);
}

function getRouteRootCandidates(project) {
  const candidates = [];
  const add = (relativePath, mode, source) => {
    const dirPath = path.join(project.path, relativePath);
    if (fs.existsSync(dirPath)) {
      candidates.push({ dirPath, mode, source });
    }
  };

  if (project.framework === 'next') {
    add('app', 'next-app', 'app');
    add('src/app', 'next-app', 'src/app');
  }

  if (project.framework === 'nuxt') {
    add('app/pages', 'pages', 'app/pages');
  }

  add('pages', 'pages', 'pages');
  add('src/pages', 'pages', 'src/pages');
  add('routes', 'svelte', 'routes');
  add('src/routes', 'svelte', 'src/routes');

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${normalizePath(candidate.dirPath).toLowerCase()}|${candidate.mode}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function routeFromRouteFile(routeRoot, filePath, mode) {
  const extension = path.extname(filePath).toLowerCase();
  if (!ROUTE_PAGE_EXTENSIONS.has(extension)) {
    return null;
  }

  const relativePath = path.relative(routeRoot, filePath).replace(/\\/g, '/');
  const withoutExtension = relativePath.slice(0, -extension.length);
  const segments = withoutExtension.split('/').filter(Boolean);
  const leaf = segments[segments.length - 1] || '';

  if (!leaf || /\.test$|\.spec$/.test(leaf)) {
    return null;
  }

  if (mode === 'next-app') {
    if (leaf !== 'page') {
      return null;
    }
    segments.pop();
    return routeFromSegments(segments);
  }

  if (mode === 'svelte') {
    if (leaf.startsWith('+')) {
      if (leaf !== '+page') {
        return null;
      }
      segments.pop();
    } else if (leaf === 'index') {
      segments.pop();
    }
    return routeFromSegments(segments);
  }

  if (SPECIAL_ROUTE_FILES.has(leaf) || leaf.startsWith('_') || segments.some((segment) => segment === 'api' || segment.startsWith('_'))) {
    return null;
  }

  if (leaf === 'index') {
    segments.pop();
  }

  return routeFromSegments(segments);
}

function discoverStaticHtmlPages(project, pagesByPath) {
  for (const servedRoot of getServedRootCandidates(project)) {
    const htmlFiles = collectFiles(servedRoot, STATIC_PAGE_EXTENSIONS, { maxDepth: 4, maxFiles: PAGE_SCAN_MAX_FILES });
    for (const htmlFile of htmlFiles) {
      addDiscoveredPage(pagesByPath, project, routeFromHtmlFile(servedRoot, htmlFile), 'html', htmlFile);
    }
  }
}

function discoverFileRoutePages(project, pagesByPath) {
  for (const candidate of getRouteRootCandidates(project)) {
    const routeFiles = collectFiles(candidate.dirPath, ROUTE_PAGE_EXTENSIONS, { maxDepth: PAGE_SCAN_MAX_DEPTH, maxFiles: PAGE_SCAN_MAX_FILES });
    for (const routeFile of routeFiles) {
      const routePath = routeFromRouteFile(candidate.dirPath, routeFile, candidate.mode);
      if (routePath) {
        addDiscoveredPage(pagesByPath, project, routePath, candidate.source, routeFile);
      }
    }
  }
}

function readSmallTextFile(filePath) {
  try {
    if (fs.statSync(filePath).size > 256 * 1024) {
      return '';
    }

    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return '';
  }
}

function discoverSourceDeclaredPages(project, pagesByPath) {
  const sourceRoots = uniqueExistingDirs(['src', 'app', 'pages', 'routes'].map((sourceRoot) => path.join(project.path, sourceRoot)));
  const roots = sourceRoots.length ? sourceRoots : getServedRootCandidates(project);
  const seenFiles = new Set();
  const sourceFiles = roots.flatMap((sourceRoot) => collectFiles(sourceRoot, PAGE_SOURCE_EXTENSIONS, { maxDepth: 6, maxFiles: 320 }));

  for (const sourceFile of sourceFiles) {
    const sourceKey = normalizePath(sourceFile).toLowerCase();
    if (seenFiles.has(sourceKey)) {
      continue;
    }
    seenFiles.add(sourceKey);

    const sourceText = readSmallTextFile(sourceFile);
    if (!sourceText) {
      continue;
    }

    const hashPatterns = [
      /(?:window\.)?location\.hash\s*(?:===|!==|==|=)\s*['"]#([^'"\s<>]+)['"]/g,
    ];
    const routePathPatterns = [
      /<Route\b[^>]*\bpath\s*=\s*['"]([^'"]+)['"]/g,
      /\bpath\s*:\s*['"](\/[^'"]*)['"]/g,
      /\bcreate(?:File)?Route\s*\(\s*['"]([^'"]+)['"]/g,
    ];

    for (const pattern of hashPatterns) {
      for (const match of sourceText.matchAll(pattern)) {
        addDiscoveredPage(pagesByPath, project, `#${match[1]}`, 'hash', sourceFile);
      }
    }

    for (const pattern of routePathPatterns) {
      for (const match of sourceText.matchAll(pattern)) {
        addDiscoveredPage(pagesByPath, project, match[1], 'router', sourceFile);
      }
    }
  }
}

function discoverProjectPages(project) {
  const cacheKey = `${normalizePath(project.path)}|${project.framework}|${project.devScript}`;
  const cached = pageScanCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < PAGE_SCAN_TTL_MS) {
    return cached.pages;
  }

  const pagesByPath = new Map();
  try {
    discoverStaticHtmlPages(project, pagesByPath);
    discoverFileRoutePages(project, pagesByPath);
    discoverSourceDeclaredPages(project, pagesByPath);
  } catch (error) {
    // Page discovery is best-effort; project status should stay available.
  }

  const pages = [...pagesByPath.values()]
    .sort((left, right) => {
      if (left.path === '/') {
        return -1;
      }
      if (right.path === '/') {
        return 1;
      }
      return left.path.localeCompare(right.path, 'en', { numeric: true, sensitivity: 'base' });
    })
    .slice(0, PAGE_SCAN_MAX_PAGES);

  pageScanCache.set(cacheKey, { checkedAt: Date.now(), pages });
  return pages;
}

function shouldIgnore(entryPath) {
  return entryPath.split(/[\\/]+/).some((segment) => IGNORED_DIRS.has(segment));
}

function hasProjectMarker(projectPath) {
  if (fs.existsSync(path.join(projectPath, '.git'))) {
    return true;
  }

  for (const marker of PROJECT_MARKER_FILES) {
    if (fs.existsSync(path.join(projectPath, marker))) {
      return true;
    }
  }

  return false;
}

function discoverProjectDirs(rootPath) {
  const results = new Set([rootPath]);
  const seen = new Set();
  const stack = [rootPath];

  while (stack.length) {
    const current = normalizePath(stack.pop());
    const key = current.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (hasProjectMarker(current)) {
      results.add(current);
    }

    let entries;

    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (shouldIgnore(entryPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(entryPath);
      }
    }
  }

  return [...results];
}

function readPyprojectName(projectPath) {
  const pyprojectPath = path.join(projectPath, 'pyproject.toml');
  if (!fs.existsSync(pyprojectPath)) {
    return '';
  }

  try {
    const lines = fs.readFileSync(pyprojectPath, 'utf8').split(/\r?\n/);
    let inProjectSection = false;
    for (const line of lines) {
      if (/^\s*\[/.test(line)) {
        inProjectSection = /^\s*\[project\]\s*$/.test(line);
        continue;
      }

      if (!inProjectSection) {
        continue;
      }

      const match = line.match(/^\s*name\s*=\s*["']([^"']+)["']/);
      if (match) {
        return match[1];
      }
    }
  } catch (error) {
    return '';
  }

  return '';
}

function detectProjectFramework(projectPath, packageJson, devScript) {
  if (packageJson) {
    return devScript ? detectFramework(packageJson, devScript) : 'node';
  }

  if (
    fs.existsSync(path.join(projectPath, 'pyproject.toml')) ||
    fs.existsSync(path.join(projectPath, 'requirements.txt'))
  ) {
    return 'python';
  }

  if (fs.existsSync(path.join(projectPath, 'Cargo.toml'))) {
    return 'rust';
  }

  if (fs.existsSync(path.join(projectPath, 'go.mod'))) {
    return 'go';
  }

  return 'folder';
}

function projectFromDirectory(projectPath) {
  const packageJsonPath = path.join(projectPath, 'package.json');
  const packageJson = fs.existsSync(packageJsonPath) ? readJson(packageJsonPath, null) : null;
  const packageName = packageJson?.name || '';
  const devScript = typeof packageJson?.scripts?.dev === 'string'
    ? packageJson.scripts.dev.trim()
    : '';
  const pyprojectName = readPyprojectName(projectPath);
  const name = safeName(packageName || pyprojectName || path.basename(projectPath));
  const framework = detectProjectFramework(projectPath, packageJson, devScript);
  const hasWebTarget = Boolean(devScript);

  return {
    name,
    path: projectPath,
    framework,
    devScript,
    port: hasWebTarget ? detectPortFromDevScript(devScript) || undefined : null,
    canStart: hasWebTarget,
    hasWebTarget,
    sourceType: packageJson
      ? 'package'
      : pyprojectName || fs.existsSync(path.join(projectPath, 'pyproject.toml'))
        ? 'pyproject'
        : hasProjectMarker(projectPath)
          ? 'marker'
          : 'root',
  };
}

function isSamePath(leftPath, rightPath) {
  return normalizePath(leftPath).toLowerCase() === normalizePath(rightPath).toLowerCase();
}

function isPathWithin(parentPath, childPath) {
  const relative = path.relative(normalizePath(parentPath), normalizePath(childPath));
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function branchFromProject(project, rootPath) {
  const branchPath = normalizePath(project.path);
  const relativePath = path.relative(normalizePath(rootPath), branchPath).replace(/\\/g, '/');
  return {
    ...project,
    path: branchPath,
    relativePath: relativePath || path.basename(branchPath),
  };
}

function mergeProjectBranches(branches = [], rootPath) {
  const branchesByPath = new Map();

  for (const branch of branches) {
    if (!branch?.path) {
      continue;
    }

    const branchPath = normalizePath(branch.path);
    if (shouldIgnore(branchPath) || isSamePath(rootPath, branchPath)) {
      continue;
    }

    const normalized = branchFromProject({ ...branch, path: branchPath }, rootPath);
    const key = normalized.path.toLowerCase();
    const existing = branchesByPath.get(key);
    if (!existing) {
      branchesByPath.set(key, normalized);
      continue;
    }

    const merged = { ...existing, ...normalized };
    if (projectHasStartCommand(existing) && !projectHasStartCommand(normalized)) {
      merged.framework = existing.framework;
      merged.devScript = existing.devScript;
      merged.port = existing.port;
      merged.canStart = existing.canStart;
      merged.hasWebTarget = existing.hasWebTarget;
    }
    branchesByPath.set(key, merged);
  }

  return [...branchesByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function discoverProjects(roots) {
  const projectsByPath = new Map();

  for (const root of roots) {
    const rootPath = normalizePath(root);
    if (!fs.existsSync(rootPath)) {
      continue;
    }

    const projectDirs = discoverProjectDirs(rootPath);
    const rootProject = projectFromDirectory(rootPath);
    const branches = projectDirs
      .filter((projectPath) => !isSamePath(projectPath, rootPath))
      .map((projectPath) => branchFromProject(projectFromDirectory(projectPath), rootPath));
    const key = rootPath.toLowerCase();
    const existing = projectsByPath.get(key);
    const nextProject = {
      ...rootProject,
      branches: mergeProjectBranches([...(existing?.branches || []), ...branches], rootPath),
    };
    projectsByPath.set(key, existing ? { ...existing, ...nextProject } : nextProject);
  }

  return [...projectsByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function collapseProjectsToRoots(projects, roots) {
  const rootPaths = (Array.isArray(roots) ? roots : [])
    .map((root) => normalizePath(root))
    .filter(Boolean);
  if (!rootPaths.length) {
    return projects;
  }

  const inputProjects = Array.isArray(projects) ? projects.filter(Boolean) : [];
  const projectsByPath = new Map(inputProjects
    .filter((project) => project?.path)
    .map((project) => [normalizePath(project.path).toLowerCase(), project]));
  const assignedPaths = new Set();
  const collapsed = [];

  for (const rootPath of rootPaths) {
    const rootKey = rootPath.toLowerCase();
    const existingRoot = projectsByPath.get(rootKey);
    const fallbackRoot = fs.existsSync(rootPath)
      ? projectFromDirectory(rootPath)
      : {
          name: safeName(path.basename(rootPath)),
          path: rootPath,
          framework: 'folder',
          devScript: '',
          port: null,
          canStart: false,
          hasWebTarget: false,
          sourceType: 'root',
        };
    const rootProject = existingRoot || fallbackRoot;
    const discoveredBranches = inputProjects
      .filter((project) => project?.path && !shouldIgnore(project.path) && !isSamePath(project.path, rootPath) && isPathWithin(rootPath, project.path))
      .flatMap((project) => [project, ...(Array.isArray(project.branches) ? project.branches : [])]);
    const branches = mergeProjectBranches([
      ...(Array.isArray(rootProject.branches) ? rootProject.branches : []),
      ...discoveredBranches,
    ], rootPath);

    assignedPaths.add(rootKey);
    for (const branch of branches) {
      assignedPaths.add(normalizePath(branch.path).toLowerCase());
    }

    collapsed.push({
      ...rootProject,
      path: rootPath,
      branches,
    });
  }

  for (const project of inputProjects) {
    if (!project?.path) {
      continue;
    }

    const key = normalizePath(project.path).toLowerCase();
    if (!assignedPaths.has(key) && !shouldIgnore(project.path)) {
      collapsed.push(project);
    }
  }

  return collapsed.sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')));
}

function normalizeProjectBranches(branches, rootPath, assignPort = null) {
  const seenNames = new Map();
  return mergeProjectBranches(branches, rootPath)
    .map((branch) => {
      const branchPath = normalizePath(branch.path);
      const baseName = safeName(branch.name || path.basename(branchPath));
      const count = (seenNames.get(baseName) || 0) + 1;
      seenNames.set(baseName, count);
      const name = count > 1 ? `${baseName}-${count}` : baseName;
      const devScript = typeof branch.devScript === 'string' ? branch.devScript.trim() : '';
      const rawHasWebTarget = objectValue(branch, 'hasWebTarget');
      const wantsWebTarget = Boolean(devScript) || rawHasWebTarget === true;
      const preferredPort = wantsWebTarget
        ? normalizePort(branch.port) || detectPortFromDevScript(devScript) || null
        : null;
      const projectPort = wantsWebTarget && assignPort
        ? assignPort(preferredPort)
        : preferredPort;
      const hasWebTarget = wantsWebTarget && Boolean(projectPort);

      return {
        name,
        path: branchPath,
        relativePath: branch.relativePath || path.relative(normalizePath(rootPath), branchPath).replace(/\\/g, '/'),
        framework: branch.framework || 'folder',
        devScript,
        port: projectPort,
        canStart: Boolean(devScript && hasWebTarget),
        hasWebTarget,
        sourceType: branch.sourceType || 'branch',
      };
    })
    .filter((branch) => projectHasWebTarget(branch));
}

function normalizeProjects(projects, basePort) {
  const seenNames = new Map();
  const usedPorts = new Set();
  let nextPort = Number(basePort || DEFAULT_BASE_PORT);
  const assignPort = (preferredPort = null) => {
    const normalizedPreferred = normalizePort(preferredPort);
    if (normalizedPreferred && !usedPorts.has(normalizedPreferred)) {
      usedPorts.add(normalizedPreferred);
      return normalizedPreferred;
    }

    while (usedPorts.has(nextPort)) {
      nextPort += 1;
    }

    const assignedPort = nextPort;
    usedPorts.add(assignedPort);
    nextPort += 1;
    return assignedPort;
  };

  return projects
    .filter(Boolean)
    .sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')))
    .map((project) => {
      const projectPath = normalizePath(project.path);
      const baseName = safeName(project.name || path.basename(projectPath));
      const count = (seenNames.get(baseName) || 0) + 1;
      seenNames.set(baseName, count);

      const name = count > 1 ? `${baseName}-${count}` : baseName;
      const devScript = typeof project.devScript === 'string' ? project.devScript.trim() : '';
      const rawHasWebTarget = objectValue(project, 'hasWebTarget');
      const hasWebTarget = Boolean(devScript) || rawHasWebTarget === true;
      let projectPort = hasWebTarget
        ? normalizePort(project.port) || detectPortFromDevScript(devScript) || 0
        : null;
      if (hasWebTarget && !projectPort) {
        projectPort = assignPort();
      } else if (projectPort) {
        projectPort = assignPort(projectPort);
      }

      return {
        name,
        path: projectPath,
        framework: project.framework || 'folder',
        devScript,
        port: projectPort,
        canStart: Boolean(devScript && hasWebTarget && projectPort),
        hasWebTarget: Boolean(hasWebTarget && projectPort),
        sourceType: project.sourceType || 'configured',
        branches: normalizeProjectBranches(project.branches || [], projectPath, assignPort),
      };
    });
}

function mergeDiscoveredWithExisting(discovered, existingProjects, basePort) {
  const existingByPath = new Map(existingProjects.map((project) => [normalizePath(project.path), project]));
  const merged = discovered.map((project) => {
    const existing = existingByPath.get(normalizePath(project.path));
    const existingDevScript = typeof existing?.devScript === 'string' && existing.devScript.trim()
      ? existing.devScript.trim()
      : '';
    const devScript = existingDevScript || project.devScript;
    const hasWebTarget = Boolean(devScript) || Boolean(project.hasWebTarget);
    return {
      ...project,
      name: existing?.name || project.name,
      framework: existing?.framework || project.framework,
      devScript,
      port: normalizePort(existing?.port) || project.port,
      hasWebTarget,
      sourceType: existing?.sourceType || project.sourceType,
      branches: mergeProjectBranches([
        ...(Array.isArray(project.branches) ? project.branches : []),
        ...(Array.isArray(existing?.branches) ? existing.branches : []),
      ], project.path),
    };
  });

  return normalizeProjects(merged, basePort);
}

function canBindPort(projectPort) {
  const portNumber = normalizePort(projectPort);
  if (!portNumber) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(portNumber, '0.0.0.0');
  });
}

function createHttpError(message, statusCode = 500, payload = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.payload = payload;
  return error;
}

function parseNetstatPort(localAddress) {
  const match = String(localAddress || '').trim().match(/:(\d{1,5})$/);
  return normalizePort(match?.[1]);
}

function getListeningPortOwnerPids(projectPort) {
  const portNumber = normalizePort(projectPort);
  if (!portNumber || process.platform !== 'win32') {
    return [];
  }

  try {
    const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    const pids = new Set();

    for (const line of output.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5 || parts[0] !== 'TCP' || parts[3] !== 'LISTENING') {
        continue;
      }

      if (parseNetstatPort(parts[1]) !== portNumber) {
        continue;
      }

      const pid = Number(parts[4]);
      if (Number.isInteger(pid) && pid > 0) {
        pids.add(pid);
      }
    }

    return [...pids];
  } catch (error) {
    return [];
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPortAvailable(projectPort, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canBindPort(projectPort)) {
      return true;
    }
    await wait(200);
  }

  return canBindPort(projectPort);
}

async function findAvailablePort(startPort, reservedPorts = new Set()) {
  const firstPort = Math.max(1, Number(startPort || DEFAULT_BASE_PORT));
  for (let candidate = firstPort; candidate <= 65535; candidate += 1) {
    if (reservedPorts.has(candidate)) {
      continue;
    }

    if (await canBindPort(candidate)) {
      return candidate;
    }
  }

  throw new Error(`No available port found from ${firstPort} to 65535.`);
}

function saveProjectPort(projectPath, projectPort) {
  const config = getConfig();
  const projects = normalizeProjects(config.projects, config.basePort).map((project) => {
    if (normalizePath(project.path) !== normalizePath(projectPath)) {
      return project;
    }

    return {
      ...project,
      port: projectPort,
    };
  });

  saveConfig({ ...config, projects });
}

function readRecentFile(filePath, maxBytes = 64 * 1024) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return '';
    }

    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const buffer = Buffer.alloc(stat.size - start);
    const fd = fs.openSync(filePath, 'r');

    try {
      fs.readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      fs.closeSync(fd);
    }

    return buffer.toString('utf8');
  } catch (error) {
    return '';
  }
}

function detectPortFromLogText(text) {
  if (!text) {
    return null;
  }

  text = String(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  const urlPattern = /(?:Local|Network|Tailscale|LAN):\s*https?:\/\/(?:\[[^\]]+\]|[^:\s/]+):(\d{1,5})(?:[/?#\s]|$)/gi;
  let match;
  let portNumber = null;

  while ((match = urlPattern.exec(text)) !== null) {
    portNumber = normalizePort(match[1]) || portNumber;
  }

  return portNumber;
}

function detectPortFromProjectLogs(entry) {
  return detectPortFromLogText(readRecentFile(entry?.stdout)) || detectPortFromLogText(readRecentFile(entry?.stderr));
}

function syncProjectPort(projectPath, projectPort) {
  const portNumber = normalizePort(projectPort);
  if (!portNumber) {
    return;
  }

  saveProjectPort(projectPath, portNumber);

  const state = getState();
  const entry = getStateEntryByPath(state, projectPath);
  if (entry && Number(entry.port) !== portNumber) {
    setStateEntry(state, {
      ...entry,
      port: portNumber,
    });
    saveState(state);
  }
}

function resolveProjectPort(project, entry, running) {
  if (!project.hasWebTarget) {
    return project;
  }

  const logPort = running ? detectPortFromProjectLogs(entry) : null;
  const scriptedPort = detectPortFromDevScript(project.devScript);
  const portNumber = logPort || normalizePort(project.port) || scriptedPort;

  if (!portNumber) {
    return project;
  }

  if (Number(project.port) !== portNumber || (entry && Number(entry.port) !== portNumber)) {
    syncProjectPort(project.path, portNumber);
  }

  if (entry) {
    entry.port = portNumber;
  }

  return {
    ...project,
    port: portNumber,
  };
}

function historicalLogEntryForProject(project) {
  const prefix = logPrefix(project);
  return {
    stdout: path.join(LOG_DIR, `${prefix}.out.log`),
    stderr: path.join(LOG_DIR, `${prefix}.err.log`),
  };
}

async function resolveWebTargetProject(project, state) {
  const entry = getStateEntryByPath(state, project.path);
  const running = Boolean(entry?.pid && processIsRunning(entry.pid));
  let resolvedProject = resolveProjectPort(project, entry, running);
  let probe = projectHasWebTarget(resolvedProject)
    ? await probeLocalPort(resolvedProject.port)
    : {
        ok: false,
        error: 'no-web-target',
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
      };

  if (!probe.ok) {
    const logPort = detectPortFromProjectLogs(entry || historicalLogEntryForProject(resolvedProject));
    if (logPort && Number(logPort) !== Number(resolvedProject.port)) {
      const logProbe = await probeLocalPort(logPort);
      if (logProbe.ok) {
        resolvedProject = {
          ...resolvedProject,
          port: logPort,
        };
        probe = logProbe;
      }
    }
  }

  return {
    project: resolvedProject,
    entry,
    running,
    probe,
  };
}

function childWebTargetScore(target) {
  const relativePath = String(target.project.relativePath || '');
  const text = `${target.project.name || ''} ${relativePath}`.toLowerCase();
  const depth = relativePath ? relativePath.split('/').filter(Boolean).length : 0;
  let score = depth * 10;

  if (target.probe.ok) {
    score -= 1000;
  }
  if (target.running) {
    score -= 100;
  }
  if (/(^|[-_/])(home|web|app|frontend|site|demo)([-_/]|$)/.test(text)) {
    score -= 20;
  }

  return score;
}

function targetUrlsForProject(project, lanIp, tailscaleIp) {
  return {
    localUrl: buildUrl('127.0.0.1', project.port),
    lanUrl: buildUrl(lanIp, project.port),
    tailscaleUrl: buildUrl(tailscaleIp, project.port),
  };
}

async function resolveChildWebTargets(project, state, { lanIp, tailscaleIp }) {
  const branches = Array.isArray(project.branches) ? project.branches : [];
  const targets = [];

  for (const branch of branches) {
    if (!projectHasWebTarget(branch)) {
      continue;
    }

    const resolved = await resolveWebTargetProject(branch, state);
    targets.push({
      ...resolved,
      ...targetUrlsForProject(resolved.project, lanIp, tailscaleIp),
    });
  }

  return targets.sort((left, right) => {
    const score = childWebTargetScore(left) - childWebTargetScore(right);
    if (score !== 0) {
      return score;
    }
    return String(left.project.relativePath || left.project.path).localeCompare(String(right.project.relativePath || right.project.path));
  });
}

function routePathForChildTarget(target) {
  return normalizeUrlPath(target.project.relativePath || target.project.name || '/');
}

function childTargetRootPage(target) {
  const routePath = routePathForChildTarget(target);
  return {
    path: routePath,
    title: target.project.name || pageTitleFromPath(routePath),
    source: 'subproject',
    file: target.project.relativePath || '',
    pattern: false,
    localUrl: target.localUrl,
    lanUrl: target.lanUrl,
    tailscaleUrl: target.tailscaleUrl,
  };
}

function pageFromChildTarget(target, page) {
  const childPath = routePathForChildTarget(target);
  const suffix = page.path === '/' ? '' : page.path;
  const displayPath = normalizeUrlPath(`${childPath.replace(/\/$/, '')}${suffix}`);
  const file = [target.project.relativePath, page.file].filter(Boolean).join('/');
  return {
    ...page,
    path: displayPath,
    title: page.title || target.project.name || pageTitleFromPath(displayPath),
    source: page.source ? `${target.project.name}:${page.source}` : 'subproject',
    file,
    localUrl: page.pattern ? '' : buildPageUrl(target.localUrl, page.path),
    lanUrl: page.pattern ? '' : buildPageUrl(target.lanUrl, page.path),
    tailscaleUrl: page.pattern ? '' : buildPageUrl(target.tailscaleUrl, page.path),
  };
}

function derivedPagesFromChildTargets(targets, homeTarget) {
  const pagesByPath = new Map();

  const addPage = (page) => {
    const key = String(page.path || '').toLowerCase();
    if (!key || pagesByPath.has(key) || pagesByPath.size >= PAGE_SCAN_MAX_PAGES) {
      return;
    }
    pagesByPath.set(key, page);
  };

  for (const target of targets) {
    if (target !== homeTarget) {
      addPage(childTargetRootPage(target));
    }

    for (const page of discoverProjectPages(target.project)) {
      if (target === homeTarget && page.path === '/') {
        continue;
      }
      addPage(pageFromChildTarget(target, page));
    }
  }

  return [...pagesByPath.values()].slice(0, PAGE_SCAN_MAX_PAGES);
}

async function allocateAvailablePorts(projects, basePort) {
  const state = getState();
  const normalized = normalizeProjects(projects, basePort);
  const reservedPorts = new Set();

  for (const project of normalized) {
    if (!project.hasWebTarget) {
      continue;
    }

    const stateEntry = getStateEntryByPath(state, project.path);
    const stateOwnsPort =
      stateEntry &&
      Number(stateEntry.port) === Number(project.port) &&
      processIsRunning(stateEntry.pid);

    if (!reservedPorts.has(project.port) && (stateOwnsPort || (await canBindPort(project.port)))) {
      reservedPorts.add(project.port);
      continue;
    }

    project.port = await findAvailablePort(Math.max(project.port + 1, basePort), reservedPorts);
    reservedPorts.add(project.port);
  }

  return normalized;
}

function clearStaleStateForProjects(projects) {
  const state = getState();
  let changed = false;

  for (const project of projects) {
    const entry = getStateEntryByPath(state, project.path);
    if (!entry || processIsRunning(entry.pid)) {
      continue;
    }

    removeStateEntry(state, project.path);
    changed = true;
  }

  if (changed) {
    saveState(state);
  }
}

async function ensureProjectPort(project) {
  if (!projectCanStart(project)) {
    throw createHttpError(`${project.name} does not have a managed web dev command. Open its terminal to run project-specific commands.`, 400);
  }

  const portNumber = normalizePort(project.port);
  if (!portNumber) {
    throw createHttpError(`${project.name} does not have a web port configured.`, 400);
  }

  const stateEntry = getStateEntryByPath(getState(), project.path);
  const stateOwnsPort =
    stateEntry &&
    Number(stateEntry.port) === Number(portNumber) &&
    processIsRunning(stateEntry.pid);

  if (stateOwnsPort || (await canBindPort(portNumber))) {
    return project;
  }

  throw createHttpError(`Port ${portNumber} is already in use. Use restart to clean the old listener before starting ${project.name}.`, 409, {
    port: portNumber,
    owners: getListeningPortOwnerPids(portNumber),
  });
}

function getProjectByName(projects, name) {
  return projects.find((project) => project.name === name);
}

function getProjectByPath(projects, projectPath) {
  return projects.find((project) => normalizePath(project.path) === normalizePath(projectPath));
}

function getStateEntryByPath(state, projectPath) {
  return state.projects.find((entry) => normalizePath(entry.path) === normalizePath(projectPath));
}

function setStateEntry(state, entry) {
  state.projects = state.projects.filter((item) => normalizePath(item.path) !== normalizePath(entry.path));
  state.projects.push(entry);
}

function removeStateEntry(state, projectPath) {
  state.projects = state.projects.filter((item) => normalizePath(item.path) !== normalizePath(projectPath));
}

function processIsRunning(pid) {
  if (!pid || Number(pid) <= 0) {
    return false;
  }

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return false;
  }
}

function getNpmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function getNpmDevArgs(framework, projectPort, devScript = '') {
  const args = ['run', 'dev'];

  if (framework === 'next') {
    return [...args, '--', '-H', '0.0.0.0', '-p', String(projectPort)];
  }

  if (['vite', 'astro', 'nuxt'].includes(framework)) {
    if (framework === 'vite') {
      return [...args, '--', '--host', '0.0.0.0', '--port', String(projectPort), '--strictPort'];
    }

    return [...args, '--', '--host', '0.0.0.0', '--port', String(projectPort)];
  }

  const scriptedPort = detectPortFromDevScript(devScript);
  if (scriptedPort && Number(scriptedPort) !== Number(projectPort)) {
    return [...args, '--', '--host', '0.0.0.0', '--port', String(projectPort)];
  }

  return args;
}

function buildChildEnv(projectPort) {
  const env = {
    ...process.env,
    HOST: '0.0.0.0',
    HOSTNAME: '0.0.0.0',
    PORT: String(projectPort),
    BROWSER: 'none',
    NEXT_TELEMETRY_DISABLED: '1',
    VITE_HOST: '0.0.0.0',
    npm_config_host: '0.0.0.0',
  };

  if (process.platform === 'win32' && env.Path && env.PATH) {
    delete env.PATH;
  }

  return env;
}

function logPrefix(project) {
  const hash = crypto.createHash('sha1').update(project.path).digest('hex').slice(0, 8);
  return `${safeName(project.name)}-${hash}`;
}

function updateProjectEntry(project, patch) {
  const state = getState();
  const entry = getStateEntryByPath(state, project.path);
  if (!entry) {
    return null;
  }

  const nextEntry = { ...entry, ...patch };
  setStateEntry(state, nextEntry);
  saveState(state);
  return nextEntry;
}

async function startProject(project, options = {}) {
  if (!projectCanStart(project)) {
    throw createHttpError(`${project.name} does not have a managed web dev command. Open its terminal to run project-specific commands.`, 400);
  }

  const state = getState();
  const existing = getStateEntryByPath(state, project.path);
  if (existing && processIsRunning(existing.pid)) {
    if (options.tailscaleMode || options.lanMode) {
      return updateProjectEntry(project, {
        lanMode: Boolean(existing.lanMode || options.lanMode),
        lanIpAtStart: options.lanIp || existing.lanIpAtStart || null,
        tailscaleMode: Boolean(existing.tailscaleMode || options.tailscaleMode),
        tailscaleIpAtStart: options.tailscaleIp || existing.tailscaleIpAtStart || null,
      }) || existing;
    }

    return existing;
  }

  project = await ensureProjectPort(project);

  const npm = getNpmExecutable();
  const args = getNpmDevArgs(project.framework, project.port, project.devScript);
  const prefix = logPrefix(project);
  const stdoutPath = path.join(LOG_DIR, `${prefix}.out.log`);
  const stderrPath = path.join(LOG_DIR, `${prefix}.err.log`);
  const stdout = fs.createWriteStream(stdoutPath, { flags: 'a' });
  const stderr = fs.createWriteStream(stderrPath, { flags: 'a' });
  const heading = `\n\n[Agent Task Manager (ATM)] ${new Date().toISOString()} starting ${project.name} on port ${project.port}\n`;

  stdout.write(heading);
  stderr.write(heading);

  const child = spawn(npm, args, {
    cwd: project.path,
    env: buildChildEnv(project.port),
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  child.on('close', () => {
    stdout.end();
    stderr.end();
    childProcesses.delete(project.path);
  });
  childProcesses.set(project.path, child);

  const entry = {
    name: project.name,
    path: project.path,
    framework: project.framework,
    port: project.port,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    command: `${npm} ${args.join(' ')}`,
    stdout: stdoutPath,
    stderr: stderrPath,
    lanMode: Boolean(options.lanMode),
    lanIpAtStart: options.lanIp || null,
    tailscaleMode: Boolean(options.tailscaleMode),
    tailscaleIpAtStart: options.tailscaleIp || null,
    healthFailures: 0,
    lastHealthAt: null,
    lastHealthOk: null,
    lastHealthError: '',
    lastRestartAt: null,
    restartCount: 0,
  };

  removeStateEntry(state, project.path);
  setStateEntry(state, entry);
  saveState(state);
  return entry;
}

function stopProcessTree(pid) {
  return new Promise((resolve) => {
    if (!processIsRunning(pid)) {
      resolve();
      return;
    }

    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('close', () => resolve());
      killer.on('error', () => resolve());
      return;
    }

    try {
      process.kill(-Number(pid), 'SIGTERM');
    } catch (error) {
      try {
        process.kill(Number(pid), 'SIGTERM');
      } catch (innerError) {
        // Nothing else to do here; the next status poll will mark stale entries.
      }
    }
    resolve();
  });
}

async function stopListeningPortOwners(project) {
  const portNumber = normalizePort(project.port);
  if (!portNumber) {
    return { owners: [], released: true };
  }

  if (Number(portNumber) === Number(port)) {
    throw createHttpError('Refusing to clean the manager port.', 409, { port: portNumber });
  }

  const owners = getListeningPortOwnerPids(portNumber)
    .filter((pid) => Number(pid) !== Number(process.pid));

  for (const pid of owners) {
    await stopProcessTree(pid);
  }

  return {
    owners,
    released: await waitForPortAvailable(portNumber),
  };
}

async function stopProject(project) {
  const state = getState();
  const entry = getStateEntryByPath(state, project.path);
  if (entry?.pid) {
    await stopProcessTree(entry.pid);
  }
  removeStateEntry(state, project.path);
  saveState(state);
  return { stopped: true };
}

async function restartProject(project, options = {}) {
  if (!projectCanStart(project)) {
    throw createHttpError(`${project.name} does not have a managed web dev command. Open its terminal to run project-specific commands.`, 400);
  }

  const entry = getStateEntryByPath(getState(), project.path);
  const lanIp = options.lanIp || getLanIp();
  const tailscaleIp = options.tailscaleIp || getTailscaleIp();
  const lanMode = options.lanMode !== undefined ? options.lanMode : entry?.lanMode;
  const tailscaleMode = options.tailscaleMode !== undefined ? options.tailscaleMode : entry?.tailscaleMode;

  await stopProject(project);
  const cleanup = await stopListeningPortOwners(project);
  if (!cleanup.released) {
    throw createHttpError(`Port ${project.port} is still in use after cleanup.`, 409, {
      port: project.port,
      owners: getListeningPortOwnerPids(project.port),
      stoppedOwners: cleanup.owners,
    });
  }

  return startProject(project, {
    lanMode: Boolean(lanMode && lanIp),
    lanIp: lanMode ? lanIp : null,
    tailscaleMode: Boolean(tailscaleMode && tailscaleIp),
    tailscaleIp: tailscaleMode ? tailscaleIp : null,
  });
}

function buildTerminalEnv(project) {
  const env = { ...process.env };
  if (process.platform === 'win32' && env.Path && env.PATH) {
    delete env.PATH;
  }

  if (project) {
    const projectPort = normalizePort(project.port);
    if (projectPort) {
      env.PORT = String(projectPort);
      env.VITE_PORT = String(projectPort);
      env.DEV_DOCK_PROJECT_PORT = String(projectPort);
      env.DEV_DOCK_PROJECT_LOCAL_URL = buildUrl('127.0.0.1', projectPort);
    }
    env.DEV_DOCK_PROJECT_NAME = project.name;
    env.DEV_DOCK_PROJECT_PATH = project.path;
  }

  return env;
}

function normalizeTerminalClaudeText(value, limit = 160) {
  return String(value || '')
    .replace(/\0/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, limit);
}

function quoteTerminalClaudeArgument(value) {
  const text = normalizeTerminalClaudeText(value);
  if (!text) {
    return '';
  }
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) {
    return text;
  }
  return `"${text.replace(/(["\\])/g, '\\$1')}"`;
}

function normalizeTerminalClaudeModel(value) {
  const model = normalizeTerminalClaudeText(value);
  if (!model) {
    return '';
  }
  if (!/^[A-Za-z0-9_.:/=@+\-[\]]+$/.test(model)) {
    throw new Error('Claude model contains unsupported characters for remote launch.');
  }
  return model;
}

function normalizeTerminalClaudeEffortForLaunch(value) {
  const effort = normalizeTerminalClaudeText(value, 32).toLowerCase();
  if (!TERMINAL_CLAUDE_EFFORTS.has(effort)) {
    throw new Error('Claude effort is not supported for remote launch.');
  }
  return effort;
}

function normalizeTerminalClaudePermissionModeForLaunch(value) {
  const permissionMode = normalizeTerminalClaudeText(value || 'default', 64) || 'default';
  if (!TERMINAL_CLAUDE_PERMISSION_MODES.has(permissionMode)) {
    throw new Error('Claude permission mode is not supported for remote launch.');
  }
  return permissionMode;
}

function normalizeTerminalClaudeFlagForLaunch(value) {
  let flag = normalizeTerminalClaudeText(value, 120);
  if (!flag) {
    return '';
  }
  if (!flag.startsWith('-')) {
    flag = `--${flag}`;
  }
  if (!TERMINAL_REMOTE_CLAUDE_FLAGS.has(flag)) {
    throw new Error(`Claude flag is not allowed for remote launch: ${flag}`);
  }
  return flag;
}

function buildTerminalClaudeLaunchCommand(settings = {}) {
  const command = TERMINAL_CLAUDE_COMMANDS.has(settings.command)
    ? settings.command
    : 'claude';
  const model = normalizeTerminalClaudeModel(settings.model);
  const effort = normalizeTerminalClaudeEffortForLaunch(settings.effort);
  const permissionMode = normalizeTerminalClaudePermissionModeForLaunch(settings.permissionMode);
  const activeFlags = Array.isArray(settings.activeFlags)
    ? settings.activeFlags
    : [];
  const flags = [];
  const flagKeys = new Set();
  activeFlags.forEach((item) => {
    const flag = normalizeTerminalClaudeFlagForLaunch(item);
    if (flag && !flagKeys.has(flag)) {
      flagKeys.add(flag);
      flags.push(flag);
    }
  });

  const parts = [command];
  if (model) {
    parts.push('--model', quoteTerminalClaudeArgument(model));
  }
  if (effort) {
    parts.push('--effort', quoteTerminalClaudeArgument(effort));
  }
  parts.push('--permission-mode', permissionMode);
  parts.push(...flags);
  return parts.join(' ');
}

function normalizeTerminalCodexModelForLaunch(value) {
  const model = normalizeTerminalClaudeText(value);
  if (!model) {
    return '';
  }
  if (!/^[A-Za-z0-9_.:/=@+\-[\]]+$/.test(model)) {
    throw new Error('Codex model contains unsupported characters for remote launch.');
  }
  return model;
}

function normalizeTerminalCodexSandboxForLaunch(value) {
  const sandbox = normalizeTerminalClaudeText(value, 32);
  if (!TERMINAL_CODEX_SANDBOXES.has(sandbox)) {
    throw new Error('Codex sandbox mode is not supported for remote launch.');
  }
  return sandbox;
}

function normalizeTerminalCodexApprovalForLaunch(value) {
  const approval = normalizeTerminalClaudeText(value, 32);
  if (!TERMINAL_CODEX_APPROVALS.has(approval)) {
    throw new Error('Codex approval mode is not supported for remote launch.');
  }
  return approval;
}

function normalizeTerminalCodexFlagForLaunch(value) {
  let flag = normalizeTerminalClaudeText(value, 120);
  if (!flag) {
    return '';
  }
  if (!flag.startsWith('-')) {
    flag = `--${flag}`;
  }
  if (!TERMINAL_REMOTE_CODEX_FLAGS.has(flag)) {
    throw new Error(`Codex flag is not allowed for remote launch: ${flag}`);
  }
  return flag;
}

function buildTerminalCodexLaunchCommand(settings = {}) {
  const command = TERMINAL_CODEX_COMMANDS.has(settings.command)
    ? settings.command
    : 'codex';
  const model = normalizeTerminalCodexModelForLaunch(settings.model);
  const sandbox = normalizeTerminalCodexSandboxForLaunch(settings.sandbox);
  const approval = normalizeTerminalCodexApprovalForLaunch(settings.approval);
  const activeFlags = [
    ...(Array.isArray(settings.activeFlags) ? settings.activeFlags : []),
    ...(settings.search === true ? ['--search'] : []),
  ];
  const flags = [];
  const flagKeys = new Set();
  activeFlags.forEach((item) => {
    const flag = normalizeTerminalCodexFlagForLaunch(item);
    if (flag && !flagKeys.has(flag)) {
      flagKeys.add(flag);
      flags.push(flag);
    }
  });
  const parts = [command];

  if (model) {
    parts.push('--model', quoteTerminalClaudeArgument(model));
  }
  if (sandbox) {
    parts.push('--sandbox', sandbox);
  }
  if (approval) {
    parts.push('--ask-for-approval', approval);
  }
  parts.push(...flags);

  return parts.join(' ');
}

function normalizeTerminalAntigravityFlagForLaunch(value) {
  let flag = normalizeTerminalClaudeText(value, 120);
  if (!flag) {
    return '';
  }
  if (!flag.startsWith('-')) {
    flag = `--${flag}`;
  }
  if (!TERMINAL_REMOTE_ANTIGRAVITY_FLAGS.has(flag)) {
    throw new Error(`Antigravity flag is not allowed for remote launch: ${flag}`);
  }
  return flag;
}

function buildTerminalAntigravityLaunchCommand(settings = {}) {
  const command = TERMINAL_ANTIGRAVITY_COMMANDS.has(settings.command)
    ? settings.command
    : 'agy';
  const activeFlags = Array.isArray(settings.activeFlags)
    ? settings.activeFlags
    : [];
  const flags = [];
  const flagKeys = new Set();
  activeFlags.forEach((item) => {
    const flag = normalizeTerminalAntigravityFlagForLaunch(item);
    if (flag && !flagKeys.has(flag)) {
      flagKeys.add(flag);
      flags.push(flag);
    }
  });

  return [command, ...flags].join(' ');
}

function buildTerminalAgentLaunchCommand(agent, settings = {}) {
  const agentId = normalizeTerminalClaudeText(agent, 32).toLowerCase();
  if (agentId === 'claude') {
    return buildTerminalClaudeLaunchCommand(settings);
  }
  if (agentId === 'codex') {
    return buildTerminalCodexLaunchCommand(settings);
  }
  if (agentId === 'antigravity') {
    return buildTerminalAntigravityLaunchCommand(settings);
  }
  throw new Error('Terminal agent is not supported for remote launch.');
}

function findExecutable(command) {
  if (!command) {
    return null;
  }

  if (path.isAbsolute(command)) {
    return fs.existsSync(command) ? command : null;
  }

  const pathValue = process.env.Path || process.env.PATH || '';
  const pathDirs = pathValue.split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  const hasExtension = Boolean(path.extname(command));

  for (const dirPath of pathDirs) {
    const candidates = hasExtension
      ? [path.join(dirPath, command)]
      : extensions.map((extension) => path.join(dirPath, `${command}${extension.toLowerCase()}`));
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function buildAiQuotaProbeEnv() {
  const env = { ...process.env };
  if (process.platform === 'win32' && env.Path && env.PATH) {
    delete env.PATH;
  }

  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  env.NO_BROWSER = '1';
  env.ATM_AI_QUOTA_PROBE = '1';

  return env;
}

function quoteWindowsCommandArg(value) {
  const text = String(value || '');
  if (!text) {
    return '""';
  }
  if (!/[\s"&|<>^]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '\\"')}"`;
}

function buildSpawnCommand(executable, args = []) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', [quoteWindowsCommandArg(executable), ...args.map(quoteWindowsCommandArg)].join(' ')],
    };
  }

  return { command: executable, args };
}

function localAppDataPath(...segments) {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, ...segments);
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

function aiQuotaExecutableCandidates(agent) {
  if (agent.id === 'codex') {
    return [
      localAppDataPath('OpenAI', 'Codex', 'bin', 'codex.exe'),
      ...safeReadDir(localAppDataPath('OpenAI', 'Codex', 'bin'))
        .filter((name) => /^[a-f0-9]{16}$/i.test(name))
        .map((name) => localAppDataPath('OpenAI', 'Codex', 'bin', name, 'codex.exe')),
    ];
  }

  if (agent.id === 'antigravity') {
    return [
      localAppDataPath('agy', 'bin', 'agy.exe'),
      localAppDataPath('Programs', 'Antigravity', 'bin', 'agy.exe'),
      localAppDataPath('Programs', 'Antigravity', 'resources', 'app', 'bin', 'agy.exe'),
    ];
  }

  return [];
}

function resolveAiQuotaExecutable(agent) {
  const candidates = [
    ...aiQuotaExecutableCandidates(agent),
    findExecutable(agent.command),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function killAiQuotaProcess(proc) {
  const pid = Number(proc?.pid);
  try {
    proc?.kill?.();
  } catch {
    // The process may already be gone.
  }
  if (process.platform === 'win32' && pid) {
    try {
      spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      }).once('error', () => {});
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function appendAiQuotaOutput(current, chunk) {
  const next = `${current || ''}${String(chunk || '')}`;
  if (next.length <= AI_QUOTA_OUTPUT_LIMIT) {
    return next;
  }
  return next.slice(next.length - AI_QUOTA_OUTPUT_LIMIT);
}

function stripAnsi(text) {
  return String(text || '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[PX^_].*?\u001b\\/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function cleanAiQuotaText(text) {
  return stripAnsi(text)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function quotaLineRelevant(line) {
  return /(usage|quota|limit|used|remaining|left|available|token|context|window|weekly|daily|5\s*-?\s*h|rate|credit|plan|design|other|model|models|spark|opus|sonnet|haiku|gemini|gpt|用量|配額|限制|剩餘|可用|每週|週|重置|百分|模型|設計|其他)/i.test(line);
}

function clampQuotaPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(number * 10) / 10));
}

function quotaPercentText(percent, direction = 'used') {
  const value = clampQuotaPercent(percent);
  if (value === null) {
    return '--%';
  }
  const rounded = Math.round(value);
  if (direction === 'remaining') {
    return `${rounded}% 剩餘`;
  }
  return `${rounded}% 已用`;
}

function quotaContextFromLine(line) {
  const normalized = String(line || '')
    .replace(/[│╭╰╯─]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || /\d{1,3}(?:\.\d+)?\s*%/.test(normalized)) {
    return '';
  }
  const limitMatch = normalized.match(/\b((?:gpt|claude|gemini|codex|openai)[a-z0-9 ._+()/-]*?)\s+limit\s*:?\s*$/i);
  if (limitMatch) {
    return `${limitMatch[1].trim()} limit`;
  }
  if (normalized.length <= 96 && /(design|other|all models|model quota|current week|weekly|spark|opus|sonnet|haiku|gemini|gpt|模型|設計|其他)/i.test(normalized)) {
    return normalized;
  }
  return '';
}

function extractQuotaSignals(text) {
  const lines = cleanAiQuotaText(text).split('\n').filter(Boolean);
  const signals = [];
  const seen = new Set();
  let context = '';

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const nextContext = quotaContextFromLine(line);
    if (nextContext) {
      context = nextContext;
    }

    if (/(nothing over|nothing above|less than|under \d{1,3}(?:\.\d+)?\s*%|try the other window)/i.test(line)) {
      continue;
    }

    const relevant = quotaLineRelevant(line);
    const percentMatches = [...line.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)];
    if (percentMatches.length) {
      for (const match of percentMatches) {
        const rawPercent = clampQuotaPercent(match[1]);
        if (rawPercent === null) {
          continue;
        }
        const nearby = `${lines[lineIndex - 1] || ''} ${line} ${lines[lineIndex + 1] || ''}`;
        const explicitlyUsed = /(used|已用)/i.test(line);
        const remaining = !explicitlyUsed && /(remaining|left|available|quota available|剩餘|可用)/i.test(nearby);
        const percent = remaining ? clampQuotaPercent(100 - rawPercent) : rawPercent;
        const labelText = context && /(weekly|daily|5\s*-?\s*h|limit|quota|remaining|left|available|剩餘|可用)/i.test(line)
          ? `${context} · ${line}`
          : line;
        const label = labelText.slice(0, 220);
        const key = `${label}:${percent}`;
        if ((relevant || signals.length < 3) && !seen.has(key)) {
          seen.add(key);
          signals.push({
            label,
            percent,
            rawPercent,
            displayPercent: remaining ? rawPercent : percent,
            percentLabel: quotaPercentText(remaining ? rawPercent : percent, remaining ? 'remaining' : 'used'),
            direction: remaining ? 'remaining' : 'used',
            context,
          });
        }
      }
    }

    if (!relevant) {
      continue;
    }

    const ratioMatches = [...line.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:\/|of)\s*(\d[\d,]*(?:\.\d+)?)/gi)];
    for (const match of ratioMatches) {
      const used = Number(String(match[1]).replace(/,/g, ''));
      const total = Number(String(match[2]).replace(/,/g, ''));
      if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
        continue;
      }
      const percent = clampQuotaPercent((used / total) * 100);
      const labelText = context ? `${context} · ${line}` : line;
      const label = labelText.slice(0, 220);
      const key = `${label}:${percent}`;
      if (percent !== null && !seen.has(key)) {
        seen.add(key);
        signals.push({
          label,
          percent,
          rawPercent: percent,
          displayPercent: percent,
          percentLabel: quotaPercentText(percent, 'used'),
          direction: 'used',
          context,
        });
      }
    }
  }

  return signals;
}

function quotaSignalScore(signal, index) {
  const label = String(signal?.label || '');
  let score = 100;
  if (/(quota|limit|rate|credit|plan|usage|used|remaining|5\s*-?\s*h|weekly|daily|配額|限制|用量|剩餘|每週|週)/i.test(label)) {
    score += 80;
  }
  if (/(model quota|weekly|week|5\s*h|5\s*-?\s*hour|resets|left|available|可用)/i.test(label)) {
    score += 70;
  }
  if (/(current session|session|total cost|total duration|code changes|stats)/i.test(label)) {
    score -= 90;
  }
  if (/(token|context)/i.test(label)) {
    score += 20;
  }
  if (/(debug|version|update)/i.test(label)) {
    score -= 30;
  }
  return score;
}

function rankedQuotaSignals(signals) {
  return signals
    .map((signal, index) => ({ signal, index, score: quotaSignalScore(signal, index) }))
    .sort((a, b) => (b.score - a.score) || (b.index - a.index));
}

function chooseQuotaSignal(signals) {
  const remainingSignals = signals
    .map((signal, index) => ({ signal, index }))
    .filter((item) => item.signal.direction === 'remaining')
    .sort((a, b) => (Number(a.signal.rawPercent) - Number(b.signal.rawPercent)) || (b.index - a.index));
  if (remainingSignals.length) {
    return remainingSignals[0].signal;
  }

  return rankedQuotaSignals(signals)[0]?.signal || null;
}

function quotaSignalGroupKey(signal) {
  const label = String(signal?.label || '').toLowerCase();
  const context = String(signal?.context || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (/(weekly|current week|\bweek\b|每週|週)/i.test(label)) {
    return `${context}:weekly-limit`;
  }
  if (/(5\s*h|5\s*-?\s*hour|5h limit)/i.test(label)) {
    return `${context}:5h-limit`;
  }
  if (/(current session|session)/i.test(label)) {
    return `${context}:session`;
  }
  return `${context}:${label
    .replace(/\d{1,3}(?:\.\d+)?\s*%/g, '')
    .replace(/[█▌▐▍▎▏░▒▓|[\](){}:·.,-]/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || `signal-${signal?.direction || 'used'}`}`;
}

function displayQuotaSignals(signals, primary) {
  const latestByGroup = new Map();
  signals.forEach((signal, index) => {
    const key = quotaSignalGroupKey(signal);
    const previous = latestByGroup.get(key);
    if (!previous || index > previous.index) {
      latestByGroup.set(key, { signal, index });
    }
  });

  const deduped = [...latestByGroup.values()]
    .sort((a, b) => (quotaSignalScore(b.signal, b.index) - quotaSignalScore(a.signal, a.index)) || (b.index - a.index))
    .map((item) => item.signal);
  if (!primary) {
    return deduped;
  }

  const primaryKey = quotaSignalGroupKey(primary);
  return [
    primary,
    ...deduped.filter((signal) => quotaSignalGroupKey(signal) !== primaryKey),
  ];
}

function summarizeQuotaOutput(text, signals) {
  if (signals.length) {
    return chooseQuotaSignal(signals)?.label || signals[0].label;
  }

  const lines = cleanAiQuotaText(text)
    .split('\n')
    .filter((line) => quotaLineRelevant(line) || /(login|auth|sign in|error|failed|not found|not recognized|未登入|登入)/i.test(line));

  return lines.slice(0, 2).join(' / ') || 'No usage percentage was found in the CLI output.';
}

function isQuotaAuthFailure(text) {
  return /(not logged in|not authenticated|unauthenticated|sign in|login required|no saved session|please log in|please login|未登入|需要登入)/i.test(text);
}

function isQuotaCommandUnsupported(text) {
  return /(unknown command|unrecognized command|invalid command|unknown subcommand|not a recognized|unexpected argument|not found)/i.test(text);
}

function isQuotaTtyRequired(text) {
  return /(stdin is not a terminal|not a terminal|requires a tty|requires an interactive terminal|input device is not a tty|The handle is invalid|timed out)/i.test(text);
}

function runAiQuotaFileCommand(executable, args, timeoutMs = AI_QUOTA_AUTH_TIMEOUT_MS, signal = null) {
  return new Promise((resolve) => {
    const spawnTarget = buildSpawnCommand(executable, args);
    let output = '';
    let settled = false;
    let timedOut = false;
    const startedAt = Date.now();
    let child = null;
    let timer = null;
    const abortHandler = () => {
      killAiQuotaProcess(child);
      finish({ ok: false, exitCode: null, canceled: true, error: 'Canceled.' });
    };
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abortHandler);
      resolve({
        output: cleanAiQuotaText(output),
        elapsedMs: Date.now() - startedAt,
        timedOut,
        pty: false,
        ...result,
      });
    };
    if (signal?.aborted) {
      finish({ ok: false, exitCode: null, canceled: true, error: 'Canceled.' });
      return;
    }
    signal?.addEventListener?.('abort', abortHandler, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      killAiQuotaProcess(child);
      finish({ ok: false, exitCode: null, error: 'Timed out.' });
    }, timeoutMs);

    try {
      child = spawn(spawnTarget.command, spawnTarget.args, {
        cwd: ROOT_DIR,
        env: buildAiQuotaProbeEnv(),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      finish({ ok: false, exitCode: null, error: error.message });
      return;
    }
    if (settled) {
      killAiQuotaProcess(child);
      return;
    }

    child.stdout?.on('data', (chunk) => {
      output = appendAiQuotaOutput(output, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output = appendAiQuotaOutput(output, chunk);
    });
    child.once('error', (error) => {
      finish({ ok: false, exitCode: null, error: error.message });
    });
    child.once('close', (code, signal) => {
      finish({ ok: code === 0, exitCode: code, signal });
    });
  });
}

function runAiQuotaPipeProbe(agent, executable, signal = null) {
  return new Promise((resolve) => {
    const spawnTarget = buildSpawnCommand(executable, []);
    let output = '';
    let settled = false;
    let timedOut = false;
    const startedAt = Date.now();
    const timers = [];
    let proc = null;
    let timeoutTimer = null;
    const abortHandler = () => {
      killAiQuotaProcess(proc);
      finish({ ok: false, exitCode: null, canceled: true, error: 'Canceled.' });
    };
    const finish = (result = {}) => {
      if (settled) {
        return;
      }
      settled = true;
      timers.forEach((timer) => clearTimeout(timer));
      clearTimeout(timeoutTimer);
      signal?.removeEventListener?.('abort', abortHandler);
      if (!result.closed) {
        killAiQuotaProcess(proc);
      }
      resolve({
        output: cleanAiQuotaText(output),
        elapsedMs: Date.now() - startedAt,
        timedOut,
        pty: false,
        ...result,
      });
    };
    const writeInput = (text) => {
      try {
        if (proc?.write) {
          proc.write(text);
        } else if (proc?.stdin?.writable) {
          proc.stdin.write(text);
        }
      } catch {
        // Probe output will report the failure or timeout.
      }
    };
    if (signal?.aborted) {
      finish({ ok: false, exitCode: null, canceled: true, error: 'Canceled.' });
      return;
    }
    signal?.addEventListener?.('abort', abortHandler, { once: true });
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      killAiQuotaProcess(proc);
      finish({ ok: false, exitCode: null, error: 'Timed out.' });
    }, AI_QUOTA_PROBE_TIMEOUT_MS);

    try {
      proc = spawn(spawnTarget.command, spawnTarget.args, {
        cwd: ROOT_DIR,
        env: buildAiQuotaProbeEnv(),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      proc.stdout?.on('data', (chunk) => {
        output = appendAiQuotaOutput(output, chunk);
      });
      proc.stderr?.on('data', (chunk) => {
        output = appendAiQuotaOutput(output, chunk);
      });
      proc.once('error', (error) => {
        finish({ ok: false, exitCode: null, error: error.message });
      });
      proc.once('close', (code, signal) => {
        finish({ ok: code === 0 || !timedOut, exitCode: code, signal, closed: true });
      });
    } catch (error) {
      finish({ ok: false, exitCode: null, error: error.message });
      return;
    }
    if (settled) {
      killAiQuotaProcess(proc);
      return;
    }

    (agent.interactiveCommands || []).forEach((command, index) => {
      timers.push(setTimeout(() => writeInput(`${command}\r`), 1400 + index * 2500));
    });
    timers.push(setTimeout(() => writeInput(`${agent.exitCommand || '/exit'}\r`), 7200));
    timers.push(setTimeout(() => finish({ ok: true, exitCode: null }), 9200));
  });
}

function quotePosixShellArgument(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function getAiQuotaPtyShell() {
  if (process.platform !== 'win32') {
    return {
      command: process.env.SHELL || '/bin/sh',
      args: ['-i'],
      kind: 'posix',
      lineEnding: '\n',
    };
  }

  const powershell = findExecutable('powershell.exe');
  if (powershell) {
    return {
      command: powershell,
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', 'try { Set-PSReadLineOption -HistorySaveStyle SaveNothing } catch {}'],
      kind: 'powershell',
      lineEnding: '\r',
    };
  }

  const pwsh = findExecutable('pwsh.exe');
  if (pwsh) {
    return {
      command: pwsh,
      args: ['-NoLogo', '-NoProfile', '-NoExit', '-Command', 'try { Set-PSReadLineOption -HistorySaveStyle SaveNothing } catch {}'],
      kind: 'powershell',
      lineEnding: '\r',
    };
  }

  return {
    command: findExecutable('cmd.exe') || 'cmd.exe',
    args: ['/Q'],
    kind: 'cmd',
    lineEnding: '\r',
  };
}

function buildAiQuotaPtyLaunchCommand(executable, shell) {
  if (shell.kind === 'powershell') {
    return `& ${quotePowerShellArgument(executable)}`;
  }
  if (shell.kind === 'cmd') {
    return quoteWindowsCommandArg(executable);
  }
  return quotePosixShellArgument(executable);
}

function killAiQuotaPty(terminalProcess) {
  if (process.platform === 'win32') {
    const pid = Number(terminalProcess?.pid);
    if (pid) {
      try {
        spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        }).once('error', () => {});
      } catch {
        // Best-effort cleanup only.
      }
    }
    return;
  }

  try {
    terminalProcess?.kill?.();
  } catch {
    // The PTY may already be closed.
  }
}

function runAiQuotaInteractiveProbe(agent, executable, signal = null) {
  if (!pty) {
    return runAiQuotaPipeProbe(agent, executable, signal);
  }

  return new Promise((resolve) => {
    const shell = getAiQuotaPtyShell();
    const launchCommand = buildAiQuotaPtyLaunchCommand(executable, shell);
    let output = '';
    let settled = false;
    let timedOut = false;
    let slashSentAt = 0;
    const startedAt = Date.now();
    const timers = [];
    let watchTimer = null;
    let timeoutTimer = null;
    let terminalProcess = null;

    const abortHandler = () => {
      finish({ ok: false, exitCode: null, canceled: true, error: 'Canceled.' });
    };
    const finish = (result = {}) => {
      if (settled) {
        return;
      }
      settled = true;
      timers.forEach((timer) => clearTimeout(timer));
      clearInterval(watchTimer);
      clearTimeout(timeoutTimer);
      signal?.removeEventListener?.('abort', abortHandler);
      if (!result.closed) {
        killAiQuotaPty(terminalProcess);
      }
      resolve({
        output: cleanAiQuotaText(output),
        elapsedMs: Date.now() - startedAt,
        timedOut,
        pty: true,
        ...result,
      });
    };
    const writeRaw = (text) => {
      try {
        terminalProcess?.write?.(text);
      } catch {
        // Probe output or timeout will report the failure.
      }
    };
    const writeLine = (text) => writeRaw(`${text}${shell.lineEnding}`);
    const maybeFinishWithSignal = () => {
      const minCollectDelay = Math.max(1800, Number(agent.minSignalCollectDelayMs) || 1800);
      if (!slashSentAt || Date.now() - slashSentAt < minCollectDelay) {
        return;
      }
      const primary = chooseQuotaSignal(extractQuotaSignals(output));
      if (primary) {
        finish({ ok: true, exitCode: null });
      }
    };

    if (signal?.aborted) {
      finish({ ok: false, exitCode: null, canceled: true, error: 'Canceled.' });
      return;
    }
    signal?.addEventListener?.('abort', abortHandler, { once: true });
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      finish({ ok: false, exitCode: null, error: 'Timed out.' });
    }, AI_QUOTA_PTY_PROBE_TIMEOUT_MS);

    try {
      terminalProcess = pty.spawn(shell.command, shell.args, {
        name: 'xterm-256color',
        cols: 100,
        rows: 28,
        cwd: ROOT_DIR,
        env: buildAiQuotaProbeEnv(),
        useConpty: process.platform === 'win32',
      });
      terminalProcess.onData((chunk) => {
        output = appendAiQuotaOutput(output, chunk);
        maybeFinishWithSignal();
      });
      terminalProcess.onExit((event) => {
        finish({ ok: !timedOut, exitCode: event?.exitCode ?? null, signal: event?.signal, closed: true });
      });
    } catch (error) {
      finish({ ok: false, exitCode: null, error: error.message });
      return;
    }

    timers.push(setTimeout(() => writeLine(launchCommand), 700));
    const startupDelay = Math.max(1000, Number(agent.ptyStartupDelayMs) || 7000);
    const settleDelay = Math.max(3000, Number(agent.ptySettleDelayMs) || 9000);
    const commandStartDelay = 700 + startupDelay;

    (agent.interactiveCommands || []).forEach((command, index) => {
      const commandDelay = commandStartDelay + index * 1800;
      timers.push(setTimeout(() => {
        slashSentAt = Date.now();
        writeLine(command);
        if (agent.confirmInteractiveCommand) {
          timers.push(setTimeout(() => writeRaw(shell.lineEnding), 900));
        }
      }, commandDelay));
    });

    watchTimer = setInterval(maybeFinishWithSignal, 700);
    timers.push(setTimeout(() => finish({ ok: true, exitCode: null }), commandStartDelay + settleDelay));
  });
}

function canceledAiQuotaAgent(agent) {
  return {
    id: agent.id,
    label: agent.label,
    provider: agent.provider,
    status: 'canceled',
    percent: null,
    percentLabel: '--%',
    probe: agent.probe,
    summary: 'Quota monitor was stopped.',
    signals: [],
    checkedAt: new Date().toISOString(),
  };
}

async function probeAiQuotaAgent(agent, signal = null) {
  const checkedAt = new Date().toISOString();
  if (signal?.aborted) {
    return canceledAiQuotaAgent(agent);
  }

  const executable = resolveAiQuotaExecutable(agent);
  if (!executable) {
    return {
      id: agent.id,
      label: agent.label,
      provider: agent.provider,
      status: 'missing',
      percent: null,
      percentLabel: '--%',
      probe: agent.probe,
      summary: `${agent.command} was not found on PATH.`,
      signals: [],
      checkedAt,
    };
  }

  const attempts = [];
  const authCommands = [
    agent.authCommand,
    ...(Array.isArray(agent.authCommands) ? agent.authCommands : []),
  ].filter(Boolean);

  for (const authCommand of authCommands) {
    const result = await runAiQuotaFileCommand(executable, authCommand.args, AI_QUOTA_AUTH_TIMEOUT_MS, signal);
    if (result.canceled || signal?.aborted) {
      return canceledAiQuotaAgent(agent);
    }
    attempts.push({ label: authCommand.label, ...result });
    if (isQuotaAuthFailure(result.output)) {
      return {
        id: agent.id,
        label: agent.label,
        provider: agent.provider,
        status: 'auth',
        percent: null,
        percentLabel: '--%',
        probe: agent.probe,
        summary: summarizeQuotaOutput(result.output, []),
        signals: [],
        checkedAt,
      };
    }
    if (result.ok || !isQuotaCommandUnsupported(result.output)) {
      break;
    }
  }

  const interactiveResult = await runAiQuotaInteractiveProbe(agent, executable, signal);
  if (interactiveResult.canceled || signal?.aborted) {
    return canceledAiQuotaAgent(agent);
  }
  attempts.push({ label: (agent.interactiveCommands || []).join(', '), ...interactiveResult });
  const combinedOutput = attempts.map((attempt) => attempt.output).filter(Boolean).join('\n');
  const signals = extractQuotaSignals(combinedOutput);
  const primary = chooseQuotaSignal(signals);
  const visibleSignals = displayQuotaSignals(signals, primary);
  const hasAuthFailure = isQuotaAuthFailure(combinedOutput);
  const slashProbeAttempted = (agent.interactiveCommands || []).length > 0;
  const usedPty = Boolean(interactiveResult.pty);
  const needsTty = isQuotaTtyRequired(combinedOutput)
    || (!primary && !hasAuthFailure && !usedPty && slashProbeAttempted);
  const status = primary
    ? 'ok'
    : hasAuthFailure
      ? 'auth'
      : interactiveResult.timedOut
        ? 'timeout'
        : needsTty
          ? 'tty'
          : attempts.some((attempt) => attempt.ok)
            ? 'unknown'
            : 'error';

  return {
    id: agent.id,
    label: agent.label,
    provider: agent.provider,
    status,
    percent: primary ? (primary.displayPercent ?? primary.percent) : null,
    usedPercent: primary?.percent ?? null,
    direction: primary?.direction || 'used',
    percentLabel: primary ? (primary.percentLabel || quotaPercentText(primary.displayPercent ?? primary.percent, primary.direction)) : '--%',
    probe: agent.probe,
    summary: status === 'timeout'
      ? '配額 slash 指令逾時，已中斷監控終端。'
      : needsTty
        ? '此 CLI 的配額 slash 指令需要互動式終端才會輸出百分比；安全非 prompt 查詢未取得百分比。'
        : summarizeQuotaOutput(combinedOutput, signals),
    signals: visibleSignals.slice(0, 4).map((signal) => ({
      label: signal.label,
      percent: signal.displayPercent ?? signal.percent,
      usedPercent: signal.percent,
      percentLabel: signal.percentLabel || quotaPercentText(signal.displayPercent ?? signal.percent, signal.direction),
      direction: signal.direction,
    })),
    checkedAt,
    elapsedMs: attempts.reduce((total, attempt) => total + Number(attempt.elapsedMs || 0), 0),
  };
}

async function collectAiQuotaPayload(signal = null) {
  const agents = await Promise.all(AI_QUOTA_AGENTS.map((agent) => probeAiQuotaAgent(agent, signal)));
  return {
    checkedAt: new Date().toISOString(),
    safeMode: {
      tokenSafe: true,
      summary: '安全模式：只執行登入/狀態查詢與 CLI slash 指令，沒有送出自然語言 prompt。',
    },
    agents,
  };
}

async function getAiQuotaPayload() {
  if (!aiQuotaProbeInFlight) {
    const controller = new AbortController();
    const probe = { controller, promise: null };
    probe.promise = collectAiQuotaPayload(controller.signal).finally(() => {
      if (aiQuotaProbeInFlight === probe) {
        aiQuotaProbeInFlight = null;
      }
    });
    aiQuotaProbeInFlight = probe;
  }
  return aiQuotaProbeInFlight.promise;
}

function cancelAiQuotaPayload() {
  if (!aiQuotaProbeInFlight) {
    return false;
  }

  try {
    aiQuotaProbeInFlight.controller?.abort();
  } catch {
    // Already stopped.
  }

  return true;
}

function findGitBashExecutable() {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
    findExecutable('bash.exe'),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function readableTextScore(text) {
  return (String(text).match(/[A-Za-z0-9_.\-\s]/g) || []).length - (String(text).match(/\uFFFD/g) || []).length * 10;
}

function getWslDistros() {
  if (process.platform !== 'win32' || !findExecutable('wsl.exe')) {
    return [];
  }

  try {
    const buffer = execFileSync('wsl.exe', ['-l', '-q'], {
      timeout: 1800,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const utf8 = buffer.toString('utf8').replace(/\0/g, '');
    const utf16 = buffer.toString('utf16le').replace(/\0/g, '');
    const text = readableTextScore(utf16) > readableTextScore(utf8) ? utf16 : utf8;
    return [...new Set(text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/windows subsystem/i.test(line)))]
      .slice(0, 12);
  } catch (error) {
    return [];
  }
}

function getTerminalShellCatalog() {
  if (process.platform !== 'win32') {
    return [{
      id: 'system',
      label: path.basename(process.env.SHELL || '/bin/sh'),
      command: process.env.SHELL || '/bin/sh',
      args: ['-i'],
    }];
  }

  const shells = [];
  if (findExecutable('powershell.exe')) {
    shells.push({
      id: 'powershell',
      label: 'PowerShell',
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', 'try { Set-PSReadLineOption -HistorySaveStyle SaveNothing } catch {}'],
    });
  }
  if (findExecutable('pwsh.exe')) {
    shells.push({
      id: 'pwsh',
      label: 'PowerShell 7',
      command: 'pwsh.exe',
      args: ['-NoLogo', '-NoProfile', '-NoExit', '-Command', 'try { Set-PSReadLineOption -HistorySaveStyle SaveNothing } catch {}'],
    });
  }
  if (findExecutable('cmd.exe')) {
    shells.push({
      id: 'cmd',
      label: 'cmd',
      command: 'cmd.exe',
      args: ['/Q'],
    });
  }

  const gitBashPath = findGitBashExecutable();
  if (gitBashPath) {
    shells.push({
      id: 'git-bash',
      label: 'Git Bash',
      command: gitBashPath,
      args: ['--noprofile', '--norc', '-i'],
    });
  }

  for (const distro of getWslDistros()) {
    shells.push({
      id: `wsl:${distro}`,
      label: `${distro} WSL`,
      command: 'wsl.exe',
      args: ['-d', distro],
      distro,
      kind: 'wsl',
    });
  }

  return shells.length ? shells : [{
    id: 'powershell',
    label: 'PowerShell',
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', 'try { Set-PSReadLineOption -HistorySaveStyle SaveNothing } catch {}'],
  }];
}

function windowsPathToWslPath(inputPath) {
  const match = String(inputPath || '').match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) {
    return null;
  }

  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

function resolveTerminalShell(shellId, cwd) {
  const shells = getTerminalShellCatalog();
  const selected = shells.find((shell) => shell.id === shellId) || shells[0];
  if (selected.kind === 'wsl') {
    const wslCwd = windowsPathToWslPath(cwd);
    return {
      ...selected,
      args: wslCwd ? [...selected.args, '--cd', wslCwd] : selected.args,
    };
  }

  return selected;
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(normalizePath(parentPath), normalizePath(childPath));
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveTerminalCwd(project, requestedCwd) {
  const projectRoot = normalizePath(project.path);
  const candidate = requestedCwd
    ? path.resolve(projectRoot, String(requestedCwd))
    : projectRoot;

  if (!isPathInside(projectRoot, candidate)) {
    throw new Error('Terminal working directory must stay inside the selected project.');
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error('Terminal working directory does not exist.');
  }

  return candidate;
}

function hasTerminalDirectoryChildren(projectRoot, dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .some((entry) => {
        if (!entry.isDirectory()) {
          return false;
        }

        const childPath = path.join(dirPath, entry.name);
        return !shouldIgnore(childPath) && isPathInside(projectRoot, childPath);
      });
  } catch (error) {
    return false;
  }
}

function terminalDirectoryNode(projectRoot, dirPath, label) {
  const relativePath = path.relative(projectRoot, dirPath).replace(/\\/g, '/');
  return {
    path: dirPath,
    relativePath,
    label: label || relativePath || '專案根目錄',
    hasChildren: hasTerminalDirectoryChildren(projectRoot, dirPath),
  };
}

function getTerminalDirectoryChildren(project, relativePath = '') {
  const projectRoot = normalizePath(project.path);
  const dirPath = resolveTerminalCwd(project, relativePath);

  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    entries = [];
  }

  const children = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => path.join(dirPath, entry.name))
    .filter((childPath) => !shouldIgnore(childPath) && isPathInside(projectRoot, childPath))
    .map((childPath) => terminalDirectoryNode(projectRoot, childPath, path.basename(childPath)));

  return {
    parent: terminalDirectoryNode(projectRoot, dirPath),
    children,
  };
}

function getTerminalOptions(project) {
  const projectRoot = normalizePath(project.path);
  const rootDirectory = terminalDirectoryNode(projectRoot, projectRoot, '專案根目錄');

  return {
    name: project.name,
    port: project.port,
    localUrl: projectHasWebTarget(project) ? buildUrl('127.0.0.1', project.port) : '',
    defaultCwd: project.path,
    directories: [rootDirectory],
    rootDirectory,
    shells: getTerminalShellCatalog().map((shell) => ({
      id: shell.id,
      label: shell.label,
    })),
  };
}

function appendTerminalOutput(session, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
  if (!text) {
    return '';
  }

  session.output += text;
  session.updatedAt = new Date().toISOString();
  if (session.output.length > TERMINAL_BUFFER_LIMIT) {
    const overflow = session.output.length - TERMINAL_BUFFER_LIMIT;
    session.output = session.output.slice(overflow);
    session.outputOffset += overflow;
  }

  return text;
}

function sendTerminalSocket(session, payload) {
  const message = JSON.stringify(payload);
  for (const socket of session.sockets || []) {
    if (socket.readyState === 1) {
      socket.send(message);
    }
  }
}

function emitTerminalOutput(session, chunk) {
  const text = appendTerminalOutput(session, chunk);
  if (!text) {
    return;
  }

  sendTerminalSocket(session, {
    type: 'output',
    data: text,
    cursor: session.outputOffset + session.output.length,
  });
}

function terminalProcessPid(session) {
  return session?.pty?.pid || session?.child?.pid || null;
}

function terminalProcessRunning(session) {
  return !session?.exitedAt && Boolean(terminalProcessPid(session));
}

function markTerminalClosed(session, code = null, signal = null) {
  if (session.exitedAt) {
    return;
  }

  session.exitedAt = new Date().toISOString();
  session.exitCode = code;
  session.exitSignal = signal;
  const message = `\n[Agent Task Manager (ATM)] terminal closed${code === null || code === undefined ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}.\n`;
  emitTerminalOutput(session, message);
  sendTerminalSocket(session, {
    type: 'exit',
    exitedAt: session.exitedAt,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    running: false,
  });
}

function terminalSnapshot(session, cursor = 0, options = {}) {
  const outputCursor = Math.max(Number(cursor) || 0, session.outputOffset);
  const relativeCursor = Math.max(0, outputCursor - session.outputOffset);

  return {
    id: session.id,
    projectName: session.projectName,
    projectPort: session.projectPort,
    projectLocalUrl: session.projectLocalUrl,
    cwd: session.cwd,
    shellId: session.shellId,
    shellLabel: session.shellLabel,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    exitedAt: session.exitedAt,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    running: terminalProcessRunning(session),
    interactive: Boolean(session.pty),
    readOnly: options.readOnly === true,
    cols: Number(session.cols || TERMINAL_DEFAULT_COLS),
    rows: Number(session.rows || TERMINAL_DEFAULT_ROWS),
    output: session.output.slice(relativeCursor),
    cursor: session.outputOffset + session.output.length,
  };
}

function terminalSessionList(options = {}) {
  return [...terminalSessions.values()]
    .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')))
    .map((session) => terminalSnapshot(session, 0, options));
}

function createTerminalSession(project, options = {}) {
  const cwd = resolveTerminalCwd(project, options.cwd);
  const shell = resolveTerminalShell(options.shellId, cwd);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const env = buildTerminalEnv(project);
  const cols = Math.max(20, Math.min(400, Number(options.cols) || TERMINAL_DEFAULT_COLS));
  const rows = Math.max(5, Math.min(TERMINAL_MAX_ROWS, Number(options.rows) || TERMINAL_DEFAULT_ROWS));
  const terminalProcess = pty
    ? pty.spawn(shell.command, shell.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env,
        useConpty: process.platform === 'win32',
      })
    : spawn(shell.command, shell.args, {
        cwd,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
  const session = {
    id,
    pty: pty ? terminalProcess : null,
    child: pty ? null : terminalProcess,
    sockets: new Set(),
    projectName: project.name,
    projectPort: project.port,
    projectLocalUrl: projectHasWebTarget(project) ? buildUrl('127.0.0.1', project.port) : '',
    cwd,
    shellId: shell.id,
    shellLabel: shell.label,
    cols,
    rows,
    output: '',
    outputOffset: 0,
    createdAt,
    updatedAt: createdAt,
    exitedAt: null,
    exitCode: null,
    exitSignal: null,
  };

  appendTerminalOutput(session, `[Agent Task Manager (ATM)] ${createdAt} opened terminal for ${project.name}\n`);
  appendTerminalOutput(session, `[Agent Task Manager (ATM)] port: ${project.port}\n`);
  appendTerminalOutput(session, `[Agent Task Manager (ATM)] shell: ${shell.label}\n`);
  appendTerminalOutput(session, `[Agent Task Manager (ATM)] cwd: ${cwd}\n`);

  if (session.pty) {
    session.pty.onData((chunk) => emitTerminalOutput(session, chunk));
    session.pty.onExit((event) => {
      markTerminalClosed(session, event?.exitCode ?? null, event?.signal ?? null);
    });
  } else {
    session.child.stdout.on('data', (chunk) => emitTerminalOutput(session, chunk));
    session.child.stderr.on('data', (chunk) => emitTerminalOutput(session, chunk));
    session.child.on('error', (error) => {
      emitTerminalOutput(session, `\n[Agent Task Manager (ATM)] terminal error: ${error.message}\n`);
    });
    session.child.on('close', (code, signal) => {
      markTerminalClosed(session, code, signal);
    });
  }

  terminalSessions.set(id, session);
  return session;
}

function getTerminalSession(id) {
  return terminalSessions.get(String(id || '')) || null;
}

function writeTerminalInput(session, input) {
  if (!session || session.exitedAt || (!session.pty && !session.child?.stdin?.writable)) {
    throw new Error('Terminal is already closed.');
  }

  const command = String(input ?? '').replace(/\0/g, '');
  if (Buffer.byteLength(command, 'utf8') > TERMINAL_INPUT_LIMIT) {
    throw new Error('Terminal input is too large.');
  }

  const lineEnding = command.endsWith('\n') || command.endsWith('\r') ? '' : os.EOL;
  if (session.pty) {
    session.pty.write(`${command}${lineEnding}`);
    return;
  }

  emitTerminalOutput(session, `\n> ${command}${lineEnding}`);
  session.child.stdin.write(`${command}${lineEnding}`);
}

function writeTerminalData(session, input) {
  if (!session || session.exitedAt || (!session.pty && !session.child?.stdin?.writable)) {
    throw new Error('Terminal is already closed.');
  }

  const data = String(input ?? '').replace(/\0/g, '');
  if (Buffer.byteLength(data, 'utf8') > TERMINAL_INPUT_LIMIT) {
    throw new Error('Terminal input is too large.');
  }

  if (session.pty) {
    session.pty.write(data);
    return;
  }

  session.child.stdin.write(data);
}

function resizeTerminalSession(session, cols, rows) {
  if (!session?.pty || session.exitedAt) {
    return;
  }

  const nextCols = Math.max(20, Math.min(400, Number(cols) || TERMINAL_DEFAULT_COLS));
  const nextRows = Math.max(5, Math.min(TERMINAL_MAX_ROWS, Number(rows) || TERMINAL_DEFAULT_ROWS));
  session.pty.resize(nextCols, nextRows);
  session.cols = nextCols;
  session.rows = nextRows;
  session.updatedAt = new Date().toISOString();
}

async function closeTerminalSession(id) {
  const session = getTerminalSession(id);
  if (!session) {
    return false;
  }

  for (const socket of session.sockets || []) {
    socket.close(1000, 'Terminal closed');
  }
  session.sockets.clear();

  if (!session.exitedAt && session.pty) {
    try {
      session.pty.kill();
    } catch (error) {
      // The PTY may already be gone.
    }
  } else if (!session.exitedAt && session.child?.pid) {
    await stopProcessTree(session.child.pid);
  }
  terminalSessions.delete(session.id);
  return true;
}

function isTailscaleIpv4(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function getTailscaleIp() {
  try {
    const output = execFileSync('tailscale', ['ip', '-4'], {
      encoding: 'utf8',
      timeout: 1500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const ip = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (ip) {
      return ip;
    }
  } catch (error) {
    // Fall back to interface inspection below.
  }

  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal && isTailscaleIpv4(address.address)) {
        return address.address;
      }
    }
  }

  return null;
}

function startTailscaleIfNeeded() {
  const currentIp = getTailscaleIp();
  if (currentIp) {
    return { ip: currentIp, started: false, error: null };
  }

  try {
    execFileSync('tailscale', ['up'], {
      encoding: 'utf8',
      timeout: 12000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const ipAfterFailure = getTailscaleIp();
    return {
      ip: ipAfterFailure,
      started: Boolean(ipAfterFailure),
      error: ipAfterFailure ? null : (error.stderr || error.stdout || error.message || 'tailscale up failed').toString().trim(),
    };
  }

  return { ip: getTailscaleIp(), started: true, error: null };
}

function getLanIp() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal && !isTailscaleIpv4(address.address)) {
        return address.address;
      }
    }
  }

  return null;
}

function buildUrl(ipAddress, projectPort) {
  const portNumber = normalizePort(projectPort);
  return ipAddress && portNumber ? `http://${ipAddress}:${portNumber}` : '';
}

function quotePowerShellArgument(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function getLanFirewallCommand(project) {
  return [
    'powershell',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    quotePowerShellArgument(path.join(ROOT_DIR, 'dev-manager.ps1')),
    'firewall-lan',
    '-BasePort',
    String(project.port),
    '-PortCount',
    '1',
  ].join(' ');
}

function getElevatedLanFirewallCommand(project) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(ROOT_DIR, 'dev-manager.ps1'),
    'firewall-lan',
    '-BasePort',
    String(project.port),
    '-PortCount',
    '1',
  ];

  return `Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList @(${args.map(quotePowerShellArgument).join(', ')})`;
}

function isLocalRequest(request) {
  const address = normalizeSocketAddress(request.socket?.remoteAddress || '');
  if (address === '127.0.0.1' || address === '::1') {
    return true;
  }

  return getLocalAddressSet().has(address);
}

function normalizeSocketAddress(address) {
  return String(address || '').replace(/^::ffff:/, '');
}

function getLocalAddressSet() {
  const addresses = new Set(['127.0.0.1', '::1']);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry?.address) {
        addresses.add(normalizeSocketAddress(entry.address));
      }
    }
  }

  return addresses;
}

function openElevatedLanFirewall(project) {
  const command = getElevatedLanFirewallCommand(project);
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

function openProjectFolder(project) {
  if (!project?.path || !fs.existsSync(project.path) || !fs.statSync(project.path).isDirectory()) {
    throw new Error('Project folder was not found.');
  }

  const opener = process.platform === 'win32'
    ? { command: 'explorer.exe', args: [project.path] }
    : process.platform === 'darwin'
      ? { command: 'open', args: [project.path] }
      : { command: 'xdg-open', args: [project.path] };
  return new Promise((resolve, reject) => {
    const child = spawn(opener.command, opener.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });

    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });
}

function probeLocalPort(projectPort) {
  const portNumber = normalizePort(projectPort);
  const startedAt = Date.now();
  if (!portNumber) {
    return Promise.resolve({
      ok: false,
      error: 'no-port',
      latencyMs: 0,
      checkedAt: new Date().toISOString(),
    });
  }

  return new Promise((resolve) => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port: portNumber,
        path: '/',
        timeout: 900,
      },
      (response) => {
        response.resume();
        resolve({
          ok: true,
          statusCode: response.statusCode,
          latencyMs: Date.now() - startedAt,
          checkedAt: new Date().toISOString(),
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });

    request.on('error', (error) => {
      resolve({
        ok: false,
        error: error.code || error.message,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      });
    });
  });
}

async function applyHealthPolicy(project, entry, running, probe, config, networkContext) {
  if (!entry) {
    return { entry, autoRestarted: false };
  }

  const probeOk = Boolean(probe?.ok);
  const health = normalizeHealthSettings(config.health);
  const lastHealthError = probeOk ? '' : (probe?.error || `HTTP ${probe?.statusCode || 'unreachable'}`);
  const nextFailures = running && !probeOk ? Number(entry.healthFailures || 0) + 1 : 0;
  const healthPatch = {
    healthFailures: nextFailures,
    lastHealthAt: probe?.checkedAt || new Date().toISOString(),
    lastHealthOk: probeOk,
    lastHealthError,
  };

  const shouldRestart =
    running &&
    !probeOk &&
    health.autoRestart &&
    nextFailures >= health.failureThreshold &&
    !restartLocks.has(project.path);

  if (!shouldRestart) {
    return {
      entry: updateProjectEntry(project, healthPatch) || { ...entry, ...healthPatch },
      autoRestarted: false,
    };
  }

  restartLocks.add(project.path);

  try {
    const restartedAt = new Date().toISOString();
    const restartCount = Number(entry.restartCount || 0) + 1;
    updateProjectEntry(project, {
      ...healthPatch,
      healthFailures: 0,
      lastRestartAt: restartedAt,
      restartCount,
      lastHealthError: 'Auto restart triggered after failed health checks.',
    });

    const restartedEntry = await restartProject(project, {
      lanMode: Boolean(entry.lanMode && networkContext.lanIp),
      lanIp: entry.lanMode ? networkContext.lanIp : null,
      tailscaleMode: Boolean(entry.tailscaleMode && networkContext.tailscaleIp),
      tailscaleIp: entry.tailscaleMode ? networkContext.tailscaleIp : null,
    });
    const patchedEntry =
      updateProjectEntry(project, {
        healthFailures: 0,
        lastHealthAt: restartedAt,
        lastHealthOk: false,
        lastHealthError: 'Restarted; waiting for the next health check.',
        lastRestartAt: restartedAt,
        restartCount,
      }) || restartedEntry;

    return { entry: patchedEntry, autoRestarted: true };
  } finally {
    restartLocks.delete(project.path);
  }
}

async function getStatusPayload(request = null) {
  const config = getConfig();
  const state = getState();
  const tailscaleIp = getTailscaleIp();
  const lanIp = getLanIp();
  const terminalReadOnly = request ? !isLocalRequest(request) : false;
  const normalizedProjects = normalizeProjects(config.projects, config.basePort);
  const resolvedProjects = normalizedProjects.map((project) => {
    const entry = getStateEntryByPath(state, project.path);
    const running = Boolean(entry?.pid && processIsRunning(entry.pid));
    return resolveProjectPort(project, entry, running);
  });

  const rows = await Promise.all(
    resolvedProjects.map(async (project) => {
      let entry = getStateEntryByPath(state, project.path);
      let running = Boolean(entry?.pid && processIsRunning(entry.pid));
      const webTarget = projectHasWebTarget(project);
      const childWebTargets = webTarget
        ? []
        : await resolveChildWebTargets(project, state, { lanIp, tailscaleIp });
      const homeChildWebTarget = childWebTargets[0] || null;
      const probe = webTarget
        ? await probeLocalPort(project.port)
        : homeChildWebTarget?.probe || {
            ok: false,
            error: 'no-web-target',
            latencyMs: 0,
            checkedAt: new Date().toISOString(),
          };
      const healthResult = webTarget
        ? await applyHealthPolicy(project, entry, running, probe, config, { lanIp, tailscaleIp })
        : { entry, autoRestarted: false };
      entry = healthResult.entry || entry;
      running = Boolean(entry?.pid && processIsRunning(entry.pid));
      const status = webTarget
        ? healthResult.autoRestarted
          ? 'restarting'
          : running
            ? probe.ok
              ? 'running'
              : 'unhealthy'
            : probe.ok
              ? 'external'
              : entry
                ? 'stale'
                : 'stopped'
        : homeChildWebTarget
          ? homeChildWebTarget.probe.ok
            ? 'external'
            : homeChildWebTarget.entry
              ? 'stale'
              : 'stopped'
          : 'stopped';
      const localUrl = webTarget ? buildUrl('127.0.0.1', project.port) : homeChildWebTarget?.localUrl || '';
      const lanUrl = webTarget ? buildUrl(lanIp, project.port) : homeChildWebTarget?.lanUrl || '';
      const tailscaleUrl = webTarget ? buildUrl(tailscaleIp, project.port) : homeChildWebTarget?.tailscaleUrl || '';
      const mobileInstall = getMobileInstallSummary(project);
      const pages = homeChildWebTarget && !webTarget
        ? derivedPagesFromChildTargets(childWebTargets, homeChildWebTarget)
        : discoverProjectPages(project).map((page) => ({
            ...page,
            localUrl: page.pattern ? '' : buildPageUrl(localUrl, page.path),
            lanUrl: page.pattern ? '' : buildPageUrl(lanUrl, page.path),
            tailscaleUrl: page.pattern ? '' : buildPageUrl(tailscaleUrl, page.path),
          }));

      return {
        ...project,
        port: webTarget ? project.port : project.port || homeChildWebTarget?.project.port || null,
        status,
        running,
        pid: running ? entry.pid : entry?.pid || null,
        startedAt: entry?.startedAt || null,
        command: entry?.command || '',
        stdout: entry?.stdout || '',
        stderr: entry?.stderr || '',
        lanMode: Boolean(entry?.lanMode && lanIp),
        lanReady: webTarget ? Boolean(running && lanIp) : Boolean(homeChildWebTarget?.lanUrl && homeChildWebTarget.probe.ok),
        lanIpAtStart: entry?.lanIpAtStart || null,
        tailscaleMode: Boolean(entry?.tailscaleMode && tailscaleIp),
        tailscaleReady: webTarget ? Boolean(running && tailscaleIp) : Boolean(homeChildWebTarget?.tailscaleUrl && homeChildWebTarget.probe.ok),
        tailscaleIpAtStart: entry?.tailscaleIpAtStart || null,
        localUrl,
        lanUrl,
        tailscaleUrl,
        firewallSupported: webTarget,
        derivedHome: homeChildWebTarget
          ? {
              name: homeChildWebTarget.project.name,
              path: homeChildWebTarget.project.path,
              relativePath: homeChildWebTarget.project.relativePath || '',
              port: homeChildWebTarget.project.port,
            }
          : null,
        mobileInstall,
        pages,
        hasDetectedPages: pages.length > 0,
        probe,
        healthFailures: Number(entry?.healthFailures || 0),
        lastHealthAt: entry?.lastHealthAt || probe.checkedAt,
        lastHealthOk: entry?.lastHealthOk ?? probe.ok,
        lastHealthError: entry?.lastHealthError || '',
        lastRestartAt: entry?.lastRestartAt || null,
        restartCount: Number(entry?.restartCount || 0),
        autoRestarted: healthResult.autoRestarted,
      };
    }),
  );

  return {
    manager: {
      name: 'Agent Task Manager (ATM)',
      host,
      port,
      localUrl: buildUrl('127.0.0.1', port),
      lanUrl: buildUrl(lanIp, port),
      tailscaleUrl: buildUrl(tailscaleIp, port),
      tailscaleIp,
      terminalReadOnly,
      terminalClaudeRemoteLaunch: true,
      terminalAgentRemoteLaunch: true,
      configPath: CONFIG_PATH,
      statePath: STATE_PATH,
    },
    config: {
      defaultRoots: config.defaultRoots,
      basePort: config.basePort,
      autoRestoreOnStartup: config.autoRestoreOnStartup,
      health: normalizeHealthSettings(config.health),
      profiles: normalizeProfiles(config.profiles, normalizedProjects),
    },
    projects: rows,
  };
}

async function restoreEnabledProjectsOnStartup() {
  const config = getConfig();
  if (!config.autoRestoreOnStartup) {
    console.log('Auto restore is disabled.');
    return;
  }

  const state = getState();
  const projects = normalizeProjects(config.projects, config.basePort);
  const lanIp = getLanIp();
  const tailscaleIp = getTailscaleIp();

  for (const entry of state.projects) {
    const shouldRestore = Boolean(entry?.lanMode || entry?.tailscaleMode);
    if (!shouldRestore || processIsRunning(entry.pid)) {
      continue;
    }

    const project = getProjectByPath(projects, entry.path);
    if (!project || !projectCanStart(project)) {
      continue;
    }

    const probe = await probeLocalPort(project.port);
    if (probe.ok) {
      console.log(`Auto restore skipped ${project.name}; port ${project.port} is already responding.`);
      continue;
    }

    try {
      await startProject(project, {
        lanMode: Boolean(entry.lanMode && lanIp),
        lanIp: entry.lanMode ? lanIp : null,
        tailscaleMode: Boolean(entry.tailscaleMode && tailscaleIp),
        tailscaleIp: entry.tailscaleMode ? tailscaleIp : null,
      });
      console.log(`Auto restored ${project.name} on port ${project.port}.`);
    } catch (error) {
      console.error(`Auto restore failed for ${project.name}: ${error.message}`);
    }
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

function selectedProjectFromUrl(url) {
  const name = decodeURIComponent(url.pathname.split('/')[3] || '');
  const config = getConfig();
  const projects = normalizeProjects(config.projects, config.basePort);
  const project = getProjectByName(projects, name);

  return { project, projects, config };
}

function selectedProfileFromUrl(url) {
  const id = decodeURIComponent(url.pathname.split('/')[3] || '');
  const config = getConfig();
  const projects = normalizeProjects(config.projects, config.basePort);
  const profiles = normalizeProfiles(config.profiles, projects);
  const profile = profiles.find((item) => item.id === id);

  return { profile, profiles, projects, config };
}

async function runProfileAction(profile, projects, action) {
  const projectsByName = new Map(projects.map((project) => [project.name, project]));
  const selectedProjects = profile.projectNames
    .map((projectName) => projectsByName.get(projectName))
    .filter(Boolean);

  for (const project of selectedProjects) {
    if (action === 'stop') {
      await stopProject(project);
    } else if (!projectCanStart(project)) {
      continue;
    } else if (action === 'restart') {
      await restartProject(project);
    } else {
      await startProject(project);
    }
  }

  return selectedProjects.length;
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/status') {
    sendJson(response, 200, await getStatusPayload(request));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/ai-quotas') {
    if (!isLocalRequest(request)) {
      sendError(response, 403, 'For safety, AI quota probes are only available from http://127.0.0.1 on this computer.');
      return;
    }

    sendJson(response, 200, await getAiQuotaPayload());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/ai-quotas/cancel') {
    if (!isLocalRequest(request)) {
      sendError(response, 403, 'For safety, AI quota probes are only available from http://127.0.0.1 on this computer.');
      return;
    }

    sendJson(response, 200, {
      canceled: cancelAiQuotaPayload(),
      checkedAt: new Date().toISOString(),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/terminal-preferences') {
    sendJson(response, 200, readTerminalPreferences());
    return;
  }

  if ((request.method === 'PUT' || request.method === 'POST') && url.pathname === '/api/terminal-preferences') {
    const body = await readRequestBody(request);
    sendJson(response, 200, saveTerminalPreferences(body));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/logs') {
    const name = url.searchParams.get('name') || '';
    const lines = Math.min(Number(url.searchParams.get('lines') || 160), 1200);
    const { project } = selectedProjectFromUrl(new URL(`/api/projects/${encodeURIComponent(name)}/logs`, url.origin));
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    const entry = getStateEntryByPath(getState(), project.path);
    const stdout = readTail(entry?.stdout, lines);
    const stderr = readTail(entry?.stderr, lines);
    sendJson(response, 200, { name, stdout, stderr });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/firewall/lan-command') {
    const name = url.searchParams.get('name') || '';
    const { project } = selectedProjectFromUrl(new URL(`/api/projects/${encodeURIComponent(name)}/firewall`, url.origin));
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }
    if (!projectHasWebTarget(project)) {
      sendError(response, 400, 'Project does not have a web port configured.');
      return;
    }

    const lanIp = getLanIp();
    sendJson(response, 200, {
      name: project.name,
      port: project.port,
      lanUrl: buildUrl(lanIp, project.port),
      command: getLanFirewallCommand(project),
      requiresAdmin: true,
      scope: {
        remoteAddress: 'LocalSubnet',
        profile: 'Private',
        protocol: 'TCP',
        localPort: project.port,
      },
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/firewall/lan-run') {
    if (!isLocalRequest(request)) {
      sendError(response, 403, 'For safety, automatic PowerShell launch is only allowed from http://127.0.0.1 on this computer.');
      return;
    }

    const body = await readRequestBody(request);
    if (body.consent !== true) {
      sendError(response, 400, 'Firewall consent is required before opening PowerShell.');
      return;
    }

    const config = getConfig();
    const projects = normalizeProjects(config.projects, config.basePort);
    const project = getProjectByName(projects, body.name || '');
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }
    if (!projectHasWebTarget(project)) {
      sendError(response, 400, 'Project does not have a web port configured.');
      return;
    }

    openElevatedLanFirewall(project);
    sendJson(response, 202, {
      opened: true,
      name: project.name,
      port: project.port,
      message: 'Windows should show a UAC prompt for elevated PowerShell.',
    });
    return;
  }

  if (request.method === 'GET' && /^\/api\/projects\/[^/]+\/terminal-options$/.test(url.pathname)) {
    if (!isLocalRequest(request)) {
      sendError(response, 403, 'For safety, terminal options are only available from http://127.0.0.1 on this computer.');
      return;
    }

    const { project } = selectedProjectFromUrl(url);
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    sendJson(response, 200, getTerminalOptions(project));
    return;
  }

  if (request.method === 'POST' && /^\/api\/projects\/[^/]+\/open-folder$/.test(url.pathname)) {
    const { project } = selectedProjectFromUrl(url);
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    try {
      await openProjectFolder(project);
      sendJson(response, 200, { opened: true, path: project.path });
    } catch (error) {
      sendError(response, 400, error.message);
    }
    return;
  }

  if (request.method === 'GET' && /^\/api\/projects\/[^/]+\/terminal-directories$/.test(url.pathname)) {
    if (!isLocalRequest(request)) {
      sendError(response, 403, 'For safety, terminal directories are only available from http://127.0.0.1 on this computer.');
      return;
    }

    const { project } = selectedProjectFromUrl(url);
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    try {
      sendJson(response, 200, getTerminalDirectoryChildren(project, url.searchParams.get('path') || ''));
    } catch (error) {
      sendError(response, 400, error.message);
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/terminals') {
    sendJson(response, 200, { sessions: terminalSessionList({ readOnly: !isLocalRequest(request) }) });
    return;
  }

  if (request.method === 'POST' && /^\/api\/projects\/[^/]+\/terminal-agent$/.test(url.pathname)) {
    const body = await readRequestBody(request);
    const { project } = selectedProjectFromUrl(url);
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    let command;
    try {
      command = buildTerminalAgentLaunchCommand(body.agent || body.provider || body.cli, body.settings || body);
    } catch (error) {
      sendError(response, 400, error.message);
      return;
    }

    let session;
    try {
      session = createTerminalSession(project, {
        cwd: '',
        shellId: '',
        cols: body.cols,
        rows: body.rows,
      });
      writeTerminalInput(session, command);
    } catch (error) {
      sendError(response, 400, error.message);
      return;
    }

    sendJson(response, 201, terminalSnapshot(session, 0, { readOnly: !isLocalRequest(request) }));
    return;
  }

  if (request.method === 'POST' && /^\/api\/projects\/[^/]+\/terminal-claude$/.test(url.pathname)) {
    const body = await readRequestBody(request);
    const { project } = selectedProjectFromUrl(url);
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    let command;
    try {
      command = buildTerminalClaudeLaunchCommand(body.settings || body.claude || body);
    } catch (error) {
      sendError(response, 400, error.message);
      return;
    }

    let session;
    try {
      session = createTerminalSession(project, {
        cwd: '',
        shellId: '',
        cols: body.cols,
        rows: body.rows,
      });
      writeTerminalInput(session, command);
    } catch (error) {
      sendError(response, 400, error.message);
      return;
    }

    sendJson(response, 201, terminalSnapshot(session, 0, { readOnly: !isLocalRequest(request) }));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/terminals') {
    if (!isLocalRequest(request)) {
      sendError(response, 403, 'For safety, terminal commands are only allowed from http://127.0.0.1 on this computer.');
      return;
    }

    const body = await readRequestBody(request);
    const config = getConfig();
    const projects = normalizeProjects(config.projects, config.basePort);
    const project = getProjectByName(projects, body.name || '');
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    let session;
    try {
      session = createTerminalSession(project, {
        cwd: body.cwd || body.relativePath || '',
        shellId: body.shellId || '',
        cols: body.cols,
        rows: body.rows,
      });
      if (String(body.command || '').trim()) {
        writeTerminalInput(session, body.command);
      }
    } catch (error) {
      sendError(response, 400, error.message);
      return;
    }
    sendJson(response, 201, terminalSnapshot(session));
    return;
  }

  if (/^\/api\/terminals\/[^/]+$/.test(url.pathname)) {
    const localRequest = isLocalRequest(request);
    if (!localRequest && request.method !== 'GET') {
      sendError(response, 403, 'For safety, terminal commands are only allowed from http://127.0.0.1 on this computer.');
      return;
    }

    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    const session = getTerminalSession(id);
    if (!session) {
      sendError(response, 404, 'Terminal session not found.');
      return;
    }

    if (request.method === 'GET') {
      sendJson(response, 200, terminalSnapshot(session, url.searchParams.get('cursor'), { readOnly: !localRequest }));
      return;
    }

    if (request.method === 'POST') {
      const body = await readRequestBody(request);
      try {
        writeTerminalInput(session, body.input || '');
      } catch (error) {
        sendError(response, 409, error.message);
        return;
      }
      sendJson(response, 200, terminalSnapshot(session, body.cursor));
      return;
    }

    if (request.method === 'DELETE') {
      await closeTerminalSession(id);
      sendJson(response, 200, { closed: true, id });
      return;
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/discover') {
    const body = await readRequestBody(request);
    const currentConfig = getConfig();
    const roots = Array.isArray(body.roots) && body.roots.length
      ? body.roots.map((root) => normalizePath(root))
      : currentConfig.defaultRoots;
    const basePort = Number(body.basePort || currentConfig.basePort || DEFAULT_BASE_PORT);
    const discovered = discoverProjects(roots);
    const projects = await allocateAvailablePorts(mergeDiscoveredWithExisting(discovered, currentConfig.projects, basePort), basePort);
    clearStaleStateForProjects(projects);
    saveConfig({ defaultRoots: roots, basePort, projects });
    sendJson(response, 200, await getStatusPayload());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/settings') {
    const body = await readRequestBody(request);
    const config = getConfig();
    saveConfig({
      ...config,
      autoRestoreOnStartup: body.autoRestoreOnStartup !== false,
      health: normalizeHealthSettings({
        autoRestart: body.health?.autoRestart === true,
        failureThreshold: Number(body.health?.failureThreshold || config.health.failureThreshold),
      }),
    });
    sendJson(response, 200, await getStatusPayload());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/profiles') {
    const body = await readRequestBody(request);
    const config = getConfig();
    const projects = normalizeProjects(config.projects, config.basePort);
    const projectNames = Array.isArray(body.projectNames)
      ? body.projectNames.map((name) => String(name).trim()).filter(Boolean)
      : [];
    const profileName = String(body.name || '').trim();

    if (!profileName) {
      sendError(response, 400, 'Profile name is required.');
      return;
    }
    if (!projectNames.length) {
      sendError(response, 400, 'Choose at least one project for this profile.');
      return;
    }

    const profileId = safeName(body.id || profileName).toLowerCase();
    const profiles = [
      ...normalizeProfiles(config.profiles, projects).filter((profile) => profile.id !== profileId),
      {
        id: profileId,
        name: profileName,
        projectNames,
      },
    ];

    saveConfig({ ...config, projects, profiles });
    sendJson(response, 200, await getStatusPayload());
    return;
  }

  if (request.method === 'DELETE' && /^\/api\/profiles\/[^/]+$/.test(url.pathname)) {
    const { profile, profiles, projects, config } = selectedProfileFromUrl(url);
    if (!profile) {
      sendError(response, 404, 'Profile not found.');
      return;
    }

    saveConfig({
      ...config,
      projects,
      profiles: profiles.filter((item) => item.id !== profile.id),
    });
    sendJson(response, 200, await getStatusPayload());
    return;
  }

  if (request.method === 'POST' && /^\/api\/profiles\/[^/]+\/(start|stop|restart)$/.test(url.pathname)) {
    const { profile, projects } = selectedProfileFromUrl(url);
    if (!profile) {
      sendError(response, 404, 'Profile not found.');
      return;
    }

    const action = url.pathname.split('/')[4];
    await runProfileAction(profile, projects, action);
    sendJson(response, 200, await getStatusPayload());
    return;
  }

  if ((request.method === 'GET' || request.method === 'POST') && /^\/api\/projects\/[^/]+\/mobile-install$/.test(url.pathname)) {
    const { project } = selectedProjectFromUrl(url);
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    if (request.method === 'GET') {
      sendJson(response, 200, getMobileInstallStatus(project, request));
      return;
    }

    const body = await readRequestBody(request);
    try {
      sendJson(response, 200, await runMobileBuildInstall(project, request, body));
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || 'Mobile install failed.',
        ...(error.payload || {}),
      });
    }
    return;
  }

  if (request.method === 'POST' && /^\/api\/projects\/[^/]+\/start$/.test(url.pathname)) {
    const { project } = selectedProjectFromUrl(url);
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    await startProject(project);
    sendJson(response, 200, await getStatusPayload());
    return;
  }

  if (request.method === 'POST' && /^\/api\/projects\/[^/]+\/lan$/.test(url.pathname)) {
    const { project } = selectedProjectFromUrl(url);
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    const lanIp = getLanIp();
    if (!lanIp) {
      sendError(response, 409, 'LAN IP not found. Make sure this computer is connected to Wi-Fi or Ethernet.');
      return;
    }

    await startProject(project, { lanMode: true, lanIp });
    sendJson(response, 200, await getStatusPayload());
    return;
  }

  if (request.method === 'POST' && /^\/api\/projects\/[^/]+\/tailscale$/.test(url.pathname)) {
    const { project } = selectedProjectFromUrl(url);
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    const tailscaleIp = getTailscaleIp();
    if (!tailscaleIp) {
      sendError(response, 409, 'Tailscale IP not found. Make sure Tailscale is connected on this computer.');
      return;
    }

    await startProject(project, { tailscaleMode: true, tailscaleIp });
    sendJson(response, 200, await getStatusPayload());
    return;
  }

  if (request.method === 'POST' && /^\/api\/projects\/[^/]+\/stop$/.test(url.pathname)) {
    const { project } = selectedProjectFromUrl(url);
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    await stopProject(project);
    sendJson(response, 200, await getStatusPayload());
    return;
  }

  if (request.method === 'POST' && /^\/api\/projects\/[^/]+\/restart$/.test(url.pathname)) {
    const { project } = selectedProjectFromUrl(url);
    if (!project) {
      sendError(response, 404, 'Project not found.');
      return;
    }

    await restartProject(project);
    sendJson(response, 200, await getStatusPayload());
    return;
  }

  sendError(response, 404, 'API route not found.');
}

function createMobileInstallError(message, statusCode = 400, payload = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.payload = payload;
  return error;
}

function npmCommandName() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function commandLineLabel(command, args = []) {
  return [command, ...args]
    .map((part) => {
      const value = String(part || '');
      return /\s/.test(value) ? `"${value}"` : value;
    })
    .join(' ');
}

function resolveSpawnTarget(command, args = []) {
  const commandText = String(command || '');
  const extension = path.extname(commandText).toLowerCase();

  if (process.platform === 'win32' && (extension === '.bat' || extension === '.cmd')) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/c', commandText, ...args],
    };
  }

  return { command, args };
}

function androidBuildEnvironment() {
  const env = { ...process.env };

  if (process.platform === 'win32') {
    const androidStudioJbr = 'C:\\Program Files\\Android\\Android Studio\\jbr';
    if (!env.JAVA_HOME && fs.existsSync(androidStudioJbr)) {
      env.JAVA_HOME = androidStudioJbr;
    }
  }

  const sdkCandidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    'C:\\Program Files (x86)\\Android\\android-sdk',
    'C:\\tmp\\android-sdk',
  ].filter(Boolean);
  const sdkRoot = sdkCandidates.find((candidate) => fs.existsSync(candidate));

  if (sdkRoot) {
    if (!env.ANDROID_HOME) {
      env.ANDROID_HOME = sdkRoot;
    }
    if (!env.ANDROID_SDK_ROOT) {
      env.ANDROID_SDK_ROOT = sdkRoot;
    }
  }

  return env;
}

function getAndroidBuildPlan(project) {
  const packageJsonPath = path.join(project.path, 'package.json');
  const packageJson = fs.existsSync(packageJsonPath) ? readJson(packageJsonPath, null) : null;
  const scripts = packageJson && typeof packageJson.scripts === 'object' ? packageJson.scripts : {};
  const scriptCandidates = [
    'android:build:debug',
    'android:assemble:debug',
    'android:assembleDebug',
    'assembleDebug',
    'build:android:debug',
    'build:android',
    'android:build',
    'build:debug',
  ];
  const scriptName = scriptCandidates.find((name) => typeof scripts[name] === 'string');

  if (scriptName) {
    const command = npmCommandName();
    const args = ['run', scriptName];
    return {
      supported: true,
      kind: 'npm-script',
      cwd: project.path,
      command,
      args,
      label: `npm run ${scriptName}`,
    };
  }

  const gradleCandidates = process.platform === 'win32'
    ? [
        { file: path.join(project.path, 'android', 'gradlew.bat'), cwd: path.join(project.path, 'android') },
        { file: path.join(project.path, 'gradlew.bat'), cwd: project.path },
      ]
    : [
        { file: path.join(project.path, 'android', 'gradlew'), cwd: path.join(project.path, 'android') },
        { file: path.join(project.path, 'gradlew'), cwd: project.path },
      ];
  const gradleWrapper = gradleCandidates.find((candidate) => fs.existsSync(candidate.file));

  if (gradleWrapper) {
    return {
      supported: true,
      kind: 'gradle-wrapper',
      cwd: gradleWrapper.cwd,
      command: gradleWrapper.file,
      args: ['assembleDebug'],
      label: `${path.basename(gradleWrapper.file)} assembleDebug`,
    };
  }

  if (typeof scripts.android === 'string') {
    return {
      supported: false,
      reason: 'This looks like an Android-capable project, but no debug APK build script was found. Add an android:build:debug script or a Gradle wrapper.',
    };
  }

  return {
    supported: false,
    reason: 'No Android debug APK build entry was found for this project.',
  };
}

function adbExecutableCandidates() {
  const env = androidBuildEnvironment();
  const candidates = [
    process.env.ADB,
    env.ANDROID_HOME ? path.join(env.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : '',
    env.ANDROID_SDK_ROOT ? path.join(env.ANDROID_SDK_ROOT, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : '',
    process.platform === 'win32' ? 'adb.exe' : 'adb',
  ];

  return candidates.filter(Boolean);
}

function resolveAdbExecutable() {
  for (const candidate of adbExecutableCandidates()) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) {
      continue;
    }

    try {
      execFileSync(candidate, ['version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
        windowsHide: true,
      });
      return candidate;
    } catch (error) {
      // Try the next candidate.
    }
  }

  return null;
}

function parseAdbDevices(output) {
  return String(output || '')
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+(\S+)/);
      if (!match) {
        return null;
      }

      return {
        serial: match[1],
        state: match[2],
      };
    })
    .filter(Boolean);
}

function getAdbDevices(adbPath) {
  if (!adbPath) {
    return [];
  }

  try {
    const output = execFileSync(adbPath, ['devices'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 7000,
      windowsHide: true,
    });
    return parseAdbDevices(output);
  } catch (error) {
    return [];
  }
}

function normalizeRequesterIp(ipAddress) {
  let value = String(ipAddress || '').trim();

  if (value.startsWith('::ffff:')) {
    value = value.slice(7);
  }

  if (value.includes('%')) {
    value = value.split('%')[0];
  }

  return value;
}

function getRequesterIp(request) {
  return normalizeRequesterIp(request.socket?.remoteAddress || '');
}

function isLocalAddress(ipAddress) {
  const value = normalizeRequesterIp(ipAddress);
  return value === '127.0.0.1' || value === '::1' || value === 'localhost';
}

function normalizeAdbHost(host) {
  const value = String(host || '').trim();
  if (!value) {
    return '';
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return `${value}:5555`;
  }

  if (/^[a-z0-9.-]+$/i.test(value) && !value.includes(':')) {
    return `${value}:5555`;
  }

  return value;
}

function inferredAdbHostForRequest(request) {
  const requesterIp = getRequesterIp(request);
  return isLocalAddress(requesterIp) ? '' : normalizeAdbHost(requesterIp);
}

function getMobileInstallStatus(project, request) {
  const plan = getAndroidBuildPlan(project);
  const adbPath = resolveAdbExecutable();
  const requesterIp = getRequesterIp(request);
  const inferredTargetHost = inferredAdbHostForRequest(request);

  return {
    project: project.name,
    supported: plan.supported,
    reason: plan.reason || '',
    buildCommand: plan.label || '',
    adbAvailable: Boolean(adbPath),
    devices: getAdbDevices(adbPath),
    requesterIp,
    inferredTargetHost,
    mode: inferredTargetHost ? 'remote-requester' : 'local-adb',
  };
}

function getMobileInstallSummary(project) {
  const plan = getAndroidBuildPlan(project);
  return {
    supported: Boolean(plan.supported),
    reason: plan.reason || '',
    buildCommand: plan.label || '',
  };
}

function runProcessCapture(command, args, options = {}) {
  const outputLimit = options.outputLimit || 240000;

  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;
    let timer = null;
    const append = (chunk) => {
      output += String(chunk || '');
      if (output.length > outputLimit) {
        output = output.slice(-outputLimit);
      }
    };

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        command,
        args,
        output,
        timedOut,
        ...result,
      });
    };

    const spawnTarget = resolveSpawnTarget(command, args);
    let child;

    try {
      child = spawn(spawnTarget.command, spawnTarget.args, {
        cwd: options.cwd,
        env: options.env || process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      append(`${error.message}\n`);
      finish({ exitCode: -1, error: error.message });
      return;
    }

    timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs || 60000);
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => {
      append(`${error.message}\n`);
      finish({ exitCode: -1, error: error.message });
    });
    child.on('close', (exitCode) => {
      finish({ exitCode });
    });
  });
}

function apkSearchScore(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  let score = 0;

  if (normalized.includes('/apk/debug/') || normalized.endsWith('-debug.apk')) {
    score += 50;
  }
  if (normalized.includes('/outputs/apk/')) {
    score += 20;
  }
  if (normalized.includes('release')) {
    score += 5;
  }
  if (normalized.includes('androidtest') || normalized.includes('/test/')) {
    score -= 80;
  }
  if (normalized.includes('unaligned')) {
    score -= 20;
  }

  return score;
}

function findLatestApk(projectPath) {
  const ignoredDirs = new Set(['node_modules', '.git', '.gradle', '.idea', '.cxx', 'coverage']);
  const candidates = [];
  const stack = [{ dirPath: projectPath, depth: 0 }];
  let scannedDirectories = 0;

  while (stack.length && scannedDirectories < 3500) {
    const current = stack.pop();
    scannedDirectories += 1;

    if (current.depth > 12) {
      continue;
    }

    let entries;
    try {
      entries = fs.readdirSync(current.dirPath, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current.dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          stack.push({ dirPath: entryPath, depth: current.depth + 1 });
        }
        continue;
      }

      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.apk') {
        continue;
      }

      try {
        const stats = fs.statSync(entryPath);
        candidates.push({
          filePath: entryPath,
          modifiedAt: stats.mtimeMs,
          score: apkSearchScore(entryPath),
        });
      } catch (error) {
        // Ignore unreadable files.
      }
    }
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.modifiedAt - left.modifiedAt;
  });

  return candidates[0] || null;
}

function formatProcessLog(title, result) {
  const output = String(result.output || '').trim();
  const exitText = result.timedOut ? 'timed out' : `exit ${result.exitCode}`;
  return [`$ ${title}`, output || `(${exitText})`, `(${exitText})`].join('\n');
}

function chooseAdbDevice(devices, requestedSerial, targetHost) {
  const readyDevices = devices.filter((device) => device.state === 'device');
  const wantedSerial = String(requestedSerial || '').trim();

  if (wantedSerial) {
    const device = readyDevices.find((item) => item.serial === wantedSerial);
    if (!device) {
      throw createMobileInstallError(`ADB device "${wantedSerial}" is not available.`, 409, { devices });
    }
    return device;
  }

  if (targetHost) {
    const normalizedTarget = targetHost.toLowerCase();
    const targetHostOnly = normalizedTarget.replace(/:\d+$/, '');
    const device = readyDevices.find((item) => {
      const serial = item.serial.toLowerCase();
      return serial === normalizedTarget || serial.startsWith(`${targetHostOnly}:`) || serial.includes(targetHostOnly);
    });

    if (device) {
      return device;
    }
  }

  if (readyDevices.length === 1) {
    return readyDevices[0];
  }

  if (readyDevices.length > 1) {
    throw createMobileInstallError('More than one ADB device is connected. Choose a specific device serial before installing.', 409, { devices });
  }

  return null;
}

async function runMobileBuildInstall(project, request, body = {}) {
  const lockKey = normalizePath(project.path).toLowerCase();
  if (mobileInstallLocks.has(lockKey)) {
    throw createMobileInstallError('A mobile build/install is already running for this project.', 409);
  }

  mobileInstallLocks.add(lockKey);
  try {
    const plan = getAndroidBuildPlan(project);
    if (!plan.supported) {
      throw createMobileInstallError(plan.reason || 'This project does not expose an Android debug APK build flow.', 409);
    }

    const adbPath = resolveAdbExecutable();
    if (!adbPath) {
      throw createMobileInstallError('ADB was not found. Install Android platform-tools or set ANDROID_HOME / ANDROID_SDK_ROOT.', 409);
    }

    const explicitTargetHost = body.targetHost || body.adbHost || '';
    const targetHost = normalizeAdbHost(explicitTargetHost) || inferredAdbHostForRequest(request);
    const logBlocks = [];

    if (targetHost) {
      const connectResult = await runProcessCapture(adbPath, ['connect', targetHost], {
        timeoutMs: 30000,
        env: androidBuildEnvironment(),
      });
      logBlocks.push(formatProcessLog(`adb connect ${targetHost}`, connectResult));
      if (connectResult.exitCode !== 0 || /failed|unable|cannot/i.test(connectResult.output || '')) {
        throw createMobileInstallError(`ADB could not connect to ${targetHost}. Make sure wireless debugging is enabled and reachable over LAN/Tailscale.`, 409, {
          log: logBlocks.join('\n\n'),
        });
      }
    }

    let devices = getAdbDevices(adbPath);
    let device = chooseAdbDevice(devices, body.deviceSerial, targetHost);
    if (!device) {
      throw createMobileInstallError('No ready ADB device was found. Connect USB ADB, or open this Agent Task Manager (ATM) from the phone over LAN/Tailscale after enabling wireless debugging on port 5555.', 409, {
        devices,
        targetHost,
        log: logBlocks.join('\n\n'),
      });
    }

    const buildResult = await runProcessCapture(plan.command, plan.args, {
      cwd: plan.cwd,
      env: androidBuildEnvironment(),
      timeoutMs: 20 * 60 * 1000,
    });
    logBlocks.push(formatProcessLog(plan.label || commandLineLabel(plan.command, plan.args), buildResult));
    if (buildResult.exitCode !== 0) {
      throw createMobileInstallError('Android debug build failed.', 422, {
        log: logBlocks.join('\n\n'),
      });
    }

    const apk = findLatestApk(project.path);
    if (!apk) {
      throw createMobileInstallError('Build finished, but no APK was found under the project folder.', 422, {
        log: logBlocks.join('\n\n'),
      });
    }

    devices = getAdbDevices(adbPath);
    device = chooseAdbDevice(devices, body.deviceSerial, targetHost);
    if (!device) {
      throw createMobileInstallError('The ADB device disconnected before install.', 409, {
        devices,
        targetHost,
        log: logBlocks.join('\n\n'),
      });
    }

    const installArgs = ['-s', device.serial, 'install', '-r', '-d', apk.filePath];
    const installResult = await runProcessCapture(adbPath, installArgs, {
      timeoutMs: 3 * 60 * 1000,
      env: androidBuildEnvironment(),
    });
    logBlocks.push(formatProcessLog(`adb -s ${device.serial} install -r -d ${path.relative(project.path, apk.filePath)}`, installResult));
    if (installResult.exitCode !== 0 || /Failure \[/i.test(installResult.output || '')) {
      throw createMobileInstallError('ADB install failed.', 422, {
        devices,
        targetHost,
        apk: apk.filePath,
        log: logBlocks.join('\n\n'),
      });
    }

    return {
      ok: true,
      project: project.name,
      buildCommand: plan.label,
      targetHost,
      device: device.serial,
      apk: apk.filePath,
      relativeApk: path.relative(project.path, apk.filePath),
      log: logBlocks.join('\n\n'),
    };
  } finally {
    mobileInstallLocks.delete(lockKey);
  }
}

function readTail(filePath, lines) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }

  const text = fs.readFileSync(filePath, 'utf8');
  const parts = text.split(/\r?\n/);
  return parts.slice(Math.max(0, parts.length - lines)).join('\n');
}

function serveFile(response, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'content-type': MIME_TYPES[extension] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(response);
}

function serveVendor(request, response, url) {
  const filePath = VENDOR_ASSETS.get(url.pathname);
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }

  serveFile(response, filePath);
  return true;
}

function serveStatic(request, response, url) {
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const requestedPath = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(pathname)}`);
  const publicRoot = `${PUBLIC_DIR}${path.sep}`;

  if (!requestedPath.startsWith(publicRoot) || !fs.existsSync(requestedPath) || fs.statSync(requestedPath).isDirectory()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  serveFile(response, requestedPath);
}

function sendUpgradeError(socket, statusCode, message) {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

const terminalSocketServer = new WebSocketServer({ noServer: true });

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    if (url.pathname.startsWith('/vendor/')) {
      if (!serveVendor(request, response, url)) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
      }
      return;
    }

    serveStatic(request, response, url);
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.message || 'Internal server error.',
      ...(error.payload || {}),
    });
  }
});

terminalSocketServer.on('connection', (socket, request, session, cursor, options = {}) => {
  const readOnly = options.readOnly === true;
  session.sockets.add(socket);
  socket.send(JSON.stringify({
    type: 'snapshot',
    session: terminalSnapshot(session, cursor, { readOnly }),
  }));

  socket.on('message', (raw) => {
    if (readOnly) {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(String(raw));
    } catch (error) {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid terminal socket message.' }));
      return;
    }

    try {
      if (payload.type === 'input') {
        writeTerminalData(session, payload.data || '');
      } else if (payload.type === 'resize') {
        resizeTerminalSession(session, payload.cols, payload.rows);
      }
    } catch (error) {
      socket.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  socket.on('close', () => {
    session.sockets.delete(socket);
  });
});

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (!/^\/api\/terminals\/[^/]+\/socket$/.test(url.pathname)) {
    sendUpgradeError(socket, 404, 'Not Found');
    return;
  }

  const readOnly = !isLocalRequest(request);
  const id = decodeURIComponent(url.pathname.split('/')[3] || '');
  const session = getTerminalSession(id);
  if (!session) {
    sendUpgradeError(socket, 404, 'Not Found');
    return;
  }

  terminalSocketServer.handleUpgrade(request, socket, head, (ws) => {
    terminalSocketServer.emit('connection', ws, request, session, url.searchParams.get('cursor'), { readOnly });
  });
});

server.listen(port, host, () => {
  const lanIp = getLanIp();
  const tailscale = startTailscaleIfNeeded();
  console.log(`Agent Task Manager (ATM) running at http://127.0.0.1:${port}`);
  if (lanIp) {
    console.log(`LAN URL: http://${lanIp}:${port}`);
  } else {
    console.log('LAN IP not found yet. Connect to Wi-Fi or Ethernet, then refresh the UI.');
  }
  if (tailscale.ip) {
    console.log(`Tailscale URL: http://${tailscale.ip}:${port}`);
  } else {
    console.log('Tailscale IP not found yet. Agent Task Manager (ATM) tried to start Tailscale; connect or sign in, then refresh the UI.');
    if (tailscale.error) {
      console.log(`Tailscale startup detail: ${tailscale.error}`);
    }
  }
  restoreEnabledProjectsOnStartup().catch((error) => {
    console.error(`Auto restore failed: ${error.message}`);
  });
});
