import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { intrinsicAspectRatio } from './aspectRatio';
import { useProgressiveImage } from './useProgressiveImage';

export interface ProgressiveImageProps {
  src: string;
  alt: string;
  aspectRatio?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Passed to the rendered <img> elements — defaults to 'cover'. Use 'contain' when the
   *  image must be fully visible inside a fixed-height container (e.g. the banner strip). */
  objectFit?: 'cover' | 'contain';
}

const SKELETON_STYLE_ID = 'progressive-image-skeleton-keyframes';

// Runs once per document (module-level, not per-render): no shared stylesheet to put
// a @keyframes rule in, and inline `style` props can't declare one — so the keyframes
// are injected as a tiny detached <style> tag the first time this module loads.
if (typeof document !== 'undefined' && !document.getElementById(SKELETON_STYLE_ID)) {
  const style = document.createElement('style');
  style.id = SKELETON_STYLE_ID;
  style.textContent = '@keyframes progressive-image-skeleton-pulse { 0%, 100% { opacity: 0; } 50% { opacity: 0; } }';
  document.head.appendChild(style);
}

/** Shown before even the LQIP has appeared — reserves the container's already-known
 * aspect-ratio space and gives immediate feedback instead of a blank flash. */
function Skeleton({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'transparent',
        animation: 'progressive-image-skeleton-pulse 1.4s ease-in-out infinite',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease',
        pointerEvents: 'none',
      }}
    />
  );
}

function containerStyle(aspectRatio: string | undefined, style: React.CSSProperties | undefined): React.CSSProperties {
  return {
    position: 'relative',
    zIndex: 0,
    overflow: 'hidden',
    aspectRatio,
    backgroundColor: 'transparent',
    ...style,
  };
}

/** Photos (webp/avif): LQIP blur-fade in, then invisibly preload each breakpoint
 * upgrade and swap once fully loaded so nothing ever pops in unloaded. */
export const ProgressiveImage = forwardRef<HTMLDivElement, ProgressiveImageProps>(function ProgressiveImage(
  { src, alt, aspectRatio, className = '', style = {}, objectFit = 'cover' },
  forwardedRef,
) {
  const { ref: hookRef, src: targetSrc, lqip, isLoaded, intrinsic } = useProgressiveImage(src);

  // When the caller gives us a fixed-height class (h-full / h-[Npx]) the container
  // already has an explicit height — letting aspectRatio override it would break layout.
  const fixedHeight = className.includes('h-full') || /\bh-\[/.test(className);
  const resolvedAspectRatio = aspectRatio ?? (fixedHeight ? undefined : intrinsicAspectRatio(intrinsic));

  const [currentSrc, setCurrentSrc] = useState<string | null>(null);
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const lastStableSrc = useRef<string | null>(null);

  const setRef = (node: HTMLDivElement | null) => {
    hookRef(node);
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  useEffect(() => {
    if (!isLoaded || !targetSrc) return;
    if (!currentSrc) {
      setCurrentSrc(targetSrc);
      lastStableSrc.current = targetSrc;
    } else if (targetSrc !== lastStableSrc.current) {
      setPendingSrc(targetSrc);
      setIsTransitioning(true);
    }
  }, [targetSrc, isLoaded, currentSrc]);

  const handlePendingLoad = () => {
    if (!pendingSrc) return;
    setCurrentSrc(pendingSrc);
    lastStableSrc.current = pendingSrc;
    setPendingSrc(null);
    setIsTransitioning(false);
  };

  return (
    <div ref={setRef} className={`progressive-image-container ${className}`} style={containerStyle(resolvedAspectRatio, style)}>
      <Skeleton visible={!lqip} />
      {lqip && (
        <img
          src={lqip}
          alt=""
          aria-hidden="true"
          style={{
            width: '100%',
            height: '100%',
            objectFit,
            filter: 'blur(20px)',
            transition: 'opacity 0.6s ease',
            opacity: currentSrc ? 0 : 1,
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 1,
          }}
        />
      )}
      {currentSrc && (
        <img
          src={currentSrc}
          alt={alt}
          decoding="async"
          style={{
            width: '100%',
            height: '100%',
            objectFit,
            transition: 'opacity 0.5s ease-in-out',
            opacity: isTransitioning ? 0.7 : 1,
            position: 'relative',
            zIndex: 2,
          }}
        />
      )}
      {pendingSrc && (
        <img
          src={pendingSrc}
          alt=""
          decoding="async"
          onLoad={handlePendingLoad}
          onError={handlePendingLoad}
          style={{
            width: '100%',
            height: '100%',
            objectFit,
            position: 'absolute',
            top: 0,
            left: 0,
            opacity: 0,
            zIndex: 0,
          }}
        />
      )}
    </div>
  );
});
