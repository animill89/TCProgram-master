const API_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';

function upstreamErrorMessage(status) {
  if (status === 401 || status === 403) return 'AI 服务鉴权失败，请检查 API Key 配置。';
  if (status === 404) return '当前配置的 AI 模型不可用，请联系管理员更新模型配置。';
  if (status === 402 || status === 429) return 'AI 服务额度不足或请求过于频繁，请稍后重试。';
  return 'AI 服务暂时不可用，请稍后重试。';
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
      body: JSON.stringify({ model, messages, stream: false }),
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

  const content = payload?.choices?.[0]?.message?.content;
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
      body: JSON.stringify({ model, messages, stream: true }),
    });
  } catch {
    throw { status: 503, message: '无法连接 AI 服务，请稍后重试。' };
  }

  if (!response.ok) throw { status: 502, message: upstreamErrorMessage(response.status) };
  if (!response.body) throw { status: 502, message: 'AI 服务暂时不可用，请稍后重试。' };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const readDataLine = (line) => {
    if (!line.startsWith('data:')) return null;
    return line.slice(5).trim();
  };

  const consumeLines = function* (text) {
    const lines = text.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      const data = readDataLine(line);
      if (!data) continue;
      if (data === '[DONE]') return true;
      try {
        const content = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (typeof content === 'string' && content) yield content;
      } catch {
        // Ignore malformed upstream chunks and keep the public protocol stable.
      }
    }
    return false;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = consumeLines(buffer);
      let result = chunks.next();
      while (!result.done) {
        yield { type: 'delta', content: result.value };
        result = chunks.next();
      }
      if (result.value) return;
    }

    buffer += decoder.decode();
    const chunks = consumeLines(`${buffer}\n`);
    let result = chunks.next();
    while (!result.done) {
      yield { type: 'delta', content: result.value };
      result = chunks.next();
    }
  } catch (error) {
    if (error?.status) throw error;
    throw { status: 502, message: 'AI 服务暂时不可用，请稍后重试。' };
  }
}
