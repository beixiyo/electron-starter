import AVFoundation
import AudioProcessing
import Testing

@Suite("Production audio processing")
struct AudioProcessingTests {
  @Test("missing processing options are disabled")
  func missingAudioProcessingUsesDisabledDefaults() throws {
    let options = try AudioProcessingOptions.decode(jsonValue: nil)

    #expect(options == .disabled)
    #expect(options.processor == .off)
    #expect(options.delayMode == .auto)
    #expect(options.fixedDelayMS == 120)
    #expect(options.noiseSuppression == .moderate)
    #expect(options.gainControl == .off)
    #expect(options.highPass)
  }

  @Test("partial processing options apply current defaults")
  func partialAudioProcessingUsesDefaultsForMissingFields() throws {
    let options = try AudioProcessingOptions.decode(jsonValue: [
      "processor": "webrtcAec3",
      "fixedDelayMs": 80,
    ])

    #expect(options.processor == .webrtcAec3)
    #expect(options.fixedDelayMS == 80)
    #expect(options.delayMode == .auto)
    #expect(options.noiseSuppression == .moderate)
    #expect(options.gainControl == .off)
    #expect(options.highPass)
  }

  @Test("unknown processing fields are rejected")
  func unknownAudioProcessingFieldIsRejected() {
    var caughtError: Error?
    do {
      _ = try AudioProcessingOptions.decode(jsonValue: [
        "processor": "off",
        "unexpected": true,
      ])
    }
    catch {
      caughtError = error
    }
    #expect(caughtError != nil)
    #expect(String(describing: caughtError).contains("unexpected"))
  }

  @Test("missing reference never promotes a clean output")
  func missingReferenceCannotPromoteCleanOutput() throws {
    let directory = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let cleanURL = directory.appendingPathComponent("clean.caf")
    let options = AudioProcessingOptions(
      processor: .webrtcAec3,
      delayMode: .fixed,
      fixedDelayMS: 120,
      noiseSuppression: .off,
      gainControl: .off,
      highPass: false
    )

    let processor = try RealtimeEchoProcessor(options: options, cleanFileURL: cleanURL)

    let capture = try makeBuffer(samples: Array(repeating: Float(0.2), count: 480))
    #expect(processor.submitCapture(capture, logicalTimeSeconds: 0))
    let result = processor.finish()

    #expect(!result.canPromote)
    #expect(result.referenceSubmissions == 0)
    #expect(result.droppedSubmissions == 0)
    #expect(result.errorDescription == "reference stream was unavailable")
  }

  @Test("temporary reference gaps are zero-filled without discarding the clean output")
  func temporaryReferenceGapCanPromoteCleanOutput() throws {
    let directory = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let processor = try RealtimeEchoProcessor(
      options: AudioProcessingOptions(
        processor: .webrtcAec3,
        delayMode: .fixed,
        fixedDelayMS: 120,
        noiseSuppression: .off,
        gainControl: .off,
        highPass: false
      ),
      cleanFileURL: directory.appendingPathComponent("clean.caf")
    )
    let capture = try makeBuffer(samples: Array(repeating: Float(0.2), count: 480))
    let reference = try makeBuffer(samples: Array(repeating: Float(0.1), count: 480))

    #expect(processor.submitReference(reference, logicalTimeSeconds: 0))
    #expect(processor.submitCapture(capture, logicalTimeSeconds: 0))
    #expect(processor.submitReference(reference, logicalTimeSeconds: 0.02))
    #expect(processor.submitCapture(capture, logicalTimeSeconds: 0.01))
    #expect(processor.submitCapture(capture, logicalTimeSeconds: 0.02))
    let result = processor.finish()

    #expect(result.canPromote, Comment(rawValue: result.errorDescription ?? "clean output was not promotable"))
    #expect(result.referenceSubmissions == 2)
    #expect(result.missingReferenceSamples == 480)
    #expect(result.errorDescription == nil)
  }

