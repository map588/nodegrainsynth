/**
 * AudioWorklet processor for the NodeGrain WASM engine.
 *
 * Loads the Emscripten-compiled WASM module and runs the grain engine
 * in the audio rendering thread. Communicates with the main thread
 * via MessagePort for parameters, sample data, and grain events.
 */

class GrainProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        this.engine = null;
        this.wasmModule = null;
        this.isReady = false;
        this.frameCount = 0;

        // Pre-allocated pointers for output buffers (set after WASM init)
        this.outputPtrL = 0;
        this.outputPtrR = 0;
        this.heapF32 = null;

        // Handle messages from main thread
        this.port.onmessage = (e) => this._handleMessage(e.data);

        // Initialize WASM from the compiled module passed via processorOptions
        if (options.processorOptions && options.processorOptions.wasmModule) {
            this._initWasm(options.processorOptions.wasmModule);
        }
    }

    async _initWasm(compiledModule) {
        try {
            // Instantiate the WASM module using Emscripten's factory function
            // The compiled module is transferred from the main thread
            const moduleFactory = await import('/wasm/grain_engine.js');
            const instance = await moduleFactory.default({
                // Provide the pre-compiled WebAssembly.Module
                instantiateWasm: (imports, successCallback) => {
                    WebAssembly.instantiate(compiledModule, imports).then((inst) => {
                        successCallback(inst);
                    });
                    return {};
                }
            });

            this.wasmModule = instance;

            // Create the grain engine
            this.engine = new instance.GrainEngine();
            this.engine.init(sampleRate); // sampleRate is a global in AudioWorkletGlobalScope

            // Get output buffer pointers (static 128-sample buffers in WASM heap)
            this.outputPtrL = this.engine.getOutputBufferL();
            this.outputPtrR = this.engine.getOutputBufferR();

            this.isReady = true;
            this.port.postMessage({ type: 'ready' });
        } catch (err) {
            this.port.postMessage({
                type: 'error',
                message: 'WASM init failed: ' + (err.message || String(err))
            });
        }
    }

    _handleMessage(msg) {
        if (!this.engine && msg.type !== 'initWasm') return;

        switch (msg.type) {
            case 'params': {
                if (!this.engine) break;
                // Convert JS params to EngineParams struct
                const p = msg.params;
                const ep = new this.wasmModule.EngineParams();

                ep.grainSize = p.grainSize;
                ep.density = p.density;
                ep.spread = p.spread;
                ep.position = p.position;
                ep.grainReversalChance = p.grainReversalChance || 0;
                ep.pan = p.pan;
                ep.panSpread = p.panSpread;
                ep.pitch = p.pitch;
                ep.detune = p.detune;
                ep.fmFreq = p.fmFreq;
                ep.fmAmount = p.fmAmount;
                ep.attack = p.attack;
                ep.release = p.release;
                ep.envelopeCurve = p.envelopeCurve === 'exponential' ? 1 : 0;
                ep.lfoRate = p.lfoRate;
                ep.lfoAmount = p.lfoAmount;

                // Convert lfoShape string to int
                const shapeMap = { sine: 0, triangle: 1, square: 2, sawtooth: 3 };
                ep.lfoShape = shapeMap[p.lfoShape] || 0;

                // Convert lfoTargets array to bitmask
                const targetMap = {
                    grainSize: 1 << 0,
                    density: 1 << 1,
                    spread: 1 << 2,
                    position: 1 << 3,
                    pitch: 1 << 4,
                    fmFreq: 1 << 5,
                    fmAmount: 1 << 6,
                    filterFreq: 1 << 7,
                    filterRes: 1 << 8,
                    attack: 1 << 9,
                    release: 1 << 10,
                    distAmount: 1 << 11,
                    delayMix: 1 << 12,
                    delayTime: 1 << 13,
                    delayFeedback: 1 << 14,
                    pan: 1 << 15,
                    panSpread: 1 << 16,
                };
                let mask = 0;
                if (p.lfoTargets) {
                    for (const t of p.lfoTargets) {
                        if (targetMap[t] !== undefined) mask |= targetMap[t];
                    }
                }
                ep.lfoTargetMask = mask;

                ep.volume = p.volume;
                ep.filterFreq = p.filterFreq;
                ep.filterRes = p.filterRes;
                ep.distAmount = p.distAmount;
                ep.delayTime = p.delayTime;
                ep.delayFeedback = p.delayFeedback;
                ep.delayMix = p.delayMix;
                ep.reverbMix = p.reverbMix;
                ep.reverbDecay = p.reverbDecay;

                this.engine.updateParams(ep);

                // Also send FX params back so the TS bridge can update Web Audio nodes
                this.port.postMessage({
                    type: 'fxParams',
                    filterFreq: p.filterFreq,
                    filterRes: p.filterRes,
                    distAmount: p.distAmount,
                    delayTime: p.delayTime,
                    delayFeedback: p.delayFeedback,
                    delayMix: p.delayMix,
                    reverbMix: p.reverbMix,
                    reverbDecay: p.reverbDecay,
                    volume: p.volume,
                });
                break;
            }

            case 'sampleBuffer': {
                if (!this.engine) break;
                const data = msg.data; // Float32Array (transferred)
                const length = msg.length;
                const channels = msg.channels;

                // Allocate buffer in WASM heap and copy data
                const ptr = this.engine.allocateSampleBuffer(length);

                // Copy Float32Array into WASM heap
                const heapF32 = this.wasmModule.HEAPF32;
                const offset = ptr / 4; // Float32 offset
                heapF32.set(data, offset);

                this.engine.commitSampleBuffer(channels, length);
                this.port.postMessage({ type: 'sampleBufferLoaded' });
                break;
            }

            case 'start':
                this.engine.start();
                break;

            case 'stop':
                this.engine.stop();
                break;

            case 'freeze':
                this.engine.setFrozen(msg.frozen, msg.position || 0);
                break;

            case 'drift':
                this.engine.setDrift(
                    msg.enabled,
                    msg.basePosition || 0.5,
                    msg.speed || 0.5,
                    msg.returnTendency || 0.3
                );
                break;
        }
    }

    process(inputs, outputs, parameters) {
        if (!this.isReady || !this.engine) return true;

        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const left = output[0];
        const right = output[1] || output[0];
        const numFrames = left.length; // Should be 128

        // Get WASM heap for direct memory access
        const heapF32 = this.wasmModule.HEAPF32;
        const ptrL = this.outputPtrL / 4; // Float32 offset
        const ptrR = this.outputPtrR / 4;

        // Call into WASM engine
        this.engine.process(this.outputPtrL, this.outputPtrR, numFrames);

        // Copy from WASM heap to output buffers
        left.set(heapF32.subarray(ptrL, ptrL + numFrames));
        right.set(heapF32.subarray(ptrR, ptrR + numFrames));

        // Periodically send grain events back for visualization (~30ms intervals)
        this.frameCount++;
        if (this.frameCount % 10 === 0) {
            const count = this.engine.getGrainEventCount();
            if (count > 0) {
                const events = [];
                for (let i = 0; i < count; i++) {
                    events.push({
                        normPos: this.engine.getGrainEventNormPos(i),
                        duration: this.engine.getGrainEventDuration(i),
                        pan: this.engine.getGrainEventPan(i),
                    });
                }
                this.port.postMessage({ type: 'grainEvents', events });
                this.engine.clearGrainEvents();
            }
        }

        return true; // Keep processor alive
    }
}

registerProcessor('grain-processor', GrainProcessor);
