import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchHotels, fetchRailTickets, streamChat } from './api.js';
import './App.css';
import './H5-fixes.css';
import './GroupChat.css';

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

const groupMessages = [
  { id: 'g1', senderName: '用户A', content: '周六去上海玩吧！我查了机票还行', timestamp: '20:41' },
  { id: 'g2', senderName: '用户E', content: '高铁吧，飞机延误怕了', timestamp: '20:42' },
  { id: 'g3', senderName: '用户B', content: '我要去迪士尼乐园！！', timestamp: '20:43' },
  { id: 'g4', senderName: '用户C', content: '住外滩附近吧，晚上能逛', timestamp: '20:44' },
  { id: 'g5', senderName: '用户D', content: '我想住迪士尼附近，第二天不用早起', timestamp: '20:45' },
  { id: 'g6', senderName: '用户E', content: '我觉得住虹桥火车站附近方便，返程近', timestamp: '20:46' },
  { id: 'g7', senderName: '用户A', content: '那就本周六出发，周一回来，3天2夜', timestamp: '20:47' },
  { id: 'g8', senderName: '我', content: '好的', timestamp: '20:48' },
];

function GroupChat({ onShare }) {
  const [chatMessages, setChatMessages] = useState(groupMessages);
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState([]);
  const [selecting, setSelecting] = useState(false);
  const timers = useRef(new Map());
  const longPressedMessageId = useRef(null);
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const startLongPress = (id) => {
    if (selecting) return;
    longPressedMessageId.current = null;
    timers.current.set(id, setTimeout(() => {
      longPressedMessageId.current = id;
      setSelecting(true);
      setSelected((current) => current.includes(id) ? current : [...current, id]);
    }, 300));
  };
  const endLongPress = (id) => { const timer = timers.current.get(id); clearTimeout(timer); timers.current.delete(id); };
  const cancelLongPress = (id) => { const timer = timers.current.get(id); clearTimeout(timer); timers.current.delete(id); };
  const share = () => {
    const content = chatMessages.filter((message) => selected.includes(message.id)).map((message) => `[${message.senderName} ${message.timestamp}] ${message.content}`).join('\n');
    onShare({ content, count: selected.length });
  };
  return <><style>{`.group-message--self::before{left:auto!important;right:-42px!important}.group-message--self .group-message__author{text-align:right}`}</style><section className={`group-chat ${selecting ? 'group-chat--selecting' : ''}`} aria-label="旅行群聊" style={{ margin: '0 -18px', minHeight: '100dvh' }}>
    <header className="group-chat__header" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10, margin: 0, width: '100%', background: '#f7f7f7' }}>{selecting ? <><button type="button" onClick={() => { setSelecting(false); setSelected([]); }}>取消</button><strong>已选择 {selected.length} 条消息</strong><span aria-hidden="true">⌕</span></> : <h1>旅行群聊（6 人）</h1>}</header>
    {chatMessages.map((message) => <div className="group-message-row" key={message.id}>{selecting && <input className="group-message__checkbox" type="checkbox" aria-label="选择消息" checked={selected.includes(message.id)} readOnly onClick={() => toggle(message.id)} />}<article role="article" aria-label="消息" aria-checked={selected.includes(message.id)} className={`group-message ${message.senderName === '我' ? 'group-message--self' : ''} ${selected.includes(message.id) ? 'group-message--selected' : ''}`} style={message.senderName === '我' ? { marginLeft: 'auto', marginRight: 48, background: '#95ec69', textAlign: 'right' } : undefined} onPointerDown={() => startLongPress(message.id)} onPointerUp={() => endLongPress(message.id)} onPointerLeave={() => cancelLongPress(message.id)} onPointerCancel={() => cancelLongPress(message.id)} onClick={() => { if (longPressedMessageId.current === message.id) { longPressedMessageId.current = null; return; } if (selecting) toggle(message.id); }}>{message.senderName !== '我' && <span className="group-message__author">{message.senderName} · {message.timestamp}</span>}<p>{message.content}</p></article></div>)}
    {selecting ? <div className="group-actions"><button type="button" onClick={share} disabled={!selected.length} aria-label="分享给 AI">↗<small>分享给 AI</small></button><button type="button" aria-label="复制">▣</button><button type="button" aria-label="收藏">◇</button><button type="button" aria-label="删除">♧</button><button type="button" aria-label="更多">✉</button></div> : <form className="group-composer" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) { setChatMessages((items) => [...items, { id: `g-${Date.now()}`, senderName: '我', timestamp: '现在', content: draft.trim() }]); setDraft(''); } }}><input aria-label="群聊消息输入框" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="输入消息" /><button type="submit">发送</button></form>}
  </section></>;
}

