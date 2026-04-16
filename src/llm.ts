import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

// simple style rotation (you can randomize later)
const styles = ["direct", "problem-solution", "reflective", "quick-update"];
const selectedStyle = styles[Math.floor(Math.random() * styles.length)];

export async function generateDrafts(context: {
  repo: string,
  commitHash: string,
  message: string,
  diffSummary?: string,
  isEdit?: boolean,
  xDraft?: string,
  linkedinDraft?: string,
  instruction?: string
}) {

    const prompt = context.isEdit 
        ? `
You are a backend engineer editing your own social media posts.

Repository: ${context.repo}

Existing X Draft:
${context.xDraft}

Existing LinkedIn Draft:
${context.linkedinDraft}

User Instruction:
${context.instruction}

Your job:
- Apply the instruction to BOTH drafts
- Keep the tone natural and developer-like
- Do not make it sound corporate

Rules:
- No emojis
- Avoid corporate phrases ("Proud to share", "Excited to announce", etc.)
- Keep it specific and grounded
- Do not introduce new generic fluff
- Slight imperfection is okay

Return JSON:
{
  "should_post": true,
  "x_draft": "...",
  "linkedin_draft": "..."
}
`
        : `
You are a backend engineer sharing your own work publicly.

Repository: ${context.repo}
Commit Message: ${context.message}
Change Summary: ${context.diffSummary || 'Not available'}

Style: ${selectedStyle}

Your job:

Step 1: Decide if this is worth sharing.

Do NOT post if:
- trivial (test, typo, formatting)
- no meaningful functional/architectural change

If NOT worth sharing:
Return:
{
  "should_post": false,
  "reason": "low_signal_commit"
}

Step 2: If worth sharing, write like a real developer.

Writing rules:
- No emojis
- No corporate/marketing tone
- Avoid phrases:
  "Proud to share", "Excited to announce", "significant update"
- Avoid starting with:
  "Just pushed", "Spent some time", "This update", "The goal is"
- Avoid vague phrases:
  "improved reliability", "more robust", "enhanced performance"
- Be concrete (mention retry logic, queue, bug, failure case, etc.)
- Slightly informal is okay
- Do NOT repeat the commit message

Style guidelines:
- direct: straight, minimal
- problem-solution: what was broken → what changed
- reflective: what you noticed/learned
- quick-update: short devlog

Write:

1. X post:
- concise
- 1–2 lines max
- should feel like a real dev log

2. LinkedIn post:
- slightly more detailed
- still natural, not corporate
- optional small context if useful

Return JSON:
{
  "should_post": true,
  "x_draft": "...",
  "linkedin_draft": "..."
}
`;

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.8, // important for variation
            }
        });

        const response = await result.response;
        const text = response.text();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }

        throw new Error('Failed to parse LLM output');

    } catch (error) {
        console.error('Error generating drafts:', error);
        throw error;
    }
}
