package pbws

import (
	"strings"
	"testing"

	gatewayv2 "github.com/liveagent/agent-gateway/internal/proto/v2"
	"github.com/liveagent/agent-gateway/internal/session"
)

func TestVetAgentRequestAllowsProviderUsage(t *testing.T) {
	env := &gatewayv2.GatewayEnvelope{
		Payload: &gatewayv2.GatewayEnvelope_ProviderUsage{
			ProviderUsage: &gatewayv2.ProviderUsageRequest{
				ProviderId: "provider-1",
				Refresh:    true,
			},
		},
	}

	if err := vetAgentRequest(session.AgentView{}, env); err != nil {
		t.Fatalf("vetAgentRequest() error = %v", err)
	}
}

func TestVetAgentRequestAllowsInstalledAppsList(t *testing.T) {
	env := &gatewayv2.GatewayEnvelope{
		Payload: &gatewayv2.GatewayEnvelope_InstalledAppsList{
			InstalledAppsList: &gatewayv2.InstalledAppsListRequest{},
		},
	}

	if err := vetAgentRequest(session.AgentView{}, env); err != nil {
		t.Fatalf("vetAgentRequest() error = %v", err)
	}
}

func TestVetAgentRequestAllowsReadOnlyCuaDriverActions(t *testing.T) {
	for _, action := range []string{"probe", "permissions_status"} {
		env := &gatewayv2.GatewayEnvelope{
			Payload: &gatewayv2.GatewayEnvelope_CuaDriver{
				CuaDriver: &gatewayv2.CuaDriverRequest{Action: action},
			},
		}

		if err := vetAgentRequest(session.AgentView{}, env); err != nil {
			t.Fatalf("vetAgentRequest(%q) error = %v", action, err)
		}
	}
}

func TestVetAgentRequestAllowsPromptTemplates(t *testing.T) {
	for name, env := range map[string]*gatewayv2.GatewayEnvelope{
		"list": {Payload: &gatewayv2.GatewayEnvelope_PromptTemplateList{
			PromptTemplateList: &gatewayv2.PromptTemplateListRequest{Workdir: "/repo"},
		}},
		"list without workdir": {Payload: &gatewayv2.GatewayEnvelope_PromptTemplateList{
			PromptTemplateList: &gatewayv2.PromptTemplateListRequest{},
		}},
		"expand": {Payload: &gatewayv2.GatewayEnvelope_PromptTemplateExpand{
			PromptTemplateExpand: &gatewayv2.PromptTemplateExpandRequest{Name: "review-pr", Text: "123 \"two words\"", Workdir: "/repo"},
		}},
	} {
		if err := vetAgentRequest(session.AgentView{}, env); err != nil {
			t.Fatalf("vetAgentRequest(%s) error = %v", name, err)
		}
	}
}

func TestVetAgentRequestRejectsInvalidPromptTemplates(t *testing.T) {
	longWorkdir := strings.Repeat("a", maxPromptTemplateWorkdir+1)
	for name, env := range map[string]*gatewayv2.GatewayEnvelope{
		"list nil": {Payload: &gatewayv2.GatewayEnvelope_PromptTemplateList{}},
		"list workdir too long": {Payload: &gatewayv2.GatewayEnvelope_PromptTemplateList{
			PromptTemplateList: &gatewayv2.PromptTemplateListRequest{Workdir: longWorkdir},
		}},
		"expand nil": {Payload: &gatewayv2.GatewayEnvelope_PromptTemplateExpand{}},
		"expand empty name": {Payload: &gatewayv2.GatewayEnvelope_PromptTemplateExpand{
			PromptTemplateExpand: &gatewayv2.PromptTemplateExpandRequest{Name: "  "},
		}},
		"expand name too long": {Payload: &gatewayv2.GatewayEnvelope_PromptTemplateExpand{
			PromptTemplateExpand: &gatewayv2.PromptTemplateExpandRequest{Name: strings.Repeat("n", maxPromptTemplateNameLen+1)},
		}},
		"expand name with slash": {Payload: &gatewayv2.GatewayEnvelope_PromptTemplateExpand{
			PromptTemplateExpand: &gatewayv2.PromptTemplateExpandRequest{Name: "../secret"},
		}},
		"expand name with backslash": {Payload: &gatewayv2.GatewayEnvelope_PromptTemplateExpand{
			PromptTemplateExpand: &gatewayv2.PromptTemplateExpandRequest{Name: "a\\b"},
		}},
		"expand text too long": {Payload: &gatewayv2.GatewayEnvelope_PromptTemplateExpand{
			PromptTemplateExpand: &gatewayv2.PromptTemplateExpandRequest{Name: "review", Text: strings.Repeat("x", maxPromptTemplateTextLen+1)},
		}},
		"expand workdir too long": {Payload: &gatewayv2.GatewayEnvelope_PromptTemplateExpand{
			PromptTemplateExpand: &gatewayv2.PromptTemplateExpandRequest{Name: "review", Workdir: longWorkdir},
		}},
	} {
		if err := vetAgentRequest(session.AgentView{}, env); err == nil {
			t.Fatalf("vetAgentRequest(%s) error = nil, want rejection", name)
		}
	}
}

