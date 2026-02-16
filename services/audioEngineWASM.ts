import { GranularParams } from '../types';
import { IAudioEngine, GrainEvent } from './IAudioEngine';

/**
 * WASM-based audio engine that runs grain synthesis in an AudioWorklet.
 *
 * Phase 1: Grain scheduling, envelope, LFO, mixing, panning run in C++/WASM.
 * Filter, distortion, delay, reverb remain as Web Audio nodes connected
 * after the AudioWorkletNode output.
 *
 * Signal chain:
 *   [AudioWorkletNode] → BiquadFilter → WaveShaper → Delay(+feedback)
 *     → Convolver(reverb) → MasterGain → Analyser → destination
 */
export class AudioEngineWASM implements IAudioEngine {
    private ctx: AudioContext | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private isReady: boolean = false;

    // Web Audio FX nodes (Phase 1: these stay outside the worklet)
    private filterNode: BiquadFilterNode | null = null;
    private distNode: WaveShaperNode | null = null;
    private delayNode: DelayNode | null = null;
    private delayFeedbackNode: GainNode | null = null;
    private delayDryGain: GainNode | null = null;
    private delayWetGain: GainNode | null = null;
    private reverbDryGain: GainNode | null = null;
    private reverbWetGain: GainNode | null = null;
    private convolver: ConvolverNode | null = null;
    private masterGain: GainNode | null = null;
    private analyser: AnalyserNode | null = null;

    private lastReverbDecay: number = 0;

    // Distortion curve cache (same as JS engine)
    private distortionCurveCache: Map<number, Float32Array> = new Map();
    private static readonly MAX_DISTORTION_CACHE = 20;

    // Visualization
    private grainQueue: GrainEvent[] = [];
    private frequencyDataArray: Uint8Array | null = null;
    private timeDataArray: Float32Array | null = null;

    // Recording
    private mediaRecorder: MediaRecorder | null = null;
    private recordedChunks: Blob[] = [];
    private isRecording: boolean = false;
    private destinationStream: MediaStream | null = null;

    // Sample data (cached for getAudioData)
    private sampleData: Float32Array | null = null;
    private sampleDuration: number = 0;

    // Freeze / Drift state (mirrored for queries)
    private frozen: boolean = false;
    private drifting: boolean = false;
    private driftPos: number = 0.5;
    private driftSpd: number = 0.5;
    private driftReturn: number = 0.3;

    private params: GranularParams;

    constructor(initialParams: GranularParams) {
        this.params = initialParams;
    }

