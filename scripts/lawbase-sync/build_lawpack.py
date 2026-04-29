#!/usr/bin/env python3
"""
Build an offline lawbase pack for 案件知识库.

This tool is intended to run on an internet-connected computer or a
controlled staging machine. The desktop app itself remains offline.

Inputs:
  - A directory of downloaded .docx / .txt / .md law files.
  - Optionally a text file containing official download URLs, one per line.

Outputs:
  - lawbase-pack.json       App-importable package: { manifest, codes }
  - raw/                    Original downloaded/copied files
  - compiled/*.json         Per-law parsed LawCode files
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
import http.cookiejar
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


ARTICLE_RE = re.compile(r"^(第[一二三四五六七八九十百千万零〇两\d]+条)\s*(.*)$")
DATE_RE = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日")
TITLE_SKIP_RE = re.compile(r"^(目录|正文|附件|法律法规全文|打印|下载)$")
COOKIE_JAR = http.cookiejar.CookieJar()
HTTP_OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIE_JAR))
CORE_LAW_PROFILES: dict[str, list[str]] = {
    "court-basic": [
        "中华人民共和国民法典",
        "中华人民共和国民法通则",
        "中华人民共和国民事诉讼法",
        "中华人民共和国刑事诉讼法",
        "中华人民共和国行政诉讼法",
        "中华人民共和国行政处罚法",
        "中华人民共和国行政强制法",
        "中华人民共和国行政许可法",
        "中华人民共和国行政复议法",
        "中华人民共和国国家赔偿法",
        "中华人民共和国刑法",
        "医疗事故处理条例",
        "医疗事故分级标准（试行）",
        "最高人民法院关于民事诉讼证据的若干规定",
        "最高人民法院关于适用《中华人民共和国民事诉讼法》的解释",
        "最高人民法院关于适用《中华人民共和国民法典》侵权责任编的解释（一）",
    ],
    "court-medical": [
        "中华人民共和国民法典",
        "中华人民共和国民法通则",
        "中华人民共和国民事诉讼法",
        "医疗事故处理条例",
        "医疗事故分级标准（试行）",
        "最高人民法院关于民事诉讼证据的若干规定",
        "最高人民法院关于适用《中华人民共和国民事诉讼法》的解释",
        "最高人民法院关于适用《中华人民共和国民法典》侵权责任编的解释（一）",
        "医疗纠纷预防和处理条例",
        "护士条例",
        "医疗机构管理条例",
        "中华人民共和国基本医疗卫生与健康促进法",
        "中华人民共和国执业医师法",
    ],
}

PROFILE_META: dict[str, dict[str, str]] = {
    "court-basic": {"pack_tier": "core", "topic": "法院通用基础法"},
    "court-medical": {"pack_tier": "topic", "topic": "医疗纠纷专题"},
}


def today_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json_file(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json_file(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def safe_filename(name: str) -> str:
    name = re.sub(r"[\\/:*?\"<>|\r\n\t]", "_", name).strip()
    return name or "untitled"


def normalize_date(text: str) -> str:
    match = DATE_RE.search(text)
    if not match:
        return ""
    year, month, day = match.groups()
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def read_docx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", ns):
        parts: list[str] = []
        for node in paragraph.iter():
            tag = node.tag.split("}")[-1]
            if tag == "t" and node.text:
                parts.append(node.text)
            elif tag == "tab":
                parts.append("\t")
            elif tag == "br":
                parts.append("\n")
        line = "".join(parts).strip()
        if line:
            paragraphs.append(line)
    return "\n".join(paragraphs)


def read_text_file(path: Path) -> str:
    for encoding in ("utf-8", "utf-8-sig", "gb18030"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(errors="ignore")


def read_source_text(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == ".docx":
        return read_docx_text(path)
    if ext in {".txt", ".md"}:
        return read_text_file(path)
    raise ValueError(f"Unsupported source format: {path.name}")


def clean_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = re.sub(r"\s+", " ", raw).strip()
        if line:
            lines.append(line)
    return lines


def infer_title(lines: list[str], fallback: str) -> str:
    for line in lines[:30]:
        if TITLE_SKIP_RE.match(line):
            continue
        if len(line) <= 80 and not ARTICLE_RE.match(line) and "http" not in line.lower():
            return line.strip("《》 ")
    return fallback


def infer_issuer(lines: list[str]) -> str:
    joined = "\n".join(lines[:80])
    issuers = [
        "全国人民代表大会",
        "全国人民代表大会常务委员会",
        "国务院",
        "最高人民法院",
        "最高人民检察院",
        "司法部",
    ]
    for issuer in issuers:
        if issuer in joined:
            return issuer
    return ""


def infer_effective(lines: list[str]) -> str:
    patterns = [
        r"自.*?起施行",
        r"施行日期[：: ].*",
        r"自.*?起实施",
    ]
    for line in lines[:120]:
        for pattern in patterns:
            match = re.search(pattern, line)
            if match:
                date = normalize_date(match.group(0))
                if date:
                    return date
    return ""


def infer_version(lines: list[str]) -> str:
    for line in lines[:80]:
        if any(key in line for key in ("修正", "修订", "通过", "公布", "施行")) and DATE_RE.search(line):
            return line[:120]
    return ""


def parse_articles(lines: list[str]) -> list[dict[str, Any]]:
    articles: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    current_parts: list[str] = []
    chapter = ""
    section = ""

    def flush() -> None:
        nonlocal current, current_parts
        if not current:
            return
        content = "\n".join(part for part in current_parts if part).strip()
        if content:
            current["content"] = content
            articles.append(current)
        current = None
        current_parts = []

    for line in lines:
        if re.match(r"^第[一二三四五六七八九十百千万零〇两\d]+章", line):
            flush()
            chapter = line
            section = ""
            continue
        if re.match(r"^第[一二三四五六七八九十百千万零〇两\d]+节", line):
            flush()
            section = line
            continue
        match = ARTICLE_RE.match(line)
        if match:
            flush()
            number, rest = match.groups()
            current = {"number": number, "content": "", "chapter": chapter or None, "section": section or None}
            current_parts = [rest.strip()] if rest.strip() else []
        elif current:
            current_parts.append(line)

    flush()
    for article in articles:
        article.pop("chapter", None) if not article.get("chapter") else None
        article.pop("section", None) if not article.get("section") else None
    return articles


def aliases_for_title(title: str) -> list[str]:
    aliases: list[str] = []
    if title.startswith("中华人民共和国") and len(title) > len("中华人民共和国"):
        aliases.append(title.replace("中华人民共和国", "", 1))
    if title.endswith("法") and title.startswith("中华人民共和国"):
        aliases.append(title.replace("中华人民共和国", "", 1))
    return sorted(set(alias for alias in aliases if alias and alias != title))


def parse_law_file(path: Path, source_label: str) -> dict[str, Any]:
    text = read_source_text(path)
    lines = clean_lines(text)
    title = infer_title(lines, path.stem)
    articles = parse_articles(lines)
    if not articles:
        # Keep a single pseudo-article so the file is still visible for manual review.
        articles = [{"number": "全文", "content": "\n".join(lines)}]
    return {
        "code": title,
        "aliases": aliases_for_title(title),
        "effective": infer_effective(lines) or None,
        "version": infer_version(lines) or None,
        "issuer": infer_issuer(lines) or None,
        "source": source_label,
        "importedAt": today_iso(),
        "articles": articles,
    }


def classify_hierarchy(code: dict[str, Any]) -> str:
    name = str(code.get("code") or "")
    text = " ".join(str(code.get(key) or "") for key in ("code", "source", "version", "issuer", "officialCategory"))
    local_re = re.compile(
        r"(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|内蒙古|广西|西藏|宁夏|新疆|香港|澳门|自治州|自治县|自治旗|地区|盟|市)"
    )
    official = str(code.get("officialCategory") or "")
    if official in {"法律", "行政法规", "司法解释"}:
        return "司法解释与两高规范性文件" if official == "司法解释" else official
    if "最高人民法院" in text or "最高人民检察院" in text or "司法解释" in text or "关于审理" in name or "适用法律" in name:
        return "司法解释与两高规范性文件"
    if re.match(r"^中华人民共和国.+法$", name) or re.match(r"^中华人民共和国.+法实施", name):
        return "法律"
    if "国务院" in text or (name.endswith("条例") and not local_re.search(text[:160])):
        return "行政法规"
    if local_re.search(text[:180]):
        return "地方性法规、自治条例和单行条例"
    if re.search(r"(决定|规定|办法|规则|条例)$", name):
        return "其他规范性文件"
    return "其他"


def apply_download_metadata(code: dict[str, Any], meta: dict[str, Any] | None) -> dict[str, Any]:
    if not meta:
        code["hierarchyLevel"] = classify_hierarchy(code)
        return code
    if meta.get("zdjgName"):
        code["issuer"] = meta.get("zdjgName")
    if meta.get("flxz"):
        code["officialCategory"] = meta.get("flxz")
    if meta.get("gbrq"):
        code["promulgationDate"] = meta.get("gbrq")
    if meta.get("sxrq"):
        code["sourceEffectiveDate"] = meta.get("sxrq")
        code["effective"] = code.get("effective") or meta.get("sxrq")
    if meta.get("bbbs"):
        code["sourceId"] = meta.get("bbbs")
    code["hierarchyLevel"] = classify_hierarchy(code)
    return code


def download_file(url: str, raw_dir: Path, delay_seconds: float) -> Path:
    parsed = urllib.parse.urlparse(url)
    filename = Path(urllib.parse.unquote(parsed.path)).name or "download.docx"
    if "." not in filename:
        filename = f"{safe_filename(filename)}.docx"
    target = raw_dir / safe_filename(filename)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 lawbase-pack-builder/1.0",
            "Referer": "https://flk.npc.gov.cn/index.html",
            "Origin": "https://flk.npc.gov.cn",
            "Accept": "application/json, text/plain, */*",
        },
    )
    with HTTP_OPENER.open(req, timeout=60) as resp:
        target.write_bytes(resp.read())
    if delay_seconds > 0:
        time.sleep(delay_seconds)
    return target


def http_json(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout: int = 60,
) -> dict[str, Any]:
    data = None
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 lawbase-pack-builder/1.0",
        "Referer": "https://flk.npc.gov.cn/index.html",
        "Origin": "https://flk.npc.gov.cn",
        "Accept": "application/json, text/plain, */*",
    }
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json;charset=UTF-8"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with HTTP_OPENER.open(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", "replace")
    return json.loads(raw)


def flk_list_page(page: int, page_size: int, search_content: str = "") -> dict[str, Any]:
    payload = {
        "searchRange": 1,
        "sxrq": [],
        "gbrq": [],
        "searchType": 2,
        "sxx": [],
        "gbrqYear": [],
        "flfgCodeId": [],
        "zdjgCodeId": [],
        "searchContent": search_content,
        "orderByParam": {"order": "-1", "sort": ""},
        "scoreDto": {},
        "pageNum": page,
        "pageSize": page_size,
    }
    return http_json("https://flk.npc.gov.cn/law-search/search/list", method="POST", payload=payload)


def download_named_laws(args: argparse.Namespace, raw_dir: Path) -> None:
    if not args.core_profile:
        return
    names = CORE_LAW_PROFILES.get(args.core_profile)
    if not names:
        raise RuntimeError(f"unknown core profile: {args.core_profile}")
    index_path = raw_dir.parent / "download-index.json"
    download_index: dict[str, Any] = load_json_file(index_path, {})
    print(f"[core-profile] {args.core_profile}: {len(names)} laws")
    for name in names:
        data = flk_list_page(1, 10, name)
        rows = data.get("rows") or []
        target_row = next((row for row in rows if str(row.get("title") or "").strip() == name.strip()), rows[0] if rows else None)
        if not target_row:
            print(f"  [missing] {name}", file=sys.stderr)
            continue
        bbbs = str(target_row.get("bbbs") or "").strip()
        if not bbbs:
            print(f"  [missing-id] {name}", file=sys.stderr)
            continue
        known = download_index.get(bbbs)
        if known:
            known_name = str(known.get("filename") or "")
            if known_name and (raw_dir / known_name).exists():
                print(f"  [skip] {name}")
                continue
        url = flk_download_url(bbbs, "docx")
        filename = safe_filename(f"{name}_{target_row.get('gbrq') or ''}.docx")
        target = raw_dir / filename
        if target.exists():
            target = raw_dir / safe_filename(f"{name}_{bbbs}_{target_row.get('gbrq') or ''}.docx")
        download_to_file(url, target, timeout=90, retries=args.discover_retries)
        download_index[bbbs] = {
            "title": name,
            "filename": target.name,
            "bbbs": bbbs,
            "gbrq": target_row.get("gbrq"),
            "sxrq": target_row.get("sxrq"),
            "flxz": target_row.get("flxz"),
            "zdjgName": target_row.get("zdjgName"),
            "flfgCodeId": target_row.get("flfgCodeId"),
            "zdjgCodeId": target_row.get("zdjgCodeId"),
            "updated_at": today_iso(),
            "from_core_profile": args.core_profile,
        }
        save_json_file(index_path, download_index)
        print(f"  [download] {name} -> {target.name}")
        if args.delay > 0:
            time.sleep(args.delay)


def is_temporary_redirect_error(exc: Exception) -> bool:
    return isinstance(exc, urllib.error.HTTPError) and exc.code in {302, 307, 429, 503}


def flk_list_page_with_retry(
    page: int,
    page_size: int,
    search_content: str,
    retries: int,
    cooldown_seconds: float,
) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            return flk_list_page(page, page_size, search_content)
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                wait = cooldown_seconds if is_temporary_redirect_error(exc) else 1.5 * (attempt + 1)
                print(f"[discover] page={page} retry {attempt + 1}/{retries} after {wait:.1f}s: {exc}", file=sys.stderr)
                time.sleep(wait)
    raise RuntimeError(f"list api failed after retries on page {page}: {last_error}")


def flk_download_url(bbbs: str, fmt: str = "docx", file_id: str = "") -> str:
    params = urllib.parse.urlencode({"format": fmt, "bbbs": bbbs, "fileId": file_id})
    data = http_json(f"https://flk.npc.gov.cn/law-search/download/pc?{params}")
    if data.get("code") != 200:
        raise RuntimeError(f"download api failed: {data}")
    url = (data.get("data") or {}).get("url")
    if not url:
        raise RuntimeError(f"download api returned no url: {data}")
    return str(url)


def download_to_file(url: str, target: Path, timeout: int = 90, retries: int = 2) -> None:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 lawbase-pack-builder/1.0",
                    "Referer": "https://flk.npc.gov.cn/index.html",
                    "Origin": "https://flk.npc.gov.cn",
                    "Accept": "application/json, text/plain, */*",
                },
            )
            with HTTP_OPENER.open(req, timeout=timeout) as resp:
                target.write_bytes(resp.read())
            return
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                wait = 8.0 * (attempt + 1) if is_temporary_redirect_error(exc) else 1.2 * (attempt + 1)
                time.sleep(wait)
    raise RuntimeError(f"download failed after retries: {last_error}")


def retry_discover_failures(args: argparse.Namespace, raw_dir: Path) -> tuple[int, int]:
    fail_path = raw_dir.parent / "download-failures.json"
    index_path = raw_dir.parent / "download-index.json"
    if not fail_path.exists():
        print(f"[retry-failures] no failures file: {fail_path}")
        return 0, 0

    failures: list[dict[str, Any]] = load_json_file(fail_path, [])
    if not failures:
        print("[retry-failures] failures file is empty")
        return 0, 0

    download_index: dict[str, Any] = load_json_file(index_path, {})
    fixed = 0
    still_failed: list[dict[str, Any]] = []

    for item in failures:
        bbbs = str(item.get("bbbs") or "").strip()
        title = str(item.get("title") or bbbs or "未命名法规")
        if not bbbs:
            still_failed.append(item)
            continue
        try:
            url = flk_download_url(bbbs, "docx")
            filename = safe_filename(f"{title}_{bbbs}.docx")
            target = raw_dir / filename
            download_to_file(url, target, timeout=90, retries=args.discover_retries)
            download_index[bbbs] = {
                "title": title,
                "filename": target.name,
                "bbbs": bbbs,
                "updated_at": today_iso(),
                "from_retry_failures": True,
            }
            fixed += 1
            print(f"  [retry-ok] {title} ({bbbs})")
            if args.delay > 0:
                time.sleep(args.delay)
        except Exception as exc:
            item["retry_error"] = str(exc)
            still_failed.append(item)
            print(f"  [retry-failed] {title} ({bbbs}): {exc}", file=sys.stderr)

    save_json_file(index_path, download_index)
    save_json_file(fail_path, still_failed)
    print(f"[retry-failures] fixed={fixed}, remain={len(still_failed)}")
    return fixed, len(still_failed)


def download_flk_discovered(args: argparse.Namespace, raw_dir: Path) -> None:
    page_size = args.discover_page_size
    max_pages = args.discover_max_pages
    index_path = raw_dir.parent / "download-index.json"
    progress_path = raw_dir.parent / "discover-progress.json"
    download_index: dict[str, Any] = load_json_file(index_path, {})
    progress: dict[str, Any] = load_json_file(progress_path, {})
    progress.setdefault("started_at", today_iso())
    save_json_file(progress_path, progress)

    page = args.discover_start_page
    if args.discover_end_page and args.discover_end_page < args.discover_start_page:
        raise RuntimeError("--discover-end-page must be >= --discover-start-page")
    if args.discover_resume:
        page = max(page, int(progress.get("next_page") or page))
    if args.discover_end_page and page > args.discover_end_page:
        print("[discover] resume page is beyond end page, nothing to do")
        return

    total_seen = 0
    downloaded = 0
    skipped = 0
    failures: list[dict[str, str]] = []
    page_failures: list[dict[str, Any]] = []
    consecutive_download_failures = 0

    while True:
        if max_pages and page > args.discover_start_page + max_pages - 1:
            break
        if args.discover_end_page and page > args.discover_end_page:
            break
        print(f"[discover] page={page} size={page_size}")
        try:
            data = flk_list_page_with_retry(
                page,
                page_size,
                args.discover_search,
                args.list_retries,
                args.cooldown_on_redirect,
            )
        except Exception as exc:
            page_failures.append({"page": page, "error": str(exc), "at": today_iso()})
            print(f"[discover] page={page} failed after retries, stop here for later resume: {exc}", file=sys.stderr)
            progress["next_page"] = page
            progress["updated_at"] = today_iso()
            save_json_file(progress_path, progress)
            break
        if data.get("code") != 200:
            page_failures.append({"page": page, "error": f"unexpected code: {data.get('code')}", "at": today_iso()})
            print(f"[discover] page={page} returned code={data.get('code')}, skip", file=sys.stderr)
            progress["next_page"] = page + 1
            progress["updated_at"] = today_iso()
            save_json_file(progress_path, progress)
            page += 1
            continue
        rows = data.get("rows") or []
        total = int(data.get("total") or 0)
        if not rows:
            progress["next_page"] = page
            progress["finished_at"] = today_iso()
            save_json_file(progress_path, progress)
            break
        for row in rows:
            total_seen += 1
            title = str(row.get("title") or row.get("bbbs") or "未命名法规")
            bbbs = str(row.get("bbbs") or "")
            if not bbbs:
                continue
            known = download_index.get(bbbs)
            if known:
                known_name = str(known.get("filename") or "")
                known_path = raw_dir / known_name if known_name else None
                if known_path and known_path.exists():
                    skipped += 1
                    print(f"  [skip] {title} ({bbbs})")
                    continue
            try:
                url = flk_download_url(bbbs, "docx")
                filename = safe_filename(f"{title}_{row.get('gbrq') or ''}.docx")
                target = raw_dir / filename
                if target.exists():
                    # 同名文件已存在时，避免覆盖造成反复变化；重命名留档并建立索引。
                    target = raw_dir / safe_filename(f"{title}_{bbbs}_{row.get('gbrq') or ''}.docx")
                download_to_file(url, target, timeout=90, retries=args.discover_retries)
                downloaded += 1
                download_index[bbbs] = {
                    "title": title,
                    "filename": target.name,
                    "bbbs": bbbs,
                    "gbrq": row.get("gbrq"),
                    "sxrq": row.get("sxrq"),
                    "flxz": row.get("flxz"),
                    "zdjgName": row.get("zdjgName"),
                    "flfgCodeId": row.get("flfgCodeId"),
                    "zdjgCodeId": row.get("zdjgCodeId"),
                    "updated_at": today_iso(),
                }
                save_json_file(index_path, download_index)
                print(f"  [download] {downloaded}/{total_seen} {filename}")
                consecutive_download_failures = 0
                if args.delay > 0:
                    time.sleep(args.delay)
            except Exception as exc:
                print(f"  [failed] {title}: {exc}", file=sys.stderr)
                failures.append({"title": title, "bbbs": bbbs, "error": str(exc)})
                consecutive_download_failures += 1
                if consecutive_download_failures >= args.max_consecutive_download_failures:
                    print(
                        f"[discover] consecutive download failures reached {consecutive_download_failures}, cooldown {args.cooldown_on_redirect:.1f}s",
                        file=sys.stderr,
                    )
                    time.sleep(args.cooldown_on_redirect)
                    consecutive_download_failures = 0
        if page * page_size >= total:
            progress["next_page"] = page + 1
            progress["finished_at"] = today_iso()
            save_json_file(progress_path, progress)
            break
        progress["next_page"] = page + 1
        progress["updated_at"] = today_iso()
        save_json_file(progress_path, progress)
        page += 1

    report = {
        "mode": "discover-flk",
        "started_at": progress.get("started_at") or today_iso(),
        "finished_at": today_iso(),
        "start_page": args.discover_start_page,
        "end_page": args.discover_end_page or None,
        "max_pages": args.discover_max_pages,
        "page_size": args.discover_page_size,
        "search": args.discover_search,
        "seen": total_seen,
        "downloaded": downloaded,
        "skipped": skipped,
        "failed": len(failures),
        "page_failed": len(page_failures),
        "output_dir": str(raw_dir.parent),
    }
    report_dir = raw_dir.parent / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    report_path = report_dir / f"discover-report-{stamp}.json"
    save_json_file(report_path, report)
    progress.setdefault("started_at", report["started_at"])
    progress["last_report"] = report_path.name
    save_json_file(progress_path, progress)
    print(f"[discover] report written to {report_path}")

    if failures:
        fail_path = raw_dir.parent / "download-failures.json"
        save_json_file(fail_path, failures)
        print(f"[discover] failures written to {fail_path}")
    if page_failures:
        page_fail_path = raw_dir.parent / "list-page-failures.json"
        old_page_failures = load_json_file(page_fail_path, [])
        if not isinstance(old_page_failures, list):
            old_page_failures = []
        save_json_file(page_fail_path, old_page_failures + page_failures)
        print(f"[discover] list page failures written to {page_fail_path}")
    print(f"[discover] seen={total_seen}, downloaded={downloaded}, skipped={skipped}")


def collect_sources(input_dir: Path) -> list[Path]:
    if not input_dir.exists():
        return []
    return sorted(
        [
            path
            for path in input_dir.rglob("*")
            if path.is_file() and path.suffix.lower() in {".docx", ".txt", ".md"}
        ],
        key=lambda p: p.name,
    )


def collect_compile_state(path: Path) -> dict[str, Any]:
    return load_json_file(path, {"files": {}, "updated_at": None})


def file_signature(path: Path) -> str:
    stat = path.stat()
    return f"{stat.st_size}:{int(stat.st_mtime)}"


def latest_effective(codes: list[dict[str, Any]]) -> str:
    dates = sorted([code.get("effective") for code in codes if code.get("effective")])
    return dates[-1] if dates else ""


def build_pack(args: argparse.Namespace) -> None:
    output_dir = Path(args.output_dir).resolve()
    raw_dir = output_dir / "raw"
    compiled_dir = output_dir / "compiled"
    compile_state_path = output_dir / "compile-state.json"
    full_pack_path = output_dir / "lawbase-pack.json"
    raw_dir.mkdir(parents=True, exist_ok=True)
    compiled_dir.mkdir(parents=True, exist_ok=True)

    retry_fixed = 0
    retry_remain = 0
    if args.retry_failures:
        retry_fixed, retry_remain = retry_discover_failures(args, raw_dir)

    if args.core_profile:
        download_named_laws(args, raw_dir)

    if args.discover_flk:
        download_flk_discovered(args, raw_dir)

    if args.url_list:
        url_file = Path(args.url_list)
        for line in url_file.read_text(encoding="utf-8").splitlines():
            url = line.strip()
            if not url or url.startswith("#"):
                continue
            print(f"[download] {url}")
            try:
                downloaded = download_file(url, raw_dir, args.delay)
                print(f"  -> {downloaded.name}")
            except Exception as exc:
                print(f"  !! failed: {exc}", file=sys.stderr)

    if args.input_dir:
        input_dir = Path(args.input_dir).resolve()
        for source in collect_sources(input_dir):
            target = raw_dir / source.name
            if source.resolve() != target.resolve():
                shutil.copy2(source, target)

    download_index = load_json_file(output_dir / "download-index.json", {})
    source_metadata: dict[str, dict[str, Any]] = {}
    if isinstance(download_index, dict):
        for item in download_index.values():
            if isinstance(item, dict) and item.get("filename"):
                source_metadata[str(item.get("filename"))] = item

    compile_state = collect_compile_state(compile_state_path)
    compiled_files: dict[str, Any] = compile_state.get("files") or {}
    previous_pack = load_json_file(full_pack_path, {"manifest": {}, "codes": []})
    previous_codes = previous_pack.get("codes") if isinstance(previous_pack, dict) else []
    previous_code_map: dict[str, dict[str, Any]] = {}
    if isinstance(previous_codes, list):
        for code in previous_codes:
            if isinstance(code, dict) and code.get("source"):
                previous_code_map[str(code.get("source"))] = code

    all_sources = collect_sources(raw_dir)
    sources_to_compile: list[Path] = []
    if args.compile_incremental:
        for source in all_sources:
            key = source.name
            sig = file_signature(source)
            if (compiled_files.get(key) or {}).get("signature") != sig:
                sources_to_compile.append(source)
    else:
        sources_to_compile = all_sources

    codes_by_source = previous_code_map.copy() if args.compile_incremental else {}
    recompiled = 0
    reused = 0
    for source in collect_sources(raw_dir):
        if args.compile_incremental and source not in sources_to_compile:
            reused += 1
            continue
        try:
            code = apply_download_metadata(parse_law_file(source, source.name), source_metadata.get(source.name))
            codes_by_source[source.name] = code
            compiled_path = compiled_dir / f"{safe_filename(code['code'])}.json"
            compiled_path.write_text(json.dumps(code, ensure_ascii=False, indent=2), encoding="utf-8")
            compiled_files[source.name] = {
                "signature": file_signature(source),
                "code": code["code"],
                "updated_at": today_iso(),
            }
            recompiled += 1
            print(f"[compile] {source.name} -> {code['code']} ({len(code['articles'])} articles)")
        except Exception as exc:
            print(f"[compile failed] {source.name}: {exc}", file=sys.stderr)

    # 清理已删除原件在编译状态中的陈旧记录
    existing_names = {source.name for source in all_sources}
    stale_keys = [name for name in compiled_files if name not in existing_names]
    for key in stale_keys:
        compiled_files.pop(key, None)
        codes_by_source.pop(key, None)

    codes: list[dict[str, Any]] = sorted(codes_by_source.values(), key=lambda item: str(item.get("code") or ""))

    manifest = {
        "dataset_name": args.dataset_name,
        "source": args.source,
        "version": args.version or dt.date.today().isoformat(),
        "generated_at": today_iso(),
        "pack_tier": PROFILE_META.get(args.core_profile, {}).get("pack_tier", "full" if args.discover_flk else ""),
        "pack_profile": args.core_profile or None,
        "topic": PROFILE_META.get(args.core_profile, {}).get("topic"),
        "laws_count": len(codes),
        "latest_effective": latest_effective(codes) or None,
        "retry_failures_fixed": retry_fixed or None,
        "retry_failures_remain": retry_remain or None,
        "compile_incremental": bool(args.compile_incremental),
        "compile_recompiled": recompiled,
        "compile_reused": reused if args.compile_incremental else None,
    }
    pack = {"manifest": manifest, "codes": codes}
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    full_pack_path.write_text(json.dumps(pack, ensure_ascii=False, indent=2), encoding="utf-8")
    compile_state["files"] = compiled_files
    compile_state["updated_at"] = today_iso()
    save_json_file(compile_state_path, compile_state)
    print(f"[done] {len(codes)} laws written to {output_dir / 'lawbase-pack.json'}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build offline lawbase pack JSON for 案件知识库.")
    parser.add_argument("--input-dir", help="Directory containing downloaded .docx/.txt/.md law files.")
    parser.add_argument("--url-list", help="Text file of official Word download URLs, one URL per line.")
    parser.add_argument("--output-dir", default="lawbase-pack", help="Output directory.")
    parser.add_argument("--dataset-name", default="国家法律法规数据库法规包", help="Manifest dataset_name.")
    parser.add_argument("--source", default="https://flk.npc.gov.cn", help="Manifest source.")
    parser.add_argument("--version", default="", help="Manifest version. Defaults to today's date.")
    parser.add_argument("--delay", type=float, default=0.8, help="Delay seconds between downloads.")
    parser.add_argument("--discover-flk", action="store_true", help="Discover and download laws from the current flk.npc.gov.cn law-search API.")
    parser.add_argument("--discover-start-page", type=int, default=1, help="FLK discovery start page.")
    parser.add_argument("--discover-end-page", type=int, default=0, help="FLK discovery end page (inclusive). 0 means no upper bound.")
    parser.add_argument("--discover-max-pages", type=int, default=0, help="Max pages to discover. 0 means until list total is exhausted.")
    parser.add_argument("--discover-page-size", type=int, default=20, help="FLK discovery page size.")
    parser.add_argument("--discover-search", default="", help="Optional FLK search content keyword.")
    parser.add_argument("--discover-resume", action="store_true", help="Resume from previous discover-progress.json.")
    parser.add_argument("--discover-retries", type=int, default=2, help="Retry times for each discovered file download.")
    parser.add_argument("--list-retries", type=int, default=3, help="Retry times for FLK list page requests.")
    parser.add_argument("--cooldown-on-redirect", type=float, default=60.0, help="Cooldown seconds after temporary redirect/rate-limit responses.")
    parser.add_argument("--max-consecutive-download-failures", type=int, default=8, help="Cooldown after this many consecutive per-law download failures.")
    parser.add_argument("--retry-failures", action="store_true", help="Retry entries from download-failures.json before discover/compile.")
    parser.add_argument("--compile-incremental", action="store_true", help="Compile only changed/new raw files and reuse previous compiled results.")
    parser.add_argument("--core-profile", default="", help="Download a predefined core law profile before discover/compile. Example: court-basic")
    return parser.parse_args()


if __name__ == "__main__":
    build_pack(parse_args())
