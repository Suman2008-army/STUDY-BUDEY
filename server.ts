import express from 'express';
import type { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const SYSTEM_INSTRUCTION = `
You are an AI who acts as both a supportive, empathetic friend and a highly effective study buddy. 
When the user wants to chat, be warm, friendly, casual, and empathetic. Focus on building rapport.
When the user wants to study (or mentions learning, school, homework, concepts, etc.), switch smoothly to an encouraging, smart tutor persona. 
As a study buddy:
- Ask Socratic questions to guide them to the answer rather than just giving it.
- Break down complex concepts into simple analogies.
- Quiz them if they ask for practice.
- Keep them motivated and focused.
Tone: friendly, encouraging, intelligent, supportive, and accessible. Use markdown for clear organization (lists, code blocks, bold text, etc.) when explaining concepts.
`;

// Stream endpoint for real-time chat replies
app.post('/api/chat/stream', async (req: Request, res: Response) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Messages array is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const contents = messages.map((msg: { role: string; content: string }) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }],
  }));

  try {
    let streamedSuccessfully = false;

    // Attempt streaming if supported by the proxy
    try {
      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-3.8-flash',
        contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
        },
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          streamedSuccessfully = true;
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
    } catch (streamErr: any) {
      console.warn('Direct stream not supported, using generateContent fallback:', streamErr?.message);
    }

    // If streaming was disabled or yielded no content, gracefully run unary generateContent
    if (!streamedSuccessfully) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
        },
      });

      const fullText = response.text || '';
      // Stream words with tiny delay for progressive UI rendering
      const tokens = fullText.split(/(\s+)/);
      for (const token of tokens) {
        if (token) {
          res.write(`data: ${JSON.stringify({ text: token })}\n\n`);
          await new Promise((r) => setTimeout(r, 15));
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('Error generating content:', error);
    const errorMessage = error?.message || 'Error communicating with Gemini';
    res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
    res.end();
  }
});

// Non-streaming endpoint fallback
app.post('/api/chat', async (req: Request, res: Response) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Messages array is required' });
    return;
  }

  const contents = messages.map((msg: { role: string; content: string }) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }],
  }));

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error('Error in /api/chat:', error);
    res.status(500).json({ error: error?.message || 'Failed to generate response' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
