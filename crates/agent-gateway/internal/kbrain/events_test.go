package kbrain

import (
	"encoding/json"
	"testing"

	gatewayv2 "github.com/liveagent/agent-gateway/internal/proto/v2"
)

func TestCanonicalEventsMapToGatewayVocabulary(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{"text": "hello"})
	event, control, err := ToChatEvent(Event{ConversationID: "c1", RunID: "r1", Type: "assistant.text.delta", Payload: payload})
	if err != nil {
		t.Fatal(err)
	}
	if control != nil || event == nil || event.Type != gatewayv2.ChatEvent_TOKEN || event.ConversationId != "c1" {
		t.Fatalf("event=%+v control=%+v", event, control)
	}

	_, control, err = ToChatEvent(Event{ConversationID: "c1", RunID: "r1", Type: "run.completed"})
	if err != nil {
		t.Fatal(err)
	}
	if control == nil || control.Type != "completed" || control.RequestId != "r1" {
		t.Fatalf("control=%+v", control)
	}
}
