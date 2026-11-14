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
use chrono::NaiveDateTime;
use std::sync::Arc;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(create_expense))
        .route("/group/{group_id}", get(list_expenses))
        .route_layer(middleware::from_fn_with_state(state, auth_middleware))
}

async fn create_expense(
    State(state): State<Arc<AppState>>,
    axum::Extension(user_id): axum::Extension<i64>,
    Json(req): Json<CreateExpenseRequest>,
) -> impl IntoResponse {
    if req.amount <= 0.0 || req.description.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Valid amount and description required"})),
        );
    }

    let is_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM group_members WHERE group_id = ? AND user_id = ?",
    )
    .bind(req.group_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if is_member == 0 {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "You are not a member of this group"})),
        );
    }

    let expense_date = req
        .date
        .and_then(|d| NaiveDateTime::parse_from_str(&d, "%Y-%m-%dT%H:%M:%S").ok())
        .unwrap_or_else(|| chrono::Utc::now().naive_utc());

    let expense_id = match sqlx::query(
        "INSERT INTO expenses (group_id, paid_by, amount, description, date, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(req.group_id)
    .bind(user_id)
    .bind(req.amount)
    .bind(&req.description)
    .bind(expense_date)
    .bind(chrono::Utc::now().naive_utc())
    .execute(&state.db)
    .await
    {
        Ok(r) => r.last_insert_rowid(),
        Err(e) => {
            tracing::error!("Create expense error: {:?}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Failed to create expense"})),
            );
        }
    };

    let splits = if req.splits.is_empty() {
        let member_ids: Vec<i64> = sqlx::query_scalar(
            "SELECT user_id FROM group_members WHERE group_id = ?",
        )
        .bind(req.group_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        let share = req.amount / member_ids.len() as f64;
        let share = (share * 100.0).round() / 100.0;
        let remainder = req.amount - share * (member_ids.len() - 1) as f64;

        member_ids
            .into_iter()
            .enumerate()
            .map(|(i, uid)| ExpenseSplitInput {
                user_id: uid,
                amount: Some(if i == 0 { remainder } else { share }),
                percentage: None,
            })
            .collect::<Vec<_>>()
    } else {
        let total: f64 = req.splits.iter().map(|s| s.amount.unwrap_or(0.0)).sum();
        if (total - req.amount).abs() > 0.01 {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Split amounts must sum to the total expense"})),
            );
        }
        req.splits
    };

    for split in &splits {
        let split_amount = split.amount.unwrap_or(0.0);
        let _ = sqlx::query(
            "INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?)",
        )
        .bind(expense_id)
        .bind(split.user_id)
        .bind(split_amount)
        .execute(&state.db)
        .await;
    }

    let expense = sqlx::query_as::<_, Expense>("SELECT * FROM expenses WHERE id = ?")
        .bind(expense_id)
        .fetch_one(&state.db)
        .await
        .unwrap();

    (StatusCode::CREATED, Json(serde_json::json!(expense)))
}

async fn list_expenses(
    State(state): State<Arc<AppState>>,
    axum::Extension(_user_id): axum::Extension<i64>,
    Path(group_id): Path<i64>,
) -> impl IntoResponse {
    let expenses = sqlx::query_as::<_, Expense>(
        "SELECT * FROM expenses WHERE group_id = ? ORDER BY date DESC, created_at DESC",
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut result = Vec::new();
    for expense in expenses {
        let paid_by_name = sqlx::query_scalar::<_, String>(
            "SELECT name FROM users WHERE id = ?",
        )
        .bind(expense.paid_by)
        .fetch_optional(&state.db)
        .await
        .unwrap_or_default()
        .unwrap_or_default();

        let splits = sqlx::query_as::<_, ExpenseSplit>(
            "SELECT * FROM expense_splits WHERE expense_id = ?",
        )
        .bind(expense.id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        let mut split_responses = Vec::new();
        for split in splits {
            let user_name = sqlx::query_scalar::<_, String>(
                "SELECT name FROM users WHERE id = ?",
            )
            .bind(split.user_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or_default()
            .unwrap_or_default();

            split_responses.push(ExpenseSplitResponse {
                user_id: split.user_id,
                user_name,
                amount: split.amount,
            });
        }

        result.push(ExpenseWithSplits {
            id: expense.id,
            group_id: expense.group_id,
            paid_by: expense.paid_by,
            paid_by_name,
            amount: expense.amount,
            description: expense.description,
            date: expense.date.format("%Y-%m-%d").to_string(),
            splits: split_responses,
        });
    }

    (StatusCode::OK, Json(serde_json::json!(result)))
}