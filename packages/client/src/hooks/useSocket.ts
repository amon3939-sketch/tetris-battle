import { useEffect } from 'react';
import { socket } from '../socket.ts';

export function useSocketEvent<T = unknown>(
  event: string,
  handler: (data: T) => void,
) {
  useEffect(() => {
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [event, handler]);
}
