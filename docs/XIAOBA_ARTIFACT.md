# XiaoBa Artifact 交付说明

## 已收敛内容

Artifact 入口是 `artifact/manifest.json`，实际页面由现有 FastAPI 工作台提供。这样可以
保留 SAM3、Image2 relay、任务持久化和像素锁定，而不会把私密密钥塞进浏览器静态包。

## 交付文件

- `artifact/manifest.json`：XiaoBa mini-app 元数据与运行契约。
- `artifact/README.md`：启动、编排和安全边界。
- `artifact/start.ps1`：本地/worker 启动检查。
- `app/static/`：工作台 UI。
- `app/`、`run.py`、`requirements.txt`：后端运行时。

## 当前状态

- 已验证上传、SAM3 目标分割、CatsCo JSON 原生蒙版 Image2、结果回填。
- 已验证编辑范围外像素不被提交结果污染。
- 已部署到天选打工仔的独立 systemd 服务（仅监听 `127.0.0.1:20001`）。
- 已注册到天选打工仔的 `cloud-html-artifact` 索引，正式 Artifact 当前为 v20；静态页面通过同域 API 路由调用该服务。
- 已按交接包白猫基线补强短句替换 Prompt，并缓存不可变媒体、减少重复缩略图请求和任务轮询负载。
- v4 增加画布拖拽矩形框选；对标题/装饰文字，SAM3 失败时保留用户框选矩形作为空间蒙版继续流程。
- v5 将拖拽框选作为确定性的空间蒙版直接使用，跳过不必要的 SAM3 等待和文字误分割；点选/名称模式仍使用 SAM3。
- v20 接入 CatsCo `auto` 路由：Image2 超时、429、5xx 或线路不可用时切换即梦，并持久化异步任务号后继续轮询；参数错误、内容审核与格式错误不触发兜底。
- Artifact 包不包含 API key、SSH 密钥、真实图片和历史任务数据。

## 当前交付入口

- URL：`https://agent-407.artifacts.catsco.fun:19991/artifacts/catsco-image-edit-workbench/latest/`
- 该入口已出现在共享 Artifact 索引中，不需要额外账密。
- v3 会把“改成一只猫”这类短句结合已选目标自动扩展为“完整替换、清除旧对象、保持构图/人物/手部关系”的生成约束；用户原始输入仍保存在任务记录中。
- 另保留 `/catsco-image-edit/` Basic Auth 调试入口，供排查新版本服务；未改动原有 Artifact、visual workspace 或 CatsCo agent 路由。

## 下一步接入

1. 在 XiaoBa 的 mini-app/artifact 运行环境中解包并安装 Python 依赖。
2. 通过运行时 Secret 注入 WaveSpeed 与 CatsCo 网关认证。
3. 将 Artifact 任务桥接进一步接入 XiaoBa 会话级任务状态（当前页面已可独立调用同域 API）。
4. 用广告素材样例继续收集提示词、分割覆盖率和成图质量数据。
