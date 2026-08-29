// Keep WebRTC APM behind a small C ABI so Swift never depends on C++ types.

#include "RecorderAPM.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <new>

#include "modules/audio_processing/include/audio_processing.h"

namespace {

constexpr char kVersion[] =
  "webrtc-audio-processing 2.1 (WebRTC M131, 846fe90a289f58b7c9303a635142aa2c7caa93e5)";

webrtc::AudioProcessing::Config::NoiseSuppression::Level noise_suppression_level(
  RecorderAPMNoiseSuppressionLevel level
) {
  switch (level) {
    case RECORDER_APM_NS_LOW:
      return webrtc::AudioProcessing::Config::NoiseSuppression::kLow;
    case RECORDER_APM_NS_MODERATE:
      return webrtc::AudioProcessing::Config::NoiseSuppression::kModerate;
    case RECORDER_APM_NS_HIGH:
      return webrtc::AudioProcessing::Config::NoiseSuppression::kHigh;
    case RECORDER_APM_NS_VERY_HIGH:
      return webrtc::AudioProcessing::Config::NoiseSuppression::kVeryHigh;
    case RECORDER_APM_NS_OFF:
      // The level is ignored while noise_suppression.enabled is false.
      return webrtc::AudioProcessing::Config::NoiseSuppression::kModerate;
  }
  return webrtc::AudioProcessing::Config::NoiseSuppression::kModerate;
}

bool valid_config(const RecorderAPMConfig& config) {
  const bool valid_rate = config.maximum_internal_processing_rate_hz == 32000
    || config.maximum_internal_processing_rate_hz == 48000;
  const bool valid_ns = config.noise_suppression_level >= RECORDER_APM_NS_OFF
    && config.noise_suppression_level <= RECORDER_APM_NS_VERY_HIGH;
  const bool valid_agc = config.gain_control_mode >= RECORDER_APM_AGC_OFF
    && config.gain_control_mode <= RECORDER_APM_AGC2_ADAPTIVE_DIGITAL;
  return valid_rate && valid_ns && valid_agc;
}

float clamp_sample(float sample, uint64_t* clipped_samples) {
  if (!std::isfinite(sample)) {
    ++*clipped_samples;
    return 0.0f;
  }
  if (sample > 1.0f) {
    ++*clipped_samples;
    return 1.0f;
  }
  if (sample < -1.0f) {
    ++*clipped_samples;
    return -1.0f;
  }
  return sample;
}

}  // namespace

struct RecorderAPM {
  rtc::scoped_refptr<webrtc::AudioProcessing> processor;
  webrtc::StreamConfig stream_config{RECORDER_APM_SAMPLE_RATE_HZ, 1};
  bool echo_canceller_enabled = false;
  uint64_t clipped_input_samples = 0;
  int32_t last_webrtc_error = 0;
};

const char* recorder_apm_version(void) {
  return kVersion;
}

