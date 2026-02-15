import React, { useRef, useCallback, memo, useEffect } from 'react';
import { ThemeColors } from '../types';

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
  unit?: string;
  step?: number;
  integer?: boolean;
  modulatedValue?: number;
  isMapping?: boolean;
  isTargeted?: boolean;
  onToggleTarget?: () => void;
  colors: ThemeColors;
  disabled?: boolean;
  defaultValue?: number;
}

// Global ref to track which knob is currently being dragged
const activeKnobRef = React.createRef<HTMLElement | null>(null);

const KnobComponent: React.FC<KnobProps> = ({
  label,
  value,
  min,
  max,
  onChange,
  unit = '',
  step = 0.01,
  integer = false,
  modulatedValue,
  isMapping = false,
  isTargeted = false,
  onToggleTarget,
  colors,
  disabled = false,
  defaultValue
}) => {
  const elementRef = useRef<HTMLElement | null>(null);
  const startYRef = useRef<number>(0);
  const startValRef = useRef<number>(0);

  const updateKnobValue = useCallback((clientY: number) => {
    const deltaY = startYRef.current - clientY;
    const range = max - min;
    const sensitivity = range / 200;
    let newValue = startValRef.current + deltaY * sensitivity;
    newValue = Math.max(min, Math.min(max, newValue));

    if (integer) {
      newValue = Math.round(newValue);
    } else if (step) {
      newValue = Math.round(newValue / step) * step;
    }

    onChange(newValue);
  }, [min, max, integer, step, onChange]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled || isMapping) return;

    if (isMapping) {
      e.preventDefault();
      onToggleTarget?.();
      return;
    }

    // Clear any active knob
    const prevActive = activeKnobRef.current;
    if (prevActive && prevActive !== elementRef.current) {
      prevActive.style.cursor = 'default';
    }

    startYRef.current = e.clientY;
    startValRef.current = value;
    activeKnobRef.current = elementRef.current;
    document.body.style.cursor = 'ns-resize';
  }, [disabled, isMapping, onToggleTarget, value, onChange]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled || isMapping) return;

    if (isMapping) {
      e.preventDefault();
      onToggleTarget?.();
      return;
    }

    const prevActive = activeKnobRef.current;
    if (prevActive && prevActive !== elementRef.current) {
      prevActive.style.cursor = 'default';
    }

    const touch = e.touches[0];
    if (!touch) return;

    startYRef.current = touch.clientY;
    startValRef.current = value;
    activeKnobRef.current = elementRef.current;
  }, [disabled, isMapping, onToggleTarget, value]);

  const handleDoubleClick = useCallback(() => {
    if (disabled) return;
    if (defaultValue !== undefined) {
      onChange(defaultValue);
    }
  }, [disabled, defaultValue, onChange]);

  // Global mouse move handler
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const activeKnob = activeKnobRef.current;
    if (!activeKnob) return;
    if (activeKnob !== elementRef.current) return;

    updateKnobValue(e.clientY);
  }, [updateKnobValue]);

  // Global touch move handler
  const handleTouchMove = useCallback((e: TouchEvent) => {
    const activeKnob = activeKnobRef.current;
    if (!activeKnob) return;
    if (activeKnob !== elementRef.current) return;

    const touch = e.touches[0];
    if (!touch) return;

    updateKnobValue(touch.clientY);
  }, [updateKnobValue]);

  // Global mouse/touch up handler
  const handleMouseUp = useCallback(() => {
    const activeKnob = activeKnobRef.current;
    if (!activeKnob) return;

    activeKnobRef.current = null;
    document.body.style.cursor = 'default';
  }, []);

  // Add global listeners only once on mount
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleMouseUp);
    window.addEventListener('touchcancel', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
      window.removeEventListener('touchcancel', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp, handleTouchMove]);

  // Calculate rotation
  const percent = (value - min) / (max - min);
  const degrees = -135 + percent * 270;

  // Calculate rotation for modulated value
  let modDegrees = null;
  if (modulatedValue !== undefined) {
    const modPercent = (modulatedValue - min) / (max - min);
    const clampedPercent = Math.max(0, Math.min(1, modPercent));
    modDegrees = -135 + clampedPercent * 270;
  }

  const displayValue = integer ? Math.round(value) : value.toFixed(2);

  // Styles
  const labelColor = isMapping && isTargeted ? 'text-green-400' : colors.knobLabel;
  const ringColor = isMapping && isTargeted ? '#4ade80' : colors.knobRing;
  const mappingCursor = isMapping ? 'cursor-pointer' : 'cursor-ns-resize';
  const mappingOpacity = isMapping && !isTargeted ? 'opacity-50 hover:opacity-100 transition-opacity' : '';
  const disabledOpacity = disabled ? 'opacity-40 cursor-not-allowed' : '';

  return (
    <div className={`flex flex-col items-center gap-1 w-16 ${mappingOpacity} ${disabledOpacity}`} style={{ userSelect: 'none' }}>
      <div
        ref={elementRef}
        className={`relative w-14 h-14 md:w-12 md:h-12 ${disabled ? 'cursor-not-allowed' : mappingCursor} group`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onDoubleClick={handleDoubleClick}
        style={{ userSelect: 'none', touchAction: 'none', minWidth: 40, minHeight: 40 }}
      >
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-sm">
          {/* Background Track */}
          <circle cx="50" cy="50" r="40" stroke={ringColor} strokeWidth="8" fill={colors.knobBase} className="transition-colors duration-200" />

          {/* Value Arc */}
          <path
            d="M 21.7 78.3 A 40 40 0 1 1 78.3 78.3"
            stroke={activeKnobRef.current === elementRef.current ? '#fb923c' : (colors.knobRing === '#e5e5e5' ? '#d4d4d8' : '#111')}
            strokeOpacity={activeKnobRef.current === elementRef.current ? 0.3 : 1}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />

          {/* Ghost / Modulated Needle */}
          {modDegrees !== null && (
            <g transform={`rotate(${modDegrees} 50 50)`}>
              <line x1="50" y1="50" x2="50" y2="15" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
            </g>
          )}

          {/* Main Indicator */}
          {(!isMapping || isTargeted || activeKnobRef.current === elementRef.current) && (
            <g transform={`rotate(${degrees} 50 50)`}>
              <line x1="50" y1="50" x2="50" y2="15" stroke={isMapping && isTargeted ? '#4ade80' : '#fb923c'} strokeWidth="3" strokeLinecap="round" />
            </g>
          )}

          {/* Mapping Plus Icon */}
          {isMapping && !isTargeted && (
            <g className="text-neutral-500">
              <line x1="50" y1="30" x2="50" y2="70" stroke="currentColor" strokeWidth="4" />
              <line x1="30" y1="50" x2="70" y2="50" stroke="currentColor" strokeWidth="4" />
            </g>
          )}
        </svg>
      </div>

      <div className="text-center w-full" style={{ userSelect: 'none' }}>
        <div className={`text-[10px] uppercase font-bold tracking-wider mb-[2px] ${labelColor} transition-colors duration-200`}>{label}</div>
        <div
          className="text-xs font-mono px-1 py-[1px] border border-transparent rounded-sm w-full text-center transition-colors duration-200"
          style={{ backgroundColor: colors.knobValueBg, color: colors.knobValueText ? undefined : '#fb923c', userSelect: 'none' }}
        >
          <span className={colors.knobValueText}>{displayValue}</span>
          {unit && <span className={`text-[10px] ml-[1px] opacity-90 ${colors.knobValueText}`}>{unit}</span>}
        </div>
      </div>
    </div>
  );
};

const arePropsEqual = (prevProps: KnobProps, nextProps: KnobProps) => {
  return (
    prevProps.value === nextProps.value &&
    prevProps.modulatedValue === nextProps.modulatedValue &&
    prevProps.isMapping === nextProps.isMapping &&
    prevProps.isTargeted === nextProps.isTargeted &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.colors === nextProps.colors
  );
};

export const Knob = memo(KnobComponent, arePropsEqual);
