import KeyboardListenerCore
import Testing

@Test("config 命令解析出 🌐 键抑制开关")
func config命令解析出Globe键抑制开关() {
  let decoder = KeyboardListenerCommandDecoder()

  #expect(decoder.decode("{\"v\":2,\"type\":\"config\",\"suppressGlobeKey\":true}") == .config(suppressGlobeKey: true))
  #expect(decoder.decode("{\"suppressGlobeKey\":false,\"type\":\"config\",\"v\":2}") == .config(suppressGlobeKey: false))
}

@Test("版本、类型或字段集合不符的行整体丢弃")
func 版本类型或字段集合不符的行整体丢弃() {
  let decoder = KeyboardListenerCommandDecoder()

  #expect(decoder.decode("{\"v\":1,\"type\":\"config\",\"suppressGlobeKey\":true}") == nil)
  #expect(decoder.decode("{\"v\":2,\"type\":\"input\",\"suppressGlobeKey\":true}") == nil)
  #expect(decoder.decode("{\"v\":2,\"type\":\"config\"}") == nil)
  #expect(decoder.decode("{\"v\":2,\"type\":\"config\",\"suppressGlobeKey\":true,\"extra\":1}") == nil)
  #expect(decoder.decode("{\"v\":2,\"type\":\"config\",\"suppressGlobeKey\":\"yes\"}") == nil)
  #expect(decoder.decode("not json") == nil)
}
