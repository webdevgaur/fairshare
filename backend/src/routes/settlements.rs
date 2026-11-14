use crate::auth::auth_middleware;
use crate::models::*;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    middleware,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{NaiveDateTime, Utc};
use std::sync::Arc;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(create_settlement))
        .route("/group/{group_id}", get(list_settlements))
        .route_layer(middleware::from_fn_with_state(state, auth_middleware))
}

async fn create_settlement(
    State(state): State<Arc<AppState>>,
    axum::Extension(user_id): axum::Extension<i64>,
    Json(req): Json<CreateSettlementRequest>,
) -> impl IntoResponse {
    if req.amount <= 0.0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Amount must be positive"})),
        );
    }

    if req.from_user != user_id {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "You can only create settlements where you are the payer"})),
        );
    }

    let settlement_date = req
        .date
        .and_then(|d| NaiveDateTime::parse_from_str(&d, "%Y-%m-%dT%H:%M:%S").ok())
        .unwrap_or_else(|| Utc::now().naive_utc());

    match sqlx::query(
        "INSERT INTO settlements (group_id, from_user, to_user, amount, date, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(req.group_id)
    .bind(req.from_user)
    .bind(req.to_user)
    .bind(req.amount)
    .bind(settlement_date)
    .bind(Utc::now().naive_utc())
    .execute(&state.db)
    .await
    {
        Ok(r) => {
            let id = r.last_insert_rowid();
            let settlement = sqlx::query_as::<_, Settlement>("SELECT * FROM settlements WHERE id = ?")
                .bind(id)
                .fetch_one(&state.db)
                .await
                .unwrap();

            let from_name = sqlx::query_scalar::<_, String>("SELECT name FROM users WHERE id = ?")
                .bind(settlement.from_user)
                .fetch_optional(&state.db)
                .await
                .unwrap_or_default()
                .unwrap_or_default();

            let to_name = sqlx::query_scalar::<_, String>("SELECT name FROM users WHERE id = ?")
                .bind(settlement.to_user)
                .fetch_optional(&state.db)
                .await
                .unwrap_or_default()
                .unwrap_or_default();

            (
                StatusCode::CREATED,
                Json(serde_json::json!(SettlementResponse {
                    id: settlement.id,
                    group_id: settlement.group_id,
                    from_user: settlement.from_user,
                    from_user_name: from_name,
                    to_user: settlement.to_user,
                    to_user_name: to_name,
                    amount: settlement.amount,
                    date: settlement.date.format("%Y-%m-%d").to_string(),
                })),
            )
        }
        Err(e) => {
            tracing::error!("Create settlement error: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Failed to create settlement"})),
            )
        }
    }
}

async fn list_settlements(
    State(state): State<Arc<AppState>>,
    axum::Extension(_user_id): axum::Extension<i64>,
    Path(group_id): Path<i64>,
) -> impl IntoResponse {
    let settlements = sqlx::query_as::<_, Settlement>(
        "SELECT * FROM settlements WHERE group_id = ? ORDER BY date DESC, created_at DESC",
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut result = Vec::new();
    for s in settlements {
        let from_name = sqlx::query_scalar::<_, String>("SELECT name FROM users WHERE id = ?")
            .bind(s.from_user)
            .fetch_optional(&state.db)
            .await
            .unwrap_or_default()
            .unwrap_or_default();

        let to_name = sqlx::query_scalar::<_, String>("SELECT name FROM users WHERE id = ?")
            .bind(s.to_user)
            .fetch_optional(&state.db)
            .await
            .unwrap_or_default()
            .unwrap_or_default();

        result.push(SettlementResponse {
            id: s.id,
            group_id: s.group_id,
            from_user: s.from_user,
            from_user_name: from_name,
            to_user: s.to_user,
            to_user_name: to_name,
            amount: s.amount,
            date: s.date.format("%Y-%m-%d").to_string(),
        });
    }

    (StatusCode::OK, Json(serde_json::json!(result)))
}