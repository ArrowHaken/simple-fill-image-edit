---
name: catsco-image-edit-workbench
description: Open and operate the CatsCo image editing workbench for semantic selection, masked Image2 edits, and versioned image results.
invocable: user
---

# CatsCo 图片编辑工作台

当用户要求“编辑这张图、替换某个物体、去掉局部内容或做海报局部重绘”时，使用本 Artifact
作为交互工作台。先让用户上传或选中原图，再在画布中确认 SAM3 蒙版，最后提交 Image2
原生 mask 任务。

## 操作约定

- 默认走 `simple_fill`，参数 `dilation=6`、`growth_ratio=0.35`、`feather=3`。
- 中文对象名先转换为简短英文语义词（如 `眼镜 → glasses`、`书 → book`）。
- 普通点击是目标点，Shift+点击是排除点；点选后仍要先预览蒙版。
- 不要因为浏览器轮询超时就重复提交付费任务；先查看任务记录和已有远端结果。
- 用户要求保持不变的区域由后端安全编辑范围和最终回填逻辑保护。

## 不做的事

- 不在 Artifact 文件中写入 API key、SSH key 或真实用户图片。
- 不直接修改 CatsCo 生产服务器配置。
- 不把供应商原图当作最终结果；最终结果必须经过后端范围回填。
