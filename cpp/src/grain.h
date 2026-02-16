#pragma once

#include <cstdint>

// POD grain struct — no heap allocation, fixed-size pool
struct Grain {
    bool active = false;

    // Playback
    float position;          // Current read position in samples (float for interpolation)
    float playbackRate;      // Includes pitch + FM + reversal sign
    int32_t samplesRemaining;
    int32_t totalSamples;

    // Envelope
    float envPhase;          // 0..1 progress through grain
    float envIncrement;      // Per-sample increment = 1.0 / totalSamples
    float attackRatio;       // Fraction of grain that is attack (0-1)
    float releaseRatio;      // Fraction of grain that is release (0-1)
    bool exponentialEnv;

    // Panning (pre-computed equal-power coefficients)
    float panL;
    float panR;

    // Visualization
    float normPos;           // Normalized position in buffer (0-1) for grain events
    float duration;          // Grain duration in seconds
    float pan;               // Pan value (-1 to 1)
};

static constexpr int MAX_GRAINS = 128;
