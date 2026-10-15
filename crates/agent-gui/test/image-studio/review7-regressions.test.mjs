import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsModuleLoader } from '../helpers/load-ts-module.mjs';

const loader = createTsModuleLoader();
const { ImageStudioController } = loader.loadModule('@liveagent/ui/features/image-studio/studioController');
const { draftKey, serializeDraft, restoreDraft } = loader.loadModule('@liveagent/ui/features/image-studio/drafts');
const wire = loader.loadModule('@liveagent/ui/lib/imaging/testdata/wire-v1.json');
const target = { ...wire.settings.targets[0], id: 't', enabled: true, parameters: [], capabilities: { ...wire.settings.targets[0].capabilities, operations: ['generate', 'reference', 'edit', 'mask'], maxCount: 4, maxInputs: 4 } };
const scope = { ownerId: 'o', backendId: 'b', projectId: 'p' };
const draft = { prompt: 'saved draft', targetId: 't', parameters: {}, inputs: [{ assetId: 'ia_parent', role: 'source' }], parentAssetId: 'ia_parent' };
const job = { id: 'j', projectId: 'p', revision: 1, lastEventSeq: 0, status: 'cancelled', assetIds: [], items: [], usage: null };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
function fake(overrides = {}) { return { capabilities: async () => ({ supported: true }), listTargets: async () => [target], listProjects: async () => ({ items: [{ id: 'p', title: 'P' }, { id: 'q', title: 'Q' }] }), listJobs: async () => ({ items: [] }), getJob: async () => job, subscribe: async () => {}, readAsset: async () => new Blob(), ...overrides }; }
async function setup(overrides = {}, store = storage(), owner = 'o', backend = 'b') { const c = new ImageStudioController(fake(overrides), owner, backend, store); await c.start(); return c; }

// Render the real composer through the existing TS/JSX fixture loader. Hooks persist across rerenders.
function composer(c) {
  const slots = []; let cursor = 0;
  const path = name => new URL(`../../../agent-ui/src/${name}`, import.meta.url).pathname;
  const ui = createTsModuleLoader({ mocks: {
    react: { useId: () => 'composer', useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; }, useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; } },
    [path('components/ui/button.tsx')]: { Button: 'button' },
    [path('components/ui/input.tsx')]: { Input: 'input' },
    [path('components/ui/textarea.tsx')]: { Textarea: 'textarea' },
    [path('features/image-studio/AssetImage.tsx')]: { AssetImage: 'img' },
    [path('features/image-studio/ImageTargetSettings.tsx')]: { ImageTargetSettings: 'target-settings' },
    [path('features/image-studio/TargetParameterForm.tsx')]: { selectClass: '', TargetParameterForm: 'parameters' },
  } });
  const { ImageComposer } = ui.loadModule('@liveagent/ui/features/image-studio/ImageComposer');
  const render = () => { cursor = 0; return ImageComposer({ controller: c, view: c.view }); };
  const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
  const text = node => typeof node === 'string' ? node : node?.props ? [node.props.children].flat(Infinity).map(text).join('') : '';
  return { render, buttons: () => flatten(render()).filter(n => n.type === 'button'), text,
    click: async (button, detail = 1) => { let prevented = false; const event = { detail, preventDefault() { prevented = true; } }; button.props.onClick?.(event); if (!prevented && button.props.type === 'submit') render().props.onSubmit({ preventDefault() {} }); await Promise.resolve(); await Promise.resolve(); },
  };
}