// 安装与授权是桌面本机动作（联网执行安装脚本 / 弹 macOS TCC 对话框），浏览器不得下发。
func TestVetAgentRequestRejectsCuaDriverProvisioning(t *testing.T) {
	for _, action := range []string{"install", "permissions_grant", ""} {
		env := &gatewayv2.GatewayEnvelope{
			Payload: &gatewayv2.GatewayEnvelope_CuaDriver{
				CuaDriver: &gatewayv2.CuaDriverRequest{Action: action},
			},
		}

		if err := vetAgentRequest(session.AgentView{}, env); err == nil {
			t.Fatalf("vetAgentRequest(%q) expected rejection", action)
		}
	}
}

func TestVetAgentRequestAllowsClarifyTurn(t *testing.T) {
	env := &gatewayv2.GatewayEnvelope{
		Payload: &gatewayv2.GatewayEnvelope_ClarifyTurn{
			ClarifyTurn: &gatewayv2.ClarifyTurnRequest{
				MessagesJson: `[{"role":"user","content":"hi"}]`,
				ProviderId:   "builtin-gemini",
				Model:        "gemini-2.0-flash",
			},
		},
	}

	if err := vetAgentRequest(session.AgentView{}, env); err != nil {
		t.Fatalf("vetAgentRequest() error = %v", err)
	}
}

func TestVetAgentRequestAllowsValidChatFileOpen(t *testing.T) {
	line := uint32(12)
	column := uint32(4)
	env := &gatewayv2.GatewayEnvelope{
		Payload: &gatewayv2.GatewayEnvelope_ChatFileOpen{
			ChatFileOpen: &gatewayv2.ChatFileOpenRequest{
				ConversationId: "conversation-1",
				Workdir:        `C:\work`,
				Path:           `src\a.ts`,
				Source:         "relative",
				Line:           &line,
				Column:         &column,
			},
		},
	}

	if err := vetAgentRequest(session.AgentView{}, env); err != nil {
		t.Fatalf("vetAgentRequest() error = %v", err)
	}
}

func TestVetAgentRequestRejectsMalformedChatFileOpen(t *testing.T) {
	zero := uint32(0)
	tests := []*gatewayv2.ChatFileOpenRequest{
		nil,
		{ConversationId: "", Workdir: "/work", Path: "a.ts", Source: "relative"},
		{ConversationId: "conversation-1", Workdir: "/work", Path: "a.ts", Source: "javascript"},
		{ConversationId: "conversation-1", Workdir: "/work", Path: "a.ts", Source: "relative", Line: &zero},
	}
	for _, request := range tests {
		env := &gatewayv2.GatewayEnvelope{
			Payload: &gatewayv2.GatewayEnvelope_ChatFileOpen{ChatFileOpen: request},
		}
		if err := vetAgentRequest(session.AgentView{}, env); err == nil {
			t.Fatalf("vetAgentRequest(%+v) unexpectedly succeeded", request)
		}
	}
}

func TestVetAgentRequestAllowsWorkspaceRootGrantListApplyAndRevoke(t *testing.T) {
	id := "grant-1"
	requests := []*gatewayv2.WorkspaceRootGrantsRequest{
		{Action: "list", ProjectId: "project-1", ProjectPath: "/work/project"},
		{
			Action:      "apply",
			ProjectId:   "project-1",
			ProjectPath: "/work/project",
			Grants: []*gatewayv2.WorkspaceRootGrantDraft{
				{Id: &id, Alias: "shared", DisplayPath: "/work/shared", Access: "read"},
			},
		},
		{Action: "revoke", ProjectId: "project-1"},
	}

	for _, request := range requests {
		env := &gatewayv2.GatewayEnvelope{
			Payload: &gatewayv2.GatewayEnvelope_WorkspaceRootGrants{
				WorkspaceRootGrants: request,
			},
		}
		if err := vetAgentRequest(session.AgentView{}, env); err != nil {
			t.Fatalf("vetAgentRequest(%+v) error = %v", request, err)
		}
	}
}

