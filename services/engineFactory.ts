import { GranularParams } from '../types';
import { IAudioEngine } from './IAudioEngine';
import { AudioEngineWASM } from './audioEngineWASM';
import { AudioEngine } from './audioEngine';

export type EngineType = 'wasm' | 'js';

/**
 * Creates an audio engine instance with WASM preference and JS fallback.
 *
 * The WASM engine runs grain synthesis in an AudioWorklet for better
 * performance and timing accuracy. If WASM or AudioWorklet is unavailable,
 * falls back to the original JS engine.
 */
export async function createEngine(
    params: GranularParams,
    preferred: EngineType = 'wasm'
): Promise<{ engine: IAudioEngine; type: EngineType }> {

    if (preferred === 'wasm') {
        try {
            // Check browser support
            if (typeof AudioWorkletNode === 'undefined') {
                throw new Error('AudioWorklet not supported');
            }
            if (typeof WebAssembly === 'undefined') {
                throw new Error('WebAssembly not supported');
            }

            const engine = new AudioEngineWASM(params);
            await engine.init();
            console.log('[NodeGrain] Using WASM audio engine');
            return { engine, type: 'wasm' };
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Unknown error';
            console.warn('[NodeGrain] WASM engine unavailable, falling back to JS:', message);
        }
    }

    // Fallback to JS engine
    const engine = new AudioEngine(params);
    console.log('[NodeGrain] Using JS audio engine');
    return { engine, type: 'js' };
}
