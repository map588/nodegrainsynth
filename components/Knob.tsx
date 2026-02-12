import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { ThemeColors } from '../types';
import { DoubleTapDetector, MIN_TOUCH_TARGET } from '../utils/touch';

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
  onDragStart?: () => void;
  onDragEnd?: (finalValue: number) => void;
  onReset?: () => void;
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

const KnobComponent: React.FC<KnobProps> = ({
  label,
  value,
  min,
  max,
  onChange,
  onDragStart,
  onDragEnd,
  onReset,
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
  const [isDragging, setIsDragging] = useState(false);
  const [internalValue, setInternalValue] = useState(value);
  const startY = useRef<number>(0);
  const startVal = useRef<number>(0);
  const doubleTapRef = useRef(new DoubleTapDetector(300));

  // Sync internal value if props change externally
  useEffect(() => {
    setInternalValue(value);
  }, [value]);

  // Handle double-tap/double-click reset
  const handleReset = useCallback(() => {
    if (disabled) return;
    if (onReset) {
      onReset();
      return;
    }
    if (defaultValue !== undefined) {
      setInternalValue(defaultValue);
      onChange(defaultValue);
      onDragEnd?.(defaultValue);
    }
  }, [disabled, onReset, defaultValue, onChange, onDragEnd]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled) return;

    // Check for double-click
    if (doubleTapRef.current.checkTap()) {
      handleReset();
      return;
    }

    if (isMapping) {
        e.preventDefault();
        onToggleTarget?.();
        return;
    }

    setIsDragging(true);
    startY.current = e.clientY;
    startVal.current = internalValue;
    document.body.style.cursor = 'ns-resize';
    onDragStart?.();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled) return;

    // Check for double-tap
    if (doubleTapRef.current.checkTap()) {
      handleReset();
      return;
    }

    if (isMapping) {
      e.preventDefault();
      onToggleTarget?.();
      return;
    }

    const touch = e.touches[0];
    if (!touch) return;

    setIsDragging(true);
    startY.current = touch.clientY;
    startVal.current = internalValue;
    onDragStart?.();
  };

  const handleDoubleClick = () => {
    handleReset();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaY = startY.current - e.clientY;
      // Sensitivity: 100px = full range roughly
      const range = max - min;
      const sensitivity = range / 200;

      let newValue = startVal.current + deltaY * sensitivity;
      newValue = Math.max(min, Math.min(max, newValue));

      if (integer) {
        newValue = Math.round(newValue);
      } else if (step) {
          newValue = Math.round(newValue / step) * step;
      }

      setInternalValue(newValue);
      onChange(newValue);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging) return;

      const touch = e.touches[0];
      if (!touch) return;

      const deltaY = startY.current - touch.clientY;
      const range = max - min;
      const sensitivity = range / 200;

      let newValue = startVal.current + deltaY * sensitivity;
      newValue = Math.max(min, Math.min(max, newValue));

      if (integer) {
        newValue = Math.round(newValue);
      } else if (step) {
          newValue = Math.round(newValue / step) * step;
      }

      setInternalValue(newValue);
      onChange(newValue);
    };

    const handleEnd = () => {
      setIsDragging(false);
      document.body.style.cursor = 'default';
      onDragEnd?.(internalValue);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleEnd);
      window.addEventListener('touchmove', handleTouchMove, { passive: true });
      window.addEventListener('touchend', handleEnd);
      window.addEventListener('touchcancel', handleEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
    };
  }, [isDragging, max, min, onChange, step, integer, internalValue, onDragEnd]);

  // Calculate rotation
  // -135deg to +135deg (270 degree sweep)
  const percent = (internalValue - min) / (max - min);
  const degrees = -135 + percent * 270;

  // Calculate rotation for modulated value (Ghost needle)
  let modDegrees = null;
  if (modulatedValue !== undefined) {
      const modPercent = (modulatedValue - min) / (max - min);
      const clampedPercent = Math.max(0, Math.min(1, modPercent));
      modDegrees = -135 + clampedPercent * 270;
  }

  // Formatted display value
  const displayValue = integer ? Math.round(internalValue) : internalValue.toFixed(2);

  // Styles for mapping mode
  const labelColor = isMapping && isTargeted ? 'text-green-400' : colors.knobLabel;
  const ringColor = isMapping && isTargeted ? '#4ade80' : colors.knobRing;
  const mappingCursor = isMapping ? 'cursor-pointer' : 'cursor-ns-resize';
  const mappingOpacity = isMapping && !isTargeted ? 'opacity-50 hover:opacity-100 transition-opacity' : '';
  const disabledOpacity = disabled ? 'opacity-40 cursor-not-allowed' : '';

  return (
    <div className={`flex flex-col items-center gap-1 w-16 ${mappingOpacity} ${disabledOpacity}`} style={{ userSelect: 'none' }}>
      {/* Knob SVG */}
      <div
        className={`relative w-14 h-14 md:w-12 md:h-12 ${disabled ? 'cursor-not-allowed' : mappingCursor} group`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onDoubleClick={handleDoubleClick}
        style={{ userSelect: 'none', touchAction: 'none', minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
      >
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-sm">
            {/* Background Track */}
            <circle cx="50" cy="50" r="40" stroke={ringColor} strokeWidth="8" fill={colors.knobBase} className="transition-colors duration-200" />
            
            {/* Value Arc (Optional visualization) */}
            <path 
                d="M 21.7 78.3 A 40 40 0 1 1 78.3 78.3" // Rough approx of 270 deg
                stroke={isDragging ? '#fb923c' : (colors.knobRing === '#e5e5e5' ? '#d4d4d8' : '#111')} 
                strokeOpacity={isDragging ? 0.3 : 1}
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

            {/* Main Indicator / Needle */}
            {(!isMapping || isTargeted || isDragging) && (
              <g transform={`rotate(${degrees} 50 50)`}>
                  <line x1="50" y1="50" x2="50" y2="15" stroke={isMapping && isTargeted ? '#4ade80' : '#fb923c'} strokeWidth="3" strokeLinecap="round" />
              </g>
            )}
            
            {/* Mapping Plus Icon Overlay */}
            {isMapping && !isTargeted && (
                 <g className="text-neutral-500">
                    <line x1="50" y1="30" x2="50" y2="70" stroke="currentColor" strokeWidth="4" />
                    <line x1="30" y1="50" x2="70" y2="50" stroke="currentColor" strokeWidth="4" />
                 </g>
            )}
        </svg>
      </div>

      {/* Label & Value */}
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

// Custom memo comparison to only re-render when visual props change
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