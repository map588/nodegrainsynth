#include "grain_engine.h"
#include <cmath>
#include <cstring>
#include <algorithm>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

GrainEngine::GrainEngine() {
    std::memset(grains_, 0, sizeof(grains_));
    std::memset(outputL_, 0, sizeof(outputL_));
    std::memset(outputR_, 0, sizeof(outputR_));
    std::memset(grainEvents_, 0, sizeof(grainEvents_));
}

GrainEngine::~GrainEngine() {
    delete[] sampleBuffer_;
}

void GrainEngine::init(float sampleRate) {
    sampleRate_ = sampleRate;
    invSampleRate_ = 1.0f / sampleRate;
    currentTime_ = 0.0;
    nextGrainTime_ = 0.0;

    // Reset all grains
    for (int i = 0; i < MAX_GRAINS; ++i) {
        grains_[i].active = false;
    }

    grainEventCount_ = 0;

    // Initialize parameter smoothers (10ms smoothing time)
    pitchSmoother_.init(sampleRate, 10.0f);
    positionSmoother_.init(sampleRate, 10.0f);
    grainSizeSmoother_.init(sampleRate, 10.0f);
    panSmoother_.init(sampleRate, 10.0f);
    volumeSmoother_.init(sampleRate, 10.0f);

    pitchSmoother_.setImmediate(0.0f);
    positionSmoother_.setImmediate(0.0f);
    grainSizeSmoother_.setImmediate(0.1f);
    panSmoother_.setImmediate(0.0f);
    volumeSmoother_.setImmediate(0.8f);
}

float* GrainEngine::allocateSampleBuffer(int lengthInSamples) {
    delete[] sampleBuffer_;
    sampleBuffer_ = new float[lengthInSamples];
    sampleBufferLength_ = lengthInSamples;
    return sampleBuffer_;
}

void GrainEngine::commitSampleBuffer(int channels, int lengthInSamples) {
    sampleBufferChannels_ = channels;
    sampleBufferLength_ = lengthInSamples;
}

void GrainEngine::start() {
    if (isPlaying_) return;
    isPlaying_ = true;
    nextGrainTime_ = currentTime_;
}

void GrainEngine::stop() {
    isPlaying_ = false;
    // Deactivate all grains for clean stop
    for (int i = 0; i < MAX_GRAINS; ++i) {
        grains_[i].active = false;
    }
}

void GrainEngine::updateParams(const EngineParams& params) {
    params_ = params;
    lfo_.setRate(params.lfoRate);
    lfo_.setShape(static_cast<LfoShape>(params.lfoShape));

    // Update smoother targets for continuous parameters
    pitchSmoother_.setTarget(params.pitch);
    positionSmoother_.setTarget(params.position);
    grainSizeSmoother_.setTarget(params.grainSize);
    panSmoother_.setTarget(params.pan);
    volumeSmoother_.setTarget(params.volume);
}

void GrainEngine::process(float* outputL, float* outputR, int numFrames) {
    // Clear output
    std::memset(outputL, 0, numFrames * sizeof(float));
    std::memset(outputR, 0, numFrames * sizeof(float));

    if (!isPlaying_ || !sampleBuffer_ || sampleBufferLength_ == 0) {
        currentTime_ += numFrames * invSampleRate_;
        return;
    }

    // Cache LFO value for this block (LFO rates are < 20Hz, per-block is fine)
    currentLfoValue_ = lfo_.getValue(static_cast<float>(currentTime_));

    // Advance parameter smoothers (once per block is sufficient)
    for (int i = 0; i < numFrames; ++i) {
        pitchSmoother_.process();
        positionSmoother_.process();
        grainSizeSmoother_.process();
        panSmoother_.process();
        volumeSmoother_.process();
    }

    // Update drift if active
    if (isDrifting_ && !isFrozen_) {
        updateDrift(numFrames * invSampleRate_);
    }

    // Schedule new grains
    double blockEndTime = currentTime_ + numFrames * invSampleRate_;
    while (nextGrainTime_ < blockEndTime) {
        spawnGrain();

        // Advance next grain time by density (possibly LFO-modulated)
        float density = getModulated(params_.density, LFO_DENSITY,
                                     ModScales::density, 0.005f, 10.0f);
        nextGrainTime_ += density;
    }

    // Process all active grains sample-by-sample
    for (int i = 0; i < numFrames; ++i) {
        float sumL = 0.0f;
        float sumR = 0.0f;

        for (int g = 0; g < MAX_GRAINS; ++g) {
            Grain& grain = grains_[g];
            if (!grain.active) continue;

            float gL, gR;
            processGrain(grain, gL, gR);
            sumL += gL;
            sumR += gR;
        }

        outputL[i] = sumL;
        outputR[i] = sumR;
    }

    currentTime_ = blockEndTime;
}

