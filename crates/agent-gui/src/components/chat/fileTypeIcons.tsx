import type { ComponentType, SVGProps } from "react";

import FileTypeTypescript from "~icons/vscode-icons/file-type-typescript-official";
import FileTypeReactTs from "~icons/vscode-icons/file-type-reactts";
import FileTypeJs from "~icons/vscode-icons/file-type-js-official";
import FileTypeReactJs from "~icons/vscode-icons/file-type-reactjs";
import FileTypePython from "~icons/vscode-icons/file-type-python";
import FileTypeRust from "~icons/vscode-icons/file-type-rust";
import FileTypeGo from "~icons/vscode-icons/file-type-go";
import FileTypeJava from "~icons/vscode-icons/file-type-java";
import FileTypeHtml from "~icons/vscode-icons/file-type-html";
import FileTypeCss from "~icons/vscode-icons/file-type-css";
import FileTypeJson from "~icons/vscode-icons/file-type-json";
import FileTypeMarkdown from "~icons/vscode-icons/file-type-markdown";
import FileTypeYaml from "~icons/vscode-icons/file-type-yaml";
import FileTypeToml from "~icons/vscode-icons/file-type-toml";
import FileTypeVue from "~icons/vscode-icons/file-type-vue";
import FileTypeSvelte from "~icons/vscode-icons/file-type-svelte";
import FileTypeShell from "~icons/vscode-icons/file-type-shell";
import FileTypeImage from "~icons/vscode-icons/file-type-image";
import FileTypeSvg from "~icons/vscode-icons/file-type-svg";
import FileTypePdf from "~icons/vscode-icons/file-type-pdf2";
import FileTypeZip from "~icons/vscode-icons/file-type-zip";
import FileTypeXml from "~icons/vscode-icons/file-type-xml";
import FileTypeSql from "~icons/vscode-icons/file-type-sql";
import FileTypeC from "~icons/vscode-icons/file-type-c";
import FileTypeCpp from "~icons/vscode-icons/file-type-cpp";
import FileTypeCsharp from "~icons/vscode-icons/file-type-csharp";
import FileTypePhp from "~icons/vscode-icons/file-type-php";
import FileTypeRuby from "~icons/vscode-icons/file-type-ruby";
import FileTypeSwift from "~icons/vscode-icons/file-type-swift";
import FileTypeKotlin from "~icons/vscode-icons/file-type-kotlin";
import FileTypeDart from "~icons/vscode-icons/file-type-dartlang";
import FileTypeLog from "~icons/vscode-icons/file-type-log";
import FileTypeExcel from "~icons/vscode-icons/file-type-excel";
import FileTypeWord from "~icons/vscode-icons/file-type-word";
import FileTypePowerpoint from "~icons/vscode-icons/file-type-powerpoint";
import FileTypeText from "~icons/vscode-icons/file-type-text";
import FileTypeFont from "~icons/vscode-icons/file-type-font";
import FileTypeVideo from "~icons/vscode-icons/file-type-video";
import FileTypeAudio from "~icons/vscode-icons/file-type-audio";
import FileTypeBat from "~icons/vscode-icons/file-type-bat";
import FileTypePowershell from "~icons/vscode-icons/file-type-powershell";
import FileTypeDocker from "~icons/vscode-icons/file-type-docker";
import FileTypeGit from "~icons/vscode-icons/file-type-git";
import FileTypeLicense from "~icons/vscode-icons/file-type-license";
import FileTypeConfig from "~icons/vscode-icons/file-type-config";
import FileTypeBinary from "~icons/vscode-icons/file-type-binary";
import DefaultFile from "~icons/vscode-icons/default-file";
import DefaultFolder from "~icons/vscode-icons/default-folder";

type IconSource = ComponentType<SVGProps<SVGSVGElement>>;

