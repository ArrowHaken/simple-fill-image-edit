# CatsCo 图片编辑工作台 Artifact

这是把同事交接的 `simple-fill-image-edit` 工作台收敛成 XiaoBa 可启动的
service-backed mini app。它保留现有的真实链路：

```text
上传原图 → SAM3 语义/点选 → Image2 原生 mask → 安全范围回填 → 版本记录
```

Artifact 本身不携带 API key，也不会把图片、任务记录或服务器凭据打进包内。
运行时需要由 XiaoBa/部署环境注入 `WAVESPEED_API_KEY` 和 CatsCo 网关认证配置。

## 启动

在解包后的项目根目录运行：

```powershell
Copy-Item .env.example .env -ErrorAction SilentlyContinue
$env:WAVESPEED_API_KEY = '<runtime-secret>'
$env:CATSCO_MASKED_IMAGE2_BASE_URL = 'https://app.catsco.cc/v1'
$env:CATSCO_MASKED_IMAGE2_TRANSPORT = 'json-data-url'
$env:CATSCO_MASKED_IMAGE2_AUTH_SCHEME = 'ApiKey'
$env:CATSCO_MASKED_IMAGE2_ROUTE_HEADER_NAME = 'X-CatsCo-Image-Provider'
$env:CATSCO_MASKED_IMAGE2_ROUTE_HEADER_VALUE = 'image2'
$env:CATSCO_MASKED_IMAGE2_API_KEY_FILE = '<runtime-secret-file>'
python run.py
```

然后将 `http://127.0.0.1:7862/` 作为 XiaoBa Artifact 页面入口。

## XiaoBa 编排约定

- 用户说“选中/修改/替换/去掉图片中的……”时，先打开本 Artifact。
- 优先使用短英文对象名调用 SAM3（例如 `glasses`、`book`、`hair`），中文作为界面提示即可。
- 先确认蒙版覆盖范围，再提交付费 Image2 任务；不要因本地轮询超时立即重复提交。
- 默认参数使用 `dilation=6`、`growth_ratio=0.35`、`feather=3`。
- 结果由后端在安全编辑范围内回填，范围外像素保持原图；任务页保留 provider 原图和中间产物供复核。

## 边界

这是一个需要后端运行时的 Artifact，不是可脱离服务的纯静态 HTML。若部署环境只支持
静态 Artifact，应把页面指向同一受保护域名下的工作台服务，不能把密钥写进前端。
