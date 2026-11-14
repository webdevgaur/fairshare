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
use chrono::Utc;
use std::sync::Arc;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(create_group))
        .route("/", get(list_groups))
        .route("/{id}", get(get_group))
        .route("/{id}/balances", get(get_group_balances))
        .route("/{id}/members", get(get_group_members))
        .route_layer(middleware::from_fn_with_state(state, auth_middleware))
}

async fn create_group(
    State(state): State<Arc<AppState>>,
    axum::Extension(user_id): axum::Extension<i64>,
    Json(req): Json<CreateGroupRequest>,
) -> impl IntoResponse {
    if req.name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Group name required"})),
        );
    }

    let group_id = match sqlx::query(
        "INSERT INTO groups (name, description, created_by, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(&req.name)
    .bind(&req.description)
    .bind(user_id)
    .bind(Utc::now().naive_utc())
    .execute(&state.db)
    .await
    {
        Ok(r) => r.last_insert_rowid(),
        Err(e) => {
            tracing::error!("Create group error: {:?}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Failed to create group"})),
            );
        }
    };

    let mut all_members = vec![user_id];
    all_members.extend(req.member_ids);
    all_members.dedup();

    for member_id in &all_members {
        let _ = sqlx::query(
            "INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)",
        )
        .bind(group_id)
        .bind(member_id)
        .bind(Utc::now().naive_utc())
        .execute(&state.db)
        .await;
    }

    let group = sqlx::query_as::<_, Group>("SELECT * FROM groups WHERE id = ?")
        .bind(group_id)
        .fetch_one(&state.db)
        .await
        .unwrap();

    (StatusCode::CREATED, Json(serde_json::json!(group)))
}

async fn list_groups(
    State(state): State<Arc<AppState>>,
    axum::Extension(user_id): axum::Extension<i64>,
) -> impl IntoResponse {
    let groups = sqlx::query_as::<_, Group>(
        r#"SELECT g.* FROM groups g
           JOIN group_members gm ON g.id = gm.group_id
           WHERE gm.user_id = ?
           ORDER BY g.created_at DESC"#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut result = Vec::new();
    for group in groups {
        let balance = get_user_balance_for_group(&state.db, group.id, user_id).await;
        let member_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM group_members WHERE group_id = ?",
        )
        .bind(group.id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        result.push(GroupWithBalance {
            id: group.id,
            name: group.name,
            description: group.description,
            total_balance: balance,
            member_count,
        });
    }

    (StatusCode::OK, Json(serde_json::json!(result)))
}

async fn get_group(
    State(state): State<Arc<AppState>>,
    axum::Extension(_user_id): axum::Extension<i64>,
    Path(group_id): Path<i64>,
) -> impl IntoResponse {
    let group = sqlx::query_as::<_, Group>("SELECT * FROM groups WHERE id = ?")
        .bind(group_id)
        .fetch_optional(&state.db)
        .await;

    match group {
        Ok(Some(g)) => (StatusCode::OK, Json(serde_json::json!(g))),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Group not found"})),
        ),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to fetch group"})),
        ),
    }
}

async fn get_group_members(
    State(state): State<Arc<AppState>>,
    axum::Extension(_user_id): axum::Extension<i64>,
    Path(group_id): Path<i64>,
) -> impl IntoResponse {
    let members = sqlx::query_as::<_, User>(
        r#"SELECT u.id, u.name, u.email, u.created_at
           FROM users u
           JOIN group_members gm ON u.id = gm.user_id
           WHERE gm.group_id = ?
           ORDER BY u.name"#,
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let members: Vec<UserPublic> = members.into_iter().map(|u| u.into()).collect();
    (StatusCode::OK, Json(serde_json::json!(members)))
}

async fn get_group_balances(
    State(state): State<Arc<AppState>>,
    axum::Extension(_user_id): axum::Extension<i64>,
    Path(group_id): Path<i64>,
) -> impl IntoResponse {
    let members = sqlx::query_as::<_, User>(
        r#"SELECT u.id, u.name, u.email, u.created_at
           FROM users u
           JOIN group_members gm ON u.id = gm.user_id
           WHERE gm.group_id = ?
           ORDER BY u.name"#,
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let group = sqlx::query_as::<_, Group>("SELECT * FROM groups WHERE id = ?")
        .bind(group_id)
        .fetch_optional(&state.db)
        .await;

    let group = match group {
        Ok(Some(g)) => g,
        _ => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Group not found"})),
            )
        }
    };

    let mut balances = Vec::new();
    for member in &members {
        let balance = get_user_balance_for_group(&state.db, group_id, member.id).await;
        balances.push(BalanceResponse {
            user_id: member.id,
            user_name: member.name.clone(),
            balance,
        });
    }

    (
        StatusCode::OK,
        Json(serde_json::json!(GroupBalances {
            group_id,
            group_name: group.name,
            balances,
        })),
    )
}

async fn get_user_balance_for_group(
    db: &sqlx::SqlitePool,
    group_id: i64,
    user_id: i64,
) -> f64 {
    let paid: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE group_id = ? AND paid_by = ?",
    )
    .bind(group_id)
    .bind(user_id)
    .fetch_one(db)
    .await
    .unwrap_or(0.0);

    let owes: f64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(es.amount), 0) FROM expense_splits es
           JOIN expenses e ON es.expense_id = e.id
           WHERE e.group_id = ? AND es.user_id = ?"#,
    )
    .bind(group_id)
    .bind(user_id)
    .fetch_one(db)
    .await
    .unwrap_or(0.0);

    let received: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount), 0) FROM settlements WHERE group_id = ? AND to_user = ?",
    )
    .bind(group_id)
    .bind(user_id)
    .fetch_one(db)
    .await
    .unwrap_or(0.0);

    let sent: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount), 0) FROM settlements WHERE group_id = ? AND from_user = ?",
    )
    .bind(group_id)
    .bind(user_id)
    .fetch_one(db)
    .await
    .unwrap_or(0.0);

    paid - owes + received - sent
}