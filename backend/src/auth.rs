use crate::models::{Claims, ErrorResponse};
use crate::AppState;
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use rsa::pkcs8::{DecodePublicKey, EncodePublicKey};
use rsa::RsaPublicKey;
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
struct Jwk {
    kty: String,
    kid: String,
    n: String,
    e: String,
    alg: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

/// Fetches and caches Clerk's JWKS keys
pub struct ClerkJwks {
    pub keys: Vec<Jwk>,
    fetched_at: std::time::Instant,
}

impl ClerkJwks {
    pub async fn new(jwks_url: &str) -> anyhow::Result<Self> {
        let keys = fetch_jwks(jwks_url).await?;
        Ok(ClerkJwks {
            keys,
            fetched_at: std::time::Instant::now(),
        })
    }

    pub async fn refresh_if_expired(&mut self, jwks_url: &str) -> anyhow::Result<()> {
        if self.fetched_at.elapsed() > std::time::Duration::from_secs(3600) {
            self.keys = fetch_jwks(jwks_url).await?;
            self.fetched_at = std::time::Instant::now();
        }
        Ok(())
    }

    pub fn verify_token(&self, token: &str) -> Result<Claims, String> {
        let header = decode_header(token).map_err(|e| format!("Invalid token header: {}", e))?;
        let kid = header.kid.as_ref().ok_or("Missing kid in token header")?;

        let jwk = self
            .keys
            .iter()
            .find(|k| k.kid == *kid)
            .ok_or_else(|| format!("No matching JWK for kid: {}", kid))?;

        let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let n_bytes = engine
            .decode(&jwk.n)
            .map_err(|e| format!("Failed to decode n: {}", e))?;
        let e_bytes = engine
            .decode(&jwk.e)
            .map_err(|e| format!("Failed to decode e: {}", e))?;

        let n_biguint = rsa::BigUint::from_bytes_be(&n_bytes);
        let e_biguint = rsa::BigUint::from_bytes_be(&e_bytes);

        let rsa_pub_key = RsaPublicKey::new(n_biguint, e_biguint)
            .map_err(|e| format!("Failed to construct RSA key: {}", e))?;

        let der = rsa_pub_key
            .to_public_key_der()
            .map_err(|e| format!("DER encoding failed: {}", e))?;

        let decoding_key = DecodingKey::from_rsa_der(der.as_ref());

        let mut validation = Validation::new(Algorithm::RS256);
        validation.validate_exp = true;
        validation.required_spec_claims = HashSet::new();

        let token_data = decode::<Claims>(token, &decoding_key, &validation)
            .map_err(|e| format!("Token verification failed: {}", e))?;

        Ok(token_data.claims)
    }
}

async fn fetch_jwks(url: &str) -> anyhow::Result<Vec<Jwk>> {
    let resp = reqwest::get(url).await?;
    let jwks: Jwks = resp.json().await?;
    Ok(jwks.keys)
}

pub async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Response {
    let auth_header = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    let token = match auth_header {
        Some(t) => t,
        None => {
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse {
                error: "Missing Authorization header".into(),
            }))
            .into_response();
        }
    };

    let clerk_jwks = &state.clerk_jwks;
    let claims = match clerk_jwks.verify_token(token) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Clerk JWT verification failed: {}", e);
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse {
                error: "Invalid or expired token".into(),
            }))
            .into_response();
        }
    };

    let clerk_user_id = claims.sub.clone();
    let user_id = ensure_user(&state.db, &clerk_user_id, &claims).await;

    req.extensions_mut().insert(user_id);
    req.extensions_mut().insert(clerk_user_id);
    next.run(req).await
}

async fn ensure_user(
    db: &sqlx::SqlitePool,
    clerk_user_id: &str,
    claims: &Claims,
) -> i64 {
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM users WHERE clerk_id = ?",
    )
    .bind(clerk_user_id)
    .fetch_optional(db)
    .await;

    if let Ok(Some(id)) = existing {
        return id;
    }

    let name = claims
        .name
        .clone()
        .unwrap_or_else(|| "User".to_string());
    let email = claims
        .email
        .clone()
        .unwrap_or_else(|| format!("{}@clerk.dev", clerk_user_id));

    let result = sqlx::query(
        "INSERT INTO users (clerk_id, name, email, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(clerk_user_id)
    .bind(&name)
    .bind(&email)
    .bind(chrono::Utc::now().naive_utc())
    .execute(db)
    .await;

    match result {
        Ok(r) => r.last_insert_rowid(),
        Err(_) => {
            sqlx::query_scalar::<_, i64>("SELECT id FROM users WHERE clerk_id = ?")
                .bind(clerk_user_id)
                .fetch_one(db)
                .await
                .unwrap_or(0)
        }
    }
}