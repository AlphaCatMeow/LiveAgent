package server

import (
	"encoding/json"
	"strings"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func isTerminalChatControlPayload(control *gatewayv1.ChatControlEvent) bool {
	switch strings.TrimSpace(control.GetState()) {
	case "completed", "failed", "cancelled":
		return true
	default:
		return false
	}
}

func chatControlPayload(
	control *gatewayv1.ChatControlEvent,
	seq int64,
	workdirInput ...string,
) map[string]any {
	payload := map[string]any{
		"type":              strings.TrimSpace(control.GetType()),
		"client_request_id": strings.TrimSpace(control.GetClientRequestId()),
		"conversation_id":   strings.TrimSpace(control.GetConversationId()),
		"run_epoch":         control.GetRunEpoch(),
		"state":             strings.TrimSpace(control.GetState()),
	}
	if seq > 0 {
		payload["seq"] = seq
	} else if control.GetSeq() > 0 {
		payload["seq"] = control.GetSeq()
	}
	if errorCode := strings.TrimSpace(control.GetErrorCode()); errorCode != "" {
		payload["error_code"] = errorCode
	}
	if message := strings.TrimSpace(control.GetMessage()); message != "" {
		payload["message"] = message
	}
	if len(workdirInput) > 0 {
		if workdir := strings.TrimSpace(workdirInput[0]); workdir != "" {
			payload["workdir"] = workdir
		}
	}
	return payload
}

func chatEventPayload(event *gatewayv1.ChatEvent, seq int64, workdirInput ...string) map[string]any {
	protoType := chatEventType(event.GetType())
	payload := map[string]any{
		"type": protoType,
	}
	if seq > 0 {
		payload["seq"] = seq
	}
	if len(workdirInput) > 0 {
		if workdir := strings.TrimSpace(workdirInput[0]); workdir != "" {
			payload["workdir"] = workdir
		}
	}

	raw := strings.TrimSpace(event.GetData())
	if raw == "" {
		raw = "{}"
	}

	var decoded map[string]any
	if err := json.Unmarshal([]byte(raw), &decoded); err == nil {
		for key, value := range decoded {
			payload[key] = value
		}
	}

	if conversationID := strings.TrimSpace(event.GetConversationId()); conversationID != "" {
		payload["conversation_id"] = conversationID
	}

	trimLargeToolContentForSSE(payload, protoType)

	return payload
}

const sseToolContentMaxChars = 200

var toolFieldsToTrim = map[string][]string{
	"Write":        {"content"},
	"Edit":         {"old_string", "new_string"},
	"NotebookEdit": {"new_source"},
}

func trimLargeToolContentForSSE(payload map[string]any, protoType string) {
	eventType, _ := payload["type"].(string)

	if eventType == "tool_call" || eventType == "tool_call_delta" ||
		protoType == "tool_call" || protoType == "tool_call_delta" {
		trimToolCallPayload(payload)
		return
	}
	if eventType == "tool_result" || protoType == "tool_result" {
		trimToolResultPayload(payload)
	}
}

func trimToolCallPayload(payload map[string]any) {
	toolName := firstString(payload["name"], payload["tool_name"])
	fields, ok := toolFieldsToTrim[toolName]
	if !ok {
		return
	}

	args := firstMap(payload["arguments"], payload["input"], payload["args"])
	if args == nil {
		args = tryParseJSONStringArg(payload, "arguments", "input", "args")
		if args == nil {
			return
		}
	}

	for _, field := range fields {
		trimStringFieldWithPreview(args, field, sseToolContentMaxChars)
	}
}

func tryParseJSONStringArg(payload map[string]any, keys ...string) map[string]any {
	for _, key := range keys {
		s, ok := payload[key].(string)
		if !ok || s == "" {
			continue
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(s), &parsed); err == nil && len(parsed) > 0 {
			payload[key] = parsed
			return parsed
		}
	}
	return nil
}

func trimToolResultPayload(payload map[string]any) {
	switch content := payload["content"].(type) {
	case string:
		if len(content) > sseToolContentMaxChars {
			lines := countLines(content)
			payload["content"] = content[:sseToolContentMaxChars]
			ensurePreviewMeta(payload, "content", len(content), lines, true)
		}
	case []any:
		for _, item := range content {
			block, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if text, ok := block["text"].(string); ok && len(text) > sseToolContentMaxChars {
				lines := countLines(text)
				block["text"] = text[:sseToolContentMaxChars]
				ensurePreviewMeta(block, "text", len(text), lines, true)
			}
		}
	}
}

func trimStringFieldWithPreview(args map[string]any, field string, maxChars int) {
	text, ok := args[field].(string)
	if !ok || len(text) <= maxChars {
		return
	}
	lines := countLines(text)
	args[field] = text[:maxChars]
	ensurePreviewMeta(args, field, len(text), lines, true)
}

func ensurePreviewMeta(container map[string]any, fieldName string, chars int, lines int, truncated bool) {
	const metaKey = "__liveagent_stream_preview"
	meta, _ := container[metaKey].(map[string]any)
	if meta == nil {
		meta = map[string]any{}
		container[metaKey] = meta
	}
	fields, _ := meta["fields"].(map[string]any)
	if fields == nil {
		fields = map[string]any{}
		meta["fields"] = fields
	}
	fields[fieldName] = map[string]any{
		"chars":     chars,
		"lines":     lines,
		"truncated": truncated,
	}
}

func countLines(s string) int {
	if len(s) == 0 {
		return 0
	}
	n := 1
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			n++
		} else if s[i] == '\r' {
			n++
			if i+1 < len(s) && s[i+1] == '\n' {
				i++
			}
		}
	}
	return n
}

func firstString(candidates ...any) string {
	for _, c := range candidates {
		if s, ok := c.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func firstMap(candidates ...any) map[string]any {
	for _, c := range candidates {
		if m, ok := c.(map[string]any); ok && len(m) > 0 {
			return m
		}
	}
	return nil
}

func chatEventType(eventType gatewayv1.ChatEvent_ChatEventType) string {
	switch eventType {
	case gatewayv1.ChatEvent_TOKEN:
		return "token"
	case gatewayv1.ChatEvent_THINKING:
		return "thinking"
	case gatewayv1.ChatEvent_TOOL_CALL:
		return "tool_call"
	case gatewayv1.ChatEvent_TOOL_RESULT:
		return "tool_result"
	case gatewayv1.ChatEvent_DONE:
		return "done"
	case gatewayv1.ChatEvent_ERROR:
		return "error"
	case gatewayv1.ChatEvent_TOOL_STATUS:
		return "tool_status"
	case gatewayv1.ChatEvent_HOSTED_SEARCH:
		return "hosted_search"
	case gatewayv1.ChatEvent_USER_MESSAGE:
		return "user_message"
	default:
		return "message"
	}
}
