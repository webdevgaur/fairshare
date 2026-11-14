mod auth;
mod models;
mod routes;

use auth::ClerkJwks;
use axum::{routing::get, Router};
use sqlx::sqlite::SqlitePoolOptions;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub clerk_jwks: ClerkJwks,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:splitwise.db".into());
    let clerk_jwks_url = std::env::var("CLERK_JWKS_URL")
        .expect("CLERK_JWKS_URL must be set (e.g. https://clerk.yourdomain.com/.well-known/jwks.json)");

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await?;

    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await?;

    // Fetch Clerk JWKS on startup
    let clerk_jwks = ClerkJwks::new(&clerk_jwks_url).await?;
    tracing::info!("Clerk JWKS loaded successfully");

    let state = Arc::new(AppState { db: pool, clerk_jwks });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(|| async { "OK" }))
        .nest("/api/groups", routes::groups::router(state.clone()))
        .nest("/api/expenses", routes::expenses::router(state.clone()))
        .nest("/api/settlements", routes::settlements::router(state.clone()))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await?;
    tracing::info!("Server running on http://0.0.0.0:3001");
    axum::serve(listener, app).await?;

    Ok(())
}