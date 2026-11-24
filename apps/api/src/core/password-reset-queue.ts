import { Queue } from 'bullmq';
import { redisConnection } from './config.js';

export const passwordResetQueueName = 'nthub-password-reset';
let resetQueue: Queue | undefined;

export async function enqueuePasswordReset(email: string) {
  resetQueue ??= new Queue(passwordResetQueueName, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 15000 },
      removeOnComplete: true,
      removeOnFail: 50,
    },
  });
  // Identical public work for every syntactically valid address. No credentials in Redis.
  await resetQueue.add('send', { email });
}

export async function closePasswordResetQueue() {
  await resetQueue?.close();
  resetQueue = undefined;
}
