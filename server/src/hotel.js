import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function addNights(date, nights) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + nights);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n') ?? '';
  try { return JSON.parse(text); } catch { throw new Error('RollingGo 未返回有效的酒店数据'); }
}

export function normalizeHotelOptions(results, place) {
  return results.map(({ hotel, detail }) => {
    const room = detail?.roomRatePlans?.find((item) => Number.isFinite(Number(item.averagePrice))) ?? detail?.roomRatePlans?.[0];
    if (!room) return null;
    return {
      id: hotel.hotelId,
      name: hotel.name,
      room: `${room.roomName}${room.mealTypeStr ? ` · ${room.mealTypeStr}` : ''}`,
      distance: `${place.replace('上海', '')}附近`,
      reason: `${hotel.starRating ?? '-'}星酒店，${room.cancelable ? '支持免费取消' : '以房型退改规则为准'}`,
      price: `¥${room.averagePrice}/晚`,
      bookingUrl: hotel.bookingUrl,
    };
  }).filter(Boolean);
}

export async function queryHotels({ apiKey, date, place, placeType = '景点', originQuery, budget = 750 }) {
  if (!apiKey) throw new Error('服务端尚未配置 RollingGo API Key');
  const client = new Client({ name: 'deeptrip-hotel', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.rollinggo.cn/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  });
  await client.connect(transport);
  try {
    const search = await call(client, 'searchHotels', {
      originQuery,
      place,
      placeType,
      checkInParam: { checkInDate: date, stayNights: 2, adultCount: 2 },
      hotelTags: { maxPricePerNight: budget },
      size: 3,
    });
    const hotels = search.hotelInformationList ?? [];
    const results = await Promise.all(hotels.map(async (hotel) => ({
      hotel,
      detail: await call(client, 'getHotelDetail', {
        hotelId: hotel.hotelId,
        dateParam: { checkInDate: date, checkOutDate: addNights(date, 2) },
        occupancyParam: { adultCount: 2, childCount: 0, roomCount: 1 },
      }),
    })));
    return normalizeHotelOptions(results, place);
  } finally {
    await client.close();
  }
}
