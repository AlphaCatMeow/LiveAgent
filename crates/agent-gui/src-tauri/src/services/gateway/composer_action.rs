//! WebUI 输入框“/”指令的非运行动作往返（/goal clear、/loop）。
//!
//! 对话 id 到 K-brain 会话 id 的映射只在桌面 WebView 里，所以 Rust 收到
//! `GoalManageRequest` / `LoopManageRequest` 后以 `gateway:composer-action-requested`
//! 事件交给 TS，由它调 K-brain；结果经 `gateway_composer_action_respond` 回来，
//! 再按原请求类型组装成 `GoalManageResp` / `LoopManageResp`。

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Emitter;
use tokio::sync::oneshot;

use super::proto;
use super::util::now_unix_seconds;
use super::GatewayController;

pub(crate) const GATEWAY_COMPOSER_ACTION_REQUESTED_EVENT: &str =
    "gateway:composer-action-requested";

/// Rust → TS：kind 为 goal 或 loop，其余字段照搬原请求。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayComposerActionEvent {
    pub request_id: String,
    pub kind: String,
    pub conversation_id: String,
    pub action: String,
    pub cron: String,
    pub interval: String,
    pub prompt: String,
    pub reasoning: String,
    pub loop_id: String,
}

/// TS → Rust：result 是 K-brain 的 JSON 响应（goal 状态或 loops 列表）。
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayComposerActionRespondInput {
    pub request_id: String,
    pub result: Option<Value>,
    pub error_message: Option<String>,
}

pub(crate) type ComposerActionOutcome = Result<Value, String>;

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub(crate) fn goal_response(value: &Value) -> proto::GoalManageResponse {
    let number = |key: &str| value.get(key).and_then(Value::as_i64).unwrap_or_default() as i32;
    proto::GoalManageResponse {
        conversation_id: text(value, "conversation_id"),
        goal: text(value, "goal"),
        status: text(value, "status"),
        round: number("round"),
        max_rounds: number("max_rounds"),
        reason: text(value, "reason"),
    }
}

pub(crate) fn loop_response(value: &Value) -> proto::LoopManageResponse {
    let loops = value
        .get("loops")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| proto::LoopSummary {
                    id: text(item, "id"),
                    interval: text(item, "interval"),
                    cron: text(item, "cron"),
                    prompt: text(item, "prompt"),
                    enabled: item.get("enabled").and_then(Value::as_bool).unwrap_or(false),
                })
                .collect()
        })
        .unwrap_or_default();
    proto::LoopManageResponse { loops }
}

impl GatewayController {
    async fn run_composer_action(
        self: &Arc<Self>,
        event: GatewayComposerActionEvent,
    ) -> ComposerActionOutcome {
        let request_id = event.request_id.clone();
        let (tx, rx) = oneshot::channel();
        self.pending_composer_actions
            .lock()
            .map_err(|_| "gateway composer action lock poisoned".to_string())?
            .insert(request_id.clone(), tx);
        let forget = |controller: &Self| {
            let _ = controller
                .pending_composer_actions
                .lock()
                .map(|mut pending| pending.remove(&request_id));
        };
        if let Err(error) = self
            .app_handle
            .emit(GATEWAY_COMPOSER_ACTION_REQUESTED_EVENT, event)
        {
            forget(self);
            return Err(format!("emit gateway composer action failed: {error}"));
        }
        match tokio::time::timeout(Duration::from_secs(30), rx).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => Err("composer action response dropped".to_string()),
            Err(_) => {
                forget(self);
                Err("composer action timed out".to_string())
            }
        }
    }

    pub(crate) async fn handle_goal_manage(
        self: &Arc<Self>,
        request_id: String,
        request: proto::GoalManageRequest,
    ) -> Result<(), String> {
        let outcome = self
            .run_composer_action(GatewayComposerActionEvent {
                request_id: request_id.clone(),
                kind: "goal".to_string(),
                conversation_id: request.conversation_id,
                action: request.action,
                cron: String::new(),
                interval: String::new(),
                prompt: String::new(),
                reasoning: String::new(),
                loop_id: String::new(),
            })
            .await;
        match outcome {
            Ok(value) => {
                self.send_agent_envelope(proto::AgentEnvelope {
                    request_id,
                    timestamp: now_unix_seconds(),
                    payload: Some(proto::agent_envelope::Payload::GoalManageResp(
                        goal_response(&value),
                    )),
                })
                .await
            }
            Err(error) => self.send_error_response(request_id, 502, error).await,
        }
    }

    pub(crate) async fn handle_loop_manage(
        self: &Arc<Self>,
        request_id: String,
        request: proto::LoopManageRequest,
    ) -> Result<(), String> {
        let outcome = self
            .run_composer_action(GatewayComposerActionEvent {
                request_id: request_id.clone(),
                kind: "loop".to_string(),
                conversation_id: request.conversation_id,
                action: request.action,
                cron: request.cron,
                interval: request.interval,
                prompt: request.prompt,
                reasoning: request.reasoning,
                loop_id: request.loop_id,
            })
            .await;
        match outcome {
            Ok(value) => {
                self.send_agent_envelope(proto::AgentEnvelope {
                    request_id,
                    timestamp: now_unix_seconds(),
                    payload: Some(proto::agent_envelope::Payload::LoopManageResp(
                        loop_response(&value),
                    )),
                })
                .await
            }
            Err(error) => self.send_error_response(request_id, 502, error).await,
        }
    }

    pub(crate) fn respond_composer_action(
        &self,
        input: GatewayComposerActionRespondInput,
    ) -> Result<(), String> {
        let Some(tx) = self
            .pending_composer_actions
            .lock()
            .map_err(|_| "gateway composer action lock poisoned".to_string())?
            .remove(&input.request_id)
        else {
            return Ok(()); // 已超时：静默丢弃迟到的响应。
        };
        let outcome = match input.error_message.filter(|message| !message.trim().is_empty()) {
            Some(message) => Err(message),
            None => Ok(input.result.unwrap_or(Value::Null)),
        };
        tx.send(outcome)
            .map_err(|_| "gateway composer action receiver dropped".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn goal_and_loop_payloads_map_to_proto_responses() {
        let goal = goal_response(&json!({
            "conversation_id": "s-1", "goal": "ship it", "status": "cleared",
            "round": 2, "max_rounds": 100, "reason": ""
        }));
        assert_eq!(goal.conversation_id, "s-1");
        assert_eq!(goal.status, "cleared");
        assert_eq!(goal.round, 2);
        assert_eq!(goal.max_rounds, 100);

        let loops = loop_response(&json!({ "loops": [
            { "id": "l-1", "interval": "10m", "cron": "0 */10 * * * *", "prompt": "check", "enabled": true }
        ]}));
        assert_eq!(loops.loops.len(), 1);
        assert_eq!(loops.loops[0].interval, "10m");
        assert!(loops.loops[0].enabled);
        assert!(loop_response(&Value::Null).loops.is_empty());
    }
}