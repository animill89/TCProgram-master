import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { streamChat } from './api.js';

vi.mock('./api.js', () => ({ sendChat: vi.fn(), streamChat: vi.fn() }));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
