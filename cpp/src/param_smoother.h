#pragma once

#include <cmath>

// Exponential one-pole smoother for parameter changes
// Prevents zipper noise when parameters change abruptly
class ParamSmoother {
public:
    ParamSmoother() = default;

    void init(float sampleRate, float smoothTimeMs = 10.0f) {
        sampleRate_ = sampleRate;
        setSmoothTime(smoothTimeMs);
    }

    void setSmoothTime(float ms) {
        if (sampleRate_ > 0.0f && ms > 0.0f) {
            // Time constant for one-pole filter
            coeff_ = 1.0f - std::exp(-1.0f / (sampleRate_ * ms * 0.001f));
        } else {
            coeff_ = 1.0f; // No smoothing
        }
    }

    // Set target immediately (no smoothing)
    void setImmediate(float value) {
        current_ = value;
        target_ = value;
    }

    // Set new target value
    void setTarget(float value) {
        target_ = value;
    }

    // Process one sample of smoothing
    float process() {
        current_ += (target_ - current_) * coeff_;
        return current_;
    }

    float getCurrent() const { return current_; }
    float getTarget() const { return target_; }

private:
    float sampleRate_ = 48000.0f;
    float coeff_ = 1.0f;
    float current_ = 0.0f;
    float target_ = 0.0f;
};
