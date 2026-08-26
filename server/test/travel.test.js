import { describe, expect, it } from 'vitest';
import { extractDestinationCity, normalizeRailTickets } from '../src/travel.js';

describe('extractDestinationCity', () => {
  it('uses the city mentioned as the travel destination in shared chat records', () => {
    const records = [
      '[用户A 20:41] 国庆去上海玩吧！我查了机票还行',
      '[用户B 20:43] 我要去迪士尼乐园！！',
    ].join('\n');

    expect(extractDestinationCity(records)).toBe('上海');
  });

  it('returns no destination when the records do not name a city', () => {
    expect(extractDestinationCity('[用户A 20:41] 我们去旅游吧')).toBeNull();
  });
});

describe('extractTravelDate', () => {
  it('resolves 本周六 from the current week', async () => {
    const { extractTravelDate } = await import('../src/travel.js');

    expect(extractTravelDate('那就本周六出发', new Date('2026-08-26T12:00:00+08:00'))).toBe('2026-08-29');
  });
});

describe('normalizeRailTickets', () => {
  it('creates card data only from real 12306 ticket fields', () => {
    const options = normalizeRailTickets([{
      start_train_code: 'G123', start_date: '2026-10-01', start_time: '08:30', arrive_time: '11:00',
      from_station: '苏州', to_station: '上海虹桥', lishi: '02:30',
      prices: [{ seat_name: '二等座', price: 123, num: '有' }],
    }]);

    expect(options).toEqual([{
      type: '高铁', train: 'G123', date: '10月1日', departureTime: '08:30', departureStation: '苏州',
      arrivalTime: '11:00', arrivalStation: '上海虹桥', duration: '2小时30分', price: '¥123',
      reason: '二等座有票，¥123，符合人均1500元预算',
    }]);
  });
});