test('review7: 26ms second click after fast acceptance never becomes a new paid intent; explicit confirmation remains usable', async () => {
  const calls = []; const c = await setup({ createJob: async (request, key) => { calls.push({ request, key }); return job; } });
  try {
    c.updateDraft({ prompt: 'cat' }); const ui = composer(c);
    await ui.click(ui.buttons().find(b => b.props.type === 'submit'));
    assert.equal(c.view.submission.status, 'accepted');
    await new Promise(resolve => setTimeout(resolve, 26));
    const next = ui.buttons().find(b => /重新生成/.test(ui.text(b)));
    await ui.click(next, 2);
    assert.equal(calls.length, 1);
    // The generic form/Enter action also cannot reinterpret acceptance as a new intent.
    ui.render().props.onSubmit({ preventDefault() {} }); await Promise.resolve();
    assert.equal(calls.length, 1);
    await ui.click(ui.buttons().find(b => /重新生成/.test(ui.text(b))), 1);
    const confirm = ui.buttons().find(b => /确认重新生成/.test(ui.text(b)));
    assert.ok(confirm, 'a distinct explicit confirmation is required');
    await ui.click(confirm, 2); assert.equal(calls.length, 1);
    await ui.click(confirm, 1); assert.equal(calls.length, 2);
    assert.notEqual(calls[0].key, calls[1].key);
    await ui.click(confirm, 1); assert.equal(calls.length, 2, 'stale confirmation cannot create another intent');
    await ui.click(ui.buttons().find(b => /重新生成/.test(ui.text(b))), 0);
    await ui.click(ui.buttons().find(b => /确认重新生成/.test(ui.text(b))), 0);
    assert.equal(calls.length, 3, 'keyboard activation can create a fresh explicit intent');
  } finally { c.dispose(); }
});

test('review7: uncertain submission survives same-project selection, project changes and remount with original frozen request/key', async () => {
  const store = storage(); const calls = []; const client = { createJob: async (request, key) => { calls.push({ request, key }); throw new Error('lost receipt'); } };
  const c = await setup(client, store);
  c.updateDraft({ prompt: 'frozen' }); await c.submit(); const first = c.view.submission;
  c.updateDraft({ prompt: 'edited after submit' }); await c.selectProject('p');
  assert.equal(c.view.submission?.key, first.key);
  await c.selectProject('q'); assert.equal(c.view.submission, null);
  await c.selectProject('p'); assert.equal(c.view.submission?.key, first.key);
  assert.equal(c.view.submission.request.prompt, 'frozen'); c.dispose();
  const restored = await setup(client, store);
  try {
    assert.equal(restored.view.submission?.status, 'unknown');
    assert.equal(restored.view.submission.key, first.key);
    assert.equal(restored.view.draft.prompt, 'edited after submit');
    await restored.submit(true); // An unresolved request cannot be silently replaced, even by an explicit-new caller.
    assert.equal(restored.view.submission.key, first.key);
    await restored.submit(); assert.equal(calls.at(-1).key, first.key); assert.equal(calls.at(-1).request.prompt, 'frozen');
    const otherOwner = await setup({}, store, 'other', 'b'); assert.equal(otherOwner.view.submission, null); otherOwner.dispose();
    const otherBackend = await setup({}, store, 'o', 'other'); assert.equal(otherBackend.view.submission, null); otherBackend.dispose();
  } finally { restored.dispose(); }
});

test('review7: submitting snapshot is durable before dispatch and recovers as unknown while old response completes off-scope', async () => {
  const store = storage(); const pending = deferred(); const c = await setup({ createJob: () => pending.promise }, store);
  c.updateDraft({ prompt: 'in flight' }); const sending = c.submit(); const key = c.view.submission.key;
  const restored = await setup({}, store);
  assert.equal(restored.view.submission?.key, key); assert.equal(restored.view.submission.status, 'unknown'); restored.dispose();
  await c.selectProject('q'); pending.resolve(job); await sending;
  assert.equal(c.view.submission, null);
  await c.selectProject('p'); assert.equal(c.view.submission?.key, key); assert.equal(c.view.submission.status, 'accepted'); c.dispose();
});

