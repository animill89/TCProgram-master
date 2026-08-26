export async function sendChat(messages) {
  let response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
  } catch {
    throw new Error('网络连接失败，请稍后重试。');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || '请求失败，请稍后重试。');
  }

  if (typeof payload?.message?.content !== 'string') {
    throw new Error('AI 服务返回了无效响应，请稍后重试。');
  }

  return payload;
}

export async function fetchRailTickets(chatRecords) {
  const response = await fetch('/api/rail-tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatRecords }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '车次查询失败，请稍后重试。');
  if (!Array.isArray(payload.options) || payload.options.length === 0) throw new Error('未查询到可展示的高铁车次。');
  return payload;
}

export async function streamChat(messages, { signal, onDelta, transportCard, hotelOptions }) {
  let response;
  try {
    response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ messages, transportCard, hotelOptions }),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error('网络连接失败，请稍后重试。');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || '请求失败，请稍后重试。');
  }
  if (!response.body) {
    throw new Error('AI 服务返回了无效响应，请稍后重试。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consumeEvent = (record) => {
    const event = record.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const data = record.match(/^data:\s*(.+)$/m)?.[1]?.trim();
    if (!event || !data) return false;

    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new Error('AI 服务返回了无效响应，请稍后重试。');
    }

    if (event === 'delta') {
      if (typeof payload.content !== 'string') {
        throw new Error('AI 服务返回了无效响应，请稍后重试。');
      }
      onDelta(payload.content);
      return false;
    }
    if (event === 'error') {
      throw new Error(payload.message || 'AI 服务暂时不可用，请稍后重试。');
    }
    return event === 'done';
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const records = buffer.split(/\r?\n\r?\n/);
    buffer = records.pop();
    for (const record of records) {
      if (consumeEvent(record)) return;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);
}
