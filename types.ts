export type EnvelopeCurve = 'linear' | 'exponential';
export type LfoShape = 'sine' | 'triangle' | 'square' | 'sawtooth';
export type ScaleType = 'chromatic' | 'major' | 'minor' | 'pentaMajor' | 'pentaMinor';

// Scale intervals in semitones from root
export const SCALE_INTERVALS: Record<ScaleType, number[]> = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentaMajor: [0, 2, 4, 7, 9],
    pentaMinor: [0, 3, 5, 7, 10]
};

// Snap a pitch (in semitones) to the nearest scale degree
export function snapPitchToScale(pitch: number, scale: ScaleType, rootNote: number = 0): number {
    if (scale === 'chromatic') return pitch;

    const intervals = SCALE_INTERVALS[scale];
    const octave = Math.floor(pitch / 12);
    const semitoneInOctave = ((pitch % 12) + 12) % 12; // Handle negative correctly

    // Find nearest scale degree
    let nearestInterval = intervals[0];
    let minDistance = Math.abs(semitoneInOctave - intervals[0]);

    for (const interval of intervals) {
        const distance = Math.abs(semitoneInOctave - interval);
        if (distance < minDistance) {
            minDistance = distance;
            nearestInterval = interval;
        }
    }

    return octave * 12 + nearestInterval;
}

export interface GranularParams {
  // Grain Properties
  grainSize: number; // Duration of a grain in seconds (0.01 - 0.5)
  density: number; // Time between grains in seconds (0.01 - 0.2)
  spread: number; // Random position offset in seconds (0 - 2)
  position: number; // Center playhead position (0 - 1 normalized)
  grainReversalChance: number; // Probability of grain playing backwards (0 - 1)

  // Stereo
  pan: number; // Center pan position (-1 to 1)
  panSpread: number; // Random pan spread (0 to 1)

  // Pitch & FM
  pitch: number; // Semitones (-24 to +24)
  detune: number; // Random pitch offset (0 - 100 cents)
  fmFreq: number; // Frequency of FM modulator
  fmAmount: number; // Amount of FM modulation

  // Envelope
  attack: number; // Grain attack (0 - 1 normalized ratio of grain size)
  release: number; // Grain release (0 - 1 normalized ratio of grain size)
  envelopeCurve: EnvelopeCurve; // Shape of the envelope
  
  // FX
  distAmount: number; // Distortion drive (0 - 1)
  delayTime: number; // Delay time in seconds (0 - 1)
  delayFeedback: number; // Delay feedback (0 - 0.95)
  delayMix: number; // Delay wet mix (0 - 1)
  reverbMix: number; // 0 (dry) to 1 (wet)
  reverbDecay: number; // Impulse response duration in seconds

  // LFO
  lfoRate: number; // Frequency in Hz (0.1 - 20)
  lfoAmount: number; // Modulation depth (0 - 1)
  lfoShape: LfoShape; // Waveform
  lfoTargets: string[]; // Array of parameter keys to modulate

  // Master
  volume: number; // Master gain (0 - 1)
  filterFreq: number; // Lowpass filter cutoff (20 - 20000)
  filterRes: number; // Resonance (0 - 20)
}

export const DEFAULT_PARAMS: GranularParams = {
  grainSize: 0.1,
  density: 0.05,
  spread: 0.2,
  position: 0.2,
  grainReversalChance: 0,
  pan: 0,
  panSpread: 0.5,
  pitch: 0,
  detune: 10,
  fmFreq: 50,
  fmAmount: 0,
  attack: 0.5,
  release: 0.5,
  envelopeCurve: 'exponential',
  distAmount: 0,
  delayTime: 0.3,
  delayFeedback: 0.4,
  delayMix: 0,
  reverbMix: 0.2,
  reverbDecay: 2.0,
  lfoRate: 1.0,
  lfoAmount: 0.5,
  lfoShape: 'sine',
  lfoTargets: [],
  volume: 0.7,
  filterFreq: 20000,
  filterRes: 0,
};