func TestVetAgentRequestRejectsMalformedWorkspaceRootGrants(t *testing.T) {
	emptyID := " "
	requests := []*gatewayv2.WorkspaceRootGrantsRequest{
		nil,
		{Action: "list", ProjectId: "", ProjectPath: "/work/project"},
		{Action: "list", ProjectId: "project-1", ProjectPath: ""},
		{
			Action:      "list",
			ProjectId:   "project-1",
			ProjectPath: "/work/project",
			Grants:      []*gatewayv2.WorkspaceRootGrantDraft{{Alias: "shared"}},
		},
		{
			Action:      "apply",
			ProjectId:   "project-1",
			ProjectPath: "/work/project",
			Grants: []*gatewayv2.WorkspaceRootGrantDraft{
				{Id: &emptyID, Alias: "shared", DisplayPath: "/work/shared", Access: "read"},
			},
		},
		{
			Action:      "apply",
			ProjectId:   "project-1",
			ProjectPath: "/work/project",
			Grants: []*gatewayv2.WorkspaceRootGrantDraft{
				{Alias: "shared", DisplayPath: "/work/shared", Access: "admin"},
			},
		},
		{Action: "revoke", ProjectId: "project-1", ProjectPath: "/work/project"},
		{
			Action:    "revoke",
			ProjectId: "project-1",
			Grants:    []*gatewayv2.WorkspaceRootGrantDraft{{Alias: "shared"}},
		},
	}

	for _, request := range requests {
		env := &gatewayv2.GatewayEnvelope{
			Payload: &gatewayv2.GatewayEnvelope_WorkspaceRootGrants{
				WorkspaceRootGrants: request,
			},
		}
		if err := vetAgentRequest(session.AgentView{}, env); err == nil {
			t.Fatalf("vetAgentRequest(%+v) unexpectedly succeeded", request)
		}
	}
}

func TestVetAgentRequestAllowsCheckpointActions(t *testing.T) {
	requests := []*gatewayv2.CheckpointRequest{
		{Action: "list", ConversationId: "conversation-1"},
		{Action: "diff", ConversationId: "conversation-1", TurnSeq: 2, AuthorizedRoots: []string{"/work"}},
		{
			Action:          "rewind",
			ConversationId:  "conversation-1",
			TurnSeq:         2,
			AuthorizedRoots: []string{"/work"},
			Expected:        []*gatewayv2.CheckpointExpectedEntry{{Key: "/work\x01a.txt", CurrentHash: "abc"}},
		},
	}

	for _, request := range requests {
		env := &gatewayv2.GatewayEnvelope{
			Payload: &gatewayv2.GatewayEnvelope_Checkpoint{Checkpoint: request},
		}
		if err := vetAgentRequest(session.AgentView{}, env); err != nil {
			t.Fatalf("vetAgentRequest(%+v) error = %v", request, err)
		}
	}
}

func TestVetAgentRequestRejectsMalformedCheckpoint(t *testing.T) {
	tooManyRoots := make([]string, 65)
	for index := range tooManyRoots {
		tooManyRoots[index] = "/work"
	}
	requests := []*gatewayv2.CheckpointRequest{
		nil,
		{Action: "list", ConversationId: "conversation-1", TurnSeq: 1},
		{Action: "diff", ConversationId: "conversation-1"},
		{Action: "rewind", ConversationId: "conversation-1"},
		{Action: "unknown", ConversationId: "conversation-1"},
		{Action: "diff", ConversationId: "conversation-1", TurnSeq: 1, AuthorizedRoots: []string{" "}},
		{Action: "diff", ConversationId: "conversation-1", TurnSeq: 1, AuthorizedRoots: tooManyRoots},
		{
			Action:         "rewind",
			ConversationId: "conversation-1",
			TurnSeq:        1,
			Expected:       []*gatewayv2.CheckpointExpectedEntry{{Key: " ", CurrentHash: "abc"}},
		},
		{
			Action:         "rewind",
			ConversationId: "conversation-1",
			TurnSeq:        1,
			Expected:       []*gatewayv2.CheckpointExpectedEntry{{Key: "/work\x01a.txt"}},
		},
	}

	for _, request := range requests {
		env := &gatewayv2.GatewayEnvelope{
			Payload: &gatewayv2.GatewayEnvelope_Checkpoint{Checkpoint: request},
		}
		if err := vetAgentRequest(session.AgentView{}, env); err == nil {
			t.Fatalf("vetAgentRequest(%+v) unexpectedly succeeded", request)
		}
	}
}

