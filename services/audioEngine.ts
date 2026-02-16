import { GranularParams } from '../types';
import { IAudioEngine, GrainEvent } from './IAudioEngine';

export type { GrainEvent };

export class AudioEngine implements IAudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private isPlaying: boolean = false;
  private schedulerId: number | null = null;
  
  // Nodes
  private masterGain: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private analyser: AnalyserNode | null = null;

  // FX Nodes
  private distNode: WaveShaperNode | null = null;

  private delayNode: DelayNode | null = null;
  private delayFeedbackNode: GainNode | null = null;
  private delayDryGain: GainNode | null = null;
  private delayWetGain: GainNode | null = null;

  private reverbDryGain: GainNode | null = null;
  private reverbWetGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;

  // Intermediate routing nodes
  private preDelayNode: GainNode | null = null;
  private preReverbNode: GainNode | null = null;

  // FX Bypass states (track previous values to detect changes)
  private lastDelayMix: number = -1;
  private lastReverbMix: number = -1;

  private params: GranularParams;
  private nextGrainTime: number = 0;
  private lastReverbDecay: number = 0;
  
  // Visualization
  private grainQueue: GrainEvent[] = [];

  // Performance: Reusable analyzer arrays (zero-allocation)
  private frequencyDataArray: Uint8Array | null = null;
  private timeDataArray: Float32Array | null = null;

  // Performance: Distortion curve cache
  private distortionCurveCache: Map<number, Float32Array> = new Map();
  private static readonly MAX_DISTORTION_CACHE = 20;

  // Recording
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording: boolean = false;
  private destinationStream: MediaStream | null = null;

  // Grain Freeze
  private isFrozen: boolean = false;
  private frozenPosition: number = 0;

  // Auto-Drift (Random Walk)
  private isDrifting: boolean = false;
  private driftPosition: number = 0.5;
  private driftBasePosition: number = 0.5;
  private driftSpeed: number = 0.5; // 0-1
  private driftReturnTendency: number = 0.3; // 0-1, how much it wants to return to base
  private driftTime: number = 0;

  constructor(initialParams: GranularParams) {
    this.params = initialParams;
  }

  async init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Initialize Nodes
      this.masterGain = this.ctx.createGain();
      this.filterNode = this.ctx.createBiquadFilter();
      this.analyser = this.ctx.createAnalyser();
      this.distNode = this.ctx.createWaveShaper();

      // Analyser setup
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;

      // Initialize reusable analyzer arrays (zero-allocation for getFrequencyData/getTimeData)
      const fftSize = this.analyser.frequencyBinCount;
      this.frequencyDataArray = new Uint8Array(fftSize);
      this.timeDataArray = new Float32Array(fftSize);
      
      this.delayNode = this.ctx.createDelay(5.0);
      this.delayFeedbackNode = this.ctx.createGain();
      this.delayDryGain = this.ctx.createGain();
      this.delayWetGain = this.ctx.createGain();

      this.reverbDryGain = this.ctx.createGain();
      this.reverbWetGain = this.ctx.createGain();
      this.convolver = this.ctx.createConvolver();
      
      // Filter setup
      this.filterNode.type = 'lowpass';
      
      // Distortion setup
      this.distNode.curve = this.makeDistortionCurve(0);
      this.distNode.oversample = '4x';

      // Routing Graph (with dynamic bypass):
      // GrainSource -> Env -> Panner -> Filter -> [Distortion] -> [Delay] -> [Reverb] -> Master
      // Effects in [] can be bypassed when dry

      // Create intermediate routing nodes
      this.preDelayNode = this.ctx.createGain();
      this.preReverbNode = this.ctx.createGain();

      // 1. Filter -> Distortion -> preDelayNode
      this.filterNode.connect(this.distNode);
      this.distNode.connect(this.preDelayNode);

      // 2. Delay Section (connected to preDelayNode)
      this.preDelayNode.connect(this.delayDryGain);
      this.preDelayNode.connect(this.delayNode);

      this.delayNode.connect(this.delayFeedbackNode);
      this.delayFeedbackNode.connect(this.delayNode); // Feedback Loop
      this.delayNode.connect(this.delayWetGain);

      // 3. Delay Output -> preReverbNode
      this.delayDryGain.connect(this.preReverbNode);
      this.delayWetGain.connect(this.preReverbNode);

      // 4. Reverb Section (connected to preReverbNode)
      this.preReverbNode.connect(this.reverbDryGain);
      this.preReverbNode.connect(this.convolver);
      this.convolver.connect(this.reverbWetGain);

      // 5. To Master
      this.reverbDryGain.connect(this.masterGain);
      this.reverbWetGain.connect(this.masterGain);

      // Connect analyser for visualization
      this.masterGain.connect(this.analyser);

      this.masterGain.connect(this.ctx.destination);
      
      this.updateParams(this.params);
      
      // Initialize reverb buffer
      this.updateReverbImpulse();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  getCurrentTime(): number {
      return this.ctx ? this.ctx.currentTime : 0;
  }

  async loadSample(file: File): Promise<void> {
    await this.init();
    if (!this.ctx) return;

    const arrayBuffer = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arrayBuffer);
    // Reset position to start when loading new sample
    this.params = { ...this.params, position: 0 };
  }

  // Load a default noise/sine buffer if no file is present
  createTestBuffer() {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(2, sr * 5, sr); // 5 seconds
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const nowBuff = buffer.getChannelData(channel);
      for (let i = 0; i < buffer.length; i++) {
        // Simple synth pad sound
        nowBuff[i] = Math.sin(i * 0.01) * 0.5 + Math.random() * 0.1;
      }
    }
    this.buffer = buffer;
  }

  // Load audio from a Float32Array (for built-in samples)
  loadFromFloat32Data(data: Float32Array): void {
    if (!this.ctx) return;
    const buffer = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    buffer.copyToChannel(data, 0);
    this.buffer = buffer;
    // Reset position to start when loading new sample
    this.params = { ...this.params, position: 0 };
  }

  start() {
    if (this.isPlaying || !this.ctx) return;
    this.isPlaying = true;
    this.nextGrainTime = this.ctx.currentTime;

    // Restore gains that were zeroed on stop() with a short ramp to avoid clicks
    const t = this.ctx.currentTime;
    const rampUp = 0.02; // 20ms fade-in

    if (this.masterGain) {
      this.masterGain.gain.cancelScheduledValues(t);
      this.masterGain.gain.setValueAtTime(0, t);
      this.masterGain.gain.linearRampToValueAtTime(this.params.volume, t + rampUp);
    }
    if (this.delayFeedbackNode) {
      this.delayFeedbackNode.gain.cancelScheduledValues(t);
      this.delayFeedbackNode.gain.setValueAtTime(this.params.delayFeedback, t);
    }

    this.schedule();
  }

  stop() {
    this.isPlaying = false;
    if (this.schedulerId) {
      window.clearTimeout(this.schedulerId);
      this.schedulerId = null;
    }

    // Silence the audio graph: fast-ramp master gain to 0 and kill delay feedback
    if (this.ctx) {
      const t = this.ctx.currentTime;
      const fadeOut = 0.03; // 30ms fade-out

      if (this.masterGain) {
        this.masterGain.gain.cancelScheduledValues(t);
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t);
        this.masterGain.gain.linearRampToValueAtTime(0, t + fadeOut);
      }

      // Kill delay feedback loop so it doesn't ring indefinitely
      if (this.delayFeedbackNode) {
        this.delayFeedbackNode.gain.cancelScheduledValues(t);
        this.delayFeedbackNode.gain.setValueAtTime(0, t);
      }
    }
  }

  updateParams(newParams: GranularParams) {
    this.params = newParams;
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const ramp = 0.1;

    // Master
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.params.volume, t, ramp);
    }

    // Filter (Base value)
    if (this.filterNode && !this.params.lfoTargets.includes('filterFreq')) {
      this.filterNode.frequency.setTargetAtTime(this.params.filterFreq, t, ramp);
      this.filterNode.Q.setTargetAtTime(this.params.filterRes, t, ramp);
    }

    // Distortion
    if (this.distNode) {
        this.distNode.curve = this.makeDistortionCurve(this.params.distAmount);
    }

    // Delay Bypass - reconnect when mix changes to/from 0
    const delayBypassed = this.params.delayMix < 0.001;
    const wasDelayBypassed = this.lastDelayMix < 0.001;

    if (delayBypassed !== wasDelayBypassed && this.preDelayNode && this.preReverbNode) {
      if (delayBypassed) {
        // Bypass delay: connect preDelay directly to preReverb
        try {
          this.preDelayNode.disconnect(this.delayDryGain);
          this.preDelayNode.disconnect(this.delayNode);
        } catch (e) { /* ignore */ }
        this.preDelayNode.connect(this.preReverbNode);
      } else {
        // Enable delay: restore normal routing
        try {
          this.preDelayNode.disconnect(this.preReverbNode);
        } catch (e) { /* ignore */ }
        this.preDelayNode.connect(this.delayDryGain);
        this.preDelayNode.connect(this.delayNode);
      }
    }
    this.lastDelayMix = this.params.delayMix;

    // Delay parameters
    if (this.delayNode && this.delayFeedbackNode && this.delayDryGain && this.delayWetGain && !delayBypassed) {
        this.delayNode.delayTime.setTargetAtTime(this.params.delayTime, t, ramp);
        this.delayFeedbackNode.gain.setTargetAtTime(this.params.delayFeedback, t, ramp);
        this.delayDryGain.gain.setTargetAtTime(1 - this.params.delayMix, t, ramp);
        this.delayWetGain.gain.setTargetAtTime(this.params.delayMix, t, ramp);
    }

    // Reverb Bypass - reconnect when mix changes to/from 0
    const reverbBypassed = this.params.reverbMix < 0.001;
    const wasReverbBypassed = this.lastReverbMix < 0.001;

    if (reverbBypassed !== wasReverbBypassed && this.preReverbNode && this.masterGain) {
      if (reverbBypassed) {
        // Bypass reverb: connect preReverb directly to master
        try {
          this.preReverbNode.disconnect(this.reverbDryGain);
          this.preReverbNode.disconnect(this.convolver);
        } catch (e) { /* ignore */ }
        this.preReverbNode.connect(this.masterGain);
      } else {
        // Enable reverb: restore normal routing
        try {
          this.preReverbNode.disconnect(this.masterGain);
        } catch (e) { /* ignore */ }
        this.preReverbNode.connect(this.reverbDryGain);
        this.preReverbNode.connect(this.convolver);
      }
    }
    this.lastReverbMix = this.params.reverbMix;

    // Reverb parameters
    if (this.reverbDryGain && this.reverbWetGain && !reverbBypassed) {
        this.reverbDryGain.gain.setTargetAtTime(1 - this.params.reverbMix, t, ramp);
        this.reverbWetGain.gain.setTargetAtTime(this.params.reverbMix, t, ramp);
    }

    // Update Reverb Impulse (Only if decay changed significantly to save CPU)
    if (Math.abs(this.params.reverbDecay - this.lastReverbDecay) > 0.1) {
        this.updateReverbImpulse();
    }
  }

  pollGrainEvents(): GrainEvent[] {
      const events = [...this.grainQueue];
      this.grainQueue = [];
      return events;
  }

  getBufferDuration(): number {
      return this.buffer ? this.buffer.duration : 0;
  }

  getFrequencyData(): Uint8Array | null {
      if (!this.analyser || !this.frequencyDataArray) return null;
      this.analyser.getByteFrequencyData(this.frequencyDataArray);
      return this.frequencyDataArray;
  }

  getTimeData(): Float32Array | null {
      if (!this.analyser || !this.timeDataArray) return null;
      this.analyser.getFloatTimeDomainData(this.timeDataArray);
      return this.timeDataArray;
  }

  // Get output level (RMS) for VU meter (0-1 range)
  getOutputLevel(): number {
      if (!this.analyser || !this.timeDataArray) return 0;
      this.analyser.getFloatTimeDomainData(this.timeDataArray);

      // Calculate RMS (root mean square)
      let sum = 0;
      for (let i = 0; i < this.timeDataArray.length; i++) {
          sum += this.timeDataArray[i] * this.timeDataArray[i];
      }
      const rms = Math.sqrt(sum / this.timeDataArray.length);

      // Normalize to 0-1 range (approximate, RMS of 1.0 would be full scale)
      return Math.min(1, rms * 2);
  }

  private makeDistortionCurve(amount: number): Float32Array {
    // Round to 3 decimal places for cache key (precision enough for audio)
    const cacheKey = Math.round(amount * 1000) / 1000;

    // Check cache first
    const cached = this.distortionCurveCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Not in cache, create new curve
    const k = amount * 100;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;

    if (amount === 0) {
        for (let i = 0; i < n_samples; ++i) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = x;
        }
    } else {
        for (let i = 0; i < n_samples; ++i) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
    }

    // Cache the curve (remove oldest if cache full)
    if (this.distortionCurveCache.size >= AudioEngine.MAX_DISTORTION_CACHE) {
      const firstKey = this.distortionCurveCache.keys().next().value;
      this.distortionCurveCache.delete(firstKey);
    }
    this.distortionCurveCache.set(cacheKey, curve);

    return curve;
  }

  private updateReverbImpulse() {
      if (!this.ctx || !this.convolver) return;
      
      const duration = this.params.reverbDecay;
      this.lastReverbDecay = duration;
      
      const rate = this.ctx.sampleRate;
      const length = rate * duration;
      const impulse = this.ctx.createBuffer(2, length, rate);
      
      for (let c = 0; c < 2; c++) {
          const channelData = impulse.getChannelData(c);
          for (let i = 0; i < length; i++) {
              // Procedural Noise with Exponential Decay
              const decay = Math.pow(1 - i / length, 4); 
              channelData[i] = (Math.random() * 2 - 1) * decay;
          }
      }
      
      this.convolver.buffer = impulse;
  }

  private schedule() {
    if (!this.isPlaying || !this.ctx || !this.buffer) return;

    // Update drift position
    if (this.isDrifting && !this.isFrozen) {
        this.updateDrift(0.025); // ~25ms per schedule call
    }

    // Lookahead scheduling
    while (this.nextGrainTime < this.ctx.currentTime + 0.1) {
      this.playGrain(this.nextGrainTime);

      // Apply LFO to density if needed
      let density = this.params.density;
      if (this.params.lfoTargets.includes('density')) {
          // Calculate LFO specifically for density at this moment
          const lfoVal = this.getLfoValue(this.nextGrainTime);
          // Scale: +/- 0.1s
          density += lfoVal * this.params.lfoAmount * 0.1;
      }

      density = Math.max(0.005, density);
      this.nextGrainTime += density;
    }

    this.schedulerId = window.setTimeout(() => this.schedule(), 25);
  }

  private getLfoValue(time: number): number {
    const { lfoRate, lfoShape } = this.params;
    // Phase 0-1
    const phase = (time * lfoRate) % 1;
    
    switch (lfoShape) {
        case 'sine':
            return Math.sin(phase * Math.PI * 2);
        case 'square':
            return phase < 0.5 ? 1 : -1;
        case 'sawtooth':
            return phase * 2 - 1;
        case 'triangle':
            return Math.abs(phase * 4 - 2) - 1;
        default:
            return 0;
    }
  }

  private playGrain(time: number) {
    if (!this.ctx || !this.buffer || !this.filterNode) return;

    // 1. Calculate Modulated Parameters
    // We create a local copy of params with modulation applied
    const lfoVal = this.getLfoValue(time);
    const modAmt = this.params.lfoAmount;
    const targets = this.params.lfoTargets;

    // Helper to modulate
    const getMod = (key: string, base: number, scale: number, min?: number, max?: number) => {
        if (!targets.includes(key)) return base;
        let val = base + (lfoVal * modAmt * scale);
        if (min !== undefined) val = Math.max(min, val);
        if (max !== undefined) val = Math.min(max, val);
        return val;
    };

    const pitch = getMod('pitch', this.params.pitch, 24, -24, 24);
    const grainSize = getMod('grainSize', this.params.grainSize, 0.2, 0.01, 0.5);
    const spread = getMod('spread', this.params.spread, 1, 0, 2);
    // Priority: Frozen > Drift > Manual position
    const basePosition = this.isFrozen ? this.frozenPosition :
                          (this.isDrifting ? this.driftPosition : this.params.position);
    const position = getMod('position', basePosition, 0.5, 0, 1);
    const fmFreq = getMod('fmFreq', this.params.fmFreq, 200, 0, 1000);
    const fmAmount = getMod('fmAmount', this.params.fmAmount, 50, 0, 100);
    const filterFreq = getMod('filterFreq', this.params.filterFreq, 5000, 20, 20000);
    const filterRes = getMod('filterRes', this.params.filterRes, 10, 0, 20);
    const attack = getMod('attack', this.params.attack, 0.5, 0.01, 0.9);
    // Release is constrained by attack
    const release = getMod('release', this.params.release, 0.5, 0.01, 0.9);
    
    // Pan modulation
    const pan = getMod('pan', this.params.pan, 1, -1, 1);
    const panSpread = getMod('panSpread', this.params.panSpread, 1, 0, 1);

    // 2. Create Source
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;

    // 3. Pitch & FM
    const cents = pitch * 100 + (Math.random() * this.params.detune * 2 - this.params.detune);
    let rate = Math.pow(2, cents / 1200);

    // Grain Reversal: Random chance to play backwards
    let reverseGrain = Math.random() < this.params.grainReversalChance;
    if (reverseGrain) {
        rate = -Math.abs(rate);
    }

    const fmMod = fmAmount > 0
      ? Math.sin(time * fmFreq) * (fmAmount * 0.01)
      : 0;

    source.playbackRate.value = Math.max(0.1, Math.abs(rate + fmMod)) * (reverseGrain ? -1 : 1);

    // 4. Create Envelope & Panner
    const envelope = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    
    // Calculate random pan: Center + (Random * Spread)
    // Random is -1 to 1
    const randomPan = (Math.random() * 2 - 1) * panSpread;
    let finalPan = pan + randomPan;
    finalPan = Math.max(-1, Math.min(1, finalPan));
    
    panner.pan.setValueAtTime(finalPan, time);

    // 5. Connect Graph
    // source -> envelope -> panner -> filter
    source.connect(envelope);
    envelope.connect(panner);
    panner.connect(this.filterNode);

    // Set filter freq per grain
    this.filterNode.frequency.setValueAtTime(filterFreq, time);
    this.filterNode.Q.setValueAtTime(filterRes, time);

    // 6. Calculate Position
    const grainDuration = Math.max(0.01, grainSize);
    const bufferDuration = this.buffer.duration;
    const centerTime = position * bufferDuration;
    // Scale random offset by buffer duration so spread is relative to sample length
    // Increased sensitivity for more noticeable spray effect
    const randomOffset = (Math.random() * spread * 2 - spread) * bufferDuration * 0.5;
    let startTime = centerTime + randomOffset;
    
    if (startTime < 0) startTime = 0;
    if (startTime > bufferDuration - grainDuration) startTime = bufferDuration - grainDuration;

    // 7. Apply Envelope
    const attackTime = grainDuration * attack;
    const releaseTime = grainDuration * release;
    const sustainTime = Math.max(0, grainDuration - attackTime - releaseTime);

    const isExp = this.params.envelopeCurve === 'exponential';
    const minVal = 0.001;

    // Small fade-in to prevent clicks at grain boundaries
    const fadeTime = Math.max(0.001, grainDuration * 0.01);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(minVal, time + fadeTime);

    // Attack
    if (isExp) {
      envelope.gain.exponentialRampToValueAtTime(1, time + fadeTime + attackTime);
    } else {
      envelope.gain.linearRampToValueAtTime(1, time + fadeTime + attackTime);
    }
    
    // Sustain & Release
    const releaseStart = time + fadeTime + attackTime + sustainTime;
    envelope.gain.setValueAtTime(1, releaseStart);

    if (isExp) {
        envelope.gain.exponentialRampToValueAtTime(minVal, time + grainDuration);
        envelope.gain.linearRampToValueAtTime(0, time + grainDuration + 0.001);
    } else {
        envelope.gain.linearRampToValueAtTime(0, time + grainDuration);
    }

    // 8. Start/Stop
    source.start(time, startTime, grainDuration);

    // 9. Visualization Event
    if (bufferDuration > 0) {
        const normPos = startTime / bufferDuration;
        this.grainQueue.push({ normPos, duration: grainDuration, pan: finalPan });
    }
    
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      panner.disconnect();
    };
  }

  getAudioData(): Float32Array | null {
    if (!this.buffer) return null;
    return this.buffer.getChannelData(0);
  }
  
  getDuration(): number {
      return this.buffer ? this.buffer.duration : 0;
  }

  // Freeze the current position for ambient textures
  freeze() {
      if (!this.isFrozen) {
          this.isFrozen = true;
          this.frozenPosition = this.params.position;
      }
  }

  unfreeze() {
      this.isFrozen = false;
  }

  toggleFreeze() {
      if (this.isFrozen) {
          this.unfreeze();
      } else {
          this.freeze();
      }
  }

  isFrozenActive(): boolean {
      return this.isFrozen;
  }

  // Auto-Drift methods
  startDrift(basePosition: number) {
      this.isDrifting = true;
      this.driftBasePosition = basePosition;
      this.driftPosition = basePosition;
      this.driftTime = 0;
  }

  stopDrift() {
      this.isDrifting = false;
  }

  toggleDrift(basePosition: number) {
      if (this.isDrifting) {
          this.stopDrift();
      } else {
          this.startDrift(basePosition);
      }
  }

  isDriftActive(): boolean {
      return this.isDrifting;
  }

  setDriftSpeed(speed: number) {
      this.driftSpeed = Math.max(0, Math.min(1, speed));
  }

  setDriftReturnTendency(tendency: number) {
      this.driftReturnTendency = Math.max(0, Math.min(1, tendency));
  }

  getDriftPosition(): number {
      return this.driftPosition;
  }

  // Update drift position based on random walk
  updateDrift(deltaTime: number) {
      if (!this.isDrifting) return;

      this.driftTime += deltaTime;

      // Random walk step
      const stepSize = this.driftSpeed * deltaTime * 0.5;
      const randomStep = (Math.random() - 0.5) * 2 * stepSize;

      // Calculate pull back to base position
      const distanceFromBase = this.driftBasePosition - this.driftPosition;
      const returnForce = distanceFromBase * this.driftReturnTendency * deltaTime * 0.5;

      // Apply changes
      this.driftPosition += randomStep + returnForce;

      // Clamp to valid range
      this.driftPosition = Math.max(0, Math.min(1, this.driftPosition));
  }

  // Recording methods
  async startRecording(): Promise<void> {
      if (!this.ctx || !this.masterGain) return;

      // Create a MediaStreamDestinationNode to capture the audio
      const dest = this.ctx.createMediaStreamDestination();
      this.masterGain.connect(dest);

      this.destinationStream = dest.stream;
      this.recordedChunks = [];

      // Try to use WAV format, fallback to WebM
      const mimeTypes = [
          'audio/wav',
          'audio/wav;codecs=pcm',
          'audio/webm;codecs=pcm',
          'audio/webm'
      ];

      let selectedMimeType = '';
      for (const type of mimeTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
              selectedMimeType = type;
              break;
          }
      }

      this.mediaRecorder = new MediaRecorder(this.destinationStream, {
          mimeType: selectedMimeType
      });

      this.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
              this.recordedChunks.push(event.data);
          }
      };

      this.mediaRecorder.start();
      this.isRecording = true;
  }

  async stopRecording(): Promise<Blob | null> {
      if (!this.mediaRecorder || !this.isRecording) return null;

      return new Promise((resolve) => {
          this.mediaRecorder!.onstop = async () => {
              let blob: Blob;

              if (this.recordedChunks[0]?.type.includes('wav')) {
                  // Already WAV format
                  blob = new Blob(this.recordedChunks, { type: 'audio/wav' });
              } else {
                  // Convert WebM to WAV
                  const webmBlob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                  blob = await this.convertWebMToWav(webmBlob);
              }

              resolve(blob);
          };

          this.mediaRecorder!.stop();
          this.isRecording = false;

          // Clean up
          if (this.destinationStream) {
              this.destinationStream.getTracks().forEach(track => track.stop());
              this.destinationStream = null;
          }
      });
  }

  // Convert WebM Blob to WAV format
  private async convertWebMToWav(webmBlob: Blob): Promise<Blob> {
      // Decode the WebM audio data
      const arrayBuffer = await webmBlob.arrayBuffer();
      const audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer);

      // Create WAV file
      const wavBuffer = this.audioBufferToWav(audioBuffer);
      return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  // Convert AudioBuffer to WAV format (Float32 to Int16 PCM)
  private audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
      const numChannels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const format = 1; // PCM
      const bitDepth = 16;

      const bytesPerSample = bitDepth / 8;
      const blockAlign = numChannels * bytesPerSample;

      const data = [];
      for (let i = 0; i < buffer.numberOfChannels; i++) {
          data.push(buffer.getChannelData(i));
      }

      const interleaved = new Int16Array(data[0].length * numChannels);
      for (let i = 0; i < data[0].length; i++) {
          for (let channel = 0; channel < numChannels; channel++) {
              const sample = Math.max(-1, Math.min(1, data[channel][i]));
              interleaved[i * numChannels + channel] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          }
      }

      const wavBuffer = new ArrayBuffer(44 + interleaved.length * 2);
      const view = new DataView(wavBuffer);

      // RIFF chunk descriptor
      this.writeString(view, 0, 'RIFF');
      view.setUint32(4, 36 + interleaved.length * 2, true);
      this.writeString(view, 8, 'WAVE');

      // fmt sub-chunk
      this.writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
      view.setUint16(20, format, true); // AudioFormat (1 for PCM)
      view.setUint16(22, numChannels, true); // NumChannels
      view.setUint32(24, sampleRate, true); // SampleRate
      view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
      view.setUint16(32, blockAlign, true); // BlockAlign
      view.setUint16(34, bitDepth, true); // BitsPerSample

      // data sub-chunk
      this.writeString(view, 36, 'data');
      view.setUint32(40, interleaved.length * 2, true); // Subchunk2Size

      // Write audio data
      for (let i = 0; i < interleaved.length; i++) {
          view.setInt16(44 + i * 2, interleaved[i], true);
      }

      return wavBuffer;
  }

  private writeString(view: DataView, offset: number, string: string): void {
      for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
      }
  }

  isRecordingActive(): boolean {
      return this.isRecording;
  }

  getRecordingDuration(): number {
      // Recording duration is tracked by the UI component
      return 0;
  }
}