void GrainEngine::spawnGrain() {
    // Find an inactive grain slot
    int slot = -1;
    int oldestSlot = -1;
    int32_t leastRemaining = INT32_MAX;

    for (int i = 0; i < MAX_GRAINS; ++i) {
        if (!grains_[i].active) {
            slot = i;
            break;
        }
        // Track oldest for stealing
        if (grains_[i].samplesRemaining < leastRemaining) {
            leastRemaining = grains_[i].samplesRemaining;
            oldestSlot = i;
        }
    }

    // Steal oldest if no free slot
    if (slot < 0) {
        slot = oldestSlot;
        if (slot < 0) return; // Should never happen with MAX_GRAINS > 0
    }

    Grain& grain = grains_[slot];

    // Get modulated parameters (using smoothed values for continuous params)
    float grainSize = getModulated(grainSizeSmoother_.getCurrent(), LFO_GRAIN_SIZE,
                                   ModScales::grainSize, 0.01f, 0.5f);
    float spread = getModulated(params_.spread, LFO_SPREAD,
                                ModScales::spread, 0.0f, 2.0f);
    float pitch = getModulated(pitchSmoother_.getCurrent(), LFO_PITCH,
                               ModScales::pitch, -24.0f, 24.0f);
    float fmFreq = getModulated(params_.fmFreq, LFO_FM_FREQ,
                                ModScales::fmFreq, 0.0f, 1000.0f);
    float fmAmount = getModulated(params_.fmAmount, LFO_FM_AMOUNT,
                                  ModScales::fmAmount, 0.0f, 100.0f);
    float attack = getModulated(params_.attack, LFO_ATTACK,
                                ModScales::attack, 0.01f, 0.9f);
    float release = getModulated(params_.release, LFO_RELEASE,
                                 ModScales::release, 0.01f, 0.9f);
    float panCenter = getModulated(panSmoother_.getCurrent(), LFO_PAN,
                                   ModScales::pan, -1.0f, 1.0f);
    float panSpread = getModulated(params_.panSpread, LFO_PAN_SPREAD,
                                   ModScales::panSpread, 0.0f, 1.0f);

    // Position: frozen > drift > manual (use smoothed position for manual)
    float basePosition = isFrozen_ ? frozenPosition_ :
                         (isDrifting_ ? driftPosition_ : positionSmoother_.getCurrent());
    float position = getModulated(basePosition, LFO_POSITION,
                                  ModScales::position, 0.0f, 1.0f);

    // Calculate grain duration in samples
    float grainDuration = std::max(0.01f, grainSize);
    int totalSamples = static_cast<int>(grainDuration * sampleRate_);
    if (totalSamples < 1) totalSamples = 1;

    // Calculate playback rate from pitch + detune + FM
    float cents = pitch * 100.0f +
                  (randomFloat() * params_.detune * 2.0f - params_.detune);
    float rate = std::pow(2.0f, cents / 1200.0f);

    // Grain reversal
    bool reversed = randomFloat() < params_.grainReversalChance;
    if (reversed) {
        rate = -rate;
    }

    // FM modulation
    float fmMod = 0.0f;
    if (fmAmount > 0.0f) {
        fmMod = std::sin(static_cast<float>(currentTime_) * fmFreq) * (fmAmount * 0.01f);
    }
    float finalRate = std::max(0.1f, std::abs(rate + fmMod));
    if (reversed) finalRate = -finalRate;

    // Calculate start position in the buffer
    float bufferDurationSec = static_cast<float>(sampleBufferLength_) * invSampleRate_;
    float centerSample = position * static_cast<float>(sampleBufferLength_);
    float randomOffset = (randomFloat() * 2.0f - 1.0f) * spread *
                         static_cast<float>(sampleBufferLength_) * 0.5f;
    float startSample = centerSample + randomOffset;

    // Clamp to buffer bounds
    float maxStart = static_cast<float>(sampleBufferLength_) -
                     grainDuration * sampleRate_ * std::abs(finalRate);
    startSample = std::max(0.0f, std::min(startSample, std::max(0.0f, maxStart)));

    // For reversed grains, start at the end of the region
    if (reversed) {
        startSample = std::min(startSample + grainDuration * sampleRate_,
                               static_cast<float>(sampleBufferLength_ - 1));
    }

    // Calculate pan
    float randomPan = (randomFloat() * 2.0f - 1.0f) * panSpread;
    float finalPan = std::max(-1.0f, std::min(1.0f, panCenter + randomPan));

    // Equal-power panning (constant-power stereo pan law)
    float panAngle = (finalPan + 1.0f) * 0.25f * static_cast<float>(M_PI);
    float panL = std::cos(panAngle);
    float panR = std::sin(panAngle);

    // Fill grain struct
    grain.active = true;
    grain.position = startSample;
    grain.playbackRate = finalRate;
    grain.totalSamples = totalSamples;
    grain.samplesRemaining = totalSamples;
    grain.envPhase = 0.0f;
    grain.envIncrement = 1.0f / static_cast<float>(totalSamples);
    grain.attackRatio = attack;
    grain.releaseRatio = release;
    grain.exponentialEnv = (params_.envelopeCurve == 1);
    grain.panL = panL;
    grain.panR = panR;

    // Store visualization data
    grain.normPos = (bufferDurationSec > 0.0f)
        ? (startSample / static_cast<float>(sampleBufferLength_))
        : 0.0f;
    grain.duration = grainDuration;
    grain.pan = finalPan;

    // Emit grain event
    if (grainEventCount_ < MAX_GRAIN_EVENTS) {
        grainEvents_[grainEventCount_].normPos = grain.normPos;
        grainEvents_[grainEventCount_].duration = grain.duration;
        grainEvents_[grainEventCount_].pan = grain.pan;
        grainEventCount_++;
    }
}