RecorderAPM* recorder_apm_create(
  const RecorderAPMConfig* config,
  RecorderAPMStatus* status
) {
  if (status != nullptr) {
    *status = RECORDER_APM_INVALID_ARGUMENT;
  }
  if (config == nullptr || !valid_config(*config)) {
    return nullptr;
  }

  RecorderAPM* instance = nullptr;
  try {
    instance = new (std::nothrow) RecorderAPM();
    if (instance == nullptr) {
      if (status != nullptr) {
        *status = RECORDER_APM_CREATE_FAILED;
      }
      return nullptr;
    }

    webrtc::AudioProcessing::Config apm_config;
    apm_config.pipeline.maximum_internal_processing_rate =
      config->maximum_internal_processing_rate_hz;
    apm_config.echo_canceller.enabled = config->echo_canceller_enabled != 0;
    apm_config.echo_canceller.mobile_mode = false;
    apm_config.echo_canceller.enforce_high_pass_filtering =
      config->high_pass_filter_enabled != 0;
    apm_config.high_pass_filter.enabled = config->high_pass_filter_enabled != 0;
    apm_config.noise_suppression.enabled =
      config->noise_suppression_level != RECORDER_APM_NS_OFF;
    apm_config.noise_suppression.level = noise_suppression_level(
      config->noise_suppression_level
    );

    switch (config->gain_control_mode) {
      case RECORDER_APM_AGC_OFF:
        break;
      case RECORDER_APM_AGC1_ADAPTIVE_DIGITAL:
        apm_config.gain_controller1.enabled = true;
        apm_config.gain_controller1.mode =
          webrtc::AudioProcessing::Config::GainController1::kAdaptiveDigital;
        break;
      case RECORDER_APM_AGC1_FIXED_DIGITAL:
        apm_config.gain_controller1.enabled = true;
        apm_config.gain_controller1.mode =
          webrtc::AudioProcessing::Config::GainController1::kFixedDigital;
        break;
      case RECORDER_APM_AGC2_ADAPTIVE_DIGITAL:
        apm_config.gain_controller2.enabled = true;
        apm_config.gain_controller2.adaptive_digital.enabled = true;
        break;
    }

    webrtc::AudioProcessingBuilder builder;
    builder.SetConfig(apm_config);
    instance->processor = builder.Create();
    if (instance->processor == nullptr) {
      delete instance;
      if (status != nullptr) {
        *status = RECORDER_APM_CREATE_FAILED;
      }
      return nullptr;
    }

    instance->echo_canceller_enabled = config->echo_canceller_enabled != 0;
    if (status != nullptr) {
      *status = RECORDER_APM_OK;
    }
    return instance;
  }
  catch (...) {
    delete instance;
    if (status != nullptr) {
      *status = RECORDER_APM_CREATE_FAILED;
    }
    return nullptr;
  }
}

void recorder_apm_destroy(RecorderAPM* processor) {
  delete processor;
}

RecorderAPMStatus recorder_apm_process_frame(
  RecorderAPM* processor,
  const float* render,
  const float* capture,
  size_t frame_samples,
  int32_t delay_ms,
  float* clean_capture
) {
  if (processor == nullptr || processor->processor == nullptr
      || render == nullptr || capture == nullptr || clean_capture == nullptr
      || frame_samples != RECORDER_APM_FRAME_SAMPLES
      || delay_ms < 0 || delay_ms > RECORDER_APM_MAX_DELAY_MS) {
    return RECORDER_APM_INVALID_ARGUMENT;
  }

  try {
    std::array<float, RECORDER_APM_FRAME_SAMPLES> render_frame;
    std::array<float, RECORDER_APM_FRAME_SAMPLES> capture_frame;
    for (size_t index = 0; index < frame_samples; ++index) {
      render_frame[index] = clamp_sample(render[index], &processor->clipped_input_samples);
      capture_frame[index] = clamp_sample(capture[index], &processor->clipped_input_samples);
    }

    const float* render_input[] = {render_frame.data()};
    float* render_output[] = {render_frame.data()};
    int result = processor->processor->ProcessReverseStream(
      render_input,
      processor->stream_config,
      processor->stream_config,
      render_output
    );
    if (result != 0) {
      processor->last_webrtc_error = result;
      return RECORDER_APM_RENDER_FAILED;
    }

    if (processor->echo_canceller_enabled) {
      result = processor->processor->set_stream_delay_ms(delay_ms);
      if (result != 0) {
        processor->last_webrtc_error = result;
        return RECORDER_APM_DELAY_FAILED;
      }
    }

    const float* capture_input[] = {capture_frame.data()};
    float* capture_output[] = {capture_frame.data()};
    result = processor->processor->ProcessStream(
      capture_input,
      processor->stream_config,
      processor->stream_config,
      capture_output
    );
    if (result != 0) {
      processor->last_webrtc_error = result;
      return RECORDER_APM_CAPTURE_FAILED;
    }

    for (size_t index = 0; index < frame_samples; ++index) {
      clean_capture[index] = capture_frame[index];
    }
    processor->last_webrtc_error = 0;
    return RECORDER_APM_OK;
  }
  catch (...) {
    processor->last_webrtc_error = -1;
    return RECORDER_APM_CAPTURE_FAILED;
  }
}

uint64_t recorder_apm_clipped_input_samples(const RecorderAPM* processor) {
  return processor == nullptr ? 0 : processor->clipped_input_samples;
}

int32_t recorder_apm_last_webrtc_error(const RecorderAPM* processor) {
  return processor == nullptr ? 0 : processor->last_webrtc_error;
}
