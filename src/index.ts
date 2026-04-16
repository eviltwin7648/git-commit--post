import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { draftQueue } from './queue.js';
import './worker.js';
import './telegram.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const prisma = new PrismaClient();

// Middleware to parse JSON and URL-encoded bodies while capturing the raw body for signature verification
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({
  extended: true,
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  }
}));

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

function verifySignature(payload: string, signature: string | undefined) {
  if (!GITHUB_WEBHOOK_SECRET) {
    console.warn('GITHUB_WEBHOOK_SECRET is not set, skipping verification.');
    return true;
  }
  if (!signature) {
    console.warn('No signature header found, skipping verification.');
    return true;
  }
  const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  
  try {
      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch (e) {
      console.error('Signature verification error:', e);
      return false;
  }
}

app.post('/webhook/github', async (req, res) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const rawBody = (req as any).rawBody || '';

  if (!verifySignature(rawBody, signature)) {
    return res.status(401).send('Invalid signature');
  }

  const event = req.headers['x-github-event'];
  console.log(`Received GitHub event: ${event}`);

  // Handle potential URL-encoded payload wrapper or empty body
  let body = req.body;
  if (body && body.payload && typeof body.payload === 'string') {
    try {
      body = JSON.parse(body.payload);
    } catch (e) {
      console.error('Failed to parse URL-encoded payload:', e);
    }
  }

  if (!body || Object.keys(body).length === 0) {
    console.warn('Received empty or unparsed body');
    return res.status(400).send('Empty body received');
  }

  if (event === 'push') {
    const { repository, commits, head_commit } = body;
    
    // Process head_commit or the last commit in the array
    const targetCommit = head_commit || (commits && commits.length > 0 ? commits[commits.length - 1] : null);

    if (targetCommit) {
        const repoName = repository.full_name;
        const commitHash = targetCommit.id;
        const message = targetCommit.message;
        
        console.log(`Processing commit ${commitHash} from ${repoName}`);
        
        // Enqueue Job for Draft Generation
        await draftQueue.add('generate', {
            repo: repoName,
            commitHash: commitHash,
            message: message
        });
        
        // Save post status
        try {
            await prisma.post.upsert({
                where: { commitHash },
                update: {},
                create: {
                    repo: repoName,
                    commitHash: commitHash,
                    status: 'pending'
                }
            });
        } catch (error) {
            console.error('Error saving post:', error);
        }
    } else {
        console.warn('No commits found in push event');
    }
  }

  res.status(200).send('Event received');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening at http://0.0.0.0:${port}`);
});
