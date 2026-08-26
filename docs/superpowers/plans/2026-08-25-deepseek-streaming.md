# DeepSeek Streaming Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver DeepSeek responses to the H5 chat UI as Markdown-rendered text chunks immediately when they arrive.

**Architecture:** Preserve the existing JSON `POST /api/chat` endpoint and add a separate `POST /api/chat/stream` endpoint. The server converts DeepSeek's upstream SSE protocol into the app's small `delta`/`done`/`error` SSE contract; the React client reads that stream with `fetch` and appends each delta to an optimistic assistant bubble.

**Tech Stack:** Node.js, Express, native Fetch and ReadableStream, Server-Sent Events, React, Vite, React Markdown, Vitest, Supertest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-25-deepseek-streaming-design.md`

## Global Constraints

- Keep `POST /api/chat` and its JSON response behavior unchanged.
- `POST /api/chat/stream` accepts `{ "messages": [...] }` and emits `text/event-stream` events named `delta`, `done`, and `error`.
- Keep the DeepSeek API key and raw upstream errors out of browser responses.
- Request DeepSeek with `stream: true`; map upstream `[DONE]` to `done`.
- Render each received content chunk immediately with no artificial typewriter timer, preserving Markdown rendering.
- Abort an in-flight browser stream when the component unmounts; retain partial assistant text if the stream errors.
- Do not add a database, WebSocket, polling job, or conversation persistence.

---

## File Structure

- Modify: `server/src/chat.js` — validates and starts the DeepSeek stream, and exposes a chunk-safe upstream SSE reader.
- Modify: `server/src/app.js` — adds the validated Express streaming route and emits the public SSE contract.
- Modify: `server/test/chat.test.js` — covers server forwarding, completion, and safe stream errors.
- Modify: `client/src/api.js` — provides `streamChat(messages, options)` and parses the app's SSE response incrementally.
- Modify: `client/src/App.jsx` — replaces the delayed typewriter state with immediate stream updates and abort cleanup.
- Modify: `client/src/App.css` — styles streamed Markdown blocks and an error displayed beneath a partial assistant response.
- Modify: `client/src/App.test.jsx` — mocks chunks, checks immediate Markdown rendering, completion state, and partial-content errors.

### Task 1: Add the server-side DeepSeek SSE bridge

**Files:**
- Modify: `server/src/chat.js`
- Modify: `server/src/app.js`
- Test: `server/test/chat.test.js`

**Interfaces:**
- Consumes: `validateMessages(messages)` and an injected `fetchImpl` from the existing server.
- Produces: `requestCompletionStream(messages, { apiKey, fetchImpl, model })`, an async generator yielding `{ type: 'delta', content: string }` and ending when upstream emits `[DONE]`.
- Produces: `POST /api/chat/stream`, which emits `event: delta`, `event: done`, or `event: error` with JSON data.

- [ ] **Step 1: Write the failing stream route tests**

Add a helper that creates a valid streaming `Response`, then add these tests to `server/test/chat.test.js`:

```js
function sseResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

it('bridges DeepSeek chunks and sends done', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(sseResponse([
    'data: {"choices":[{"delta":{"content":"# 苏"}}]}\\n\\n',
    'data: {"choices":[{"delta":{"content":"州"}}]}\\n\\n',
    'data: [DONE]\\n\\n',
  ]));
  const app = createApp({ apiKey: 'test-key', fetchImpl });

  const response = await request(app).post('/api/chat/stream').send({
    messages: [{ role: 'user', content: '安排苏州行程' }],
  });

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/event-stream');
  expect(response.text).toContain('event: delta');
  expect(response.text).toContain('"content":"# 苏"');
  expect(response.text).toContain('"content":"州"');
  expect(response.text).toContain('event: done');
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ stream: true });
});

