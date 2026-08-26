# DeepSeek AI Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React chat page that securely sends text conversations to DeepSeek through a Node/Express proxy.

**Architecture:** A Vite React client owns local conversation state and calls `POST /api/chat`. An Express server validates the conversation, reads `DEEPSEEK_API_KEY` only from its environment, calls DeepSeek Chat Completions, and returns a normalized assistant message.

**Tech Stack:** React, Vite, Express, Vitest, Supertest, dotenv.

**Spec:** `docs/superpowers/specs/2026-08-25-deepseek-chat-design.md`

## Global Constraints

- Do not expose `DEEPSEEK_API_KEY` to browser code or commit `server/.env`.
- Provide `server/.env.example`; default model is `deepseek-chat`.
- Scope is text-only, non-streaming, non-persistent chat with no authentication or database.
- Enter sends; Shift+Enter inserts a newline; empty messages cannot be sent.
- Upstream/network failures must not leak raw upstream error bodies or credentials.

---

## File Structure

- `package.json`: root scripts for client and server development/build/testing.
- `client/`: Vite application and its package metadata.
- `client/src/App.jsx`: chat state, request lifecycle, keyboard interaction, and page composition.
- `client/src/api.js`: small client-side API boundary for `/api/chat`.
- `client/src/App.css`: responsive chat layout and visual states.
- `server/src/app.js`: Express app and `/api/chat` route.
- `server/src/chat.js`: request validation, upstream call, response normalization, and error mapping.
- `server/test/chat.test.js`: unit and route tests for the server boundary.
- `README.md`: setup and local run instructions.
- `.gitignore`: dependencies and secret environment files.

### Task 1: Scaffold the project and protect secrets

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `client/package.json`
- Create: `client/index.html`
- Create: `client/src/main.jsx`
- Create: `server/package.json`
- Create: `server/.env.example`

**Interfaces:**
- Produces: a root `npm run dev`, `npm run build`, and `npm test` workflow; front-end Vite entry point; server package with Express/Vitest/Supertest.

- [ ] **Step 1: Create the package manifests and ignore rules**

Create root scripts that launch the client and server concurrently, proxy the Vite `/api` prefix to port 3001, and exclude `node_modules`, build output, and every `.env` file except `.env.example`.

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev --prefix server\" \"npm run dev --prefix client\"",
    "build": "npm run build --prefix client",
    "test": "npm test --prefix server"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install && npm install --prefix client && npm install --prefix server`

Expected: lockfiles and package metadata resolve without putting dependencies under version control.

- [ ] **Step 3: Verify secrets are ignored**

Run: `git check-ignore server/.env`

Expected: output contains `server/.env`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore client server
git commit -m "chore: scaffold chat application"
```

### Task 2: Implement and test the DeepSeek server boundary

**Files:**
- Create: `server/src/chat.js`
- Create: `server/src/app.js`
- Create: `server/src/index.js`
- Create: `server/test/chat.test.js`

**Interfaces:**
- Consumes: `DEEPSEEK_API_KEY` and optional `DEEPSEEK_MODEL` environment variables.
- Produces: `createApp({ fetchImpl, apiKey, model })` and `POST /api/chat` with `{ messages }` input and `{ message }` output.

- [ ] **Step 1: Write failing request-validation and success tests**

```js
it('rejects an empty message list', async () => {
  const app = createApp({ apiKey: 'test-key', fetchImpl: vi.fn() });
  const response = await request(app).post('/api/chat').send({ messages: [] });
  expect(response.status).toBe(400);
  expect(response.body.error).toBe('请至少输入一条消息。');
});

it('returns the normalized assistant message', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: '你好！' } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const app = createApp({ apiKey: 'test-key', fetchImpl });
  const response = await request(app).post('/api/chat').send({
    messages: [{ role: 'user', content: '你好' }]
  });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ message: { role: 'assistant', content: '你好！' } });
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `npm test --prefix server -- --run`

Expected: FAIL because `createApp` does not exist.

- [ ] **Step 3: Implement validation, upstream calling, and error mapping**

Implement `createApp` with JSON request parsing and a `POST /api/chat` handler. Validate an array of up to 50 `{ role, content }` entries, permit only `user` and `assistant`, trim message text, and reject content exceeding 8,000 characters. Call `https://api.deepseek.com/chat/completions` with the configured model and `Authorization: Bearer <key>`. Return only `choices[0].message.content`; return generic Chinese 500/502/503 messages for missing configuration, malformed upstream output, non-OK upstream replies, and fetch exceptions.

