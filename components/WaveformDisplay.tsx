import React, { useRef, useEffect, useState, useCallback } from 'react';
import { FolderOpen } from 'lucide-react';
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
  onFileDrop?: (file: File) => void;
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
    alive: boolean; // for pooling: whether particle is in use
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
    onXyPadChange,
    onFileDrop,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Offscreen canvas to cache the waveform drawing
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  // Particles for visualization
  const particlesRef = useRef<Particle[]>([]);

  // Particle pool for zero-allocation (200 pre-allocated particles)
  const particlePoolRef = useRef<Particle[]>([]);
  const freeParticlesRef = useRef<number[]>([]); // indices of free particles
  const activeParticlesRef = useRef<Set<number>>(new Set()); // indices of active particles
  const MAX_PARTICLES = 200;

  // Animation frame ref
  const rafRef = useRef<number | null>(null);

  // XY Pad state
  const [xyPadPosition, setXyPadPosition] = useState<{ x: number; y: number } | null>(null);
  const [isXyPadDragging, setIsXyPadDragging] = useState(false);

  // Initialize particle pool on mount (zero-allocation for particles)
  useEffect(() => {
    // Pre-allocate all particles
    const pool: Particle[] = [];
    const freeIndices: number[] = [];

    for (let i = 0; i < MAX_PARTICLES; i++) {
      pool.push({
        x: 0,
        width: 0,
        life: 0,
        decay: 0,
        color: '',
        trail: [],
        pan: 0,
        duration: 0,
        alive: false
      });
      freeIndices.push(i);
    }

    particlePoolRef.current = pool;
    freeParticlesRef.current = freeIndices;
    activeParticlesRef.current.clear();
  }, []); // Run once on mount

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
    const gridDivisions = 10;
    for (let i = 0; i <= gridDivisions; i++) {
        const x = (width / gridDivisions) * i;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
    }
    ctx.stroke();

    // Waveform with gradient fill
    const step = Math.max(1, Math.ceil(data.length / width));
    const amp = height / 2;
    const midY = height / 2;

    // Create gradient (white fill)
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)');  // White
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.6)'); // White

    // Draw filled waveform (top half - positive)
    ctx.beginPath();
    ctx.moveTo(0, midY);

    for (let i = 0; i < width; i++) {
        const sampleIndex = Math.floor((i / width) * data.length);

        let max = -1.0;
        for (let j = 0; j < step; j++) {
            const idx = sampleIndex + j;
            if (idx >= 0 && idx < data.length) {
                const datum = data[idx];
                if (datum > max) max = datum;
            }
        }

        ctx.lineTo(i, (1 + max) * amp);
    }

    ctx.lineTo(width, midY);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw filled waveform (bottom half - negative)
    ctx.beginPath();
    ctx.moveTo(0, midY);

    for (let i = 0; i < width; i++) {
        const sampleIndex = Math.floor((i / width) * data.length);

        let min = 1.0;
        for (let j = 0; j < step; j++) {
            const idx = sampleIndex + j;
            if (idx >= 0 && idx < data.length) {
                const datum = data[idx];
                if (datum < min) min = datum;
            }
        }

        ctx.lineTo(i, (1 + min) * amp);
    }

    ctx.lineTo(width, midY);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw main waveform line on top
    ctx.beginPath();
    ctx.strokeStyle = colors.waveLine;
    ctx.lineWidth = 1;

    for (let i = 0; i < width; i++) {
        const sampleIndex = Math.floor((i / width) * data.length);

        let min = 1.0;
        let max = -1.0;

        for (let j = 0; j < step; j++) {
            const idx = sampleIndex + j;
            if (idx >= 0 && idx < data.length) {
                const datum = data[idx];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
        }

        ctx.moveTo(i, (1 + min) * amp);
        ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();

  }, [data, colors]); // Redraw when data or colors change

  // Helper: Acquire particle from pool (returns null if pool exhausted)
  const acquireParticle = useCallback((data: {
    x: number; width: number; life: number; decay: number; color: string; trail: number[]; pan: number; duration: number;
  }): Particle | null => {
    const freeIdx = freeParticlesRef.current.pop();
    if (freeIdx === undefined) return null; // Pool exhausted

    const p = particlePoolRef.current[freeIdx];
    p.x = data.x;
    p.width = data.width;
    p.life = data.life;
    p.decay = data.decay;
    p.color = data.color;
    p.trail = data.trail;
    p.pan = data.pan;
    p.duration = data.duration;
    p.alive = true;

    activeParticlesRef.current.add(freeIdx);
    return p;
  }, []);

  // Helper: Release particle back to pool
  const releaseParticle = useCallback((index: number) => {
    activeParticlesRef.current.delete(index);
    freeParticlesRef.current.push(index);
    particlePoolRef.current[index].alive = false;
  }, []);

  // 2. Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = () => {
        const width = canvas.width;
        const height = canvas.height;

        // Clear and draw background
        ctx.fillStyle = colors.waveBg;
        ctx.fillRect(0, 0, width, height);

        // Draw Base Waveform (from cache with gradient fill)
        if (offscreenRef.current && data) {
            ctx.drawImage(offscreenRef.current, 0, 0);

            // Draw gradient fill overlay
            const amp = height / 2;
            const midY = height / 2;
            const step = Math.max(1, Math.ceil(data.length / width));

            // Create gradient (orange to white)
            const gradient = ctx.createLinearGradient(0, 0, width, 0);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)');  // White
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0.5)'); // White

            // Draw top half
            ctx.beginPath();
            ctx.moveTo(0, midY);
            for (let i = 0; i < width; i++) {
                const sampleIndex = Math.floor((i / width) * data.length);
                let max = -1.0;
                for (let j = 0; j < step; j++) {
                    const idx = sampleIndex + j;
                    if (idx >= 0 && idx < data.length && data[idx] > max) max = data[idx];
                }
                ctx.lineTo(i, (1 + max) * amp);
            }
            ctx.lineTo(width, midY);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();

            // Draw bottom half
            ctx.beginPath();
            ctx.moveTo(0, midY);
            for (let i = 0; i < width; i++) {
                const sampleIndex = Math.floor((i / width) * data.length);
                let min = 1.0;
                for (let j = 0; j < step; j++) {
                    const idx = sampleIndex + j;
                    if (idx >= 0 && idx < data.length && data[idx] < min) min = data[idx];
                }
                ctx.lineTo(i, (1 + min) * amp);
            }
            ctx.lineTo(width, midY);
            ctx.closePath();
            ctx.fill();

            // CRT Scanlines effect
            ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
            for (let y = 0; y < height; y += 3) {
                ctx.fillRect(0, y, width, 1);
            }
        } else {
            ctx.font = '12px monospace';
            ctx.fillStyle = colors.waveText;
            ctx.textAlign = 'center';
            ctx.fillText("NO SAMPLE LOADED", width/2, height/2);
        }

        // Poll and Spawn Particles
        if (audioEngine) {
            const events = audioEngine.pollGrainEvents();
            const bufferDur = audioEngine.getBufferDuration();

            for (const e of events) {
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

                // Acquire from particle pool (returns null if exhausted)
                const p = acquireParticle({
                    x: e.normPos,
                    width: normWidth,
                    life: 1.0,
                    decay: decay,
                    color: color,
                    trail: [e.normPos],
                    pan: e.pan,
                    duration: e.duration
                });

                if (!p) {
                    // Pool exhausted, skip this grain (rare with 200 particles)
                    continue;
                }
            }
        }

        // 3. Update and Draw Particles
        ctx.globalCompositeOperation = 'lighter';

        // Track dead particle indices to release after loop
        const deadIndices: number[] = [];

        // Iterate through active particles
        for (const idx of activeParticlesRef.current) {
            const p = particlePoolRef.current[idx];
            if (!p.alive) continue; // Safety check

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
                deadIndices.push(idx);
            }
        }

        // Release dead particles back to pool
        for (const idx of deadIndices) {
            releaseParticle(idx);
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

  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      if (xyPadMode && onXyPadChange) {
        setIsXyPadDragging(true);
        handleTouchXyPadMove(e);
      } else {
        handleTouchSeek(e);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      if (isXyPadDragging && xyPadMode && onXyPadChange) {
        handleTouchXyPadMove(e);
      } else if (!xyPadMode) {
        handleTouchSeek(e);
      }
    }
  };

  const handleTouchEnd = () => {
    setIsXyPadDragging(false);
  };

  const handleTouchSeek = (e: React.TouchEvent) => {
    if (!containerRef.current || e.touches.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const normalized = Math.max(0, Math.min(1, x / rect.width));
    onSeek(normalized);
  };

  const handleTouchXyPadMove = (e: React.TouchEvent) => {
    if (!containerRef.current || !onXyPadChange || e.touches.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (e.touches[0].clientY - rect.top) / rect.height)); // Invert Y so up is higher
    setXyPadPosition({ x, y });
    onXyPadChange(x, y);
  };

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

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (onFileDrop) {
          setIsDragging(true);
      }
  };

  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (!onFileDrop) return;

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
          const file = files[0];
          if (file.type.startsWith('audio/')) {
              onFileDrop(file);
          }
      }
  };

  return (
    <div
        ref={containerRef}
        className="relative w-full h-32 border-2 rounded-md overflow-hidden shadow-inner transition-colors duration-200 cursor-crosshair"
        style={{
            backgroundColor: colors.waveBg,
            borderColor: isDragging ? '#22c55e' : (xyPadMode ? '#22d3ee' : colors.moduleBorder),
            borderWidth: isDragging ? '3px' : '2px',
            touchAction: 'none'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
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

      {/* Drag overlay */}
      {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
              <div className="text-center">
                  <FolderOpen size={32} className="mx-auto mb-2 text-green-400" />
                  <div className="text-green-400 font-bold text-sm">Drop Audio File Here</div>
              </div>
          </div>
      )}

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