it('sends one safe error event when the upstream stream fails', async () => {
  const app = createApp({ apiKey: 'test-key', fetchImpl: vi.fn().mockRejectedValue(new Error('secret upstream detail')) });
  const response = await request(app).post('/api/chat/stream').send({
    messages: [{ role: 'user', content: '你好' }],
  });

  expect(response.status).toBe(200);
  expect(response.text).toContain('event: error');
  expect(response.text).not.toContain('secret upstream detail');
});
```

- [ ] **Step 2: Run the server test to verify it fails**

Run: `npm test --prefix server -- --run test/chat.test.js`

Expected: FAIL because `/api/chat/stream` does not exist and `requestCompletionStream` is not exported.

- [ ] **Step 3: Implement a chunk-safe upstream event generator**

In `server/src/chat.js`, add `requestCompletionStream`. It must POST the same messages and model as `requestCompletion`, with `stream: true`; reject missing keys, network failures, non-OK responses, or absent `response.body` using existing safe error shapes. Read with `response.body.getReader()` and a `TextDecoder`, retain incomplete lines in a buffer, and parse only `data:` lines. For each parseable JSON payload, yield the non-empty string at `payload.choices?.[0]?.delta?.content`; return when the data payload equals `[DONE]`. Ignore non-content, malformed upstream event data rather than exposing it.

```js
export async function* requestCompletionStream(messages, { apiKey, fetchImpl, model = 'deepseek-chat' }) {
  if (!apiKey) throw { status: 500, message: '服务端尚未配置 DeepSeek API Key。' };
  const response = await fetchImpl(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!response.ok || !response.body) throw { status: 502, message: 'AI 服务暂时不可用，请稍后重试。' };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Split complete lines, preserve the final incomplete line, yield only delta.content.
}
```

- [ ] **Step 4: Implement the Express SSE endpoint**

In `server/src/app.js`, import `requestCompletionStream` and register this route before `return app`. Set SSE headers before iterating. Serialize every payload with `JSON.stringify`; write the final `done` event after normal generator completion. On a validation failure, retain the existing JSON `400` response because no stream has started. On an exception after headers are set, write only the safe `error` event and end the response.

```js
app.post('/api/chat/stream', async (req, res) => {
  const validation = validateMessages(req.body?.messages);
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  try {
    for await (const event of requestCompletionStream(validation.messages, { apiKey, fetchImpl, model })) {
      res.write(`event: delta\\ndata: ${JSON.stringify({ content: event.content })}\\n\\n`);
    }
    res.write('event: done\\ndata: {}\\n\\n');
  } catch (error) {
    res.write(`event: error\\ndata: ${JSON.stringify({ message: error.message ?? 'AI 服务暂时不可用，请稍后重试。' })}\\n\\n`);
  }
  res.end();
});
```

- [ ] **Step 5: Run the focused server tests**

Run: `npm test --prefix server -- --run test/chat.test.js`

Expected: PASS, including all legacy JSON endpoint tests and the two streaming tests.

- [ ] **Step 6: Commit the server bridge**

```bash
git add server/src/chat.js server/src/app.js server/test/chat.test.js
git commit -m "feat: add DeepSeek streaming endpoint"
```

### Task 2: Consume app SSE chunks and update the H5 chat immediately

**Files:**
- Modify: `client/src/api.js`
- Modify: `client/src/App.jsx`
- Modify: `client/src/App.css`
- Test: `client/src/App.test.jsx`

**Interfaces:**
- Consumes: `POST /api/chat/stream` events documented in the design spec.
- Produces: `streamChat(messages, { signal, onDelta })`, returning a promise that resolves on `done`, invokes `onDelta(content)` for each `delta`, and rejects with a safe `Error` for malformed, network, HTTP, or `error` events.
- Produces: assistant messages with optional `error: string`, rendered beneath any partial Markdown body.

- [ ] **Step 1: Write failing client behavior tests**

Replace the API mock with both exports and add tests that invoke `onDelta` synchronously before resolving. Keep the existing H5 interaction tests, but change their mocks from `sendChat` to `streamChat`.

```jsx
import { streamChat } from './api.js';

vi.mock('./api.js', () => ({ sendChat: vi.fn(), streamChat: vi.fn() }));

it('renders each stream delta as Markdown and enables input when done', async () => {
  streamChat.mockImplementation(async (_messages, { onDelta }) => {
    onDelta('# 苏州行程\\n\\n- 园林');
    onDelta('\\n- 评弹');
  });
  const user = userEvent.setup();
  render(<App />);

  await user.type(screen.getByLabelText('消息输入框'), '安排苏州行程{Enter}');

  expect(await screen.findByRole('heading', { name: '苏州行程' })).toBeInTheDocument();
  expect(screen.getByRole('list')).toHaveTextContent('园林');
  await waitFor(() => expect(screen.getByLabelText('消息输入框')).not.toBeDisabled());
});

