use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use futures_util::StreamExt;
use reqwest::{Method, Url};
use rquickjs::{Context, Function, Runtime};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::commands::settings::{load_providers, open_db};

const MAX_SCRIPT_BYTES: usize = 64 * 1024;
const MAX_SCRIPT_VARIABLE_BYTES: usize = 16 * 1024;
const MAX_SCRIPT_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_REQUEST_BODY_BYTES: usize = 64 * 1024;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_HEADERS: usize = 64;
const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_ENTRIES: usize = 16;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const DNS_TIMEOUT: Duration = Duration::from_secs(5);
const SCRIPT_TIMEOUT: Duration = Duration::from_millis(100);

const GENERAL_SCRIPT: &str = r#"({
  request: {
    url: "{{baseUrl}}/user/balance",
    method: "GET",
    headers: { "Authorization": "Bearer {{apiKey}}" }
  },
  extractor: (response) => ({ remaining: response.balance, unit: "USD" })
})"#;

const NEWAPI_SCRIPT: &str = r#"({
  request: {
    url: "{{baseUrl}}/api/user/self",
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer {{accessToken}}",
      "New-Api-User": "{{userId}}"
    }
  },
  extractor: (response) => ({
    label: response.data && response.data.group ? response.data.group : "Balance",
    remaining: response.data ? response.data.quota / 500000 : null,
    unit: "USD"
  })
})"#;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageEntry {
    pub label: String,
    pub value: String,
    pub unit: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageResult {
    pub entries: Vec<ProviderUsageEntry>,
    pub queried_at: Option<i64>,
    pub error: Option<String>,
    pub is_stale: bool,
}

#[derive(Default)]
pub struct ProviderUsageService {
    cache: Mutex<UsageCache>,
}

impl ProviderUsageService {
    pub async fn query(&self, provider_id: &str, force: bool) -> ProviderUsageResult {
        let provider = match load_provider(provider_id) {
            Ok(provider) => provider,
            Err(error) => {
                self.cache().invalidate(provider_id);
                return failed_result(error);
            }
        };
        let prepared = match prepare_query(&provider) {
            Ok(prepared) => prepared,
            Err(error) => {
                self.cache().invalidate(provider_id);
                return failed_result(error);
            }
        };
        let identity = provider_query_identity(&provider);
        if !force {
            if let Some(cached) = self.cache().get(provider_id, &identity).cloned() {
                return cached;
            }
        }

        match execute_prepared_query(&prepared).await {
            Ok(entries) if entries.is_empty() => self.cache().record_failure(
                provider_id,
                identity,
                "Usage query returned no entries",
            ),
            Ok(entries) => {
                let result = ProviderUsageResult {
                    entries,
                    queried_at: Some(now_millis()),
                    error: None,
                    is_stale: false,
                };
                self.cache()
                    .record_success(provider_id, identity, result.clone());
                result
            }
            Err(error) => self.cache().record_failure(provider_id, identity, &error),
        }
    }

    fn cache(&self) -> std::sync::MutexGuard<'_, UsageCache> {
        self.cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

type ProviderQueryIdentity = [u8; 32];

struct CachedUsage {
    identity: ProviderQueryIdentity,
    result: ProviderUsageResult,
}

#[derive(Default)]
struct UsageCache {
    values: HashMap<String, CachedUsage>,
}

impl UsageCache {
    fn get(
        &self,
        provider_id: &str,
        identity: &ProviderQueryIdentity,
    ) -> Option<&ProviderUsageResult> {
        self.values
            .get(provider_id)
            .filter(|cached| &cached.identity == identity && !cached.result.entries.is_empty())
            .map(|cached| &cached.result)
    }

    fn record_success(
        &mut self,
        provider_id: &str,
        identity: ProviderQueryIdentity,
        mut result: ProviderUsageResult,
    ) {
        result.error = None;
        result.is_stale = false;
        self.values
            .insert(provider_id.to_string(), CachedUsage { identity, result });
    }

    fn record_failure(
        &mut self,
        provider_id: &str,
        identity: ProviderQueryIdentity,
        error: &str,
    ) -> ProviderUsageResult {
        if let Some(cached) = self
            .values
            .get_mut(provider_id)
            .filter(|cached| cached.identity == identity && !cached.result.entries.is_empty())
        {
            cached.result.error = Some(error.to_string());
            cached.result.is_stale = true;
            return cached.result.clone();
        }
        self.invalidate(provider_id);
        failed_result(error.to_string())
    }

