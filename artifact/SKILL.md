---
name: catsco-image-edit-workbench
description: Open and operate the CatsCo image asset workbench for semantic selection, masked edits with automatic Dreamina fallback, and versioned image results.
invocable: user
---

# CatsCo 图片素材工作台

当用户要求“编辑这张图、替换某个物体、去掉局部内容或做海报局部重绘”时，使用本 Artifact
作为交互工作台。先让用户上传或选中原图，再在画布中确认 SAM3 蒙版，最后提交图片
编辑任务。默认由 CatsCo 网关调用 Image2，遇到超时、429、5xx 或线路不可用时自动切换即梦。

## 操作约定

- 默认走 `simple_fill`，参数 `dilation=6`、`growth_ratio=0.35`、`feather=3`。
- 中文对象名先转换为简短英文语义词（如 `眼镜 → glasses`、`书 → book`）。
- 普通点击是目标点，Shift+点击是排除点；点选后仍要先预览蒙版。
- 标题、广告文案和装饰字体不要依赖完整中文句子做 SAM3 语义识别；切换“拖拽框选”，框出完整文字区域后再预览。若 SAM3 无法细化，后端会保留用户框选范围。
- 不要因为浏览器轮询超时就重复提交付费任务；先查看任务记录和已有远端结果。
- 即梦异步任务号必须持久化并继续轮询；一次任务最多从 Image2 切换到即梦一次。
- 用户要求保持不变的区域由后端安全编辑范围和最终回填逻辑保护。

## 不做的事

- 不在 Artifact 文件中写入 API key、SSH key 或真实用户图片。
- 不直接修改 CatsCo 生产服务器配置。
- 不把供应商原图当作最终结果；最终结果必须经过后端范围回填。
