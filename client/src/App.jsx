import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat } from './api.js';
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
  { id: 'g1', senderName: '用户A', content: '我们10月1日国庆节去西安旅游吧！！10月7日回来！', timestamp: '20:41' },
  { id: 'g2', senderName: '用户B', content: '我们6个人每人大概1500预算谁去规划一下旅行计划呢？', timestamp: '20:42' },
  { id: 'g3', senderName: '用户C', content: '还有酒店定哪一家的？有没有什么什么推荐的', timestamp: '20:43' },
  { id: 'g4', senderName: '用户D', content: '现在同城旅行的程心AI不是很火嘛，让群主将我们的需求发个它让它推荐吧！', timestamp: '20:44' },
  { id: 'g5', senderName: '我', content: '好的', timestamp: '20:45' },
];
const transportOptions = [{ type: '高铁', reason: '价格更低，适合人均1500元预算', train: 'G87', date: '10月1日', departureTime: '08:30', departureStation: '北京西', arrivalTime: '12:58', arrivalStation: '西安北', duration: '4小时28分', price: '¥553' }, { type: '高铁', reason: '上午抵达，方便当天游览', train: 'G571', date: '10月1日', departureTime: '10:15', departureStation: '北京西', arrivalTime: '14:48', arrivalStation: '西安北', duration: '4小时33分', price: '¥553' }, { type: '飞机', reason: '飞行时间短，适合优先节省时间', train: 'CA1234', date: '10月1日', departureTime: '09:20', departureStation: '北京首都', arrivalTime: '11:35', arrivalStation: '西安咸阳', duration: '2小时15分', price: '¥780' }];
const hotelOptions = [{ name: '西安钟楼诺富特酒店', room: '高级大床房', distance: '距钟楼地铁站 300m', reason: '步行可达钟楼商圈和回民街，交通便利', price: '¥468/晚' }, { name: '西安威斯汀大酒店', room: '豪华双床房', distance: '距大雁塔商圈 500m', reason: '适合朋友同行，周边餐饮和景点集中', price: '¥620/晚' }, { name: '西安城墙亚朵酒店', room: '行政大床房', distance: '距永宁门地铁站 400m', reason: '预算友好，地铁直达钟楼商圈', price: '¥398/晚' }];

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
    {message.transportOptions && <a href="#hotel-recommendations" onClick={(event) => { event.preventDefault(); onContinueHotel(); }}>继续推荐酒店</a>}
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
  const activeRequest = useRef(null);
  const messageSequence = useRef(0);
  const isChatting = messages.length > 0 || isPending;
  const [route, setRoute] = useState(window.location.pathname);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const submit = async (value = draft, options = {}) => {
    const content = value.trim();
    if (!content || isPending) return;
    const nextMessages = [...messages, { role: 'user', content: options.visibleContent || content }];
    const requestMessages = [...messages.filter((message) => !message.transportOptions), { role: 'user', content }];
    const assistantId = `assistant-${++messageSequence.current}`;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setMessages([...nextMessages, { id: assistantId, role: 'assistant', content: '' }]);
    setDraft('');
    setIsPending(true);
    try {
      await streamChat(requestMessages, {
        signal: controller.signal,
        transportCard: options.transportCard,
        hotelOptions: options.hotelOptions,
        onDelta: (delta) => setMessages((current) => current.map((message) => (
          message.id === assistantId ? { ...message, content: message.content + delta } : message
        ))),
      });
      if (options.transportOptions) setMessages((current) => current.map((message) => (
        message.id === assistantId ? { ...message, transportOptions: options.transportOptions } : message
      )));
      if (options.hotelOptions) setMessages((current) => current.map((message) => (
        message.id === assistantId ? { ...message, hotelOptions: options.hotelOptions } : message
      )));
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
  const openAiWithPrompt = ({ content, count }) => { window.history.pushState({}, '', '/ai'); setRoute('/ai'); submit(content, { visibleContent: `已分享 ${count} 条聊天记录\n帮我制定旅行规划`, transportCard: transportOptions, transportOptions }); };
  const continueHotel = () => submit('请继续推荐酒店', { visibleContent: '继续推荐酒店', hotelOptions });
  const onKeyDown = (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } };
  return <main className={`trip-app ${isChatting ? 'trip-app--chatting' : ''}`} style={(route === '/' || route === '/group-chat') ? { background: '#f5f5f5' } : undefined}>
    <div className="phone-status" aria-hidden="true"><b>20:41</b><span>● ● ●　5G ▮▮▮　⌁</span></div>
    <header className="trip-header"><button type="button" className="back-button" aria-label="返回首页" onClick={() => setMessages([])}>‹</button><div className="trip-mark" aria-label="DeepTrip 标志">✦</div><div className="header-actions"><button type="button" aria-label="更多操作">•••</button><button type="button" aria-label="打开设置">◉</button></div></header>
    <section className="page-content" aria-live="polite" aria-label="对话内容" style={(route === '/' || route === '/group-chat') ? { background: '#f5f5f5', paddingBottom: 0 } : undefined}>{route === '/' || route === '/group-chat' ? <GroupChat onShare={openAiWithPrompt} /> : isChatting ? <div className="chat-view"><h1>旅行 AI 助手</h1>{messages.map((message, index) => <MessageBubble key={message.id || `${message.role}-${index}`} message={message} onContinueHotel={continueHotel} />)}{isPending && !messages.at(-1)?.content && <p className="thinking">正在连接 AI…</p>}</div> : <Home onSuggestion={submit} />}</section>
    <form className="mobile-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}><label className="sr-only" htmlFor="chat-input">消息输入框</label><textarea id="chat-input" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="发消息或按住说话…" rows="1" disabled={isPending} /><button type="submit" disabled={!draft.trim() || isPending} aria-label="发送消息"><span aria-hidden="true">⌁</span></button></form>
    <div className="home-indicator" aria-hidden="true" />
  </main>;
}
