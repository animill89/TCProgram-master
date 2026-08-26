import express from 'express';
import { requestCompletion, requestCompletionStream, validateMessages } from './chat.js';
import { queryRailTickets } from './railway.js';
import { queryHotels } from './hotel.js';
import { extractDestinationCity, extractTravelDate, normalizeRailTickets } from './travel.js';

function withTransportInstruction(messages, card, transportOnly = false) {
  if (!card && !transportOnly) return messages;
  if (transportOnly) return [{ role: 'system', content: '你是交通推荐助手。出发地固定为苏州，目的地从聊天记录中识别；不得询问用户从哪里出发。仅输出苏州到目的地的交通推荐，不输出行程、酒店、景点、餐饮或其他内容。优先使用联网搜索的结果，推荐 2 至 3 种合适选择，可包含高铁和飞机，并说明预算适配理由。回复末尾必须附加且只附加一次以下 HTML 注释，数组每项字段必须完整：<!--TRANSPORT_OPTIONS:[{"type":"高铁或飞机","train":"车次或航班号","date":"出发日期","departureTime":"HH:mm","departureStation":"出发站或机场","arrivalTime":"HH:mm","arrivalStation":"到达站或机场","duration":"时长","price":"价格","reason":"推荐理由"}]-->。注释之外仅保留给用户看的交通说明；没有可靠候选时输出空数组，禁止编造。' }, ...messages];
  return [{ role: 'system', content: `你是交通推荐助手。只输出前往目的地的高铁推荐，不生成飞机、行程、酒店或其他方案。优先遵循聊天中已提及的交通方式。只使用以下由12306实时查询得到的候选班次，班次、站点、时间、价格和余票必须完全一致；如果数据不足请直接说明，不要编造：${JSON.stringify(card)}。` }, ...messages];
}

function extractTransportResult(content) {
  const match = content.match(/<!--TRANSPORT_OPTIONS:(\[[\s\S]*?\])-->/);
  if (!match) return { content, options: [] };
  let options = [];
  try {
    const parsed = JSON.parse(match[1]);
    if (Array.isArray(parsed)) options = parsed.filter((option) => option && typeof option === 'object' && ['type', 'train', 'date', 'departureTime', 'departureStation', 'arrivalTime', 'arrivalStation', 'duration', 'price', 'reason'].every((key) => typeof option[key] === 'string'));
  } catch {
    options = [];
  }
  return { content: content.replace(match[0], '').trim(), options };
}
function withHotelInstruction(messages, hotels) {
  if (!hotels) return messages;
  return [{ role: 'system', content: `只输出酒店推荐、对应房型、距离提示和推荐理由，不输出交通或行程。只推荐靠近地铁站或商圈、且每晚价格不超过700元的房型。仅使用以下数据并保持一致：${JSON.stringify(hotels)}。` }, ...messages];
}

function inferHotelPlace(records, destination) {
  if (records.includes('外滩')) return `${destination}外滩`;
  if (records.includes('迪士尼')) return `${destination}迪士尼度假区`;
  if (records.includes('虹桥')) return `${destination}虹桥火车站`;
  return destination;
}

export function createApp({ apiKey, fetchImpl = fetch, model = 'deepseek-v4-flash', railwayQuery = queryRailTickets, hotelQuery = queryHotels, rollingGoApiKey = process.env.ROLLINGGO_API_KEY } = {}) {
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

  app.post('/api/hotels', async (req, res) => {
    const { chatRecords } = req.body ?? {};
    const destination = extractDestinationCity(chatRecords);
    const date = extractTravelDate(chatRecords);
    if (!destination || !date) return res.status(400).json({ error: '聊天记录中未识别到目的地城市或入住日期' });
    const place = inferHotelPlace(chatRecords, destination);
    try {
      const options = await hotelQuery({ apiKey: rollingGoApiKey, date, place, originQuery: chatRecords });
      if (!Array.isArray(options) || options.length === 0) throw new Error('未查询到符合预算的酒店与房型');
      return res.json({ place, options });
    } catch (error) {
      return res.status(502).json({ error: error.message || '酒店查询失败，请稍后重试' });
    }
  });

  app.post('/api/chat', async (req, res) => {
    const validation = validateMessages(req.body?.messages);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      const message = await requestCompletion(withHotelInstruction(withTransportInstruction(validation.messages, req.body?.transportCard, req.body?.transportOnly), req.body?.hotelOptions), { apiKey, fetchImpl, model });
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
      const transportOnly = Boolean(req.body?.transportOnly);
      let combinedContent = '';
      for await (const event of requestCompletionStream(withHotelInstruction(withTransportInstruction(validation.messages, req.body?.transportCard, transportOnly), req.body?.hotelOptions), { apiKey, fetchImpl, model })) {
        if (transportOnly) combinedContent += event.content;
        else res.write(`event: delta\ndata: ${JSON.stringify({ content: event.content })}\n\n`);
      }
      if (transportOnly) {
        const result = extractTransportResult(combinedContent);
        if (result.content) res.write(`event: delta\ndata: ${JSON.stringify({ content: result.content })}\n\n`);
        res.write(`event: transport\ndata: ${JSON.stringify({ options: result.options })}\n\n`);
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