    fn invalidate(&mut self, provider_id: &str) {
        self.values.remove(provider_id);
    }
}

fn failed_result(error: String) -> ProviderUsageResult {
    ProviderUsageResult {
        entries: Vec::new(),
        queried_at: None,
        error: Some(error),
        is_stale: false,
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProvider {
    #[serde(rename = "type")]
    provider_type: String,
    base_url: String,
    api_key: String,
    usage_query: UsageQueryConfig,
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageQueryConfig {
    enabled: bool,
    mode: String,
    script: String,
    base_url: String,
    access_token: String,
    user_id: String,
    access_key_id: String,
    secret_access_key: String,
    allow_local_network: bool,
}

fn provider_query_identity(provider: &StoredProvider) -> ProviderQueryIdentity {
    let mut digest = Sha256::new();
    for value in [
        provider.provider_type.as_str(),
        provider.base_url.as_str(),
        provider.api_key.as_str(),
        provider.usage_query.mode.as_str(),
        provider.usage_query.script.as_str(),
        provider.usage_query.base_url.as_str(),
        provider.usage_query.access_token.as_str(),
        provider.usage_query.user_id.as_str(),
        provider.usage_query.access_key_id.as_str(),
        provider.usage_query.secret_access_key.as_str(),
    ] {
        digest.update((value.len() as u64).to_be_bytes());
        digest.update(value.as_bytes());
    }
    digest.update([
        provider.usage_query.enabled as u8,
        provider.usage_query.allow_local_network as u8,
    ]);
    digest.finalize().into()
}

#[derive(Clone, Default)]
struct ScriptVariables {
    api_key: String,
    base_url: String,
    access_token: String,
    user_id: String,
}

#[derive(Clone)]
struct HttpRequest {
    url: Url,
    method: Method,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProviderAdapter {
    DeepSeek,
    StepFun,
    SiliconFlowCn,
    SiliconFlowEn,
    OpenRouter,
    Novita,
    Kimi,
    Zhipu,
    MiniMax,
    ZenMux,
    VolcengineAfp,
    VolcengineCoding,
    Script,
}

#[derive(Clone)]
struct PreparedRequest {
    request: HttpRequest,
    adapter: ProviderAdapter,
    script: Option<(String, ScriptVariables)>,
}

struct PreparedQuery {
    primary: PreparedRequest,
    fallback: Option<PreparedRequest>,
    allow_local_network: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QueryFailureKind {
    Auth,
    Soft,
    Transient,
}

#[derive(Debug)]
struct QueryFailure {
    kind: QueryFailureKind,
    message: String,
}

impl QueryFailure {
    fn new(kind: QueryFailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

#[derive(Debug)]
struct HttpResponse {
    status: reqwest::StatusCode,
    body: Vec<u8>,
}

fn load_provider(provider_id: &str) -> Result<StoredProvider, String> {
    let conn = open_db().map_err(|_| "Unable to open provider settings".to_string())?;
    let providers = load_providers(&conn)
        .map_err(|_| "Unable to load provider settings".to_string())?
        .and_then(|value| value.as_array().cloned())
        .ok_or_else(|| "Provider not found".to_string())?;
    let provider = providers
        .into_iter()
        .find(|provider| provider.get("id").and_then(Value::as_str) == Some(provider_id))
        .ok_or_else(|| "Provider not found".to_string())?;
    serde_json::from_value(provider).map_err(|_| "Provider settings are invalid".to_string())
}

fn prepare_query(provider: &StoredProvider) -> Result<PreparedQuery, String> {
    if !matches!(
        provider.provider_type.as_str(),
        "claude_code" | "codex" | "gemini" | "xai"
    ) {
        return Err("Unsupported provider type".to_string());
    }
    if !provider.usage_query.enabled {
        return Err("Usage query is disabled".to_string());
    }

    match provider.usage_query.mode.as_str() {
        "balance" => prepare_balance_query(provider),
        "coding-plan" => prepare_coding_plan_query(provider),
        "general" => prepare_script_query(provider, GENERAL_SCRIPT, true),
        "newapi" => prepare_script_query(provider, NEWAPI_SCRIPT, true),
        "custom" => {
            if provider.usage_query.script.trim().is_empty() {
                return Err("Custom usage script is empty".to_string());
            }
            prepare_script_query(provider, &provider.usage_query.script, false)
        }
        _ => Err("Unsupported usage query mode".to_string()),
    }
}

fn prepare_script_query(
    provider: &StoredProvider,
    script: &str,
    same_origin: bool,
) -> Result<PreparedQuery, String> {
    let base_url = if provider.usage_query.base_url.trim().is_empty() {
        provider.base_url.trim()
    } else {
        provider.usage_query.base_url.trim()
    };
    let variables = ScriptVariables {
        api_key: provider.api_key.clone(),
        base_url: base_url.trim_end_matches('/').to_string(),
        access_token: provider.usage_query.access_token.clone(),
        user_id: provider.usage_query.user_id.clone(),
    };
    let request = evaluate_script_request(script, &variables)?;
    let url = if same_origin {
        validate_standard_destination(
            request.url.as_str(),
            base_url,
            provider.usage_query.allow_local_network,
        )?
    } else {
        validate_destination(
            request.url.as_str(),
            provider.usage_query.allow_local_network,
        )?
    };
    let request = HttpRequest { url, ..request };
    Ok(PreparedQuery {
        primary: PreparedRequest {
            request,
            adapter: ProviderAdapter::Script,
            script: Some((script.to_string(), variables)),
        },
        fallback: None,
        allow_local_network: provider.usage_query.allow_local_network,
    })
}

fn prepare_balance_query(provider: &StoredProvider) -> Result<PreparedQuery, String> {
    if provider.api_key.trim().is_empty() {
        return Err("Provider API key is not configured".to_string());
    }
    let base = validate_destination(&provider.base_url, provider.usage_query.allow_local_network)?;
    if base.scheme() != "https" {
        return Err("Built-in usage adapters require HTTPS".to_string());
    }
    let host = base.host_str().unwrap_or_default().to_ascii_lowercase();
    let (adapter, endpoint) = match host.as_str() {
        "api.deepseek.com" => (
            ProviderAdapter::DeepSeek,
            "https://api.deepseek.com/user/balance",
        ),
        "api.stepfun.ai" | "api.stepfun.com" => (
            ProviderAdapter::StepFun,
            "https://api.stepfun.com/v1/accounts",
        ),
        "api.siliconflow.cn" => (
            ProviderAdapter::SiliconFlowCn,
            "https://api.siliconflow.cn/v1/user/info",
        ),
        "api.siliconflow.com" => (
            ProviderAdapter::SiliconFlowEn,
            "https://api.siliconflow.com/v1/user/info",
        ),
        "openrouter.ai" => (
            ProviderAdapter::OpenRouter,
            "https://openrouter.ai/api/v1/credits",
        ),
        "api.novita.ai" => (
            ProviderAdapter::Novita,
            "https://api.novita.ai/v3/user/balance",
        ),
        _ => return Err("No balance adapter matches this provider".to_string()),
    };
    let request = bearer_request(endpoint, &provider.api_key)?;
    Ok(single_request_query(
        request,
        adapter,
        provider.usage_query.allow_local_network,
    ))
}

fn prepare_coding_plan_query(provider: &StoredProvider) -> Result<PreparedQuery, String> {
    let base = validate_destination(&provider.base_url, provider.usage_query.allow_local_network)?;
    if base.scheme() != "https" {
        return Err("Built-in usage adapters require HTTPS".to_string());
    }
    let host = base.host_str().unwrap_or_default().to_ascii_lowercase();
    if host.ends_with(".volces.com") && base.path().contains("/api/coding") {
        if provider.usage_query.access_key_id.trim().is_empty()
            || provider.usage_query.secret_access_key.trim().is_empty()
        {
            return Err("Volcengine AccessKey ID and SecretAccessKey are required".to_string());
        }
        let now = chrono::Utc::now();
        let primary = build_volcengine_request(
            &provider.base_url,
            &provider.usage_query.access_key_id,
            &provider.usage_query.secret_access_key,
            "GetAFPUsage",
            now,
        )?;
        let fallback = build_volcengine_request(
            &provider.base_url,
            &provider.usage_query.access_key_id,
            &provider.usage_query.secret_access_key,
            "GetCodingPlanUsage",
            now,
        )?;
        return Ok(PreparedQuery {
            primary: PreparedRequest {
                request: primary,
                adapter: ProviderAdapter::VolcengineAfp,
                script: None,
            },
            fallback: Some(PreparedRequest {
                request: fallback,
                adapter: ProviderAdapter::VolcengineCoding,
                script: None,
            }),
            allow_local_network: provider.usage_query.allow_local_network,
        });
    }
    if provider.api_key.trim().is_empty() {
        return Err("Provider API key is not configured".to_string());
    }

    let (adapter, request) = match host.as_str() {
        "api.kimi.com" if base.path().contains("/coding") => (
            ProviderAdapter::Kimi,
            bearer_request("https://api.kimi.com/coding/v1/usages", &provider.api_key)?,
        ),
        "open.bigmodel.cn" => (
            ProviderAdapter::Zhipu,
            raw_authorization_request(
                "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
                &provider.api_key,
            )?,
        ),
        "api.z.ai" => (
            ProviderAdapter::Zhipu,
            raw_authorization_request(
                "https://api.z.ai/api/monitor/usage/quota/limit",
                &provider.api_key,
            )?,
        ),
        "api.minimaxi.com" => (
            ProviderAdapter::MiniMax,
            bearer_request(
                "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
                &provider.api_key,
            )?,
        ),
        "api.minimax.io" => (
            ProviderAdapter::MiniMax,
            bearer_request(
                "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
                &provider.api_key,
            )?,
        ),
        "api.zenmux.com" => (
            ProviderAdapter::ZenMux,
            bearer_request(base.as_str(), &provider.api_key)?,
        ),
        _ => return Err("No Coding Plan adapter matches this provider".to_string()),
    };
    Ok(single_request_query(
        request,
        adapter,
        provider.usage_query.allow_local_network,
    ))
}

fn single_request_query(
    request: HttpRequest,
    adapter: ProviderAdapter,
    allow_local_network: bool,
) -> PreparedQuery {
    PreparedQuery {
        primary: PreparedRequest {
            request,
            adapter,
            script: None,
        },
        fallback: None,
        allow_local_network,
    }
}

fn bearer_request(url: &str, api_key: &str) -> Result<HttpRequest, String> {
    raw_authorization_request(url, &format!("Bearer {api_key}"))
}

fn raw_authorization_request(url: &str, authorization: &str) -> Result<HttpRequest, String> {
    let mut headers = HashMap::new();
    headers.insert("Authorization".to_string(), authorization.to_string());
    headers.insert("Accept".to_string(), "application/json".to_string());
    Ok(HttpRequest {
        url: Url::parse(url).map_err(|_| "Usage adapter URL is invalid".to_string())?,
        method: Method::GET,
        headers,
        body: None,
    })
}

fn validate_standard_destination(
    request_url: &str,
    base_url: &str,
    allow_local_network: bool,
) -> Result<Url, String> {
    let request = validate_destination(request_url, allow_local_network)?;
    let base = validate_destination(base_url, allow_local_network)?;
    if request.scheme() != "https" || base.scheme() != "https" {
        return Err("Standard usage templates require HTTPS".to_string());
    }
    if request.scheme() != base.scheme()
        || request.host_str() != base.host_str()
        || request.port_or_known_default() != base.port_or_known_default()
    {
        return Err("Standard usage templates must use the configured Base URL origin".to_string());
    }
    Ok(request)
}

fn validate_destination(raw: &str, allow_local_network: bool) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "Usage query URL is invalid".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Usage query URLs cannot contain credentials".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Usage query URL has no host".to_string())?;
    if url.scheme() != "https" && !(allow_local_network && url.scheme() == "http") {
        return Err("Usage query URL must use HTTPS".to_string());
    }
    let normalized_host = host.trim_end_matches('.').to_ascii_lowercase();
    if matches!(
        normalized_host.as_str(),
        "metadata.google.internal" | "metadata" | "instance-data.ec2.internal"
    ) {
        return Err("Usage query destination is blocked".to_string());
    }
    if !allow_local_network {
        if let Some(address) = parse_ip_host(host) {
            if is_disallowed_address(address) {
                return Err("Usage query destination is blocked".to_string());
            }
        }
    }
    Ok(url)
}

fn is_disallowed_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let octets = address.octets();
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified()
                || address.is_broadcast()
                || address.is_multicast()
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unspecified()
                || address.is_unique_local()
                || address.is_unicast_link_local()
                || address.is_multicast()
                || address
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| is_disallowed_address(IpAddr::V4(mapped)))
        }
    }
}

fn parse_ip_host(host: &str) -> Option<IpAddr> {
    host.trim_start_matches('[')
        .trim_end_matches(']')
        .parse()
        .ok()
}

async fn execute_prepared_query(query: &PreparedQuery) -> Result<Vec<ProviderUsageEntry>, String> {
    match execute_prepared_request(&query.primary, query.allow_local_network).await {
        Ok(primary) if !primary.is_empty() => Ok(primary),
        Ok(primary) => match &query.fallback {
            Some(fallback) => execute_prepared_request(fallback, query.allow_local_network)
                .await
                .map_err(|failure| failure.message),
            None => Ok(primary),
        },
        Err(failure) => {
            if should_try_fallback(failure.kind) {
                if let Some(fallback) = &query.fallback {
                    return execute_prepared_request(fallback, query.allow_local_network)
                        .await
                        .map_err(|failure| failure.message);
                }
            }
            Err(failure.message)
        }
    }
}

fn should_try_fallback(kind: QueryFailureKind) -> bool {
    kind == QueryFailureKind::Soft
}

async fn execute_prepared_request(
    prepared: &PreparedRequest,
    allow_local_network: bool,
) -> Result<Vec<ProviderUsageEntry>, QueryFailure> {
    let response = send_bounded_request(&prepared.request, allow_local_network).await?;
    let body = serde_json::from_slice::<Value>(&response.body).ok();
    let volcengine = matches!(
        prepared.adapter,
        ProviderAdapter::VolcengineAfp | ProviderAdapter::VolcengineCoding
    );
    if volcengine {
        if let Some(kind) = body.as_ref().and_then(classify_volcengine_error) {
            let message = match kind {
                QueryFailureKind::Auth => "Volcengine usage authentication failed",
                QueryFailureKind::Soft => "Volcengine usage API rejected the request",
                QueryFailureKind::Transient => "Volcengine usage request failed",
            };
            return Err(QueryFailure::new(kind, message));
        }
    }
    if response.status == reqwest::StatusCode::UNAUTHORIZED
        || response.status == reqwest::StatusCode::FORBIDDEN
    {
        return Err(QueryFailure::new(
            QueryFailureKind::Auth,
            "Usage query authentication failed",
        ));
    }
    if !response.status.is_success() {
        return Err(QueryFailure::new(
            QueryFailureKind::Soft,
            format!("Usage query failed with HTTP {}", response.status),
        ));
    }
    let response = body.ok_or_else(|| {
        QueryFailure::new(
            QueryFailureKind::Soft,
            "Usage query response is not valid JSON",
        )
    })?;
    if let Some((script, variables)) = &prepared.script {
        extract_script_entries(script, variables, &response)
    } else {
        parse_adapter_response(prepared.adapter, &response)
    }
    .map_err(|message| QueryFailure::new(QueryFailureKind::Soft, message))
}

fn classify_volcengine_error(body: &Value) -> Option<QueryFailureKind> {
    let error = body
        .get("ResponseMetadata")
        .and_then(|metadata| metadata.get("Error"))
        .or_else(|| body.get("Error"))?;
    let code = error.get("Code").and_then(Value::as_str).unwrap_or("");
    let message = error.get("Message").and_then(Value::as_str).unwrap_or("");
    if code.is_empty() && message.is_empty() {
        return None;
    }
    let code = code.to_ascii_lowercase();
    let auth = [
        "auth",
        "signature",
        "accessdenied",
        "denied",
        "unauthorized",
        "forbidden",
        "credential",
        "accesskey",
        "token",
    ]
    .iter()
    .any(|marker| code.contains(marker));
    Some(if auth {
        QueryFailureKind::Auth
    } else {
        QueryFailureKind::Soft
    })
}

async fn send_bounded_request(
    request: &HttpRequest,
    allow_local_network: bool,
) -> Result<HttpResponse, QueryFailure> {
    let host = request
        .url
        .host_str()
        .ok_or_else(|| QueryFailure::new(QueryFailureKind::Soft, "Usage query URL has no host"))?;
    let addresses = resolve_destination(&request.url, allow_local_network)
        .await
        .map_err(|message| QueryFailure::new(QueryFailureKind::Transient, message))?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(DNS_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|_| {
            QueryFailure::new(
                QueryFailureKind::Transient,
                "Unable to create usage query client",
            )
        })?;

    let mut builder = client.request(request.method.clone(), request.url.clone());
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = &request.body {
        builder = builder.body(body.clone());
    }
    let response = builder.send().await.map_err(|_| {
        QueryFailure::new(QueryFailureKind::Transient, "Usage query request failed")
    })?;
    let status = response.status();
    let body = read_limited_response(response)
        .await
        .map_err(|message| QueryFailure::new(QueryFailureKind::Transient, message))?;
    Ok(HttpResponse { status, body })
}

async fn resolve_destination(
    url: &Url,
    allow_local_network: bool,
) -> Result<Vec<SocketAddr>, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "Usage query URL has no host".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "Usage query URL has no port".to_string())?;
    let mut addresses = if let Some(address) = parse_ip_host(host) {
        vec![SocketAddr::new(address, port)]
    } else {
        tokio::time::timeout(DNS_TIMEOUT, tokio::net::lookup_host((host, port)))
            .await
            .map_err(|_| "Usage query DNS resolution timed out".to_string())?
            .map_err(|_| "Usage query DNS resolution failed".to_string())?
            .collect::<Vec<_>>()
    };
    addresses.sort_unstable();
    addresses.dedup();
    if addresses.is_empty() {
        return Err("Usage query DNS resolution returned no addresses".to_string());
    }
    if !allow_local_network
        && addresses
            .iter()
            .any(|address| is_disallowed_address(address.ip()))
    {
        return Err("Usage query destination is blocked".to_string());
    }
    Ok(addresses)
}

