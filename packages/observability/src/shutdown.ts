import type { Logger } from './logger.js';

export type ShutdownHandler = () => Promise<void> | void;

export function registerGracefulShutdown(
  logger: Logger,
  handlers: ShutdownHandler[],
  signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'],
): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'graceful shutdown started');
    for (const handler of handlers) {
      try {
        await handler();
      } catch (error) {
        logger.error({ err: error }, 'shutdown handler failed');
      }
    }
    logger.info('graceful shutdown complete');
    process.exit(0);
  };

  for (const signal of signals) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}
