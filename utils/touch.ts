/**
 * Touch utility functions for mobile support
 */

// Minimum touch target size (Apple HIG recommendation)
export const MIN_TOUCH_TARGET = 44;
export const RECOMMENDED_TOUCH_TARGET = 48;

/**
 * Detect if the device supports touch
 */
export function isTouchDevice(): boolean {
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    // @ts-expect-error - IE/Edge legacy
    navigator.msMaxTouchPoints > 0
  );
}

/**
 * Get the first touch from a TouchEvent
 */
export function getFirstTouch(e: TouchEvent): Touch | null {
  return e.touches.length > 0 ? e.touches[0] : null;
}

/**
 * Calculate distance between two touch points (for pinch gestures)
 */
export function getTouchDistance(touch1: Touch, touch2: Touch): number {
  const dx = touch1.clientX - touch2.clientX;
  const dy = touch1.clientY - touch2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate center point between two touches
 */
export function getTouchCenter(touch1: Touch, touch2: Touch): { x: number; y: number } {
  return {
    x: (touch1.clientX + touch2.clientX) / 2,
    y: (touch1.clientY + touch2.clientY) / 2,
  };
}

/**
 * Prevent default touch scroll behavior on an element
 */
export function preventTouchScroll(element: HTMLElement): () => void {
  const handler = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      e.preventDefault();
    }
  };

  element.addEventListener('touchmove', handler, { passive: false });
  return () => element.removeEventListener('touchmove', handler);
}

/**
 * Double-tap detector class
 * Detects quick successive taps within a time threshold
 */
export class DoubleTapDetector {
  private lastTapTime: number = 0;
  private readonly threshold: number;

  constructor(thresholdMs: number = 300) {
    this.threshold = thresholdMs;
  }

  /**
   * Process a tap and return true if it's a double-tap
   */
  checkTap(): boolean {
    const now = Date.now();
    const isDoubleTap = now - this.lastTapTime < this.threshold;
    this.lastTapTime = now;
    return isDoubleTap;
  }

  /**
   * Reset the detector state
   */
  reset(): void {
    this.lastTapTime = 0;
  }
}

/**
 * Throttle a function for touch events
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return function (this: unknown, ...args: Parameters<T>) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

import type React from 'react';

/**
 * Get client coordinates from mouse or touch event
 */
export function getClientCoords(
  e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent
): { clientX: number; clientY: number } {
  if ('touches' in e && e.touches.length > 0) {
    return {
      clientX: e.touches[0].clientX,
      clientY: e.touches[0].clientY,
    };
  }
  if ('clientX' in e) {
    return {
      clientX: e.clientX,
      clientY: e.clientY,
    };
  }
  return { clientX: 0, clientY: 0 };
}
