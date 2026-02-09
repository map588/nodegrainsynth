import React, { useState, useEffect, useRef } from 'react';
import { ThemeColors } from '../types';

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
  onDragStart?: () => void;
  onDragEnd?: (finalValue: number) => void;
  unit?: string;
  step?: number;
  integer?: boolean;
  modulatedValue?: number;
  isMapping?: boolean;
  isTargeted?: boolean;
  onToggleTarget?: () => void;
  colors: ThemeColors;
  disabled?: boolean;
}

export const Knob: React.FC<KnobProps> = ({
  label,
  value,
  min,
  max,
  onChange,
  onDragStart,
  onDragEnd,
  unit = '',
  step = 0.01,
  integer = false,
  modulatedValue,
  isMapping = false,
  isTargeted = false,
  onToggleTarget,
  colors,
  disabled = false
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [internalValue, setInternalValue] = useState(value);
  const startY = useRef<number>(0);
  const startVal = useRef<number>(0);

  // Sync internal value if props change externally
  useEffect(() => {
    setInternalValue(value);
  }, [value]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled) return;
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

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = 'default';
      onDragEnd?.(internalValue);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
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
        className={`relative w-12 h-12 ${disabled ? 'cursor-not-allowed' : mappingCursor} group`}
        onMouseDown={handleMouseDown}
        style={{ userSelect: 'none' }}
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
          {unit && <span className="text-[9px] ml-[1px] opacity-60">{unit}</span>}
        </div>
      </div>
    </div>
  );
};