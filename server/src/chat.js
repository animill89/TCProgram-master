const API_URL = 'https://api.deepseek.com/responses';
const DEFAULT_MODEL = 'deepseek-v4-flash';

function upstreamErrorMessage(status) {
  if (status === 401 || status === 403) return 'AI 服务鉴权失败，请检查 API Key 配置。';
  if (status === 404) return '当前配置的 AI 模型不可用，请联系管理员更新模型配置。';
  if (status === 402 || status === 429) return 'AI 服务额度不足或请求过于频繁，请稍后重试。';
  return 'AI 服务暂时不可用，请稍后重试。';
}

function responseRequest(model, messages, stream) {
  return {
    model,
    input: messages,
    instructions: '联网搜索结果优先用于生成推荐与说明；若对话中提供了 12306 或酒店 MCP 数据，则将其作为补充信息与卡片数据使用。不要声称任何价格或余票实时准确。',
    tools: [{ type: 'web_search' }],
    tool_choice: 'required',
    stream,
  };
}

export function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: '请至少输入一条消息。' };
  }

  if (messages.length > 50) {
    return { ok: false, error: '消息数量不能超过 50 条。' };
  }

  const normalized = [];
  for (const message of messages) {
    if (!message || !['user', 'assistant'].includes(message.role)) {
      return { ok: false, error: '消息角色无效。' };
    }

    if (typeof message.content !== 'string' || !message.content.trim()) {
      return { ok: false, error: '消息内容不能为空。' };
    }

    const content = message.content.trim();
    if (content.length > 8000) {
      return { ok: false, error: '单条消息不能超过 8000 个字符。' };
    }

    normalized.push({ role: message.role, content });
  }

  return { ok: true, messages: normalized };
}

export async function requestCompletion(messages, { apiKey, fetchImpl, model = DEFAULT_MODEL }) {
  if (!apiKey) {
    throw { status: 500, message: '服务端尚未配置 DeepSeek API Key。' };
  }

  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(responseRequest(model, messages, false)),
    });
  } catch {
    throw { status: 503, message: '无法连接 AI 服务，请稍后重试。' };
  }

  if (!response.ok) throw { status: 502, message: upstreamErrorMessage(response.status) };

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw { status: 502, message: 'AI 服务返回了无效响应，请稍后重试。' };
  }

  const content = payload?.output?.flatMap((item) => item.type === 'message' ? item.content ?? [] : []).filter((item) => item.type === 'output_text').map((item) => item.text).join('');
  if (typeof content !== 'string' || !content.trim()) {
    throw { status: 502, message: 'AI 服务返回了无效响应，请稍后重试。' };
  }

  return { role: 'assistant', content: content.trim() };
}

export async function* requestCompletionStream(messages, { apiKey, fetchImpl, model = DEFAULT_MODEL }) {
  if (!apiKey) {
    throw { status: 500, message: '服务端尚未配置 DeepSeek API Key。' };
  }

  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(responseRequest(model, messages, true)),
    });
  } catch {
    throw { status: 503, message: '无法连接 AI 服务，请稍后重试。' };
  }

  if (!response.ok) throw { status: 502, message: upstreamErrorMessage(response.status) };
  if (!response.body) throw { status: 502, message: 'AI 服务暂时不可用，请稍后重试。' };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consumeRecord = (record) => {
    const event = record.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const data = record.match(/^data:\s*(.+)$/m)?.[1]?.trim();
    if (!event || !data) return null;
    if (event === 'response.completed') return { done: true };
    if (event === 'response.failed') throw { status: 502, message: 'AI 联网搜索或生成失败，请稍后重试。' };
    if (event !== 'response.output_text.delta') return null;
    try {
      const content = JSON.parse(data)?.delta;
      return typeof content === 'string' && content ? { content } : null;
    } catch {
      return null;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const records = buffer.split(/\r?\n\r?\n/);
      buffer = records.pop();
      for (const record of records) {
        const result = consumeRecord(record);
        if (result?.done) return;
        if (result?.content) yield { type: 'delta', content: result.content };
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const result = consumeRecord(buffer);
      if (result?.content) yield { type: 'delta', content: result.content };
    }
  } catch (error) {
    if (error?.status) throw error;
    throw { status: 502, message: 'AI 服务暂时不可用，请稍后重试。' };
  }
}
