use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

// --- User ---
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: i64,
    pub clerk_id: Option<String>,
    pub name: String,
    pub email: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Serialize)]
pub struct UserPublic {
    pub id: i64,
    pub name: String,
    pub email: String,
}

impl From<User> for UserPublic {
    fn from(u: User) -> Self {
        UserPublic { id: u.id, name: u.name, email: u.email }
    }
}

// --- Group ---
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Group {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub created_by: i64,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    pub description: Option<String>,
    pub member_ids: Vec<i64>,
}

#[derive(Debug, Serialize)]
pub struct GroupWithBalance {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub total_balance: f64,
    pub member_count: i64,
}

// --- Group Member ---
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct GroupMember {
    pub id: i64,
    pub group_id: i64,
    pub user_id: i64,
    pub joined_at: NaiveDateTime,
}

// --- Expense ---
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Expense {
    pub id: i64,
    pub group_id: i64,
    pub paid_by: i64,
    pub amount: f64,
    pub description: String,
    pub date: NaiveDateTime,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Deserialize)]
pub struct CreateExpenseRequest {
    pub group_id: i64,
    pub amount: f64,
    pub description: String,
    pub date: Option<String>,
    pub splits: Vec<ExpenseSplitInput>,
}

#[derive(Debug, Deserialize)]
pub struct ExpenseSplitInput {
    pub user_id: i64,
    pub amount: Option<f64>,
    pub percentage: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ExpenseWithSplits {
    pub id: i64,
    pub group_id: i64,
    pub paid_by: i64,
    pub paid_by_name: String,
    pub amount: f64,
    pub description: String,
    pub date: String,
    pub splits: Vec<ExpenseSplitResponse>,
}

#[derive(Debug, Serialize)]
pub struct ExpenseSplitResponse {
    pub user_id: i64,
    pub user_name: String,
    pub amount: f64,
}

// --- Expense Split ---
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct ExpenseSplit {
    pub id: i64,
    pub expense_id: i64,
    pub user_id: i64,
    pub amount: f64,
}

// --- Settlement ---
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Settlement {
    pub id: i64,
    pub group_id: i64,
    pub from_user: i64,
    pub to_user: i64,
    pub amount: f64,
    pub date: NaiveDateTime,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Deserialize)]
pub struct CreateSettlementRequest {
    pub group_id: i64,
    pub from_user: i64,
    pub to_user: i64,
    pub amount: f64,
    pub date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SettlementResponse {
    pub id: i64,
    pub group_id: i64,
    pub from_user: i64,
    pub from_user_name: String,
    pub to_user: i64,
    pub to_user_name: String,
    pub amount: f64,
    pub date: String,
}

// --- Balance ---
#[derive(Debug, Serialize)]
pub struct BalanceResponse {
    pub user_id: i64,
    pub user_name: String,
    pub balance: f64,
}

#[derive(Debug, Serialize)]
pub struct GroupBalances {
    pub group_id: i64,
    pub group_name: String,
    pub balances: Vec<BalanceResponse>,
}

// --- Error ---
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

// --- Clerk JWT Claims ---
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
    pub iat: usize,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub picture: Option<String>,
}