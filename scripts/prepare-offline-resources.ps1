$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$LawbaseDest = Join-Path $RepoRoot "resources\lawbase"
$LawbasePack = Join-Path $LawbaseDest "lawbase-pack.json"
$LegacyLawbasePack = Join-Path $RepoRoot "lawbase-pack-full\lawbase-pack.json"
$LegacyLawbaseManifest = Join-Path $RepoRoot "lawbase-pack-full\manifest.json"

if (-not (Test-Path $LawbasePack) -and (Test-Path $LegacyLawbasePack)) {
  New-Item -ItemType Directory -Force -Path $LawbaseDest | Out-Null
  Copy-Item $LegacyLawbasePack $LawbasePack -Force
  if (Test-Path $LegacyLawbaseManifest) {
    Copy-Item $LegacyLawbaseManifest (Join-Path $LawbaseDest "manifest.json") -Force
  }
}

$RequiredPaths = @(
  "resources\lawbase\lawbase-pack.json",
  "resources\ocr\paddleocr-sidecar.exe",
  "resources\ocr\.paddlex\official_models",
  "resources\pdfium\pdfium.dll",
  "resources\docs"
)

foreach ($relativePath in $RequiredPaths) {
  $path = Join-Path $RepoRoot $relativePath
  if (-not (Test-Path $path)) {
    Write-Error "[offline-resources] Missing required Windows resource: $relativePath"
  }
}

Write-Host "[offline-resources] lawbase ready: resources\lawbase\lawbase-pack.json"
Write-Host "[offline-resources] OCR sidecar ready: resources\ocr\paddleocr-sidecar.exe"
Write-Host "[offline-resources] OCR models ready: resources\ocr\.paddlex\official_models"
Write-Host "[offline-resources] PDFium ready: resources\pdfium\pdfium.dll"