async fn read_limited_response(response: reqwest::Response) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("Usage query response is too large".to_string());
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Unable to read usage query response".to_string())?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("Usage query response is too large".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn parse_adapter_response(
    adapter: ProviderAdapter,
    body: &Value,
) -> Result<Vec<ProviderUsageEntry>, String> {
    let entries = match adapter {
        ProviderAdapter::DeepSeek => parse_deepseek(body)?,
        ProviderAdapter::StepFun => vec![balance_entry(
            "StepFun balance",
            required_number(body, "balance")?,
            "CNY",
        )],
        ProviderAdapter::SiliconFlowCn | ProviderAdapter::SiliconFlowEn => {
            let data = body
                .get("data")
                .ok_or_else(|| "SiliconFlow response is missing data".to_string())?;
            vec![balance_entry(
                "SiliconFlow balance",
                required_number(data, "totalBalance")?,
                if adapter == ProviderAdapter::SiliconFlowCn {
                    "CNY"
                } else {
                    "USD"
                },
            )]
        }
        ProviderAdapter::OpenRouter => {
            let data = body.get("data").unwrap_or(body);
            let total = required_number(data, "total_credits")?;
            let used = required_number(data, "total_usage")?;
            vec![balance_entry("OpenRouter balance", total - used, "USD")]
        }
        ProviderAdapter::Novita => vec![balance_entry(
            "Novita balance",
            required_number(body, "availableBalance")? / 10_000.0,
            "USD",
        )],
        ProviderAdapter::Kimi => parse_kimi(body),
        ProviderAdapter::Zhipu => parse_zhipu(body),
        ProviderAdapter::MiniMax => parse_minimax(body),
        ProviderAdapter::ZenMux => parse_zenmux(body)?,
        ProviderAdapter::VolcengineAfp => parse_volcengine_afp(body),
        ProviderAdapter::VolcengineCoding => parse_volcengine_coding(body),
        ProviderAdapter::Script => return Err("Script parser is unavailable".to_string()),
    };
    if entries.len() > MAX_ENTRIES {
        return Err("Usage query returned too many entries".to_string());
    }
    Ok(entries)
}

