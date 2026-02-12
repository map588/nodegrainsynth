export interface BuiltInSample {
  name: string;
  description: string;
  category: 'pad' | 'drone' | 'texture' | 'glitch' | 'rhythmic' | 'fx';
  generate: (ctx: AudioContext, duration: number) => Float32Array;
}

// Sample duration in seconds
const SAMPLE_DURATION = 3.0;
const SAMPLE_RATE = 44100;

// Helper to create buffer
function createBuffer(duration: number = SAMPLE_DURATION): Float32Array {
  return new Float32Array(Math.floor(SAMPLE_RATE * duration));
}

// Generate silence with tiny noise for realism
function generateSilenceWithNoise(duration: number = SAMPLE_DURATION): Float32Array {
  const buffer = createBuffer(duration);
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = (Math.random() - 0.5) * 0.001; // Tiny noise floor
  }
  return buffer;
}

export const BUILTIN_SAMPLES: BuiltInSample[] = [
  {
    name: 'Ethereal Pad',
    description: 'Lush ambient pad with layered sine waves',
    category: 'pad',
    generate: (ctx, duration) => {
      const buffer = createBuffer(duration);
      const sr = SAMPLE_RATE;

      // Layer 1: Deep sine
      for (let i = 0; i < buffer.length; i++) {
        const t = i / sr;
        buffer[i] += Math.sin(2 * Math.PI * 110 * t) * 0.3;
        buffer[i] += Math.sin(2 * Math.PI * 112 * t) * 0.2;
        buffer[i] += Math.sin(2 * Math.PI * 220 * t) * 0.15;
      }

      // Layer 2: Shimmering high frequencies
      for (let i = 0; i < buffer.length; i++) {
        const t = i / sr;
        const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t);
        buffer[i] += Math.sin(2 * Math.PI * 880 * t) * 0.1 * lfo;
        buffer[i] += Math.sin(2 * Math.PI * 1760 * t) * 0.05 * lfo;
      }

      return normalize(buffer);
    }
  },
  {
    name: 'Dark Drone',
    description: 'Low, rumbling drone with sub-bass content',
    category: 'drone',
    generate: (ctx, duration) => {
      const buffer = createBuffer(duration);
      const sr = SAMPLE_RATE;

      // Deep bass layer
      for (let i = 0; i < buffer.length; i++) {
        const t = i / sr;
        buffer[i] += Math.sin(2 * Math.PI * 55 * t) * 0.4;
        buffer[i] += Math.sin(2 * Math.PI * 110 * t) * 0.3;

        // Add modulation
        const mod = 1 + 0.3 * Math.sin(2 * Math.PI * 0.25 * t);
        buffer[i] *= mod;

        // Sub-bass
        buffer[i] += Math.sin(2 * Math.PI * 27.5 * t) * 0.5;
      }

      return normalize(buffer);
    }
  },
  {
    name: 'Granular Texture',
    description: 'Complex textural layers with random grains',
    category: 'texture',
    generate: (ctx, duration) => {
      const buffer = createBuffer(duration);
      const sr = SAMPLE_RATE;
      const grainSize = Math.floor(sr * 0.05); // 50ms grains

      for (let i = 0; i < buffer.length; i += grainSize) {
        // Random grain parameters
        const start = Math.random() * 2 - 1;
        const length = grainSize * (0.3 + Math.random() * 0.7);
        const freq = 100 + Math.random() * 800;
        const pan = Math.random() * 2 - 1;
        const amp = 0.3 * Math.random();

        for (let j = 0; j < length && i + j < buffer.length; j++) {
          const t = (i + j) / sr;
          const env = Math.exp(-3 * j / length); // Exponential decay
          buffer[i + j] += Math.sin(2 * Math.PI * freq * t) * amp * env * (1 - Math.abs(pan) * 0.3);
        }
      }

      return normalize(buffer);
    }
  },
  {
    name: 'Digital Glitch',
    description: 'Staccato digital artifacts and clicks',
    category: 'glitch',
    generate: (ctx, duration) => {
      const buffer = createBuffer(duration);
      const sr = SAMPLE_RATE;

      for (let i = 0; i < buffer.length; i++) {
        const t = i / sr;

        // Random clicks
        if (Math.random() > 0.97) {
          const clickFreq = 2000 + Math.random() * 6000;
          const clickLength = Math.floor(sr * 0.001);
          if (i + clickLength < buffer.length) {
            buffer[i] += (Math.random() - 0.5) * 0.5;
            for (let j = 1; j < clickLength && i + j < buffer.length; j++) {
              buffer[i + j] += Math.sin(2 * Math.PI * clickFreq * (j / sr)) * 0.3;
            }
          }
        }

        // Occasional burst
        if (Math.random() > 0.99) {
          const burstLength = Math.floor(sr * (0.01 + Math.random() * 0.05));
          const burstFreq = 500 + Math.random() * 2000;
          for (let j = 0; j < burstLength && i + j < buffer.length; j++) {
            buffer[i + j] += Math.sin(2 * Math.PI * burstFreq * ((i + j) / sr)) * 0.4;
          }
        }
      }

      return normalize(buffer);
    }
  },
  {
    name: 'Rhythmic Pulse',
    description: 'Steady rhythmic pulse with syncopation',
    category: 'rhythmic',
    generate: (ctx, duration) => {
      const buffer = createBuffer(duration);
      const sr = SAMPLE_RATE;
      const bpm = 120;
      const beatDuration = 60 / bpm;

      for (let i = 0; i < buffer.length; i++) {
        const t = i / sr;
        const beat = Math.floor(t / beatDuration);
        const beatPos = (t % beatDuration) / beatDuration;

        // Main kick on beats 1 and 3
        if (beatPos < 0.1) {
          const kickFreq = 60 * (1 - beatPos * 10);
          buffer[i] += Math.sin(2 * Math.PI * kickFreq * t) * 0.8 * (1 - beatPos * 8);
        }

        // Hi-hat on off-beats
        if ((beat % 2 === 1) && beatPos > 0.8) {
          const hatFreq = 8000 + Math.random() * 2000;
          buffer[i] += (Math.random() - 0.5) * 0.3;
        }

        // Syncopated snare
        if (beat % 4 === 2 && beatPos > 0.4 && beatPos < 0.6) {
          const snareFreq = 200 + Math.random() * 100;
          buffer[i] += Math.sin(2 * Math.PI * snareFreq * t) * 0.5;
        }
      }

      return normalize(buffer);
    }
  },
  {
    name: 'Sci-Fi FX',
    description: 'Otherworldly sci-fi sound effects',
    category: 'fx',
    generate: (ctx, duration) => {
      const buffer = createBuffer(duration);
      const sr = SAMPLE_RATE;

      // Rising alarm
      for (let i = 0; i < buffer.length; i++) {
        const t = i / sr;
        buffer[i] += Math.sin(2 * Math.PI * (800 + t * 500) * t) * 0.3;

        // Wobble
        const wobble = Math.sin(2 * Math.PI * 15 * t);
        buffer[i] += Math.sin(2 * Math.PI * 440 * t) * 0.2 * wobble;
      }

      return normalize(buffer);
    }
  },
  {
    name: 'Glass Harmonics',
    description: 'Clear bell-like harmonics',
    category: 'pad',
    generate: (ctx, duration) => {
      const buffer = createBuffer(duration);
      const sr = SAMPLE_RATE;
      const fundamental = 523.25; // C5

      // Add harmonics
      for (let i = 0; i < buffer.length; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 2); // Long decay

        for (let h = 1; h <= 16; h++) {
          buffer[i] += Math.sin(2 * Math.PI * fundamental * h * t) * (0.5 / h) * env;
        }
      }

      return normalize(buffer);
    }
  },
  {
    name: 'White Noise Wash',
    description: 'Filtered white noise for atmospheric pads',
    category: 'texture',
    generate: (ctx, duration) => {
      const buffer = createBuffer(duration);
      const sr = SAMPLE_RATE;

      // Generate white noise
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = Math.random() * 2 - 1;
      }

      // Simple lowpass filter
      const alpha = 0.9;
      for (let i = 1; i < buffer.length; i++) {
        buffer[i] = alpha * buffer[i - 1] + (1 - alpha) * buffer[i];
      }

      // Apply twice for smoother sound
      for (let i = 1; i < buffer.length; i++) {
        buffer[i] = alpha * buffer[i - 1] + (1 - alpha) * buffer[i];
      }

      return normalize(buffer);
    }
  },
  {
    name: 'Sine Sweep',
    description: 'Frequency sweep for testing',
    category: 'fx',
    generate: (ctx, duration) => {
      const buffer = createBuffer(duration);
      const sr = SAMPLE_RATE;

      for (let i = 0; i < buffer.length; i++) {
        const t = i / sr;
        const freq = 100 + t * 1000; // Sweep from 100Hz to 1100Hz
        buffer[i] = Math.sin(2 * Math.PI * freq * t) * 0.7;
      }

      return normalize(buffer);
    }
  },
  {
    name: 'FM Bell',
    description: 'FM synthesis bell tone',
    category: 'pad',
    generate: (ctx, duration) => {
      const buffer = createBuffer(duration);
      const sr = SAMPLE_RATE;

      for (let i = 0; i < buffer.length; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 1.5);

        // FM synthesis
        const carrier = 440;
        const modulator = 220;
        const index = 4;

        buffer[i] = Math.sin(2 * Math.PI * carrier * t +
          index * Math.sin(2 * Math.PI * modulator * t)) * env * 0.7;
      }

      return normalize(buffer);
    }
  }
];

function normalize(buffer: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < buffer.length; i++) {
    max = Math.max(max, Math.abs(buffer[i]));
  }
  if (max > 0) {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] /= max;
    }
  }
  return buffer;
}
