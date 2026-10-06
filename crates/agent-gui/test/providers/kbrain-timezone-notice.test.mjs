import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("time zone notice is passive, scoped, dismissible, deduplicated and cleared after recovery", () => {
  const storage = new Map();
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
  try {
    const api = createTsModuleLoader().loadModule("src/lib/planning/timeZoneNotice.ts");
    assert.equal(api.getTimeZoneNotice("a"), null);
    api.reportTimeZoneFailure("a", new Error("offline"));
    assert.equal(api.getTimeZoneNotice("a"), null);
    api.reportTimeZoneFailure("a", new Error("E:timezone_invalid"));
    assert.equal(api.getTimeZoneNotice("a").kind, "invalid");
    assert.equal(api.getTimeZoneNotice("b"), null);
    const first = api.getTimeZoneNotice("a");
    api.reportTimeZoneFailure("a", "E:timezone_invalid");
    assert.equal(api.getTimeZoneNotice("a"), first);
    api.dismissTimeZoneNotice("a");
    api.reportTimeZoneFailure("a", "E:timezone_invalid");
    assert.equal(api.getTimeZoneNotice("a"), null);
    const reloaded = createTsModuleLoader().loadModule("src/lib/planning/timeZoneNotice.ts");
    reloaded.reportTimeZoneFailure("a", "E:timezone_invalid");
    assert.equal(reloaded.getTimeZoneNotice("a"), null);
    api.observeTimeZoneResponse("a", "query", {timeZone:"Asia/Shanghai"});
    api.reportTimeZoneFailure("a", "E:timezone_invalid");
    assert.equal(api.getTimeZoneNotice("a").kind, "invalid");
    api.observeTimeZoneResponse("a", "timezone.get", {preference:"America/New_York",timeZone:"America/New_York",systemTimeZone:"Asia/Shanghai"});
    assert.equal(api.getTimeZoneNotice("a"), null, "intentional custom zone is valid");
    api.observeTimeZoneResponse("a", "timezone.get", {preference:"US/Eastern",timeZone:"America/New_York"});
    assert.equal(api.getTimeZoneNotice("a"), null, "IANA aliases are equivalent");
    api.observeTimeZoneResponse("a", "timezone.get", {preference:"Asia/Tokyo",timeZone:"Asia/Shanghai"});
    assert.equal(api.getTimeZoneNotice("a").kind, "mismatch");
    api.observeTimeZoneResponse("a", "query", {timeZone:"Asia/Shanghai"});
    assert.equal(api.getTimeZoneNotice("a").kind, "mismatch", "unrelated query must not clear preference mismatch");
    api.observeTimeZoneResponse("a", "timezone", {preference:"Asia/Tokyo",timeZone:"Asia/Tokyo"});
    assert.equal(api.getTimeZoneNotice("a"), null);
    api.observeTimeZoneResponse("a", "query", {timeZone:"Custom/Unknown"});
    assert.equal(api.getTimeZoneNotice("a").kind, "unsupported");
  } finally { globalThis.sessionStorage = previous; }
});
