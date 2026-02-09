# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## NodeGrain - Granular Audio Synthesizer

A web-based granular synthesizer built with React and TypeScript using the Web Audio API. The app creates a virtual Eurorack-style synth interface for granular synthesis of audio samples.

## Development Commands

```bash
# Install dependencies
npm install

# Run development server (runs on port 3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Environment Setup

The app requires a `GEMINI_API_KEY` in `.env.local`. This is used by the parent AI Studio project but the current standalone app works without it for audio synthesis functionality.

## Architecture

### Core Audio Engine (`services/audioEngine.ts`)

The `AudioEngine` class wraps the Web Audio API and implements:
- **Granular synthesis**: Schedules grains using a lookahead scheduler (`playGrain()`, `schedule()`)
- **Audio routing graph**: GrainSource → Envelope → Panner → Filter → Distortion → Delay → Reverb → Master
- **FX chain**: Distortion (waveshaper), Delay with feedback, Reverb (procedural impulse response)
- **LFO modulation**: Modulates multiple parameters simultaneously with different waveforms
- **Visualization**: Emits `GrainEvent` objects for the UI to render grain positions

Key modulation scales are defined in `App.tsx` (`MOD_SCALES`) and must match the engine's implementation.

### Type System (`types.ts`)

- `GranularParams`: All synthesizer parameters with min/max ranges in comments
- `DEFAULT_PARAMS`: Default values for all parameters
- `FACTORY_PRESETS`: 6 factory presets showcasing different synthesis techniques
- `ThemeColors`: Complete theming system for dark/light modes

### UI Structure (`App.tsx`)

The main app renders a Eurorack-style modular interface with 5 panels:
1. **Transport/Global**: Play/stop, sample loading, preset management
2. **GRAIN**: Grain size, density, position (playhead), spread, panning
3. **FM/PITCH**: Pitch transposition, FM frequency and amount
4. **AMP ENV**: Attack/release with linear/exponential curve selection
5. **LFO/MOD**: LFO rate, depth, waveform selection, target mapping
6. **FILTER/FX**: Lowpass filter, distortion, delay, reverb, master volume

### Components

- `Knob`: Rotary control with drag-to-adjust, ghost needle for modulated values, mapping mode indicator
- `WaveformDisplay`: Canvas-based waveform visualization with real-time grain particle effects

### Key Patterns

**Parameter Changes**: All parameter changes go through `handleParamChange()` which:
1. Updates React state
2. Pushes new params to `AudioEngine.updateParams()`
3. Marks preset as modified (appends `*` to preset name)

**LFO Modulation**: The LFO can modulate any subset of parameters. In mapping mode (`isMappingMode`), clicking knobs toggles them in/out of the `lfoTargets` array. Modulated values show a cyan ghost needle.

**Theming**: Complete dark/light theme support via `THEME_COLORS` object. All colors flow down through props to avoid hardcoded values.

**Audio State Management**: `AudioEngine` instance is stored in a `useRef()` to persist across renders without causing re-renders when it updates internal audio nodes.

## Build System

- **Vite**: Build tool with React plugin
- **TypeScript**: Strict mode enabled
- **Path alias**: `@` maps to project root
- **Port**: Dev server runs on 3000, binds to 0.0.0.0

## File Structure

```
/
├── App.tsx                 # Main UI component with all panels
├── index.tsx               # React entry point
├── types.ts                # All TypeScript types and constants
├── services/
│   └── audioEngine.ts      # Web Audio API wrapper & granular engine
├── components/
│   ├── Knob.tsx            # Rotary knob control
│   └── WaveformDisplay.tsx # Canvas waveform + grain visualization
├── vite.config.ts          # Vite configuration
└── package.json
```
