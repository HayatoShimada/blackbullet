use super::oauth::{consent_page, enc, session_cookie, session_username};
use crate::auth::device::{now, CLIENT_ID, INTERVAL, TTL};
use crate::state::ServerState;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Form;
use serde::Deserialize;
use std::sync::Arc;

pub(crate) fn error(code: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        [("cache-control", "no-store")],
        axum::Json(serde_json::json!({"error": code})),
    )
        .into_response()
}

#[derive(Default, Deserialize)]
#[serde(default)]
pub struct CodeRequest {
    client_id: String,
    device_name: String,
}

pub async fn issue(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Form(form): Form<CodeRequest>,
) -> Response {
    let Some(login) = &state.login else {
        return (StatusCode::FORBIDDEN, "Authentication not enabled").into_response();
    };
    if form.client_id != CLIENT_ID {
        return error("unauthorized_client");
    }
    if form.device_name.len() > 200 {
        return error("invalid_request");
    }
    let host = crate::auth::request_host(&headers);
    if host.is_empty() {
        return error("invalid_request");
    }
    let scheme = if crate::auth::is_secure_request(&headers) {
        "https"
    } else {
        "http"
    };
    let uri = format!("{scheme}://{host}{}/.auth/device", login.host_url_prefix());
    let attempt = match login.device_codes().issue(form.device_name, now()) {
        Ok(a) => a,
        Err(e) => return error(e),
    };
    (
        [("cache-control", "no-store")],
        axum::Json(serde_json::json!({
            "device_code": attempt.device_code,
            "user_code": attempt.user_code,
            "verification_uri": uri,
            "verification_uri_complete": format!("{uri}?user_code={}", enc(&attempt.user_code)),
            "expires_in": TTL,
            "interval": INTERVAL,
        })),
    )
        .into_response()
}

#[derive(Default, Deserialize)]
#[serde(default)]
pub struct Verification {
    user_code: String,
    csrf_token: String,
    decision: String,
}

pub async fn verify(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(query): Query<Verification>,
) -> Response {
    let Some(login) = &state.login else {
        return (StatusCode::FORBIDDEN, "Authentication not enabled").into_response();
    };
    let Some(username) = session_username(&state, &headers, "/.auth/device", None) else {
        let from = format!(
            "{}/.auth/device?user_code={}",
            login.host_url_prefix(),
            enc(&query.user_code)
        );
        return (
            StatusCode::FOUND,
            [(
                "location",
                format!("{}/.auth?from={}", login.host_url_prefix(), enc(&from)),
            )],
        )
            .into_response();
    };
    let attempt = if query.user_code.is_empty() {
        None
    } else {
        match login.device_codes().lookup(&query.user_code, now()) {
            Ok(a) => Some(a),
            Err(e) => return error(e),
        }
    };
    let context = minijinja::context! {
        host_prefix => login.host_url_prefix(),
        space_name => state.boot_config.space_name,
        username => username,
        user_code => attempt.as_ref().map(|a| &a.user_code),
        device_name => attempt.as_ref().map(|a| &a.device_name),
        csrf_token => login.csrf_token(&session_cookie(&headers, login)),
        device_flow => true,
    };
    consent_page(state, context).await
}

pub async fn decide(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Form(form): Form<Verification>,
) -> Response {
    let Some(login) = &state.login else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(username) = session_username(&state, &headers, "/.auth/device", None) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let expected = login.csrf_token(&session_cookie(&headers, login));
    if !crate::auth::config::constant_time_eq(expected.as_bytes(), form.csrf_token.as_bytes()) {
        return error("invalid_request");
    }
    if !matches!(form.decision.as_str(), "approve" | "deny") {
        return error("invalid_request");
    }
    let username = (form.decision == "approve").then_some(username);
    match login
        .device_codes()
        .decide(&form.user_code, username, now())
    {
        Ok(()) => (
            [("cache-control", "no-store")],
            "Decision saved. You can return to your terminal and close this page.",
        )
            .into_response(),
        Err(e) => error(e),
    }
}
