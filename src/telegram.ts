import { Telegraf, Markup } from 'telegraf';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { publishQueue, draftQueue } from './queue.js';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');
const prisma = new PrismaClient();
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Worker for Telegram Notifications
const telegramWorker = new Worker('telegram-notification', async (job) => {
    const { commitHash } = job.data;
    if (!commitHash) return;

    const post = await prisma.post.findUnique({ where: { commitHash: commitHash as string } });
    
    if (!post || !CHAT_ID) {
        console.warn(`No post or CHAT_ID found for commit ${commitHash}`);
        return;
    }

    const messageText = `
📦 *Repo:* ${post.repo}
🔗 *Commit:* \`${commitHash.substring(0, 7)}\`

🐦 *X Draft:*
${post.updatedXDraft || post.xDraft}

💼 *LinkedIn Draft:*
${post.updatedLinkedinDraft || post.linkedinDraft}
    `;

    await bot.telegram.sendMessage(CHAT_ID, messageText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Approve', `approve:${commitHash}`)],
            [Markup.button.callback('✏️ Edit', `edit:${commitHash}`)]
        ])
    });

    await prisma.post.update({
        where: { commitHash: commitHash as string },
        data: { status: 'sent' }
    });
}, { connection });

// Telegram Bot Handlers
bot.start((ctx) => {
    ctx.reply(`Welcome! Your Chat ID is ${ctx.chat.id}. Please add this to your .env as TELEGRAM_CHAT_ID.`);
    console.log(`Chat ID: ${ctx.chat.id}`);
});

bot.action(/approve:(.*)/, async (ctx) => {
    const commitHash = ctx.match[1];
    if (!commitHash) return;

    await prisma.post.update({
        where: { commitHash: commitHash as string },
        data: { status: 'approved' }
    });
    
    await publishQueue.add('publish', { commitHash });
    await ctx.answerCbQuery('Approved! Publishing to X...');
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply('🚀 Approved and enqueued for publishing.');
});

bot.action(/edit:(.*)/, async (ctx) => {
    const commitHash = ctx.match[1];
    if (!commitHash) return;

    await ctx.answerCbQuery('Send me your instructions for editing.');
    // We include the full hash in the message so we can find it later even if short hash is ambiguous
    await ctx.reply(`Please reply to this message with your instructions for commit:
\`${commitHash}\``, {
        parse_mode: 'Markdown',
        reply_markup: { force_reply: true }
    });
});

bot.on('text', async (ctx) => {
    const message = ctx.message;
    
    // Check if this is a reply to one of the bot's messages
    if (message.reply_to_message && 'text' in message.reply_to_message) {
        const replyText = message.reply_to_message.text || '';
        console.log(`User replied to: "${replyText.substring(0, 50)}..."`);

        // Look for the commit hash in the replied-to message
        // Support 6-40 chars to accommodate manual test hashes like 'abc123'
        const hashMatch = replyText.match(/([a-f0-9]{6,40})/i);
        
        if (hashMatch) {
            const matchedHash = hashMatch[1];
            console.log(`Detected commit hash from reply: ${matchedHash}`);

            const post = await prisma.post.findFirst({
                where: {
                    OR: [
                        { commitHash: matchedHash },
                        { commitHash: { startsWith: matchedHash } }
                    ]
                }
            });
            
            if (post) {
                const instruction = message.text;
                console.log(`Processing edit instruction for ${post.commitHash}: ${instruction}`);
                await ctx.reply('🔄 Processing your edit instruction...');
                
                // Re-enqueue for draft generation with the LATEST drafts and new instructions
                const currentDrafts = `
X Draft: ${post.updatedXDraft || post.xDraft}
LinkedIn Draft: ${post.updatedLinkedinDraft || post.linkedinDraft}
`;

                await draftQueue.add('generate', {
                    repo: post.repo,
                    commitHash: post.commitHash,
                    message: `${currentDrafts}\n\nUser Instruction: ${instruction}`,
                    isEdit: true
                });
                
                await prisma.post.update({
                    where: { commitHash: post.commitHash },
                    data: { status: 'edited' }
                });
            } else {
                console.warn(`No post found for matched hash: ${matchedHash}`);
            }
        } else {
            console.log('No commit hash found in the replied-to message.');
        }
    }
});

bot.launch().catch(err => {
    console.error('Failed to launch Telegram bot:', err);
});
console.log('Telegram bot launched...');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
