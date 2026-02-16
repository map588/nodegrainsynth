import { GranularParams } from '../types';

export interface GrainEvent {
    normPos: number;
    duration: number;
    pan: number;
}

/**
 * Common interface for both the JS and WASM audio engines.
 * Allows drop-in swapping between implementations.
 */
export interface IAudioEngine {
    init(): Promise<void>;

    // Sample loading
    loadSample(file: File): Promise<void>;
    createTestBuffer(): void;
    loadFromFloat32Data(data: Float32Array): void;

    // Transport
    start(): void;
    stop(): void;

    // Parameters
    updateParams(params: GranularParams): void;

    // Visualization data
    pollGrainEvents(): GrainEvent[];
    getFrequencyData(): Uint8Array | null;
    getTimeData(): Float32Array | null;
    getOutputLevel(): number;
    getAudioData(): Float32Array | null;

    // Timing
    getDuration(): number;
    getBufferDuration(): number;
    getCurrentTime(): number;

    // Freeze
    freeze(): void;
    unfreeze(): void;
    toggleFreeze(): void;
    isFrozenActive(): boolean;

    // Drift
    startDrift(basePosition: number): void;
    stopDrift(): void;
    toggleDrift(basePosition: number): void;
    isDriftActive(): boolean;
    setDriftSpeed(speed: number): void;
    setDriftReturnTendency(tendency: number): void;
    getDriftPosition(): number;

    // Recording
    startRecording(): Promise<void>;
    stopRecording(): Promise<Blob | null>;
    isRecordingActive(): boolean;
}