function MessageBubble({ message, onContinueHotel }) {
  return <article className={`message message--${message.role}`} aria-label="消息">
    {message.role === 'assistant' && message.content
      ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      : message.role === 'user' ? <p>{message.content}</p> : null}
    {message.error && <p className="message__error">{message.error}</p>}
    {message.transportOptions?.map((option) => <section className="train-card" aria-label={`${option.type}班次推荐`} key={option.train}><b>{option.type}推荐 · {option.reason}</b><div><strong>{option.departureTime}</strong><span>{option.departureStation}</span><em>{option.train} · {option.duration}</em><strong>{option.arrivalTime}</strong><span>{option.arrivalStation}</span><i>{option.price}</i></div><small>{option.date} · 单程</small><button type="button">订票</button></section>)}
    {message.role === 'assistant' && message.content && !message.hotelOptions && <a href="#hotel-recommendations" onClick={(event) => { event.preventDefault(); onContinueHotel(); }}>继续推荐酒店</a>}
    {message.hotelOptions?.map((hotel) => <section className="hotel-card" aria-label="酒店推荐" key={hotel.name}><b>{hotel.distance}</b><h3>{hotel.name}</h3><p>{hotel.reason}</p><strong>{hotel.room}</strong><i>{hotel.price}</i><button type="button">订房</button></section>)}
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
  const [isPreparing, setIsPreparing] = useState(false);
  const [pendingShare, setPendingShare] = useState('');
  const [pendingHotel, setPendingHotel] = useState('');
  const [queryProgress, setQueryProgress] = useState('');
  const [sharedRecords, setSharedRecords] = useState('');
  const activeRequest = useRef(null);
  const messageSequence = useRef(0);
  const isChatting = messages.length > 0 || isPending || isPreparing;
  const [route, setRoute] = useState(window.location.pathname);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const submit = async (value = draft, options = {}) => {
    const content = value.trim();
    if (!content || isPending) return;
    const nextMessages = [...messages, { role: 'user', content: options.visibleContent || content }];
    const requestMessages = options.hotelRecords
      ? [{ role: 'user', content: options.hotelRecords }, { role: 'user', content }]
      : [...messages.filter((message) => !message.transportOptions), { role: 'user', content }];
    const assistantId = `assistant-${++messageSequence.current}`;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setMessages([...nextMessages, { id: assistantId, role: 'assistant', content: '' }]);
    setDraft('');
    if (options.progress) setQueryProgress(options.progress);
    setIsPending(true);
    let receivedContent = '';
    try {
      const result = await streamChat(requestMessages, {
        signal: controller.signal,
        transportCard: options.transportCard,
        transportOnly: options.transportOnly,
        hotelOptions: options.hotelOptions,
        onDelta: (delta) => { receivedContent += delta; setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, content: message.content + delta } : message))); },
        onTransport: (transportOptions) => setMessages((current) => current.map((message) => (
          message.id === assistantId ? { ...message, transportOptions } : message
        ))),
        onHotel: (hotelOptions) => setMessages((current) => current.map((message) => (
          message.id === assistantId ? { ...message, hotelOptions } : message
        ))),
      });
      if (options.transportOptions) setMessages((current) => current.map((message) => (
        message.id === assistantId ? { ...message, transportOptions: options.transportOptions } : message
      )));
      if (options.hotelOptions) {
        const match = receivedContent.match(/<!--SELECTED_HOTEL_IDS:\s*(\[[\s\S]*?\])\s*-->/);
        const selectedIds = match ? JSON.parse(match[1]) : [];
        const hotelOptions = options.hotelOptions.filter((hotel) => selectedIds.includes(hotel.id)).sort((a, b) => selectedIds.indexOf(a.id) - selectedIds.indexOf(b.id));
        setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, content: message.content.replace(match?.[0] ?? '', '').trim(), hotelOptions } : message)));
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setMessages((current) => current.map((message) => (
          message.id === assistantId ? { ...message, error: error.message || '请求失败，请稍后重试。' } : message
        )));
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      setIsPending(false);
      setQueryProgress('');
    }
  };
  const openAiWithPrompt = ({ content, count }) => {
    const visibleContent = `已分享 ${count} 条聊天记录\n帮我制定旅行规划`;
    window.history.pushState({}, '', '/ai');
    setRoute('/ai');
    setSharedRecords(content);
    setPendingShare(visibleContent);
    setIsPreparing(true);
    fetchRailTickets(content).then(({ options }) => {
      setPendingShare('');
      submit(content, { visibleContent, transportCard: options, transportOnly: true, progress: '正在查询预算内高铁与参考机票' });
    }).catch((error) => setMessages([{ role: 'user', content: visibleContent }, { id: `assistant-${++messageSequence.current}`, role: 'assistant', content: '', error: error.message }])).finally(() => setIsPreparing(false));
  };
  const continueHotel = async () => {
    if (!sharedRecords || isPending) return;
    const visibleContent = '继续推荐酒店';
    setPendingHotel(visibleContent);
    setIsPreparing(true);
    fetchHotels(sharedRecords).then(({ options }) => {
      setPendingHotel('');
      submit('请继续推荐酒店', { visibleContent, hotelOptions: options, progress: '正在根据真实酒店数据生成推荐' });
    }).catch((error) => setMessages((current) => [...current, { role: 'user', content: visibleContent }, { id: `assistant-${++messageSequence.current}`, role: 'assistant', content: '', error: error.message }])).finally(() => setIsPreparing(false));
  };
  const onKeyDown = (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } };
  return <main className={`trip-app ${isChatting ? 'trip-app--chatting' : ''}`} style={(route === '/' || route === '/group-chat') ? { background: '#f5f5f5' } : undefined}>
    <div className="phone-status" aria-hidden="true"><b>20:41</b><span>● ● ●　5G ▮▮▮　⌁</span></div>
    <header className="trip-header"><button type="button" className="back-button" aria-label="返回首页" onClick={() => setMessages([])}>‹</button><div className="trip-mark" aria-label="DeepTrip 标志">✦</div><div className="header-actions"><button type="button" aria-label="更多操作">•••</button><button type="button" aria-label="打开设置">◉</button></div></header>
    <section className="page-content" aria-live="polite" aria-label="对话内容" style={(route === '/' || route === '/group-chat') ? { background: '#f5f5f5', paddingBottom: 0 } : undefined}>{route === '/' || route === '/group-chat' ? <GroupChat onShare={openAiWithPrompt} /> : isChatting ? <div className="chat-view"><h1>旅行 AI 助手</h1>{pendingShare && <MessageBubble message={{ role: 'user', content: pendingShare }} onContinueHotel={continueHotel} />}{messages.map((message, index) => <MessageBubble key={message.id || `${message.role}-${index}`} message={message} onContinueHotel={continueHotel} />)}{pendingHotel && <MessageBubble message={{ role: 'user', content: pendingHotel }} onContinueHotel={continueHotel} />}{(isPreparing || queryProgress || (isPending && !messages.at(-1)?.content)) && <div className="thinking" role="status" aria-label="AI 思考中"><span className="thinking__spinner" aria-hidden="true" /><span>AI 思考中…</span>{queryProgress && <small>{queryProgress}</small>}</div>}</div> : <Home onSuggestion={submit} />}</section>
    <form className="mobile-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}><label className="sr-only" htmlFor="chat-input">消息输入框</label><textarea id="chat-input" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="发消息或按住说话…" rows="1" disabled={isPending} /><button type="submit" disabled={!draft.trim() || isPending} aria-label="发送消息"><span aria-hidden="true">⌁</span></button></form>
    <div className="home-indicator" aria-hidden="true" />
  </main>;
}
