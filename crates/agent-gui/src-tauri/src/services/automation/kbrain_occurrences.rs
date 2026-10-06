use serde::Deserialize;
use std::sync::Arc;
use tauri::Manager;

use super::{occurrences, CronOccurrenceQuery, CronOccurrencesResponse, CronRunRecord, CronTask};
use crate::services::kbrain_backend::{KBrainBackendConnection, KBrainBackendState};

#[derive(Deserialize)]
struct Tasks {
    tasks: Vec<CronTask>,
}

#[derive(Deserialize)]
struct Runs {
    runs: Vec<CronRunRecord>,
}

pub async fn query(
    app: tauri::AppHandle,
    range: CronOccurrenceQuery,
) -> Result<CronOccurrencesResponse, String> {
    occurrences::validate_range(&range)?;
    let state = Arc::clone(app.state::<Arc<KBrainBackendState>>().inner());
    let connection = tauri::async_runtime::spawn_blocking(move || state.ensure_started(&app))
        .await
        .map_err(|e| format!("K-brain startup failed: {e}"))??;
    // The bundled K-brain scheduler uses the system zone, not desktop calendar preferences.
    let zone = iana_time_zone::get_timezone()
        .ok()
        .and_then(|name| name.parse().ok())
        .unwrap_or(chrono_tz::UTC);
    fetch(&connection, range, zone).await
}

async fn fetch(
    connection: &KBrainBackendConnection,
    range: CronOccurrenceQuery,
    zone: chrono_tz::Tz,
) -> Result<CronOccurrencesResponse, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let base = format!("{}/v1/cron", connection.base_url.trim_end_matches('/'));
    let tasks: Tasks = get(&client, &connection.token, &base).await?;
    let mut runs = Vec::new();
    for task in &tasks.tasks {
        if !task.enabled || task.remaining_executions == Some(0) {
            continue;
        }
        let mut url = reqwest::Url::parse(&base).map_err(|e| e.to_string())?;
        url.path_segments_mut()
            .map_err(|_| "Invalid K-brain URL")?
            .push(&task.id)
            .push("runs");
        // The K-brain history endpoint caps each query at 500 runs.
        url.query_pairs_mut().append_pair("limit", "500");
        let records: Runs = get(&client, &connection.token, url.as_str()).await?;
        runs.extend(records.runs);
    }
    let now = chrono::Utc::now().timestamp_millis();
    let in_range: Vec<_> = runs
        .iter()
        .filter(|run| run.started_at >= range.from && run.started_at < range.to.min(now))
        .cloned()
        .collect();
    occurrences::compute(&tasks.tasks, &in_range, &runs, range, zone, now)
}

async fn get<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    token: &str,
    url: &str,
) -> Result<T, String> {
    client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?
        .error_for_status()
        .map_err(|e| e.without_url().to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn reads_backend_tasks_and_history_with_auth_and_encoded_ids() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let server = tokio::spawn(async move {
            let bodies = [
                json!({"tasks": [{"id":"task/one", "name":"Backend task", "cron":"0 0 12 * * *", "enabled":true,"type":"bash"}]}),
                json!({"runs": [{"id":"run-1","taskId":"task/one","state":"done","success":true,"startedAt":now-1000,"finishedAt":now-500,"durationMs":500,"output":"backend output"}]}),
            ];
            for (index, body) in bodies.into_iter().enumerate() {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = vec![0; 8192];
                let size = stream.read(&mut request).await.unwrap();
                let request = String::from_utf8_lossy(&request[..size]);
                assert!(request
                    .to_lowercase()
                    .contains("authorization: bearer fixture-token"));
                assert!(request.starts_with(if index == 0 {
                    "GET /v1/cron HTTP"
                } else {
                    "GET /v1/cron/task%2Fone/runs?limit=500 HTTP"
                }));
                let body = body.to_string();
                stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).as_bytes()).await.unwrap();
            }
        });
        let result = fetch(
            &KBrainBackendConnection {
                base_url: format!("http://{address}"),
                token: "fixture-token".into(),
                protocol_version: "kbrain.agent.v1".into(),
            },
            CronOccurrenceQuery {
                from: now - 60_000,
                to: now + 86_400_000,
            },
            chrono_tz::UTC,
        )
        .await
        .unwrap();
        server.await.unwrap();
        assert_eq!(result.tasks[0].id, "task/one");
        assert_eq!(result.runs[0].output_preview, "backend output");
        assert_eq!(result.tasks[0].last_run.as_ref().unwrap().id, "run-1");
        assert!(!result.occurrences.is_empty());
    }
}
