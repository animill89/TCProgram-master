# DeepSeek AI Chat 设计规格

## 目标与范围

构建一个 React Web 单页应用，提供基础文字 AI 对话功能。后端使用 Node.js 调用 DeepSeek Chat Completions API。首版不包含用户登录、数据库、对话持久化、文件上传或流式输出。

## 架构

- `client/`：Vite + React 前端，只负责界面与调用同源的 `/api/chat`。
- `server/`：Express 服务，提供 `POST /api/chat` 并在服务端请求 DeepSeek。
- `server/.env`：保存 `DEEPSEEK_API_KEY`；该文件不提交，并提供 `.env.example`。

浏览器永远不会接触 API Key。前端提交消息历史到 Node 服务；Node 校验请求、读取环境变量并调用 `https://api.deepseek.com/chat/completions`；Node 将助手文本回复转换为 JSON 返回前端。

## 前端体验

- 顶部标题为 “DeepSeek AI Chat”。
- 中央为可滚动消息区：用户消息右对齐，助手消息左对齐。
- 底部提供多行输入框与发送按钮；Enter 发送，Shift+Enter 换行。
- 空内容不可发送；请求进行时禁止重复发送并显示“正在思考…”。
- 调用失败时，在会话中展示安全、可读的中文错误提示；请求结束后用户可继续发送。
- 页面刷新后不保留会话。

## API 契约

`POST /api/chat`

请求体：

```json
{
  "messages": [
    { "role": "user", "content": "你好" }
  ]
}
```

成功返回：

```json
{
  "message": { "role": "assistant", "content": "你好！" }
}
```

服务端验证 `messages` 是非空数组、每项角色为 `user` 或 `assistant` 且文本非空，并限制请求内容大小。模型使用环境变量可配置，默认 `deepseek-chat`。

## 错误处理

- 没有配置 API Key：返回 500 和通用配置错误。
- 无效请求：返回 400 和具体可读提示。
- DeepSeek API 或网络异常：映射为适当的 502/503 响应，不向客户端泄露密钥或上游原始错误。
- 前端将错误显示在消息区，并保持现有历史消息。

## 验证

- 后端测试覆盖输入验证、成功响应转换及上游失败映射。
- 执行前端生产构建检查。
- README 说明依赖安装、环境变量配置和开发启动方式。

## 非目标

- 用户帐户、认证、数据存储。
- 对话导出、删除、重命名与历史恢复。
- 逐 token 流式输出。
