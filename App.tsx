import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, FolderOpen, Volume2, VolumeX, Activity, Dices, X, Network, Sun, Moon, Save, Upload, ChevronDown, Undo, Redo, Snowflake, Wind, Music, HelpCircle, Circle, Coffee, Smartphone, Monitor } from 'lucide-react';
import { GranularParams, DEFAULT_PARAMS, LfoShape, EnvelopeCurve, ThemeColors, FACTORY_PRESETS, Preset, ScaleType, SCALE_INTERVALS, snapPitchToScale, TextureProfileType, TEXTURE_PROFILES, randomizeTextureProfile } from './types';
import { AudioEngine } from './services/audioEngine';
import { BUILTIN_SAMPLES } from './services/builtinSamples';
import { Knob } from './components/Knob';
import { WaveformDisplay } from './components/WaveformDisplay';
import { MIN_TOUCH_TARGET } from './utils/touch';

// Scales matching the Audio Engine modulation logic
const MOD_SCALES: Record<string, number> = {
    grainSize: 0.2,
    density: 0.1,
    spread: 1.0,
    position: 0.5,
    pitch: 24,
    fmFreq: 200,
    fmAmount: 50,
    filterFreq: 5000,
    filterRes: 10,
    attack: 0.5,
    release: 0.5,
    distAmount: 0.5,
    delayMix: 0.5,
    delayTime: 0.5,
    delayFeedback: 0.5,
    pan: 1.0,
    panSpread: 1.0
};

const THEME_COLORS: Record<'dark' | 'light', ThemeColors> = {
  dark: {
    bg: '#1a1a1a',
    rack: '#a0a0a0',
    rackBorder: '#525252',
    header: '#cdcdcd',
    headerText: 'text-neutral-700',
    panelInner: '#2a2a2a',
    moduleBg: '#333333',
    moduleBorder: '#444444',
    labelDefault: '#444444',
    labelTextDefault: '#d4d4d4',
    labelGold: '#dec07b',
    labelTextGold: '#3e3416',
    knobLabel: 'text-neutral-400',
    knobValueBg: '#111111',
    knobValueText: 'text-orange-400',
    knobRing: '#1f1f1f',
    knobBase: '#333333',
    waveBg: '#0f0f0f',
    waveGrid: '#222',
    waveLine: '#4b5563',
    waveText: '#444'
  },
  light: {
    bg: '#e5e5e5',
    rack: '#d4d4d8', 
    rackBorder: '#a1a1aa',
    header: '#f4f4f5', 
    headerText: 'text-neutral-600',
    panelInner: '#d4d4d4',
    moduleBg: '#ffffff',
    moduleBorder: '#e4e4e7',
    labelDefault: '#e4e4e7',
    labelTextDefault: '#52525b',
    labelGold: '#fcd34d', 
    labelTextGold: '#854d0e', 
    knobLabel: 'text-neutral-500',
    knobValueBg: '#f4f4f5',
    knobValueText: 'text-orange-600',
    knobRing: '#e4e4e7',
    knobBase: '#fafafa',
    waveBg: '#ffffff',
    waveGrid: '#f0f0f0',
    waveLine: '#94a3b8',
    waveText: '#cbd5e1'
  }
};

