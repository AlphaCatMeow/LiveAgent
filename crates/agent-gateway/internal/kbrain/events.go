package kbrain

import (
	"encoding/json"
	"fmt"
	"strings"

	v2 "github.com/liveagent/agent-gateway/internal/proto/v2"
)

// ToChatEvent translates one canonical K-brain event into the legacy Gateway
// event vocabulary. Provider-specific response/chat-message fields never cross
// this boundary.
func ToChatEvent(event Event) (*v2.ChatEvent, *v2.ChatControlEvent, error) {
	payload := map[string]any{}
	if len(event.Payload) != 0 && string(event.Payload) != "null" {
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return nil, nil, fmt.Errorf("decode kbrain event payload: %w", err)
		}
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}
	base := &v2.ChatEvent{ConversationId: event.ConversationID, Data: string(data)}
	switch strings.TrimSpace(event.Type) {
	case "run.accepted":
		return nil, &v2.ChatControlEvent{RequestId: event.RunID, ConversationId: event.ConversationID, Type: "started"}, nil
	case "user.message.appended":
		base.Type = v2.ChatEvent_USER_MESSAGE
	case "assistant.text.delta":
		base.Type = v2.ChatEvent_TOKEN
	case "assistant.message.created":
		base.Type = v2.ChatEvent_TOKEN
	case "assistant.thinking.delta":
		base.Type = v2.ChatEvent_THINKING
	case "assistant.sources":
		base.Type = v2.ChatEvent_HOSTED_SEARCH
	case "tool.call":
		base.Type = v2.ChatEvent_TOOL_CALL
	case "tool.result":
		base.Type = v2.ChatEvent_TOOL_RESULT
	case "tool.status":
		base.Type = v2.ChatEvent_TOOL_STATUS
	case "run.completed":
		return nil, &v2.ChatControlEvent{RequestId: event.RunID, ConversationId: event.ConversationID, Type: "completed"}, nil
	case "run.failed":
		message := ""
		if terminal, ok := payloadAsMap(payload); ok {
			message, _ = terminal["error"].(string)
		}
		return nil, &v2.ChatControlEvent{RequestId: event.RunID, ConversationId: event.ConversationID, Type: "failed", Message: message}, nil
	case "run.cancelled":
		return nil, &v2.ChatControlEvent{RequestId: event.RunID, ConversationId: event.ConversationID, Type: "cancelled"}, nil
	default:
		return nil, nil, nil
	}
	return base, nil, nil
}

func payloadAsMap(payload map[string]any) (map[string]any, bool) { return payload, payload != nil }
