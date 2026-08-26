# DeepSeek AI Chat

一个使用 React 和 Node.js 构建的基础文本 AI 对话应用。浏览器只会请求本地 Node 服务，DeepSeek API Key 始终保留在服务端环境变量中。

## 环境要求

- Node.js 20 或更新版本
- 一个新生成的 DeepSeek API Key

## 本地启动

1. 安装根目录、客户端和服务端依赖：

   ```bash
   npm install
   npm install --prefix client
   npm install --prefix server
   ```

2. 创建仅供本地使用的环境变量文件：

   ```bash
   Copy-Item server/.env.example server/.env
   ```

3. 编辑 `server/.env`，填入新生成的密钥：

   ```env
   DEEPSEEK_API_KEY=你的新DeepSeek密钥
   DEEPSEEK_MODEL=deepseek-chat
   PORT=3001
   ```

4. 启动前后端开发服务器：

   ```bash
   npm run dev
   ```

打开 Vite 输出的本地地址（通常是 `http://localhost:5173`）。

## 验证

```bash
npm test
npm run build
```

## 安全说明

- 不要把 API Key 写入 `client/`、前端环境变量或源代码。
- `server/.env` 已被 `.gitignore` 忽略，绝不能提交。
- 如果你曾在聊天、代码或截图中分享过密钥，请立即在 DeepSeek 控制台撤销它并生成新密钥。
