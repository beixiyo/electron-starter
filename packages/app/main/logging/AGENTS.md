## 日志入口

日志默认写入：

```text
~/.electron-app/logs/<sessionId>/app.jsonl
```

主进程统一使用 `createMainDiagnosticLogger(module)`，renderer 使用
`createRendererFeatureLogger(module)`。业务模块不得直接写日志文件

每条关键日志使用稳定的 `module` 和点号分层 `event`，关联数据放入结构化字段，
不要只拼进 `msg`

## 隐私边界

禁止记录音频、转写正文、用户输入、token、cookie、Authorization、密码、密钥、
完整请求头、截图内容或大段业务 payload。需要判断内容是否存在时，只记录布尔值、
数量或长度

## 生命周期

每次启动创建独立 session。单文件按 10 MB 或 1 天轮转，每个 session 最多保留
30 个文件。日志清理不得触碰 `~/.electron-app/recordings/pending`
