# AI Case Wiki

本项目是一个 Tauri + React + TypeScript + Rust 桌面应用，定位为“本地离线法律案件知识库”。它面向法院、律所、企业法务等内网或弱网环境，用于管理案件材料、识别扫描件、查询本地法规库，并在用户配置已有模型接口后生成可追溯的案件 Wiki 与法律文书辅助内容。

## 产品定位

AI Case Wiki 的核心目标是：安装包自带运行所需的本地法律知识与文档解析能力，用户安装后即使没有互联网，也可以导入文件、执行 OCR、查看法规库和离线帮助文档。

应用不会内置、下载或强制安装大语言模型。用户如果需要 AI 分析、Wiki 生成、证据提炼或文书辅助，应在设置页配置自己已有的模型接口，例如本机 Ollama、内网 OpenAI 兼容服务，或组织统一提供的模型网关。

## 离线能力边界

必须内置或随安装包提供：

- 应用本体
- 法律法规库
- PaddleOCR sidecar 与 OCR 模型
- PDFium / PDF 解析能力
- Office 文档解析能力
- 离线帮助文档

明确不做：

- 不内置 Qwen / DeepSeek / Llama 等大语言模型
- 不自动下载模型
- 不强制安装 Ollama
- 不要求用户安装 Python
- 不要求用户 `pip install PaddleOCR`
- 不要求用户手动下载法规库

## 当前最小闭环

当前版本先完成离线安装的基础可见性：

- 检测内置法规库是否可用，并显示版本、条文数量和来源路径
- 检测内置 OCR sidecar 是否存在，并显示系统 OCR 兜底状态
- 检测 PDFium 是否可用
- 在设置页展示“本地能力状态”
- 模型未配置时，仍允许导入文件、预处理/OCR 和查看法规库

后续再继续实现 PDF 按页 OCR、证据级来源结构、chunk embedding 与离线资源包导入。

## 资源目录约定

离线资源按以下结构组织：

```text
resources/
  lawbase/
  ocr/
  pdfium/
  docs/
```

其中：

- `resources/lawbase/` 放置内置法规库，例如 `lawbase-pack.json` 与 `manifest.json`
- `resources/ocr/` 放置 PaddleOCR sidecar、OCR 模型和运行所需文件
- `resources/pdfium/` 放置 PDFium 动态库或平台相关文件
- `resources/docs/` 放置离线帮助文档

历史构建中的 `lawbase-pack-full/lawbase-pack.json` 仍可作为兼容路径读取，但新的打包资源应逐步迁移到 `resources/lawbase/`。

## 模型配置

设置页支持配置已有模型接口：

- 本机服务：如 `http://localhost:11434`
- 内网服务：如 `http://10.10.1.25:11434/v1`
- 其他 OpenAI 兼容接口

不配置模型时，应用不会阻止基础功能：文件导入、OCR、PDF 文本提取和法规库浏览仍应可用。需要模型的功能会自然降级，例如不自动生成 Wiki 或不执行证据智能提炼。

## 来源追溯目标

AI 生成内容应尽量追溯到原始材料：

- 原始文件路径
- PDF 页码
- OCR 或文本抽取片段
- 后续 `SourceRef` / `SourceChunk` / `ExtractedFact` 结构

在该结构完成前，现有 Wiki 页面仍通过 frontmatter 与原始来源文件建立基础关联。

## 开发

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run tauri dev
```

构建安装包：

```bash
npm run tauri:offline
```

该命令会先校验 `resources/lawbase`、`resources/ocr`、`resources/pdfium` 是否齐备，再执行 Tauri 打包。若只想使用当前已准备好的资源直接打包，也可以运行 `npm run tauri build`。

## GitHub Actions 远程打包

仓库包含 `Build Release Packages` workflow，可在 GitHub Actions 上生成 Windows x64 离线安装包。

手动触发：

1. 打开 GitHub 仓库的 `Actions` 页面。
2. 选择 `Build Release Packages`。
3. 点击 `Run workflow`。
4. 构建完成后，在本次 workflow 的 `Artifacts` 中下载 `ai-case-wiki-windows-x64`。

也可以通过 tag 触发：

```bash
git tag v0.3.4
git push origin v0.3.4
```

远程构建会在 Windows runner 上下载 Windows 版 PDFium、构建 `paddleocr-sidecar.exe`、预热并打包 PaddleOCR 模型，然后生成 Tauri NSIS 安装包。Windows 安装包不内置大语言模型，但会内置法规库、OCR 能力、PDFium 与离线帮助文档。

## 隐私说明

默认目标是本地离线运行。案件材料、OCR 结果和本地法规库应保存在用户本机或用户指定的项目目录中。只有在用户主动配置并使用外部模型接口、搜索接口或组织网关时，相关请求才会发送到对应地址。完全离线模式将进一步限制联网搜索、自动下载和非本地模型调用。
