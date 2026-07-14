import { AppError } from '@csm/contracts';

import type { Logger } from './logger.js';

export interface DependencyCheck {
  name: string;
  check: () => Promise<void>;
}

export async function waitForDependencies(
  logger: Logger,
  checks: DependencyCheck[],
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  const pending = new Set(checks.map((c) => c.name));

  while (pending.size > 0) {
    for (const dependency of checks) {
      if (!pending.has(dependency.name)) {
        continue;
      }
      try {
        await dependency.check();
        pending.delete(dependency.name);
        logger.info({ dependency: dependency.name }, 'dependency ready');
      } catch (error) {
        logger.warn({ dependency: dependency.name, err: error }, 'dependency not ready yet');
      }
    }

    if (pending.size === 0) {
      return;
    }

    if (Date.now() - started > timeoutMs) {
      throw new AppError({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: `Timed out waiting for dependencies: ${[...pending].join(', ')}`,
        details: { pending: [...pending] },
        retryable: true,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