  @Test("reference outside the capture timeline never promotes a clean output")
  func nonoverlappingReferenceCannotPromoteCleanOutput() throws {
    let directory = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let processor = try RealtimeEchoProcessor(
      options: AudioProcessingOptions(
        processor: .webrtcAec3,
        delayMode: .fixed,
        noiseSuppression: .off,
        gainControl: .off,
        highPass: false
      ),
      cleanFileURL: directory.appendingPathComponent("clean.caf")
    )
    let capture = try makeBuffer(samples: Array(repeating: Float(0.2), count: 480))
    let reference = try makeBuffer(samples: Array(repeating: Float(0.1), count: 480))

    #expect(processor.submitCapture(capture, logicalTimeSeconds: 0))
    #expect(processor.submitReference(reference, logicalTimeSeconds: 10))
    let result = processor.finish()

    #expect(!result.canPromote)
    #expect(result.referenceSubmissions == 1)
    #expect(result.missingReferenceSamples == 480)
    #expect(result.errorDescription == "reference stream had no samples aligned with capture")
  }

  @Test("leading reference gap is zero-filled without discarding the whole clean output")
  func leadingReferenceGapCanPromoteCleanOutput() throws {
    let directory = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let processor = try RealtimeEchoProcessor(
      options: AudioProcessingOptions(
        processor: .webrtcAec3,
        delayMode: .fixed,
        fixedDelayMS: 120,
        noiseSuppression: .off,
        gainControl: .off,
        highPass: false
      ),
      cleanFileURL: directory.appendingPathComponent("clean.caf")
    )
    let capture = try makeBuffer(samples: Array(repeating: Float(0.2), count: 480))
    let reference = try makeBuffer(samples: Array(repeating: Float(0.1), count: 480))

    /** 复刻生产启动时序：mic 先到 1.5 秒，system reference 随后才开始连续投递。 */
    for index in 0..<200 {
      try #require(processor.submitCapture(capture, logicalTimeSeconds: Double(index) / 100))
    }
    for index in 150..<200 {
      try #require(processor.submitReference(reference, logicalTimeSeconds: Double(index) / 100))
    }
    let result = processor.finish()

    #expect(result.canPromote, Comment(rawValue: result.errorDescription ?? "clean output was not promotable"))
    #expect(result.inputSamples == 96_000)
    #expect(result.outputSamples == 96_000)
    #expect(result.missingReferenceSamples == 72_000)
    #expect(result.droppedSubmissions == 0)
  }

