import { Queue } from 'bullmq';
import { redisConnection } from './config.js';
export const queue = new Queue('nthub', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
