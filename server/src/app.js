import express from 'express';
import { requestCompletion, requestCompletionStream, validateMessages } from './chat.js';
import { queryRailTickets } from './railway.js';
import { queryHotels } from './hotel.js';
import { extractDestinationCity, extractTravelDate, normalizeRailTickets } from './travel.js';

function withTransportInstruction(messages, card, transportOnly = false) {
  if (!card && !transportOnly) return messages;
  if (transportOnly) return [{ role: 'system', content: `你是交通推荐助手。出发地固定为成都，目的地从聊天记录识别；仅输出交通推荐，不得输出行程、酒店或反问。以下是12306 MCP 已筛选出的预算内真实高铁数据，必须原样用于高铁卡片：${JSON.stringify(card ?? [])}。再使用联网搜索补充预算内的参考机票；机票仅展示预算内候选，并在理由标注“参考价格，以购票页为准”。回复末尾附加一次 <!--TRANSPORT_OPTIONS:[{"type":"高铁或飞机","train":"车次或航班号","date":"出发日期","departureTime":"HH:mm","departureStation":"出发站或机场","arrivalTime":"HH:mm","arrivalStation":"到达站或机场","duration":"时长","price":"价格","reason":"推荐理由"}]-->。` }, ...messages];
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
function withHotelInstruction(messages, hotels, hotelOnly = false) {
  if (!hotels && !hotelOnly) return messages;
  if (hotelOnly) return [{ role: 'system', content: '仅输出酒店、房型、距离和推荐理由，不输出交通、行程或反问。先用固定中文模板给出推荐；随后在回复最后单独输出且只输出一次 JSON 代码块：```json\n{"hotelCards":[{"id":"唯一标识","name":"酒店名","room":"明确房型或房型以预订页为准","distance":"距离地铁、商圈或景点","reason":"推荐理由","price":"¥价格/晚或价格以预订页为准","bookingUrl":"预订链接或空字符串"}]}\n```。酒店正文与 hotelCards 必须完全一致；没有候选时 hotelCards 为 []。' }, ...messages];
  return [{ role: 'system', content: `只输出酒店推荐、对应房型、距离提示和推荐理由，不输出交通或行程。只推荐靠近地铁站或商圈、且每晚价格不超过700元的房型。仅使用以下数据并保持一致：${JSON.stringify(hotels)}。` }, ...messages];
}

function extractHotelResult(content) {
  const jsonBlock = content.match(/```json\s*([\s\S]*?)\s*```/i);
  if (jsonBlock) {
    try {
      const payload = JSON.parse(jsonBlock[1]);
      const options = Array.isArray(payload.hotelCards) ? payload.hotelCards.filter((item) => item && ['id', 'name', 'room', 'distance', 'reason', 'price'].every((key) => typeof item[key] === 'string')) : [];
      return { content: content.replace(jsonBlock[0], '').trim(), options };
    } catch { return { content: content.replace(jsonBlock[0], '').trim(), options: [] }; }
  }
  const match = content.match(/<!--HOTEL_OPTIONS:(\[[\s\S]*?\])-->/);
  if (!match) return { content, options: parseHotelsFromText(content) };
  try {
    const options = JSON.parse(match[1]);
    const valid = Array.isArray(options) ? options.filter((item) => item && ['id', 'name', 'room', 'distance', 'reason', 'price'].every((key) => typeof item[key] === 'string')) : [];
    return { content: content.replace(match[0], '').trim(), options: valid.length ? valid : parseHotelsFromText(content) };
  } catch { return { content: content.replace(match[0], '').trim(), options: parseHotelsFromText(content) }; }
}

function parseHotelsFromText(content) {
  const lines = content.split('\n');
  let distance = '目的地附近';
  return lines.flatMap((line, index) => {
    if (/外滩|迪士尼|虹桥|地铁|商圈/.test(line) && !line.trim().startsWith('-')) distance = line.replace(/[*#①②③：:]/g, '').trim();
    const match = line.match(/^\s*[-•]\s*(?:\*\*)?([^*：:—-]+?)(?:\*\*)?(?:（[^）]*）)?\s*[：:—-]\s*(.+)$/);
    if (!match) return [];
    const detail = match[2];
    const price = detail.match(/¥\s?\d+(?:[-–]\d+)?(?:起|\/晚)?/)?.[0] ?? '价格以预订页为准';
    return [{ id: `ai-hotel-${index}`, name: match[1].trim(), room: '房型以预订页为准', distance, reason: detail.replace(/参考\s?¥\s?\d+(?:[-–]\d+)?(?:起|\/晚)?/, '').trim(), price }];
  });
}

function inferHotelPlace(records, destination) {
  if (records.includes('外滩')) return `${destination}外滩`;
  if (records.includes('迪士尼')) return `${destination}迪士尼度假区`;
  if (records.includes('虹桥')) return `${destination}虹桥火车站`;
  return destination;
}

function fillHotelOptions(options, place) {
  const mockHotels = [
    { id: 'mock-hotel-1', name: `${place}精选酒店`, room: '高级双床房', distance: `${place}附近`, reason: '模拟补充推荐，位置便利', price: '¥468/晚', isMock: true },
    { id: 'mock-hotel-2', name: `${place}舒适酒店`, room: '豪华大床房', distance: `距${place}约500米`, reason: '模拟补充推荐，适合预算出行', price: '¥528/晚', isMock: true },
    { id: 'mock-hotel-3', name: `${place}商旅酒店`, room: '行政双床房', distance: `${place}商圈附近`, reason: '模拟补充推荐，出行方便', price: '¥598/晚', isMock: true },
  ];
  return [...options, ...mockHotels].slice(0, 3);
}

export function createApp({ apiKey, fetchImpl = fetch, model = 'deepseek-v4-flash', railwayQuery = queryRailTickets, hotelQuery = queryHotels, rollingGoApiKey = process.env.ROLLINGGO_API_KEY } = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.post('/api/rail-tickets', async (req, res) => {
    const { chatRecords } = req.body ?? {};
    const fromCity = '\u82cf\u5dde';
    const toCity = extractDestinationCity(chatRecords);
    const date = extractTravelDate(chatRecords);
    if (!toCity || !date) return res.status(400).json({ error: '聊天记录中未识别到目的地城市或出发日期' });
    try {
      const tickets = await railwayQuery({ date, fromCity, toCity });
      if (!Array.isArray(tickets)) throw new Error('12306 未返回有效的车次数据，请更换日期后重试');
      const options = normalizeRailTickets(tickets).filter((item) => Number(String(item.price).replace(/[^\d.]/g, '')) <= 1500);
      return res.json({ fromCity, toCity, tickets, options });
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
      return res.json({ place, options: fillHotelOptions(options, place) });
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
      const message = await requestCompletion(withHotelInstruction(withTransportInstruction(validation.messages, req.body?.transportCard, req.body?.transportOnly), req.body?.hotelOptions, req.body?.hotelOnly), { apiKey, fetchImpl, model });
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
      const hotelOnly = Boolean(req.body?.hotelOnly);
      let combinedContent = '';
      let sentLength = 0;
      const marker = transportOnly ? '<!--TRANSPORT_OPTIONS:' : hotelOnly ? '<!--HOTEL_OPTIONS:' : '';
      for await (const event of requestCompletionStream(withHotelInstruction(withTransportInstruction(validation.messages, req.body?.transportCard, transportOnly), req.body?.hotelOptions, hotelOnly), { apiKey, fetchImpl, model, webSearch: transportOnly })) {
        if (transportOnly || hotelOnly) {
          combinedContent += event.content;
          const markerIndex = combinedContent.indexOf(marker);
          const safeEnd = markerIndex >= 0 ? markerIndex : Math.max(sentLength, combinedContent.length - marker.length + 1);
          if (safeEnd > sentLength) {
            res.write(`event: delta\ndata: ${JSON.stringify({ content: combinedContent.slice(sentLength, safeEnd) })}\n\n`);
            sentLength = safeEnd;
          }
        }
        else res.write(`event: delta\ndata: ${JSON.stringify({ content: event.content })}\n\n`);
      }
      if (transportOnly) {
        const result = extractTransportResult(combinedContent);
        if (result.content.length > sentLength) res.write(`event: delta\ndata: ${JSON.stringify({ content: result.content.slice(sentLength) })}\n\n`);
        res.write(`event: transport\ndata: ${JSON.stringify({ options: result.options })}\n\n`);
      }
      if (hotelOnly) {
        const result = extractHotelResult(combinedContent);
        if (result.content.length > sentLength) res.write(`event: delta\ndata: ${JSON.stringify({ content: result.content.slice(sentLength) })}\n\n`);
        res.write(`event: hotel\ndata: ${JSON.stringify({ options: result.options })}\n\n`);
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
