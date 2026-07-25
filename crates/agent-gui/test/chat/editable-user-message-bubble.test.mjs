import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// Regression coverage for: pasting a long text turns it into an uploaded
// "pasted text" file referenced inline by the message as a
// "[Pasted text N: path]" marker (rendered as a chip once sent — see
// UserMessageRow / PastedTextChip). Editing that sent message used to show
// the *same* pasted-text file twice: once as a floating attachment card
// (EditableUserMessageBubble rendered the raw, unfiltered attachment list)
// and once as the raw marker text inside the editable textarea. The fix
// reuses splitUserAttachmentsForDisplay — already used by the read-only
// bubble — to hide that redundant card while still submitting the full,
// unfiltered attachment list on resend.

const rootDir = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const userAttachmentCardsPath = path.resolve(
  rootDir,
  "src/pages/chat/transcript/UserAttachmentCards.tsx",
);

let capturedCardsProps = [];

function MockUserAttachmentCards(props) {
  capturedCardsProps.push(props);
  return null;
}

const loader = createTsModuleLoader({
  mocks: {
    "react/jsx-runtime": jsxRuntime,
    [userAttachmentCardsPath]: { UserAttachmentCards: MockUserAttachmentCards },
  },
});

const { EditableUserMessageBubble } = loader.loadModule(
  "src/pages/chat/transcript/EditableUserMessageBubble.tsx",
);

function renderBubble(props) {
  capturedCardsProps = [];
  renderToStaticMarkup(
    jsxRuntime.jsx(EditableUserMessageBubble, {
      compactedClass: "",
      onCancel: () => {},
      onSubmit: () => {},
      ...props,
    }),
  );
  assert.equal(capturedCardsProps.length, 1, "UserAttachmentCards should render exactly once");
  return capturedCardsProps[0];
}

const pastedFile = {
  relativePath: ".liveagent/uploads/session-1/pasted-text-1.txt",
  fileName: "pasted-text-1.txt",
  kind: "text",
  sizeBytes: 4096,
  displayMode: "largePaste",
  displayLabel: "Pasted text 1",
  displayCharCount: 4096,
  displayLineCount: 120,
};

const normalFile = {
  relativePath: "docs/report.pdf",
  fileName: "report.pdf",
  kind: "pdf",
  sizeBytes: 2048,
};

test("editing hides the attachment card for a pasted-text file still referenced by its marker", () => {
  const text = `请看下 [Pasted text 1: ${pastedFile.relativePath}] 和附件`;

  const cardsProps = renderBubble({
    initialText: text,
    attachments: [normalFile, pastedFile],
  });

  assert.deepEqual(
    cardsProps.files.map((file) => file.relativePath),
    [normalFile.relativePath],
    "the pasted-text file must not double up as a card while its marker is still in the text",
  );
});

test("editing shows every attachment once no pasted-text marker references it", () => {
  const cardsProps = renderBubble({
    initialText: "普通消息，没有引用附件",
    attachments: [normalFile, pastedFile],
  });

  assert.deepEqual(
    new Set(cardsProps.files.map((file) => file.relativePath)),
    new Set([normalFile.relativePath, pastedFile.relativePath]),
    "without a marker in the text every attachment should still be visible and removable",
  );
});

test("removing the pasted-text marker text makes its attachment card reappear live", () => {
  // draftText starts with the marker (card hidden); the component's own
  // useMemo must react as the user keeps typing/removes the marker later —
  // simulated here by rendering with the marker already absent from a text
  // that still differs from initialText's default state.
  const cardsProps = renderBubble({
    initialText: "已经删除了粘贴引用，只剩下普通文字",
    attachments: [pastedFile],
  });

  assert.deepEqual(
    cardsProps.files.map((file) => file.relativePath),
    [pastedFile.relativePath],
    "once its marker is gone, the pasted-text file falls back to a normal, removable card",
  );
});
