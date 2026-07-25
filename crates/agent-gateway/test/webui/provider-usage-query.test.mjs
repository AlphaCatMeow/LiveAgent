import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayV2Codec } from "../helpers/gateway-v2.mjs";
import { createWebModuleLoader } from "../helpers/load-web-module.mjs";

const requestCalls = [];
const loader = createWebModuleLoader({
  mocks: {
    "@/lib/gatewaySocket": {
      getGatewayWebSocketClient() {
        return {
          providerUsageQuery(providerId, refresh) {
            requestCalls.push({ providerId, refresh });
            return Promise.resolve({
              entries: [{ label: "Credits", value: "11" }],
              queriedAt: 123,
              error: null,
              isStale: false,
            });
          },
        };
      },
    },
    "@/lib/storage": { loadToken: () => "gateway-token" },
  },
});
const usage = loader.loadModule("src/lib/providers/usageQuery.ts");
const adapters = loader.loadModule("src/lib/gatewaySocketV2/adapters.ts");
const codec = createGatewayV2Codec(loader);

test("WebUI query client refreshes one provider through the Gateway", async () => {
  requestCalls.length = 0;

  const result = await usage.queryProviderUsage("provider-a", true);

  assert.equal(result.entries[0].value, "11");
  assert.deepEqual(requestCalls, [{ providerId: "provider-a", refresh: true }]);
});

test("WebUI protobuf encodes usage request and decodes JSON response", () => {
  const request = codec.decodeClientFrame(
    adapters.encodeRequestFrame(
      "request-1",
      "provider.usage.query",
      { provider_id: "provider-a", refresh: true },
      "desktop-agent",
    ),
  );

  assert.equal(request.case, "agentRequest");
  assert.deepEqual(request.json.agent_request.provider_usage, {
    provider_id: "provider-a",
    refresh: true,
  });

  const frame = codec.encodeServerFrame({
    request_id: "request-1",
    agent_id: "desktop-agent",
    agent_response: {
      provider_usage_resp: {
        result_json: JSON.stringify({
          entries: [{ label: "Credits", value: "11" }],
          queriedAt: 123,
          error: null,
          isStale: false,
        }),
      },
    },
  });
  const decoded = adapters.decodeServerFrame(adapters.decodeServerFrameBinary(frame), {
    agentOnline: true,
  });

  assert.deepEqual(decoded, {
    kind: "response",
    requestId: "request-1",
    agentId: "desktop-agent",
    payload: {
      entries: [{ label: "Credits", value: "11" }],
      queriedAt: 123,
      error: null,
      isStale: false,
    },
  });
});