void GrainEngine::processGrain(Grain& grain, float& outL, float& outR) {
    // Read sample from buffer with linear interpolation
    float sample = 0.0f;
    float pos = grain.position;

    if (pos >= 0.0f && pos < static_cast<float>(sampleBufferLength_ - 1)) {
        int idx = static_cast<int>(pos);
        float frac = pos - static_cast<float>(idx);
        sample = sampleBuffer_[idx] * (1.0f - frac) +
                 sampleBuffer_[idx + 1] * frac;
    } else if (pos >= 0.0f && pos < static_cast<float>(sampleBufferLength_)) {
        sample = sampleBuffer_[static_cast<int>(pos)];
    }

    // Apply envelope
    float env = computeEnvelope(grain);
    sample *= env;

    // Apply panning
    outL = sample * grain.panL;
    outR = sample * grain.panR;

    // Advance position and envelope
    grain.position += grain.playbackRate;
    grain.envPhase += grain.envIncrement;
    grain.samplesRemaining--;

    // Deactivate when done or out of bounds
    if (grain.samplesRemaining <= 0 ||
        grain.position < 0.0f ||
        grain.position >= static_cast<float>(sampleBufferLength_)) {
        grain.active = false;
    }
}

float GrainEngine::computeEnvelope(const Grain& grain) const {
    float phase = grain.envPhase;
    float attackEnd = grain.attackRatio;
    float releaseStart = 1.0f - grain.releaseRatio;

    // Small fade to prevent clicks (1% of grain)
    constexpr float fadeRatio = 0.01f;
    constexpr float epsilon = 1e-6f;

    if (phase < fadeRatio) {
        // Anti-click fade-in
        return phase / fadeRatio * 0.001f; // Ramp from 0 to minVal
    } else if (phase < attackEnd) {
        float attackDuration = attackEnd - fadeRatio;
        if (attackDuration < epsilon) {
            return 0.001f; // Attack too short, skip to minVal
        }
        float t = (phase - fadeRatio) / attackDuration;
        if (grain.exponentialEnv) {
            return 0.001f + t * t * (1.0f - 0.001f); // Quadratic approximation of exp
        } else {
            return 0.001f + t * (1.0f - 0.001f);
        }
    } else if (phase < releaseStart) {
        return 1.0f; // Sustain
    } else {
        if (grain.releaseRatio < epsilon) {
            return 0.0f; // Release too short, snap to zero
        }
        float t = (phase - releaseStart) / grain.releaseRatio;
        t = std::min(1.0f, t);
        if (grain.exponentialEnv) {
            float val = (1.0f - t);
            return val * val; // Quadratic decay
        } else {
            return 1.0f - t;
        }
    }
}

