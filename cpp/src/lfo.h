#pragma once

#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

enum class LfoShape : int {
    Sine = 0,
    Triangle = 1,
    Square = 2,
    Sawtooth = 3
};

class LFO {
public:
    void setRate(float hz) { rate_ = hz; }
    void setShape(LfoShape shape) { shape_ = shape; }

    // Get LFO value at a given time (returns -1 to +1)
    float getValue(float timeSec) const {
        float phase = std::fmod(timeSec * rate_, 1.0f);
        if (phase < 0.0f) phase += 1.0f;

        switch (shape_) {
            case LfoShape::Sine:
                return std::sin(phase * 2.0f * static_cast<float>(M_PI));
            case LfoShape::Square:
                return phase < 0.5f ? 1.0f : -1.0f;
            case LfoShape::Sawtooth:
                return phase * 2.0f - 1.0f;
            case LfoShape::Triangle:
                return std::fabs(phase * 4.0f - 2.0f) - 1.0f;
            default:
                return 0.0f;
        }
    }

private:
    float rate_ = 1.0f;
    LfoShape shape_ = LfoShape::Sine;
};