fn parse_deepseek(body: &Value) -> Result<Vec<ProviderUsageEntry>, String> {
    let infos = body
        .get("balance_infos")
        .and_then(Value::as_array)
        .ok_or_else(|| "DeepSeek response is missing balance information".to_string())?;
    infos
        .iter()
        .map(|info| {
            let unit = info
                .get("currency")
                .and_then(Value::as_str)
                .filter(|unit| !unit.is_empty())
                .ok_or_else(|| "DeepSeek response has an invalid currency".to_string())?;
            Ok(balance_entry(
                "DeepSeek balance",
                required_number(info, "total_balance")?,
                unit,
            ))
        })
        .collect()
}

fn parse_kimi(body: &Value) -> Vec<ProviderUsageEntry> {
    let mut entries = Vec::new();
    if let Some(limits) = body.get("limits").and_then(Value::as_array) {
        for limit in limits {
            if let Some(remaining) = limit
                .get("detail")
                .and_then(|detail| optional_number(detail, "remaining"))
            {
                entries.push(quota_entry("5-hour remaining", remaining, None));
            }
        }
    }
    if let Some(remaining) = body
        .get("usage")
        .and_then(|usage| optional_number(usage, "remaining"))
    {
        entries.push(quota_entry("Weekly remaining", remaining, None));
    }
    entries
}

fn parse_zhipu(body: &Value) -> Vec<ProviderUsageEntry> {
    let Some(limits) = body
        .get("data")
        .and_then(|data| data.get("limits"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    limits
        .iter()
        .filter(|item| {
            item.get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind.eq_ignore_ascii_case("TOKENS_LIMIT"))
        })
        .filter_map(|item| {
            let used = optional_number(item, "percentage")?;
            let label = match item.get("unit").and_then(Value::as_i64) {
                Some(3) => "5-hour remaining",
                Some(6) => "Weekly remaining",
                _ => "Quota remaining",
            };
            Some(quota_entry(label, 100.0 - used, Some("%")))
        })
        .collect()
}

fn parse_minimax(body: &Value) -> Vec<ProviderUsageEntry> {
    let Some(remains) = body.get("model_remains").and_then(Value::as_array) else {
        return Vec::new();
    };
    let Some(general) = remains.iter().find(|item| {
        item.get("model_name")
            .and_then(Value::as_str)
            .is_some_and(|name| name == "general")
    }) else {
        return Vec::new();
    };
    let mut entries = Vec::new();
    if let Some(remaining) = optional_number(general, "current_interval_remaining_percent") {
        entries.push(quota_entry("5-hour remaining", remaining, Some("%")));
    }
    if general.get("current_weekly_status").and_then(Value::as_i64) == Some(1) {
        if let Some(remaining) = optional_number(general, "current_weekly_remaining_percent") {
            entries.push(quota_entry("Weekly remaining", remaining, Some("%")));
        }
    }
    entries
}

fn parse_zenmux(body: &Value) -> Result<Vec<ProviderUsageEntry>, String> {
    if body.get("success").and_then(Value::as_bool) != Some(true) {
        return Err("ZenMux usage query failed".to_string());
    }
    let Some(data) = body.get("data") else {
        return Ok(Vec::new());
    };
    let mut entries = Vec::new();
    for (field, label) in [
        ("quota_5_hour", "5-hour remaining"),
        ("quota_7_day", "Weekly remaining"),
    ] {
        if let Some(used) = data
            .get(field)
            .and_then(|quota| optional_number(quota, "usage_percentage"))
        {
            entries.push(quota_entry(label, (1.0 - used) * 100.0, Some("%")));
        }
    }
    Ok(entries)
}

fn parse_volcengine_afp(body: &Value) -> Vec<ProviderUsageEntry> {
    let result = body.get("Result").unwrap_or(body);
    let mut entries = Vec::new();
    for (field, label) in [
        ("AFPFiveHour", "5-hour remaining"),
        ("AFPWeekly", "Weekly remaining"),
        ("AFPMonthly", "Monthly remaining"),
    ] {
        let Some(window) = result.get(field) else {
            continue;
        };
        let Some(quota) = optional_number(window, "Quota") else {
            continue;
        };
        if quota <= 0.0 {
            continue;
        }
        let used = optional_number(window, "Used").unwrap_or(0.0);
        entries.push(quota_entry(label, quota - used, None));
    }
    entries
}

fn parse_volcengine_coding(body: &Value) -> Vec<ProviderUsageEntry> {
    let result = body.get("Result").unwrap_or(body);
    let Some(usages) = result
        .get("QuotaUsage")
        .and_then(Value::as_array)
        .or_else(|| result.get("Usages").and_then(Value::as_array))
        .or_else(|| result.get("Details").and_then(Value::as_array))
    else {
        return Vec::new();
    };
    usages
        .iter()
        .filter_map(|item| {
            let level = item
                .get("Level")
                .or_else(|| item.get("Type"))
                .or_else(|| item.get("Period"))
                .and_then(Value::as_str)?;
            let label = match level.to_ascii_lowercase().as_str() {
                "session" | "5h" | "fivehour" | "five_hour" | "rolling_5h" => "5-hour remaining",
                "weekly" | "week" | "7d" => "Weekly remaining",
                "monthly" | "month" => "Monthly remaining",
                _ => return None,
            };
            let used = optional_number(item, "Percent")
                .or_else(|| optional_number(item, "UsedPercent"))
                .or_else(|| optional_number(item, "UsagePercent"))?;
            Some(quota_entry(label, 100.0 - used, Some("%")))
        })
        .collect()
}

fn balance_entry(label: &str, value: f64, unit: &str) -> ProviderUsageEntry {
    quota_entry(label, value, Some(unit))
}

fn quota_entry(label: &str, value: f64, unit: Option<&str>) -> ProviderUsageEntry {
    ProviderUsageEntry {
        label: label.to_string(),
        value: format_number(value),
        unit: unit.map(str::to_string),
    }
}

fn required_number(value: &Value, field: &str) -> Result<f64, String> {
    optional_number(value, field)
        .ok_or_else(|| "Usage query response is missing a number".to_string())
}

fn optional_number(value: &Value, field: &str) -> Option<f64> {
    let value = value.get(field)?;
    let number = value
        .as_f64()
        .or_else(|| value.as_str().and_then(|value| value.parse::<f64>().ok()))?;
    number.is_finite().then_some(number)
}

fn format_number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_string();
    }
    let formatted = format!("{value:.6}");
    formatted
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string()
}

