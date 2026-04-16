import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { generateDrafts } from './llm.js';
import { telegramQueue } from './queue.js';
import { TwitterApi } from 'twitter-api-v2';
import dotenv from 'dotenv';

dotenv.config();

const twitterClient = new TwitterApi({
    appKey: process.env.X_API_KEY || '',
    appSecret: process.env.X_API_SECRET || '',
    accessToken: process.env.X_ACCESS_TOKEN || '',
    accessSecret: process.env.X_ACCESS_SECRET || '',
});

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});
const prisma = new PrismaClient();

const draftWorker = new Worker('draft-generation', async (job) => {
    const { repo, commitHash, message, diffSummary, isEdit } = job.data;
    console.log(`${isEdit ? 'Updating' : 'Evaluating'} drafts for ${commitHash}...`);

    try {
        const result = await generateDrafts({ repo, commitHash, message, diffSummary, isEdit });
        
        if (!result.should_post) {
            console.log(`Skipping commit ${commitHash}: ${result.reason}`);
            await prisma.post.update({
                where: { commitHash },
                data: { status: 'ignored' }
            });
            return;
        }

        const data: any = {
            status: isEdit ? 'edited' : 'generated'
        };

        if (isEdit) {
            data.updatedXDraft = result.x_draft;
            data.updatedLinkedinDraft = result.linkedin_draft;
        } else {
            data.xDraft = result.x_draft;
            data.linkedinDraft = result.linkedin_draft;
        }

        await prisma.post.update({
            where: { commitHash },
            data
        });

        console.log(`Drafts ${isEdit ? 'updated' : 'generated'} for ${commitHash}. Enqueuing Telegram notification...`);
        await telegramQueue.add('notify', { commitHash });
    } catch (error) {
        console.error(`Error in draft generation worker for ${commitHash}:`, error);
        await prisma.post.update({
            where: { commitHash },
            data: { status: 'failed' }
        });
        throw error;
    }
}, { connection });

const publishWorker = new Worker('publishing', async (job) => {
    const { commitHash } = job.data;
    console.log(`Publishing commit ${commitHash} to X...`);

    const post = await prisma.post.findUnique({ where: { commitHash } });
    if (!post) return;

    const draft = post.updatedXDraft || post.xDraft;
    if (!draft) {
        console.error(`No draft found for commit ${commitHash}`);
        return;
    }

    try {
        await twitterClient.v2.tweet(draft);
        console.log(`Successfully published to X for commit ${commitHash}`);
        
        await prisma.post.update({
            where: { commitHash },
            data: { status: 'posted' }
        });
    } catch (error) {
        console.error(`Error publishing to X for ${commitHash}:`, error);
        await prisma.post.update({
            where: { commitHash },
            data: { status: 'failed' }
        });
        throw error;
    }
}, { connection });

console.log('Workers started...');
