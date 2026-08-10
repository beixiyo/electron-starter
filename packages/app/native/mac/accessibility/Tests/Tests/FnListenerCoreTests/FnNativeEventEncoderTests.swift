import FnListenerCore
import Testing

@Test("input 编码为单行 NDJSON 对象")
func input编码为单行NDJSON对象() throws {
  let event = FnNativeEvent.input(FnNativeInputEvent(
    phase: .down,
    sequence: 7,
    timestamp: 123,
    key: "Space",
    modifiers: [.meta]
  ))

  let encoded = try FnNativeEventEncoder().encode(event)

  #expect(!encoded.contains("\n"))
  #expect(encoded == "{\"key\":\"Space\",\"modifiers\":[\"Meta\"],\"phase\":\"down\",\"sequence\":7,\"timestamp\":123,\"type\":\"input\",\"v\":1}")
}

@Test("reset 只包含协议要求字段")
func reset只包含协议要求字段() throws {
  let encoded = try FnNativeEventEncoder().encode(.reset(timestamp: 456))
  #expect(encoded == "{\"timestamp\":456,\"type\":\"reset\",\"v\":1}")
}
