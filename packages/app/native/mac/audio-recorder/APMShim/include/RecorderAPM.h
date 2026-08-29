// Swift-facing C ABI for the fixed WebRTC AEC3 processor.

#ifndef RECORDER_APM_H
#define RECORDER_APM_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
  RECORDER_APM_SAMPLE_RATE_HZ = 48000,
  RECORDER_APM_FRAME_SAMPLES = 480,
  RECORDER_APM_MAX_DELAY_MS = 500,
};

typedef enum RecorderAPMNoiseSuppressionLevel {
  RECORDER_APM_NS_OFF = 0,
  RECORDER_APM_NS_LOW = 1,
  RECORDER_APM_NS_MODERATE = 2,
  RECORDER_APM_NS_HIGH = 3,
  RECORDER_APM_NS_VERY_HIGH = 4,
} RecorderAPMNoiseSuppressionLevel;

typedef enum RecorderAPMGainControlMode {
  RECORDER_APM_AGC_OFF = 0,
  RECORDER_APM_AGC1_ADAPTIVE_DIGITAL = 1,
  RECORDER_APM_AGC1_FIXED_DIGITAL = 2,
  RECORDER_APM_AGC2_ADAPTIVE_DIGITAL = 3,
} RecorderAPMGainControlMode;

typedef enum RecorderAPMStatus {
  RECORDER_APM_OK = 0,
  RECORDER_APM_INVALID_ARGUMENT = -1,
  RECORDER_APM_CREATE_FAILED = -2,
  RECORDER_APM_RENDER_FAILED = -3,
  RECORDER_APM_DELAY_FAILED = -4,
  RECORDER_APM_CAPTURE_FAILED = -5,
} RecorderAPMStatus;

typedef struct RecorderAPMConfig {
  int32_t echo_canceller_enabled;
  RecorderAPMNoiseSuppressionLevel noise_suppression_level;
  RecorderAPMGainControlMode gain_control_mode;
  int32_t high_pass_filter_enabled;
  int32_t maximum_internal_processing_rate_hz;
} RecorderAPMConfig;

typedef struct RecorderAPM RecorderAPM;

/** Returns the fixed upstream implementation identifier. */
const char* recorder_apm_version(void);

/** Creates a single-threaded processor and writes the result status. */
RecorderAPM* recorder_apm_create(
  const RecorderAPMConfig* config,
  RecorderAPMStatus* status
);

void recorder_apm_destroy(RecorderAPM* processor);

/**
 * Processes one 48 kHz / mono / Float32 / 10 ms frame.
 *
 * The call order is render, delay, then capture. Inputs are clamped to [-1, 1]
 * before they reach WebRTC. The delay must be in the inclusive range 0...500.
 */
RecorderAPMStatus recorder_apm_process_frame(
  RecorderAPM* processor,
  const float* render,
  const float* capture,
  size_t frame_samples,
  int32_t delay_ms,
  float* clean_capture
);

uint64_t recorder_apm_clipped_input_samples(const RecorderAPM* processor);
int32_t recorder_apm_last_webrtc_error(const RecorderAPM* processor);

#ifdef __cplusplus
}
#endif

#endif
