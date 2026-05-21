const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const VENDOR_ASSETS = [
  {
    from: path.join(ROOT_DIR, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'),
    to: path.join(DIST_DIR, 'vendor', 'xterm', 'xterm.css'),
  },
  {
    from: path.join(ROOT_DIR, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.mjs'),
    to: path.join(DIST_DIR, 'vendor', 'xterm', 'xterm.mjs'),
  },
  {
    from: path.join(ROOT_DIR, 'node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.mjs'),
    to: path.join(DIST_DIR, 'vendor', 'xterm', 'addon-fit.mjs'),
  },
];

function copyFile(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing build input: ${path.relative(ROOT_DIR, source)}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

fs.rmSync(DIST_DIR, { recursive: true, force: true });
fs.mkdirSync(DIST_DIR, { recursive: true });
fs.cpSync(PUBLIC_DIR, DIST_DIR, { recursive: true });
fs.rmSync(path.join(DIST_DIR, 'mobile-install.js'), { force: true });

for (const asset of VENDOR_ASSETS) {
  copyFile(asset.from, asset.to);
}

const demoConfigPath = path.join(DIST_DIR, 'demo-config.js');
const demoConfig = fs.readFileSync(demoConfigPath, 'utf8')
  .replace('window.AGENT_TASK_MANAGER_DEMO = false;', 'window.AGENT_TASK_MANAGER_DEMO = true;');
fs.writeFileSync(demoConfigPath, demoConfig);
fs.writeFileSync(path.join(DIST_DIR, '.nojekyll'), '');

console.log(`Built GitHub Pages demo at ${path.relative(ROOT_DIR, DIST_DIR)}`);
