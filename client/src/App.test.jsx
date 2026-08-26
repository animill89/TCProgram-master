import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { streamChat } from './api.js';

vi.mock('./api.js', () => ({ sendChat: vi.fn(), streamChat: vi.fn() }));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/ai');
  });

  it('uses the supplied local images in the lower travel feed', () => {
    const { container } = render(<App />);

    expect(container.querySelector('img[src="/images/hd.webp"]')).toBeInTheDocument();
    expect(container.querySelector('img[src="/images/bg1.jpg"]')).toBeInTheDocument();
    expect(container.querySelector('img[src="/images/bg.png"]')).toBeInTheDocument();
  });

  it('disables the send control for an empty message', () => {
    const { container } = render(<App />);

    expect(container.querySelector('.mobile-composer button')).toBeDisabled();
  });

  it('sends entered text to the streaming API', async () => {
    streamChat.mockImplementation(async (_messages, { onDelta }) => onDelta('你好，有什么可以帮你？'));
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole('textbox'), '你好{Enter}');

    expect(await screen.findByText('你好，有什么可以帮你？')).toBeInTheDocument();
    expect(streamChat).toHaveBeenCalledWith(
      [{ role: 'user', content: '你好' }],
      expect.objectContaining({ onDelta: expect.any(Function), signal: expect.any(AbortSignal) }),
    );
  });

  it('renders each stream delta as Markdown and enables input when done', async () => {
    streamChat.mockImplementation(async (_messages, { onDelta }) => {
      onDelta('# 苏州行程\n\n- 园林');
      onDelta('\n- 评弹\n\n**祝你玩得开心**');
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole('textbox'), '安排苏州行程{Enter}');

    expect(await screen.findByRole('heading', { name: '苏州行程' })).toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveTextContent('园林');
    expect(screen.getByText('祝你玩得开心').tagName).toBe('STRONG');
    await waitFor(() => expect(screen.getByRole('textbox')).not.toBeDisabled());
  });

  it('keeps a newline when Shift+Enter is pressed', () => {
    render(<App />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '第一行\n第二行' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(input).toHaveValue('第一行\n第二行');
  });

  it('keeps received content and displays a stream error underneath it', async () => {
    streamChat.mockImplementation(async (_messages, { onDelta }) => {
      onDelta('已收到的行程建议');
      throw new Error('AI 服务暂时不可用，请稍后重试。');
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole('textbox'), '你好{Enter}');

    expect(await screen.findByText('已收到的行程建议')).toBeInTheDocument();
    expect(await screen.findByText('AI 服务暂时不可用，请稍后重试。')).toBeInTheDocument();
  });

  it('renders GFM pipe syntax as an accessible table', async () => {
    streamChat.mockImplementation(async (_messages, { onDelta }) => {
      onDelta('| Name | Height |\n| --- | --- |\n| Tower | 546m |');
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole('textbox'), 'table{Enter}');

    expect(await screen.findByRole('table')).toHaveTextContent('Tower');
    expect(screen.getByRole('columnheader', { name: 'Height' })).toBeInTheDocument();
  });

  describe('群聊旅行页面', () => {
    beforeEach(() => {
      window.history.pushState({}, '', '/group-chat');
    });

    afterEach(() => {
      window.history.pushState({}, '', '/');
    });

    it('在群聊路由展示群聊标题和 mock 消息', () => {
      render(<App />);

      expect(screen.getByRole('heading', { name: /旅行群聊/ })).toBeInTheDocument();
      expect(screen.getAllByRole('article', { name: '消息' }).length).toBeGreaterThan(1);
    });

    it('长按消息进入多选模式并默认选中该消息', async () => {
      vi.useFakeTimers();
      render(<App />);
      const message = screen.getAllByRole('article', { name: '消息' })[0];

      fireEvent.pointerDown(message);
      act(() => vi.advanceTimersByTime(300));
      fireEvent.pointerUp(message);

      expect(screen.getByText(/已选择 1 条/)).toBeInTheDocument();
      expect(message).toHaveAttribute('aria-checked', 'true');
      expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
      vi.useRealTimers();
    });

    it('点击消息可切换选中状态', async () => {
      vi.useFakeTimers();
      render(<App />);
      const messages = screen.getAllByRole('article', { name: '消息' });

      fireEvent.pointerDown(messages[0]);
      act(() => vi.advanceTimersByTime(300));
      fireEvent.pointerUp(messages[0]);
      fireEvent.click(messages[0]);
      fireEvent.click(messages[1]);

      expect(messages[0]).toHaveAttribute('aria-checked', 'true');
      expect(messages[1]).toHaveAttribute('aria-checked', 'true');
      expect(screen.getAllByRole('checkbox')[1]).toBeChecked();
      fireEvent.click(messages[0]);
      expect(messages[0]).toHaveAttribute('aria-checked', 'false');
      expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
      vi.useRealTimers();
    });

    it('分享给 AI 时按原始顺序把选中消息带入 prompt', async () => {
      streamChat.mockImplementation(async (_messages, { onDelta }) => onDelta('已收到旅行讨论'));
      render(<App />);
      const messages = screen.getAllByRole('article', { name: '消息' });

      vi.useFakeTimers();
      fireEvent.pointerDown(messages[1]);
      act(() => vi.advanceTimersByTime(300));
      fireEvent.pointerUp(messages[1]);
      fireEvent.click(messages[0]);
      vi.useRealTimers();
      await userEvent.setup().click(screen.getByRole('button', { name: '分享给 AI' }));

      await waitFor(() => expect(streamChat).toHaveBeenCalled());
      const sentMessages = streamChat.mock.calls[0][0];
      expect(sentMessages[0].role).toBe('user');
      expect(sentMessages[0].content).not.toMatch(/请分析以下旅行群聊记录/);
      expect(streamChat.mock.calls[0][1].transportCard[0].train).toBe('G87');
      expect(sentMessages[0].content.indexOf('我们10月1日国庆节去西安旅游吧！！')).toBeLessThan(
        sentMessages[0].content.indexOf('我们6个人每人大概1500预算谁去规划一下旅行计划呢？'),
      );
      expect(await screen.findByText(/G87/)).toBeInTheDocument();
      expect(screen.getByText(/CA1234/)).toBeInTheDocument();
    });
  });
});
