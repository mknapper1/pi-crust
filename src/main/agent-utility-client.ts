import path from 'node:path';
import { app, utilityProcess, type UtilityProcess } from 'electron';
import type {
  AgentUiEvent,
  UtilityCommand,
  UtilityResponse,
} from '../shared/contracts';

type CommandInput = UtilityCommand extends infer Command
  ? Command extends { id: string }
    ? Omit<Command, 'id'>
    : never
  : never;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class AgentUtilityClient {
  private child: UtilityProcess | undefined;

  private startPromise: Promise<void> | undefined;

  private pending = new Map<string, PendingRequest>();

  private requestSequence = 0;

  private credentials: Record<string, string> = {};

  private stopping = false;

  private readonly onEvent: (event: AgentUiEvent) => void;

  constructor(onEvent: (event: AgentUiEvent) => void) {
    this.onEvent = onEvent;
  }

  setCredentials(entries: Record<string, string>) {
    this.credentials = { ...entries };
  }

  private send(command: CommandInput): Promise<unknown> {
    if (!this.child) throw new Error('Pi runtime is not running');
    const id = `request-${Date.now()}-${(this.requestSequence += 1)}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child?.postMessage({ ...command, id } satisfies UtilityCommand);
    });
  }

  private handleMessage(message: UtilityResponse) {
    if (message.kind === 'event') {
      this.onEvent(message.event);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(new Error(message.error));
  }

  private rejectPending(message: string) {
    for (const request of this.pending.values()) {
      request.reject(new Error(message));
    }
    this.pending.clear();
  }

  async start() {
    if (this.child) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise<void>((resolve, reject) => {
      const child = utilityProcess.fork(
        path.join(__dirname, 'agent-utility.js'),
        [],
        {
          serviceName: 'Pi Agent Runtime',
          env: {
            ...process.env,
            PI_DESKTOP_APP_PATH: app.isPackaged
              ? app.getAppPath()
              : path.join(process.cwd(), 'release', 'app'),
            PI_DESKTOP_NODE_RUNTIME: process.execPath,
            PI_DESKTOP_NPM_WRAPPER: path.join(
              app.isPackaged
                ? path.join(process.resourcesPath, 'assets')
                : path.join(process.cwd(), 'assets'),
              'npm',
            ),
          },
        },
      );
      const onExitBeforeSpawn = (code: number) => {
        reject(new Error(`Pi runtime exited during startup (${code})`));
      };
      child.once('exit', onExitBeforeSpawn);
      child.once('spawn', () => {
        child.removeListener('exit', onExitBeforeSpawn);
        this.child = child;
        resolve();
      });
      child.on('message', (message: UtilityResponse) => {
        this.handleMessage(message);
      });
      child.on('exit', (code) => {
        const expected = this.stopping;
        if (this.child === child) this.child = undefined;
        this.startPromise = undefined;
        this.stopping = false;
        const message = expected
          ? 'Pi runtime stopped'
          : `Pi runtime stopped unexpectedly (exit ${code})`;
        this.rejectPending(message);
        if (!expected) this.onEvent({ type: 'runtime-crash', error: message });
      });
      child.on('error', (type, location, report) => {
        const message = `Pi runtime crashed: ${type} at ${location}`;
        this.rejectPending(message);
        this.onEvent({
          type: 'runtime-crash',
          error: report ? `${message}\n${report}` : message,
        });
      });
    });
    await this.startPromise;
    await this.send({
      type: 'auth:hydrate',
      payload: { entries: this.credentials },
    });
  }

  async request<T>(command: CommandInput): Promise<T> {
    await this.start();
    return (await this.send(command)) as T;
  }

  async stop() {
    if (!this.child) return;
    const child = this.child;
    this.stopping = true;
    try {
      await this.send({ type: 'shutdown', payload: {} });
    } catch {
      // App shutdown may terminate the child before it acknowledges disposal.
    } finally {
      child.kill();
      this.child = undefined;
      this.startPromise = undefined;
    }
  }
}
