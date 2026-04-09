import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../socket.ts';

interface ChatMessage {
  nickname: string;
  text: string;
  ts: number;
  isStamp?: boolean;
  stampStyle?: string;
}

interface Props {
  roomId: string;
}

export default function ChatBox({ roomId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const myNickname = useRef<string>('');
  const composingRef = useRef(false); // IME入力中フラグ

  useEffect(() => {
    myNickname.current = localStorage.getItem('tetris_nickname') || 'Guest';
  }, []);

  const onMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => {
      const next = [...prev, msg];
      if (next.length > 50) next.shift();
      return next;
    });
  }, []);

  const onStampMessage = useCallback((data: { nickname: string; text: string; style: string }) => {
    setMessages(prev => {
      const next = [...prev, { nickname: data.nickname, text: data.text, ts: Date.now(), isStamp: true, stampStyle: data.style }];
      if (next.length > 50) next.shift();
      return next;
    });
  }, []);

  useEffect(() => {
    socket.on('chat:message', onMessage);
    socket.on('stamp:receive', onStampMessage);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('stamp:receive', onStampMessage);
    };
  }, [onMessage, onStampMessage]);

  // Auto-scroll
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    const el = inputRef.current;
    if (!el) return;
    const text = el.value.trim().slice(0, 140);
    if (!text) return;
    socket.emit('chat:send', { text });
    el.value = '';
  };

  return (
    <div className="t99-frame" style={{
      display: 'flex',
      flexDirection: 'column',
      height: 200,
      width: '100%',
      maxWidth: 360,
      position: 'relative',
    }}>
      <div className="t99-frame-label">CHAT</div>
      <div style={{ fontSize: 11, color: 'rgba(0,200,255,0.5)', padding: '8px 10px 4px', borderBottom: '1px solid rgba(0,150,200,0.15)' }}>
        &nbsp;
      </div>
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 10px',
          fontSize: 13,
        }}
      >
        {messages.map((msg, i) => {
          const isMine = msg.nickname === myNickname.current;
          if (msg.isStamp) {
            // スタンプ表示（チャット内）
            return (
              <div key={i} style={{ textAlign: 'center', marginBottom: 6 }}>
                <span style={{ color: '#888', fontSize: 10 }}>{msg.nickname}</span>
                <div style={{
                  display: 'inline-block',
                  background: msg.stampStyle === 'pop'
                    ? 'linear-gradient(135deg, #ff6b6b, #ffa500)'
                    : '#2a2a4a',
                  padding: '4px 14px',
                  borderRadius: 12,
                  fontSize: msg.stampStyle === 'pop' ? 15 : 13,
                  fontWeight: msg.stampStyle === 'pop' ? 700 : 400,
                  fontFamily: msg.stampStyle === 'serious'
                    ? '"Yu Mincho", "Hiragino Mincho ProN", serif' : 'inherit',
                  color: '#fff',
                  marginTop: 2,
                }}>
                  {msg.text}
                </div>
              </div>
            );
          }
          return (
            <div
              key={i}
              style={{
                textAlign: isMine ? 'right' : 'left',
                marginBottom: 4,
              }}
            >
              <span style={{ color: '#888', fontSize: 11 }}>{msg.nickname}: </span>
              <span style={{
                display: 'inline-block',
                background: isMine ? '#4a6cf7' : '#2a2a4a',
                padding: '3px 8px',
                borderRadius: 8,
                maxWidth: '80%',
                wordBreak: 'break-word',
              }}>
                {msg.text}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', borderTop: '1px solid rgba(0,150,200,0.2)' }}>
        <input
          ref={inputRef}
          maxLength={140}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !composingRef.current) handleSend();
          }}
          placeholder="メッセージ..."
          style={{
            flex: 1,
            border: 'none',
            borderRadius: 0,
            background: 'transparent',
            padding: '8px 10px',
            color: '#e0e0e0',
          }}
        />
        <button
          onClick={handleSend}
          style={{
            borderRadius: 0, padding: '8px 12px', fontSize: 12,
            background: 'rgba(0,100,200,0.5)', color: '#00ccff',
            border: 'none', cursor: 'pointer', fontWeight: 700,
          }}
        >
          送信
        </button>
      </div>
    </div>
  );
}
