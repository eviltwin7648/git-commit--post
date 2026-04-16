import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

export const draftQueue = new Queue('draft-generation', { connection });
export const telegramQueue = new Queue('telegram-notification', { connection });
export const publishQueue = new Queue('publishing', { connection });
