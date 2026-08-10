import FnListenerCore
import Testing

@Test("初始无 flag 边界被忽略")
func 初始无Flag边界被忽略() {
  let classifier = FnPhysicalInputClassifier()
  #expect(classifier.classify(hasFnFlag: false, isFnDown: false) == nil)
}

@Test("带 flag 的 down 只输出一次")
func 带Flag的Down只输出一次() {
  let classifier = FnPhysicalInputClassifier()
  #expect(classifier.classify(hasFnFlag: true, isFnDown: false) == .down)
  #expect(classifier.classify(hasFnFlag: true, isFnDown: true) == nil)
}

@Test("已确认 down 后无 flag 边界只输出一次 up")
func 已确认Down后无Flag边界只输出一次Up() {
  let classifier = FnPhysicalInputClassifier()
  #expect(classifier.classify(hasFnFlag: false, isFnDown: true) == .up)
  #expect(classifier.classify(hasFnFlag: false, isFnDown: false) == nil)
}

@Test("reset 期间的遗留 release 被忽略")
func reset期间的遗留Release被忽略() {
  let classifier = FnPhysicalInputClassifier()

  #expect(classifier.classify(hasFnFlag: true, isFnDown: false) == .down)
  // reducer reset 后 isFnDown 已清空，遗留 release 不得反向生成 down
  #expect(classifier.classify(hasFnFlag: false, isFnDown: false) == nil)
}

@Test("reset 后下一次可信 down/up 正常")
func reset后下一次可信DownUp正常() {
  let classifier = FnPhysicalInputClassifier()

  #expect(classifier.classify(hasFnFlag: false, isFnDown: false) == nil)
  #expect(classifier.classify(hasFnFlag: true, isFnDown: false) == .down)
  #expect(classifier.classify(hasFnFlag: false, isFnDown: true) == .up)
}

@Test("连续 reset 后无 flag 边界仍被忽略")
func 连续Reset后无Flag边界仍被忽略() {
  let classifier = FnPhysicalInputClassifier()

  #expect(classifier.classify(hasFnFlag: false, isFnDown: false) == nil)
  #expect(classifier.classify(hasFnFlag: false, isFnDown: false) == nil)
}
