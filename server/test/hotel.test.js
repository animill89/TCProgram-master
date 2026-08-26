import { describe, expect, it } from 'vitest';
import { normalizeHotelOptions } from '../src/hotel.js';

describe('normalizeHotelOptions', () => {
  it('creates a hotel card from the live hotel and room-rate fields', () => {
    const options = normalizeHotelOptions([{
      hotel: { hotelId: 1, name: '上海外滩酒店', starRating: 4, bookingUrl: 'https://example.com', price: { lowestPrice: 1300 } },
      detail: { roomRatePlans: [{ roomName: '高级双床房', averagePrice: 650, mealTypeStr: '含早餐', cancelable: true }] },
    }], '上海外滩');

    expect(options).toEqual([{
      id: 1,
      name: '上海外滩酒店',
      room: '高级双床房 · 含早餐',
      distance: '外滩附近',
      reason: '4星酒店，支持免费取消',
      price: '¥650/晚',
      bookingUrl: 'https://example.com',
    }]);
  });
});
