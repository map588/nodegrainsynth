# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## NodeGrain - Granular Audio Synthesizer

**GitHub**: https://github.com/OnlyJones/nodegrainsynth
**Dev URL**: http://localhost:3000

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
  - New: `grainReversalChance` (0-1) - Probability of grain reversal
  - New: `spectralFreeze` (boolean) - Enable spectral freeze effect
- `DEFAULT_PARAMS`: Default values for all parameters
  - `grainReversalChance`: 0 (no reversal)
  - `spectralFreeze`: false (off)
- `FACTORY_PRESETS`: 6 factory presets showcasing different synthesis techniques
- `ThemeColors`: Complete theming system for dark/light modes

### UI Structure (`App.tsx`)

The main app renders a Eurorack-style modular interface with panels:
1. **Transport/Global**: Play/stop, sample loading, preset management
   - Buttons: PLAY, LOAD WAV, RANDOMIZE, UNDO/REDO, FREEZE, SPECTRAL, DRIFT, Texture Profile, Preset
2. **GRAIN**: Grain size, density, position (playhead), spread, panning, reversal
   - 3-column grid with 6 knobs total
   - New: Reverse knob controls grain reversal probability (%)
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

## Features Added (Post-Initial Development)

### Texture Profile Randomizer
- **Location**: `types.ts` (TEXTURE_PROFILES), `App.tsx` (dropdown & button)
- **6 Profiles**: cloudy, glitch, drone, shimmer, rhythmic, crystalline
- **Behavior**: Dropdown immediately applies baseParams, button randomizes within profile constraints
- **Function**: `randomizeTextureProfile()` in types.ts

### XY Pad Mode
- **Location**: `components/WaveformDisplay.tsx`, `App.tsx`
- **Activation**: XY button in top-right of waveform display
- **3 Y-axis mappings**: Pitch, Density, Grain Size (select via dropdown)
- **X-axis**: Always controls grain position through sample

### Recording
- **Location**: `services/audioEngine.ts` (MediaRecorder), `App.tsx` (REC button)
- **Format**: WebM audio
- **Usage**: Click REC button to start/stop, auto-downloads with timestamp
- **File naming**: `nodegrain_recording_YYYY-MM-DDTHH-MM-SS.webm`

### Spectral Freeze
- **Location**: `services/audioEngine.ts` (freeze buffer), `App.tsx` (SPECTRAL button in transport)
- **Function**: Freezes and loops audio output with subtle LFO modulation
- **Usage**: Click SPECTRAL button to freeze/unfreeze
- **Creates**: Ethereal, evolving ambient textures
- **Implementation**: Captures audio buffer, loops with slow LFO modulation

### Grain Reversal
- **Location**: `services/audioEngine.ts` (playGrain method), `App.tsx` (Reverse knob in GRAIN panel)
- **Parameter**: `grainReversalChance` (0-1, percentage)
- **Function**: Random probability of grains playing backwards
- **Creates**: Glitchy, reversed textures and stutters
- **Implementation**: Random check per grain, negative playbackRate for reversed grains

### Help Modal
- **Location**: `App.tsx` (showHelp state, modal JSX)
- **Content**: Complete documentation of all knobs, buttons, and features
- **Theme-aware**: Matches dark/light mode

### Monetization
- **Buy Me a Coffee**: Button in header links to buymeacoffee.com/rigs
- **Icon**: Coffee cup from lucide-react

### Grain Freeze & Drift
- **Freeze**: Locks grain position, creates frozen textures
- **Drift**: Auto-moves grain position slowly for evolving textures

## Git & Deployment

### Repository Info
- **Owner**: OnlyJones
- **Email**: rigsyjon@gmail.com
- **Repo**: nodegrainsynth
- **Remote**: https://github.com/OnlyJones/nodegrainsynth.git

### Git Configuration
```bash
git config user.name "OnlyJones"
git config user.email "rigsyjon@gmail.com"
```

### Authentication
- Uses GitHub Personal Access Token
- **IMPORTANT**: Never share tokens in chat or commit them
- After use, remove from remote URL: `git remote set-url origin https://github.com/OnlyJones/nodegrainsynth.git`

### Branches
- **main**: Primary branch for production
- **backup-before-push**: Safety branch created before GitHub operations

### Deployment Commands
```bash
# Build for production
npm run build

# Output goes to dist/ folder (270 kB, 79 kB gzipped)
# Upload dist/ folder to hosting provider
```

### Hosting Options
- **Vercel** (recommended): Free tier, drag & drop dist/ folder, custom domain support
- **Netlify**: Free tier, drag & drop dist/ folder
- **GitHub Pages**: Free, requires GitHub Actions setup

### SEO & Social
- **Title**: NodeGrain - Free Web-Based Granular Synthesizer
- **Open Graph tags**: Added for social sharing
- **Favicon**: 🎛️ emoji SVG

## Common Tasks

### Add New Parameter
1. Add to `GranularParams` type in types.ts
2. Add default value to `DEFAULT_PARAMS`
3. Add to `MOD_SCALES` in App.tsx if LFO modulatable
4. Add UI controls in App.tsx
5. Handle in `AudioEngine.updateParams()`
6. Add to help modal

### Debug Audio Issues
- Check browser console for Web Audio API errors
- Verify `AudioEngine` instance exists: `engineRef.current`
- Check grain scheduling in `schedule()` method
- Visualization events emitted via `grainEvents` callback

### Theme Colors
All colors defined in `THEME_COLORS` object (types.ts):
- `dark`: Dark mode colors (rack border, panels, knobs, labels)
- `light`: Light mode variant

When adding new UI elements, use theme-aware styling:
```tsx
style={{ backgroundColor: theme === 'dark' ? '#1a1a1a' : '#ffffff' }}
```

## Build Size Optimization

Current bundle: **270 kB** (79 kB gzipped)
- All dependencies tree-shaken by Vite
- Tailwind CSS via CDN (not bundled)
- No unnecessary dependencies

To reduce further:
- Consider removing unused lucide-react icons
- Code splitting if app grows significantly
