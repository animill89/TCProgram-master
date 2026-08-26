import 'dotenv/config';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3001;
const app = createApp({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
});

app.listen(port, () => {
  console.log(`DeepSeek chat server listening on http://localhost:${port}`);
});
