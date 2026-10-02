const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const port = Number(process.env.EXTENSION_SMOKE_PORT || 1214);
const debugPort = Number(process.env.EXTENSION_SMOKE_DEBUG_PORT || 9336);
const packagedApp = process.env.EXTENSION_SMOKE_APP;
const windows = process.platform === 'win32';
const root = mkdtempSync(join(tmpdir(), 'pi-desktop-extension-smoke-'));
const projectDir = join(root, 'project');
const agentDir = join(root, 'agent');
const packageDir = join(root, 'desktop-demo-package');
const brokenPackageDir = join(root, 'broken-demo-package');
const crashPackageDir = join(root, 'crash-demo-package');
mkdirSync(projectDir, { recursive: true });
mkdirSync(join(packageDir, 'extensions'), { recursive: true });
mkdirSync(join(packageDir, 'skills', 'desktop-smoke-skill'), {
  recursive: true,
});
mkdirSync(join(packageDir, 'prompts'), { recursive: true });
mkdirSync(join(brokenPackageDir, 'extensions'), { recursive: true });
mkdirSync(join(crashPackageDir, 'extensions'), { recursive: true });
writeFileSync(
  join(packageDir, 'package.json'),
  JSON.stringify({
    name: 'desktop-demo-package',
    version: '1.0.0',
    type: 'module',
    keywords: ['pi-package'],
  }),
);
writeFileSync(
  join(packageDir, 'extensions', 'desktop-demo.ts'),
  `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
  export default function (pi: ExtensionAPI) {
    pi.on('session_start', async (_event, ctx) => {
      ctx.ui.setTitle('Crust extension smoke');
      ctx.ui.setStatus('desktop-demo', 'Ready');
      ctx.ui.setWidget('desktop-demo', ['Interactive extension loaded']);
      ctx.ui.setWidget('terminal-only', (() => undefined) as never);
    });
    pi.registerCommand('desktop-input', {
      description: 'Ask for desktop input',
      handler: async (_args, ctx) => {
        const answer = await ctx.ui.input('Extension input', 'Type an answer');
        ctx.ui.notify(answer ? 'Extension received: ' + answer : 'Extension cancelled');
      },
    });
    pi.registerCommand('desktop-replace', {
      description: 'Propose replacing a desktop draft',
      handler: async (_args, ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 750));
        ctx.ui.setEditorText('Extension replacement');
      },
    });
  }`,
);
writeFileSync(
  join(packageDir, 'extensions', 'tool-only.ts'),
  `import { Type } from 'typebox';
  import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
  export default function (pi: ExtensionAPI) {
    pi.registerTool({
      name: 'desktop_smoke_tool',
      label: 'Desktop smoke tool',
      description: 'Tool-only extension used by the Desktop integration test',
      parameters: Type.Object({}),
      exposure: 'hidden',
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }], details: {} };
      },
    });
  }`,
);
writeFileSync(
  join(packageDir, 'extensions', 'provider.ts'),
  `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
  export default function (pi: ExtensionAPI) {
    pi.registerProvider('desktop-smoke', {
      name: 'Desktop smoke provider',
      models: [],
    });
  }`,
);
writeFileSync(
  join(packageDir, 'extensions', 'peer-imports.js'),
  `import { buildSessionContext } from '@earendil-works/pi-coding-agent';
  import { Box, Text, truncateToWidth } from '@earendil-works/pi-tui';

  export default function (pi) {
    if ([buildSessionContext, Box, Text, truncateToWidth].some((value) => typeof value !== 'function')) {
      throw new Error('Pi host peer imports were not resolved');
    }
    pi.registerCommand('desktop-peer-imports', {
      description: 'Confirm compiled extensions can import Pi host modules',
      handler: async (_args, ctx) => ctx.ui.notify('Pi host imports loaded'),
    });
  }`,
);
writeFileSync(
  join(packageDir, 'skills', 'desktop-smoke-skill', 'SKILL.md'),
  `---
name: desktop-smoke-skill
description: Skill resource used by the Desktop integration test
---

# Desktop smoke skill

Confirm that packaged skill resources load.
`,
);
writeFileSync(
  join(packageDir, 'prompts', 'desktop-smoke-prompt.md'),
  `---
description: Prompt resource used by the Desktop integration test
---

Confirm that packaged prompt resources load: $@
`,
);
writeFileSync(
  join(brokenPackageDir, 'package.json'),
  JSON.stringify({
    name: 'broken-demo-package',
    version: '1.0.0',
    type: 'module',
    keywords: ['pi-package'],
  }),
);
writeFileSync(
  join(brokenPackageDir, 'extensions', 'broken.ts'),
  `throw new Error('broken package smoke');
  export default function () {}`,
);
writeFileSync(
  join(crashPackageDir, 'package.json'),
  JSON.stringify({
    name: 'crash-demo-package',
    version: '1.0.0',
    type: 'module',
    keywords: ['pi-package'],
  }),
);
writeFileSync(
  join(crashPackageDir, 'extensions', 'crash.ts'),
  `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
  export default function (pi: ExtensionAPI) {
    pi.on('session_start', () => process.exit(23));
  }`,
);

