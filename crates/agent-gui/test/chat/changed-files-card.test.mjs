import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const rootDir = fileURLToPath(new URL("../..", import.meta.url));

function NullIcon() {
  return null;
}

function createCardModule(rootDir) {
  const requireFromRoot = createRequire(path.join(rootDir, "package.json"));
  const jsxRuntime = requireFromRoot("react/jsx-runtime");
  const { renderToStaticMarkup } = requireFromRoot("react-dom/server");
  const resolveSource = (relativePath) => path.join(rootDir, "src", relativePath);
  const loader = createTsModuleLoader({
    rootDir,
    mocks: {
      "react/jsx-runtime": jsxRuntime,
      [resolveSource("i18n/index.ts")]: {
        useLocale() {
          return {
            t(key) {
              return key;
            },
          };
        },
      },
      [resolveSource("components/icons.tsx")]: {
        FilePenLine: NullIcon,
      },
      [resolveSource("components/chat/fileTypeIcons.tsx")]: {
        getFileTypeIcon() {
          return NullIcon;
        },
      },
      [resolveSource("components/chat/FileChangeBadge.tsx")]: {
        FileChangeBadge() {
          return null;
        },
      },
    },
  });

  return {
    cardModule: loader.loadModule("src/components/chat/ChangedFilesCard.tsx"),
    jsxRuntime,
    renderToStaticMarkup,
  };
}

function renderCard({ cardModule, jsxRuntime, renderToStaticMarkup }) {
  const paths = [
    { path: "src/components/ChangedFilesCard.tsx", deleted: false },
    { path: "README.md", deleted: false },
    { path: "src\\pages\\Settings.tsx", deleted: false },
    { path: "tmp/removed.ts", deleted: true },
  ];
  const summary = {
    files: paths.map((file, index) => ({
      ...file,
      added: index + 1,
      removed: index,
      lastToolCallId: `call-${index}`,
    })),
    totalAdded: 11,
    totalRemoved: 8,
  };

  return renderToStaticMarkup(
    jsxRuntime.jsx(cardModule.ChangedFilesCard, { summary }),
  );
}

function assertVerticalPath(html, fileName, directory, fromIndex = 0) {
  const fileNameIndex = html.indexOf(`>${fileName}</span>`, fromIndex);
  const directoryIndex = html.indexOf(`>${directory}</span>`, fileNameIndex);
  assert.notEqual(fileNameIndex, -1, `missing file name ${fileName}`);
  assert.notEqual(directoryIndex, -1, `missing directory ${directory}`);
  assert.ok(fileNameIndex < directoryIndex, `${fileName} must render above its directory`);
  return directoryIndex;
}

test("GUI changed-files rows render file names above directory paths", () => {
  const html = renderCard(createCardModule(rootDir));

  let position = assertVerticalPath(html, "ChangedFilesCard.tsx", "src/components/");
  position = assertVerticalPath(html, "README.md", ".", position);
  assertVerticalPath(html, "Settings.tsx", "src/pages/", position);

  assert.match(
    html,
    /class="[^"]*line-through[^"]*"[^>]*>removed\.ts<\/span><span[^>]*>tmp\/<\/span>/,
  );
  assert.ok(html.includes("max-h-[calc(200px*var(--zone-font-scale,1))]"));
});
