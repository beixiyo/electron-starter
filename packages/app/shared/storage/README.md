# Electron Storage

这个目录是 Electron 端持久化的统一定位入口

它不把所有数据强行写进同一个物理目录，而是维护一张存储地图，说明每类数据：

- 写在哪里
- 由 main 还是 renderer 负责
- 是否按账号隔离
- 登出是否清理
- TTL 和敏感数据边界
- 对应代码入口

## 规则

- 对外只从 `index.ts` 统一导入 storage 能力，避免直接依赖内部文件结构
- 新增持久化前，先在 `constants.ts` 登记存储区
- main 侧路径、目录创建、JSON 读写统一走 `main/storage/`
- renderer 侧 IndexedDB 实例统一走 `renderer/services/storage/`
- localStorage 只放轻量偏好、auth cache 和开发调试状态
- 本目录必须保持跨端安全，不引入 `fs`、`electron`、`localforage`、`window`、`react`