fn build_volcengine_request(
    base_url: &str,
    access_key_id: &str,
    secret_access_key: &str,
    action: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<HttpRequest, String> {
    if !matches!(action, "GetAFPUsage" | "GetCodingPlanUsage") {
        return Err("Unsupported Volcengine usage action".to_string());
    }
    let base = Url::parse(base_url).map_err(|_| "Volcengine Base URL is invalid".to_string())?;
    let region = base
        .host_str()
        .unwrap_or_default()
        .split('.')
        .find(|part| part.starts_with("cn-") || part.starts_with("ap-"))
        .unwrap_or("cn-beijing");
    let canonical_query = format!("Action={action}&Region={region}&Version=2024-01-01");
    let body = b"";
    let x_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let short_date = now.format("%Y%m%d").to_string();
    let content_hash = sha256_hex(body);
    let signed_headers = "content-type;host;x-content-sha256;x-date";
    let content_type = "application/json; charset=utf-8";
    let canonical_headers = format!(
        "content-type:{content_type}\nhost:open.volcengineapi.com\nx-content-sha256:{content_hash}\nx-date:{x_date}\n"
    );
    let canonical_request = format!(
        "POST\n/\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{content_hash}"
    );
    let scope = format!("{short_date}/{region}/ark/request");
    let string_to_sign = format!(
        "HMAC-SHA256\n{x_date}\n{scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );
    let k_date = hmac_sha256(secret_access_key.as_bytes(), short_date.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, b"ark");
    let k_signing = hmac_sha256(&k_service, b"request");
    let signature = hex_encode(&hmac_sha256(&k_signing, string_to_sign.as_bytes()));
    let authorization = format!(
        "HMAC-SHA256 Credential={access_key_id}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    );

    let mut headers = HashMap::new();
    headers.insert("Authorization".to_string(), authorization);
    headers.insert("X-Date".to_string(), x_date);
    headers.insert("X-Content-Sha256".to_string(), content_hash);
    headers.insert("Content-Type".to_string(), content_type.to_string());
    Ok(HttpRequest {
        url: Url::parse(&format!(
            "https://open.volcengineapi.com/?{canonical_query}"
        ))
        .map_err(|_| "Volcengine usage URL is invalid".to_string())?,
        method: Method::POST,
        headers,
        body: Some(String::new()),
    })
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    const BLOCK_BYTES: usize = 64;
    let mut normalized = [0_u8; BLOCK_BYTES];
    if key.len() > BLOCK_BYTES {
        normalized[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        normalized[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36_u8; BLOCK_BYTES];
    let mut outer_pad = [0x5c_u8; BLOCK_BYTES];
    for index in 0..BLOCK_BYTES {
        inner_pad[index] ^= normalized[index];
        outer_pad[index] ^= normalized[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(data);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_hash);
    outer.finalize().into()
}

fn sha256_hex(data: &[u8]) -> String {
    hex_encode(&Sha256::digest(data))
}

fn hex_encode(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(result, "{byte:02x}");
    }
    result
}

#[derive(Deserialize)]
struct ScriptRequest {
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
}

fn evaluate_script_request(
    script: &str,
    variables: &ScriptVariables,
) -> Result<HttpRequest, String> {
    validate_script_size(script)?;
    let rendered = render_script(script, variables)?;
    let (_runtime, context) = create_script_sandbox()?;
    let request_json = context.with(|ctx| {
        let config: rquickjs::Object = ctx
            .eval(rendered.as_bytes())
            .map_err(|_| "Usage script could not be evaluated".to_string())?;
        let request: rquickjs::Object = config
            .get("request")
            .map_err(|_| "Usage script is missing request".to_string())?;
        let json = ctx
            .json_stringify(request)
            .map_err(|_| "Usage script request could not be serialized".to_string())?
            .ok_or_else(|| "Usage script request could not be serialized".to_string())?;
        json.to_string()
            .map_err(|_| "Usage script request could not be serialized".to_string())
    })?;
    if request_json.len() > MAX_SCRIPT_OUTPUT_BYTES {
        return Err("Usage script request is too large".to_string());
    }
    let request: ScriptRequest = serde_json::from_str(&request_json)
        .map_err(|_| "Usage script request has an invalid shape".to_string())?;
    validate_script_request(request)
}

fn extract_script_entries(
    script: &str,
    _variables: &ScriptVariables,
    response: &Value,
) -> Result<Vec<ProviderUsageEntry>, String> {
    validate_script_size(script)?;
    let rendered = render_script(script, &ScriptVariables::default())?;
    let response_json = serde_json::to_vec(response)
        .map_err(|_| "Usage response could not be prepared for the script".to_string())?;
    if response_json.len() > MAX_RESPONSE_BYTES {
        return Err("Usage query response is too large".to_string());
    }
    let (_runtime, context) = create_script_sandbox()?;
    let result_json = context.with(|ctx| {
        let config: rquickjs::Object = ctx
            .eval(rendered.as_bytes())
            .map_err(|_| "Usage script could not be evaluated".to_string())?;
        let extractor: Function = config
            .get("extractor")
            .map_err(|_| "Usage script is missing extractor".to_string())?;
        let response = ctx
            .json_parse(response_json)
            .map_err(|_| "Usage response could not be passed to the script".to_string())?;
        let result: rquickjs::Value = extractor
            .call((response,))
            .map_err(|_| "Usage script extractor failed".to_string())?;
        let json = ctx
            .json_stringify(result)
            .map_err(|_| "Usage script result could not be serialized".to_string())?
            .ok_or_else(|| "Usage script result could not be serialized".to_string())?;
        json.to_string()
            .map_err(|_| "Usage script result could not be serialized".to_string())
    })?;
    if result_json.len() > MAX_SCRIPT_OUTPUT_BYTES {
        return Err("Usage script result is too large".to_string());
    }
    let result: Value = serde_json::from_str(&result_json)
        .map_err(|_| "Usage script result is not valid JSON".to_string())?;
    parse_script_result(&result)
}

fn create_script_sandbox() -> Result<(Runtime, Context), String> {
    let runtime =
        Runtime::new().map_err(|_| "Unable to create usage script runtime".to_string())?;
    runtime.set_memory_limit(16 * 1024 * 1024);
    runtime.set_max_stack_size(512 * 1024);
    let deadline = Instant::now() + SCRIPT_TIMEOUT;
    runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));
    let context = Context::builder()
        .with::<rquickjs::context::intrinsic::Eval>()
        .with::<rquickjs::context::intrinsic::Json>()
        .build(&runtime)
        .map_err(|_| "Unable to create usage script context".to_string())?;
    Ok((runtime, context))
}

fn validate_script_size(script: &str) -> Result<(), String> {
    if script.is_empty() || script.len() > MAX_SCRIPT_BYTES {
        return Err("Usage script size is invalid".to_string());
    }
    Ok(())
}

fn render_script(script: &str, variables: &ScriptVariables) -> Result<String, String> {
    let replacements = [
        ("{{apiKey}}", variables.api_key.as_str()),
        ("{{baseUrl}}", variables.base_url.as_str()),
        ("{{accessToken}}", variables.access_token.as_str()),
        ("{{userId}}", variables.user_id.as_str()),
    ]
    .map(|(placeholder, value)| {
        if value.len() > MAX_SCRIPT_VARIABLE_BYTES {
            return Err("Usage script variable is too large".to_string());
        }
        let json = serde_json::to_string(value)
            .map_err(|_| "Unable to prepare usage script variables".to_string())?;
        let escaped = json
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .ok_or_else(|| "Unable to prepare usage script variables".to_string())?;
        Ok((placeholder, escaped.to_string()))
    });
    let replacements = replacements
        .into_iter()
        .collect::<Result<Vec<_>, String>>()?;

    let mut rendered = String::with_capacity(script.len());
    let mut remaining = script;
    while !remaining.is_empty() {
        let next = replacements
            .iter()
            .filter_map(|(placeholder, value)| {
                remaining
                    .find(placeholder)
                    .map(|index| (index, *placeholder, value.as_str()))
            })
            .min_by_key(|(index, _, _)| *index);
        let Some((index, placeholder, value)) = next else {
            push_script_fragment(&mut rendered, remaining)?;
            break;
        };
        push_script_fragment(&mut rendered, &remaining[..index])?;
        push_script_fragment(&mut rendered, value)?;
        remaining = &remaining[index + placeholder.len()..];
    }
    Ok(rendered)
}

fn push_script_fragment(rendered: &mut String, fragment: &str) -> Result<(), String> {
    if rendered.len().saturating_add(fragment.len()) > MAX_SCRIPT_BYTES {
        return Err("Rendered usage script is too large".to_string());
    }
    rendered.push_str(fragment);
    Ok(())
}

fn validate_script_request(request: ScriptRequest) -> Result<HttpRequest, String> {
    let method = match request.method.to_ascii_uppercase().as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        _ => return Err("Usage script request method must be GET or POST".to_string()),
    };
    if request.headers.len() > MAX_HEADERS {
        return Err("Usage script request has too many headers".to_string());
    }
    let mut header_bytes = 0_usize;
    for (name, value) in &request.headers {
        header_bytes = header_bytes
            .saturating_add(name.len())
            .saturating_add(value.len());
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "host"
                | "content-length"
                | "transfer-encoding"
                | "connection"
                | "proxy-authorization"
                | "proxy-connection"
                | "upgrade"
        ) || reqwest::header::HeaderName::from_bytes(name.as_bytes()).is_err()
            || reqwest::header::HeaderValue::from_str(value).is_err()
        {
            return Err("Usage script request contains an invalid header".to_string());
        }
    }
    if header_bytes > MAX_HEADER_BYTES {
        return Err("Usage script request headers are too large".to_string());
    }
    if request
        .body
        .as_ref()
        .is_some_and(|body| body.len() > MAX_REQUEST_BODY_BYTES)
    {
        return Err("Usage script request body is too large".to_string());
    }
    Ok(HttpRequest {
        url: Url::parse(&request.url)
            .map_err(|_| "Usage script request URL is invalid".to_string())?,
        method,
        headers: request.headers,
        body: request.body,
    })
}

fn parse_script_result(result: &Value) -> Result<Vec<ProviderUsageEntry>, String> {
    let items = if let Some(items) = result.as_array() {
        if items.is_empty() {
            return Err("Usage script returned an empty result".to_string());
        }
        items.iter().collect::<Vec<_>>()
    } else {
        vec![result]
    };
    if items.len() > MAX_ENTRIES {
        return Err("Usage script returned too many entries".to_string());
    }
    items
        .into_iter()
        .map(|item| {
            let object = item
                .as_object()
                .ok_or_else(|| "Usage script result entries must be objects".to_string())?;
            let remaining = object
                .get("remaining")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite())
                .ok_or_else(|| {
                    "Usage script result must include a finite remaining value".to_string()
                })?;
            let label = object
                .get("label")
                .or_else(|| object.get("planName"))
                .and_then(Value::as_str)
                .unwrap_or("Remaining");
            let unit = object.get("unit").and_then(|value| {
                if value.is_null() {
                    None
                } else {
                    value.as_str()
                }
            });
            if label.is_empty() || label.len() > 128 || unit.is_some_and(|unit| unit.len() > 64) {
                return Err("Usage script result contains an invalid label or unit".to_string());
            }
            Ok(ProviderUsageEntry {
                label: label.to_string(),
                value: format_number(remaining),
                unit: unit.map(str::to_string),
            })
        })
        .collect()
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn destination_policy_rejects_credentials_and_private_addresses() {
        assert!(validate_destination("https://user:pass@example.test", false).is_err());
        assert!(validate_destination("https://169.254.169.254/latest", false).is_err());
        assert!(validate_destination("https://127.0.0.1", false).is_err());
        assert!(validate_destination("https://[::1]", false).is_err());
        assert!(validate_destination("https://100.64.0.1", false).is_err());
        assert!(validate_destination("https://metadata.google.internal", false).is_err());
        assert!(validate_destination("https://api.example.test", false).is_ok());
        assert!(validate_destination("http://127.0.0.1:8080", true).is_ok());
    }

    #[test]
    fn resolved_address_policy_covers_ipv4_and_ipv6_local_ranges() {
        for address in [
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(192, 168, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(100, 127, 255, 254)),
            IpAddr::V6(Ipv6Addr::LOCALHOST),
            "fd00::1".parse().unwrap(),
            "fe80::1".parse().unwrap(),
        ] {
            assert!(
                is_disallowed_address(address),
                "address should be blocked: {address}"
            );
        }
        assert!(!is_disallowed_address("8.8.8.8".parse().unwrap()));
        assert!(!is_disallowed_address(
            "2606:4700:4700::1111".parse().unwrap()
        ));
    }

    #[tokio::test]
    async fn dns_resolution_rejects_localhost_without_opt_in() {
        let url = Url::parse("https://localhost").expect("localhost URL");
        assert!(resolve_destination(&url, false).await.is_err());
    }

    #[tokio::test]
    async fn transport_does_not_follow_redirects() {
        let (url, server) = serve_once(|address| {
            format!(
                "HTTP/1.1 302 Found\r\nLocation: http://{address}/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
        })
        .await;
        let request = HttpRequest {
            url,
            method: Method::GET,
            headers: HashMap::new(),
            body: None,
        };

        let response = send_bounded_request(&request, true)
            .await
            .expect("redirect response");
        assert_eq!(response.status, reqwest::StatusCode::FOUND);
        server.await.expect("server task");
    }

    #[tokio::test]
    async fn transport_rejects_oversized_content_length() {
        let (url, server) = serve_once(|_| {
            format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                MAX_RESPONSE_BYTES + 1
            )
        })
        .await;
        let request = HttpRequest {
            url,
            method: Method::GET,
            headers: HashMap::new(),
            body: None,
        };

        let failure = send_bounded_request(&request, true)
            .await
            .expect_err("oversized response must fail");
        assert_eq!(failure.kind, QueryFailureKind::Transient);
        assert_eq!(failure.message, "Usage query response is too large");
        server.await.expect("server task");
    }

    #[test]
    fn standard_templates_require_https_and_same_origin() {
        assert!(validate_standard_destination(
            "https://api.example.test/user/balance",
            "https://api.example.test/v1",
            false,
        )
        .is_ok());
        assert!(validate_standard_destination(
            "https://other.example.test/user/balance",
            "https://api.example.test/v1",
            false,
        )
        .is_err());
        assert!(validate_standard_destination(
            "http://api.example.test/user/balance",
            "https://api.example.test/v1",
            true,
        )
        .is_err());
    }

    #[test]
    fn cache_keeps_last_successful_result_after_refresh_failure() {
        let mut cache = UsageCache::default();
        let identity = [7_u8; 32];
        cache.record_success(
            "provider-a",
            identity,
            ProviderUsageResult {
                entries: vec![ProviderUsageEntry {
                    label: "Balance".to_string(),
                    value: "4.20".to_string(),
                    unit: Some("USD".to_string()),
                }],
                queried_at: Some(123),
                error: None,
                is_stale: false,
            },
        );
        cache.record_failure("provider-a", identity, "request timed out");

        let result = cache.get("provider-a", &identity).expect("cached result");
        assert_eq!(result.entries[0].value, "4.20");
        assert_eq!(result.error.as_deref(), Some("request timed out"));
        assert!(result.is_stale);
    }

    #[test]
    fn cache_returns_an_error_without_inventing_stale_values() {
        let mut cache = UsageCache::default();
        let identity = [7_u8; 32];
        let result = cache.record_failure("provider-a", identity, "request failed");

        assert!(result.entries.is_empty());
        assert_eq!(result.error.as_deref(), Some("request failed"));
        assert!(!result.is_stale);
        assert!(cache.get("provider-a", &identity).is_none());
    }

    #[test]
    fn cache_requires_current_provider_identity_and_supports_invalidation() {
        let mut cache = UsageCache::default();
        let original = test_provider("balance", "https://api.deepseek.com/v1");
        let original_identity = provider_query_identity(&original);
        cache.record_success(
            "provider-a",
            original_identity,
            ProviderUsageResult {
                entries: vec![ProviderUsageEntry {
                    label: "Balance".to_string(),
                    value: "4.20".to_string(),
                    unit: Some("USD".to_string()),
                }],
                queried_at: Some(123),
                error: None,
                is_stale: false,
            },
        );

        assert!(cache.get("provider-a", &original_identity).is_some());
        let mut edited = original.clone();
        edited.api_key = "different-account-secret".to_string();
        assert!(cache
            .get("provider-a", &provider_query_identity(&edited))
            .is_none());

        cache.invalidate("provider-a");
        assert!(cache.get("provider-a", &original_identity).is_none());

        let mut disabled = original.clone();
        disabled.usage_query.enabled = false;
        assert!(prepare_query(&disabled).is_err());
        let mut retyped = original;
        retyped.provider_type = "unsupported".to_string();
        assert!(prepare_query(&retyped).is_err());
    }

    #[test]
    fn failure_only_results_are_not_reusable_cache_entries() {
        let mut cache = UsageCache::default();
        let provider = test_provider("balance", "https://api.deepseek.com/v1");
        let identity = provider_query_identity(&provider);

        let result = cache.record_failure("provider-a", identity, "request failed");

        assert!(result.entries.is_empty());
        assert_eq!(result.error.as_deref(), Some("request failed"));
        assert!(cache.get("provider-a", &identity).is_none());
    }

    #[test]
    fn balance_adapters_build_expected_endpoints() {
        let cases = [
            (
                "https://api.deepseek.com/v1",
                ProviderAdapter::DeepSeek,
                "/user/balance",
            ),
            (
                "https://api.stepfun.com/v1",
                ProviderAdapter::StepFun,
                "/v1/accounts",
            ),
            (
                "https://api.siliconflow.cn/v1",
                ProviderAdapter::SiliconFlowCn,
                "/v1/user/info",
            ),
            (
                "https://api.siliconflow.com/v1",
                ProviderAdapter::SiliconFlowEn,
                "/v1/user/info",
            ),
            (
                "https://openrouter.ai/api/v1",
                ProviderAdapter::OpenRouter,
                "/api/v1/credits",
            ),
            (
                "https://api.novita.ai/v3/openai",
                ProviderAdapter::Novita,
                "/v3/user/balance",
            ),
        ];

        for (base_url, expected_adapter, expected_path) in cases {
            let query = test_provider("balance", base_url);
            let prepared = prepare_query(&query).expect("prepare balance query");
            assert_eq!(prepared.primary.adapter, expected_adapter);
            assert_eq!(prepared.primary.request.url.path(), expected_path);
        }
    }

    #[test]
    fn coding_plan_adapters_build_expected_endpoints() {
        let cases = [
            (
                "https://api.kimi.com/coding",
                ProviderAdapter::Kimi,
                "/coding/v1/usages",
            ),
            (
                "https://open.bigmodel.cn/api/paas/v4",
                ProviderAdapter::Zhipu,
                "/api/monitor/usage/quota/limit",
            ),
            (
                "https://api.z.ai/api/paas/v4",
                ProviderAdapter::Zhipu,
                "/api/monitor/usage/quota/limit",
            ),
            (
                "https://api.minimaxi.com/v1",
                ProviderAdapter::MiniMax,
                "/v1/api/openplatform/coding_plan/remains",
            ),
            (
                "https://api.minimax.io/v1",
                ProviderAdapter::MiniMax,
                "/v1/api/openplatform/coding_plan/remains",
            ),
            (
                "https://api.zenmux.com/v1/usage",
                ProviderAdapter::ZenMux,
                "/v1/usage",
            ),
        ];

        for (base_url, expected_adapter, expected_path) in cases {
            let query = test_provider("coding-plan", base_url);
            let prepared = prepare_query(&query).expect("prepare coding plan query");
            assert_eq!(prepared.primary.adapter, expected_adapter);
            assert_eq!(prepared.primary.request.url.path(), expected_path);
        }
    }

    #[test]
    fn coding_plan_rejects_zenmux_lookalike_hosts() {
        for base_url in [
            "https://evil-zenmux.example/api/usage",
            "https://api.zenmux.com.attacker.example/usage",
            "https://zenmux.ai/api/usage",
        ] {
            assert!(prepare_query(&test_provider("coding-plan", base_url)).is_err());
        }
        assert!(prepare_query(&test_provider(
            "coding-plan",
            "https://API.ZENMUX.COM/v1/usage",
        ))
        .is_ok());
    }

    #[test]
    fn balance_adapter_responses_are_normalized() {
        let cases = [
            (
                ProviderAdapter::DeepSeek,
                json!({"balance_infos": [{"currency": "CNY", "total_balance": "12.50"}]}),
                "12.5",
                "CNY",
            ),
            (
                ProviderAdapter::StepFun,
                json!({"balance": 9.25}),
                "9.25",
                "CNY",
            ),
            (
                ProviderAdapter::SiliconFlowEn,
                json!({"data": {"totalBalance": "8.75"}}),
                "8.75",
                "USD",
            ),
            (
                ProviderAdapter::OpenRouter,
                json!({"data": {"total_credits": 20, "total_usage": 3.5}}),
                "16.5",
                "USD",
            ),
            (
                ProviderAdapter::Novita,
                json!({"availableBalance": 42_000}),
                "4.2",
                "USD",
            ),
        ];

        for (adapter, body, value, unit) in cases {
            let entries = parse_adapter_response(adapter, &body).expect("parse adapter response");
            assert_eq!(entries[0].value, value);
            assert_eq!(entries[0].unit.as_deref(), Some(unit));
        }
    }

    #[test]
    fn coding_plan_responses_are_normalized_as_remaining_quota() {
        let cases = [
            (
                ProviderAdapter::Kimi,
                json!({
                    "limits": [{"detail": {"limit": 100, "remaining": 40}}],
                    "usage": {"limit": 1000, "remaining": 700}
                }),
                vec!["40", "700"],
            ),
            (
                ProviderAdapter::Zhipu,
                json!({"data": {"limits": [
                    {"type": "TOKENS_LIMIT", "unit": 3, "percentage": 25},
                    {"type": "TOKENS_LIMIT", "unit": 6, "percentage": 60}
                ]}}),
                vec!["75", "40"],
            ),
            (
                ProviderAdapter::MiniMax,
                json!({"model_remains": [{
                    "model_name": "general",
                    "current_interval_remaining_percent": 80,
                    "current_weekly_status": 1,
                    "current_weekly_remaining_percent": 55
                }]}),
                vec!["80", "55"],
            ),
            (
                ProviderAdapter::ZenMux,
                json!({"success": true, "data": {
                    "quota_5_hour": {"usage_percentage": 0.2},
                    "quota_7_day": {"usage_percentage": 0.75}
                }}),
                vec!["80", "25"],
            ),
            (
                ProviderAdapter::VolcengineAfp,
                json!({"Result": {
                    "AFPFiveHour": {"Quota": 50, "Used": 12.5},
                    "AFPWeekly": {"Quota": 500, "Used": 150}
                }}),
                vec!["37.5", "350"],
            ),
            (
                ProviderAdapter::VolcengineCoding,
                json!({"Result": {"QuotaUsage": [
                    {"Level": "session", "Percent": 20},
                    {"Level": "weekly", "Percent": 35}
                ]}}),
                vec!["80", "65"],
            ),
        ];

        for (adapter, body, expected) in cases {
            let entries = parse_adapter_response(adapter, &body).expect("parse quota response");
            assert_eq!(
                entries
                    .iter()
                    .map(|entry| entry.value.as_str())
                    .collect::<Vec<_>>(),
                expected
            );
        }
    }

    #[test]
    fn script_request_is_bounded_and_has_no_host_capabilities() {
        let script = r#"({
          request: {
            url: "https://api.example.test/usage",
            method: "GET",
            headers: {
              "x-fetch": typeof fetch,
              "x-process": typeof process,
              "x-require": typeof require
            }
          },
          extractor: (response) => ({ remaining: response.remaining, unit: "USD" })
        })"#;
        let request =
            evaluate_script_request(script, &ScriptVariables::default()).expect("evaluate request");
        assert_eq!(
            request.headers.get("x-fetch").map(String::as_str),
            Some("undefined")
        );
        assert_eq!(
            request.headers.get("x-process").map(String::as_str),
            Some("undefined")
        );
        assert_eq!(
            request.headers.get("x-require").map(String::as_str),
            Some("undefined")
        );

        let oversized = "x".repeat(MAX_SCRIPT_BYTES + 1);
        assert!(evaluate_script_request(&oversized, &ScriptVariables::default()).is_err());
    }

    #[test]
    fn script_extractor_requires_finite_remaining_values() {
        let script = r#"({
          request: { url: "https://api.example.test/usage", method: "GET" },
          extractor: (response) => response
        })"#;
        let valid = extract_script_entries(
            script,
            &ScriptVariables::default(),
            &json!({"remaining": 4.2, "unit": "USD"}),
        )
        .expect("valid script result");
        assert_eq!(valid[0].value, "4.2");
        assert!(extract_script_entries(
            script,
            &ScriptVariables::default(),
            &json!({"remaining": "secret"}),
        )
        .is_err());
        assert!(extract_script_entries(
            script,
            &ScriptVariables::default(),
            &json!({"unit": "USD"}),
        )
        .is_err());
    }

    #[test]
    fn script_extractor_cannot_access_request_credentials() {
        let variables = ScriptVariables {
            api_key: "api-secret".to_string(),
            base_url: "https://private.example.test".to_string(),
            access_token: "access-secret".to_string(),
            user_id: "user-secret".to_string(),
        };
        let script = r#"({
          request: {
            url: "{{baseUrl}}/usage",
            method: "GET",
            headers: {
              "Authorization": "Bearer {{apiKey}}",
              "x-access-token": "{{accessToken}}",
              "x-user-id": "{{userId}}"
            }
          },
          extractor: (response) => ({
            remaining: response.remaining,
            label: "sanitized:{{apiKey}}:{{userId}}:{{baseUrl}}",
            unit: "token:{{accessToken}}"
          })
        })"#;

        let request = evaluate_script_request(script, &variables).expect("evaluate request");
        assert_eq!(request.url.as_str(), "https://private.example.test/usage");
        assert_eq!(
            request.headers.get("Authorization").map(String::as_str),
            Some("Bearer api-secret")
        );

        let entries = extract_script_entries(script, &variables, &json!({"remaining": 4.2}))
            .expect("extract response");
        assert_eq!(entries[0].label, "sanitized:::");
        assert_eq!(entries[0].unit.as_deref(), Some("token:"));
    }

    #[test]
    fn template_variables_are_escaped_before_evaluation() {
        let vars = ScriptVariables {
            api_key: "key\"; throw new Error('leak');//".to_string(),
            base_url: "https://api.example.test".to_string(),
            ..ScriptVariables::default()
        };
        let script = r#"({
          request: {
            url: "{{baseUrl}}/usage",
            method: "GET",
            headers: { "Authorization": "Bearer {{apiKey}}" }
          },
          extractor: (response) => response
        })"#;
        let request = evaluate_script_request(script, &vars).expect("escaped variables");
        assert_eq!(
            request.headers.get("Authorization").map(String::as_str),
            Some("Bearer key\"; throw new Error('leak');//"),
        );
    }

    #[test]
    fn rendered_script_and_variables_are_bounded() {
        let oversized_variable = ScriptVariables {
            api_key: "x".repeat(MAX_SCRIPT_VARIABLE_BYTES + 1),
            ..ScriptVariables::default()
        };
        assert!(render_script("({ key: \"{{apiKey}}\" })", &oversized_variable).is_err());

        let repeated_placeholders = "{{apiKey}}".repeat(5);
        let expanding_variable = ScriptVariables {
            api_key: "x".repeat(MAX_SCRIPT_VARIABLE_BYTES),
            ..ScriptVariables::default()
        };
        assert!(render_script(&repeated_placeholders, &expanding_variable).is_err());
    }

    #[test]
    fn volcengine_fallback_only_continues_after_soft_failures() {
        assert!(should_try_fallback(QueryFailureKind::Soft));
        assert!(!should_try_fallback(QueryFailureKind::Auth));
        assert!(!should_try_fallback(QueryFailureKind::Transient));

        let auth = json!({
            "ResponseMetadata": {"Error": {"Code": "InvalidSignature", "Message": "bad"}}
        });
        let unsupported = json!({
            "ResponseMetadata": {"Error": {"Code": "UnsupportedPlan", "Message": "none"}}
        });
        assert_eq!(
            classify_volcengine_error(&auth),
            Some(QueryFailureKind::Auth)
        );
        assert_eq!(
            classify_volcengine_error(&unsupported),
            Some(QueryFailureKind::Soft)
        );
    }

    #[test]
    fn volcengine_access_key_errors_are_auth_failures() {
        for code in [
            "InvalidAccessKey",
            "InvalidAccessKeyId",
            "AccessKeyNotFound",
            "AccessKeyDisabled",
        ] {
            let response = json!({
                "ResponseMetadata": {"Error": {"Code": code, "Message": "bad key"}}
            });
            assert_eq!(
                classify_volcengine_error(&response),
                Some(QueryFailureKind::Auth),
                "{code} must hard-stop without fallback",
            );
        }
    }

    #[test]
    fn script_interrupts_unbounded_execution() {
        let started = Instant::now();
        assert!(evaluate_script_request("for (;;) {}", &ScriptVariables::default()).is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn volcengine_signature_is_deterministic_and_secret_free() {
        let signed = build_volcengine_request(
            "https://ark.cn-beijing.volces.com/api/coding",
            "AKLTtest",
            "secretkey",
            "GetAFPUsage",
            chrono::DateTime::parse_from_rfc3339("2024-06-21T00:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        )
        .expect("signed request");
        let authorization = signed
            .headers
            .get("Authorization")
            .expect("authorization header");
        assert_eq!(
            authorization,
            "HMAC-SHA256 Credential=AKLTtest/20240621/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=de0429a233a6c3e228ec511c8387f09c73654683e5e7ff44dac08f514af28e03",
        );
        assert!(!authorization.contains("secretkey"));
        assert_eq!(
            signed.headers.get("X-Content-Sha256").map(String::as_str),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
        );
    }

    fn test_provider(mode: &str, base_url: &str) -> StoredProvider {
        StoredProvider {
            provider_type: "claude_code".to_string(),
            base_url: base_url.to_string(),
            api_key: "provider-secret".to_string(),
            usage_query: UsageQueryConfig {
                enabled: true,
                mode: mode.to_string(),
                base_url: String::new(),
                access_token: String::new(),
                user_id: String::new(),
                access_key_id: if base_url.contains("volces.com") {
                    "AKLTtest".to_string()
                } else {
                    String::new()
                },
                secret_access_key: if base_url.contains("volces.com") {
                    "secretkey".to_string()
                } else {
                    String::new()
                },
                script: String::new(),
                allow_local_network: false,
            },
        }
    }

    async fn serve_once(
        response: impl FnOnce(std::net::SocketAddr) -> String,
    ) -> (Url, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        let response = response(address);
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept test request");
            let mut request = [0_u8; 1024];
            let _ = socket.read(&mut request).await.expect("read test request");
            socket
                .write_all(response.as_bytes())
                .await
                .expect("write test response");
        });
        (
            Url::parse(&format!("http://{address}/usage")).expect("test server URL"),
            server,
        )
    }
}
