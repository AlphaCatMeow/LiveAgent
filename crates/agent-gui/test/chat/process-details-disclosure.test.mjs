import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

let currentOpen;
let stateInitialized;
let disclosureKey;
let disclosureKeySequence = 0;

function resetHooks({ preserveDisclosureKey = false } = {}) {
  currentOpen = undefined;
  stateInitialized = false;
  if (!preserveDisclosureKey) {
    disclosureKey = `conversation:reply-${++disclosureKeySequence}`;
  }
}

const loader = createTsModuleLoader({
  mocks: {
    react: {
      memo: (component) => component,
      useId: () => "process-details-region",
      useState(initial) {
        if (!stateInitialized) {
          currentOpen = typeof initial === "function" ? initial() : initial;
          stateInitialized = true;
        }
        return [
          currentOpen,
          (next) => {
            currentOpen = typeof next === "function" ? next(currentOpen) : next;
          },
        ];
      },
    },
    "../../../../components/icons": {
      ChevronRight: (props) => ({ type: "ChevronRight", props }),
      Lightbulb: (props) => ({ type: "Lightbulb", props }),
    },
    "../../../../i18n": {
      useLocale: () => ({ t: (key) => key }),
    },
    "./LazyCollapse": {
      LazyCollapse: (props) => ({ type: "LazyCollapse", props }),
    },
  },
});

const { ProcessDetailsDisclosure } = loader.loadModule(
  "src/pages/chat/components/assistant-bubble/ProcessDetailsDisclosure.tsx",
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

test("thinking and activity inside process details start collapsed", () => {
  const source = fs.readFileSync(
    fileURLToPath(
      new URL(
        "../../src/pages/chat/components/assistant-bubble/RoundContent.tsx",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  assert.match(source, /open=\{withinProcessDetails \? false : isRunning\}/);
  assert.equal((source.match(/defaultOpen=\{false\}/g) ?? []).length, 2);
});

test("process-only replies open automatically until the user intervenes", () => {
  resetHooks();
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
  const collapsed = render();
  assert.equal(toggleButton(collapsed).props["aria-expanded"], false);
  const expanded = render({ expandByDefault: true });
  assert.equal(toggleButton(expanded).props["aria-expanded"], true);
});

test("an untouched process waits for the stream to settle before collapsing", () => {
  resetHooks();
  const processOnly = render({ hasSubstantiveAnswer: false, isStreaming: true });
  assert.equal(toggleButton(processOnly).props["aria-expanded"], true);

  const candidateAnswer = render({ hasSubstantiveAnswer: true, isStreaming: true });
  assert.equal(toggleButton(candidateAnswer).props["aria-expanded"], true);

  const laterProcessEvent = render({ hasSubstantiveAnswer: false, isStreaming: true });
  assert.equal(toggleButton(laterProcessEvent).props["aria-expanded"], true);

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
