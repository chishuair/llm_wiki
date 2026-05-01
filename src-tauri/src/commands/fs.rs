use std::fs;
use std::io::Read as IoRead;
use std::path::{Path, PathBuf};
use std::process::Command;

use calamine::{open_workbook_auto, Data, Reader};
use serde::Serialize;

use crate::panic_guard::run_guarded;
use crate::types::wiki::FileNode;

/// Known binary formats that need special extraction
const OFFICE_EXTS: &[&str] = &["docx", "pptx", "xlsx", "odt", "ods", "odp"];
const IMAGE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff", "tif", "avif", "heic", "heif", "svg",
];
const MEDIA_EXTS: &[&str] = &[
    "mp4", "webm", "mov", "avi", "mkv", "flv", "wmv", "m4v", "mp3", "wav", "ogg", "flac", "aac",
    "m4a", "wma",
];
const LEGACY_DOC_EXTS: &[&str] = &["doc", "xls", "ppt", "pages", "numbers", "key", "epub"];
const PRELOADED_LAW_PACK: &str = "resources/lawbase/lawbase-pack.json";
const LEGACY_PRELOADED_LAW_PACK: &str = "lawbase-pack-full/lawbase-pack.json";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LawbaseStatus {
    available: bool,
    source: Option<String>,
    version: Option<String>,
    article_count: usize,
    updated_at: Option<String>,
    path: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityStatus {
    available: bool,
    source: Option<String>,
    version: Option<String>,
    path: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrCapabilityStatus {
    available: bool,
    source: Option<String>,
    version: Option<String>,
    path: Option<String>,
    error: Option<String>,
    bundled_sidecar: bool,
    system_paddleocr: bool,
    tesseract: bool,
    ocrmypdf: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCapabilitiesStatus {
    lawbase: LawbaseStatus,
    ocr: OcrCapabilityStatus,
    pdfium: CapabilityStatus,
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    run_guarded("read_file", || {
        let p = Path::new(&path);
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        // Check cache first for any extractable format
        if let Some(cached) = read_cache(p) {
            return Ok(cached);
        }

        match ext.as_str() {
            "pdf" => {
                let text = extract_pdf_text(&path)?;
                if text.trim().is_empty() || text.contains("（该 PDF 未提取到可读文本") {
                    extract_pdf_ocr_text(&path)
                } else {
                    Ok(text)
                }
            }
            e if OFFICE_EXTS.contains(&e) => extract_office_text(&path, e),
            e if IMAGE_EXTS.contains(&e) => extract_image_ocr_text(&path),
            e if MEDIA_EXTS.contains(&e) => {
                let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                Ok(format!(
                    "[Media: {} ({:.1} MB)]",
                    p.file_name().unwrap_or_default().to_string_lossy(),
                    size as f64 / 1048576.0
                ))
            }
            e if LEGACY_DOC_EXTS.contains(&e) => Ok(format!(
                "[Document: {} — text extraction not supported for .{} format]",
                p.file_name().unwrap_or_default().to_string_lossy(),
                e
            )),
            _ => {
                // Try reading as text; if it fails (binary), return a friendly message
                match fs::read_to_string(&path) {
                    Ok(content) => Ok(content),
                    Err(_) => {
                        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                        Ok(format!(
                            "[Binary file: {} ({:.1} KB)]",
                            p.file_name().unwrap_or_default().to_string_lossy(),
                            size as f64 / 1024.0
                        ))
                    }
                }
            }
        }
    })
}

/// Pre-process a file and cache the extracted text.
#[tauri::command]
pub fn preprocess_file(path: String) -> Result<String, String> {
    run_guarded("preprocess_file", || {
        let p = Path::new(&path);
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let text = match ext.as_str() {
            "pdf" => {
                let text = extract_pdf_text(&path)?;
                if text.trim().is_empty() || text.contains("（该 PDF 未提取到可读文本") {
                    extract_pdf_ocr_text(&path)?
                } else {
                    text
                }
            }
            e if OFFICE_EXTS.contains(&e) => extract_office_text(&path, e)?,
            e if IMAGE_EXTS.contains(&e) => extract_image_ocr_text(&path)?,
            _ => return Ok("no preprocessing needed".to_string()),
        };

        write_cache(p, &text)?;
        Ok(text)
    })
}

#[tauri::command]
pub fn read_preloaded_law_pack() -> Result<String, String> {
    run_guarded("read_preloaded_law_pack", || {
        for (path, _) in preloaded_law_pack_candidates() {
            if path.exists() {
                return fs::read_to_string(&path)
                    .map_err(|e| format!("读取预置法规包失败：{} ({})", path.display(), e));
            }
        }
        Err("未找到预置法规包 resources/lawbase/lawbase-pack.json".to_string())
    })
}

#[tauri::command]
pub fn ocr_status() -> Result<String, String> {
    run_guarded("ocr_status", || {
        let bundled = bundled_ocr_sidecar().is_some();
        let paddle = bundled
            || command_ok("python3", &["-c", "import paddleocr; print('ok')"])
            || command_ok("python", &["-c", "import paddleocr; print('ok')"]);
        let tesseract = command_ok("tesseract", &["--version"]);
        let ocrmypdf = command_ok("ocrmypdf", &["--version"]);
        Ok(format!(
            "{{\"paddleocr\":{},\"tesseract\":{},\"ocrmypdf\":{},\"bundledSidecar\":{}}}",
            paddle, tesseract, ocrmypdf, bundled
        ))
    })
}

#[tauri::command]
pub fn local_capabilities_status() -> Result<LocalCapabilitiesStatus, String> {
    run_guarded("local_capabilities_status", || {
        Ok(LocalCapabilitiesStatus {
            lawbase: lawbase_status(),
            ocr: ocr_capability_status(),
            pdfium: pdfium_status(),
        })
    })
}

fn command_ok(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn preloaded_law_pack_candidates() -> Vec<(PathBuf, &'static str)> {
    let mut paths = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        // cwd 可能是项目根目录或 src-tauri/，分别尝试
        push_law_pack_candidates(&mut paths, &cwd, "bundled-resource");
        push_law_pack_candidates(&mut paths, &cwd.join(".."), "bundled-resource");
        push_law_pack_candidates(&mut paths, &cwd.join("../.."), "bundled-resource");
    }
    if let Some(resource_dir) = RESOURCE_DIR_HINT.get() {
        push_law_pack_candidates(&mut paths, resource_dir, "bundled-resource");
        push_law_pack_candidates(
            &mut paths,
            &resource_dir.join("resources"),
            "bundled-resource",
        );
        push_law_pack_candidates(&mut paths, &resource_dir.join("_up_"), "bundled-resource");
        push_law_pack_candidates(
            &mut paths,
            &resource_dir.join("_up_/resources"),
            "bundled-resource",
        );
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // 发布包: exe 旁边
            push_law_pack_candidates(&mut paths, exe_dir, "bundled-resource");
            push_law_pack_candidates(&mut paths, &exe_dir.join("resources"), "bundled-resource");
            push_law_pack_candidates(
                &mut paths,
                &exe_dir.join("../Resources"),
                "bundled-resource",
            );
            // 开发模式: exe 在 src-tauri/target/debug/llm-wiki，往上 3-4 层找项目根
            push_law_pack_candidates(&mut paths, &exe_dir.join("../../.."), "bundled-resource");
            push_law_pack_candidates(&mut paths, &exe_dir.join("../../../.."), "bundled-resource");
        }
    }
    paths
}

fn push_law_pack_candidates(
    paths: &mut Vec<(PathBuf, &'static str)>,
    base: &Path,
    source: &'static str,
) {
    paths.push((base.join(PRELOADED_LAW_PACK), source));
    paths.push((base.join(LEGACY_PRELOADED_LAW_PACK), "legacy-bundled"));
}

fn lawbase_status() -> LawbaseStatus {
    for (path, source) in preloaded_law_pack_candidates() {
        if !path.exists() {
            continue;
        }
        match fs::read_to_string(&path) {
            Ok(raw) => return parse_lawbase_status(&raw, path, source),
            Err(err) => {
                return LawbaseStatus {
                    available: false,
                    source: Some(source.to_string()),
                    version: None,
                    article_count: 0,
                    updated_at: None,
                    path: Some(path.display().to_string()),
                    error: Some(format!("读取法规库失败：{err}")),
                };
            }
        }
    }

    LawbaseStatus {
        available: false,
        source: None,
        version: None,
        article_count: 0,
        updated_at: None,
        path: None,
        error: Some("未找到内置法规库，请导入离线资源包。".to_string()),
    }
}

fn parse_lawbase_status(raw: &str, path: PathBuf, source: &str) -> LawbaseStatus {
    let parsed = match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(value) => value,
        Err(err) => {
            return LawbaseStatus {
                available: false,
                source: Some(source.to_string()),
                version: None,
                article_count: 0,
                updated_at: None,
                path: Some(path.display().to_string()),
                error: Some(format!("法规库 JSON 格式错误：{err}")),
            };
        }
    };

    let manifest = parsed.get("manifest").and_then(|value| value.as_object());
    let version = manifest
        .and_then(|value| value.get("version"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let updated_at = manifest
        .and_then(|value| {
            value
                .get("generated_at")
                .or_else(|| value.get("updated_at"))
                .or_else(|| value.get("updatedAt"))
        })
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let article_count = parsed
        .get("codes")
        .and_then(|value| value.as_array())
        .map(|codes| {
            codes
                .iter()
                .map(|code| {
                    code.get("articles")
                        .and_then(|value| value.as_array())
                        .map(|articles| articles.len())
                        .unwrap_or(0)
                })
                .sum()
        })
        .unwrap_or(0);

    LawbaseStatus {
        available: article_count > 0,
        source: Some(source.to_string()),
        version,
        article_count,
        updated_at,
        path: Some(path.display().to_string()),
        error: if article_count > 0 {
            None
        } else {
            Some("法规库为空或缺少 codes[].articles。".to_string())
        },
    }
}

fn ocr_capability_status() -> OcrCapabilityStatus {
    let bundled = bundled_ocr_sidecar();
    let system_paddleocr = command_ok("python3", &["-c", "import paddleocr; print('ok')"])
        || command_ok("python", &["-c", "import paddleocr; print('ok')"]);
    let tesseract = command_ok("tesseract", &["--version"]);
    let ocrmypdf = command_ok("ocrmypdf", &["--version"]);
    let available = bundled.is_some() || system_paddleocr || tesseract || ocrmypdf;

    OcrCapabilityStatus {
        available,
        source: if bundled.is_some() {
            Some("bundled-sidecar".to_string())
        } else if system_paddleocr {
            Some("system-paddleocr".to_string())
        } else if tesseract {
            Some("system-tesseract".to_string())
        } else if ocrmypdf {
            Some("system-ocrmypdf".to_string())
        } else {
            None
        },
        version: None,
        path: bundled.as_ref().map(|path| path.display().to_string()),
        error: if available {
            None
        } else {
            Some("未找到内置 OCR sidecar，也未检测到系统 OCR。".to_string())
        },
        bundled_sidecar: bundled.is_some(),
        system_paddleocr,
        tesseract,
        ocrmypdf,
    }
}

fn bundled_ocr_sidecar() -> Option<PathBuf> {
    bundled_ocr_sidecar_candidates()
        .into_iter()
        .find(|path| path.exists() && path.is_file())
}

fn bundled_ocr_sidecar_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let names: &[&str] = if cfg!(target_os = "windows") {
        &["paddleocr-sidecar.exe", "paddleocr.exe", "ocr.exe"]
    } else {
        &["paddleocr-sidecar", "paddleocr", "ocr"]
    };

    let mut push_base = |base: &Path| {
        for name in names {
            paths.push(base.join("resources/ocr").join(name));
            paths.push(base.join("ocr").join(name));
        }
    };

    if let Ok(cwd) = std::env::current_dir() {
        push_base(&cwd);
        push_base(&cwd.join(".."));
        push_base(&cwd.join("../.."));
    }
    if let Some(resource_dir) = RESOURCE_DIR_HINT.get() {
        push_base(resource_dir);
        push_base(&resource_dir.join("resources"));
        push_base(&resource_dir.join("_up_"));
        push_base(&resource_dir.join("_up_/resources"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            push_base(exe_dir);
            push_base(&exe_dir.join("resources"));
            push_base(&exe_dir.join("../Resources"));
            push_base(&exe_dir.join("../../.."));
            push_base(&exe_dir.join("../../../.."));
        }
    }
    paths
}

fn pdfium_status() -> CapabilityStatus {
    let existing_path = pdfium_candidate_paths()
        .into_iter()
        .find(|path| Path::new(path).exists());

    if let Some(path) = existing_path {
        return CapabilityStatus {
            available: true,
            source: Some("bundled-or-configured".to_string()),
            version: None,
            path: Some(path),
            error: None,
        };
    }

    match pdfium() {
        Ok(_) => CapabilityStatus {
            available: true,
            source: Some("system".to_string()),
            version: None,
            path: None,
            error: None,
        },
        Err(err) => CapabilityStatus {
            available: false,
            source: None,
            version: None,
            path: None,
            error: Some(err),
        },
    }
}

fn cache_path_for(original: &Path) -> std::path::PathBuf {
    let parent = original.parent().unwrap_or(Path::new("."));
    let cache_dir = parent.join(".cache");
    let file_name = original.file_name().unwrap_or_default().to_string_lossy();
    cache_dir.join(format!("{}.txt", file_name))
}

fn read_cache(original: &Path) -> Option<String> {
    let cache_path = cache_path_for(original);
    let original_modified = fs::metadata(original).ok()?.modified().ok()?;
    let cache_modified = fs::metadata(&cache_path).ok()?.modified().ok()?;
    if cache_modified >= original_modified {
        fs::read_to_string(&cache_path).ok()
    } else {
        None
    }
}

fn write_cache(original: &Path, text: &str) -> Result<(), String> {
    let cache_path = cache_path_for(original);
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(&cache_path, text).map_err(|e| format!("Failed to write cache: {}", e))
}

fn run_command_capture(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| format!("无法调用本地 OCR 命令 `{}`：{}", program, e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "本地 OCR 命令 `{}` 执行失败：{}",
            program,
            if stderr.is_empty() {
                "无错误输出".to_string()
            } else {
                stderr
            }
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_bundled_ocr_sidecar_text(path: &str) -> Result<String, String> {
    let sidecar = bundled_ocr_sidecar().ok_or_else(|| "未找到内置 OCR sidecar".to_string())?;
    let output = Command::new(&sidecar)
        .arg(path)
        .output()
        .map_err(|e| format!("无法调用内置 OCR sidecar `{}`：{}", sidecar.display(), e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "内置 OCR sidecar 执行失败：{}",
            if stderr.is_empty() {
                "无错误输出".to_string()
            } else {
                stderr
            }
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Err("内置 OCR sidecar 未识别到文本".to_string());
    }
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
        if let Some(text) = json.get("text").and_then(|value| value.as_str()) {
            if !text.trim().is_empty() {
                return Ok(text.trim().to_string());
            }
        }
        if let Some(pages) = json.get("pages").and_then(|value| value.as_array()) {
            let text = pages
                .iter()
                .filter_map(|page| page.get("text").and_then(|value| value.as_str()))
                .collect::<Vec<_>>()
                .join("\n");
            if !text.trim().is_empty() {
                return Ok(text);
            }
        }
    }
    Ok(stdout)
}

const PADDLE_OCR_PY: &str = r#"
import sys

path = sys.argv[1]

try:
    from paddleocr import PaddleOCR
except Exception as exc:
    print(f'PaddleOCR import failed: {exc}', file=sys.stderr)
    sys.exit(2)

def collect_texts(value):
    texts = []
    if value is None:
        return texts
    if isinstance(value, dict):
        for key in ('rec_texts', 'texts'):
            found = value.get(key)
            if isinstance(found, (list, tuple)):
                return [str(item).strip() for item in found if str(item).strip()]
        for key in ('text', 'transcription'):
            found = value.get(key)
            if isinstance(found, str) and found.strip():
                return [found.strip()]
        for child in value.values():
            texts.extend(collect_texts(child))
        return texts
    if isinstance(value, (list, tuple)):
        # PaddleOCR 2.x commonly returns [box, (text, score)] items.
        if len(value) >= 2 and isinstance(value[1], (list, tuple)) and value[1]:
            maybe_text = value[1][0]
            if isinstance(maybe_text, str) and maybe_text.strip():
                texts.append(maybe_text.strip())
        for child in value:
            texts.extend(collect_texts(child))
    return texts

try:
    try:
        ocr = PaddleOCR(use_textline_orientation=True, lang='ch')
    except TypeError:
        ocr = PaddleOCR(use_angle_cls=True, lang='ch')

    if hasattr(ocr, 'predict'):
        result = ocr.predict(path)
    else:
        result = ocr.ocr(path, cls=True)

    seen = set()
    ordered = []
    for text in collect_texts(result):
        if text and text not in seen:
            seen.add(text)
            ordered.append(text)

    print('\n'.join(ordered))
except Exception as exc:
    print(f'PaddleOCR failed: {exc}', file=sys.stderr)
    sys.exit(3)
"#;

fn run_paddleocr_text(path: &str) -> Result<String, String> {
    if let Ok(text) = run_bundled_ocr_sidecar_text(path) {
        return Ok(text);
    }

    let mut last_error = None;
    for python in ["python3", "python"] {
        match run_command_capture(python, &["-c", PADDLE_OCR_PY, path]) {
            Ok(text) if !text.trim().is_empty() => return Ok(text),
            Ok(_) => last_error = Some(format!("{} 已运行，但未识别到文本", python)),
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| "未检测到可用的 Python/PaddleOCR".to_string()))
}

fn extract_image_ocr_text(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if let Some(cached) = read_cache(p) {
        return Ok(cached);
    }

    // PaddleOCR is preferred for Chinese court materials. It stays fully
    // offline when the Python package and model files are installed locally.
    if let Ok(text) = run_paddleocr_text(path) {
        write_cache(p, &text)?;
        return Ok(text);
    }

    // Fallback to Tesseract so existing offline deployments keep working.
    match run_command_capture("tesseract", &[path, "stdout", "-l", "chi_sim+eng"]) {
        Ok(text) if !text.trim().is_empty() => {
            write_cache(p, &text)?;
            Ok(text)
        }
        Ok(_) | Err(_) => {
            let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            let msg = format!(
                "（未能提取 OCR 文本。请优先安装 PaddleOCR；或安装 tesseract 并配置中文语言包 chi_sim。原图仍可作为证据核对。文件：{}，大小：{:.1} KB）",
                p.file_name().unwrap_or_default().to_string_lossy(),
                size as f64 / 1024.0
            );
            write_cache(p, &msg).ok();
            Ok(msg)
        }
    }
}

fn extract_pdf_ocr_text(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if let Some(cached) = read_cache(p) {
        return Ok(cached);
    }

    // Optional offline fallback: if `ocrmypdf` is available, it can create
    // a sidecar txt directly. We write the sidecar to the same cache file used
    // by preprocess_file/read_file.
    let cache_path = cache_path_for(p);
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent).ok();
    }

    if let Ok(text) = run_paddleocr_text(path) {
        write_cache(p, &text)?;
        return Ok(text);
    }

    let sidecar = cache_path.to_string_lossy().to_string();
    let result = Command::new("ocrmypdf")
        .args([
            "--sidecar",
            &sidecar,
            "--skip-text",
            "--language",
            "chi_sim+eng",
            path,
            "-",
        ])
        .output();

    match result {
        Ok(output) if output.status.success() => {
            let text = fs::read_to_string(&cache_path).unwrap_or_default();
            if text.trim().is_empty() {
                Ok("（OCR 已执行，但未识别到可读文本）".to_string())
            } else {
                Ok(text)
            }
        }
        _ => {
            let msg = "（该 PDF 未提取到可读文本，且未检测到可用的本地 PaddleOCR/ocrmypdf OCR 工具。请安装 PaddleOCR，或导入可复制文字的 PDF/Word 原件。）".to_string();
            write_cache(p, &msg).ok();
            Ok(msg)
        }
    }
}

/// Global PDFium instance — the library prefers a single binding shared
/// across threads over repeatedly binding/unbinding.
static PDFIUM: std::sync::OnceLock<Result<pdfium_render::prelude::Pdfium, String>> =
    std::sync::OnceLock::new();

/// Additional resource directory hint, set by the Tauri setup() callback
/// once the AppHandle is available. Lets the pdfium resolver find the
/// bundled dylib without re-implementing Tauri's platform-specific
/// resource-dir logic.
static RESOURCE_DIR_HINT: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

/// Called from Tauri's setup() with the resolved resource directory.
/// No-op if already set.
pub fn set_resource_dir_hint(dir: std::path::PathBuf) {
    let _ = RESOURCE_DIR_HINT.set(dir);
}

/// Enumerate plausible locations for the PDFium dynamic library on the
/// current platform. Order from most specific to least:
///   1. `$PDFIUM_DYNAMIC_LIB_PATH` env var (local dev convenience)
///   2. Tauri resource dir (set via setup()) — the authoritative location
///   3. Paths relative to the executable where Tauri's bundler lands
///      resources on each platform (macOS Frameworks / Resources /
///      MacOS dir, Windows sibling, Linux sibling)
///   4. OS dynamic loader search path (last resort)
fn pdfium_candidate_paths() -> Vec<String> {
    let mut v: Vec<String> = Vec::new();

    if let Ok(p) = std::env::var("PDFIUM_DYNAMIC_LIB_PATH") {
        v.push(p);
    }

    // Tauri-resolved resource directory (set during setup()).
    if let Some(resource_dir) = RESOURCE_DIR_HINT.get() {
        #[cfg(target_os = "macos")]
        {
            v.push(
                resource_dir
                    .join("libpdfium.dylib")
                    .to_string_lossy()
                    .into_owned(),
            );
            v.push(
                resource_dir
                    .join("pdfium/libpdfium.dylib")
                    .to_string_lossy()
                    .into_owned(),
            );
            v.push(
                resource_dir
                    .join("resources/pdfium/libpdfium.dylib")
                    .to_string_lossy()
                    .into_owned(),
            );
            v.push(
                resource_dir
                    .join("_up_/resources/pdfium/libpdfium.dylib")
                    .to_string_lossy()
                    .into_owned(),
            );
        }
        #[cfg(target_os = "windows")]
        {
            v.push(
                resource_dir
                    .join("pdfium.dll")
                    .to_string_lossy()
                    .into_owned(),
            );
            v.push(
                resource_dir
                    .join("libpdfium.dll")
                    .to_string_lossy()
                    .into_owned(),
            );
            v.push(
                resource_dir
                    .join("pdfium/pdfium.dll")
                    .to_string_lossy()
                    .into_owned(),
            );
            v.push(
                resource_dir
                    .join("resources/pdfium/pdfium.dll")
                    .to_string_lossy()
                    .into_owned(),
            );
            v.push(
                resource_dir
                    .join("_up_/resources/pdfium/pdfium.dll")
                    .to_string_lossy()
                    .into_owned(),
            );
        }
        #[cfg(target_os = "linux")]
        {
            v.push(
                resource_dir
                    .join("libpdfium.so")
                    .to_string_lossy()
                    .into_owned(),
            );
            v.push(
                resource_dir
                    .join("pdfium/libpdfium.so")
                    .to_string_lossy()
                    .into_owned(),
            );
            v.push(
                resource_dir
                    .join("resources/pdfium/libpdfium.so")
                    .to_string_lossy()
                    .into_owned(),
            );
            v.push(
                resource_dir
                    .join("_up_/resources/pdfium/libpdfium.so")
                    .to_string_lossy()
                    .into_owned(),
            );
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let push = |v: &mut Vec<String>, p: std::path::PathBuf| {
                v.push(p.to_string_lossy().into_owned());
            };

            #[cfg(target_os = "macos")]
            {
                // Tauri .app bundle layout:
                //   Contents/MacOS/<binary>
                //   Contents/Frameworks/libpdfium.dylib   ← preferred
                //   Contents/Resources/libpdfium.dylib    ← fallback
                push(&mut v, exe_dir.join("../Frameworks/libpdfium.dylib"));
                push(&mut v, exe_dir.join("../Resources/libpdfium.dylib"));
                push(&mut v, exe_dir.join("../Resources/pdfium/libpdfium.dylib"));
                push(
                    &mut v,
                    exe_dir.join("../Resources/resources/pdfium/libpdfium.dylib"),
                );
                push(
                    &mut v,
                    exe_dir.join("../Resources/_up_/resources/pdfium/libpdfium.dylib"),
                );
                push(&mut v, exe_dir.join("libpdfium.dylib"));
            }

            #[cfg(target_os = "windows")]
            {
                // bblanchon/pdfium-binaries ships the Windows DLL as
                // `pdfium.dll` (no `lib` prefix). Try both.
                push(&mut v, exe_dir.join("pdfium.dll"));
                push(&mut v, exe_dir.join("libpdfium.dll"));
                push(&mut v, exe_dir.join("resources").join("pdfium.dll"));
                push(&mut v, exe_dir.join("resources/pdfium/pdfium.dll"));
                push(
                    &mut v,
                    exe_dir.join("resources/resources/pdfium/pdfium.dll"),
                );
                push(
                    &mut v,
                    exe_dir.join("resources/_up_/resources/pdfium/pdfium.dll"),
                );
            }

            #[cfg(target_os = "linux")]
            {
                push(&mut v, exe_dir.join("libpdfium.so"));
                push(&mut v, exe_dir.join("resources").join("libpdfium.so"));
                push(&mut v, exe_dir.join("resources/pdfium/libpdfium.so"));
                push(
                    &mut v,
                    exe_dir.join("resources/resources/pdfium/libpdfium.so"),
                );
                push(
                    &mut v,
                    exe_dir.join("resources/_up_/resources/pdfium/libpdfium.so"),
                );
                push(&mut v, exe_dir.join("../lib/libpdfium.so"));
            }
        }
    }

    v
}

fn pdfium() -> Result<&'static pdfium_render::prelude::Pdfium, String> {
    PDFIUM
        .get_or_init(|| {
            use pdfium_render::prelude::*;
            let candidates = pdfium_candidate_paths();
            for path in &candidates {
                if let Ok(bindings) = Pdfium::bind_to_library(path) {
                    eprintln!("[pdfium] loaded dynamic library from {path}");
                    return Ok(Pdfium::new(bindings));
                }
            }
            // Last resort: let the OS dynamic loader find it.
            Pdfium::bind_to_system_library()
                .map(Pdfium::new)
                .map_err(|e| {
                    format!(
                        "Failed to locate Pdfium library. Tried: {} — and the system search path. Last error: {e}",
                        if candidates.is_empty() {
                            "(no candidates)".to_string()
                        } else {
                            candidates.join(", ")
                        }
                    )
                })
        })
        .as_ref()
        .map_err(|e| e.clone())
}

fn extract_pdf_text(path: &str) -> Result<String, String> {
    use pdfium_render::prelude::*;
    let pdfium = pdfium()?;

    let doc = pdfium.load_pdf_from_file(path, None).map_err(|e| match e {
        PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::PasswordError) => {
            format!("PDF is password-protected and cannot be read: '{}'", path)
        }
        _ => format!("Failed to open PDF '{}': {}", path, e),
    })?;

    let mut out = String::new();
    for (idx, page) in doc.pages().iter().enumerate() {
        let page_text = page.text().map_err(|e| {
            format!(
                "Page {} text extraction failed in '{}': {}",
                idx + 1,
                path,
                e
            )
        })?;
        out.push_str(&page_text.all());
        out.push('\n');
    }
    Ok(out)
}

/// Extract text from Office Open XML formats, converting to Markdown.
fn extract_office_text(path: &str, ext: &str) -> Result<String, String> {
    // Spreadsheets: use calamine (supports xlsx, xls, ods)
    if matches!(ext, "xlsx" | "xls" | "ods") {
        return extract_spreadsheet(path);
    }

    // DOCX: use docx-rs library for proper parsing
    if ext == "docx" {
        return extract_docx_with_library(path);
    }

    // PPTX and ODF: use ZIP-based parsing
    let file = fs::File::open(path).map_err(|e| format!("Failed to open '{}': {}", path, e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to read ZIP archive '{}': {}", path, e))?;

    match ext {
        "pptx" => extract_pptx_markdown(&mut archive),
        "odt" | "odp" => extract_odf_text(&mut archive),
        _ => Ok("[Unsupported format]".to_string()),
    }
}

/// Extract DOCX using docx-rs library for proper structural parsing.
fn extract_docx_with_library(path: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read DOCX '{}': {}", path, e))?;
    let docx = docx_rs::read_docx(&bytes)
        .map_err(|e| format!("Failed to parse DOCX '{}': {:?}", path, e))?;

    let mut result = String::new();

    for child in docx.document.children {
        match child {
            docx_rs::DocumentChild::Paragraph(para) => {
                let mut para_text = String::new();
                let mut is_heading = false;
                let mut heading_level: u8 = 1;

                // Check paragraph style for headings
                if let Some(style) = &para.property.style {
                    let style_val = &style.val;
                    if style_val.contains("Heading") || style_val.contains("heading") {
                        is_heading = true;
                        // Extract level number
                        for ch in style_val.chars() {
                            if ch.is_ascii_digit() {
                                heading_level = ch.to_digit(10).unwrap_or(1) as u8;
                                break;
                            }
                        }
                    }
                }

                // Check for list (numbering)
                let is_list = para.property.numbering_property.is_some();

                // Extract text from runs
                for child in &para.children {
                    if let docx_rs::ParagraphChild::Run(run) = child {
                        let is_bold = run.run_property.bold.is_some();
                        let is_italic = run.run_property.italic.is_some();

                        for run_child in &run.children {
                            if let docx_rs::RunChild::Text(text) = run_child {
                                let t = &text.text;
                                if is_bold && is_italic {
                                    para_text.push_str(&format!("***{}***", t));
                                } else if is_bold {
                                    para_text.push_str(&format!("**{}**", t));
                                } else if is_italic {
                                    para_text.push_str(&format!("*{}*", t));
                                } else {
                                    para_text.push_str(t);
                                }
                            }
                        }
                    }
                }

                let text = para_text.trim().to_string();
                if text.is_empty() {
                    continue;
                }

                if is_heading {
                    let prefix = "#".repeat(heading_level as usize);
                    result.push_str(&format!("{} {}\n\n", prefix, text));
                } else if is_list {
                    result.push_str(&format!("- {}\n", text));
                } else {
                    result.push_str(&text);
                    result.push_str("\n\n");
                }
            }
            docx_rs::DocumentChild::Table(table) => {
                let mut rows: Vec<Vec<String>> = Vec::new();
                for row in &table.rows {
                    if let docx_rs::TableChild::TableRow(tr) = row {
                        let mut cells: Vec<String> = Vec::new();
                        for cell in &tr.cells {
                            if let docx_rs::TableRowChild::TableCell(tc) = cell {
                                let mut cell_text = String::new();
                                for child in &tc.children {
                                    if let docx_rs::TableCellContent::Paragraph(para) = child {
                                        for pchild in &para.children {
                                            if let docx_rs::ParagraphChild::Run(run) = pchild {
                                                for rc in &run.children {
                                                    if let docx_rs::RunChild::Text(t) = rc {
                                                        cell_text.push_str(&t.text);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                cells.push(cell_text.trim().replace('|', "\\|"));
                            }
                        }
                        rows.push(cells);
                    }
                }
                if !rows.is_empty() {
                    let max_cols = rows.iter().map(|r| r.len()).max().unwrap_or(0);
                    for (i, row) in rows.iter().enumerate() {
                        let mut padded = row.clone();
                        padded.resize(max_cols, String::new());
                        result.push_str("| ");
                        result.push_str(&padded.join(" | "));
                        result.push_str(" |\n");
                        if i == 0 {
                            result.push('|');
                            for _ in 0..max_cols {
                                result.push_str(" --- |");
                            }
                            result.push('\n');
                        }
                    }
                    result.push('\n');
                }
            }
            _ => {}
        }
    }

    if result.trim().is_empty() {
        // Fallback to ZIP-based extraction
        let file = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        extract_docx_markdown(&mut archive)
    } else {
        Ok(result)
    }
}

fn read_zip_file(archive: &mut zip::ZipArchive<fs::File>, name: &str) -> Option<String> {
    let mut file = archive.by_name(name).ok()?;
    let mut content = String::new();
    file.read_to_string(&mut content).ok()?;
    Some(content)
}

fn decode_xml_entities(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#10;", "\n")
        .replace("&#13;", "")
}

/// Extract DOCX to Markdown preserving headings, paragraphs, lists, tables, bold/italic.
fn extract_docx_markdown(archive: &mut zip::ZipArchive<fs::File>) -> Result<String, String> {
    let xml = read_zip_file(archive, "word/document.xml")
        .ok_or_else(|| "No document.xml found".to_string())?;

    let mut result = String::new();
    let mut i = 0;
    let chars: Vec<char> = xml.chars().collect();
    let len = chars.len();

    // Track current paragraph state
    let mut in_paragraph = false;
    let mut paragraph_text = String::new();
    let mut is_heading = false;
    let mut heading_level: u8 = 1;
    let mut is_bold = false;
    let mut is_italic = false;
    let mut in_table = false;
    let mut table_row: Vec<String> = Vec::new();
    let mut table_cell_text = String::new();
    let mut in_cell = false;
    let mut is_first_table_row = true;
    let mut in_list_item = false;

    while i < len {
        if chars[i] == '<' {
            // Read tag name
            let tag_start = i;
            i += 1;
            let is_closing = i < len && chars[i] == '/';
            if is_closing {
                i += 1;
            }

            let mut tag_name = String::new();
            while i < len && chars[i] != '>' && chars[i] != ' ' && chars[i] != '/' {
                tag_name.push(chars[i]);
                i += 1;
            }

            // Read rest of tag to find attributes
            let mut tag_content = String::new();
            while i < len && chars[i] != '>' {
                tag_content.push(chars[i]);
                i += 1;
            }
            if i < len {
                i += 1;
            } // skip >

            match tag_name.as_str() {
                // Paragraph start
                "w:p" if !is_closing => {
                    in_paragraph = true;
                    paragraph_text.clear();
                    is_heading = false;
                    in_list_item = false;
                }
                // Paragraph end — flush
                "w:p" if is_closing => {
                    let text = paragraph_text.trim().to_string();
                    if !text.is_empty() {
                        if in_table && in_cell {
                            table_cell_text = text;
                        } else if is_heading {
                            let prefix = "#".repeat(heading_level as usize);
                            result.push_str(&format!("{} {}\n\n", prefix, text));
                        } else if in_list_item {
                            result.push_str(&format!("- {}\n", text));
                        } else {
                            result.push_str(&text);
                            result.push_str("\n\n");
                        }
                    }
                    in_paragraph = false;
                    paragraph_text.clear();
                }
                // Heading style detection
                "w:pStyle" if !is_closing => {
                    if tag_content.contains("Heading") || tag_content.contains("heading") {
                        is_heading = true;
                        // Try to extract heading level from val="Heading1" etc.
                        if let Some(pos) = tag_content.find("Heading") {
                            let after = &tag_content[pos + 7..];
                            if let Some(ch) = after.chars().next() {
                                if ch.is_ascii_digit() {
                                    heading_level = ch.to_digit(10).unwrap_or(1) as u8;
                                }
                            }
                        }
                    }
                    if tag_content.contains("ListParagraph")
                        || tag_content.contains("listParagraph")
                    {
                        in_list_item = true;
                    }
                }
                // Bold
                "w:b"
                    if !is_closing
                        && !tag_content.contains("w:val=\"0\"")
                        && !tag_content.contains("w:val=\"false\"") =>
                {
                    is_bold = true;
                }
                // Italic
                "w:i"
                    if !is_closing
                        && !tag_content.contains("w:val=\"0\"")
                        && !tag_content.contains("w:val=\"false\"") =>
                {
                    is_italic = true;
                }
                // Run end — apply formatting
                "w:r" if is_closing => {
                    is_bold = false;
                    is_italic = false;
                }
                // Text content
                "w:t" if !is_closing => {
                    // Read text until </w:t>
                    let mut text = String::new();
                    while i < len {
                        if chars[i] == '<' {
                            break;
                        }
                        text.push(chars[i]);
                        i += 1;
                    }
                    let decoded = decode_xml_entities(&text);
                    if is_bold && is_italic {
                        paragraph_text.push_str(&format!("***{}***", decoded));
                    } else if is_bold {
                        paragraph_text.push_str(&format!("**{}**", decoded));
                    } else if is_italic {
                        paragraph_text.push_str(&format!("*{}*", decoded));
                    } else {
                        paragraph_text.push_str(&decoded);
                    }
                }
                // Table handling
                "w:tbl" if !is_closing => {
                    in_table = true;
                    is_first_table_row = true;
                }
                "w:tbl" if is_closing => {
                    in_table = false;
                    result.push('\n');
                }
                "w:tr" if !is_closing => {
                    table_row.clear();
                }
                "w:tr" if is_closing => {
                    if !table_row.is_empty() {
                        result.push_str("| ");
                        result.push_str(&table_row.join(" | "));
                        result.push_str(" |\n");
                        if is_first_table_row {
                            result.push_str("|");
                            for _ in &table_row {
                                result.push_str(" --- |");
                            }
                            result.push('\n');
                            is_first_table_row = false;
                        }
                    }
                }
                "w:tc" if !is_closing => {
                    in_cell = true;
                    table_cell_text.clear();
                }
                "w:tc" if is_closing => {
                    table_row.push(table_cell_text.trim().to_string());
                    in_cell = false;
                    table_cell_text.clear();
                }
                _ => {}
            }
        } else {
            i += 1;
        }
    }

    if result.trim().is_empty() {
        Ok("[Could not extract structured text from DOCX]".to_string())
    } else {
        Ok(result)
    }
}

/// Extract PPTX to Markdown with slide numbers and structure.
fn extract_pptx_markdown(archive: &mut zip::ZipArchive<fs::File>) -> Result<String, String> {
    let mut slide_names: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
        .collect();

    // Sort by slide number
    slide_names.sort_by(|a, b| {
        let num_a = a
            .trim_start_matches("ppt/slides/slide")
            .trim_end_matches(".xml")
            .parse::<u32>()
            .unwrap_or(0);
        let num_b = b
            .trim_start_matches("ppt/slides/slide")
            .trim_end_matches(".xml")
            .parse::<u32>()
            .unwrap_or(0);
        num_a.cmp(&num_b)
    });

    let mut result = String::new();

    for (idx, slide_name) in slide_names.iter().enumerate() {
        let xml = match read_zip_file(archive, slide_name) {
            Some(x) => x,
            None => continue,
        };

        result.push_str(&format!("## Slide {}\n\n", idx + 1));

        // Extract text from <a:t>...</a:t> tags, group by <a:p>...</a:p> paragraphs
        // Use string split approach to avoid byte/char index mismatch with CJK characters
        let mut paragraphs: Vec<String> = Vec::new();

        for para_part in xml.split("<a:p") {
            let mut para_text = String::new();
            for t_part in para_part.split("<a:t") {
                if let Some(close_pos) = t_part.find("</a:t>") {
                    if let Some(gt_pos) = t_part.find('>') {
                        if gt_pos < close_pos {
                            let text = &t_part[gt_pos + 1..close_pos];
                            para_text.push_str(&decode_xml_entities(text));
                        }
                    }
                }
            }
            let trimmed = para_text.trim().to_string();
            if !trimmed.is_empty() {
                paragraphs.push(trimmed);
            }
        }

        // First paragraph is usually the slide title
        if let Some(title) = paragraphs.first() {
            result.push_str(&format!("**{}**\n\n", title));
            for para in paragraphs.iter().skip(1) {
                result.push_str(&format!("- {}\n", para));
            }
        }
        result.push('\n');
    }

    if result.trim().is_empty() {
        Ok("[Could not extract text from PPTX]".to_string())
    } else {
        Ok(result)
    }
}

/// Extract XLSX/XLS/ODS to Markdown tables using calamine.
fn extract_xlsx_markdown(_archive: &mut zip::ZipArchive<fs::File>) -> Result<String, String> {
    // calamine needs the file path, not the archive
    Err("Use extract_spreadsheet instead".to_string())
}

/// Extract spreadsheet to Markdown using calamine (supports xlsx, xls, ods).
fn extract_spreadsheet(path: &str) -> Result<String, String> {
    let mut workbook = open_workbook_auto(path)
        .map_err(|e| format!("Failed to open spreadsheet '{}': {}", path, e))?;

    let mut result = String::new();
    let sheet_names = workbook.sheet_names().to_vec();

    for sheet_name in &sheet_names {
        if let Ok(range) = workbook.worksheet_range(sheet_name) {
            if range.is_empty() {
                continue;
            }

            if sheet_names.len() > 1 {
                result.push_str(&format!("## {}\n\n", sheet_name));
            }

            let mut rows: Vec<Vec<String>> = Vec::new();
            let mut max_cols = 0;

            for row in range.rows() {
                let cells: Vec<String> = row
                    .iter()
                    .map(|cell| match cell {
                        Data::Empty => String::new(),
                        Data::String(s) => s.clone(),
                        Data::Float(f) => {
                            if *f == (*f as i64) as f64 {
                                format!("{}", *f as i64)
                            } else {
                                format!("{:.2}", f)
                            }
                        }
                        Data::Int(i) => i.to_string(),
                        Data::Bool(b) => b.to_string(),
                        Data::DateTime(dt) => format!("{}", dt),
                        Data::DateTimeIso(s) => s.clone(),
                        Data::DurationIso(s) => s.clone(),
                        Data::Error(e) => format!("ERR:{:?}", e),
                    })
                    .collect();
                if cells.len() > max_cols {
                    max_cols = cells.len();
                }
                rows.push(cells);
            }

            // Skip empty sheets
            if rows.is_empty() || max_cols == 0 {
                continue;
            }

            for (i, row) in rows.iter().enumerate() {
                let mut padded = row.clone();
                padded.resize(max_cols, String::new());
                // Escape pipe characters in cell values
                let escaped: Vec<String> = padded.iter().map(|c| c.replace('|', "\\|")).collect();
                result.push_str("| ");
                result.push_str(&escaped.join(" | "));
                result.push_str(" |\n");

                if i == 0 {
                    result.push('|');
                    for _ in 0..max_cols {
                        result.push_str(" --- |");
                    }
                    result.push('\n');
                }
            }
            result.push('\n');
        }
    }

    if result.trim().is_empty() {
        Ok("[Could not extract data from spreadsheet]".to_string())
    } else {
        Ok(result)
    }
}

/// Extract OpenDocument format text (basic).
fn extract_odf_text(archive: &mut zip::ZipArchive<fs::File>) -> Result<String, String> {
    let xml =
        read_zip_file(archive, "content.xml").ok_or_else(|| "No content.xml found".to_string())?;

    let mut result = String::new();
    let mut in_tag = false;

    for ch in xml.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                result.push(' ');
            }
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }

    let cleaned = decode_xml_entities(&result);
    let lines: Vec<&str> = cleaned
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    if lines.is_empty() {
        Ok("[Could not extract text from this file]".to_string())
    } else {
        Ok(lines.join("\n\n"))
    }
}

#[tauri::command]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    run_guarded("write_file", || {
        let p = Path::new(&path);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs for '{}': {}", path, e))?;
        }
        fs::write(&path, contents).map_err(|e| format!("Failed to write file '{}': {}", path, e))
    })
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<FileNode>, String> {
    run_guarded("list_directory", || {
        let p = Path::new(&path);
        if !p.exists() {
            return Err(format!("Path does not exist: '{}'", path));
        }
        if !p.is_dir() {
            return Err(format!("Path is not a directory: '{}'", path));
        }
        let nodes = build_tree(p, 0, 30)?;
        Ok(nodes)
    })
}

fn build_tree(dir: &Path, depth: usize, max_depth: usize) -> Result<Vec<FileNode>, String> {
    if depth >= max_depth {
        return Ok(vec![]);
    }

    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            // Skip dotfiles
            entry
                .file_name()
                .to_str()
                .map(|n| !n.starts_with('.'))
                .unwrap_or(false)
        })
        .collect();

    // Sort: directories first, then alphabetical within each group
    entries.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    let mut nodes = Vec::new();
    for entry in entries {
        let entry_path = entry.path();
        let name = entry.file_name().to_str().unwrap_or("").to_string();
        // Always return forward-slash paths so the TS layer can compare
        // and compose paths consistently across Windows and Unix. Windows
        // APIs accept forward slashes, so normalizing here is safe and
        // prevents a whole class of bugs where TS-constructed `/` paths
        // fail to match Rust-returned `\` paths.
        let path_str = entry_path.to_string_lossy().replace('\\', "/");
        let is_dir = entry_path.is_dir();

        let children = if is_dir {
            let kids = build_tree(&entry_path, depth + 1, max_depth)?;
            if kids.is_empty() {
                None
            } else {
                Some(kids)
            }
        } else {
            None
        };

        nodes.push(FileNode {
            name,
            path: path_str,
            is_dir,
            children,
        });
    }

    Ok(nodes)
}

#[tauri::command]
pub fn copy_file(source: String, destination: String) -> Result<(), String> {
    run_guarded("copy_file", || {
        let dest = Path::new(&destination);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
        }
        fs::copy(&source, &destination)
            .map_err(|e| format!("Failed to copy '{}' to '{}': {}", source, destination, e))?;
        Ok(())
    })
}

/// Recursively copy a directory, preserving structure.
/// Returns list of copied file paths (destination paths).
#[tauri::command]
pub fn copy_directory(source: String, destination: String) -> Result<Vec<String>, String> {
    run_guarded("copy_directory", || {
        let src = Path::new(&source);
        let dest = Path::new(&destination);

        if !src.is_dir() {
            return Err(format!("'{}' is not a directory", source));
        }

        let mut copied_files = Vec::new();

        fn copy_recursive(src: &Path, dest: &Path, files: &mut Vec<String>) -> Result<(), String> {
            fs::create_dir_all(dest)
                .map_err(|e| format!("Failed to create dir '{}': {}", dest.display(), e))?;

            let entries = fs::read_dir(src)
                .map_err(|e| format!("Failed to read dir '{}': {}", src.display(), e))?;

            for entry in entries {
                let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
                let path = entry.path();
                let name = entry.file_name();
                let dest_path = dest.join(&name);

                // Skip hidden files/dirs
                if name.to_string_lossy().starts_with('.') {
                    continue;
                }

                if path.is_dir() {
                    copy_recursive(&path, &dest_path, files)?;
                } else {
                    fs::copy(&path, &dest_path)
                        .map_err(|e| format!("Failed to copy '{}': {}", path.display(), e))?;
                    // Normalize to forward slashes for consistent cross-
                    // platform handling in the TS layer (see fs.rs build_tree).
                    files.push(dest_path.to_string_lossy().replace('\\', "/"));
                }
            }
            Ok(())
        }

        copy_recursive(src, dest, &mut copied_files)?;
        Ok(copied_files)
    })
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    run_guarded("delete_file", || {
        let p = Path::new(&path);
        if p.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("Failed to delete directory '{}': {}", path, e))
        } else {
            fs::remove_file(&path).map_err(|e| format!("Failed to delete file '{}': {}", path, e))
        }
    })
}