export const App: React.FC = () => {
  const [params, setParams] = useState<GranularParams>(DEFAULT_PARAMS);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [isDrifting, setIsDrifting] = useState(false);
  const [driftSpeed, setDriftSpeed] = useState(0.5);
  const [driftReturnTendency, setDriftReturnTendency] = useState(0.3);
  const [isHarmonicLockEnabled, setIsHarmonicLockEnabled] = useState(false);
  const [scaleType, setScaleType] = useState<ScaleType>('major');
  const [textureProfile, setTextureProfile] = useState<TextureProfileType | null>(null);
  const [xyPadMode, setXyPadMode] = useState(false);
  const [xyPadMapping, setXyPadMapping] = useState<'pitch' | 'density' | 'grainSize'>('pitch');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingIntervalRef = useRef<number | null>(null);
  const [audioData, setAudioData] = useState<Float32Array | null>(null);

  // Store pre-freeze values to restore when unfreezing
  const preFreezeValuesRef = useRef<{ spread: number; density: number } | null>(null);
  const [fileName, setFileName] = useState<string>("init_saw.wav");
  const [isInitialized, setIsInitialized] = useState(false);
  const [lfoVisualValue, setLfoVisualValue] = useState<number>(0);
  const [isMappingMode, setIsMappingMode] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [currentPresetName, setCurrentPresetName] = useState<string>("Init Saw");
  const [showHelp, setShowHelp] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [preMuteVolume, setPreMuteVolume] = useState<number>(DEFAULT_PARAMS.volume);
  const [showCpuMeter, setShowCpuMeter] = useState(false);
  const [fps, setFps] = useState(60);
  const [frameTime, setFrameTime] = useState(0);
  const [selectedBuiltinSample, setSelectedBuiltinSample] = useState<string>("");
  const [isMobileMode, setIsMobileMode] = useState(false);

  // Undo/Redo history
  const [history, setHistory] = useState<GranularParams[]>([DEFAULT_PARAMS]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const isUndoingRef = useRef(false);
  const isDraggingRef = useRef(false);

  const colors = THEME_COLORS[theme];

  // Engine ref to persist across renders
  const engineRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    // Initialize engine on mount
    engineRef.current = new AudioEngine(params);
    // Create a default buffer so it's playable immediately
    engineRef.current.createTestBuffer(); 
    setAudioData(engineRef.current.getAudioData());
    
    // Cleanup
    return () => {
      engineRef.current?.stop();
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animation Loop for LFO visualization
  useEffect(() => {
    let animationFrameId: number;

    const animate = () => {
        if (params.lfoTargets.length > 0) {
            const time = engineRef.current ? engineRef.current.getCurrentTime() : Date.now() / 1000;
            const phase = (time * params.lfoRate) % 1;
            let lfoVal = 0;
            switch(params.lfoShape) {
                case 'sine': lfoVal = Math.sin(phase * Math.PI * 2); break;
                case 'square': lfoVal = phase < 0.5 ? 1 : -1; break;
                case 'sawtooth': lfoVal = phase * 2 - 1; break;
                case 'triangle': lfoVal = Math.abs(phase * 4 - 2) - 1; break;
            }
            setLfoVisualValue(lfoVal);
        } else {
            setLfoVisualValue(0);
        }
        animationFrameId = requestAnimationFrame(animate);
    }
    animate();
    return () => cancelAnimationFrame(animationFrameId);
  }, [params.lfoRate, params.lfoShape, params.lfoTargets]);

  // CPU/FPS Meter
  useEffect(() => {
    let frameId: number;
    let lastTime = performance.now();
    let frames = 0;
    let lastFpsUpdate = lastTime;

    const measureFps = () => {
      const now = performance.now();
      frames++;

      if (now - lastFpsUpdate >= 500) { // Update every 500ms
        const fps = Math.round((frames / (now - lastFpsUpdate)) * 1000);
        const frameTime = (now - lastFpsUpdate) / frames;
        setFps(fps);
        setFrameTime(frameTime);
        frames = 0;
        lastFpsUpdate = now;
      }

      lastTime = now;
      frameId = requestAnimationFrame(measureFps);
    };

    measureFps();
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Snap pitch to scale when harmonic lock is enabled or scale changes
  useEffect(() => {
    if (isHarmonicLockEnabled) {
      const snappedPitch = snapPitchToScale(params.pitch, scaleType, 0);
      if (snappedPitch !== params.pitch) {
        const newParams = { ...params, pitch: snappedPitch };
        setParams(newParams);
        engineRef.current?.updateParams(newParams);
      }
    }
  }, [isHarmonicLockEnabled, scaleType]);

  const handleParamChange = <K extends keyof GranularParams>(key: K, value: GranularParams[K]) => {
    const newParams = { ...params, [key]: value };

    setParams(newParams);
    engineRef.current?.updateParams(newParams);
    // If user changes a param manually, we are no longer strictly on the preset
    if (currentPresetName && !currentPresetName.endsWith('*')) {
        setCurrentPresetName(prev => prev + "*");
    }
  };

  const handleToggleMute = () => {
    if (isMuted) {
      // Unmute - restore previous volume
      setIsMuted(false);
      handleParamChange('volume', preMuteVolume);
    } else {
      // Mute - save current volume and set to 0
      setIsMuted(true);
      setPreMuteVolume(params.volume);
      handleParamChange('volume', 0);
    }
  };

  const handleKnobDragStart = () => {
    isDraggingRef.current = true;
  };

  const handleKnobDragEnd = (finalParams: GranularParams) => {
    isDraggingRef.current = false;

    // Push to history after drag completes
    if (!isUndoingRef.current) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(finalParams);
      // Limit history to 50 states
      if (newHistory.length > 50) {
        newHistory.shift();
      }
      setHistory(newHistory);
      setHistoryIndex(Math.min(newHistory.length - 1, 49));
    }
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      isUndoingRef.current = true;
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const prevParams = history[newIndex];
      setParams(prevParams);
      engineRef.current?.updateParams(prevParams);
      setCurrentPresetName(prev => prev.endsWith('*') ? prev : prev + '*');
      setTimeout(() => { isUndoingRef.current = false; }, 0);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      isUndoingRef.current = true;
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      const nextParams = history[newIndex];
      setParams(nextParams);
      engineRef.current?.updateParams(nextParams);
      setCurrentPresetName(prev => prev.endsWith('*') ? prev : prev + '*');
      setTimeout(() => { isUndoingRef.current = false; }, 0);
    }
  };

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  // Helper to create knob handlers with history tracking
  const createKnobHandlers = <K extends keyof GranularParams>(key: K) => ({
    onChange: (val: GranularParams[K]) => handleParamChange(key, val),
    onDragStart: handleKnobDragStart,
    onDragEnd: (val: GranularParams[K]) => {
      const finalParams = { ...params, [key]: val };
      handleKnobDragEnd(finalParams);
    }
  });

  // Helper to get locked pitch value (when harmonic lock is enabled)
  const getLockedPitch = (pitch: number): number => {
    if (!isHarmonicLockEnabled) return pitch;
    return snapPitchToScale(pitch, scaleType, 0);
  };

  // Special handler for pitch that snaps to scale when harmonic lock is enabled
  const handlePitchChange = (val: number) => {
    const lockedPitch = isHarmonicLockEnabled ? snapPitchToScale(val, scaleType, 0) : val;
    handleParamChange('pitch', lockedPitch);
  };

  // Reset pitch directly to default (bypasses harmonic lock snap)
  const handlePitchReset = () => {
    handleParamChange('pitch', DEFAULT_PARAMS.pitch);
  };

  const togglePlay = async () => {
    if (!engineRef.current) return;

    if (!isInitialized) {
        await engineRef.current.init();
        setIsInitialized(true);
    }

    if (isPlaying) {
      engineRef.current.stop();
    } else {
      engineRef.current.start();
    }
    setIsPlaying(!isPlaying);
  };

  const handleFreezeToggle = () => {
      if (!engineRef.current) return;

      const wasFrozen = engineRef.current.isFrozenActive();

      if (!wasFrozen) {
          // FREEZE: Save current values and apply freeze-friendly settings
          preFreezeValuesRef.current = {
              spread: params.spread,
              density: params.density
          };

          // Auto-adjust for better freeze texture
          const freezeParams: GranularParams = {
              ...params,
              spread: 0.02,  // Tight spread to focus on exact moment
              density: params.density * 0.6  // Lower density for cleaner texture
          };

          setParams(freezeParams);
          engineRef.current.updateParams(freezeParams);
          engineRef.current.freeze();
          setIsFrozen(true);
      } else {
          // UNFREEZE: Restore original values
          engineRef.current.unfreeze();
          setIsFrozen(false);

          if (preFreezeValuesRef.current) {
              const restoreParams: GranularParams = {
                  ...params,
                  spread: preFreezeValuesRef.current.spread,
                  density: preFreezeValuesRef.current.density
              };
              setParams(restoreParams);
              engineRef.current.updateParams(restoreParams);
              preFreezeValuesRef.current = null;
          }
      }
  };

  const handleDriftToggle = () => {
      if (!engineRef.current) return;

      engineRef.current.toggleDrift(params.position);
      const nowDrifting = engineRef.current.isDriftActive();
      setIsDrifting(nowDrifting);
  };

  const toggleTheme = () => {
      setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const handleRecordToggle = async () => {
      if (!engineRef.current) return;

      if (!isRecording) {
          // Start recording
          await engineRef.current.startRecording();
          setIsRecording(true);
          setRecordingTime(0);

          // Start timer to update recording time display
          recordingIntervalRef.current = window.setInterval(() => {
              setRecordingTime(prev => prev + 1);
          }, 1000);
      } else {
          // Stop recording
          const blob = await engineRef.current.stopRecording();
          setIsRecording(false);
          setRecordingTime(0);

          // Clear timer
          if (recordingIntervalRef.current) {
              clearInterval(recordingIntervalRef.current);
              recordingIntervalRef.current = null;
          }

          // Download the recording
          if (blob) {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              const extension = blob.type.includes('wav') ? 'wav' : 'webm';
              a.download = `nodegrain_recording_${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
          }
      }
  };

  const formatTime = (seconds: number): string => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && engineRef.current) {
        const file = e.target.files[0];
        setFileName(file.name);
        // Pause while loading
        const wasPlaying = isPlaying;
        if(wasPlaying) engineRef.current.stop();

        await engineRef.current.loadSample(file);
        setAudioData(engineRef.current.getAudioData());

        if(wasPlaying) engineRef.current.start();
    }
  };

  const handleLoadBuiltinSample = async (sampleName: string) => {
    if (!sampleName || !engineRef.current) return;

    const sample = BUILTIN_SAMPLES.find(s => s.name === sampleName);
    if (!sample) return;

    setSelectedBuiltinSample(sampleName);
    setFileName(sample.name);

    // Pause while loading
    const wasPlaying = isPlaying;
    if (wasPlaying) engineRef.current.stop();

    // Generate the sample data
    await engineRef.current.init();
    const sampleData = sample.generate(engineRef.current.getCurrentTime() as any, 3.0);
    engineRef.current.loadFromFloat32Data(sampleData);
    setAudioData(engineRef.current.getAudioData());

    if (wasPlaying) engineRef.current.start();
  };

  const handleLfoRandomize = () => {
      const allTargets = [
          'grainSize', 'density', 'spread', 'position',
          'pitch', 'fmFreq', 'fmAmount', 'filterFreq', 'filterRes', 'attack', 'release',
          'distAmount', 'delayMix', 'delayTime', 'delayFeedback', 'pan', 'panSpread'
      ];
      const shapes: LfoShape[] = ['sine', 'triangle', 'square', 'sawtooth'];

      const numTargets = Math.floor(Math.random() * 3) + 1;
      const shuffled = [...allTargets].sort(() => 0.5 - Math.random());
      const selectedTargets = shuffled.slice(0, numTargets);

      const randomShape = shapes[Math.floor(Math.random() * shapes.length)];
      const randomRate = 0.5 + Math.random() * 8;
      const randomAmount = 0.3 + Math.random() * 0.7;

      const newParams = {
          ...params,
          lfoTargets: selectedTargets,
          lfoShape: randomShape,
          lfoRate: parseFloat(randomRate.toFixed(2)),
          lfoAmount: parseFloat(randomAmount.toFixed(2))
      };
      setParams(newParams);
      engineRef.current?.updateParams(newParams);
  };

  const handleFullRandomize = () => {
      const shapes: LfoShape[] = ['sine', 'triangle', 'square', 'sawtooth'];
      const curves: EnvelopeCurve[] = ['linear', 'exponential'];
      const allTargets = [
          'grainSize', 'density', 'spread', 'position',
          'pitch', 'fmFreq', 'fmAmount', 'filterFreq', 'filterRes', 'attack', 'release',
          'distAmount', 'delayMix', 'delayTime', 'delayFeedback', 'pan', 'panSpread'
      ];

      const rand = (min: number, max: number) => Math.random() * (max - min) + min;
      const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));

      const numTargets = Math.floor(Math.random() * 4);
      const shuffled = [...allTargets].sort(() => 0.5 - Math.random());
      const selectedTargets = shuffled.slice(0, numTargets);

      const newParams: GranularParams = {
          grainSize: parseFloat(rand(0.01, 0.3).toFixed(3)),
          density: parseFloat(rand(0.01, 0.15).toFixed(3)),
          spread: parseFloat(rand(0, 1).toFixed(3)),
          position: parseFloat(rand(0, 1).toFixed(3)),
          grainReversalChance: 0,
          pan: parseFloat(rand(-1, 1).toFixed(2)),
          panSpread: parseFloat(rand(0, 1).toFixed(2)),
          pitch: randInt(-12, 12),
          detune: randInt(0, 50),
          fmFreq: randInt(0, 300),
          fmAmount: parseFloat(rand(0, 50).toFixed(1)),
          attack: parseFloat(rand(0.1, 0.6).toFixed(3)),
          release: parseFloat(rand(0.1, 0.6).toFixed(3)),
          envelopeCurve: curves[Math.floor(Math.random() * curves.length)],
          distAmount: parseFloat(rand(0, 0.6).toFixed(3)),
          delayTime: parseFloat(rand(0, 0.5).toFixed(3)),
          delayFeedback: parseFloat(rand(0, 0.7).toFixed(3)),
          delayMix: parseFloat(rand(0, 0.5).toFixed(3)),
          reverbMix: parseFloat(rand(0, 0.7).toFixed(3)),
          reverbDecay: parseFloat(rand(0.5, 3).toFixed(2)),
          lfoRate: parseFloat(rand(0.2, 8).toFixed(2)),
          lfoAmount: parseFloat(rand(0.2, 0.8).toFixed(2)),
          lfoShape: shapes[Math.floor(Math.random() * shapes.length)],
          lfoTargets: selectedTargets,
          volume: parseFloat(rand(0.5, 0.9).toFixed(3)),
          filterFreq: randInt(500, 15000),
          filterRes: parseFloat(rand(0, 10).toFixed(2))
      };

      // Push to history
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newParams);
      if (newHistory.length > 50) newHistory.shift();
      setHistory(newHistory);
      setHistoryIndex(Math.min(newHistory.length - 1, 49));

      setParams(newParams);
      engineRef.current?.updateParams(newParams);
      setCurrentPresetName('Random *');
  };

  const handleTextureProfileRandomize = () => {
      if (!textureProfile) return;

      const profile = TEXTURE_PROFILES[textureProfile];
      const newParams = randomizeTextureProfile(profile);

      // Push to history
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newParams);
      if (newHistory.length > 50) newHistory.shift();
      setHistory(newHistory);
      setHistoryIndex(Math.min(newHistory.length - 1, 49));

      setParams(newParams);
      engineRef.current?.updateParams(newParams);
      setCurrentPresetName(`${profile.name} *`);
  };

  const handleTextureProfileChange = (profileType: TextureProfileType | null) => {
      setTextureProfile(profileType);
      if (!profileType) return;

      const profile = TEXTURE_PROFILES[profileType];
      const newParams = { ...DEFAULT_PARAMS, ...profile.baseParams };

      setParams(newParams);
      engineRef.current?.updateParams(newParams);
      setCurrentPresetName(profile.name);
  };

  const handleXyPadChange = (x: number, y: number) => {
      // X controls position (0-1)
      const newPosition = x;

      // Y controls selected parameter (0-1 mapped to parameter range)
      let newParams = { ...params, position: newPosition };

      switch (xyPadMapping) {
          case 'pitch':
              // Y 0-1 maps to pitch -24 to +24
              newParams.pitch = Math.round(y * 48 - 24);
              break;
          case 'density':
              // Y 0-1 maps to density 0.01 to 0.2
              newParams.density = parseFloat((y * 0.19 + 0.01).toFixed(3));
              break;
          case 'grainSize':
              // Y 0-1 maps to grain size 0.01 to 0.5
              newParams.grainSize = parseFloat((y * 0.49 + 0.01).toFixed(3));
              break;
      }

      setParams(newParams);
      engineRef.current?.updateParams(newParams);
  };

  const handleLfoReset = () => {
      handleParamChange('lfoTargets', []);
  }

  const toggleLfoTarget = (target: string) => {
      const current = params.lfoTargets;
      if (current.includes(target)) {
          handleParamChange('lfoTargets', current.filter(t => t !== target));
      } else {
          handleParamChange('lfoTargets', [...current, target]);
      }
  };

  // Preset Handlers
  const handlePresetSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const name = e.target.value;
      const preset = FACTORY_PRESETS.find(p => p.name === name);
      if (preset) {
          setParams(preset.params);
          engineRef.current?.updateParams(preset.params);
          setCurrentPresetName(name);
          // Reset history when loading a preset
          setHistory([preset.params]);
          setHistoryIndex(0);
      }
  };

  const handleSavePreset = () => {
      const preset: Preset = { name: "User Preset", params: params };
      const blob = new Blob([JSON.stringify(preset)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `granular_preset_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const handleLoadPresetFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const json = JSON.parse(event.target?.result as string) as Preset;
              if (json.params) {
                  // Merge with defaults to ensure safety against old versions
                  const safeParams = { ...DEFAULT_PARAMS, ...json.params };
                  setParams(safeParams);
                  engineRef.current?.updateParams(safeParams);
                  setCurrentPresetName(json.name || "User Loaded");
                  // Reset history when loading a preset
                  setHistory([safeParams]);
                  setHistoryIndex(0);
              }
          } catch (err) {
              console.error("Failed to load preset", err);
          }
      };
      reader.readAsText(file);
      // Reset input value to allow reloading same file
      e.target.value = '';
  };

  const getModulatedValue = (target: string, base: number, min: number, max: number) => {
      if (!params.lfoTargets.includes(target)) return undefined;
      const scale = MOD_SCALES[target] || 0;
      let val = base + (lfoVisualValue * params.lfoAmount * scale);
      return Math.max(min, Math.min(max, val));
  };

  // Envelope preset handlers
  const handleEnvelopePreset = (attack: number, release: number, curve: EnvelopeCurve) => {
      const newParams = { ...params, attack, release, envelopeCurve: curve };
      setParams(newParams);
      engineRef.current?.updateParams(newParams);
      setCurrentPresetName(prev => prev.endsWith('*') ? prev : prev + '*');
  };

  // LFO preset handlers
  const handleLfoPreset = (rate: number, amount: number, shape?: LfoShape) => {
      const newParams = { ...params, lfoRate: rate, lfoAmount: amount };
      if (shape) {
          newParams.lfoShape = shape;
      }
      setParams(newParams);
      engineRef.current?.updateParams(newParams);
      setCurrentPresetName(prev => prev.endsWith('*') ? prev : prev + '*');
  };

  return (
    <div
        className={`min-h-screen flex items-center justify-center ${isMobileMode ? 'p-2' : 'p-4'} overflow-x-hidden overflow-y-auto relative`}
        style={{
            backgroundColor: colors.bg,
            backgroundImage: theme === 'dark'
                ? `
                    linear-gradient(rgba(30, 30, 30, 0.3) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(30, 30, 30, 0.3) 1px, transparent 1px)
                `
                : `
                    linear-gradient(rgba(0, 0, 0, 0.05) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0, 0, 0, 0.05) 1px, transparent 1px)
                `,
            backgroundSize: '40px 40px, 40px 40px',
        }}
    >
      {/* Animated background orbs - more visible */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Orange orb - top left */}
        <div
            className="absolute rounded-full blur-3xl animate-pulse"
            style={{
                width: '500px',
                height: '500px',
                background: 'radial-gradient(circle, rgba(251, 146, 60, 0.25) 0%, transparent 70%)',
                top: '-100px',
                left: '-100px',
                animationDuration: '6s',
            }}
        />
        {/* Cyan orb - bottom right */}
        <div
            className="absolute rounded-full blur-3xl animate-pulse"
            style={{
                width: '400px',
                height: '400px',
                background: 'radial-gradient(circle, rgba(34, 211, 238, 0.2) 0%, transparent 70%)',
                bottom: '-80px',
                right: '-80px',
                animationDuration: '8s',
                animationDelay: '1s',
            }}
        />
        {/* Pink orb - center */}
        <div
            className="absolute rounded-full blur-3xl animate-pulse"
            style={{
                width: '350px',
                height: '350px',
                background: 'radial-gradient(circle, rgba(232, 121, 249, 0.15) 0%, transparent 70%)',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                animationDuration: '7s',
                animationDelay: '2s',
            }}
        />
      </div>

      {/* Main Rack Container */}
      <div
        className={`${isMobileMode ? 'w-full max-w-[1800px]' : 'w-fit'} mx-auto rounded-lg p-1 shadow-2xl border transition-colors duration-300 relative z-10`}
        style={{
            backgroundColor: colors.rack,
            borderColor: colors.rackBorder,
        }}
      >
        {/* Subtle inner glow on rack */}
        <div
            className="absolute inset-0 rounded-lg pointer-events-none"
            style={{
                background: theme === 'dark'
                    ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, transparent 50%)'
                    : 'linear-gradient(135deg, rgba(255, 255, 255, 0.8) 0%, transparent 50%)',
            }}
        />
        
        {/* Header Bar */}
        <div 
            className="px-3 py-1 flex justify-between items-center border-b rounded-t-sm mb-1 transition-colors duration-300"
            style={{ backgroundColor: colors.header, borderColor: colors.rackBorder }}
        >
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500 border border-green-700 shadow-sm"></div>
                <h1 className={`font-bold text-sm tracking-wide ${colors.headerText}`}>NODEGRAIN</h1>
            </div>
            <div className="flex gap-1 md:gap-2 items-center">
                 <button
                     onClick={handleUndo}
                     disabled={!canUndo}
                     className={`${colors.headerText} ${canUndo ? 'opacity-70 hover:opacity-100 cursor-pointer' : 'opacity-30 cursor-not-allowed'} transition-opacity flex items-center justify-center`}
                     style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
                     title="Undo"
                 >
                     <Undo size={16} className="md:w-3.5 md:h-3.5"/>
                 </button>
                 <button
                     onClick={handleRedo}
                     disabled={!canRedo}
                     className={`${colors.headerText} ${canRedo ? 'opacity-70 hover:opacity-100 cursor-pointer' : 'opacity-30 cursor-not-allowed'} transition-opacity flex items-center justify-center`}
                     style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
                     title="Redo"
                 >
                     <Redo size={16} className="md:w-3.5 md:h-3.5"/>
                 </button>
                 <div className="w-[1px] h-4 bg-neutral-400 mx-0.5 md:mx-1 hidden sm:block"></div>
                 <button
                     onClick={() => setShowHelp(true)}
                     className={`${colors.headerText} opacity-70 hover:opacity-100 transition-transform active:scale-95 flex items-center justify-center`}
                     style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
                     title="Help"
                 >
                     <HelpCircle size={16} className="md:w-3.5 md:h-3.5"/>
                 </button>
                 <a
                     href="https://www.buymeacoffee.com/rigs"
                     target="_blank"
                     rel="noopener noreferrer"
                     className={`${colors.headerText} opacity-70 hover:opacity-100 transition-transform active:scale-95 flex items-center gap-1 text-xs font-semibold px-2 py-1 hidden md:flex`}
                     style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
                     title="Support me on Buy Me a Coffee"
                 >
                     <Coffee size={14}/>
                     <span>Support</span>
                 </a>
                 <div className="w-[1px] h-4 bg-neutral-400 mx-0.5 md:mx-1 hidden sm:block"></div>
                 <button
                     onClick={(e) => {
                         e.stopPropagation();
                         setShowCpuMeter(!showCpuMeter);
                     }}
                     className={`${colors.headerText} opacity-70 hover:opacity-100 transition-transform active:scale-95 relative ${showCpuMeter ? 'text-green-400' : ''} flex items-center justify-center`}
                     style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
                     title="CPU Meter"
                 >
                     <Activity size={18} className="md:w-4 md:h-4"/>
                     {showCpuMeter && (
                         <div
                             onClick={(e) => e.stopPropagation()}
                             className="absolute top-full right-0 mt-2 p-3 rounded-md shadow-2xl z-[9999] min-w-[140px] border-2"
                             style={{
                                 backgroundColor: colors.moduleBg,
                                 borderColor: showCpuMeter ? '#22c55e' : colors.moduleBorder,
                                 boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
                             }}
                         >
                             <div className="space-y-2">
                                 <div className="flex justify-between items-center text-xs font-semibold"
                                     style={{ color: colors.labelTextDefault }}
                                 >
                                     <span>FPS</span>
                                     <span className={`font-mono ${fps >= 50 ? 'text-green-400' : fps >= 30 ? 'text-yellow-400' : 'text-red-400'}`}>
                                         {fps}
                                     </span>
                                 </div>
                                 <div className="flex justify-between items-center text-xs font-semibold"
                                     style={{ color: colors.labelTextDefault }}
                                 >
                                     <span>Frame</span>
                                     <span className="font-mono" style={{ color: frameTime < 20 ? '#22c55e' : frameTime < 35 ? '#eab308' : '#ef4444' }}>
                                         {frameTime.toFixed(1)}ms
                                     </span>
                                 </div>
                                 <div className="h-2 rounded-full overflow-hidden"
                                     style={{ backgroundColor: colors.knobBase }}
                                 >
                                     <div
                                         className="h-full transition-all duration-300 rounded-full"
                                         style={{
                                             width: `${Math.min(100, (fps / 60) * 100)}%`,
                                             backgroundColor: fps >= 50 ? '#22c55e' : fps >= 30 ? '#eab308' : '#ef4444'
                                         }}
                                     />
                                 </div>
                                 <div className="text-[9px] text-center font-medium"
                                     style={{ color: colors.knobLabel }}
                                 >
                                     {fps >= 50 ? 'Good' : fps >= 30 ? 'Fair' : 'Heavy Load'}
                                 </div>
                             </div>
                         </div>
                     )}
                 </button>
                 <button
                     onClick={handleToggleMute}
                     className={`${colors.headerText} opacity-70 hover:opacity-100 transition-transform active:scale-95 ${isMuted ? 'text-red-400' : ''} flex items-center justify-center`}
                     style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
                     title={isMuted ? 'Unmute' : 'Mute'}
                 >
                     {isMuted ? <VolumeX size={18} className="md:w-4 md:h-4"/> : <Volume2 size={18} className="md:w-4 md:h-4"/>}
                 </button>
                 <div className="w-[1px] h-4 bg-neutral-400 mx-1"></div>
                 <button
                     onClick={() => setIsMobileMode(!isMobileMode)}
                     className={`${colors.headerText} opacity-70 hover:opacity-100 transition-transform active:scale-95 flex items-center justify-center ${isMobileMode ? 'text-cyan-400' : ''}`}
                     style={{ minWidth: 28, minHeight: 28 }}
                     title={isMobileMode ? 'Desktop Mode' : 'Mobile Mode'}
                 >
                     {isMobileMode ? <Monitor size={16} /> : <Smartphone size={16} />}
                 </button>
                 <button
                     onClick={toggleTheme}
                     className={`${colors.headerText} opacity-70 hover:opacity-100 transition-transform active:scale-95 flex items-center justify-center`}
                     style={{ minWidth: 28, minHeight: 28 }}
                 >
                     {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                 </button>
            </div>
        </div>

        {/* Inner Synth Body */}
        <div 
            className="p-2 rounded-sm shadow-inner transition-colors duration-300"
            style={{ backgroundColor: colors.panelInner }}
        >
            
            {/* Display Area */}
            <div className="mb-2 relative">
                <div className="absolute top-0 left-0 z-10 p-2 pointer-events-none">
                     <span className="text-orange-400 font-mono text-xs bg-black/50 px-1 rounded">{fileName}</span>
                </div>

                {/* XY Pad Controls - Right side */}
                <div className="absolute top-0 right-0 z-10 p-2 flex items-center gap-2">
                    {xyPadMode && (
                        <select
                            value={xyPadMapping}
                            onChange={(e) => setXyPadMapping(e.target.value as 'pitch' | 'density' | 'grainSize')}
                            className="py-1 px-2 text-[10px] font-semibold border rounded cursor-pointer focus:outline-none"
                            style={{
                                backgroundColor: theme === 'dark' ? '#1a1a1a' : '#ffffff',
                                borderColor: colors.moduleBorder,
                                color: theme === 'dark' ? '#ffffff' : '#000000'
                            }}
                        >
                            <option value="pitch">Y → Pitch</option>
                            <option value="density">Y → Density</option>
                            <option value="grainSize">Y → Grain Size</option>
                        </select>
                    )}

                    <button
                        onClick={() => setXyPadMode(!xyPadMode)}
                        className={`px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1 transition-all
                            ${xyPadMode ? 'ring-1 ring-cyan-400' : ''}`}
                        style={{
                            backgroundColor: xyPadMode ? '#22d3ee' : colors.knobBase,
                            borderColor: colors.moduleBorder,
                            color: xyPadMode ? '#000' : colors.labelTextDefault
                        }}
                    >
                        <Activity size={11}/>
                        XY
                    </button>

                    {xyPadMode && (
                        <div className="text-[9px] font-mono text-cyan-400 whitespace-nowrap">
                            {xyPadMapping.toUpperCase()}
                        </div>
                    )}
                </div>
                <WaveformDisplay
                    data={audioData}
                    params={{
                        ...params,
                        position: getModulatedValue('position', params.position, 0, 1) ?? params.position
                    }}
                    onSeek={(pos) => handleParamChange('position', pos)}
                    audioEngine={engineRef.current}
                    colors={colors}
                    isFrozen={isFrozen}
                    isDrifting={isDrifting}
                    xyPadMode={xyPadMode}
                    onXyPadChange={handleXyPadChange}
                    onFileDrop={async (file) => {
                        setFileName(file.name);
                        const wasPlaying = isPlaying;
                        if (wasPlaying) engineRef.current?.stop();

                        await engineRef.current?.loadSample(file);
                        setAudioData(engineRef.current?.getAudioData() || null);

                        if (wasPlaying) engineRef.current?.start();
                    }}
                />
            </div>

            {/* Controls Grid */}
            <div className="flex gap-1 items-stretch">

                {/* Transport & Global */}
                <div
                    className={`border rounded-sm p-2 flex flex-col gap-2 ${isMobileMode ? 'w-32' : 'w-28'} shrink-0 items-center transition-colors duration-300`}
                    style={{ backgroundColor: colors.moduleBg, borderColor: colors.moduleBorder }}
                >
                    {/* Play/Stop */}
                    <button
                        onClick={togglePlay}
                        style={{ minHeight: isMobileMode ? MIN_TOUCH_TARGET : undefined }}
                        className={`w-full ${isMobileMode ? 'py-3' : 'py-2'} rounded font-bold ${isMobileMode ? 'text-sm' : 'text-xs'} uppercase tracking-wider flex items-center justify-center gap-2 border shadow-sm transition-all
                            ${isPlaying
                                ? 'bg-orange-500 border-orange-600 text-white'
                                : (theme === 'dark'
                                    ? 'bg-[#b8b8b8] border-[#888] text-neutral-800 hover:bg-[#c4c4c4]'
                                    : 'bg-[#e4e4e7] border-[#d4d4d8] text-neutral-800 hover:bg-[#f4f4f5]')
                            }`}
                    >
                        {isPlaying ? <Pause size={isMobileMode ? 16 : 14} fill="currentColor"/> : <Play size={isMobileMode ? 16 : 14} fill="currentColor"/>}
                        {isPlaying ? 'HOLD' : 'PLAY'}
                    </button>

                    <button
                        onClick={handleRecordToggle}
                        title="Record output"
                        style={{ minHeight: isMobileMode ? MIN_TOUCH_TARGET : undefined }}
                        className={`w-full ${isMobileMode ? 'py-3' : 'py-2'} border rounded font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all
                            ${isRecording
                                ? 'bg-red-500 border-red-600 text-white animate-pulse'
                                : (theme === 'dark'
                                    ? 'bg-[#b8b8b8] border-[#888] text-neutral-800 hover:bg-[#c4c4c4]'
                                    : 'bg-[#e4e4e7] border-[#d4d4d8] text-neutral-800 hover:bg-[#f4f4f5]')
                            }`}
                    >
                        <Circle size={isMobileMode ? 16 : 14} fill={isRecording ? "currentColor" : "none"} strokeWidth={2}/>
                        {isRecording ? `REC ${formatTime(recordingTime)}` : 'REC'}
                    </button>

                    {/* Built-in Samples */}
                    <div className="w-full flex flex-col gap-1">
                        <select
                            value={selectedBuiltinSample}
                            onChange={(e) => handleLoadBuiltinSample(e.target.value)}
                            className={`w-full ${isMobileMode ? 'py-2 text-xs' : 'py-1 text-[10px]'} px-2 font-semibold border rounded cursor-pointer focus:outline-none`}
                            style={{
                                backgroundColor: theme === 'dark' ? '#1a1a1a' : '#ffffff',
                                borderColor: colors.moduleBorder,
                                color: theme === 'dark' ? '#fb923c' : '#ea580c',
                                minHeight: isMobileMode ? MIN_TOUCH_TARGET : undefined
                            }}
                        >
                            <option value="">Built-in Samples...</option>
                            <optgroup label="Pads">
                                <option value="Ethereal Pad">Ethereal Pad</option>
                                <option value="Glass Harmonics">Glass Harmonics</option>
                                <option value="FM Bell">FM Bell</option>
                            </optgroup>
                            <optgroup label="Drones">
                                <option value="Dark Drone">Dark Drone</option>
                            </optgroup>
                            <optgroup label="Textures">
                                <option value="Granular Texture">Granular Texture</option>
                                <option value="White Noise Wash">White Noise Wash</option>
                            </optgroup>
                            <optgroup label="Glitch">
                                <option value="Digital Glitch">Digital Glitch</option>
                            </optgroup>
                            <optgroup label="Rhythmic">
                                <option value="Rhythmic Pulse">Rhythmic Pulse</option>
                            </optgroup>
                            <optgroup label="FX">
                                <option value="Sci-Fi FX">Sci-Fi FX</option>
                                <option value="Sine Sweep">Sine Sweep</option>
                            </optgroup>
                        </select>
                    </div>

                    <label
                        className={`w-full ${isMobileMode ? 'py-3' : 'py-2'} border rounded cursor-pointer flex items-center justify-center gap-2 font-semibold text-xs transition-colors hover:brightness-110`}
                        style={{
                            backgroundColor: colors.labelDefault,
                            borderColor: colors.moduleBorder,
                            color: colors.labelTextDefault,
                            minHeight: isMobileMode ? MIN_TOUCH_TARGET : undefined
                        }}
                    >
                        <FolderOpen size={isMobileMode ? 16 : 14}/>
                        LOAD WAV
                        <input type="file" onChange={handleFileUpload} accept="audio/*" className="hidden"/>
                    </label>

                    {/* Texture Profile Section */}
                    <div className="w-full h-[1px] bg-neutral-400/30 my-0.5"></div>

                    <div className="w-full">
                        <select
                            value={textureProfile || ''}
                            onChange={(e) => handleTextureProfileChange(e.target.value as TextureProfileType | null)}
                            className={`w-full ${isMobileMode ? 'py-2 text-xs' : 'py-1 text-[10px]'} px-2 font-semibold border rounded cursor-pointer focus:outline-none`}
                            style={{
                                backgroundColor: theme === 'dark' ? '#1a1a1a' : '#ffffff',
                                borderColor: colors.moduleBorder,
                                color: theme === 'dark' ? '#ffffff' : '#000000',
                                minHeight: isMobileMode ? MIN_TOUCH_TARGET : undefined
                            }}
                        >
                            <option value="">Texture Profile...</option>
                            <option value="cloudy">Cloudy (Ambient)</option>
                            <option value="glitch">Glitch (Digital)</option>
                            <option value="drone">Drone (Dark)</option>
                            <option value="shimmer">Shimmer (Bright)</option>
                            <option value="rhythmic">Rhythmic (Pattern)</option>
                            <option value="crystalline">Crystalline (Sparkle)</option>
                        </select>
                    </div>

                    {textureProfile && (
                        <button
                            onClick={handleTextureProfileRandomize}
                            title="Randomize within selected texture profile"
                            className={`w-full mt-1 ${isMobileMode ? 'py-2 text-xs' : 'py-1 text-[10px]'} px-2 border rounded cursor-pointer flex items-center justify-center gap-1.5 font-semibold transition-colors hover:brightness-110`}
                            style={{
                                backgroundColor: colors.labelDefault,
                                borderColor: colors.moduleBorder,
                                color: colors.labelTextDefault,
                                minHeight: isMobileMode ? MIN_TOUCH_TARGET : undefined
                            }}
                        >
                            <Dices size={isMobileMode ? 12 : 10}/>
                            {TEXTURE_PROFILES[textureProfile].name.toUpperCase()}
                        </button>
                    )}

                    <button
                        onClick={handleFreezeToggle}
                        title="Freeze grain position for ambient textures"
                        className={`w-full ${isMobileMode ? 'py-3' : 'py-2'} border rounded cursor-pointer flex items-center justify-center gap-2 font-semibold text-xs transition-colors hover:brightness-110
                            ${isFrozen ? 'ring-2 ring-orange-400' : ''}`}
                        style={{
                            backgroundColor: isFrozen ? '#fb923c' : colors.labelDefault,
                            borderColor: colors.moduleBorder,
                            color: isFrozen ? '#fff' : colors.labelTextDefault,
                            minHeight: isMobileMode ? MIN_TOUCH_TARGET : undefined
                        }}
                    >
                        <Snowflake size={isMobileMode ? 16 : 14}/>
                        {isFrozen ? 'UNFREEZE' : 'FREEZE'}
                    </button>

                    <button
                        onClick={handleDriftToggle}
                        title="Auto-drift position for organic textures"
                        className={`w-full ${isMobileMode ? 'py-3' : 'py-2'} border rounded cursor-pointer flex items-center justify-center gap-2 font-semibold text-xs transition-colors hover:brightness-110
                            ${isDrifting ? 'ring-2 ring-cyan-400' : ''}`}
                        style={{
                            backgroundColor: isDrifting ? '#22d3ee' : colors.labelDefault,
                            borderColor: colors.moduleBorder,
                            color: isDrifting ? '#000' : colors.labelTextDefault,
                            minHeight: isMobileMode ? MIN_TOUCH_TARGET : undefined
                        }}
                    >
                        <Wind size={isMobileMode ? 16 : 14}/>
                        DRIFT
                    </button>

                    <button
                        onClick={handleFullRandomize}
                        title="Randomize All"
                        className={`w-full mt-1 ${isMobileMode ? 'py-3' : 'py-2'} border rounded cursor-pointer flex items-center justify-center`}
                        style={{
                            backgroundColor: colors.labelDefault,
                            borderColor: colors.moduleBorder,
                            color: colors.labelTextDefault,
                            minHeight: isMobileMode ? MIN_TOUCH_TARGET : undefined
                        }}
                    >
                        <Dices size={isMobileMode ? 20 : 18}/>
                    </button>

                    <div className="w-full h-[1px] bg-neutral-400/30 my-0.5"></div>

                    {/* Presets */}
                    <div className="w-full flex flex-col gap-1.5">
                        <div className="relative w-full">
                            <select
                                value={currentPresetName.replace('*', '')}
                                onChange={handlePresetSelect}
                                className={`w-full ${isMobileMode ? 'text-xs py-2' : 'text-[10px] py-1'} px-1 rounded border appearance-none font-mono cursor-pointer outline-none focus:ring-1 focus:ring-orange-400`}
                                style={{
                                    backgroundColor: colors.knobValueBg,
                                    color: theme === 'dark' ? '#fb923c' : '#ea580c',
                                    borderColor: colors.moduleBorder,
                                    minHeight: isMobileMode ? MIN_TOUCH_TARGET : undefined
                                }}
                            >
                                {FACTORY_PRESETS.map(p => (
                                    <option key={p.name} value={p.name}>{p.name}</option>
                                ))}
                            </select>
                            <div className="absolute right-1 top-1.5 pointer-events-none opacity-50">
                                <ChevronDown size={10} color={theme === 'dark' ? '#fb923c' : '#ea580c'} />
                            </div>
                        </div>

                        <div className="flex gap-1 w-full">
                            <button
                                onClick={handleSavePreset}
                                title="Save Preset"
                                className={`flex-1 ${isMobileMode ? 'py-2' : 'py-1'} rounded border flex items-center justify-center hover:brightness-110`}
                                style={{ backgroundColor: colors.knobBase, borderColor: colors.moduleBorder, color: colors.labelTextDefault, minHeight: isMobileMode ? MIN_TOUCH_TARGET : undefined }}
                            >
                                <Save size={isMobileMode ? 14 : 12} />
                            </button>
                            <label
                                title="Load Preset"
                                className={`flex-1 ${isMobileMode ? 'py-2' : 'py-1'} rounded border flex items-center justify-center cursor-pointer hover:brightness-110`}
                                style={{ backgroundColor: colors.knobBase, borderColor: colors.moduleBorder, color: colors.labelTextDefault, minHeight: isMobileMode ? MIN_TOUCH_TARGET : undefined }}
                            >
                                <Upload size={isMobileMode ? 14 : 12} />
                                <input type="file" accept=".json" onChange={handleLoadPresetFile} className="hidden" />
                            </label>
                        </div>
                    </div>

                    <div className="w-full border-t pt-2 mt-auto" style={{ borderColor: colors.moduleBorder }}>
                        <button className="w-full text-center text-[10px] font-bold rounded-full px-2 py-0.5 border"
                            style={{ 
                                backgroundColor: colors.labelGold,
                                color: colors.labelTextGold,
                                borderColor: theme === 'dark' ? '#8f7b45' : '#eab308'
                            }}
                        >
                            NodeGrain
                        </button>
                    </div>
                </div>

                {/* Drift Controls Panel */}
                {isDrifting && (
                <div
                    className="border rounded-sm p-1 relative shrink-0 transition-colors duration-300"
                    style={{ backgroundColor: colors.moduleBg, borderColor: colors.moduleBorder }}
                >
                    <div
                        className="absolute top-0 left-0 w-full text-[10px] font-bold px-2 py-[2px] transition-colors duration-300"
                        style={{ backgroundColor: '#22d3ee', color: '#000' }}
                    >DRIFT</div>
                    <div className="pt-6 px-1 flex flex-col gap-3">
                        <Knob
                            label="Speed"
                            value={driftSpeed}
                            onChange={(val) => {
                                setDriftSpeed(val);
                                engineRef.current?.setDriftSpeed(val);
                            }}
                            min={0} max={1}
                            step={0.01}
                            colors={colors}
                            defaultValue={0.5}
                        />
                        <Knob
                            label="Return"
                            value={driftReturnTendency}
                            onChange={(val) => {
                                setDriftReturnTendency(val);
                                engineRef.current?.setDriftReturnTendency(val);
                            }}
                            min={0} max={1}
                            step={0.01}
                            colors={colors}
                            defaultValue={0.5}
                        />
                    </div>
                </div>
                )}

                {/* Panel 1: Grain */}
                <div 
                    className="border rounded-sm p-1 relative shrink-0 transition-colors duration-300"
                    style={{ backgroundColor: colors.moduleBg, borderColor: colors.moduleBorder }}
                >
                    <div 
                        className="absolute top-0 left-0 w-full text-[10px] font-bold px-2 py-[2px] transition-colors duration-300"
                        style={{ backgroundColor: colors.labelDefault, color: colors.labelTextDefault }}
                    >GRAIN</div>
                    <div className="pt-6 px-1 grid grid-cols-3 gap-x-2 gap-y-3">
                        <Knob
                            label="File Pos"
                            value={params.position}
                            modulatedValue={getModulatedValue('position', params.position, 0, 1)}
                            min={0} max={1}
                            {...createKnobHandlers('position')}
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('position')}
                            onToggleTarget={() => toggleLfoTarget('position')}
                            colors={colors}
                            disabled={isFrozen}
                            defaultValue={DEFAULT_PARAMS.position}
                        />
                        <Knob
                            label="Spray"
                            value={params.spread}
                            modulatedValue={getModulatedValue('spread', params.spread, 0, 2)}
                            min={0} max={2}
                            {...createKnobHandlers('spread')}
                            unit="s"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('spread')}
                            onToggleTarget={() => toggleLfoTarget('spread')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.spread}
                        />
                            <Knob
                            label="Size"
                            value={params.grainSize}
                            modulatedValue={getModulatedValue('grainSize', params.grainSize, 0.01, 0.5)}
                            min={0.01} max={0.5}
                            {...createKnobHandlers('grainSize')}
                            unit="s"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('grainSize')}
                            onToggleTarget={() => toggleLfoTarget('grainSize')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.grainSize}
                        />
                        <Knob
                            label="Density"
                            value={params.density}
                            modulatedValue={getModulatedValue('density', params.density, 0.01, 0.2)}
                            min={0.01} max={0.2}
                            {...createKnobHandlers('density')}
                            unit="Hz"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('density')}
                            onToggleTarget={() => toggleLfoTarget('density')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.density}
                        />
                        <Knob
                            label="Pan"
                            value={params.pan}
                            modulatedValue={getModulatedValue('pan', params.pan, -1, 1)}
                            min={-1} max={1}
                            {...createKnobHandlers('pan')}
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('pan')}
                            onToggleTarget={() => toggleLfoTarget('pan')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.pan}
                        />
                         <Knob
                            label="Pan Spr"
                            value={params.panSpread}
                            modulatedValue={getModulatedValue('panSpread', params.panSpread, 0, 1)}
                            min={0} max={1}
                            {...createKnobHandlers('panSpread')}
                            unit="%"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('panSpread')}
                            onToggleTarget={() => toggleLfoTarget('panSpread')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.panSpread}
                        />
                        <Knob
                            label="Reverse"
                            value={params.grainReversalChance}
                            modulatedValue={getModulatedValue('grainReversalChance', params.grainReversalChance, 0, 1)}
                            min={0} max={1}
                            {...createKnobHandlers('grainReversalChance')}
                            unit="%"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('grainReversalChance')}
                            onToggleTarget={() => toggleLfoTarget('grainReversalChance')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.grainReversalChance}
                        />
                    </div>
                </div>

                {/* Panel 2: Pitch/FM */}
                <div 
                    className="border rounded-sm p-1 relative shrink-0 transition-colors duration-300"
                    style={{ backgroundColor: colors.moduleBg, borderColor: colors.moduleBorder }}
                >
                        <div 
                            className="absolute top-0 left-0 w-full text-[10px] font-bold px-2 py-[2px] transition-colors duration-300"
                            style={{ backgroundColor: colors.labelGold, color: colors.labelTextGold }}
                        >FM / PITCH</div>
                        <div className="pt-6 px-1 grid grid-cols-2 gap-x-2 gap-y-3">
                        <div className="flex flex-col items-center">
                        <Knob
                            label="Pitch"
                            value={params.pitch}
                            modulatedValue={getModulatedValue('pitch', params.pitch, -24, 24)}
                            min={-24} max={24}
                            step={1}
                            integer
                            onChange={handlePitchChange}
                            onDragStart={handleKnobDragStart}
                            onDragEnd={(val) => {
                                const finalParams = { ...params, pitch: val };
                                handleKnobDragEnd(finalParams);
                            }}
                            onReset={handlePitchReset}
                            unit="st"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('pitch')}
                            onToggleTarget={() => toggleLfoTarget('pitch')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.pitch}
                        />
                        {isHarmonicLockEnabled && (
                            <span className="text-[9px] font-mono text-green-400 mt-1">
                                {scaleType === 'major' && 'IONIAN'}
                                {scaleType === 'minor' && 'AEOLIAN'}
                                {scaleType === 'pentaMajor' && 'PENTA MAJ'}
                                {scaleType === 'pentaMinor' && 'PENTA MIN'}
                                {scaleType === 'chromatic' && 'CHROMATIC'}
                            </span>
                        )}
                        </div>
                        <Knob
                            label="FM Freq"
                            value={params.fmFreq}
                            modulatedValue={getModulatedValue('fmFreq', params.fmFreq, 0, 500)}
                            min={0} max={500}
                            integer
                            {...createKnobHandlers('fmFreq')}
                            unit="Hz"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('fmFreq')}
                            onToggleTarget={() => toggleLfoTarget('fmFreq')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.fmFreq}
                        />
                        <Knob
                            label="FM Amt"
                            value={params.fmAmount}
                            modulatedValue={getModulatedValue('fmAmount', params.fmAmount, 0, 100)}
                            min={0} max={100}
                            {...createKnobHandlers('fmAmount')}
                            unit="%"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('fmAmount')}
                            onToggleTarget={() => toggleLfoTarget('fmAmount')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.fmAmount}
                        />
                        </div>

                        {/* Harmonic Lock Controls */}
                        <div className="mt-2 pt-2 border-t flex flex-col gap-1.5" style={{ borderColor: colors.moduleBorder }}>
                            <button
                                onClick={() => setIsHarmonicLockEnabled(!isHarmonicLockEnabled)}
                                className={`w-full py-1 px-2 rounded border flex items-center justify-center gap-1.5 text-[10px] font-semibold transition-all
                                    ${isHarmonicLockEnabled ? 'ring-1 ring-green-400' : ''}`}
                                style={{
                                    backgroundColor: isHarmonicLockEnabled ? '#4ade80' : colors.knobBase,
                                    borderColor: colors.moduleBorder,
                                    color: isHarmonicLockEnabled ? '#000' : colors.labelTextDefault
                                }}
                            >
                                <Music size={11}/>
                                {isHarmonicLockEnabled ? 'HARMONIC LOCK ON' : 'HARMONIC LOCK'}
                            </button>
                            {isHarmonicLockEnabled && (
                                <select
                                    value={scaleType}
                                    onChange={(e) => setScaleType(e.target.value as ScaleType)}
                                    className="w-full py-1 px-2 text-[10px] font-semibold border rounded cursor-pointer focus:outline-none focus:ring-1 focus:ring-green-400/50"
                                    style={{
                                        backgroundColor: theme === 'dark' ? '#1a1a1a' : '#ffffff',
                                        borderColor: colors.moduleBorder,
                                        color: theme === 'dark' ? '#ffffff' : '#000000'
                                    }}
                                >
                                    <option value="chromatic">Chromatic</option>
                                    <option value="major">Major (Ionian)</option>
                                    <option value="minor">Minor (Aeolian)</option>
                                    <option value="pentaMajor">Pentatonic Major</option>
                                    <option value="pentaMinor">Pentatonic Minor</option>
                                </select>
                            )}
                        </div>
                </div>

                {/* Panel 3: Envelope */}
                <div 
                    className="border rounded-sm p-1 relative shrink-0 flex flex-col items-center transition-colors duration-300"
                    style={{ backgroundColor: colors.moduleBg, borderColor: colors.moduleBorder }}
                >
                    <div 
                        className="absolute top-0 left-0 w-full text-[10px] font-bold px-2 py-[2px] transition-colors duration-300"
                        style={{ backgroundColor: colors.labelDefault, color: colors.labelTextDefault }}
                    >AMP ENV</div>
                    <div className="pt-6 px-2 flex flex-col gap-3 h-full">
                            <div className="grid grid-cols-2 gap-2">
                            <Knob
                                label="Attack"
                                value={params.attack}
                                min={0.01} max={0.9}
                                {...createKnobHandlers('attack')}
                                unit="s"
                                isMapping={isMappingMode}
                                isTargeted={params.lfoTargets.includes('attack')}
                                onToggleTarget={() => toggleLfoTarget('attack')}
                                colors={colors}
                                defaultValue={DEFAULT_PARAMS.attack}
                            />
                            <Knob
                                label="Release"
                                value={params.release}
                                min={0.01} max={0.9}
                                {...createKnobHandlers('release')}
                                unit="s"
                                isMapping={isMappingMode}
                                isTargeted={params.lfoTargets.includes('release')}
                                onToggleTarget={() => toggleLfoTarget('release')}
                                colors={colors}
                                defaultValue={DEFAULT_PARAMS.release}
                            />
                            </div>
                            {/* Curve Selector */}
                            <div 
                                className="flex gap-1 p-[2px] rounded border w-full justify-center mt-auto mb-1 transition-colors duration-300"
                                style={{ backgroundColor: colors.knobValueBg, borderColor: colors.moduleBorder }}
                            >
                            <button 
                                className={`text-[9px] flex-1 py-1 rounded-sm font-bold transition-colors ${params.envelopeCurve === 'linear' ? 'bg-orange-500 text-black' : (colors.knobLabel + ' hover:opacity-100')}`}
                                onClick={() => handleParamChange('envelopeCurve', 'linear')}
                            >LIN</button>
                            <button 
                                className={`text-[9px] flex-1 py-0.5 rounded-sm font-bold transition-colors ${params.envelopeCurve === 'exponential' ? 'bg-orange-500 text-black' : (colors.knobLabel + ' hover:opacity-100')}`}
                                onClick={() => handleParamChange('envelopeCurve', 'exponential')}
                            >EXP</button>
                            </div>
                    </div>
                </div>
                
                {/* Panel 4: LFO / MOD */}
                <div 
                    className="border rounded-sm p-1 relative shrink-0 w-[152px] transition-colors duration-300"
                    style={{ backgroundColor: colors.moduleBg, borderColor: colors.moduleBorder }}
                >
                    <div 
                        className="absolute top-0 left-0 w-full text-[10px] font-bold px-2 py-[2px] transition-colors duration-300"
                        style={{ backgroundColor: colors.labelDefault, color: colors.labelTextDefault }}
                    >LFO / MOD</div>
                    <div className="pt-6 px-1 flex flex-col h-full gap-2">
                        {/* Knobs */}
                        <div className="grid grid-cols-2 gap-2">
                            <Knob
                                label="Rate"
                                value={params.lfoRate}
                                min={0.1} max={20}
                                {...createKnobHandlers('lfoRate')}
                                unit="Hz"
                                colors={colors}
                                defaultValue={DEFAULT_PARAMS.lfoRate}
                            />
                            <Knob
                                label="Depth"
                                value={params.lfoAmount}
                                min={0} max={1}
                                {...createKnobHandlers('lfoAmount')}
                                unit="%"
                                colors={colors}
                                defaultValue={DEFAULT_PARAMS.lfoAmount}
                            />
                        </div>
                        
                        {/* Control Box */}
                        <div className="flex flex-col w-full gap-2 mt-auto mb-1">
                            {/* Shape Selector */}
                            <div 
                                className="flex gap-0.5 p-0.5 rounded border w-full justify-center transition-colors duration-300"
                                style={{ backgroundColor: colors.knobValueBg, borderColor: colors.moduleBorder }}
                            >
                                {(['sine', 'triangle', 'square', 'sawtooth'] as LfoShape[]).map(shape => (
                                    <button 
                                        key={shape}
                                        title={shape}
                                        className={`flex-1 h-4 flex items-center justify-center rounded-sm transition-colors ${params.lfoShape === shape ? 'bg-orange-500 text-black' : (colors.knobLabel + ' hover:opacity-100')}`}
                                        onClick={() => handleParamChange('lfoShape', shape)}
                                    >
                                        {shape === 'sine' && <svg width="12" height="12" viewBox="0 0 10 10"><path d="M0 5 Q 2.5 0 5 5 Q 7.5 10 10 5" stroke="currentColor" fill="none" strokeWidth="1.5"/></svg>}
                                        {shape === 'triangle' && <svg width="12" height="12" viewBox="0 0 10 10"><path d="M0 8 L 5 2 L 10 8" stroke="currentColor" fill="none" strokeWidth="1.5"/></svg>}
                                        {shape === 'square' && <svg width="12" height="12" viewBox="0 0 10 10"><path d="M0 8 L 0 2 L 5 2 L 5 8 L 10 8 L 10 2" stroke="currentColor" fill="none" strokeWidth="1.5"/></svg>}
                                        {shape === 'sawtooth' && <svg width="12" height="12" viewBox="0 0 10 10"><path d="M0 8 L 10 2 L 10 8" stroke="currentColor" fill="none" strokeWidth="1.5"/></svg>}
                                    </button>
                                ))}
                            </div>
                            
                            {/* Tools */}
                            <div className="flex gap-1">
                                <button 
                                    onClick={() => setIsMappingMode(!isMappingMode)}
                                    className={`flex-1 py-1 rounded font-bold text-[9px] uppercase tracking-wider flex items-center justify-center gap-1 border shadow-sm transition-all
                                        ${isMappingMode
                                            ? 'bg-green-500 border-green-600 text-black' 
                                            : (theme === 'dark' ? 'bg-[#444] border-neutral-600 text-neutral-300 hover:bg-[#555]' : 'bg-[#e4e4e7] border-neutral-300 text-neutral-600 hover:bg-[#f4f4f5]')
                                        }`}
                                >
                                    <Network size={10}/>
                                    MAP
                                </button>
                                <button 
                                    onClick={handleLfoRandomize}
                                    title="Randomize"
                                    className={`w-6 py-1 rounded flex items-center justify-center border transition-colors ${theme === 'dark' ? 'bg-[#444] hover:bg-[#555] text-neutral-300 border-neutral-600' : 'bg-[#e4e4e7] hover:bg-[#f4f4f5] text-neutral-600 border-neutral-300'}`}
                                >
                                    <Dices size={12}/>
                                </button>
                                <button 
                                    onClick={handleLfoReset}
                                    title="Reset"
                                    className={`w-6 py-1 rounded flex items-center justify-center border transition-colors ${theme === 'dark' ? 'bg-[#444] hover:bg-[#555] text-neutral-300 border-neutral-600' : 'bg-[#e4e4e7] hover:bg-[#f4f4f5] text-neutral-600 border-neutral-300'}`}
                                >
                                    <X size={12}/>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Panel 5: Output / FX */}
                <div 
                    className="border rounded-sm p-1 relative shrink-0 transition-colors duration-300"
                    style={{ backgroundColor: colors.moduleBg, borderColor: colors.moduleBorder }}
                >
                    <div 
                        className="absolute top-0 left-0 w-full text-[10px] font-bold px-2 py-[2px] transition-colors duration-300"
                        style={{ backgroundColor: colors.labelGold, color: colors.labelTextGold }}
                    >FILTER / FX</div>
                    <div className="pt-6 px-1 grid grid-cols-3 gap-x-2 gap-y-3">
                        {/* Row 1: Filter & Drive */}
                        <Knob
                            label="Cutoff"
                            value={params.filterFreq}
                            modulatedValue={getModulatedValue('filterFreq', params.filterFreq, 100, 20000)}
                            min={100} max={20000}
                            integer
                            {...createKnobHandlers('filterFreq')}
                            unit="Hz"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('filterFreq')}
                            onToggleTarget={() => toggleLfoTarget('filterFreq')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.filterFreq}
                        />
                        <Knob
                            label="Res"
                            value={params.filterRes}
                            modulatedValue={getModulatedValue('filterRes', params.filterRes, 0, 20)}
                            min={0} max={20}
                            {...createKnobHandlers('filterRes')}
                            unit="dB"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('filterRes')}
                            onToggleTarget={() => toggleLfoTarget('filterRes')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.filterRes}
                        />
                        <Knob
                            label="Drive"
                            value={params.distAmount}
                            modulatedValue={getModulatedValue('distAmount', params.distAmount, 0, 1)}
                            min={0} max={1}
                            {...createKnobHandlers('distAmount')}
                            unit="%"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('distAmount')}
                            onToggleTarget={() => toggleLfoTarget('distAmount')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.distAmount}
                        />

                        {/* Row 2: Delay */}
                        <Knob
                            label="Dly Time"
                            value={params.delayTime}
                            modulatedValue={getModulatedValue('delayTime', params.delayTime, 0, 1)}
                            min={0} max={1}
                            {...createKnobHandlers('delayTime')}
                            unit="s"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('delayTime')}
                            onToggleTarget={() => toggleLfoTarget('delayTime')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.delayTime}
                        />
                        <Knob
                            label="Dly Fdbk"
                            value={params.delayFeedback}
                            modulatedValue={getModulatedValue('delayFeedback', params.delayFeedback, 0, 0.95)}
                            min={0} max={0.95}
                            {...createKnobHandlers('delayFeedback')}
                            unit="%"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('delayFeedback')}
                            onToggleTarget={() => toggleLfoTarget('delayFeedback')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.delayFeedback}
                        />
                         <Knob
                            label="Dly Mix"
                            value={params.delayMix}
                            modulatedValue={getModulatedValue('delayMix', params.delayMix, 0, 1)}
                            min={0} max={1}
                            {...createKnobHandlers('delayMix')}
                            unit="%"
                            isMapping={isMappingMode}
                            isTargeted={params.lfoTargets.includes('delayMix')}
                            onToggleTarget={() => toggleLfoTarget('delayMix')}
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.delayMix}
                        />

                        {/* Row 3: Reverb & Master */}
                        <Knob
                            label="Rev Time"
                            value={params.reverbDecay}
                            min={0.1} max={4.0}
                            {...createKnobHandlers('reverbDecay')}
                            unit="s"
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.reverbDecay}
                        />
                        <Knob
                            label="Rev Mix"
                            value={params.reverbMix}
                            min={0} max={1}
                            {...createKnobHandlers('reverbMix')}
                            unit="%"
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.reverbMix}
                        />
                        <Knob
                            label="Volume"
                            value={params.volume}
                            min={0} max={1}
                            {...createKnobHandlers('volume')}
                            unit="dB"
                            colors={colors}
                            defaultValue={DEFAULT_PARAMS.volume}
                        />
                    </div>
                </div>
            </div>

        </div>
    </div>

    {/* Help Modal */}
    {showHelp && (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: theme === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)' }}
            onClick={() => setShowHelp(false)}
        >
            <div
                className="max-w-3xl max-h-[80vh] overflow-hidden rounded-lg shadow-2xl"
                style={{ backgroundColor: colors.panelInner, borderColor: colors.rackBorder, border: '1px solid' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b" style={{ borderColor: colors.moduleBorder }}>
                    <h2 className={`text-lg font-bold ${colors.headerText}`}>NodeGrain Help</h2>
                    <button
                        onClick={() => setShowHelp(false)}
                        className={`p-1 rounded hover:brightness-110 ${colors.headerText}`}
                        style={{ backgroundColor: colors.knobBase, border: `1px solid ${colors.moduleBorder}` }}
                    >
                        <X size={20}/>
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 overflow-y-auto max-h-[60vh]" style={{ fontSize: '12px', lineHeight: '1.6', color: colors.labelTextDefault }}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                        {/* TRANSPORT & GLOBAL */}
                        <div>
                            <h3 className="font-bold mb-2 uppercase tracking-wider text-xs" style={{ color: colors.labelGold }}>Transport & Global</h3>
                            <ul className="space-y-1">
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>PLAY/HOLD</strong> - Start/stop granular synthesis</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>LOAD WAV</strong> - Load audio sample file</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>RANDOMIZE</strong> - Randomize all parameters</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>FREEZE</strong> - Lock grain position for ambient textures</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>DRIFT</strong> - Enable random walk position drift</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Texture Profile</strong> - Select musical randomization style</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Preset</strong> - Select factory preset</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>XY</strong> - Toggle 2D pad control mode</li>
                            </ul>
                        </div>

                        {/* GRAIN PANEL */}
                        <div>
                            <h3 className="font-bold mb-2 uppercase tracking-wider text-xs" style={{ color: colors.labelGold }}>GRAIN Panel</h3>
                            <ul className="space-y-1">
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>File Pos</strong> - Sample position (0-100%)</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Spray</strong> - Random position offset width</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Size</strong> - Grain duration in seconds</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Density</strong> - Grains per second (lower = more sparse)</li>
                            </ul>
                        </div>

                        {/* FM/PITCH PANEL */}
                        <div>
                            <h3 className="font-bold mb-2 uppercase tracking-wider text-xs" style={{ color: colors.labelGold }}>FM / PITCH Panel</h3>
                            <ul className="space-y-1">
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Pitch</strong> - Transposition in semitones (-24 to +24)</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>FM Freq</strong> - Frequency modulation rate</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>FM Amt</strong> - Frequency modulation depth</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Harmonic Lock</strong> - Snap pitch to musical scale</li>
                            </ul>
                        </div>

                        {/* AMP ENV PANEL */}
                        <div>
                            <h3 className="font-bold mb-2 uppercase tracking-wider text-xs" style={{ color: colors.labelGold }}>AMP ENV Panel</h3>
                            <ul className="space-y-1">
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Attack</strong> - Grain attack time (fade in)</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Release</strong> - Grain release time (fade out)</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Curve</strong> - Linear or exponential envelope shape</li>
                            </ul>
                        </div>

                        {/* LFO/MOD PANEL */}
                        <div>
                            <h3 className="font-bold mb-2 uppercase tracking-wider text-xs" style={{ color: colors.labelGold }}>LFO / MOD Panel</h3>
                            <ul className="space-y-1">
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Rate</strong> - LFO speed (Hz)</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Depth</strong> - LFO modulation amount</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Wave</strong> - LFO waveform (sine, triangle, square, saw)</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Mapping Mode</strong> - Click knobs to add LFO targets</li>
                            </ul>
                        </div>

                        {/* FILTER/FX PANEL */}
                        <div>
                            <h3 className="font-bold mb-2 uppercase tracking-wider text-xs" style={{ color: colors.labelGold }}>FILTER / FX Panel</h3>
                            <ul className="space-y-1">
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Filter Freq</strong> - Lowpass filter cutoff</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Res</strong> - Filter resonance</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Dist</strong> - Distortion amount</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Delay Time/Mix/Feed</strong> - Delay effect</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Reverb Mix/Decay</strong> - Reverb effect</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Volume</strong> - Master output level</li>
                            </ul>
                        </div>

                        {/* XY PAD */}
                        <div>
                            <h3 className="font-bold mb-2 uppercase tracking-wider text-xs" style={{ color: colors.labelGold }}>XY Pad Mode</h3>
                            <ul className="space-y-1">
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Click XY button</strong> - Enable 2D pad mode</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>X axis</strong> - Controls grain position</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Y axis</strong> - Select Pitch/Density/Grain Size</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Drag</strong> - Control both parameters simultaneously</li>
                            </ul>
                        </div>

                        {/* DRIFT CONTROLS */}
                        <div>
                            <h3 className="font-bold mb-2 uppercase tracking-wider text-xs" style={{ color: colors.labelGold }}>Drift Controls</h3>
                            <ul className="space-y-1">
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Speed</strong> - How fast position wanders</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Return</strong> - Tendency to return to start position</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>Low return</strong> - Wanders freely across sample</li>
                                <li><strong style={{ color: theme === 'dark' ? '#fb923c' : '#ea580c' }}>High return</strong> - Stays near starting point</li>
                            </ul>
                        </div>

                    </div>

                    {/* Texture Profiles */}
                    <div className="mt-6 pt-4 border-t" style={{ borderColor: colors.moduleBorder }}>
                        <h3 className="font-bold mb-2 uppercase tracking-wider text-xs" style={{ color: colors.labelGold }}>Texture Profiles</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            <div><strong style={{ color: theme === 'dark' ? '#22d3ee' : '#0891b2' }}>Cloudy</strong> - Ambient clouds, lush reverb</div>
                            <div><strong style={{ color: theme === 'dark' ? '#22d3ee' : '#0891b2' }}>Glitch</strong> - Digital artifacts, tiny grains</div>
                            <div><strong style={{ color: theme === 'dark' ? '#22d3ee' : '#0891b2' }}>Drone</strong> - Dark, slow, sustained</div>
                            <div><strong style={{ color: theme === 'dark' ? '#22d3ee' : '#0891b2' }}>Shimmer</strong> - Bright, ethereal, delay-heavy</div>
                            <div><strong style={{ color: theme === 'dark' ? '#22d3ee' : '#0891b2' }}>Rhythmic</strong> - Patterned, steady</div>
                            <div><strong style={{ color: theme === 'dark' ? '#22d3ee' : '#0891b2' }}>Crystalline</strong> - Sparkly, high-pitched</div>
                        </div>
                    </div>

                    {/* Keyboard Shortcuts */}
                    <div className="mt-4 pt-4 border-t" style={{ borderColor: colors.moduleBorder }}>
                        <h3 className="font-bold mb-2 uppercase tracking-wider text-xs" style={{ color: colors.labelGold }}>Tips</h3>
                        <ul className="space-y-1">
                            <li>• Drag knobs vertically to adjust values</li>
                            <li>• Use Mapping Mode (LFO/MOD panel) to modulate parameters with LFO</li>
                            <li>• Freeze + Drift creates evolving ambient textures</li>
                            <li>• Harmonic Lock keeps pitches musical</li>
                            <li>• Click waveform to seek position directly</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    )}
    </div>
  );
};