test('review7: history failure cannot drop a successfully restored draft', async () => {
  const store = storage(); store.setItem(draftKey('o', 'b', 'p'), serializeDraft(scope, draft, [target]));
  const asset = deferred(); const c = new ImageStudioController(fake({ listJobs: async () => { throw Error('503'); }, readAsset: () => asset.promise }), 'o', 'b', store);
  const starting = c.start(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(c.view.draftReady, false);
  asset.resolve(new Blob()); await starting;
  assert.equal(c.view.draftReady, true); assert.equal(c.view.draft.prompt, draft.prompt); c.dispose();
  assert.equal(JSON.parse(store.getItem(draftKey('o', 'b', 'p'))).prompt, draft.prompt);
});

test('review7: failed storage read never enables writing an empty replacement', async () => {
  let writes = 0; const c = await setup({}, { getItem() { throw Error('storage blocked'); }, setItem() { writes++; }, removeItem() {} });
  assert.equal(c.view.draftReady, false); c.updateDraft({ prompt: 'cannot overwrite' }); c.dispose(); assert.equal(writes, 0);
});

test('review7: asset network/auth/503 failures retain inputs and parent, block new submission and can be revalidated', async () => {
  for (const error of [new Error('network'), { status: 503, code: 'IMAGE_UNAVAILABLE' }, { status: 401, code: 'IMAGE_AUTH_REQUIRED' }, { status: 403, code: 'IMAGE_FORBIDDEN' }]) {
    const store = storage(); store.setItem(draftKey('o', 'b', 'p'), serializeDraft(scope, draft, [target])); let calls = 0;
    const c = await setup({ readAsset: async () => { throw error; }, createJob: async () => { calls++; return job; } }, store);
    try {
      assert.deepEqual(c.view.draft.inputs, draft.inputs); assert.equal(c.view.draft.parentAssetId, draft.parentAssetId);
      assert.ok(c.validation().some(message => /核验|重验/.test(message))); await c.submit(); assert.equal(calls, 0);
      c.client.readAsset = async () => new Blob(); await c.revalidateInputs(); assert.deepEqual(c.validation(), []);
      await c.submit(); assert.equal(calls, 1);
    } finally { c.dispose(); }
  }
});

test('review7: only definitive asset absence is removed; transient errors preserve stored references', async () => {
  const raw = serializeDraft(scope, draft, [target]);
  const temporary = await restoreDraft(raw, scope, [target], async () => { throw { status: 503, code: 'IMAGE_UNAVAILABLE' }; });
  assert.deepEqual(temporary.draft.inputs, draft.inputs); assert.equal(temporary.draft.parentAssetId, 'ia_parent'); assert.deepEqual(temporary.invalidAssetIds, []); assert.deepEqual(temporary.unverifiedAssetIds, ['ia_parent']);
  const absent = await restoreDraft(raw, scope, [target], async () => { throw { status: 404, code: 'IMAGE_NOT_FOUND' }; });
  assert.deepEqual(absent.draft.inputs, []); assert.equal(absent.draft.parentAssetId, undefined); assert.deepEqual(absent.invalidAssetIds, ['ia_parent']);
});

test('review7: input filtering/removal and operation changes atomically clear orphan parent; validation catches malformed parent', async () => {
  const limited = { ...target, id: 'limited', capabilities: { ...target.capabilities, maxInputs: 1 } };
  const c = await setup({ listTargets: async () => [target, limited, { ...target, id: 'generate-only', capabilities: { ...target.capabilities, operations: ['generate'] } }] });
  try {
    c.updateDraft({ prompt: 'cat' }); c.editAsset('ia_parent');
    c.updateDraft({ inputs: [] }); assert.equal(c.view.draft.parentAssetId, undefined);
    c.editAsset('ia_parent'); c.setTarget('generate-only'); assert.equal(c.view.draft.parentAssetId, undefined);
    c.setTarget('t'); c.editAsset('ia_parent');
    c.updateDraft({ inputs: [{ assetId: 'ia_other', role: 'source' }, { assetId: 'ia_parent', role: 'reference' }] });
    c.setTarget('limited'); assert.equal(c.view.draft.parentAssetId, undefined);
    c.editAsset('ia_parent'); c.setOperation('generate'); assert.equal(c.view.draft.parentAssetId, undefined);
    c.view = { ...c.view, draft: { ...c.view.draft, parentAssetId: 'ia_missing' } };
    assert.ok(c.validation().some(message => /父图片/.test(message)));
  } finally { c.dispose(); }
});

test('review7: settings refresh migrates from old target definitions without replacing project/jobs/frozen submission', async () => {
  const old = { ...target, parameters: [
    { key: 'quality', type: 'string', label: 'Quality', enum: ['high', 'low'] },
    { key: 'keep', type: 'string', label: 'Keep' },
    { key: 'changed', type: 'integer', label: 'Changed' },
  ] };
  const c = await setup({ listTargets: async () => [old], listJobs: async () => ({ items: [job] }), createJob: async () => { throw Error('lost receipt'); } });
  try {
    c.updateDraft({ prompt: 'frozen', parameters: { quality: 'high', keep: 'yes', changed: 4 } }); await c.submit();
    const frozen = c.view.submission; const state = c.view.state;
    c.client.listTargets = async () => [{ ...old, parameters: [
      { key: 'quality', type: 'string', label: 'Quality', enum: ['low'], default: 'low' },
      { key: 'keep', type: 'string', label: 'Keep' },
      // Both types accept 4, but changing integer -> number must still ask for confirmation.
      { key: 'changed', type: 'number', label: 'Changed', default: 1 },
    ] }];
    await c.refreshTargets();
    assert.equal(c.view.projectId, 'p'); assert.equal(c.view.state, state); assert.equal(c.view.submission, frozen);
    assert.deepEqual(c.view.draft.parameters, { quality: 'low', keep: 'yes', changed: 1 });
    assert.deepEqual(c.view.dropped, ['quality', 'changed']); assert.ok(c.validation().some(message => /确认参数/.test(message)));
    await c.refreshTargets(); assert.deepEqual(c.view.dropped, ['quality', 'changed']);
    c.acknowledgeMigration(); assert.deepEqual(c.validation(), []);
    let replay; c.client.createJob = async (request, key) => { replay = { request, key }; return job; };
    await c.submit(); assert.equal(replay.key, frozen.key); assert.deepEqual(replay.request.parameters, { quality: 'high', keep: 'yes', changed: 4 });
    c.client.listTargets = async () => [{ ...old, enabled: false, disabledReason: 'disabled by settings' }]; await c.refreshTargets();
    assert.match(c.view.notice, /disabled by settings/); assert.ok(c.validation().length);
    const key = c.view.submission.key; await c.regenerate(key); assert.equal(c.view.submission.key, key);
    c.client.listTargets = async () => []; await c.refreshTargets();
    assert.equal(c.view.draft.targetId, 't'); assert.match(c.view.notice, /已删除/); assert.ok(c.validation().length); assert.equal(c.view.submission.key, key);
  } finally { c.dispose(); }
});

test('review7: target refresh ignores results after scope change, disposal or a newer refresh', async () => {
  const c = await setup();
  try {
    const pending = deferred(); c.client.listTargets = () => pending.promise; const refresh = c.refreshTargets();
    await c.selectProject('q'); pending.resolve([]); await refresh; assert.equal(c.view.targets[0].id, 't');
    const first = deferred(); c.client.listTargets = () => first.promise; const a = c.refreshTargets();
    c.client.listTargets = async () => [{ ...target, name: 'latest' }]; await c.refreshTargets(); first.resolve([]); await a;
    assert.equal(c.view.targets[0].name, 'latest');
    const last = deferred(); c.client.listTargets = () => last.promise; const b = c.refreshTargets(); c.dispose(); last.resolve([]); await b;
    assert.equal(c.view.targets[0].name, 'latest');
  } finally { c.dispose(); }
});

test('review7: failed durable submission write prevents dispatch, then retries the same key once storage recovers', async () => {
  const store = storage(); const original = store.setItem; let blocked = true; let calls = 0;
  store.setItem = (key, value) => { if (blocked && key.includes(':submission:')) throw Error('full'); original(key, value); };
  const c = await setup({ createJob: async () => { calls++; return job; } }, store);
  try {
    c.updateDraft({ prompt: 'cat' }); await c.submit(); const key = c.view.submission.key; assert.equal(calls, 0);
    blocked = false; await c.submit(); assert.equal(calls, 1); assert.equal(c.view.submission.key, key);
  } finally { c.dispose(); }
});

test('review7: replay auth rejection cannot clear an uncertain original or silently issue a new key', async () => {
  const c = await setup({ createJob: async () => { throw Error('network'); } });
  try {
    c.updateDraft({ prompt: 'cat' }); await c.submit(); const key = c.view.submission.key;
    c.client.createJob = async () => { throw { status: 401, code: 'IMAGE_AUTH_REQUIRED' }; };
    await c.submit(); assert.equal(c.view.submission.status, 'unknown'); assert.equal(c.view.submission.key, key);
  } finally { c.dispose(); }
});

test('review7: late original response cannot erase a later explicitly regenerated intent', async () => {
  const pending = deferred(); const c = await setup({ createJob: () => pending.promise });
  try {
    c.updateDraft({ prompt: 'cat' }); const original = c.submit();
    await c.selectProject('q'); await c.selectProject('p');
    c.client.createJob = async () => job; await c.submit();
    await c.regenerate(c.view.submission.key); const latest = c.view.submission.key;
    pending.reject({ status: 422, code: 'IMAGE_INVALID_INPUT' }); await original;
    await c.selectProject('q'); await c.selectProject('p'); assert.equal(c.view.submission.key, latest); assert.equal(c.view.submission.status, 'accepted');
  } finally { c.dispose(); }
});

test('review7: revalidation cannot resurrect a removed input or overwrite a newer prompt', async () => {
  const store = storage(); store.setItem(draftKey('o', 'b', 'p'), serializeDraft(scope, draft, [target]));
  const c = await setup({ readAsset: async () => { throw Error('network'); } }, store);
  try {
    const pending = deferred(); c.client.readAsset = () => pending.promise; const checking = c.revalidateInputs();
    c.updateDraft({ inputs: [], prompt: 'changed' }); pending.resolve(new Blob()); await checking;
    assert.deepEqual(c.view.draft.inputs, []); assert.equal(c.view.draft.parentAssetId, undefined); assert.equal(c.view.draft.prompt, 'changed');
    c.editAsset('ia_parent'); const next = deferred(); c.client.readAsset = () => next.promise; const again = c.revalidateInputs();
    c.updateDraft({ prompt: 'newer' }); next.resolve(new Blob()); await again; assert.equal(c.view.draft.prompt, 'newer');
    const last = deferred(); c.client.readAsset = () => last.promise; const unlinking = c.revalidateInputs();
    c.updateDraft({ parentAssetId: undefined }); last.resolve(new Blob()); await unlinking; assert.equal(c.view.draft.parentAssetId, undefined);
  } finally { c.dispose(); }
});

test('review7: malformed saved draft blocks persistence instead of replacing it with defaults', async () => {
  const store = storage(); store.setItem(draftKey('o', 'b', 'p'), '{broken');
  const c = await setup({}, store); assert.equal(c.view.draftReady, false); c.dispose();
  assert.equal(store.getItem(draftKey('o', 'b', 'p')), '{broken');
});

test('empty target selection does not claim a deletion after settings refresh', async()=>{
 const c=await setup({listTargets:async()=>[]});
 try {assert.equal(c.view.draft.targetId,'');await c.refreshTargets();assert.doesNotMatch(c.view.notice,/已删除/);assert.equal(c.view.draft.targetId,'');}
 finally{c.dispose();}
});