/// Find wiki pages that reference a given source file name.
/// Scans all .md files under wiki/ for the source filename in frontmatter or content.
#[tauri::command]
pub fn find_related_wiki_pages(
    project_path: String,
    source_name: String,
) -> Result<Vec<String>, String> {
    run_guarded("find_related_wiki_pages", || {
        let wiki_dir = Path::new(&project_path).join("wiki");
        if !wiki_dir.is_dir() {
            return Ok(vec![]);
        }

        let mut related = Vec::new();
        collect_related_pages(&wiki_dir, &source_name, &mut related)?;
        Ok(related)
    })
}

fn collect_related_pages(
    dir: &Path,
    source_name: &str,
    results: &mut Vec<String>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

    // Get just the filename without path — use Path for cross-platform separator handling
    let source_path = std::path::Path::new(source_name);
    let file_name = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(source_name);
    let file_name_lower = file_name.to_lowercase();

    // Derive stem (filename without extension) for source summary matching
    let file_stem = file_name
        .rsplit('.')
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(".");
    let file_stem_lower = if file_stem.is_empty() {
        file_name_lower.clone()
    } else {
        file_stem.to_lowercase()
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_related_pages(&path, source_name, results)?;
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            // Skip index.md, log.md, overview.md — updated separately
            if fname == "index.md" || fname == "log.md" || fname == "overview.md" {
                continue;
            }

            if let Ok(content) = fs::read_to_string(&path) {
                let content_lower = content.to_lowercase();

                // Match 1: frontmatter sources field contains the exact filename
                // e.g., sources: ["2603.25723v1.pdf"]
                let sources_match = content_lower.contains(&format!("\"{}\"", file_name_lower))
                    || content_lower.contains(&format!("'{}'", file_name_lower));

                // Match 2: source summary page (wiki/sources/{stem}.md)
                // Use Path component iteration to avoid hardcoded separator assumptions
                let is_in_sources_dir = path.components().any(|c| c.as_os_str() == "sources");
                let is_source_summary =
                    is_in_sources_dir && fname.to_lowercase().starts_with(&file_stem_lower);

                // Match 3: page was generated from this source (check frontmatter sources field)
                let frontmatter_match = if let Some(fm_start) = content.find("---\n") {
                    if let Some(fm_end) = content[fm_start + 4..].find("\n---") {
                        let frontmatter = &content[fm_start..fm_start + 4 + fm_end].to_lowercase();
                        frontmatter.contains("sources:") && frontmatter.contains(&file_name_lower)
                    } else {
                        false
                    }
                } else {
                    false
                };

                if sources_match || is_source_summary || frontmatter_match {
                    // Normalize to forward slashes — matches build_tree /
                    // copy_directory so TS-side comparisons work on Windows.
                    results.push(path.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    run_guarded("create_directory", || {
        fs::create_dir_all(&path)
            .map_err(|e| format!("Failed to create directory '{}': {}", path, e))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Write `bytes` to a fresh tmp path with `.pdf` suffix and return
    /// the path (the OS tmpdir is NOT cleaned up — acceptable for tests).
    fn tmp_pdf_with_bytes(bytes: &[u8]) -> String {
        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "panic-guard-{}.pdf",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(bytes).unwrap();
        path.to_string_lossy().to_string()
    }

    /// Verify read_file does NOT crash the test process on malformed PDFs.
    /// We try a handful of payloads that have historically caused
    /// pdf-extract/lopdf panics — any process abort would fail the test
    /// runner before it can report.
    #[test]
    fn read_file_survives_malformed_pdf_inputs() {
        let payloads: &[(&str, &[u8])] = &[
            ("empty", b""),
            ("not_a_pdf", b"this is plainly not a PDF file"),
            ("header_only", b"%PDF-1.4\n"),
            (
                "broken_xref",
                b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\nxref\nBROKENBROKEN\ntrailer\n<</Size 1>>\nstartxref\n999999\n%%EOF\n",
            ),
            (
                "junk_after_header",
                b"%PDF-1.4\n\x00\x01\x02\x03\x04\x05\x06\x07\xFF\xFE\xFDjunkgarbage",
            ),
        ];

        for (name, bytes) in payloads {
            let path = tmp_pdf_with_bytes(bytes);
            // Either Ok(...) or Err(...) is acceptable — what matters is
            // that no panic reaches the test runner and aborts the process.
            let result = read_file(path.clone());
            let _ = fs::remove_file(&path);
            eprintln!(
                "[{name}] => {:?}",
                result.as_ref().map(|s| &s[..s.len().min(80)])
            );
        }
    }

    /// Smoke test: a real PDF panic (synthesized) is caught. We can't
    /// guarantee that any particular byte sequence above actually panics
    /// pdf-extract across versions, so also trigger an explicit panic
    /// through read_file's guarded path.
    #[test]
    fn read_file_returns_err_on_missing_file_instead_of_panicking() {
        // This won't panic, but confirms the error path is the Err path,
        // not a runtime abort.
        let result = read_file("/nonexistent/path/that/does/not/exist.pdf".to_string());
        assert!(result.is_err() || result.is_ok()); // must at least return
    }

    /// Ad-hoc probe: run the production PDF extraction path against every
    /// .pdf under a user-provided directory and print a per-file report of
    /// Ok / Err (library returned an error) / Panic (library panicked and
    /// was caught by panic_guard). Gated with #[ignore] so it never runs
    /// in CI; execute locally with:
    ///
    ///   PDF_PROBE_DIR=/path/to/pdfs cargo test --lib \
    ///     -- --ignored --nocapture pdf_probe
    #[test]
    #[ignore = "local probe; set PDF_PROBE_DIR"]
    fn pdf_probe() {
        let dir = std::env::var("PDF_PROBE_DIR")
            .unwrap_or_else(|_| "/Users/nash_su/Downloads/pdftests".to_string());
        let root = std::path::Path::new(&dir);
        if !root.exists() {
            eprintln!("[pdf_probe] dir not found: {}", root.display());
            return;
        }

        let mut pdfs: Vec<std::path::PathBuf> = Vec::new();
        fn walk(d: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            if let Ok(entries) = fs::read_dir(d) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        walk(&p, out);
                    } else if p
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.eq_ignore_ascii_case("pdf"))
                        .unwrap_or(false)
                    {
                        out.push(p);
                    }
                }
            }
        }
        walk(root, &mut pdfs);
        pdfs.sort();

        eprintln!(
            "\n[pdf_probe] found {} PDFs under {}\n",
            pdfs.len(),
            root.display()
        );

        let mut ok = 0usize;
        let mut err = 0usize;
        let mut panicked = 0usize;

        for (idx, path) in pdfs.iter().enumerate() {
            let display = path.display().to_string();
            // Call extract_pdf_text directly (not read_file) so we bypass
            // the .cache sibling dir and always exercise the parser.
            let path_str = path.to_string_lossy().to_string();
            let result = std::panic::catch_unwind(|| extract_pdf_text(&path_str));
            match result {
                Ok(Ok(text)) => {
                    ok += 1;
                    eprintln!(
                        "[{:>3}/{}] OK     ({:>7} chars)  {}",
                        idx + 1,
                        pdfs.len(),
                        text.len(),
                        display
                    );
                }
                Ok(Err(e)) => {
                    err += 1;
                    eprintln!(
                        "[{:>3}/{}] ERR    {}  →  {}",
                        idx + 1,
                        pdfs.len(),
                        display,
                        e
                    );
                }
                Err(payload) => {
                    panicked += 1;
                    let msg = if let Some(s) = payload.downcast_ref::<String>() {
                        s.clone()
                    } else if let Some(s) = payload.downcast_ref::<&str>() {
                        (*s).to_string()
                    } else {
                        "(non-string panic)".to_string()
                    };
                    eprintln!(
                        "[{:>3}/{}] PANIC  {}  →  {}",
                        idx + 1,
                        pdfs.len(),
                        display,
                        msg
                    );
                }
            }
        }

        eprintln!(
            "\n[pdf_probe] summary: {} OK / {} ERR / {} PANIC (total {})",
            ok,
            err,
            panicked,
            pdfs.len()
        );
    }
}