float GrainEngine::getModulated(float base, uint32_t targetBit, float scale,
                                float minVal, float maxVal) const {
    if (!(params_.lfoTargetMask & targetBit)) return base;
    float val = base + (currentLfoValue_ * params_.lfoAmount * scale);
    return std::max(minVal, std::min(maxVal, val));
}

void GrainEngine::updateDrift(float deltaTimeSec) {
    // Random walk step
    float stepSize = driftSpeed_ * deltaTimeSec * 0.5f;
    float randomStep = (randomFloat() - 0.5f) * 2.0f * stepSize;

    // Pull back toward base position
    float distanceFromBase = driftBasePosition_ - driftPosition_;
    float returnForce = distanceFromBase * driftReturnTendency_ * deltaTimeSec * 0.5f;

    driftPosition_ += randomStep + returnForce;
    driftPosition_ = std::max(0.0f, std::min(1.0f, driftPosition_));
}

void GrainEngine::setFrozen(bool frozen, float position) {
    isFrozen_ = frozen;
    if (frozen) {
        frozenPosition_ = position;
    }
}

void GrainEngine::setDrift(bool enabled, float basePosition,
                           float speed, float returnTendency) {
    isDrifting_ = enabled;
    if (enabled) {
        driftBasePosition_ = basePosition;
        driftPosition_ = basePosition;
        driftSpeed_ = speed;
        driftReturnTendency_ = returnTendency;
    }
}

int GrainEngine::getGrainEventCount() const {
    return grainEventCount_;
}

float GrainEngine::getGrainEventNormPos(int index) const {
    if (index < 0 || index >= grainEventCount_) return 0.0f;
    return grainEvents_[index].normPos;
}

float GrainEngine::getGrainEventDuration(int index) const {
    if (index < 0 || index >= grainEventCount_) return 0.0f;
    return grainEvents_[index].duration;
}

float GrainEngine::getGrainEventPan(int index) const {
    if (index < 0 || index >= grainEventCount_) return 0.0f;
    return grainEvents_[index].pan;
}

void GrainEngine::clearGrainEvents() {
    grainEventCount_ = 0;
}

float* GrainEngine::getOutputBufferL() {
    return outputL_;
}

float* GrainEngine::getOutputBufferR() {
    return outputR_;
}

// Fast xorshift32 PRNG
uint32_t GrainEngine::randomUint() {
    rngState_ ^= rngState_ << 13;
    rngState_ ^= rngState_ >> 17;
    rngState_ ^= rngState_ << 5;
    return rngState_;
}

float GrainEngine::randomFloat() {
    return static_cast<float>(randomUint()) / 4294967296.0f;
}
