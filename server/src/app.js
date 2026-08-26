import express from 'express';
import { requestCompletion, requestCompletionStream, validateMessages } from './chat.js';
import { queryRailTickets } from './railway.js';
import { extractDestinationCity, extractTravelDate, normalizeRailTickets } from './travel.js';

function withTransportInstruction(messages, card) {
  if (!card) return messages;
  return [{ role: 'system', content: `你是交通推荐助手。只输出前往目的地的高铁推荐，不生成飞机、行程、酒店或其他方案。优先遵循聊天中已提及的交通方式。只使用以下由12306实时查询得到的候选班次，班次、站点、时间、价格和余票必须完全一致；如果数据不足请直接说明，不要编造：${JSON.stringify(card)}。` }, ...messages];
}
function withHotelInstruction(messages, hotels) {
  if (!hotels) return messages;
  return [{ role: 'system', content: `只输出酒店推荐、对应房型、距离提示和推荐理由，不输出交通或行程。只推荐靠近地铁站或商圈、且每晚价格不超过700元的房型。仅使用以下数据并保持一致：${JSON.stringify(hotels)}。` }, ...messages];
}

export function createApp({ apiKey, fetchImpl = fetch, model = 'deepseek-v4-flash', railwayQuery = queryRailTickets } = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.post('/api/rail-tickets', async (req, res) => {
    const { chatRecords } = req.body ?? {};
    const fromCity = '苏州';
    const toCity = extractDestinationCity(chatRecords);
    const date = extractTravelDate(chatRecords);
    if (!toCity || !date) return res.status(400).json({ error: '聊天记录中未识别到目的地城市或出发日期' });
    try {
      const tickets = await railwayQuery({ date, fromCity, toCity });
      if (!Array.isArray(tickets)) throw new Error('12306 未返回有效的车次数据，请更换日期后重试');
      return res.json({ fromCity, toCity, tickets, options: normalizeRailTickets(tickets) });
    } catch (error) {
      return res.status(502).json({ error: error.message || '12306 查询失败，请稍后重试' });
    }
  });

  app.post('/api/chat', async (req, res) => {
    const validation = validateMessages(req.body?.messages);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      const message = await requestCompletion(withHotelInstruction(withTransportInstruction(validation.messages, req.body?.transportCard), req.body?.hotelOptions), { apiKey, fetchImpl, model });
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
      for await (const event of requestCompletionStream(withHotelInstruction(withTransportInstruction(validation.messages, req.body?.transportCard), req.body?.hotelOptions), { apiKey, fetchImpl, model })) {
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