```js
app.post('/api/chat', async (req, res) => {
  const validation = validateMessages(req.body?.messages);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  try {
    const message = await requestCompletion(validation.messages, dependencies);
    return res.json({ message });
  } catch (error) {
    return res.status(error.status).json({ error: error.message });
  }
});
```

- [ ] **Step 4: Extend the tests for failures and run them**

Add tests for missing API key (500), DeepSeek non-OK response (502), network rejection (503), invalid roles, and invalid upstream JSON. Run: `npm test --prefix server -- --run`.

Expected: PASS for all server tests.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat: add secure DeepSeek chat proxy"
```

### Task 3: Build the React chat interface

**Files:**
- Create: `client/src/api.js`
- Create: `client/src/App.jsx`
- Create: `client/src/App.css`
- Modify: `client/src/main.jsx`

**Interfaces:**
- Consumes: `sendChat(messages)` returning `{ message: { role: 'assistant', content: string } }` from `/api/chat`.
- Produces: a complete, keyboard-accessible chat page that displays local message history and request/error states.

- [ ] **Step 1: Write failing interaction tests**

Install React Testing Library and add `client/src/App.test.jsx` covering an initial greeting, disabled blank send button, submit via Enter, Shift+Enter newline behavior, pending “正在思考…” UI, assistant response rendering, and readable error rendering.

```jsx
it('submits a message and renders the assistant reply', async () => {
  vi.mocked(sendChat).mockResolvedValue({ message: { role: 'assistant', content: '我能帮你什么？' } });
  render(<App />);
  await userEvent.type(screen.getByLabelText('消息输入框'), '你好{Enter}');
  expect(await screen.findByText('我能帮你什么？')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the client tests to verify failure**

Run: `npm test --prefix client -- --run`

Expected: FAIL because `App` and `sendChat` are not implemented.

- [ ] **Step 3: Implement the API client and stateful chat screen**

Implement `sendChat` with `fetch('/api/chat')`, JSON headers, and safe parsing of non-OK replies. In `App`, store messages, draft, pending state, and error state. On send, append the trimmed user draft, clear the input, call `sendChat` with history, append the returned assistant message, and add an assistant-visible error message on failure. Handle Enter without Shift in `onKeyDown` and retain Shift+Enter's native newline behavior.

```jsx
const submit = async () => {
  const content = draft.trim();
  if (!content || isPending) return;
  const nextMessages = [...messages, { role: 'user', content }];
  setMessages(nextMessages);
  setDraft('');
  setIsPending(true);
  try {
    const { message } = await sendChat(nextMessages);
    setMessages((current) => [...current, message]);
  } catch (error) {
    setError(error.message || '请求失败，请稍后重试。');
  } finally {
    setIsPending(false);
  }
};
```

- [ ] **Step 4: Style and verify the interface**

Create a responsive CSS layout with title bar, independently scrollable message region, role-specific message bubbles, a status row, and fixed composer at the bottom. Use native semantic controls, labels, focus indicators, and disabled visual state. Run: `npm test --prefix client -- --run`.

Expected: PASS for all client tests.

- [ ] **Step 5: Commit**

```bash
git add client
git commit -m "feat: add React chat interface"
```

### Task 4: Document, build, and perform final checks

**Files:**
- Create: `README.md`
- Modify: `package.json` only if required for final scripts

**Interfaces:**
- Consumes: the client and server run/build/test scripts from prior tasks.
- Produces: reproducible local setup instructions.

- [ ] **Step 1: Write setup documentation**

Document Node.js 20+, dependency installation, copying `server/.env.example` to `server/.env`, assigning a newly generated DeepSeek key to `DEEPSEEK_API_KEY`, starting development mode, and running tests/build. Explicitly state never to expose or commit the secret.

- [ ] **Step 2: Run the full verification suite**

Run: `npm test && npm run build`

Expected: server tests and client tests pass, and Vite emits a production build.

- [ ] **Step 3: Inspect the staged repository for secrets**

Run: `git status --short && git check-ignore server/.env`

Expected: `.env` remains ignored and only intended source, docs, and lockfiles are tracked.

- [ ] **Step 4: Commit**

```bash
git add README.md package.json package-lock.json
git commit -m "docs: add chat application setup guide"
```

## Self-Review

- Spec coverage: Tasks 1-4 cover the specified React/Node architecture, secure key storage, UI behavior, API contract, error handling, tests, build, and README instructions.
- Placeholder scan: no TODO/TBD or unresolved implementation steps remain.
- Interface consistency: the React `sendChat` client consumes the `{ message }` response produced by `createApp`'s `/api/chat` route.
