import { Logger } from '@nestjs/common';

const logger = new Logger('AfterCommit');

/** Runs a notification or audit after the business write. Failures stay out of the HTTP result. */
export async function afterCommit(label: string, effect: () => Promise<unknown>) {
  try {
    await effect();
  } catch (error) {
    const message = error instanceof Error ? error.name : 'Error';
    logger.error(`${label} failed after the main operation (${message})`);
  }
}
