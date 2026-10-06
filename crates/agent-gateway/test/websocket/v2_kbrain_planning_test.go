package websocket_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	gatewayv2 "github.com/liveagent/agent-gateway/internal/proto/v2"
	"github.com/liveagent/agent-gateway/internal/protocol/pbws"
	"github.com/liveagent/agent-gateway/internal/session"
)

func TestV2KBrainPlanningReportsDesktopRequirement(t *testing.T) {
	backend := httptest.NewServer(http.NotFoundHandler())
	defer backend.Close()
	cfg := newV2TestConfig()
	cfg.KBrainURL = backend.URL
	cfg.KBrainAgentID = "planning-kbrain"
	cfg.KBrainProvider = "fixture"
	cfg.KBrainModel = "fixture"
	srv := pbws.NewServer(cfg, session.NewManager(), nil)
	mux := http.NewServeMux()
	mux.Handle("/ws/v2", srv.BrowserHandler())
	browser, cleanup := dialV2Path(t, mux, "/ws/v2")
	defer cleanup()
	helloV2(t, browser, cfg.Token)
	sendProtoFrame(t, browser, &gatewayv2.WebClientFrame{
		RequestId: "planning-query", AgentId: cfg.KBrainAgentID,
		Payload: &gatewayv2.WebClientFrame_AgentRequest{AgentRequest: &gatewayv2.GatewayEnvelope{
			Payload: &gatewayv2.GatewayEnvelope_Planning{Planning: &gatewayv2.PlanningRequest{Action: "query", InputJson: "{}"}},
		}},
	})
	response := receiveWebFrameWithID(t, browser, "planning-query")
	if response.GetLocalError().GetMessage() != "E:desktop_required" {
		t.Fatalf("unexpected Planning response: %v", response)
	}
}
