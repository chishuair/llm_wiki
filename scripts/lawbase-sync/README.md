# 离线法规包制作工具

本目录用于在**外网电脑**制作法规包，再拷贝到法院内网电脑，在应用的「法律依据」页面中导入。

应用本身不联网；下载、解析、打包工作应在外网或受控环境完成。

## 输入方式

### 方式一：使用已经下载好的 Word 文件

把从国家法律法规数据库下载的 `.docx` 文件放入某个目录，例如：

```bash
downloaded-laws/
  中华人民共和国民法典.docx
  中华人民共和国民事诉讼法.docx
```

执行：

```bash
npm run lawbase:pack -- --input-dir downloaded-laws --output-dir lawbase-pack
```

生成：

```text
lawbase-pack/
  lawbase-pack.json
  manifest.json
  raw/
  compiled/
```

把 `lawbase-pack/lawbase-pack.json` 拷贝到内网电脑，在应用「法律依据」页面点击「导入法规包」即可。

## 方式二：使用下载链接清单

准备 `urls.txt`，每行一个官方 Word 下载链接：

```text
https://flk.npc.gov.cn/...
https://flk.npc.gov.cn/...
```

执行：

```bash
npm run lawbase:pack -- --url-list urls.txt --output-dir lawbase-pack
```

脚本会将原始文件保存到 `raw/`，并生成法规包。

## 方式三：自动发现国家法律法规数据库列表

脚本也可以调用当前公开可访问的 `law-search` 接口自动发现并下载 Word 文件：

```bash
npm run lawbase:pack -- \
  --discover-flk \
  --discover-page-size 20 \
  --discover-max-pages 10 \
  --output-dir lawbase-pack
```

参数说明：

- `--discover-page-size`：每页下载数量，建议 10-20。
- `--discover-start-page`：起始页（默认 1）。
- `--discover-end-page`：结束页（包含），用于按页段分批执行；`0` 表示不限。
- `--discover-max-pages`：最多下载页数。`0` 表示直到列表结束。
- `--discover-search`：可选关键词，例如只下载包含“民法典”的结果。
- `--delay`：每个文件下载后的等待秒数，默认 0.8 秒。
- `--discover-resume`：从上次进度文件继续（断点续跑）。
- `--discover-retries`：单个文件下载失败时重试次数，默认 2。
- `--list-retries`：列表页请求失败重试次数，默认 3。
- `--cooldown-on-redirect`：遇到临时重定向/疑似限流后的冷却秒数，默认 60。
- `--max-consecutive-download-failures`：连续多少个法规下载失败后进入冷却，默认 8。
- `--retry-failures`：先读取并重跑 `download-failures.json` 中的失败项。
- `--compile-incremental`：仅编译新增/变更原件，复用历史编译结果。
- `--core-profile`：先下载预设核心法清单，再进入自动发现/编译。当前支持：`court-basic`、`court-medical`。

先小范围试跑：

```bash
npm run lawbase:pack -- --discover-flk --discover-page-size 1 --discover-max-pages 1 --output-dir lawbase-pack-test
```

确认能下载、解析、导入后，再逐步扩大页数。

推荐全量场景命令（更稳）：

```bash
npm run lawbase:pack -- \
  --discover-flk \
  --discover-resume \
  --discover-retries 3 \
  --discover-page-size 20 \
  --delay 2.0 \
  --cooldown-on-redirect 90 \
  --output-dir lawbase-pack
```

核心法优先包（建议先跑）：

```bash
npm run lawbase:pack -- \
  --core-profile court-basic \
  --compile-incremental \
  --output-dir lawbase-pack-core
```

说明：

- `court-basic` 会优先下载法院高频基础法、行政法规和若干核心司法解释。
- 适合先做一套“全国性核心法 + 高频程序法 + 医疗事故/证据规则”的基础包，再叠加地方性法规。
- 若后续还要补地方性法规，可再在同一输出目录上执行 `--discover-flk`。

医疗专题包示例：

```bash
npm run lawbase:pack -- \
  --core-profile court-medical \
  --compile-incremental \
  --output-dir lawbase-pack-medical
```

说明：

- `court-medical` 会优先下载医疗事故/医疗纠纷案件常用法律、行政法规和证据规则。
- 适合医疗损害责任纠纷、医疗事故争议等案件先行导入。

分批下载示例（适合 2-3 万条规模）：

```bash
# 第一批：1-100 页
npm run lawbase:pack -- \
  --discover-flk \
  --discover-start-page 1 \
  --discover-end-page 100 \
  --discover-retries 3 \
  --compile-incremental \
  --delay 1.0 \
  --output-dir lawbase-pack

# 第二批：101-200 页（同一输出目录，自动跳过已下载）
npm run lawbase:pack -- \
  --discover-flk \
  --discover-start-page 101 \
  --discover-end-page 200 \
  --discover-retries 3 \
  --delay 1.0 \
  --output-dir lawbase-pack
```

断点续跑与去重机制：

- 脚本会在输出目录写入 `discover-progress.json`，记录下一页位置。
- 脚本会在输出目录写入 `download-index.json`，按 `bbbs` 记录已下载文件。
- 脚本会在输出目录写入 `reports/discover-report-*.json`，记录本批统计结果。
- 列表页连续失败会记录到 `list-page-failures.json`，并停在当前页，稍后可继续断点续跑。
- 开启 `--discover-resume` 后，会自动从进度页继续，且已下载法规会自动跳过。
- 若中断（断网/关机），重新执行同一命令即可继续。

失败项补跑（推荐在每批后执行一次）：

```bash
npm run lawbase:pack -- \
  --retry-failures \
  --discover-retries 3 \
  --compile-incremental \
  --delay 1.0 \
  --output-dir lawbase-pack
```

说明：

- 重跑成功的条目会写入 `download-index.json` 并参与后续去重。
- 重跑失败的条目会保留在 `download-failures.json`，并附加 `retry_error` 字段。
- 可与 `--discover-flk` 同时使用：先补失败，再跑新页。

增量编译说明：

- 开启 `--compile-incremental` 后，会在输出目录写入 `compile-state.json`。
- 脚本根据原件文件名 + 文件签名（大小/修改时间）判断是否需要重编译。
- 删除原件后，对应旧记录会在下次执行时自动清理。
- 建议批量场景固定开启，可显著减少重复编译耗时。

## 注意事项

- 只下载公开、可访问、无需绕过验证码或登录的官方文件。
- 不要高频并发请求；本工具按顺序下载，并默认设置延迟。
- 下载后会保留原始 Word 文件，便于人工核对。
- 条文解析基于“第X条”格式，特殊格式文件可能需要人工复核。
- 法规包导入时，同名法律会更新替换旧版本。
- 国家法律法规数据库前端接口可能调整；若发现失败，请先用小页数测试。脚本已尽量模拟浏览器请求头以减少临时重定向。

