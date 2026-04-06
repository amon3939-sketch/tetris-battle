import { useEffect, useRef, useCallback } from 'react';
import type { Action } from '@tetris/engine/src/types.ts';

interface InputConfig {
  das: number;
  arr: number;
}

const REPEATABLE: Set<Action> = new Set(['move_left', 'move_right', 'soft_drop']);

export function useInputHandler(
  active: boolean,
  config: InputConfig,
  sendAction: (action: Action) => void,
  keyMap?: Record<string, Action>,
) {
  const sendRef = useRef(sendAction);
  sendRef.current = sendAction;

  const keyMapRef = useRef(keyMap);
  keyMapRef.current = keyMap;

  const timersRef = useRef<Map<string, { dasTimer: ReturnType<typeof setTimeout> | null; arrTimer: ReturnType<typeof setInterval> | null }>>(new Map());

  useEffect(() => {
    if (!active) return;

    const getKeyMap = (): Record<string, Action> => {
      return keyMapRef.current ?? {
        'ArrowLeft': 'move_left',
        'ArrowRight': 'move_right',
        'ArrowDown': 'soft_drop',
        'ArrowUp': 'hard_drop',
        ' ': 'rotate_cw',
        'Shift': 'hold',
      };
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // チャット入力中はスキップ
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      const action = getKeyMap()[e.key];
      if (!action) return;

      e.preventDefault();

      // 既に押下中ならスキップ
      if (timersRef.current.has(e.key)) return;

      // 即座に1回実行
      sendRef.current(action);

      // DAS/ARR
      if (REPEATABLE.has(action)) {
        const dasTimer = setTimeout(() => {
          const entry = timersRef.current.get(e.key);
          if (!entry) return;
          entry.arrTimer = setInterval(() => {
            sendRef.current(action);
          }, config.arr);
        }, config.das);

        timersRef.current.set(e.key, { dasTimer, arrTimer: null });
      } else {
        timersRef.current.set(e.key, { dasTimer: null, arrTimer: null });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const entry = timersRef.current.get(e.key);
      if (entry) {
        if (entry.dasTimer) clearTimeout(entry.dasTimer);
        if (entry.arrTimer) clearInterval(entry.arrTimer);
        timersRef.current.delete(e.key);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      for (const entry of timersRef.current.values()) {
        if (entry.dasTimer) clearTimeout(entry.dasTimer);
        if (entry.arrTimer) clearInterval(entry.arrTimer);
      }
      timersRef.current.clear();
    };
  }, [active, config.das, config.arr]);
}
