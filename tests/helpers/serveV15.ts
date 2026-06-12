import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type StdioOptions,
} from 'node:child_process';

const SERVE_ARGS = ['--import', 'tsx', 'scripts/serve-v15-vertical-slice.ts'] as const;
const liveChildren = new Set<ChildProcessWithoutNullStreams>();
let handlersInstalled = false;

function killLiveChildren(signal: NodeJS.Signals): void {
  for (const child of liveChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill(signal);
      } catch {
        // child already gone
      }
    }
  }
}

function installExitHandlers(): void {
  if (handlersInstalled) {
    return;
  }
  handlersInstalled = true;
  // Last-resort reaper: synchronous SIGKILL on graceful test-process exit.
  // A SIGKILLed parent runs no handlers; that path is covered server-side.
  process.once('exit', () => killLiveChildren('SIGKILL'));
  process.once('SIGINT', () => {
    killLiveChildren('SIGTERM');
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    killLiveChildren('SIGTERM');
    process.exit(143);
  });
}

export function spawnServeV15Process(options: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
}): ChildProcessWithoutNullStreams {
  installExitHandlers();
  const child = spawn('node', [...SERVE_ARGS], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
      KERF_PARENT_STDIN_WATCH: '1',
    },
    detached: false,
    stdio: options.stdio ?? ['pipe', 'pipe', 'pipe'],
  });
  liveChildren.add(child);
  child.once('exit', () => {
    liveChildren.delete(child);
  });
  return child;
}

export async function stopServeV15Process(
  child: ChildProcessWithoutNullStreams,
  graceMs = 250,
): Promise<void> {
  child.stdin.end();
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
}