const EXT_ICON: Record<string, IconSource> = {
  ts: FileTypeTypescript,
  mts: FileTypeTypescript,
  cts: FileTypeTypescript,
  tsx: FileTypeReactTs,
  js: FileTypeJs,
  mjs: FileTypeJs,
  cjs: FileTypeJs,
  jsx: FileTypeReactJs,
  py: FileTypePython,
  pyi: FileTypePython,
  rs: FileTypeRust,
  go: FileTypeGo,
  java: FileTypeJava,
  html: FileTypeHtml,
  htm: FileTypeHtml,
  css: FileTypeCss,
  scss: FileTypeCss,
  sass: FileTypeCss,
  less: FileTypeCss,
  json: FileTypeJson,
  jsonc: FileTypeJson,
  md: FileTypeMarkdown,
  mdx: FileTypeMarkdown,
  markdown: FileTypeMarkdown,
  yaml: FileTypeYaml,
  yml: FileTypeYaml,
  toml: FileTypeToml,
  vue: FileTypeVue,
  svelte: FileTypeSvelte,
  sh: FileTypeShell,
  bash: FileTypeShell,
  zsh: FileTypeShell,
  fish: FileTypeShell,
  bat: FileTypeBat,
  cmd: FileTypeBat,
  ps1: FileTypePowershell,
  png: FileTypeImage,
  jpg: FileTypeImage,
  jpeg: FileTypeImage,
  gif: FileTypeImage,
  webp: FileTypeImage,
  bmp: FileTypeImage,
  ico: FileTypeImage,
  avif: FileTypeImage,
  svg: FileTypeSvg,
  pdf: FileTypePdf,
  zip: FileTypeZip,
  tar: FileTypeZip,
  gz: FileTypeZip,
  tgz: FileTypeZip,
  rar: FileTypeZip,
  "7z": FileTypeZip,
  xml: FileTypeXml,
  sql: FileTypeSql,
  c: FileTypeC,
  h: FileTypeC,
  cpp: FileTypeCpp,
  cc: FileTypeCpp,
  cxx: FileTypeCpp,
  hpp: FileTypeCpp,
  cs: FileTypeCsharp,
  php: FileTypePhp,
  rb: FileTypeRuby,
  swift: FileTypeSwift,
  kt: FileTypeKotlin,
  kts: FileTypeKotlin,
  dart: FileTypeDart,
  log: FileTypeLog,
  xls: FileTypeExcel,
  xlsx: FileTypeExcel,
  doc: FileTypeWord,
  docx: FileTypeWord,
  ppt: FileTypePowerpoint,
  pptx: FileTypePowerpoint,
  txt: FileTypeText,
  text: FileTypeText,
  rtf: FileTypeText,
  ttf: FileTypeFont,
  otf: FileTypeFont,
  woff: FileTypeFont,
  woff2: FileTypeFont,
  mp4: FileTypeVideo,
  mov: FileTypeVideo,
  webm: FileTypeVideo,
  mkv: FileTypeVideo,
  avi: FileTypeVideo,
  mp3: FileTypeAudio,
  wav: FileTypeAudio,
  flac: FileTypeAudio,
  ogg: FileTypeAudio,
  m4a: FileTypeAudio,
  exe: FileTypeBinary,
  dll: FileTypeBinary,
  so: FileTypeBinary,
  bin: FileTypeBinary,
  o: FileTypeBinary,
  wasm: FileTypeBinary,
};

const NAME_ICON: Record<string, IconSource> = {
  dockerfile: FileTypeDocker,
  "docker-compose.yml": FileTypeDocker,
  "docker-compose.yaml": FileTypeDocker,
  ".gitignore": FileTypeGit,
  ".gitattributes": FileTypeGit,
  ".gitmodules": FileTypeGit,
  ".gitkeep": FileTypeGit,
  license: FileTypeLicense,
  "license.md": FileTypeLicense,
  "license.txt": FileTypeLicense,
  ".env": FileTypeConfig,
  ".env.local": FileTypeConfig,
  ".env.development": FileTypeConfig,
  ".env.production": FileTypeConfig,
  ".editorconfig": FileTypeConfig,
  ".prettierrc": FileTypeConfig,
  ".eslintrc": FileTypeConfig,
  ".npmrc": FileTypeConfig,
  ".nvmrc": FileTypeConfig,
  makefile: FileTypeShell,
  "package-lock.json": FileTypeJson,
  "pnpm-lock.yaml": FileTypeYaml,
  "cargo.lock": FileTypeToml,
};

function lastSegment(path: string) {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

function extOf(name: string) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function getFileTypeIcon(path: string, kind: "file" | "dir"): IconSource {
  if (kind === "dir") return DefaultFolder;
  const name = lastSegment(path).toLowerCase();
  const byName = NAME_ICON[name];
  if (byName) return byName;
  const ext = extOf(name);
  if (ext && EXT_ICON[ext]) return EXT_ICON[ext];
  return DefaultFile;
}

export type FileTypeIconComponent = IconSource;