func TestCanonicalTerminalRetainsNativeRemoteGate(t *testing.T) {
	for _, action := range []string{"create", "read", "input", "close", "list"} {
		request := &gatewayv2.TerminalRequest{Action: action, ConversationId: "conversation", RunId: "run", SessionId: "term-1"}
		if err := vetCanonicalTerminal(request); err != nil {
			t.Fatal(err)
		}
		env := &gatewayv2.GatewayEnvelope{Payload: &gatewayv2.GatewayEnvelope_TerminalRequest{TerminalRequest: request}}
		if err := vetAgentRequest(session.AgentView{}, env); err == nil {
			t.Fatalf("native Remote gate bypassed: %s", action)
		}
	}
	for _, request := range []*gatewayv2.TerminalRequest{
		{Action: "read", RunId: "run"}, {Action: "create_ssh", ConversationId: "c", RunId: "r"},
		{Action: "resize", ConversationId: "c", RunId: "r", Cols: 65536},
	} {
		if err := vetCanonicalTerminal(request); err == nil {
			t.Fatalf("invalid request accepted: %+v", request)
		}
	}
}

func TestVetAgentRequestAllowsSlashCommandsGoalsAndLoops(t *testing.T) {
	for name, env := range map[string]*gatewayv2.GatewayEnvelope{
		"slash commands": {Payload: &gatewayv2.GatewayEnvelope_SlashCommandList{
			SlashCommandList: &gatewayv2.SlashCommandListRequest{Workdir: "/repo"},
		}},
		"goal clear": {Payload: &gatewayv2.GatewayEnvelope_GoalManage{
			GoalManage: &gatewayv2.GoalManageRequest{ConversationId: "sess-1", Action: "clear"},
		}},
		"loops list": {Payload: &gatewayv2.GatewayEnvelope_LoopManage{
			LoopManage: &gatewayv2.LoopManageRequest{ConversationId: "sess-1", Action: "list"},
		}},
		"loop create": {Payload: &gatewayv2.GatewayEnvelope_LoopManage{
			LoopManage: &gatewayv2.LoopManageRequest{
				ConversationId: "sess-1", Action: "create", Cron: "0 */10 * * * *",
				Interval: "10m", Prompt: "report the build",
			},
		}},
		"loop cancel": {Payload: &gatewayv2.GatewayEnvelope_LoopManage{
			LoopManage: &gatewayv2.LoopManageRequest{ConversationId: "sess-1", Action: "cancel", LoopId: "loop-1"},
		}},
	} {
		if err := vetAgentRequest(session.AgentView{}, env); err != nil {
			t.Fatalf("vetAgentRequest(%s) error = %v", name, err)
		}
	}
}

func TestVetAgentRequestRejectsInvalidGoalAndLoopRequests(t *testing.T) {
	for name, env := range map[string]*gatewayv2.GatewayEnvelope{
		"goal nil": {Payload: &gatewayv2.GatewayEnvelope_GoalManage{}},
		"goal without conversation": {Payload: &gatewayv2.GatewayEnvelope_GoalManage{
			GoalManage: &gatewayv2.GoalManageRequest{Action: "clear"},
		}},
		"goal unknown action": {Payload: &gatewayv2.GatewayEnvelope_GoalManage{
			GoalManage: &gatewayv2.GoalManageRequest{ConversationId: "s", Action: "pause"},
		}},
		"goal set over the manage route": {Payload: &gatewayv2.GatewayEnvelope_GoalManage{
			GoalManage: &gatewayv2.GoalManageRequest{ConversationId: "s", Action: "set"},
		}},
		"loop nil": {Payload: &gatewayv2.GatewayEnvelope_LoopManage{}},
		"loop unknown action": {Payload: &gatewayv2.GatewayEnvelope_LoopManage{
			LoopManage: &gatewayv2.LoopManageRequest{ConversationId: "s", Action: "pause"},
		}},
		"loop create without schedule": {Payload: &gatewayv2.GatewayEnvelope_LoopManage{
			LoopManage: &gatewayv2.LoopManageRequest{ConversationId: "s", Action: "create", Prompt: "x"},
		}},
		"loop create without prompt": {Payload: &gatewayv2.GatewayEnvelope_LoopManage{
			LoopManage: &gatewayv2.LoopManageRequest{ConversationId: "s", Action: "create", Cron: "0 */10 * * * *"},
		}},
		"loop prompt too long": {Payload: &gatewayv2.GatewayEnvelope_LoopManage{
			LoopManage: &gatewayv2.LoopManageRequest{ConversationId: "s", Action: "create", Cron: "0 */10 * * * *", Prompt: strings.Repeat("p", maxLoopPromptLen+1)},
		}},
		"loop cancel without id": {Payload: &gatewayv2.GatewayEnvelope_LoopManage{
			LoopManage: &gatewayv2.LoopManageRequest{ConversationId: "s", Action: "cancel"},
		}},
	} {
		if err := vetAgentRequest(session.AgentView{}, env); err == nil {
			t.Fatalf("vetAgentRequest(%s) error = nil, want rejection", name)
		}
	}
}
