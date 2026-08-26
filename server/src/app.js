import express from 'express';
import { requestCompletion, requestCompletionStream, validateMessages } from './chat.js';

export function createApp({ apiKey, fetchImpl = fetch, model = 'deepseek-chat' } = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.post('/api/chat', async (req, res) => {
    const validation = validateMessages(req.body?.messages);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      const message = await requestCompletion(validation.messages, { apiKey, fetchImpl, model });
      return res.json({ message });
    } catch (error) {
      return res.status(error.status ?? 502).json({
        error: error.message ?? '请求失败，请稍后重试。',
      });
    }
  });

  app.post('/api/chat/stream', async (req, res) => {
    const validation = validateMessages(req.body?.messages);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.flushHeaders();

    try {
      for await (const event of requestCompletionStream(validation.messages, { apiKey, fetchImpl, model })) {
        res.write(`event: delta\ndata: ${JSON.stringify({ content: event.content })}\n\n`);
      }
      res.write('event: done\ndata: {}\n\n');
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({
        message: error.message ?? 'AI 服务暂时不可用，请稍后重试。',
      })}\n\n`);
    }

    return res.end();
  });

  return app;
}
