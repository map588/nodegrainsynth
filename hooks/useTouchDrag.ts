import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DoubleTapDetector, getClientCoords } from '../utils/touch';

interface UseTouchDragOptions {
  /** Initial value */
  value: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Step increment for value changes */
  step?: number;
  /** Whether to round to integers */
  integer?: boolean;
  /** Whether dragging is disabled */
  disabled?: boolean;
  /** Sensitivity multiplier (pixels per value change) */
  sensitivity?: number;
  /** Callback when drag starts */
  onDragStart?: () => void;
  /** Callback when value changes during drag */
  onChange: (value: number) => void;
  /** Callback when drag ends */
  onDragEnd?: (finalValue: number) => void;
  /** Callback on double-tap */
  onDoubleTap?: () => void;
  /** Callback to reset to default */
  onReset?: () => void;
  /** Default value for reset */
  defaultValue?: number;
}

interface DragHandlers {
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
}

/**
 * Hook for unified mouse and touch drag handling
 * Works with vertical drag to adjust numeric values
 */
export function useTouchDrag(options: UseTouchDragOptions): {
  isDragging: boolean;
  handlers: DragHandlers;
} {
  const {
    value,
    min,
    max,
    step = 0.01,
    integer = false,
    disabled = false,
    sensitivity = 200, // pixels for full range
    onDragStart,
    onChange,
    onDragEnd,
    onDoubleTap,
    onReset,
    defaultValue,
  } = options;

  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number>(0);
  const startValueRef = useRef<number>(value);
  const doubleTapDetectorRef = useRef(new DoubleTapDetector(300));

  // Calculate new value based on drag delta
  const calculateValue = useCallback(
    (deltaY: number): number => {
      const range = max - min;
      const pixelSensitivity = sensitivity / range;
      let newValue = startValueRef.current + deltaY * pixelSensitivity;

      // Clamp to bounds
      newValue = Math.max(min, Math.min(max, newValue));

      // Apply step or integer rounding
      if (integer) {
        newValue = Math.round(newValue);
      } else if (step) {
        newValue = Math.round(newValue / step) * step;
      }

      // Handle floating point precision
      return parseFloat(newValue.toFixed(integer ? 0 : 3));
    },
    [min, max, step, integer, sensitivity]
  );

  // Handle drag start (mouse)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;

      // Check for double-click
      if (doubleTapDetectorRef.current.checkTap()) {
        if (onDoubleTap) {
          onDoubleTap();
          return;
        }
        if (onReset && defaultValue !== undefined) {
          onReset();
          return;
        }
      }

      e.preventDefault();
      setIsDragging(true);
      startYRef.current = e.clientY;
      startValueRef.current = value;
      document.body.style.cursor = 'ns-resize';
      onDragStart?.();
    },
    [disabled, value, onDragStart, onDoubleTap, onReset, defaultValue]
  );

  // Handle drag start (touch)
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;

      // Check for double-tap
      if (doubleTapDetectorRef.current.checkTap()) {
        if (onDoubleTap) {
          onDoubleTap();
          return;
        }
        if (onReset && defaultValue !== undefined) {
          onReset();
          return;
        }
      }

      const touch = e.touches[0];
      if (!touch) return;

      setIsDragging(true);
      startYRef.current = touch.clientY;
      startValueRef.current = value;
      onDragStart?.();
    },
    [disabled, value, onDragStart, onDoubleTap, onReset, defaultValue]
  );

  // Global move handler (works outside component bounds)
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const coords = getClientCoords(e);
      const deltaY = startYRef.current - coords.clientY;
      const newValue = calculateValue(deltaY);
      onChange(newValue);
    };

    const handleEnd = () => {
      setIsDragging(false);
      document.body.style.cursor = 'default';
      onDragEnd?.(value);
    };

    // Add global event listeners
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: true });
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('touchcancel', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
    };
  }, [isDragging, calculateValue, onChange, onDragEnd, value]);

  return {
    isDragging,
    handlers: {
      onMouseDown: handleMouseDown,
      onTouchStart: handleTouchStart,
    },
  };
}
