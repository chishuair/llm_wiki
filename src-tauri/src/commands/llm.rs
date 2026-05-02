use std::{collections::HashMap, time::Duration};

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmCompletionRequest {
    url: String,
    headers: HashMap<String, String>,
    body: Value,
}

#[tauri::command]
pub async fn llm_chat_completion(request: LlmCompletionRequest) -> Result<String, String> {
    let mut body = request.body;
    if let Value::Object(ref mut map) = body {
        // The Rust proxy returns a full completion. Frontend streaming is still
        // attempted first; this path is only a CORS/network fallback.
        map.insert("stream".to_string(), Value::Bool(false));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15 * 60))
        .build()
        .map_err(|err| format!("创建模型请求客户端失败：{err}"))?;

    let mut builder = client.post(&request.url).json(&body);
    for (key, value) in request.headers {
        builder = builder.header(key, value);
    }

    let response = builder
        .send()
        .await
        .map_err(|err| format!("无法连接模型服务：{err}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取模型响应失败：{err}"))?;

    if !status.is_success() {
        return Err(format!("模型服务返回 HTTP {status}：{text}"));
    }

    parse_openai_compatible_content(&text)
        .ok_or_else(|| format!("模型响应格式无法识别：{text}"))
}

fn parse_openai_compatible_content(text: &str) -> Option<String> {
    let parsed = serde_json::from_str::<Value>(text).ok()?;
    parsed
        .get("choices")?
        .as_array()?
        .first()?
        .get("message")?
        .get("content")?
        .as_str()
        .map(ToString::to_string)
}
