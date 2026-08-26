import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat } from './api.js';
import './App.css';
import './H5-fixes.css';

const suggestions = [
  { icon: '🪻', label: '帮我做攻略', prompt: '到苏州玩，推荐下景点和当地美食', tone: 'violet', testName: '帮我做攻略：苏州景点和美食' },
  { icon: '🚄', label: '订机票/火车票', prompt: '第一次坐飞机要注意什么？', tone: 'blue' },
  { icon: '🏨', label: '挑个好酒店', prompt: '无锡推开窗就是地标的酒店有哪些？', tone: 'coral' },
  { icon: '🌄', label: '周末去哪里玩', prompt: '上海最佳观景台，俯瞰全城', tone: 'mint' },
];

const discoveries = [
  { image: '/images/hd.webp', title: '用 AI 买票订酒店，享专属优惠', tag: '旅行省心计划', featured: true, alt: '旅行优惠海报' },
  { image: 'https://images.unsplash.com/photo-1544986581-efac024faf62?auto=format&fit=crop&w=900&q=80', title: '北京2h直达！发现一个“小桂林”，山水美哭了！', likes: '31100', alt: '江南水乡' },
  { image: '/images/bg1.jpg', title: '古园风景', alt: '古园风景' },
  { image: '/images/bg.png', title: '秋色建筑', alt: '秋色建筑' },
];

function MessageBubble({ message }) {
  return <article className={`message message--${message.role}`} aria-label="消息">
    {message.role === 'assistant' && message.content
      ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      : message.role === 'user' ? <p>{message.content}</p> : null}
    {message.error && <p className="message__error">{message.error}</p>}
  </article>;
}

function Home({ onSuggestion }) {
  return <>
    <section className="hero" aria-label="旅行助手首页"><div className="hero__headline"><em>DeepTrip</em><span>想去哪里玩？</span><b>🎁</b></div><button className="refresh-button" type="button" aria-label="换一批推荐">换一批 <span>↻</span></button></section>
    <section className="suggestion-grid" aria-label="旅行推荐">{suggestions.map((suggestion) => <button className={`suggestion-card suggestion-card--${suggestion.tone}`} key={suggestion.label} type="button" aria-label={suggestion.testName || `${suggestion.label}：${suggestion.prompt}`} onClick={() => onSuggestion(suggestion.prompt)}><span className="suggestion-card__label">{suggestion.icon} {suggestion.label}</span><strong>{suggestion.prompt}</strong><span className="suggestion-card__arrow">↗</span></button>)}</section>
    <section className="discovery" aria-label="本周玩点新的"><h2>🏝️ 本周玩点新的</h2><div className="discovery-grid">{discoveries.map((item) => <article className={`discovery-card ${item.featured ? 'discovery-card--featured' : ''}`} key={item.title}><img src={item.image} alt={item.alt} />{item.tag && <span className="discovery-card__tag">{item.tag}</span>}<h3>{item.title}</h3>{item.likes && <p>♡ {item.likes}</p>}</article>)}</div></section>
  </>;
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [isPending, setIsPending] = useState(false);
  const activeRequest = useRef(null);
  const messageSequence = useRef(0);
  const isChatting = messages.length > 0 || isPending;

  useEffect(() => () => activeRequest.current?.abort(), []);

  const submit = async (value = draft) => {
    const content = value.trim();
    if (!content || isPending) return;
    const nextMessages = [...messages, { role: 'user', content }];
    const assistantId = `assistant-${++messageSequence.current}`;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setMessages([...nextMessages, { id: assistantId, role: 'assistant', content: '' }]);
    setDraft('');
    setIsPending(true);
    try {
      await streamChat(nextMessages, {
        signal: controller.signal,
        onDelta: (delta) => setMessages((current) => current.map((message) => (
          message.id === assistantId ? { ...message, content: message.content + delta } : message
        ))),
      });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setMessages((current) => current.map((message) => (
          message.id === assistantId ? { ...message, error: error.message || '请求失败，请稍后重试。' } : message
        )));
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      setIsPending(false);
    }
  };
  const onKeyDown = (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } };
  return <main className={`trip-app ${isChatting ? 'trip-app--chatting' : ''}`}>
    <div className="phone-status" aria-hidden="true"><b>20:41</b><span>● ● ●　5G ▮▮▮　⌁</span></div>
    <header className="trip-header"><button type="button" className="back-button" aria-label="返回首页" onClick={() => setMessages([])}>‹</button><div className="trip-mark" aria-label="DeepTrip 标志">✦</div><div className="header-actions"><button type="button" aria-label="更多操作">•••</button><button type="button" aria-label="打开设置">◉</button></div></header>
    <section className="page-content" aria-live="polite" aria-label="对话内容">{isChatting ? <div className="chat-view"><h1>旅行 AI 助手</h1>{messages.map((message, index) => <MessageBubble key={message.id || `${message.role}-${index}`} message={message} />)}{isPending && !messages.at(-1)?.content && <p className="thinking">正在连接 AI…</p>}</div> : <Home onSuggestion={submit} />}</section>
    <form className="mobile-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}><label className="sr-only" htmlFor="chat-input">消息输入框</label><textarea id="chat-input" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="发消息或按住说话…" rows="1" disabled={isPending} /><button type="submit" disabled={!draft.trim() || isPending} aria-label="发送消息"><span aria-hidden="true">⌁</span></button></form>
    <div className="home-indicator" aria-hidden="true" />
  </main>;
}