export interface ThemeColors {
    bg: string;
    rack: string;
    rackBorder: string;
    header: string;
    headerText: string;
    panelInner: string;
    moduleBg: string;
    moduleBorder: string;
    labelDefault: string;
    labelTextDefault: string;
    labelGold: string;
    labelTextGold: string;
    knobLabel: string;
    knobValueBg: string;
    knobValueText: string;
    knobRing: string;
    knobBase: string;
    waveBg: string;
    waveGrid: string;
    waveLine: string;
    waveText: string;
}

export interface Preset {
    name: string;
    params: GranularParams;
}

export const FACTORY_PRESETS: Preset[] = [
    { 
        name: "Init Saw", 
        params: DEFAULT_PARAMS 
    },
    { 
        name: "Cloudy Pad", 
        params: { 
            ...DEFAULT_PARAMS, 
            density: 0.02, 
            grainSize: 0.25, 
            spread: 0.5, 
            panSpread: 0.8, 
            reverbMix: 0.6, 
            reverbDecay: 3.5,
            attack: 0.5, 
            release: 0.5,
            filterFreq: 8000
        } 
    },
    { 
        name: "Rhythmic Glitch", 
        params: { 
            ...DEFAULT_PARAMS, 
            density: 0.12, 
            grainSize: 0.04, 
            spread: 0.05, 
            panSpread: 0.9, 
            pitch: 0,
            fmAmount: 20,
            fmFreq: 250,
            lfoRate: 6,
            lfoAmount: 0.8,
            lfoShape: 'square',
            lfoTargets: ['pitch', 'pan', 'filterFreq'],
            delayMix: 0.3,
            delayTime: 0.15
        } 
    },
    { 
        name: "Deep Drone", 
        params: { 
            ...DEFAULT_PARAMS, 
            density: 0.01, 
            grainSize: 0.4, 
            spread: 0.1, 
            pitch: -12, 
            detune: 25,
            reverbMix: 0.7, 
            distAmount: 0.2,
            filterFreq: 800
        } 
    },
    { 
        name: "Shimmer Delay", 
        params: { 
            ...DEFAULT_PARAMS, 
            density: 0.05,
            grainSize: 0.1,
            pitch: 12,
            delayMix: 0.5,
            delayFeedback: 0.8,
            delayTime: 0.25,
            panSpread: 0.6,
            envelopeCurve: 'exponential'
        } 
    },
    { 
        name: "Broken Radio",
        params: {
            ...DEFAULT_PARAMS,
            density: 0.08,
            grainSize: 0.03,
            distAmount: 0.8,
            filterFreq: 2000,
            filterRes: 5,
            lfoRate: 12,
            lfoAmount: 0.4,
            lfoShape: 'sawtooth',
            lfoTargets: ['volume', 'filterFreq'],
            panSpread: 0.1
        }
    }
];

// Texture Profiles for musical randomization
export type TextureProfileType = 'cloudy' | 'glitch' | 'drone' | 'shimmer' | 'rhythmic' | 'crystalline';

export interface TextureProfile {
    name: string;
    description: string;
    baseParams: Partial<GranularParams>;
    // Randomization ranges (min/max) for each parameter
    randomize: {
        grainSize?: [number, number];
        density?: [number, number];
        spread?: [number, number];
        position?: [number, number];
        panSpread?: [number, number];
        pitch?: [number, number];
        detune?: [number, number];
        fmFreq?: [number, number];
        fmAmount?: [number, number];
        attack?: [number, number];
        release?: [number, number];
        distAmount?: [number, number];
        delayTime?: [number, number];
        delayFeedback?: [number, number];
        delayMix?: [number, number];
        reverbMix?: [number, number];
        reverbDecay?: [number, number];
        filterFreq?: [number, number];
        filterRes?: [number, number];
        lfoRate?: [number, number];
        lfoAmount?: [number, number];
    };
}

