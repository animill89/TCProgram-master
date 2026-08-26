import express from 'express';
import { readFileSync } from 'node:fs';
import { requestCompletion, requestCompletionStream, validateMessages } from './chat.js';
import { extractDestinationCity } from './travel.js';

const transportMock = JSON.parse(readFileSync(new URL('../data/transport.mock.json', import.meta.url)));
const hotelMock = JSON.parse(readFileSync(new URL('../data/hotels.mock.json', import.meta.url)));

function withTransportInstruction(messages, card, transportOnly = false) {
  if (!card && !transportOnly) return messages;
  if (transportOnly) return [{ role: 'system', content: `你是交通推荐助手。出发地固定为成都，目的地从聊天记录识别；仅输出交通推荐，不得输出行程、酒店或反问。只从以下 mock 候选中筛选预算内最合适的 2 至 3 项，不得编造：${JSON.stringify(card ?? [])}。给出清晰的推荐理由。回复末尾附加一次 <!--TRANSPORT_OPTIONS:[{"id":"mock唯一标识","type":"高铁或飞机","train":"车次或航班号","date":"出发日期","departureTime":"HH:mm","departureStation":"出发站或机场","arrivalTime":"HH:mm","arrivalStation":"到达站或机场","duration":"时长","price":"价格","reason":"推荐理由"}]-->。` }, ...messages];
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
  return [{ role: 'system', content: `只输出酒店推荐、对应房型、距离提示和推荐理由，不输出交通或行程。先写“筛选依据”：结合聊天记录逐项说明预算、外滩夜游、迪士尼接送、虹桥返程和多人入住需求如何影响选择；再用“未优先选择的候选”简要说明至少两家不推荐的具体原因。随后推荐最符合需求且每晚不超过700元的 2 至 3 家。最后附加一次 <!--SELECTED_HOTEL_IDS:["mock唯一id"]-->，只填写最终推荐的酒店 ID，顺序即卡片顺序。仅使用以下 mock 数据，酒店名、房型、价格和理由必须保持一致，不得编造：${JSON.stringify(hotels)}。` }, ...messages];
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

export function createApp({ apiKey, fetchImpl = fetch, model = 'deepseek-v4-flash' } = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.post('/api/rail-tickets', async (req, res) => {
    const { chatRecords } = req.body ?? {};
    const fromCity = '\u6210\u90fd';
    const toCity = extractDestinationCity(chatRecords);
    if (!toCity) return res.status(400).json({ error: '聊天记录中未识别到目的地城市' });
    const options = transportMock.filter((item) => item.fromCity === fromCity && item.toCity === toCity && Number(item.price.replace(/[^\d.]/g, '')) <= 1500);
    return res.json({ fromCity, toCity, tickets: options, options });
  });

  app.post('/api/hotels', async (req, res) => {
    const { chatRecords } = req.body ?? {};
    const destination = extractDestinationCity(chatRecords);
    if (!destination) return res.status(400).json({ error: '聊天记录中未识别到目的地城市' });
    const place = inferHotelPlace(chatRecords, destination);
    return res.json({ place, options: hotelMock.filter((item) => item.city === destination) });
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
