import KeyboardListenerCore
import Testing

@Test("input 编码为单行 NDJSON 对象")
func input编码为单行NDJSON对象() throws {
  let event = KeyboardListenerEvent.input(KeyboardListenerInputEvent(
    phase: .down,
    key: "Space",
    modifiers: [.meta],
    fn: true,
    timestamp: 123
  ))

  let encoded = try KeyboardListenerEventEncoder().encode(event)

  #expect(!encoded.contains("\n"))
  #expect(encoded == "{\"fn\":true,\"key\":\"Space\",\"modifiers\":[\"Meta\"],\"phase\":\"down\",\"timestamp\":123,\"type\":\"input\",\"v\":2}")
}

@Test("reset 只包含协议要求字段")
func reset只包含协议要求字段() throws {
  let encoded = try KeyboardListenerEventEncoder().encode(.reset(timestamp: 456))
  #expect(encoded == "{\"timestamp\":456,\"type\":\"reset\",\"v\":2}")
}