    async init(): Promise<void> {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') {
                await this.ctx.resume();
            }
            return;
        }

        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

        // Compile WASM on the main thread (avoids worklet scope restrictions)
        const wasmResponse = await fetch('/wasm/grain_engine.wasm');
        if (!wasmResponse.ok) {
            throw new Error(`Failed to fetch WASM module: ${wasmResponse.status}`);
        }
        // Guard against Vite's SPA fallback returning HTML with 200 status
        const contentType = wasmResponse.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
            throw new Error('WASM binary not found (received HTML — run "npm run build:wasm" first)');
        }
        const wasmBytes = await wasmResponse.arrayBuffer();
        const compiledModule = await WebAssembly.compile(wasmBytes);

        // Load worklet processor
        await this.ctx.audioWorklet.addModule('/worklets/grain-processor.js');

        // Create worklet node with the pre-compiled WASM module
        this.workletNode = new AudioWorkletNode(this.ctx, 'grain-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: {
                wasmModule: compiledModule,
            }
        });

        // Listen for messages from the worklet
        this.workletNode.port.onmessage = (e: MessageEvent) => {
            const msg = e.data;
            switch (msg.type) {
                case 'ready':
                    this.isReady = true;
                    break;
                case 'grainEvents':
                    this.grainQueue.push(...msg.events);
                    break;
                case 'error':
                    console.error('[AudioEngineWASM] Worklet error:', msg.message);
                    break;
            }
        };

        // Create FX chain nodes
        this.filterNode = this.ctx.createBiquadFilter();
        this.filterNode.type = 'lowpass';

        this.distNode = this.ctx.createWaveShaper();
        this.distNode.curve = this.makeDistortionCurve(0);
        this.distNode.oversample = '4x';

        this.delayNode = this.ctx.createDelay(5.0);
        this.delayFeedbackNode = this.ctx.createGain();
        this.delayDryGain = this.ctx.createGain();
        this.delayWetGain = this.ctx.createGain();

        this.reverbDryGain = this.ctx.createGain();
        this.reverbWetGain = this.ctx.createGain();
        this.convolver = this.ctx.createConvolver();

        this.masterGain = this.ctx.createGain();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.8;

        const fftSize = this.analyser.frequencyBinCount;
        this.frequencyDataArray = new Uint8Array(fftSize);
        this.timeDataArray = new Float32Array(fftSize);

        // Routing Graph:
        // WorkletNode → Filter → Distortion → Delay → Reverb → Master → Analyser → destination
        this.workletNode.connect(this.filterNode);

        // 1. Filter → Distortion
        this.filterNode.connect(this.distNode);

        // 2. Distortion → Delay Section
        this.distNode.connect(this.delayDryGain);
        this.distNode.connect(this.delayNode);

        this.delayNode.connect(this.delayFeedbackNode);
        this.delayFeedbackNode.connect(this.delayNode); // Feedback Loop
        this.delayNode.connect(this.delayWetGain);

        // 3. Delay Output → preReverbNode (sum dry + wet)
        const preReverbNode = this.ctx.createGain();
        this.delayDryGain.connect(preReverbNode);
        this.delayWetGain.connect(preReverbNode);

        // 4. Reverb Section
        preReverbNode.connect(this.reverbDryGain);
        preReverbNode.connect(this.convolver);
        this.convolver.connect(this.reverbWetGain);

        // 5. To Master
        this.reverbDryGain.connect(this.masterGain);
        this.reverbWetGain.connect(this.masterGain);

        // Master → output
        this.masterGain.connect(this.analyser);
        this.masterGain.connect(this.ctx.destination);

        // Initialize reverb impulse
        this.updateReverbImpulse();

        // Send initial params
        this.updateParams(this.params);

        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
    }

    async loadSample(file: File): Promise<void> {
        await this.init();
        if (!this.ctx) return;

        // Validate file size (100MB max to prevent memory exhaustion)
        const MAX_FILE_SIZE = 100 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            throw new Error('Audio file too large (max 100MB)');
        }
        if (file.size === 0) {
            throw new Error('Audio file is empty');
        }

        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);

        this.sampleData = new Float32Array(channelData);
        this.sampleDuration = audioBuffer.duration;

        // Transfer to worklet
        const copy = new Float32Array(channelData);
        this.workletNode!.port.postMessage(
            { type: 'sampleBuffer', data: copy, channels: 1, length: copy.length },
            [copy.buffer]
        );

        this.params = { ...this.params, position: 0 };
    }

    createTestBuffer(): void {
        if (!this.ctx) return;
        const sr = this.ctx.sampleRate;
        const length = sr * 5; // 5 seconds
        const data = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            data[i] = Math.sin(i * 0.01) * 0.5 + Math.random() * 0.1;
        }

        this.sampleData = data;
        this.sampleDuration = 5;

        const copy = new Float32Array(data);
        this.workletNode?.port.postMessage(
            { type: 'sampleBuffer', data: copy, channels: 1, length: copy.length },
            [copy.buffer]
        );
    }

    loadFromFloat32Data(data: Float32Array): void {
        if (!this.ctx) return;
        this.sampleData = new Float32Array(data);
        this.sampleDuration = data.length / this.ctx.sampleRate;

        const copy = new Float32Array(data);
        this.workletNode?.port.postMessage(
            { type: 'sampleBuffer', data: copy, channels: 1, length: copy.length },
            [copy.buffer]
        );
        this.params = { ...this.params, position: 0 };
    }

    start(): void {
        this.workletNode?.port.postMessage({ type: 'start' });

        // Restore gains that were zeroed on stop() with a short ramp to avoid clicks
        if (this.ctx) {
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
        }
    }

    stop(): void {
        this.workletNode?.port.postMessage({ type: 'stop' });

        // Silence the FX chain: fast-ramp master gain to 0 and kill delay feedback
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

    updateParams(newParams: GranularParams): void {
        this.params = newParams;

        // Send all params to the worklet (it extracts what it needs)
        this.workletNode?.port.postMessage({ type: 'params', params: newParams });

        // Update Web Audio FX nodes locally (Phase 1)
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const ramp = 0.1;

        // Master volume
        this.masterGain?.gain.setTargetAtTime(newParams.volume, t, ramp);

        // Filter
        if (this.filterNode && !newParams.lfoTargets.includes('filterFreq')) {
            this.filterNode.frequency.setTargetAtTime(newParams.filterFreq, t, ramp);
            this.filterNode.Q.setTargetAtTime(newParams.filterRes, t, ramp);
        }

        // Distortion
        if (this.distNode) {
            this.distNode.curve = this.makeDistortionCurve(newParams.distAmount);
        }

        // Delay
        if (this.delayNode && this.delayFeedbackNode && this.delayDryGain && this.delayWetGain) {
            this.delayNode.delayTime.setTargetAtTime(newParams.delayTime, t, ramp);
            this.delayFeedbackNode.gain.setTargetAtTime(newParams.delayFeedback, t, ramp);
            this.delayDryGain.gain.setTargetAtTime(1 - newParams.delayMix, t, ramp);
            this.delayWetGain.gain.setTargetAtTime(newParams.delayMix, t, ramp);
        }

        // Reverb
        if (this.reverbDryGain && this.reverbWetGain) {
            this.reverbDryGain.gain.setTargetAtTime(1 - newParams.reverbMix, t, ramp);
            this.reverbWetGain.gain.setTargetAtTime(newParams.reverbMix, t, ramp);
        }

        // Update reverb impulse if decay changed significantly
        if (Math.abs(newParams.reverbDecay - this.lastReverbDecay) > 0.1) {
            this.updateReverbImpulse();
        }
    }

    // --- Visualization ---

    pollGrainEvents(): GrainEvent[] {
        const events = [...this.grainQueue];
        this.grainQueue = [];
        return events;
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

    getOutputLevel(): number {
        if (!this.analyser || !this.timeDataArray) return 0;
        this.analyser.getFloatTimeDomainData(this.timeDataArray);
        let sum = 0;
        for (let i = 0; i < this.timeDataArray.length; i++) {
            sum += this.timeDataArray[i] * this.timeDataArray[i];
        }
        const rms = Math.sqrt(sum / this.timeDataArray.length);
        return Math.min(1, rms * 2);
    }

    getAudioData(): Float32Array | null {
        return this.sampleData;
    }

    getDuration(): number {
        return this.sampleDuration;
    }

    getBufferDuration(): number {
        return this.sampleDuration;
    }

    getCurrentTime(): number {
        return this.ctx ? this.ctx.currentTime : 0;
    }

    // --- Freeze ---

    freeze(): void {
        this.frozen = true;
        this.workletNode?.port.postMessage({
            type: 'freeze', frozen: true, position: this.params.position
        });
    }

    unfreeze(): void {
        this.frozen = false;
        this.workletNode?.port.postMessage({
            type: 'freeze', frozen: false, position: 0
        });
    }

    toggleFreeze(): void {
        if (this.frozen) {
            this.unfreeze();
        } else {
            this.freeze();
        }
    }

    isFrozenActive(): boolean {
        return this.frozen;
    }

    // --- Drift ---

    startDrift(basePosition: number): void {
        this.drifting = true;
        this.driftPos = basePosition;
        this.workletNode?.port.postMessage({
            type: 'drift',
            enabled: true,
            basePosition,
            speed: this.driftSpd,
            returnTendency: this.driftReturn,
        });
    }

    stopDrift(): void {
        this.drifting = false;
        this.workletNode?.port.postMessage({
            type: 'drift', enabled: false, basePosition: 0.5, speed: 0.5, returnTendency: 0.3
        });
    }

    toggleDrift(basePosition: number): void {
        if (this.drifting) {
            this.stopDrift();
        } else {
            this.startDrift(basePosition);
        }
    }

    isDriftActive(): boolean {
        return this.drifting;
    }

    setDriftSpeed(speed: number): void {
        this.driftSpd = Math.max(0, Math.min(1, speed));
    }

    setDriftReturnTendency(tendency: number): void {
        this.driftReturn = Math.max(0, Math.min(1, tendency));
    }

    getDriftPosition(): number {
        return this.driftPos;
    }

    // --- Recording (same as JS engine, uses MediaStreamDestination) ---

    async startRecording(): Promise<void> {
        if (!this.ctx || !this.masterGain) return;

        const dest = this.ctx.createMediaStreamDestination();
        this.masterGain.connect(dest);

        this.destinationStream = dest.stream;
        this.recordedChunks = [];

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

        // If no preferred MIME type is supported, let the browser choose its default
        const recorderOptions: MediaRecorderOptions = {};
        if (selectedMimeType) {
            recorderOptions.mimeType = selectedMimeType;
        }

        this.mediaRecorder = new MediaRecorder(this.destinationStream, recorderOptions);

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

        const recorder = this.mediaRecorder;

        // Assign onstop handler before calling stop() to prevent race condition
        const stopped = new Promise<void>((resolve) => {
            recorder.onstop = () => resolve();
        });

        recorder.stop();
        await stopped;

        let blob: Blob;
        if (this.recordedChunks[0]?.type.includes('wav')) {
            blob = new Blob(this.recordedChunks, { type: 'audio/wav' });
        } else {
            const webmBlob = new Blob(this.recordedChunks, { type: 'audio/webm' });
            blob = await this.convertWebMToWav(webmBlob);
        }

        this.isRecording = false;
        if (this.destinationStream) {
            this.destinationStream.getTracks().forEach(track => track.stop());
            this.destinationStream = null;
        }

        return blob;
    }

    isRecordingActive(): boolean {
        return this.isRecording;
    }

    // --- Private helpers ---

    private makeDistortionCurve(amount: number): Float32Array {
        const cacheKey = Math.round(amount * 1000) / 1000;
        const cached = this.distortionCurveCache.get(cacheKey);
        if (cached) return cached;

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

        if (this.distortionCurveCache.size >= AudioEngineWASM.MAX_DISTORTION_CACHE) {
            const firstKey = this.distortionCurveCache.keys().next().value;
            this.distortionCurveCache.delete(firstKey!);
        }
        this.distortionCurveCache.set(cacheKey, curve);
        return curve;
    }

    private updateReverbImpulse(): void {
        if (!this.ctx || !this.convolver) return;

        const duration = this.params.reverbDecay;
        this.lastReverbDecay = duration;

        const rate = this.ctx.sampleRate;
        const length = rate * duration;
        const impulse = this.ctx.createBuffer(2, length, rate);

        for (let c = 0; c < 2; c++) {
            const channelData = impulse.getChannelData(c);
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - i / length, 4);
                channelData[i] = (Math.random() * 2 - 1) * decay;
            }
        }

        this.convolver.buffer = impulse;
    }

    private async convertWebMToWav(webmBlob: Blob): Promise<Blob> {
        const arrayBuffer = await webmBlob.arrayBuffer();
        const audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
        const wavBuffer = this.audioBufferToWav(audioBuffer);
        return new Blob([wavBuffer], { type: 'audio/wav' });
    }

    private audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1;
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

        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + interleaved.length * 2, true);
        this.writeString(view, 8, 'WAVE');
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        this.writeString(view, 36, 'data');
        view.setUint32(40, interleaved.length * 2, true);

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
}
