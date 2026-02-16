<div align="center">

# 🎛️ NodeGrain

### **Web-Based Granular Synthesizer**

A free, browser-based granular synthesizer built with React and TypeScript featuring a Eurorack-style modular interface.

[Live Demo](https://onlyjones.github.io/nodegrainsynth/) • [Report Issues](https://github.com/OnlyJones/nodegrainsynth/issues)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-cyan)](https://react.dev/)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-C++-blueviolet)](https://webassembly.org/)

[Features](#-features) • [Getting Started](#-getting-started) • [How It Works](#-how-it-works) • [Presets](#-presets) • [Controls](#-controls)

</div>

---

## ✨ Features

- **🎵 Granular Synthesis Engine** - C++/WASM grain engine running in an AudioWorklet with JS fallback
- **🎛️ Eurorack-Style Interface** - Modular panels with knobs, buttons, and visual feedback
- **📊 Real-Time Visualization** - Waveform display with animated grain particles
- **🎚️ XY Pad Mode** - 2D control over position and mapped parameters
- **🔄 Grain Reversal** - Random probability of backwards grain playback
- **❄️ Grain Freeze** - Lock grain position for frozen textures
- **💨 Auto-Drift** - Random walk position modulation for organic movement
- **🎛️ LFO Modulation** - Multi-target modulation with waveform selection
- **🎚️ Effects Chain** - Distortion, Delay, and Reverb
- **🎨 Dark/Light Themes** - Complete theming system
- **🔊 Recording** - Capture your performances to WebM audio
- **📋 Undo/Redo** - Full history for parameter tweaks
- **🎲 Texture Profiles** - Quick randomization within stylistic constraints
- **🎚️ Factory Presets** - 6 curated starting points

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+
- **Emscripten** 3.1+ (for building the WASM engine from C++ source)
- A modern web browser (Chrome, Firefox, Edge, Safari)

### Installation

```bash
# Clone the repository
git clone https://github.com/OnlyJones/nodegrainsynth.git
cd nodegrainsynth

# Install dependencies
npm install

# Build WASM engine and run development server
npm run dev:full
```

> **Note:** If you don't have Emscripten installed, you can still run the JS-only engine with `npm run dev`. The app automatically falls back to the JavaScript engine when WASM is unavailable.

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Building for Production

```bash
# Build optimized bundle
npm run build

# Preview production build
npm run preview
```

The built files will be in the `dist/` folder.

### Deployment

Deploy the `dist/` folder to any static hosting service:

- **[Vercel](https://vercel.com)** - Drag & drop the `dist/` folder
- **[Netlify](https://netlify.com)** - Drag & drop the `dist/` folder
- **[GitHub Pages](https://pages.github.com)** - Free hosting for GitHub repos

---

## 🎛️ How It Works

### Granular Synthesis Basics

Granular synthesis breaks audio into tiny fragments called "grains" (typically 10-100ms). Each grain is:

1. **Extracted** from a random position within the sample
2. **Envelope-shaped** with attack/release to prevent clicks
3. **Pitch-shifted** via playback rate manipulation
4. **Panned** in stereo
5. **Mixed** together with thousands of other grains per second

### NodeGrain Architecture

The engine uses a **dual-engine design**: a C++/WASM engine for performance (default) with automatic fallback to a pure JavaScript engine.

```
┌────────────────────────────────────────────────────────────────────┐
│                    C++/WASM AudioWorklet                           │
│  ┌───────────┐  ┌──────────┐  ┌─────────┐  ┌─────┐  ┌────────┐  │
│  │   Grain   │→ │ Envelope │→ │  Panner │→ │ LFO │→ │  Mix   │  │
│  │ Scheduler │  │          │  │         │  │     │  │        │  │
│  └───────────┘  └──────────┘  └─────────┘  └─────┘  └───┬────┘  │
└──────────────────────────────────────────────────────────┼────────┘
                                                           ↓
               ┌───────────────────────────────────────────────────┐
               │              Web Audio FX Chain                   │
               │  Filter → Distortion → Delay → Reverb → Master   │
               └──────────────────────────┬────────────────────────┘
                                          ↓
                                  🎧 Your Ears
```

The WASM engine runs grain scheduling, envelopes, LFO, mixing, and panning inside an AudioWorklet on the audio thread — zero main-thread jitter. Effects remain as Web Audio nodes for native browser performance.

### Modulation System

The **LFO** can simultaneously modulate any combination of:
- Grain Size, Density, Spread, Position
- Pitch, FM Frequency/Amount
- Filter Frequency/Resonance
- Pan, Pan Spread

**Mapping Mode:** Click the MAP button, then click knobs to toggle LFO targets.

---

## 🎹 Controls Overview

### Transport & Global

| Button | Function |
|--------|----------|
| ▶️ PLAY | Start/stop granular engine |
| 📁 LOAD WAV | Load audio sample from disk |
| 🎲 RANDOMIZE | Randomize all parameters |
| ↩️ UNDO / ↪️ REDO | Navigate parameter history |
| ❄️ FREEZE | Lock grain position (creates frozen textures) |
| 💨 DRIFT | Enable random walk position modulation |
| ⏺️ REC | Start/stop recording (downloads as WebM) |
| ☀️/🌙 THEME | Toggle dark/light mode |
| ❓ | Open help modal |

### GRAIN Panel

| Knob | Range | Function |
|------|-------|----------|
| Size | 0.01 - 0.5s | Duration of each grain |
| Density | 0.005 - 0.5s | Time between grains |
| Pos | 0 - 1 | Center position in sample |
| Spread | 0 - 2 | Random position variation |
| Pan | -1 - 1 | Stereo panning center |
| Spread Pan | 0 - 1 | Random pan variation |
| **Reverse** | 0 - 100% | Probability of grain reversal |

### FM/PITCH Panel

| Knob | Range | Function |
|------|-------|----------|
| Pitch | -24 - +24 st | Transposition in semitones |
| Detune | 0 - 100 cents | Random pitch variation |
| FM Freq | 0 - 1000 Hz | LFO frequency for pitch vibrato |
| FM Amt | 0 - 100% | FM modulation depth |

### AMP ENV Panel

| Knob | Range | Function |
|------|-------|----------|
| Attack | 0 - 90% | Grain attack time (ratio of grain size) |
| Release | 0 - 90% | Grain release time (ratio of grain size) |
| Curve | Linear/Exponential | Envelope shape (click to toggle) |

### LFO/MOD Panel

| Knob | Range | Function |
|------|-------|----------|
| Rate | 0.1 - 10 Hz | LFO frequency |
| Depth | 0 - 100% | Modulation amount |
| Wave | Sine/Square/Saw/Triangle | LFO waveform |
| Targets | Multiple | Which parameters to modulate |

### FILTER/FX Panel

| Knob | Range | Function |
|------|-------|----------|
| Freq | 20 - 20000 Hz | Lowpass filter cutoff |
| Res | 0 - 20 | Filter resonance |
| Dist | 0 - 1 | Distortion amount |
| Delay Mix | 0 - 100% | Delay wet/dry mix |
| Delay Time | 0 - 1s | Delay time |
| Feedback | 0 - 95% | Delay feedback |
| Reverb Mix | 0 - 100% | Reverb wet/dry mix |
| Decay | 0.5 - 3s | Reverb tail length |
| **Master** | 0 - 100% | Output volume |

---

## 📋 Factory Presets

| Preset | Description |
|--------|-------------|
| **Init Saw** | Clean starting point |
| **Cloud Texture** | Dense, atmospheric layers |
| **Glitch Storm** | Chaotic reversal-heavy |
| **Deep Drone** | Sustained, evolving bass |
| **Shimmer Rain** | Bright, bell-like grains |
| **Rhythmic Stutter** | Tempo-synced repeats |

---

## 🎚️ Keyboard Shortcuts

- **Double-click knobs** - Reset to default value
- **MAP button** - Enter LFO mapping mode
- **XY button** - Enable XY pad control
- **Drag on waveform** - Seek position

---

## 🎨 Texture Profiles

Quick randomization within stylistic constraints:

- **Cloudy** - Dense, soft atmospheres
- **Glitch** - Chaotic, reversal-heavy
- **Drone** - Sustained, evolving textures
- **Shimmer** - Bright, reverberant
- **Rhythmic** - Stuttering, percussive
- **Crystalline** - Sparse, delicate

---

## 🛠️ Development

```bash
# Run dev server (JS engine only)
npm run dev

# Build WASM engine + run dev server
npm run dev:full

# Build WASM engine only
npm run build:wasm

# Build WASM engine with SIMD
npm run build:wasm:simd

# Build for production (includes WASM)
npm run build

# Preview production build
npm run preview
```

### Project Structure

```
nodegrainsynth/
├── App.tsx                          # Main UI component
├── main.tsx                         # React entry point
├── types.ts                         # TypeScript types & constants
├── services/
│   ├── IAudioEngine.ts              # Engine interface (shared contract)
│   ├── audioEngine.ts               # JS engine (fallback)
│   ├── audioEngineWASM.ts           # WASM engine bridge
│   └── engineFactory.ts             # Engine selection + fallback logic
├── components/
│   ├── Knob.tsx                     # Rotary knob control
│   └── WaveformDisplay.tsx          # Canvas visualization
├── cpp/                             # C++ WASM source
│   ├── CMakeLists.txt               # Emscripten build config
│   └── src/
│       ├── grain_engine.h / .cpp    # Core DSP engine
│       ├── grain.h                  # Grain struct (fixed pool)
│       ├── lfo.h                    # LFO waveforms
│       ├── param_smoother.h         # Parameter smoothing
│       └── bindings.cpp             # Embind JS interop
├── public/
│   └── worklets/
│       └── grain-processor.js       # AudioWorklet (loads WASM)
└── index.html                       # HTML entry point
```

---

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- Built with [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org/)
- WASM engine compiled with [Emscripten](https://emscripten.org)
- Powered by [Vite](https://vitejs.dev)
- Audio via [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) + [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
- Icons by [Lucide](https://lucide.dev)

---

<div align="center">

**Made with ❤️ by [OnlyJones](https://github.com/OnlyJones)**

[⭐ Star this repo](https://github.com/OnlyJones/nodegrainsynth/stargazers) • [🍿 Buy me a coffee](https://buymeacoffee.com/rigs)

</div>
