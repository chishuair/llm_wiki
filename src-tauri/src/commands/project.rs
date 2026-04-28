use std::fs;
use std::path::Path;

use chrono::Local;

use crate::panic_guard::run_guarded;
use crate::types::wiki::WikiProject;

#[tauri::command]
pub fn create_project(name: String, path: String) -> Result<WikiProject, String> {
    run_guarded("create_project", || create_project_impl(name, path))
}

fn create_project_impl(name: String, path: String) -> Result<WikiProject, String> {
    let root = Path::new(&path).join(&name);

    if root.exists() {
        return Err(format!("Directory already exists: '{}'", root.display()));
    }

    // Create all required subdirectories
    let dirs = [
        "raw/sources",
        "raw/assets",
        "wiki/案情概述",
        "wiki/当事人信息",
        "wiki/证据清单",
        "wiki/争议焦点",
        "wiki/法院认定事实",
        "wiki/本院认为",
        "wiki/法律依据",
        "wiki/判决结果",
        "wiki/审理过程",
    ];
    for dir in &dirs {
        fs::create_dir_all(root.join(dir))
            .map_err(|e| format!("Failed to create directory '{}': {}", dir, e))?;
    }

    let today = Local::now().format("%Y-%m-%d").to_string();

    // schema.md
    let schema_content = format!(
        r#"# 案件知识库结构规范

## 页面类型（预设）

| 页面类型 | 目录 | 用途说明 |
|---|---|---|
| 案情概述 | wiki/案情概述/ | 记录案件基本事实、时间线与程序进展摘要 |
| 当事人信息 | wiki/当事人信息/ | 记录原告、被告、第三人及其代理人信息 |
| 证据清单 | wiki/证据清单/ | 记录证据名称、来源、证明目的、质证意见 |
| 争议焦点 | wiki/争议焦点/ | 归纳审理中需解决的核心争议问题 |
| 法院认定事实 | wiki/法院认定事实/ | 形成经审查认定的客观事实 |
| 本院认为 | wiki/本院认为/ | 形成裁判说理，阐明法律适用逻辑 |
| 法律依据 | wiki/法律依据/ | 记录适用条款、司法解释与裁判规则 |
| 判决结果 | wiki/判决结果/ | 记录主文、履行义务、诉讼费用承担 |
| 审理过程 | wiki/审理过程/ | 记录立案、开庭、举证质证、合议等节点 |
| 庭审笔录 | wiki/庭审笔录/ | 存放整理后的单次庭审或多次合并笔录 |

## 命名规范

- 文件统一使用：`YYYYMMDD-主题.md`
- 每个页面必须包含：案号、页面类型、更新时间
- 文件名应简洁明确，避免口语化和模糊描述

## Frontmatter 规范

```yaml
---
type: 案情概述 | 当事人信息 | 证据清单 | 争议焦点 | 法院认定事实 | 本院认为 | 法律依据 | 判决结果 | 审理过程 | 庭审笔录
title: 页面标题
case_number: （2026）某法民初XX号
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## 索引文件规范

`wiki/index.md` 按页面类型分组列出全部页面，单行格式如下：
```
- [[页面文件名]] — 一句话说明
```

## 交叉引用规则

- 页面之间统一使用 `[[页面文件名]]` 链接
- 争议焦点必须链接对应证据、事实认定和法律依据页面
- 判决结果页面必须链接本院认为与法律依据页面
- 审理过程页面应链接关键程序节点相关材料
"#
    );
    write_file_inner(root.join("schema.md"), &schema_content)?;

    // purpose.md
    let purpose_content = r#"# 案件知识库建设目标

## 基本信息

- 案件名称：
- 案号：
- 承办法官：
- 审判组织：

## 建库目的

本案件知识库用于服务案件审理全流程，确保事实归纳、证据审查、法律适用与裁判说理可追溯、可复核、可沉淀。

## 工作原则

1. 以事实为基础，以法律为准绳。
2. 材料记录真实完整，引用链路清晰。
3. 裁判结论与证据、事实、法条一一对应。

## 重点审查事项

1. 争议焦点是否完整、准确。
2. 证据三性审查是否充分。
3. 事实认定是否与证据对应。
4. 说理论证是否充分、规范。
5. 法律依据是否准确、现行、适用恰当。

## 当前阶段

> 待完善（请根据审理进度及时更新）
"#;
    write_file_inner(root.join("purpose.md"), purpose_content)?;

    // wiki/index.md
    let index_content = r#"# 案件知识库索引

## 案情概述

## 当事人信息

## 证据清单

## 争议焦点

## 法院认定事实

## 本院认为

## 法律依据

## 判决结果

## 审理过程

## 庭审笔录
"#;
    write_file_inner(root.join("wiki/index.md"), index_content)?;

    // wiki/log.md
    let log_content = format!(
        r#"# 审理工作日志

## {today}

- 已创建案件知识库
"#
    );
    write_file_inner(root.join("wiki/log.md"), &log_content)?;

    // wiki/overview.md
    let overview_content = r#"---
type: 案情概述
title: 案件总览
case_number: （2026）某法民初XX号
tags: []
related: []
---

# 案件总览

<!-- 请概述本案基本事实、争议焦点与当前审理进展。 -->
"#;
    write_file_inner(root.join("wiki/overview.md"), overview_content)?;

    // .obsidian config for Obsidian compatibility
    fs::create_dir_all(root.join(".obsidian"))
        .map_err(|e| format!("Failed to create .obsidian: {}", e))?;

    // Obsidian app config: set attachment folder, exclude hidden dirs
    let obsidian_app_config = r#"{
  "attachmentFolderPath": "raw/assets",
  "userIgnoreFilters": [
    ".cache",
    ".llm-wiki",
    ".superpowers"
  ],
  "useMarkdownLinks": false,
  "newLinkFormat": "shortest",
  "showUnsupportedFiles": false
}"#;
    write_file_inner(root.join(".obsidian/app.json"), obsidian_app_config)?;

    // Obsidian appearance: dark mode
    let obsidian_appearance = r#"{
  "baseFontSize": 16,
  "theme": "obsidian"
}"#;
    write_file_inner(root.join(".obsidian/appearance.json"), obsidian_appearance)?;

    // Enable graph view and backlinks core plugins
    let obsidian_core_plugins = r#"{
  "file-explorer": true,
  "global-search": true,
  "graph": true,
  "backlink": true,
  "tag-pane": true,
  "page-preview": true,
  "outgoing-link": true,
  "starred": true
}"#;
    write_file_inner(root.join(".obsidian/core-plugins.json"), obsidian_core_plugins)?;

    Ok(WikiProject {
        name,
        // Forward slashes for cross-platform consistency in the TS layer.
        path: root.to_string_lossy().replace('\\', "/"),
    })
}

#[tauri::command]
pub fn open_project(path: String) -> Result<WikiProject, String> {
    run_guarded("open_project", || {
        let root = Path::new(&path);

        if !root.exists() {
            return Err(format!("Path does not exist: '{}'", path));
        }
        if !root.is_dir() {
            return Err(format!("Path is not a directory: '{}'", path));
        }

        // Validate that this looks like a wiki project
        if !root.join("schema.md").exists() {
            return Err(format!(
                "Not a valid wiki project (missing schema.md): '{}'",
                path
            ));
        }
        if !root.join("wiki").is_dir() {
            return Err(format!(
                "Not a valid wiki project (missing wiki/ directory): '{}'",
                path
            ));
        }

        // Derive project name from the directory name
        let name = root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();

        Ok(WikiProject {
            name,
            // Forward slashes for cross-platform consistency in the TS layer.
            path: path.replace('\\', "/"),
        })
    })
}

fn write_file_inner(path: std::path::PathBuf, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dirs for '{}': {}", path.display(), e))?;
    }
    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write file '{}': {}", path.display(), e))
}
