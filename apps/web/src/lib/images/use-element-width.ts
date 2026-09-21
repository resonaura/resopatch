import { useCallback, useEffect, useRef, useState } from 'react';

/** Debounced ResizeObserver on an arbitrary element, shared by every progressive-loading hook. */
export function useElementWidth(debounceMs: number) {
  const [width, setWidth] = useState<number | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback(
    (node: Element | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;

      if (node) {
        observerRef.current = new ResizeObserver((entries) => {
          if (!entries.length) return;
          const nextWidth = entries[0].contentRect.width;

          if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
          resizeTimeoutRef.current = setTimeout(() => setWidth(nextWidth), debounceMs);
        });
        observerRef.current.observe(node);
      }
    },
    [debounceMs],
  );

  useEffect(
    () => () => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      observerRef.current?.disconnect();
    },
    [],
  );

  return { ref, width };
}
