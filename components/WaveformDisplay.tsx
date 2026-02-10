import React, { useRef, useEffect, useState } from 'react';
import { GranularParams, ThemeColors } from '../types';
import { AudioEngine } from '../services/audioEngine';

interface WaveformDisplayProps {
  data: Float32Array | null;
  params: GranularParams;
  onSeek: (normPos: number) => void;
  audioEngine: AudioEngine | null;
  colors: ThemeColors;
  isFrozen?: boolean;
  isDrifting?: boolean;
  xyPadMode?: boolean;
  onXyPadChange?: (x: number, y: number) => void;
}

interface Particle {
    x: number; // normalized 0-1
    width: number; // normalized 0-1 relative to canvas width
    life: number; // 0-1
    decay: number; // per frame
    color: string;
    trail: number[]; // previous positions for trail effect
    pan: number; // pan position -1 to 1
    duration: number; // grain duration in seconds
}

export const WaveformDisplay: React.FC<WaveformDisplayProps> = ({
    data,
    params,
    onSeek,
    audioEngine,
    colors,
    isFrozen = false,
    isDrifting = false,
    xyPadMode = false,
    onXyPadChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Offscreen canvas to cache the waveform drawing
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  // Particles for visualization
  const particlesRef = useRef<Particle[]>([]);

  // Animation frame ref
  const rafRef = useRef<number | null>(null);

  // XY Pad state
  const [xyPadPosition, setXyPadPosition] = useState<{ x: number; y: number } | null>(null);
  const [isXyPadDragging, setIsXyPadDragging] = useState(false);

  // 1. Prepare offscreen waveform when data changes
  useEffect(() => {
    if (!data) return;

    // Create offscreen canvas if needed
    if (!offscreenRef.current) {
        offscreenRef.current = document.createElement('canvas');
        offscreenRef.current.width = 800; // Match render resolution
        offscreenRef.current.height = 128;
    }

    const ctx = offscreenRef.current.getContext('2d');
    if (!ctx) return;

    const width = offscreenRef.current.width;
    const height = offscreenRef.current.height;

    // Clear
    ctx.fillStyle = colors.waveBg;
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = colors.waveGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let i=1; i<10; i++) {
        const x = (width/10) * i;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
    }
    ctx.stroke();

    // Waveform
    ctx.beginPath();
    ctx.strokeStyle = colors.waveLine;
    ctx.lineWidth = 1;

    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.moveTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();

  }, [data, colors]); // Redraw when data OR colors change


  // 2. Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = () => {
        const width = canvas.width;
        const height = canvas.height;

        // 1. Draw Base Waveform (from cache or empty)
        if (offscreenRef.current && data) {
            ctx.drawImage(offscreenRef.current, 0, 0);
        } else {
            ctx.fillStyle = colors.waveBg;
            ctx.fillRect(0, 0, width, height);
            ctx.font = '12px monospace';
            ctx.fillStyle = colors.waveText;
            ctx.textAlign = 'center';
            ctx.fillText("NO SAMPLE LOADED", width/2, height/2);
        }

        // 2. Poll and Spawn Particles
        if (audioEngine) {
            const events = audioEngine.pollGrainEvents();
            const bufferDur = audioEngine.getBufferDuration();

            events.forEach(e => {
                const normWidth = bufferDur > 0 ? (e.duration / bufferDur) : 0.01;
                const decay = 1 / (Math.max(0.1, e.duration) * 60);

                // Color based on pan position: left=blue, center=purple, right=red
                let color = `rgba(168, 85, 247,`; // purple (center)
                if (e.pan < -0.2) {
                    color = `rgba(59, 130, 246,`; // blue (left)
                } else if (e.pan > 0.2) {
                    color = `rgba(239, 68, 68,`; // red (right)
                }

                // Initialize trail with starting position
                const trailLength = Math.floor(Math.max(3, e.duration * 30)); // More trail for longer grains

                particlesRef.current.push({
                    x: e.normPos,
                    width: normWidth,
                    life: 1.0,
                    decay: decay,
                    color: color,
                    trail: [e.normPos],
                    pan: e.pan,
                    duration: e.duration
                });
            });
        }

        // 3. Update and Draw Particles
        ctx.globalCompositeOperation = 'lighter';

        for (let i = particlesRef.current.length - 1; i >= 0; i--) {
            const p = particlesRef.current[i];

            // Calculate size based on grain duration (larger grains = bigger particles)
            const baseSize = Math.max(6, Math.min(35, p.duration * 60));
            const sizeMultiplier = 2.5 + (p.duration * 1.2); // 2.5 to 3.7x based on duration - longer grains
            const pw = Math.max(10, p.width * width * sizeMultiplier);
            const px = p.x * width;

            // Add glow effect for high-life particles
            if (p.life > 0.3) {
                ctx.shadowColor = p.color.replace('rgba', 'rgb').replace(',', '').replace(',', '').replace(',', '') + ',';
                ctx.shadowColor = p.color + ' 1)';
                ctx.shadowBlur = 25 * p.life;
            }

            // Draw trail (fading previous positions)
            if (p.trail.length > 1) {
                for (let j = 0; j < p.trail.length; j++) {
                    const trailAlpha = (j / p.trail.length) * 0.3 * p.life;
                    const trailX = p.trail[j] * width;
                    const trailWidth = pw * (j / p.trail.length); // Tapering trail

                    ctx.fillStyle = `${p.color} ${trailAlpha})`;
                    ctx.fillRect(trailX - trailWidth / 2, height / 2 - baseSize / 2, trailWidth, baseSize);
                }
            }

            // Draw main particle with glow
            const alpha = p.life * 0.7;
            ctx.fillStyle = `${p.color} ${alpha})`;

            // Draw as a rounded rectangle for softer appearance
            const radius = baseSize / 2;
            const py = height / 2 - radius;

            ctx.beginPath();
            ctx.roundRect(px - pw / 2, py, pw, baseSize, radius);
            ctx.fill();

            // Reset shadow
            ctx.shadowBlur = 0;

            // Update: add current position to trail
            if (p.trail.length < 15) {
                p.trail.push(p.x);
            } else {
                p.trail.shift();
                p.trail.push(p.x);
            }

            // Decay life
            p.life -= p.decay;
            if (p.life <= 0) {
                particlesRef.current.splice(i, 1);
            }
        }

        ctx.globalCompositeOperation = 'source-over';

        // 4. Draw Playhead / Spray Target
        const x = params.position * width;
        // Match visual spray zone to actual grain spread range (increased sensitivity)
        const sprayW = params.spread * (width / 2) * 1.0; // Matches audio grain spread

        // Spray Zone (Color inversion for visibility on light theme?)
        // Using white with low opacity works on dark, but on white bg it's invisible.
        // Use black on light theme?
        const isDark = colors.waveBg === '#0f0f0f';
        ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
        ctx.fillRect(x - sprayW, 0, sprayW * 2, height);

        // Main Line - Priority: Frozen (Cyan) > Drifting (Green) > Normal (Orange)
        const playheadColor = isFrozen ? '#22d3ee' : (isDrifting ? '#4ade80' : '#fb923c');
        const playhalLineWidth = isFrozen || isDrifting ? 2 : 1;

        ctx.beginPath();
        ctx.strokeStyle = playheadColor;
        ctx.lineWidth = playhalLineWidth;
        if (isFrozen || isDrifting) {
            // Add a glow effect when frozen or drifting
            ctx.shadowColor = playheadColor;
            ctx.shadowBlur = 10;
        }
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadow

        // Mode indicator text
        if (isFrozen) {
            ctx.font = 'bold 10px monospace';
            ctx.fillStyle = '#22d3ee';
            ctx.textAlign = 'left';
            ctx.fillText('FROZEN', x + 5, 12);
        } else if (isDrifting) {
            ctx.font = 'bold 10px monospace';
            ctx.fillStyle = '#4ade80';
            ctx.textAlign = 'left';
            ctx.fillText('DRIFTING', x + 5, 12);
        }

        // Loop
        rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [data, params, audioEngine, colors, isFrozen, isDrifting, xyPadMode, onXyPadChange]);

  const handleMouseDown = (e: React.MouseEvent) => {
      if (xyPadMode && onXyPadChange) {
          setIsXyPadDragging(true);
          handleXyPadMove(e);
      } else {
          handleSeek(e);
      }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
      if (isXyPadDragging && xyPadMode && onXyPadChange) {
          handleXyPadMove(e);
      } else if (e.buttons === 1 && !xyPadMode) {
          handleSeek(e);
      }
  }

  const handleMouseUp = () => {
      setIsXyPadDragging(false);
  }

  const handleSeek = (e: React.MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const normalized = Math.max(0, Math.min(1, x / rect.width));
      onSeek(normalized);
  }

  const handleXyPadMove = (e: React.MouseEvent) => {
      if (!containerRef.current || !onXyPadChange) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)); // Invert Y so up is higher
      setXyPadPosition({ x, y });
      onXyPadChange(x, y);
  }

  return (
    <div
        ref={containerRef}
        className={`relative w-full h-32 border-2 rounded-md overflow-hidden shadow-inner transition-colors duration-200 ${xyPadMode ? 'cursor-crosshair' : 'cursor-crosshair'}`}
        style={{ backgroundColor: colors.waveBg, borderColor: xyPadMode ? '#22d3ee' : colors.moduleBorder }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
    >
      <canvas
        ref={canvasRef}
        width={800}
        height={128}
        className="w-full h-full block"
      />
      <div className="absolute top-1 left-2 text-[10px] font-mono pointer-events-none" style={{ color: colors.waveText }}>
        00:00.000
      </div>

      {/* XY Pad Overlay */}
      {xyPadMode && (
          <>
              {/* Grid lines */}
              <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundImage: `
                      linear-gradient(to right, rgba(34, 211, 238, 0.1) 1px, transparent 1px),
                      linear-gradient(to bottom, rgba(34, 211, 238, 0.1) 1px, transparent 1px)
                  `,
                  backgroundSize: '10% 10%'
              }}></div>

              {/* Axis labels */}
              <div className="absolute bottom-1 left-2 text-[9px] font-mono pointer-events-none text-cyan-400">
                  POSITION →
              </div>
              <div className="absolute top-2 right-2 text-[9px] font-mono pointer-events-none text-cyan-400 transform -rotate-90 origin-center">
                  PITCH →
              </div>

              {/* XY Position indicator */}
              {xyPadPosition && (
                  <div
                      className="absolute w-4 h-4 rounded-full border-2 pointer-events-none transform -translate-x-1/2 -translate-y-1/2 shadow-lg"
                      style={{
                          left: `${xyPadPosition.x * 100}%`,
                          top: `${(1 - xyPadPosition.y) * 100}%`,
                          backgroundColor: '#22d3ee',
                          borderColor: '#fff',
                          boxShadow: '0 0 10px rgba(34, 211, 238, 0.8)'
                      }}
                  />
              )}

              {/* Mode indicator */}
              <div className="absolute top-1 left-1/2 transform -translate-x-1/2 text-[10px] font-bold px-2 py-0.5 rounded pointer-events-none"
                   style={{ backgroundColor: 'rgba(34, 211, 238, 0.9)', color: '#000' }}>
                  XY PAD MODE
              </div>
          </>
      )}
    </div>
  );
};