  @Test("realtime AEC3 reduces delayed far-only echo and preserves length")
  func realtimeAEC3ReducesSyntheticDelayedEchoAndPreservesLength() throws {
    let directory = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let cleanURL = directory.appendingPathComponent("clean.caf")
    let options = AudioProcessingOptions(
      processor: .webrtcAec3,
      delayMode: .fixed,
      fixedDelayMS: 120,
      noiseSuppression: .off,
      gainControl: .off,
      highPass: false
    )

    let processor = try RealtimeEchoProcessor(options: options, cleanFileURL: cleanURL)

    let sampleRate = 48_000
    let frameCount = sampleRate * 6
    let frameSize = AUDIO_PROCESSING_FRAME_SAMPLES
    let delaySamples = sampleRate * 120 / 1_000
    var referenceSamples = [Float](repeating: 0, count: frameCount)
    var captureSamples = [Float](repeating: 0, count: frameCount)
    var state: UInt32 = 0x13579BDF
    for index in 0..<frameCount {
      state = state &* 1_664_525 &+ 1_013_904_223
      let noise = Float(Int32(bitPattern: state)) / Float(Int32.max)
      let tone = Float(sin(Double(index) * 2 * Double.pi * 317 / Double(sampleRate))) * 0.15
      referenceSamples[index] = noise * 0.45 + tone
      if index >= delaySamples {
        captureSamples[index] = referenceSamples[index - delaySamples] * 0.6
      }
    }

    for start in stride(from: 0, to: frameCount, by: frameSize) {
      let end = min(frameCount, start + frameSize)
      let reference = try makeBuffer(samples: Array(referenceSamples[start..<end]))
      let capture = try makeBuffer(samples: Array(captureSamples[start..<end]))
      try #require(
        processor.submitCapture(capture, logicalTimeSeconds: Double(start) / Double(sampleRate))
      )
      try #require(
        processor.submitReference(reference, logicalTimeSeconds: Double(start) / Double(sampleRate))
      )
      /** 本用例验证 DSP，不用离线灌入速度制造生产 callback 不会出现的背压。 */
      Thread.sleep(forTimeInterval: 0.0005)
    }

    let result = processor.finish()
    #expect(result.canPromote, Comment(rawValue: result.errorDescription ?? "AEC3 result was not promotable"))
    #expect(result.inputSamples == Int64(frameCount))
    #expect(result.outputSamples == Int64(frameCount))
    #expect(result.processedFrames == frameCount / frameSize)

    let output = try AVAudioFile(forReading: cleanURL)
    let outputBuffer = try #require(
      AVAudioPCMBuffer(
        pcmFormat: output.processingFormat,
        frameCapacity: AVAudioFrameCount(output.length)
      )
    )
    try output.read(into: outputBuffer)
    let outputSamples = try #require(outputBuffer.floatChannelData?[0])
    let cleanValues = Array(
      UnsafeBufferPointer(start: outputSamples, count: Int(outputBuffer.frameLength))
    )
    /** AVAudioFile 单次 read 可能少于 metadata length；只比较双方共同拥有的尾部窗口。 */
    let measurementCount = min(sampleRate * 2, cleanValues.count)
    let cleanStart = cleanValues.count - measurementCount
    let rawStart = frameCount - measurementCount
    let rawRMS = rms(captureSamples[rawStart..<frameCount])
    let cleanRMS = rms(cleanValues[cleanStart..<cleanValues.count])
    #expect(cleanRMS < rawRMS * 0.8)
  }

  @Test("queue backpressure prevents clean output promotion")
  func queueBackpressurePreventsPromotion() throws {
    let directory = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let processor = try RealtimeEchoProcessor(
      options: AudioProcessingOptions(
        processor: .webrtcAec3,
        delayMode: .fixed,
        noiseSuppression: .off,
        gainControl: .off,
        highPass: false
      ),
      cleanFileURL: directory.appendingPathComponent("clean.caf")
    )
    let capture = try makeBuffer(samples: Array(repeating: Float(0.2), count: 480))
    let reference = try makeBuffer(samples: Array(repeating: Float(0.1), count: 480))
    var observedBackpressure = false

    for index in 0..<20_000 {
      let time = Double(index) / 100
      if !processor.submitCapture(capture, logicalTimeSeconds: time)
        || !processor.submitReference(reference, logicalTimeSeconds: time) {
        observedBackpressure = true
        break
      }
    }

    let result = processor.finish()
    #expect(observedBackpressure)
    #expect(result.droppedSubmissions > 0)
    #expect(!result.canPromote)
    #expect(result.errorDescription?.contains("backpressure") == true)
  }

  private func makeTemporaryDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("audio-processing-tests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func makeBuffer(samples: [Float]) throws -> AVAudioPCMBuffer {
    let format = try #require(
      AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: 48_000,
        channels: 1,
        interleaved: false
      )
    )
    let buffer = try #require(
      AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))
    )
    buffer.frameLength = AVAudioFrameCount(samples.count)
    let destination = try #require(buffer.floatChannelData?[0])
    samples.withUnsafeBufferPointer { source in
      destination.update(from: source.baseAddress!, count: samples.count)
    }
    return buffer
  }

  private func rms<S: Collection>(_ samples: S) -> Double where S.Element == Float {
    guard !samples.isEmpty else { return 0 }
    let sum = samples.reduce(0.0) { partial, sample in
      partial + Double(sample) * Double(sample)
    }
    return sqrt(sum / Double(samples.count))
  }
}
