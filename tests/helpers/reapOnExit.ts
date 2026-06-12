/**
 * Last-resort reaper for child processes spawned by integration tests.
 *
 * Tests that spawn `scripts/serve-v15-vertical-slice.ts` stop it in a
 * try/finally, but that teardown never runs if the test process dies first
 * (uncaught exception, runner abort). A process 'exit' hook is the last code
 * that runs on every graceful exit path, so any still-live child is SIGKILLed
 * there ('exit' handlers must be synchronous — no room for SIGTERM grace).
 *
 * A SIGKILLed test process runs no handlers at all; that path is covered
 * server-side by the orphan guard in scripts/serve-v15-vertical-slice.ts
 * (stdin-pipe watch + ppid poll), which requires the child to be spawned with
 * stdio[0]='pipe' and detached:false. Observed 2026-06-11 before this fix:
 * three SIGKILLed runners left 87 live serve-v15 processes for ~4 hours,
 * degrading every later suite run (slowness, port contention, flakes).
 */
import type { ChildProcess } from 'node:child_process';

const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;

/** Track `child`; SIGKILL it on process exit if it is still running. */
export function reapOnExit<T extends ChildProcess>(child: T): T {
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => {
      for (const c of liveChildren) {
        if (c.exitCode === null && c.signalCode === null) {
          try {
            c.kill('SIGKILL');
          } catch {
            // child already gone — nothing to reap
          }
        }
      }
      liveChildren.clear();
    });
  }
  liveChildren.add(child);
  child.once('exit', () => {
    liveChildren.delete(child);
  });
  return child;
}
