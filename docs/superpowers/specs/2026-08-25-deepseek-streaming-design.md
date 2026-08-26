# DeepSeek 流式对话设计规格

## 目标

消除非流式请求在完整回复返回前的长暂停。DeepSeek 的生成内容应以分片形式到达浏览器，并立即追加到当前 AI 消息中，同时保持 Markdown 渲染。

## 架构

- 保留 `POST /api/chat` 作为原有 JSON 接口。
- 新增 `POST /api/chat/stream`，请求体仍是 `{ "messages": [...] }`。
- Node 服务校验输入、从环境变量读取 API Key，并使用 DeepSeek Chat Completions 的 `stream: true` 请求上游。
- Node 将上游 Server-Sent Events 中的文本增量标准化为自己的 SSE 事件，再直接写给浏览器。
- 浏览器通过 `fetch` 与 `ReadableStream` 读取响应；每接收一个内容事件，直接追加到最后一条助手消息的 `content` 字段。

## SSE 契约

服务端响应使用 `Content-Type: text/event-stream`。每个事件采用以下之一：

```text
event: delta
data: {"content":"下一段文字"}

event: done
data: {}

event: error
data: {"message":"AI 服务暂时不可用，请稍后重试。"}
```

上游的 `[DONE]` 标记转换为 `done`。API Key、上游原始错误与原始事件不发送给浏览器。

## 前端体验

- 提交后立刻插入空助手消息并显示“正在连接 AI…”。
- 收到首个 `delta` 时隐藏连接提示；随后每个 `delta` 直接显示，无额外人工打字延迟。
- 助手消息继续使用 React Markdown 渲染；用户消息为纯文本。
- `done` 后重新启用输入框。
- 用户离开页面或开始取消时，`AbortController` 中断读取。
- 流中出错时保留已有文本，在消息下显示可读错误；没有收到内容则用错误消息填充助手气泡。

## 测试

- 服务端：验证流式请求带有 `stream: true`；验证上游 `delta`、`[DONE]`、无效事件和异常被正确映射。
- 前端：模拟流式响应，验证分片依序追加、Markdown 最终渲染、完成后输入框启用、错误不丢失已显示文本。

## 非目标

- 不增加数据库、轮询任务、WebSocket 或多会话状态。
- 不改变现有非流式接口行为。
