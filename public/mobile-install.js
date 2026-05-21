(() => {
  const STATUS_POLL_MS = 6000;
  let busy = false;
  let statusTimer = null;

  function ready(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
      return;
    }

    callback();
  }

  function toast(message) {
    const toastElement = document.getElementById('toast');
    if (!toastElement) {
      return;
    }

    toastElement.textContent = message;
    toastElement.classList.add('is-visible');
    window.setTimeout(() => {
      toastElement.classList.remove('is-visible');
    }, 3200);
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(payload.error || `Request failed: ${response.status}`);
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function selectedProjectName() {
    return (document.getElementById('selectedName')?.textContent || '').trim();
  }

  function writeInstallLog(payload) {
    const logOutput = document.getElementById('logOutput');
    if (!logOutput) {
      return;
    }

    const lines = [];
    if (payload.error) {
      lines.push(`Mobile install failed: ${payload.error}`);
    } else if (payload.ok) {
      lines.push(`Mobile install finished for ${payload.project}.`);
      lines.push(`Device: ${payload.device || 'default adb device'}`);
      lines.push(`APK: ${payload.relativeApk || payload.apk || '(unknown)'}`);
    }
    if (payload.log) {
      lines.push('');
      lines.push(payload.log);
    }

    logOutput.textContent = lines.join('\n');
  }

  function ensureUi() {
    let button = document.getElementById('mobileInstallButton');
    let note = document.getElementById('mobileInstallNote');
    if (button && note) {
      return { button, note };
    }

    const urlStack = document.querySelector('.url-stack');
    if (!urlStack) {
      return null;
    }

    button = document.createElement('button');
    button.id = 'mobileInstallButton';
    button.type = 'button';
    button.className = 'copy-url primary-action mobile-install-action';
    button.textContent = 'Build + install APK';
    button.hidden = true;

    note = document.createElement('div');
    note.id = 'mobileInstallNote';
    note.className = 'mobile-install-note';
    note.hidden = true;

    urlStack.appendChild(button);
    urlStack.insertAdjacentElement('afterend', note);

    button.addEventListener('click', runInstall);

    return { button, note };
  }

function setUnavailable(ui, message = '') {
    ui.button.hidden = false;
    ui.button.disabled = true;
    ui.button.textContent = 'Build + install APK';
    ui.note.hidden = !message;
    ui.note.textContent = message;
  }

  async function refreshStatus() {
    if (busy) {
      return;
    }

    const ui = ensureUi();
    if (!ui) {
      return;
    }

    const name = selectedProjectName();
    if (!name) {
      setUnavailable(ui, 'Choose a project first.');
      return;
    }

    try {
      const status = await fetchJson(`/api/projects/${encodeURIComponent(name)}/mobile-install`);
      if (!status.supported) {
        setUnavailable(ui, status.reason || 'This project does not expose an Android debug APK build flow.');
        return;
      }

      ui.button.hidden = false;
      ui.button.disabled = !status.adbAvailable;
      ui.button.textContent = busy ? 'Installing...' : 'Build + install APK';

      const target = status.inferredTargetHost
        ? `phone at ${status.inferredTargetHost}`
        : 'the connected ADB device';
      const adbState = status.adbAvailable ? 'ADB ready' : 'ADB not found';
      ui.note.hidden = false;
      ui.note.textContent = `${adbState}. Will build with "${status.buildCommand}" and install to ${target}.`;
    } catch (error) {
      setUnavailable(ui, error.message || 'Mobile install status is unavailable.');
    }
  }

  async function runInstall() {
    const ui = ensureUi();
    const name = selectedProjectName();
    if (!ui || !name || busy) {
      return;
    }

    busy = true;
    ui.button.disabled = true;
    ui.button.textContent = 'Building + installing...';
    ui.note.hidden = false;
    ui.note.textContent = 'Running build, then adb install. This can take a few minutes.';

    try {
      const payload = await fetchJson(`/api/projects/${encodeURIComponent(name)}/mobile-install`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      writeInstallLog(payload);
      toast('Mobile install finished.');
    } catch (error) {
      writeInstallLog(error.payload || { error: error.message });
      toast(error.message || 'Mobile install failed.');
    } finally {
      busy = false;
      ui.button.disabled = false;
      ui.button.textContent = 'Build + install APK';
      refreshStatus();
    }
  }

  ready(() => {
    ensureUi();
    refreshStatus();
    const selectedName = document.getElementById('selectedName');
    if (selectedName) {
      new MutationObserver(refreshStatus).observe(selectedName, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    statusTimer = window.setInterval(refreshStatus, STATUS_POLL_MS);
    window.addEventListener('beforeunload', () => {
      if (statusTimer) {
        window.clearInterval(statusTimer);
      }
    });
  });
})();
