import { useEffect, useRef } from 'react';

export function useGameLoop(
  active: boolean,
  onTick: (deltaMs: number) => void,
): void {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!active) return;

    let rafId: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;
      onTickRef.current(delta);
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [active]);
}
