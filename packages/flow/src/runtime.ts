import { DefaultLogger, Runtime } from "@temporalio/worker";

let installed = false;

/**
 * Install the Temporal worker Runtime exactly once. The Runtime is a native singleton that throws on
 * a second install; because it persists across a test runner's per-file module isolation (which
 * resets the JS flag), the already-installed error is swallowed and treated as success.
 */
export function ensureRuntime(): void {
  if (installed) return;
  try {
    Runtime.install({ logger: new DefaultLogger("WARN") });
  } catch (err) {
    if (!(err instanceof Error) || !/already been installed/i.test(err.message)) throw err;
  }
  installed = true;
}
