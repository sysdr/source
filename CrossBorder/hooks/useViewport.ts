import { useCallback, useEffect, useState } from 'react';
import {
  allowsDesktopDataEntry,
  classifyViewportWidth,
  type ViewportBand,
} from '../services/responsive';

function readWidth(): number {
  if (typeof window === 'undefined') return 1280;
  return window.innerWidth;
}

export function useViewport() {
  const [width, setWidth] = useState(readWidth);

  useEffect(() => {
    const onResize = () => setWidth(readWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const band: ViewportBand = classifyViewportWidth(width);
  return {
    width,
    band,
    isMobile: band === 'mobile',
    isTablet: band === 'tablet',
    isDesktop: band === 'desktop',
    allowsDataEntry: allowsDesktopDataEntry(width),
  };
}

export function useMediaQuery(query: string): boolean {
  const get = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }, [query]);

  const [matches, setMatches] = useState(get);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