export const TEXTURE_PROFILES: Record<TextureProfileType, TextureProfile> = {
    cloudy: {
        name: 'Cloudy',
        description: 'High density, large grains, lush reverb - ambient clouds',
        baseParams: {
            grainSize: 0.2,
            density: 0.03,
            spread: 0.4,
            panSpread: 0.8,
            attack: 0.5,
            release: 0.5,
            reverbMix: 0.7,
            reverbDecay: 4.0,
            filterFreq: 4000,
            filterRes: 2,
            envelopeCurve: 'exponential'
        },
        randomize: {
            grainSize: [0.15, 0.35],
            density: [0.02, 0.05],
            spread: [0.2, 0.7],
            panSpread: [0.6, 1.0],
            pitch: [-7, 7],
            reverbMix: [0.5, 0.9],
            reverbDecay: [2.5, 6.0],
            filterFreq: [2000, 8000]
        }
    },
    glitch: {
        name: 'Glitch',
        description: 'Tiny grains, high density, short envelope - digital artifacts',
        baseParams: {
            grainSize: 0.02,
            density: 0.15,
            spread: 0.03,
            panSpread: 0.9,
            attack: 0.1,
            release: 0.1,
            pitch: 0,
            detune: 50,
            envelopeCurve: 'linear'
        },
        randomize: {
            grainSize: [0.01, 0.04],
            density: [0.1, 0.2],
            spread: [0.01, 0.08],
            panSpread: [0.7, 1.0],
            pitch: [-12, 12],
            detune: [20, 100],
            filterFreq: [500, 5000],
            filterRes: [0, 8]
        }
    },
    drone: {
        name: 'Drone',
        description: 'Slow grains, low density, sustained - frozen textures',
        baseParams: {
            grainSize: 0.35,
            density: 0.015,
            spread: 0.1,
            panSpread: 0.3,
            attack: 0.6,
            release: 0.6,
            pitch: -12,
            detune: 20,
            reverbMix: 0.8,
            reverbDecay: 5.0,
            filterFreq: 1200,
            filterRes: 3,
            envelopeCurve: 'exponential'
        },
        randomize: {
            grainSize: [0.25, 0.45],
            density: [0.008, 0.025],
            spread: [0.05, 0.2],
            pitch: [-24, -5],
            detune: [10, 40],
            reverbMix: [0.6, 1.0],
            reverbDecay: [3.0, 7.0],
            filterFreq: [400, 3000],
            filterRes: [1, 6]
        }
    },
    shimmer: {
        name: 'Shimmer',
        description: 'Bright upward pitch, delay heavy - ethereal pads',
        baseParams: {
            grainSize: 0.12,
            density: 0.04,
            spread: 0.25,
            panSpread: 0.7,
            attack: 0.4,
            release: 0.4,
            pitch: 12,
            delayMix: 0.6,
            delayFeedback: 0.75,
            delayTime: 0.3,
            reverbMix: 0.5,
            reverbDecay: 3.0,
            filterFreq: 6000,
            envelopeCurve: 'exponential'
        },
        randomize: {
            grainSize: [0.08, 0.2],
            density: [0.025, 0.06],
            pitch: [5, 19],
            delayMix: [0.4, 0.8],
            delayFeedback: [0.6, 0.9],
            reverbMix: [0.3, 0.7],
            filterFreq: [4000, 12000]
        }
    },
    rhythmic: {
        name: 'Rhythmic',
        description: 'Medium grains, steady pattern - rhythmic textures',
        baseParams: {
            grainSize: 0.08,
            density: 0.1,
            spread: 0.05,
            panSpread: 0.8,
            attack: 0.2,
            release: 0.2,
            envelopeCurve: 'linear',
            delayMix: 0.4,
            delayFeedback: 0.6,
            delayTime: 0.25,
            lfoRate: 4,
            lfoAmount: 0.6,
            lfoShape: 'square',
            lfoTargets: ['position', 'pan']
        },
        randomize: {
            grainSize: [0.05, 0.12],
            density: [0.08, 0.15],
            spread: [0.02, 0.1],
            panSpread: [0.6, 1.0],
            delayTime: [0.1, 0.4],
            lfoRate: [2, 8],
            filterFreq: [2000, 8000]
        }
    },
    crystalline: {
        name: 'Crystalline',
        description: 'Tiny bright grains, high pitch - sparkly textures',
        baseParams: {
            grainSize: 0.025,
            density: 0.08,
            spread: 0.15,
            panSpread: 0.9,
            attack: 0.15,
            release: 0.15,
            pitch: 19,
            detune: 30,
            filterFreq: 8000,
            filterRes: 4,
            reverbMix: 0.6,
            envelopeCurve: 'linear'
        },
        randomize: {
            grainSize: [0.015, 0.04],
            density: [0.05, 0.12],
            pitch: [12, 24],
            detune: [15, 50],
            spread: [0.08, 0.25],
            filterFreq: [6000, 15000],
            filterRes: [2, 8],
            reverbMix: [0.4, 0.8]
        }
    }
};

