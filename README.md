# Crust

Crust is an independent Electron interface for the [Pi coding agent](https://github.com/earendil-works/pi). It keeps Pi’s supported SDK in charge of model requests, tools, context, and sessions while providing a native-feeling project sidebar, streamed chat, tool activity, and persistent composer. Crust is not an official Pi application.

## Requirements

- Node.js 24 or newer
- npm 10 or newer
- macOS, Windows, or Linux supported by Electron
- Credentials supported by Pi, either already configured for Pi or added in Crust

The Pi SDK is pinned to `@earendil-works/pi-coding-agent@1.0.0` and included with packaged builds. A global Pi CLI or npm installation is not required. Packaged builds use Electron's embedded Node runtime and the included npm client for package operations; Git sources still require an accessible Git installation.

## Development

```bash
npm install
npm start
```

Useful verification commands:

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
npm run test:smoke
```

Create an installer for the current host platform:

```bash
npm run package
```

Artifacts are written to `release/build/`.

## Credentials

Crust reuses credentials and configuration that Pi’s SDK can already resolve. If no model is available, open **Settings** and save a provider API key.

New keys are encrypted with Electron `safeStorage`, backed by the operating system credential facility. On Linux, the app rejects the `basic_text` backend. If protected storage is unavailable, Crust refuses to save the key instead of falling back to plaintext. Decrypted values are sent only from the main process to the isolated Pi utility process; they are never returned to the renderer, written to conversation history, or intentionally logged.

OAuth onboarding is not included in this first version. Existing Pi authentication remains available wherever the SDK supports it.

## Architecture

Crust keeps three distinct trust boundaries:

1. **Renderer:** React UI with no Node integration. Model text is rendered as Markdown without raw HTML. External links go through a validated main-process operation.
2. **Main process:** owns windows, the native folder picker, protected credentials, preferences, IPC validation, and utility-process lifecycle.
3. **Utility process:** loads the official Pi coding-agent SDK, creates sessions with an explicit project directory, streams SDK events, runs tools, and reads or writes Pi sessions.

The preload exposes a narrow typed API for projects, conversations, chat, models, Pi packages, preferences, and credentials. IPC callers, frames, payloads, and external URL schemes are validated. Renderer sandboxing and context isolation are enabled, Node integration is disabled, navigation and webviews are blocked, and browser permissions are denied.

Pi’s own persisted sessions are the source of truth for conversation history and names. Crust separately stores only presentation metadata:

- recent projects
- archived conversation paths
- sidebar width
- theme preference

Crust appends its concise chat-response guidance through Pi’s resource loader. Pi’s core coding prompt, user prompt additions, project instructions, tools, and skills remain intact.

Selecting a project sets Pi’s working directory. It does not create an operating system sandbox. When a folder contains protected Pi project resources, Crust uses Pi’s standard project trust inspection and trust store before those resources are loaded. Project instructions retain Pi’s normal behavior.

## Using the app

1. Choose **Open project** and select a folder.
2. Review the Pi project-trust prompt when protected project resources are present.
3. Select an available model and thinking level when supported.
4. Send a message with Enter, or insert a newline with Shift+Enter.
5. Expand tool rows to inspect inputs and output. Use **Stop** to cancel the active run.

### Extensions and packages

Open **Extensions** to inspect every package configured in Pi's personal and project settings, including packages installed from terminal Pi. Install npm specs, Git URLs, or local folders without opening a terminal. Package changes use Pi's package manager and settings directly, so they are visible in both Crust and terminal Pi. Personal changes affect terminal Pi too; project packages remain subject to Pi's project-trust decision.

Crust waits until the agent is idle before installing, updating, removing, enabling, or disabling a package. A successful install and a successful runtime load are reported separately. Extension commands, prompts, and skills appear in the composer when you type `/`.

Standard RPC-style extension UI is supported: selections, confirmations, single-line input, multiline editing, notifications, status entries, text widgets, window titles, and composer text requests. Replacing a non-empty draft always requires an explicit choice. Terminal-only custom components, raw terminal input, custom headers and footers, editor replacements, theme switching, and terminal tool-expansion controls are intentionally unsupported, matching [Pi's RPC extension UI limitations](https://pi.dev/docs/latest/rpc-extension-ui).

Only one generation can run at a time. Project and conversation switching stays disabled until the run settles or is explicitly stopped. Drafts are preserved per conversation for the lifetime of the app process.

## Current scope and limitations

- One local Pi runtime and one active generation at a time
- No built-in OAuth onboarding
- Package discovery uses npm's `pi-package` metadata and links to the Pi package gallery; there is no separate Crust marketplace or compatibility feed
- Compatibility labels describe Crust behavior only. They are not a security review or endorsement, and unknown packages remain labeled **Unknown**
- No cloud sync, accounts, billing, worktree management, code editor, or automatic executable-code updates
- Project selection is a working-directory boundary, not a permission boundary
- App preferences and drafts are local; drafts are not persisted across full app restarts

Provider behavior still depends on the selected model, network access, credentials, and Pi SDK capabilities. Errors and runtime crashes are surfaced in the conversation view with actionable text, and partial assistant output is retained when Pi emits it during cancellation or failure.
