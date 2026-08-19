//! A API HTTP. Enxuta de propósito: quem carrega estado é o WebSocket, e estas
//! rotas só existem para as AÇÕES do operador.
//!
//! O corpo das requisições é lido como texto e interpretado à mão em vez de
//! passar por um extrator: um POST sem corpo (que é o caso de `reject` e
//! `hangup`) não pode virar 400 por causa de um `Content-Type` ausente.
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;
use serde_json::json;
use tower_http::cors::{Any, CorsLayer};

use crate::state::{AppState, OpError, DEFAULT_VIDEO_FPS};
use crate::ws;

const PAGINA: &str = r#"<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jurius Call</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:60px auto;padding:0 20px;line-height:1.5}
code{background:#f3f3f3;padding:2px 6px;border-radius:5px}</style></head>
<body><h1>Jurius Call</h1>
<p><strong>Motor:</strong> whatsapp-rust (voz e vídeo).</p>
<p>Estado da conta em <code>/api/status</code>; eventos e mídia em <code>/ws</code>.</p>
</body></html>"#;

pub fn router(state: Arc<AppState>) -> Router {
    // A API é chamada direto pelo navegador do CRM, de outra origem — como já
    // era com o WaCalls.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/", get(|| async { axum::response::Html(PAGINA) }))
        .route("/healthz", get(healthz))
        .route("/api/status", get(status))
        .route("/api/calls", get(list_calls).post(place_call))
        .route("/api/calls/{id}/accept", post(accept_call))
        .route("/api/calls/{id}/reject", post(reject_call))
        .route("/api/calls/{id}/hangup", post(hangup_call))
        .route("/api/calls/{id}/mute", post(mute_call))
        .route("/api/calls/{id}/video/enable", post(enable_video))
        .route("/api/calls/{id}/video/disable", post(disable_video))
        .route("/api/calls/{id}/video/orientation", post(video_orientation))
        .route("/ws", get(ws::upgrade))
        .layer(cors)
        .with_state(state)
}

// --------------------------------------------------------------- utilidades

fn erro(status: u16, mensagem: &str) -> Response {
    let code = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (code, axum::Json(json!({ "error": mensagem }))).into_response()
}

impl From<OpError> for Response {
    fn from(e: OpError) -> Self {
        erro(e.status, &e.message)
    }
}

/// Confere o token, quando há um configurado. Sem `JURIUS_CALL_TOKEN` a API
/// segue aberta, que é como o WaCalls operava.
fn autorizado(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(esperado) = &state.token else {
        return true;
    };
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim_start_matches("Bearer ").trim())
        .map(|v| v == esperado)
        .unwrap_or(false)
}

fn client_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-client-id")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn corpo<T: Default + for<'de> Deserialize<'de>>(texto: &str) -> T {
    if texto.trim().is_empty() {
        return T::default();
    }
    serde_json::from_str(texto).unwrap_or_default()
}

// ------------------------------------------------------------------- corpos

#[derive(Deserialize, Default)]
#[serde(default)]
struct PlaceBody {
    /// Número em dígitos. `phone` é aceito como sinônimo do formato antigo.
    to: Option<String>,
    phone: Option<String>,
    video: bool,
    fps: Option<u32>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct AcceptBody {
    video: bool,
    fps: Option<u32>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct MuteBody {
    muted: bool,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct VideoBody {
    fps: Option<u32>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct OrientationBody {
    /// Quartos de volta, 0..=3.
    orientation: u8,
}

// ------------------------------------------------------------------- rotas

async fn healthz() -> Response {
    axum::Json(json!({ "status": "ok", "backend": "whatsapp-rust", "service": "jurius-call" }))
        .into_response()
}

async fn status(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !autorizado(&state, &headers) {
        return erro(401, "Não autorizado.");
    }
    axum::Json(state.status()).into_response()
}

async fn list_calls(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !autorizado(&state, &headers) {
        return erro(401, "Não autorizado.");
    }
    axum::Json(json!({ "calls": state.rows() })).into_response()
}

async fn place_call(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: String,
) -> Response {
    if !autorizado(&state, &headers) {
        return erro(401, "Não autorizado.");
    }
    let pedido: PlaceBody = corpo(&body);
    let Some(numero) = pedido.to.or(pedido.phone) else {
        return erro(400, "Informe o número em `to`.");
    };
    let fps = pedido.fps.unwrap_or(DEFAULT_VIDEO_FPS);
    match state
        .place_call(&numero, pedido.video, fps, client_id(&headers))
        .await
    {
        Ok(call_id) => axum::Json(json!({
            "callId": call_id,
            "call": state.row(&call_id),
        }))
        .into_response(),
        Err(e) => e.into(),
    }
}

async fn accept_call(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: String,
) -> Response {
    if !autorizado(&state, &headers) {
        return erro(401, "Não autorizado.");
    }
    let pedido: AcceptBody = corpo(&body);
    let fps = pedido.fps.unwrap_or(DEFAULT_VIDEO_FPS);
    match state
        .accept_call(&id, pedido.video, fps, client_id(&headers))
        .await
    {
        Ok(()) => axum::Json(json!({ "call": state.row(&id) })).into_response(),
        Err(e) => e.into(),
    }
}

async fn reject_call(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !autorizado(&state, &headers) {
        return erro(401, "Não autorizado.");
    }
    match state.reject_call(&id).await {
        Ok(()) => axum::Json(json!({ "call": state.row(&id) })).into_response(),
        Err(e) => e.into(),
    }
}

async fn hangup_call(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !autorizado(&state, &headers) {
        return erro(401, "Não autorizado.");
    }
    match state.hangup_call(&id).await {
        Ok(()) => axum::Json(json!({ "call": state.row(&id) })).into_response(),
        Err(e) => e.into(),
    }
}

async fn mute_call(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: String,
) -> Response {
    if !autorizado(&state, &headers) {
        return erro(401, "Não autorizado.");
    }
    let pedido: MuteBody = corpo(&body);
    match state.set_muted(&id, pedido.muted) {
        Ok(()) => axum::Json(json!({ "call": state.row(&id) })).into_response(),
        Err(e) => e.into(),
    }
}

async fn enable_video(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: String,
) -> Response {
    if !autorizado(&state, &headers) {
        return erro(401, "Não autorizado.");
    }
    let pedido: VideoBody = corpo(&body);
    let fps = pedido.fps.unwrap_or(DEFAULT_VIDEO_FPS);
    match state.enable_video(&id, fps).await {
        Ok(()) => axum::Json(json!({ "call": state.row(&id) })).into_response(),
        Err(e) => e.into(),
    }
}

/// A rotação da NOSSA câmera, anunciada ao outro lado.
///
/// Existe porque a webcam do escritório não é o celular de ninguém: ela entrega
/// um quadro deitado, e o aparelho do contato desenha isso girado. Quem sabe
/// qual é o certo é quem está olhando para os dois lados — daí ser um botão, e
/// não uma constante.
async fn video_orientation(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: String,
) -> Response {
    if !autorizado(&state, &headers) {
        return erro(401, "Não autorizado.");
    }
    let pedido: OrientationBody = corpo(&body);
    match state.set_video_orientation(&id, pedido.orientation).await {
        Ok(()) => axum::Json(json!({ "call": state.row(&id) })).into_response(),
        Err(e) => e.into(),
    }
}

async fn disable_video(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !autorizado(&state, &headers) {
        return erro(401, "Não autorizado.");
    }
    match state.disable_video(&id).await {
        Ok(()) => axum::Json(json!({ "call": state.row(&id) })).into_response(),
        Err(e) => e.into(),
    }
}
