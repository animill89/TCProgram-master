import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n') ?? '';
  try { return JSON.parse(text); } catch { return text; }
}

export async function queryRailTickets({ date, fromCity, toCity }) {
  const client = new Client({ name: 'deeptrip-railway', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: 'npx', args: ['-y', '12306-mcp'] });
  await client.connect(transport);
  try {
    const stations = await call(client, 'get-station-code-of-citys', { citys: `${fromCity}|${toCity}` });
    const fromStation = stations[fromCity]?.station_code;
    const toStation = stations[toCity]?.station_code;
    if (!fromStation || !toStation) throw new Error('未找到出发城市或目的城市的代表车站');
    return await call(client, 'get-tickets', { date, fromStation, toStation, trainFilterFlags: 'G', format: 'json', limitedNum: 6 });
  } finally {
    await client.close();
  }
}
