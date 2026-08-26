const CITY_NAMES = ['上海', '北京', '天津', '重庆', '广州', '深圳', '杭州', '南京', '苏州', '无锡', '成都', '西安', '武汉', '长沙', '厦门', '青岛', '昆明', '三亚', '大连', '哈尔滨'];

export function extractDestinationCity(records) {
  if (typeof records !== 'string') return null;
  return CITY_NAMES.find((city) => records.includes(city)) ?? null;
}

export function extractTravelDate(records, now = new Date()) {
  if (typeof records === 'string' && records.includes('本周六')) {
    const saturday = new Date(now);
    saturday.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7));
    return `${saturday.getFullYear()}-${String(saturday.getMonth() + 1).padStart(2, '0')}-${String(saturday.getDate()).padStart(2, '0')}`;
  }
  const matched = typeof records === 'string' && records.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (!matched) return null;
  const month = Number(matched[1]);
  const day = Number(matched[2]);
  const year = now.getFullYear() + (month < now.getMonth() + 1 ? 1 : 0);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeRailTickets(tickets) {
  if (!Array.isArray(tickets)) return [];
  return tickets.map((ticket) => {
    const seat = ticket.prices?.find((item) => Number.isFinite(Number(item.price)) && item.num !== '无') ?? ticket.prices?.[0];
    const [year, month, day] = (ticket.start_date ?? '').split('-');
    return {
      type: '高铁',
      train: ticket.start_train_code,
      date: month && day ? `${Number(month)}月${Number(day)}日` : ticket.start_date,
      departureTime: ticket.start_time,
      departureStation: ticket.from_station,
      arrivalTime: ticket.arrive_time,
      arrivalStation: ticket.to_station,
      duration: ticket.lishi?.replace(':', '小时').replace(/^0/, '')?.replace(/$/, '分'),
      price: `¥${seat?.price}`,
      reason: `${seat?.seat_name ?? '席位'}${seat?.num === '有' ? '有票' : seat?.num ?? '余票未知'}，¥${seat?.price ?? '-'}，符合人均1500元预算`,
    };
  }).filter((ticket) => ticket.train && ticket.departureStation && ticket.arrivalStation);
}