it('keeps received content and displays a stream error underneath it', async () => {
  streamChat.mockImplementation(async (_messages, { onDelta }) => {
    onDelta('已收到的行程建议');
    throw new Error('AI 服务暂时不可用，请稍后重试。');
  });
  const user = userEvent.setup();
  render(<App />);

  await user.type(screen.getByLabelText('消息输入框'), '你好{Enter}');

  expect(await screen.findByText('已收到的行程建议')).toBeInTheDocument();
  expect(await screen.findByText('AI 服务暂时不可用，请稍后重试。')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the client test to verify it fails**

Run: `npm test --prefix client -- --run src/App.test.jsx`

Expected: FAIL because `streamChat` is not exported and the UI still awaits a complete `sendChat` response plus a timer.

- [ ] **Step 3: Implement the frontend SSE parser**

Add `streamChat` to `client/src/api.js`. It must call `fetch('/api/chat/stream', { method: 'POST', headers, body, signal })`, reject non-OK responses with the server's safe JSON error when available, read `response.body.getReader()`, split events on blank lines while retaining the trailing fragment, and dispatch by `event:` and `data:` fields. `delta` requires a string `content` and calls `onDelta`; `done` returns; `error` throws `new Error(payload.message || 'AI 服务暂时不可用，请稍后重试。')`.

```js
export async function streamChat(messages, { signal, onDelta }) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages }),
    signal,
  });
  // Validate response, read chunks, parse completed SSE records, invoke onDelta.
}
```

- [ ] **Step 4: Replace artificial typewriter state with stream state**

In `client/src/App.jsx`, import `useRef` and `streamChat`; remove the `useEffect`, `targetContent`, and `isTyping` code. Store the active `AbortController` in a ref and abort it in an unmount cleanup effect. In `submit`, append the user message and an empty assistant message immediately, then call `streamChat(nextMessages, { signal, onDelta })`. In `onDelta`, map only that assistant message by a generated request id and append `content`. On failure, put the safe error into that same assistant message's `error` field, retaining its `content`; clear `isPending` in `finally`. Show `正在连接 AI…` only while pending and before the first delta.

```jsx
const activeRequest = useRef(null);

useEffect(() => () => activeRequest.current?.abort(), []);

const assistantId = crypto.randomUUID();
setMessages((current) => [...current, { id: assistantId, role: 'assistant', content: '' }]);
await streamChat(nextMessages, {
  signal: controller.signal,
  onDelta: (content) => setMessages((current) => current.map((item) => (
    item.id === assistantId ? { ...item, content: item.content + content } : item
  )),
});
```

Render an empty bubble only while connecting, and render `message.error` as `<p className="message__error">{message.error}</p>` beneath the Markdown output. Use a simple incrementing ref if `crypto.randomUUID` is unavailable in the test browser.

- [ ] **Step 5: Add streamed Markdown and error styles**

In `client/src/App.css`, retain the existing bubble geometry and add compact rules so headings, lists, inline code, fenced code, links, and `.message__error` fit the mobile bubble without overflow.

```css
.message--assistant :is(h1, h2, h3) { margin: 0 0 8px; line-height: 1.35; }
.message--assistant :is(ul, ol) { margin: 8px 0; padding-left: 20px; }
.message--assistant pre { overflow-x: auto; border-radius: 10px; padding: 10px; }
.message__error { margin: 8px 0 0; color: #d74f41; font-size: 13px; }
```

- [ ] **Step 6: Run focused client tests**

Run: `npm test --prefix client -- --run src/App.test.jsx`

Expected: PASS, including immediate stream rendering, Markdown output, no nickname labels, completed input state, and partial-content errors.

- [ ] **Step 7: Commit the client streaming UI**

```bash
git add client/src/api.js client/src/App.jsx client/src/App.css client/src/App.test.jsx
git commit -m "feat: render DeepSeek responses as they stream"
```

### Task 3: Verify end-to-end project health

**Files:**
- Modify: none
- Test: `server/test/chat.test.js`, `client/src/App.test.jsx`, and the production client build

**Interfaces:**
- Consumes: completed streaming server and client interfaces from Tasks 1 and 2.
- Produces: verified test and build evidence.

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`

Expected: PASS for all server and client tests.

- [ ] **Step 2: Build the production client**

Run: `npm run build`

Expected: Vite completes successfully and writes `client/dist`.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check; git status --short`

Expected: no whitespace errors; only the streaming feature files and its design/plan docs are listed.

- [ ] **Step 4: Commit verification-ready changes if prior commits were unavailable**

```bash
git add docs/superpowers/specs/2026-08-25-deepseek-streaming-design.md docs/superpowers/plans/2026-08-25-deepseek-streaming.md
git commit -m "docs: document DeepSeek streaming design"
```
