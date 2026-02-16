#pragma once

#include "grain.h"
#include "lfo.h"
#include "param_smoother.h"
#include <cstdint>
#include <cstring>

// Grain visualization event (sent back to main thread)
struct GrainEvent {
    float normPos;
    float duration;
    float pan;
};

static constexpr int MAX_GRAIN_EVENTS = 64;

// Parameters mirroring GranularParams from types.ts
// Only the subset relevant to the grain engine (Phase 1)
struct EngineParams {
    // Grain
    float grainSize = 0.3f;        // seconds (0.01 - 0.5)
    float density = 0.15f;         // seconds between grains (0.005 - 0.5)
    float spread = 0.0f;           // position offset (0 - 2)
    float position = 0.0f;         // normalized playhead (0 - 1)
    float grainReversalChance = 0.0f; // (0 - 1)

    // Stereo
    float pan = 0.0f;              // (-1 to 1)
    float panSpread = 0.0f;        // (0 to 1)

    // Pitch & FM
    float pitch = 0.0f;            // semitones (-24 to +24)
    float detune = 0.0f;           // cents (0 - 100)
    float fmFreq = 0.0f;           // Hz
    float fmAmount = 0.0f;         // (0 - 100)

    // Envelope
    float attack = 0.5f;           // ratio of grain size (0 - 1)
    float release = 0.5f;          // ratio of grain size (0 - 1)
    int envelopeCurve = 0;         // 0=linear, 1=exponential

    // LFO
    float lfoRate = 1.0f;          // Hz (0.1 - 20)
    float lfoAmount = 0.0f;        // depth (0 - 1)
    int lfoShape = 0;              // 0=sine, 1=triangle, 2=square, 3=sawtooth

    // LFO targets (bitfield for efficiency)
    // Bit positions match the order in MOD_SCALES
    uint32_t lfoTargetMask = 0;

    // Volume (applied as final gain in the worklet)
    float volume = 0.8f;

    // Filter params (Phase 1: passed through to Web Audio nodes, not used in C++)
    float filterFreq = 20000.0f;
    float filterRes = 0.0f;

    // FX params (Phase 1: passed through to Web Audio nodes)
    float distAmount = 0.0f;
    float delayTime = 0.3f;
    float delayFeedback = 0.3f;
    float delayMix = 0.0f;
    float reverbMix = 0.0f;
    float reverbDecay = 2.0f;
};

// LFO target bit positions
enum LfoTarget : uint32_t {
    LFO_GRAIN_SIZE     = 1 << 0,
    LFO_DENSITY        = 1 << 1,
    LFO_SPREAD         = 1 << 2,
    LFO_POSITION       = 1 << 3,
    LFO_PITCH          = 1 << 4,
    LFO_FM_FREQ        = 1 << 5,
    LFO_FM_AMOUNT      = 1 << 6,
    LFO_FILTER_FREQ    = 1 << 7,
    LFO_FILTER_RES     = 1 << 8,
    LFO_ATTACK         = 1 << 9,
    LFO_RELEASE        = 1 << 10,
    LFO_DIST_AMOUNT    = 1 << 11,
    LFO_DELAY_MIX      = 1 << 12,
    LFO_DELAY_TIME     = 1 << 13,
    LFO_DELAY_FEEDBACK = 1 << 14,
    LFO_PAN            = 1 << 15,
    LFO_PAN_SPREAD     = 1 << 16,
};

// Modulation scales (matching MOD_SCALES in App.tsx)
struct ModScales {
    static constexpr float grainSize   = 0.2f;
    static constexpr float density     = 0.1f;
    static constexpr float spread      = 1.0f;
    static constexpr float position    = 0.5f;
    static constexpr float pitch       = 24.0f;
    static constexpr float fmFreq      = 200.0f;
    static constexpr float fmAmount    = 50.0f;
    static constexpr float filterFreq  = 5000.0f;
    static constexpr float filterRes   = 10.0f;
    static constexpr float attack      = 0.5f;
    static constexpr float release     = 0.5f;
    static constexpr float distAmount  = 0.5f;
    static constexpr float delayMix    = 0.5f;
    static constexpr float delayTime   = 0.5f;
    static constexpr float delayFeedback = 0.5f;
    static constexpr float pan         = 1.0f;
    static constexpr float panSpread   = 1.0f;
};


