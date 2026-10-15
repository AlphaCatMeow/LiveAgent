# ImageStudio isolated browser harness

Status: **BROWSER VERIFICATION BLOCKED / NOT ACCEPTED**.

This mounts the actual shared `ImageStudioPage`, `ImageSettings`, and `createImageStudioClient`, with GUI aliases and CSS. All imaging transport responses are in-memory test fixtures. No real provider, paid generation, production backend, personal configuration, or credentials are used. The visible yellow header identifies test mode. This cannot replace real desktop/web host acceptance.

Start from `crates/agent-gui`:

```sh
pnpm exec vite --config test/image-studio/browser/vite.config.ts
```

- New strict local port: http://127.0.0.1:18473/
- Workbench: `/`
- Settings: `/?settings`
- Navigation between these routes reloads and resets fixture state.
- Draft storage is an in-memory Map.
- Browser fixture audit: `window.__fixture.audit`. It records request paths, methods, idempotency keys, Last-Event-ID, request bodies, and upload metadata. Secret write values are redacted and not retained in the audit.
- Test image bytes are generated in memory by a canvas and labelled TEST FIXTURE; no screenshot/image artifact has been saved.

## Actual evidence

Vite 8.0.5 started successfully on port 18473. Harness bundle build was run; see parent report for final result. A build is not browser runtime validation.

The required browser attempt used isolated session `headless:image-studio-validation`:

```text
goto('http://127.0.0.1:18473')
Error: blocked: 127.0.0.1 is a private/internal address (set browser.allowPrivateUrls to permit)
```

No permission changes or alternate-address bypass were attempted. No browser DOM result, interaction, screenshot, or viewport evidence exists. **Every acceptance scenario below remains unverified**. No production bug is asserted from this run.

## Ready fixture scenarios / pending actual browser checks

1. Create project via 新项目名称 / 新建项目; rename and delete via 管理当前项目. Inspect audit POST/PATCH/DELETE and actual UI updates.
2. Choose TEST ONLY Disabled and fill prompt. Verify submit stays disabled and no POST /jobs occurs. Enabled selection with empty prompt/count violations should also block submission.
3. Enabled + generate + prompt + submit. Fixture waits 450ms, then returns a job. SSE sends two asset.ready events and job.finished; verify result gallery, image decode, detail selection, compare view and close.
4. Switch to edit; upload a local PNG using the real file input; verify multipart upload audit and source asset in create request. Generated/upload asset IDs use the `ia_` prefix required by draft sanitation.
5. Select Lost receipt mode then submit. Fixture accepts job, loses first response, and deduplicates by Idempotency-Key. Click 核对原请求; verify same key and one backend job. Check double submission while pending separately.
6. Submit error mode returns IMAGE_INVALID_INPUT. Verify error feedback and recovery by changing prompt/mode.
7. Pending / cancel mode keeps SSE open. Cancel task; fixture returns cancelled snapshot. Verify UI state.
8. SSE reconnect mode ends first stream after seq 1. Verify next audit Last-Event-ID is 1 and final results appear once.
9. Settings save increments revision. Conflict on next settings save checkbox returns IMAGE_REVISION_CONFLICT and advances fixture revision. Verify actual draft retention, conflict review and save workflow using real component controls.
10. Settings secret input must use a synthetic marker only. Verify successful clearing and absence from rendered text, draft persistence and audit. The audit intentionally redacts write-only values; that alone does not establish component non-leakage.
11. Desktop and actual mobile viewport need browser evidence. Do not report a CSS inspection or a narrow container as mobile viewport verification. If tool cannot resize/emulate viewport, record mobile as unsupported/unverified.

Fixture limitations: all output images share a test canvas, success emits two outputs regardless of requested count, asset parent lineage is empty, project revision checks and event-gap reconciliation are not simulated, exports are not configured. These are test-fixture limitations and must not be reported as product defects. The settings implementation may still be changing in the parallel parent task; rerun against its final revision.
