import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createWebModuleLoader } from "../../test/helpers/load-web-module.mjs";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const resolveSource = (relativePath) => path.join(rootDir, "src", relativePath);

let currentOpen;
let interactionRef;
let disclosureKey;
let disclosureKeySequence = 0;

function resetHooks({ preserveDisclosureKey = false } = {}) {
  currentOpen = undefined;
  interactionRef = undefined;
  if (!preserveDisclosureKey) {
    disclosureKey = `conversation:reply-${++disclosureKeySequence}`;
  }
}

const loader = createWebModuleLoader({
  rootDir,
  mocks: {
    react: {
      memo: (component) => component,
      useEffect: (effect) => effect(),
      useId: () => "process-details-region",
      useRef(initial) {
        interactionRef ??= { current: initial };
        return interactionRef;
      },
      useState(initial) {
        if (currentOpen === undefined) currentOpen = initial;
        return [
          currentOpen,
          (next) => {
            currentOpen = typeof next === "function" ? next(currentOpen) : next;
          },
        ];
      },
    },
    [resolveSource("components/icons.tsx")]: {
      ChevronRight: (props) => ({ type: "ChevronRight", props }),
      Lightbulb: (props) => ({ type: "Lightbulb", props }),
    },
    [resolveSource("i18n/index.ts")]: {
      useLocale: () => ({ t: (key) => key }),
    },
    [resolveSource("pages/chat/assistant-bubble/LazyCollapse.tsx")]: {
      LazyCollapse: (props) => ({ type: "LazyCollapse", props }),
    },
  },
});

const { ProcessDetailsDisclosure } = loader.loadModule(
  "src/pages/chat/assistant-bubble/ProcessDetailsDisclosure.tsx",
);

function render(overrides = {}) {
  return ProcessDetailsDisclosure({
    disclosureKey,
    hasSubstantiveAnswer: true,
    expandByDefault: false,
    children: () => "body",
    ...overrides,
  });
}

function toggleButton(rendered) {
  return rendered.props.children[0];
}

test("the aggregate disclosure exposes an accessible collapsed default", () => {
  resetHooks();
  const rendered = render();
  const button = toggleButton(rendered);

  assert.equal(button.type, "button");
  assert.equal(button.props.id, "process-details-region-toggle");
  assert.equal(button.props["aria-expanded"], false);
  assert.equal(button.props["aria-controls"], "process-details-region");
  const region = rendered.props.children[1];
  assert.equal(region.type, "section");
  assert.equal(region.props["aria-labelledby"], "process-details-region-toggle");
});

test("process-only replies open automatically until the user intervenes", () => {
  resetHooks();
  render();
  render({ hasSubstantiveAnswer: false });
  const automaticallyOpen = render({ hasSubstantiveAnswer: false });
  assert.equal(toggleButton(automaticallyOpen).props["aria-expanded"], true);

  toggleButton(automaticallyOpen).props.onClick();
  const manuallyClosed = render({ hasSubstantiveAnswer: false });
  assert.equal(toggleButton(manuallyClosed).props["aria-expanded"], false);

  const finalAnswerArrived = render({ hasSubstantiveAnswer: true, expandByDefault: true });
  assert.equal(
    toggleButton(finalAnswerArrived).props["aria-expanded"],
    false,
    "a later automatic default must not override the user's choice for this response",
  );
});

test("the setting updates mounted replies that have no manual override", () => {
  resetHooks();
  render();
  render({ expandByDefault: true });
  const expanded = render({ expandByDefault: true });
  assert.equal(toggleButton(expanded).props["aria-expanded"], true);
});

test("an untouched process waits for the stream to settle before collapsing", () => {
  resetHooks();
  const processOnly = render({ hasSubstantiveAnswer: false, isStreaming: true });
  assert.equal(toggleButton(processOnly).props["aria-expanded"], true);

  render({ hasSubstantiveAnswer: true, isStreaming: true });
  const candidateAnswer = render({ hasSubstantiveAnswer: true, isStreaming: true });
  assert.equal(toggleButton(candidateAnswer).props["aria-expanded"], true);

  render({ hasSubstantiveAnswer: false, isStreaming: true });
  const laterProcessEvent = render({ hasSubstantiveAnswer: false, isStreaming: true });
  assert.equal(toggleButton(laterProcessEvent).props["aria-expanded"], true);

  render({ hasSubstantiveAnswer: true, isStreaming: false });
  const settledAnswer = render({ hasSubstantiveAnswer: true, isStreaming: false });
  assert.equal(toggleButton(settledAnswer).props["aria-expanded"], false);
});

test("manual state survives a virtualized unmount and remount", () => {
  resetHooks();
  const expanded = render({ expandByDefault: true });
  toggleButton(expanded).props.onClick();

  resetHooks({ preserveDisclosureKey: true });
  const remounted = render({ expandByDefault: true });
  assert.equal(toggleButton(remounted).props["aria-expanded"], false);

  const settingChanged = render({ expandByDefault: true, forceOpen: true });
  assert.equal(
    toggleButton(settingChanged).props["aria-expanded"],
    false,
    "automatic failure/cancellation visibility must not override a restored manual choice",
  );
});

test("failure and cancellation force untouched process details open", () => {
  resetHooks();
  const forcedOpen = render({ forceOpen: true });
  assert.equal(toggleButton(forcedOpen).props["aria-expanded"], true);
});
