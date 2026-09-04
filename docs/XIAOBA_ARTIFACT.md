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
- 未部署到生产服务器；需要由 XiaoBa worker 或受保护的 CatsCo 服务托管。
- Artifact 包不包含 API key、SSH 密钥、真实图片和历史任务数据。

## 下一步接入

1. 在 XiaoBa 的 mini-app/artifact 运行环境中解包并安装 Python 依赖。
2. 通过运行时 Secret 注入 WaveSpeed 与 CatsCo 网关认证。
3. 启动 `python run.py`，把 Artifact URL 绑定到当前会话。
4. 用海报样例验证一次 `glasses → remove` 或 `book → white cat`。