const child = spawn(
  packagedApp || join(dirname(process.execPath), windows ? 'npm.cmd' : 'npm'),
  packagedApp
    ? [
        `--remote-debugging-port=${debugPort}`,
        ...(process.env.CI && process.platform === 'linux'
          ? ['--no-sandbox']
          : []),
      ]
    : [
        'start',
        '--',
        '--remoteDebuggingPort',
        String(debugPort),
        ...(process.env.CI && process.platform === 'linux'
          ? ['--noSandbox']
          : []),
      ],
  {
    detached: !windows,
    shell: windows,
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}:${process.env.PATH || ''}`,
      PORT: String(port),
      PI_CODING_AGENT_DIR: agentDir,
      PI_DESKTOP_USER_DATA_DIR: join(root, 'user-data'),
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

async function waitFor(check, description, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited)
      throw new Error(
        `${packagedApp ? 'Packaged app' : 'npm start'} exited before ${description}`,
      );
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
          (packagedApp
            ? entry.url.startsWith('file:')
            : entry.url.startsWith(`http://localhost:${port}`)),
      );
    } catch {
      return undefined;
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
    const resolve = requests.get(message.id);
    if (resolve) {
      resolve(message);
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

  async function setComposer(text) {
    return evaluate(`(() => {
      const textarea = document.querySelector('.composer textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, ${JSON.stringify(text)});
      textarea.dispatchEvent(new Event('input', {bubbles: true}));
    })()`);
  }

  async function submitComposer(text) {
    await setComposer(text);
    await waitFor(
      () =>
        evaluate(
          'document.querySelector(".composer .send-button")?.disabled === false',
        ),
      `send control for ${text}`,
    );
    await evaluate('document.querySelector(".composer .send-button").click()');
  }

  await send('Runtime.enable');
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".app-shell"))'),
    'Crust shell',
  );
  await evaluate(
    `window.piDesktop.openProject({path: ${JSON.stringify(projectDir)}})`,
  );
  await evaluate('location.reload()');
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".composer textarea"))'),
    'project composer',
  );

  const result = await evaluate(
    `window.piDesktop.installPackage(${JSON.stringify(packageDir)}, 'project')`,
  );
  assert.equal(
    result.inventory.capabilities.npm.available,
    true,
    JSON.stringify(result.inventory.capabilities.npm),
  );
  assert.equal(result.installedSuccessfully, true);
  assert.equal(result.loadedSuccessfully, true, JSON.stringify(result));
  const installedPackage = result.inventory.packages.find(
    (item) => item.name === 'desktop-demo-package',
  );
  assert.deepEqual(
    new Set(installedPackage.resources.map((item) => item.type)),
    new Set(['extensions', 'skills', 'prompts']),
  );
  assert.equal(
    installedPackage.resources.some((item) => item.name === 'tool-only'),
    true,
  );
  assert.equal(
    installedPackage.resources.some((item) => item.name === 'provider'),
    true,
  );
  assert.equal(
    installedPackage.resources.some((item) => item.name === 'peer-imports'),
    true,
  );
  try {
    await waitFor(
      () => evaluate('document.title === "Crust extension smoke"'),
      'extension session UI',
      20_000,
    );
  } catch (error) {
    const debugState = await evaluate(`Promise.all([
      window.piDesktop.listPackages(),
      Promise.resolve({title: document.title, body: document.body.innerText.slice(-2000)})
    ])`);
    throw new Error(`${error.message}: ${JSON.stringify(debugState)}`, {
      cause: error,
    });
  }
  assert.equal(
    await evaluate(
      'document.querySelector(".extension-widget")?.textContent.includes("Interactive extension loaded")',
    ),
    true,
  );
  assert.equal(
    await evaluate(
      'Array.from(document.querySelectorAll(".extension-notice")).some((notice) => notice.textContent.includes("terminal-only custom widget"))',
    ),
    true,
  );

  await evaluate(
    `document.querySelector('button[aria-label="Extensions"]').click()`,
  );
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(".package-card")?.textContent.includes("desktop-demo-package") && document.querySelector(".package-card")?.textContent.includes("Loaded")',
      ),
    'installed package screen',
  );
  await evaluate(`Array.from(document.querySelectorAll('button'))
    .find((button) => button.textContent.trim() === 'Done').click()`);
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".composer textarea"))'),
    'composer after package screen',
  );

  await setComposer('/');
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(".command-autocomplete")?.textContent.includes("/desktop-input")',
      ),
    'extension command autocomplete',
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".command-autocomplete")?.textContent.includes("/desktop-peer-imports")',
    ),
    true,
  );
  await submitComposer('/desktop-input');
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(".extension-dialog h2")?.textContent === "Extension input"',
      ),
    'extension input dialog',
  );
  await evaluate(`(() => {
    const input = document.querySelector('.extension-dialog input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Desktop answer');
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.form.requestSubmit();
  })()`);
  await waitFor(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll(".extension-notice")).some((notice) => notice.textContent.includes("Extension received: Desktop answer"))',
      ),
    'extension response notification',
  );

  await submitComposer('/desktop-input');
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(".extension-dialog h2")?.textContent === "Extension input"',
      ),
    'second extension input dialog',
  );
  await evaluate(`Array.from(document.querySelectorAll('.extension-dialog button'))
    .find((button) => button.textContent.trim() === 'Cancel').click()`);
  await waitFor(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll(".extension-notice")).some((notice) => notice.textContent.includes("Extension cancelled"))',
      ),
    'extension input cancellation',
  );

  await submitComposer('/desktop-replace');
  await setComposer('Keep this user draft');
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(".composer-proposal")?.textContent.includes("replace your current draft")',
      ),
    'safe composer replacement proposal',
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".composer textarea")?.value === "Keep this user draft"',
    ),
    true,
  );
  await evaluate(
    `document.querySelector('.composer-proposal button[aria-label="Dismiss composer suggestion"]').click()`,
  );

  const userInstall = await evaluate(
    `window.piDesktop.installPackage(${JSON.stringify(packageDir)}, 'user')`,
  );
  assert.equal(
    userInstall.installedSuccessfully,
    true,
    JSON.stringify(userInstall),
  );
  assert.deepEqual(
    new Set(
      userInstall.inventory.packages
        .filter((item) => item.name === 'desktop-demo-package')
        .map((item) => item.scope),
    ),
    new Set(['user', 'project']),
  );
  const userPackage = userInstall.inventory.packages.find(
    (item) => item.name === 'desktop-demo-package' && item.scope === 'user',
  );
  const afterUserRemoval = await evaluate(
    `window.piDesktop.removePackage(${JSON.stringify(userPackage.source)}, 'user')`,
  );
  assert.equal(
    afterUserRemoval.inventory.packages.some(
      (item) =>
        item.name === 'desktop-demo-package' && item.scope === 'project',
    ),
    true,
  );

  await evaluate(
    `window.piDesktop.openProject({path: ${JSON.stringify(projectDir)}, trusted: false})`,
  );
  const blockedInventory = await evaluate('window.piDesktop.listPackages()');
  assert.equal(blockedInventory.projectTrusted, false);
  assert.equal(
    blockedInventory.packages.find(
      (item) =>
        item.name === 'desktop-demo-package' && item.scope === 'project',
    ).state,
    'blocked',
  );
  await assert.rejects(
    () =>
      evaluate(
        `window.piDesktop.installPackage(${JSON.stringify(brokenPackageDir)}, 'project')`,
      ),
    /Trust the open project/,
  );
  await evaluate(
    `window.piDesktop.openProject({path: ${JSON.stringify(projectDir)}, trusted: true})`,
  );
  await waitFor(
    () => evaluate('document.title === "Crust extension smoke"'),
    'extension rebound after project trust change',
  );

  await evaluate(
    `document.querySelector('button[aria-label="Extensions"]').click()`,
  );
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".install-row input"))'),
    'install source input',
  );
  await evaluate(`(() => {
    const input = document.querySelector('.install-row input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(join(root, 'missing-package'))});
    input.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
  await evaluate(`Array.from(document.querySelectorAll('.install-row button'))
    .find((button) => button.textContent.includes('Install')).click()`);
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(".package-confirm h2")?.textContent === "Install executable package?"',
      ),
    'install confirmation',
  );
  await evaluate(`Array.from(document.querySelectorAll('.package-confirm button'))
    .find((button) => button.textContent.trim() === 'Install package').click()`);
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".error-banner"))'),
    'visible installation failure',
  );
  await evaluate(`Array.from(document.querySelectorAll('button'))
    .find((button) => button.textContent.trim() === 'Done').click()`);

  await waitFor(
    () => evaluate('Boolean(document.querySelector(".composer .send-button"))'),
    'idle state after extension command',
  );
  const brokenResult = await evaluate(
    `window.piDesktop.installPackage(${JSON.stringify(brokenPackageDir)}, 'project')`,
  );
  assert.equal(brokenResult.installedSuccessfully, true);
  assert.equal(brokenResult.loadedSuccessfully, false);
  const brokenPackage = brokenResult.inventory.packages.find(
    (item) => item.name === 'broken-demo-package',
  );
  assert.equal(brokenPackage.state, 'failed');
  assert.equal(
    brokenPackage.errors.some((error) =>
      error.includes('broken package smoke'),
    ),
    true,
  );
  await evaluate(
    `document.querySelector('button[aria-label="Extensions"]').click()`,
  );
  await waitFor(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll(".package-card")).some((card) => card.textContent.includes("broken-demo-package") && card.textContent.includes("broken package smoke"))',
      ),
    'visible package failure',
  );
  await evaluate(
    `window.piDesktop.removePackage(${JSON.stringify(brokenPackage.source)}, 'project')`,
  );

  await assert.rejects(
    () =>
      evaluate(
        `window.piDesktop.installPackage(${JSON.stringify(crashPackageDir)}, 'project')`,
      ),
    /Pi runtime stopped unexpectedly/,
  );
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(".error-banner")?.textContent.includes("Pi runtime stopped unexpectedly")',
      ),
    'visible utility-process crash',
  );

  assert.deepEqual(exceptions, []);
  console.log(
    'Electron extension integration passed: bundled npm, interactive/tool/provider/skill/prompt resources, terminal-only warnings, safe composer replacement, cancellation, trust blocking, conflicting scopes, install/load failures, utility crash reporting, reload, Installed UI, slash discovery, input response, and notification.',
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
    rmSync(root, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error);
    console.error(output);
    process.exitCode = 1;
  });