// Generate randomized parameters from a texture profile
export function randomizeTextureProfile(profile: TextureProfile): GranularParams {
    const params: GranularParams = { ...DEFAULT_PARAMS, ...profile.baseParams };

    // Apply randomization within ranges
    const rand = (min: number, max: number) => Math.random() * (max - min) + min;
    const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));

    if (profile.randomize.grainSize) params.grainSize = parseFloat(rand(...profile.randomize.grainSize).toFixed(3));
    if (profile.randomize.density) params.density = parseFloat(rand(...profile.randomize.density).toFixed(3));
    if (profile.randomize.spread) params.spread = parseFloat(rand(...profile.randomize.spread).toFixed(3));
    if (profile.randomize.position) params.position = parseFloat(rand(...profile.randomize.position).toFixed(3));
    if (profile.randomize.panSpread) params.panSpread = parseFloat(rand(...profile.randomize.panSpread).toFixed(2));
    if (profile.randomize.pitch) params.pitch = randInt(...profile.randomize.pitch);
    if (profile.randomize.detune) params.detune = randInt(...profile.randomize.detune);
    if (profile.randomize.fmFreq) params.fmFreq = randInt(...profile.randomize.fmFreq);
    if (profile.randomize.fmAmount) params.fmAmount = parseFloat(rand(...profile.randomize.fmAmount).toFixed(1));
    if (profile.randomize.attack) params.attack = parseFloat(rand(...profile.randomize.attack).toFixed(3));
    if (profile.randomize.release) params.release = parseFloat(rand(...profile.randomize.release).toFixed(3));
    if (profile.randomize.distAmount) params.distAmount = parseFloat(rand(...profile.randomize.distAmount).toFixed(2));
    if (profile.randomize.delayTime) params.delayTime = parseFloat(rand(...profile.randomize.delayTime).toFixed(3));
    if (profile.randomize.delayFeedback) params.delayFeedback = parseFloat(rand(...profile.randomize.delayFeedback).toFixed(2));
    if (profile.randomize.delayMix) params.delayMix = parseFloat(rand(...profile.randomize.delayMix).toFixed(2));
    if (profile.randomize.reverbMix) params.reverbMix = parseFloat(rand(...profile.randomize.reverbMix).toFixed(2));
    if (profile.randomize.reverbDecay) params.reverbDecay = parseFloat(rand(...profile.randomize.reverbDecay).toFixed(1));
    if (profile.randomize.filterFreq) params.filterFreq = randInt(...profile.randomize.filterFreq);
    if (profile.randomize.filterRes) params.filterRes = parseFloat(rand(...profile.randomize.filterRes).toFixed(1));
    if (profile.randomize.lfoRate) params.lfoRate = parseFloat(rand(...profile.randomize.lfoRate).toFixed(2));
    if (profile.randomize.lfoAmount) params.lfoAmount = parseFloat(rand(...profile.randomize.lfoAmount).toFixed(2));

    return params;
}