class GrainEngine {
public:
    GrainEngine();
    ~GrainEngine();

    // Initialize with sample rate (called once from worklet)
    void init(float sampleRate);

    // Set the sample buffer (mono float data, copied into engine)
    // Returns pointer for JS to write into, then call commitSampleBuffer
    float* allocateSampleBuffer(int lengthInSamples);
    void commitSampleBuffer(int channels, int lengthInSamples);

    // Transport
    void start();
    void stop();

    // Update parameters from main thread
    void updateParams(const EngineParams& params);

    // Process one block of audio (128 samples, stereo interleaved output)
    // outputL and outputR are pointers into WASM heap
    void process(float* outputL, float* outputR, int numFrames);

    // Freeze / Drift
    void setFrozen(bool frozen, float position);
    void setDrift(bool enabled, float basePosition, float speed, float returnTendency);

    // Grain events for visualization
    int getGrainEventCount() const;
    float getGrainEventNormPos(int index) const;
    float getGrainEventDuration(int index) const;
    float getGrainEventPan(int index) const;
    void clearGrainEvents();

    // Allocate output buffers in WASM heap (called once)
    float* getOutputBufferL();
    float* getOutputBufferR();

private:
    // Spawn a new grain at the current engine time
    void spawnGrain();

    // Process a single grain for one sample, return stereo pair
    void processGrain(Grain& grain, float& outL, float& outR);

    // Compute envelope value for a grain
    float computeEnvelope(const Grain& grain) const;

    // Get modulated parameter value
    float getModulated(float base, uint32_t targetBit, float scale,
                       float minVal, float maxVal) const;

    // Update drift position
    void updateDrift(float deltaTimeSec);

    // Simple xorshift PRNG (deterministic, fast, no allocation)
    float randomFloat();  // Returns 0..1
    uint32_t randomUint();

    // State
    float sampleRate_ = 48000.0f;
    float invSampleRate_ = 1.0f / 48000.0f;
    bool isPlaying_ = false;
    double currentTime_ = 0.0;       // Engine time in seconds
    double nextGrainTime_ = 0.0;     // When to spawn next grain

    // Sample buffer (owned, mono for now)
    float* sampleBuffer_ = nullptr;
    int sampleBufferLength_ = 0;
    int sampleBufferChannels_ = 1;

    // Output buffers (pre-allocated in WASM heap)
    float outputL_[128];
    float outputR_[128];

    // Grain pool
    Grain grains_[MAX_GRAINS];

    // LFO
    LFO lfo_;
    float currentLfoValue_ = 0.0f;   // Cached per-block

    // Parameters (current, updated from main thread)
    EngineParams params_;

    // Parameter smoothers for continuous params (prevents zipper noise)
    ParamSmoother pitchSmoother_;
    ParamSmoother positionSmoother_;
    ParamSmoother grainSizeSmoother_;
    ParamSmoother panSmoother_;
    ParamSmoother volumeSmoother_;

    // Freeze / Drift
    bool isFrozen_ = false;
    float frozenPosition_ = 0.0f;
    bool isDrifting_ = false;
    float driftPosition_ = 0.5f;
    float driftBasePosition_ = 0.5f;
    float driftSpeed_ = 0.5f;
    float driftReturnTendency_ = 0.3f;

    // Grain events ring buffer
    GrainEvent grainEvents_[MAX_GRAIN_EVENTS];
    int grainEventCount_ = 0;

    // PRNG state (xorshift32)
    uint32_t rngState_ = 12345;
};
