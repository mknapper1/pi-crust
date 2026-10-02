const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const port = Number(process.env.SMOKE_PORT || 1213);
const debugPort = Number(process.env.SMOKE_DEBUG_PORT || 9335);
const windows = process.platform === 'win32';
const userDataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-smoke-'));
const child = spawn(
  windows ? 'npm.cmd' : 'npm',
  [
    'start',
    '--',
    '--remoteDebuggingPort',
    String(debugPort),
    ...(process.env.CI && process.platform === 'linux' ? ['--noSandbox'] : []),
  ],
  {
    detached: !windows,
    shell: windows,
    env: {
      ...process.env,
      PORT: String(port),
      PI_DESKTOP_USER_DATA_DIR: userDataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let output = '';
let exited = false;
let socket;
child.stdout.on('data', (data) => {
  output += data;
});
child.stderr.on('data', (data) => {
  output += data;
});
child.on('exit', () => {
  exited = true;
});
child.on('error', (error) => {
  output += error.stack;
  exited = true;
});

async function waitFor(check, description) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`npm start exited before ${description}`);
    const value = await check();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      return targets.find(
        (entry) =>
          entry.type === 'page' &&
          entry.url.startsWith(`http://localhost:${port}`),
      );
    } catch {
      return null;
    }
  }, 'Electron renderer');

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const requests = new Map();
  const exceptions = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown')
      exceptions.push(message.params);
    if (requests.has(message.id)) {
      requests.get(message.id)(message);
      requests.delete(message.id);
    }
  });
  function send(method, params = {}) {
    id += 1;
    const requestId = id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        requests.delete(requestId);
        reject(new Error(`Timed out: ${method}`));
      }, 15_000);
      requests.set(requestId, (message) => {
        clearTimeout(timeout);
        if (message.error || message.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(message)));
        } else resolve(message.result);
      });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.result.value;
  }
  await send('Runtime.enable');
  await waitFor(
    () =>
      evaluate(
        'document.title === "Crust" && document.querySelector(".app-shell") && document.querySelector(".empty-state h1")?.textContent === "Open a project to begin"',
      ),
    'Crust shell',
  );
  assert.equal(
    await evaluate('Boolean(document.querySelector("vite-error-overlay"))'),
    false,
  );
  assert.equal(await evaluate('typeof window.piDesktop.bootstrap'), 'function');
  assert.equal(
    await evaluate('Boolean(document.querySelector(".session-copy"))'),
    false,
  );
  // Code surfaces must keep their own palette inside yellow user messages.
  const codeContrast = await evaluate(`(() => {
    const shell = document.querySelector('.app-shell');
    const originalTheme = shell.getAttribute('data-theme');
    const fixture = document.createElement('article');
    fixture.innerHTML = '<div class="markdown"><p>Message text</p><div class="code-block"><button class="code-copy"><svg></svg>Copy</button><pre><code>plain <span class="hljs-keyword">const</span> <span class="hljs-string">string</span> <span class="hljs-number">42</span> <span class="hljs-comment">comment</span> <span class="hljs-title">function</span></code></pre></div></div>';
    shell.append(fixture);
    const luminance = color => {
      const rgb = color.match(/[\\d.]+/g).slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const ratios = [];
    for (const theme of ['light', 'dark']) {
      shell.setAttribute('data-theme', theme);
      for (const role of ['user', 'assistant']) {
        fixture.className = 'message message-' + role;
        const pre = fixture.querySelector('pre');
        const button = fixture.querySelector('button');
        for (const element of [fixture.querySelector('code'), ...fixture.querySelectorAll('code span'), button, button.querySelector('svg')]) {
          const foreground = luminance(getComputedStyle(element).color);
          const background = luminance(getComputedStyle(button.contains(element) ? button : pre).backgroundColor);
          ratios.push((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05));
        }
      }
    }
    fixture.remove();
    if (originalTheme === null) shell.removeAttribute('data-theme');
    else shell.setAttribute('data-theme', originalTheme);
    return ratios;
  })()`);
  assert.ok(
    codeContrast.every((ratio) => ratio >= 4.5),
    JSON.stringify(codeContrast),
  );
  assert.equal(
    await evaluate('document.querySelectorAll(".conversation-row").length'),
    0,
  );
  await evaluate(
    `window.piDesktop.openProject({path: ${JSON.stringify(userDataDir)}})`,
  );
  await evaluate('location.reload()');
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".composer textarea"))'),
    'project composer',
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".chat-header [aria-label=\\"Copy session\\"]")?.disabled',
    ),
    true,
  );
  const staged = await evaluate(
    `window.piDesktop.prepareAttachment(new File(['clipboard notes'], 'notes.txt', {type: 'text/plain'}))`,
  );
  assert.equal(staged.name, 'notes.txt');
  assert.ok(staged.path.startsWith(userDataDir));
  await evaluate(`(() => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII='), c => c.charCodeAt(0))], 'clipboard.png', {type: 'image/png'}));
    const event = new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true});
    document.querySelector('textarea').dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".attachment-chip img"))'),
    'clipboard image preview',
  );
  const nativePath = join(userDataDir, 'native notes.txt');
  writeFileSync(nativePath, 'Dropped file');
  await evaluate(
    `(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'smoke-file'; document.body.append(input); })()`,
  );
  const root = await send('DOM.getDocument');
  const input = await send('DOM.querySelector', {
    nodeId: root.root.nodeId,
    selector: '#smoke-file',
  });
  await send('DOM.setFileInputFiles', {
    nodeId: input.nodeId,
    files: [nativePath],
  });
  await evaluate(`(() => {
    const data = new DataTransfer(); data.items.add(document.querySelector('#smoke-file').files[0]);
    document.querySelector('.app-shell').dispatchEvent(new DragEvent('drop', {dataTransfer: data, bubbles: true, cancelable: true}));
    document.querySelector('#smoke-file').remove();
  })()`);
  await waitFor(
    () =>
      evaluate('document.querySelectorAll(".attachment-chip").length === 2'),
    'native file drop',
  );
  assert.equal(
    await evaluate(
      'document.querySelectorAll(".attachment-chip span")[1].title',
    ),
    nativePath,
  );
  await evaluate(
    `document.querySelector('[aria-label="Remove clipboard.png"]').click()`,
  );
  await waitFor(
    () =>
      evaluate('document.querySelectorAll(".attachment-chip").length === 1'),
    'attachment removal',
  );
  assert.deepEqual(exceptions, []);
  await evaluate(
    `document.querySelector('.activity-bar [aria-label="Chats"]').click()`,
  );
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(".sidebar-panel-heading span")?.textContent === "Chats"',
      ),
    'Chats sidebar view',
  );
  await evaluate(
    `document.querySelector('[aria-label="Reorder Recent chats"]').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', altKey: true, bubbles: true}))`,
  );
  await waitFor(
    () =>
      evaluate(
        'window.piDesktop.bootstrap().then(value => value.preferences.sidebarLayout.sections[0] === "recent")',
      ),
    'saved sidebar order',
  );
  await evaluate(
    `document.querySelector('.activity-bar [aria-label="Chats"]').click()`,
  );
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(".app-shell").classList.contains("is-sidebar-hidden")',
      ),
    'collapsed sidebar',
  );
  await evaluate('location.reload()');
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(".app-shell")?.classList.contains("is-sidebar-hidden")',
      ),
    'persisted collapsed sidebar',
  );
  await evaluate(
    `document.querySelector('.activity-bar [aria-label="Chats"]').click()`,
  );
  await waitFor(
    () =>
      evaluate(
        '!document.querySelector(".app-shell").classList.contains("is-sidebar-hidden")',
      ),
    'restored sidebar',
  );
  await evaluate(
    `document.querySelector('[aria-label="Customize sidebar"]').click()`,
  );
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".sidebar-customize"))'),
    'sidebar customization',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.sidebar-customize button')).find(button => button.textContent === 'Reset sidebar layout').click()`,
  );
  await waitFor(
    () =>
      evaluate(
        'window.piDesktop.bootstrap().then(value => value.preferences.sidebarLayout.panel === "projects" && value.preferences.sidebarLayout.sections[0] === "projects")',
      ),
    'sidebar reset',
  );
  assert.deepEqual(exceptions, []);
  console.log(
    'Electron integration passed: code contrast in both themes and message roles, attachments, sidebar views, keyboard ordering, hide/reopen, persisted layout, reset, and no renderer exceptions.',
  );
}

main()
  .finally(async () => {
    socket?.close();
    if (windows) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else if (child.pid) {
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
        if (signal === 'SIGTERM') await delay(1000);
      }
    }
    rmSync(userDataDir, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error);
    console.error(output);
    process.exitCode = 1;
  });
