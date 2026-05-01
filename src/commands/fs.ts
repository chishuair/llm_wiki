import { invoke } from "@tauri-apps/api/core"
import type { FileNode, WikiProject } from "@/types/wiki"

export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path })
}

export async function writeFile(path: string, contents: string): Promise<void> {
  return invoke<void>("write_file", { path, contents })
}

export async function listDirectory(path: string): Promise<FileNode[]> {
  return invoke<FileNode[]>("list_directory", { path })
}

export async function copyFile(
  source: string,
  destination: string
): Promise<void> {
  return invoke("copy_file", { source, destination })
}

export async function preprocessFile(path: string): Promise<string> {
  return invoke<string>("preprocess_file", { path })
}

export async function readPreloadedLawPack(): Promise<string> {
  return invoke<string>("read_preloaded_law_pack")
}

export interface OcrStatus {
  paddleocr: boolean
  tesseract: boolean
  ocrmypdf: boolean
  bundledSidecar?: boolean
}

export async function getOcrStatus(): Promise<OcrStatus> {
  const raw = await invoke<string>("ocr_status")
  return JSON.parse(raw) as OcrStatus
}

export interface LawbaseStatus {
  available: boolean
  source?: string
  version?: string
  articleCount: number
  updatedAt?: string
  path?: string
  error?: string
}

export interface CapabilityStatus {
  available: boolean
  source?: string
  version?: string
  path?: string
  error?: string
}

export interface OcrCapabilityStatus extends CapabilityStatus {
  bundledSidecar: boolean
  systemPaddleocr: boolean
  tesseract: boolean
  ocrmypdf: boolean
}

export interface LocalCapabilitiesStatus {
  lawbase: LawbaseStatus
  ocr: OcrCapabilityStatus
  pdfium: CapabilityStatus
}

export async function getLocalCapabilitiesStatus(): Promise<LocalCapabilitiesStatus> {
  return invoke<LocalCapabilitiesStatus>("local_capabilities_status")
}

export async function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path })
}

export async function findRelatedWikiPages(
  projectPath: string,
  sourceName: string
): Promise<string[]> {
  return invoke<string[]>("find_related_wiki_pages", { projectPath, sourceName })
}

export async function createDirectory(path: string): Promise<void> {
  return invoke<void>("create_directory", { path })
}

export async function createProject(
  name: string,
  path: string,
): Promise<WikiProject> {
  return invoke<WikiProject>("create_project", { name, path })
}

export async function openProject(path: string): Promise<WikiProject> {
  return invoke<WikiProject>("open_project", { path })
}

export async function clipServerStatus(): Promise<string> {
  return invoke<string>("clip_server_status")
}
