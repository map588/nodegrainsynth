#include <emscripten/bind.h>
#include "grain_engine.h"

using namespace emscripten;

EMSCRIPTEN_BINDINGS(grain_engine) {

    value_object<EngineParams>("EngineParams")
        .field("grainSize", &EngineParams::grainSize)
        .field("density", &EngineParams::density)
        .field("spread", &EngineParams::spread)
        .field("position", &EngineParams::position)
        .field("grainReversalChance", &EngineParams::grainReversalChance)
        .field("pan", &EngineParams::pan)
        .field("panSpread", &EngineParams::panSpread)
        .field("pitch", &EngineParams::pitch)
        .field("detune", &EngineParams::detune)
        .field("fmFreq", &EngineParams::fmFreq)
        .field("fmAmount", &EngineParams::fmAmount)
        .field("attack", &EngineParams::attack)
        .field("release", &EngineParams::release)
        .field("envelopeCurve", &EngineParams::envelopeCurve)
        .field("lfoRate", &EngineParams::lfoRate)
        .field("lfoAmount", &EngineParams::lfoAmount)
        .field("lfoShape", &EngineParams::lfoShape)
        .field("lfoTargetMask", &EngineParams::lfoTargetMask)
        .field("volume", &EngineParams::volume)
        .field("filterFreq", &EngineParams::filterFreq)
        .field("filterRes", &EngineParams::filterRes)
        .field("distAmount", &EngineParams::distAmount)
        .field("delayTime", &EngineParams::delayTime)
        .field("delayFeedback", &EngineParams::delayFeedback)
        .field("delayMix", &EngineParams::delayMix)
        .field("reverbMix", &EngineParams::reverbMix)
        .field("reverbDecay", &EngineParams::reverbDecay)
        ;

    class_<GrainEngine>("GrainEngine")
        .constructor<>()
        .function("init", &GrainEngine::init)
        .function("start", &GrainEngine::start)
        .function("stop", &GrainEngine::stop)
        .function("updateParams", &GrainEngine::updateParams)
        .function("allocateSampleBuffer", &GrainEngine::allocateSampleBuffer, allow_raw_pointers())
        .function("commitSampleBuffer", &GrainEngine::commitSampleBuffer)
        .function("process", &GrainEngine::process, allow_raw_pointers())
        .function("setFrozen", &GrainEngine::setFrozen)
        .function("setDrift", &GrainEngine::setDrift)
        .function("getGrainEventCount", &GrainEngine::getGrainEventCount)
        .function("getGrainEventNormPos", &GrainEngine::getGrainEventNormPos)
        .function("getGrainEventDuration", &GrainEngine::getGrainEventDuration)
        .function("getGrainEventPan", &GrainEngine::getGrainEventPan)
        .function("clearGrainEvents", &GrainEngine::clearGrainEvents)
        .function("getOutputBufferL", &GrainEngine::getOutputBufferL, allow_raw_pointers())
        .function("getOutputBufferR", &GrainEngine::getOutputBufferR, allow_raw_pointers())
        ;
}
