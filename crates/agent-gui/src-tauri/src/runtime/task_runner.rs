use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::runtime::platform::expand_tilde_path;

const DEFAULT_HTTP_TIMEOUT_MS: u64 = 10_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestInput {
    pub id: String,
    pub url: String,
    pub method: String,
    pub headers: Option<BTreeMap<String, String>>,
    pub body: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpExecutionResult {
    pub id: String,
    pub url: String,
    pub method: String,
    pub status: u16,
    pub response_body: String,
    pub duration_ms: u128,
}

#[derive(Debug, Clone)]
pub struct HttpExecutionFailure {
    pub duration_ms: u128,
    message: String,
}

impl HttpExecutionFailure {
    fn new(duration_ms: u128, message: String) -> Self {
        Self {
            duration_ms,
            message,
        }
    }
}

impl std::fmt::Display for HttpExecutionFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for HttpExecutionFailure {}

pub(crate) fn resolve_workdir(workdir: Option<String>) -> Result<PathBuf, String> {
    let raw = workdir.unwrap_or_default();
    let base = if raw.trim().is_empty() {
        std::env::current_dir().map_err(|e| format!("读取应用 cwd 失败：{e}"))?
    } else {
        let path = expand_tilde_path(raw.trim());
        if path.is_absolute() {
            path
        } else {
            std::env::current_dir()
                .map_err(|e| format!("读取应用 cwd 失败：{e}"))?
                .join(path)
        }
    };

    let metadata = fs::metadata(&base).map_err(|e| format!("Hook 工作目录无效：{e}"))?;
    if !metadata.is_dir() {
        return Err("Hook 工作目录必须是目录".to_string());
    }
    fs::canonicalize(base).map_err(|e| format!("解析 Hook 工作目录失败：{e}"))
}

fn build_header_map(headers: &Option<BTreeMap<String, String>>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    let Some(headers) = headers else {
        return Ok(map);
    };

    for (key, value) in headers {
        let name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|_| format!("无效 Hook header name：{key}"))?;
        let value =
            HeaderValue::from_str(value).map_err(|_| format!("无效 Hook header value：{key}"))?;
        map.insert(name, value);
    }

    Ok(map)
}

pub(crate) fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_millis(DEFAULT_HTTP_TIMEOUT_MS))
        .build()
        .map_err(|e| format!("创建 Hook HTTP client 失败：{e}"))
}

pub(crate) fn run_single_http_request(
    client: &Client,
    request: HttpRequestInput,
) -> Result<HttpExecutionResult, HttpExecutionFailure> {
    let method_raw = request.method.trim().to_uppercase();
    let method = Method::from_bytes(method_raw.as_bytes()).map_err(|_| {
        HttpExecutionFailure::new(0, format!("无效 Hook HTTP method：{method_raw}"))
    })?;
    let url = request.url.trim().to_string();
    if url.is_empty() {
        return Err(HttpExecutionFailure::new(
            0,
            "Hook HTTP 请求 URL 不能为空".to_string(),
        ));
    }
    Url::parse(&url)
        .map_err(|e| HttpExecutionFailure::new(0, format!("无效 Hook HTTP URL：{url} ({e})")))?;

    let headers = build_header_map(&request.headers)
        .map_err(|message| HttpExecutionFailure::new(0, message))?;
    let start = Instant::now();
    let mut builder = client.request(method.clone(), &url);
    if !headers.is_empty() {
        builder = builder.headers(headers);
    }
    if matches!(
        method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) {
        if let Some(body) = &request.body {
            builder = builder.json(body);
        }
    }

    let response = builder.send().map_err(|e| {
        HttpExecutionFailure::new(
            start.elapsed().as_millis(),
            format!("Hook HTTP 请求失败：{} {} ({e})", method, url),
        )
    })?;
    let status = response.status();
    let response_body = response.text().map_err(|e| {
        HttpExecutionFailure::new(
            start.elapsed().as_millis(),
            format!("读取 Hook HTTP 响应失败：{} {} ({e})", method, url),
        )
    })?;
    let duration_ms = start.elapsed().as_millis();

    if !status.is_success() {
        let preview = response_body.trim();
        return Err(HttpExecutionFailure::new(
            duration_ms,
            if preview.is_empty() {
                format!("Hook HTTP 请求失败：{} {} -> {}", method, url, status)
            } else {
                format!(
                    "Hook HTTP 请求失败：{} {} -> {}\n{}",
                    method, url, status, preview
                )
            },
        ));
    }

    Ok(HttpExecutionResult {
        id: request.id,
        url,
        method: method_raw,
        status: status.as_u16(),
        response_body,
        duration_ms,
    })
}

pub(crate) fn run_http_requests_sync(
    requests: Vec<HttpRequestInput>,
) -> Result<Vec<HttpExecutionResult>, String> {
    let client = build_http_client()?;
    let mut results = Vec::with_capacity(requests.len());

    for request in requests {
        results.push(run_single_http_request(&client, request).map_err(|e| e.to_string())?);
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn read_http_request(stream: &mut std::net::TcpStream) -> (String, Vec<u8>) {
        let mut reader = BufReader::new(stream);
        let mut request_line = String::new();
        reader
            .read_line(&mut request_line)
            .expect("read request line");

        let mut content_length = 0usize;
        loop {
            let mut header_line = String::new();
            reader
                .read_line(&mut header_line)
                .expect("read header line");
            if header_line == "\r\n" {
                break;
            }
            if let Some((name, value)) = header_line.split_once(':') {
                if name.eq_ignore_ascii_case("content-length") {
                    content_length = value.trim().parse::<usize>().expect("parse content-length");
                }
            }
        }

        let mut body = vec![0u8; content_length];
        reader.read_exact(&mut body).expect("read request body");
        (request_line, body)
    }

    #[test]
    fn run_http_requests_sync_sends_requests_in_order() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let addr = listener.local_addr().expect("listener addr");
        let server = thread::spawn(move || {
            for expected_body in ["one", "two"] {
                let (mut stream, _) = listener.accept().expect("accept request");
                let (request_line, body) = read_http_request(&mut stream);
                assert!(request_line.starts_with("POST /hook HTTP/1.1"));
                let payload: Value = serde_json::from_slice(&body).expect("parse request body");
                assert_eq!(
                    payload.get("step").and_then(Value::as_str),
                    Some(expected_body)
                );
                let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}";
                stream
                    .write_all(response.as_bytes())
                    .expect("write response");
            }
        });

        let results = run_http_requests_sync(vec![
            HttpRequestInput {
                id: "one".to_string(),
                url: format!("http://{addr}/hook"),
                method: "POST".to_string(),
                headers: None,
                body: Some(json!({ "step": "one" })),
            },
            HttpRequestInput {
                id: "two".to_string(),
                url: format!("http://{addr}/hook"),
                method: "POST".to_string(),
                headers: None,
                body: Some(json!({ "step": "two" })),
            },
        ])
        .expect("run hook http requests");

        server.join().expect("join server thread");

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].id, "one");
        assert_eq!(results[1].id, "two");
        assert_eq!(results[0].status, 200);
        assert_eq!(results[1].status, 200);
    }
}
