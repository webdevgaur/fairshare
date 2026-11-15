//! FairShare Relay Server — Ephemeral WebSocket relay for CRDT sync.
//!
//! Accepts WebSocket connections at `/ws/group/{group_id}` with an optional
//! `?peer_id=...` query parameter.
//! Maintains in-memory rooms (DashMap of group_id → set of peers).
//! Forwards JSON patches between peers in the same room.
//! Stores no data permanently — ephemeral room state only.
//!
//! Run: cargo run

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use clap::Parser;
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};

static NEXT_PEER_ID: AtomicU32 = AtomicU32::new(1);

// ─── CLI ──────────────────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
#[command(name = "fairshare-relay")]
struct Args {
    /// Listen port
    #[arg(short, long, default_value = "3002")]
    port: u16,

    /// Bind address
    #[arg(short = 'H', long, default_value = "0.0.0.0")]
    host: String,
}

// ─── Protocol Types ───────────────────────────────────────────────────────────

/// Messages the relay can receive from clients.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum InboundMessage {
    /// An encrypted CRDT patch to forward to other peers in the room.
    #[serde(rename = "patch")]
    Patch {
        /// Base64-encoded encrypted payload.
        encrypted: String,
        /// Base64-encoded initialization vector.
        iv: String,
        /// Optional: the sender's peer ID for presence.
        peer_id: String,
    },
    /// Request missed operations from other peers.
    #[serde(rename = "sync_request")]
    SyncRequest {
        /// The last op_id this peer has applied (or null for full sync).
        #[serde(default)]
        last_op_id: Option<String>,
        peer_id: String,
    },
    /// Ping / health check.
    #[serde(rename = "ping")]
    Ping,
}

/// Messages the relay sends to clients.
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum OutboundMessage<'a> {
    #[serde(rename = "room_joined")]
    RoomJoined {
        group_id: &'a str,
        peer_count: usize,
    },
    #[serde(rename = "peer_joined")]
    PeerJoined { peer_id: &'a str },
    #[serde(rename = "peer_left")]
    PeerLeft { peer_id: &'a str },
    #[serde(rename = "patch")]
    Patch {
        encrypted: &'a str,
        iv: &'a str,
        peer_id: &'a str,
    },
    #[serde(rename = "sync_request")]
    SyncRequest {
        last_op_id: Option<&'a str>,
        peer_id: &'a str,
    },
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "error")]
    Error { message: String },
}

// ─── Room State ───────────────────────────────────────────────────────────────

/// A connected peer in a room.
struct Peer {
    /// Channel to send WebSocket messages to this peer.
    tx: mpsc::UnboundedSender<Message>,
    /// The peer's self-reported ID.
    peer_id: String,
}

/// Global state: group_id → list of connected peers.
struct AppState {
    rooms: DashMap<String, Vec<Peer>>,
}

impl AppState {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            rooms: DashMap::new(),
        })
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "fairshare_relay=info".into()),
        )
        .init();

    let args = Args::parse();
    let addr = format!("{}:{}", args.host, args.port);
    let listener = TcpListener::bind(&addr).await.expect("Failed to bind");
    info!("FairShare Relay listening on ws://{}", addr);

    let state = AppState::new();

    while let Ok((stream, peer_addr)) = listener.accept().await {
        let state = Arc::clone(&state);
        tokio::spawn(handle_connection(stream, peer_addr, state));
    }
}

// ─── Connection Handler ───────────────────────────────────────────────────────

async fn handle_connection(
    stream: TcpStream,
    peer_addr: SocketAddr,
    state: Arc<AppState>,
) {
    // Extract group_id and peer_id from the WebSocket URL path.
    // Expected URL: /ws/group/{group_id}?peer_id=xxx
    let mut group_id: Option<String> = None;
    let mut peer_id: Option<String> = None;

    let ws_stream = match accept_hdr_async(stream, |req: &Request, response: Response| {
        let path = req.uri().path();
        let parts: Vec<&str> = path.split('/').collect();

        // Expected path: ["", "ws", "group", "{group_id}"]
        if parts.len() == 4 && parts[1] == "ws" && parts[2] == "group" && !parts[3].is_empty() {
            group_id = Some(parts[3].to_string());

            // Parse peer_id from query parameter ?peer_id=xxx
            peer_id = req.uri().query().and_then(|q| {
                for pair in q.split('&') {
                    let mut kv = pair.splitn(2, '=');
                    if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
                        if k == "peer_id" && !v.is_empty() {
                            return Some(v.to_string());
                        }
                    }
                }
                None
            });

            // Generate a random peer_id if not provided
            if peer_id.is_none() {
                let n = NEXT_PEER_ID.fetch_add(1, Ordering::Relaxed);
                peer_id = Some(format!("anon_{}", n));
            }

            Ok(response)
        } else {
            Err(http::Response::builder()
                .status(400)
                .body(Some("Invalid path. Use /ws/group/{group_id}".to_string()))
                .unwrap())
        }
    })
    .await
    {
        Ok(ws) => ws,
        Err(e) => {
            warn!("WebSocket handshake failed from {peer_addr}: {e}");
            return;
        }
    };

    let group_id = group_id.expect("group_id must be set after successful handshake");
    let peer_id = peer_id.expect("peer_id must be set after successful handshake");

    let (mut ws_write, mut ws_read) = ws_stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    // Spawn a writer task that drains rx and sends to WebSocket
    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Err(e) = ws_write.send(msg).await {
                error!("Failed to send WS message: {e}");
                break;
            }
        }
    });

    // Register this peer in the room
    let peer = Peer {
        tx: tx.clone(),
        peer_id: peer_id.clone(),
    };

    let peer_count;
    {
        let mut room = state.rooms.entry(group_id.clone()).or_insert_with(Vec::new);
        peer_count = room.len() + 1;
        room.push(peer);
    }

    info!("Peer {peer_id} joined room {group_id} (now {peer_count} peers)");

    // Notify the joining peer
    let joined_msg = serde_json::to_string(&OutboundMessage::RoomJoined {
        group_id: &group_id,
        peer_count,
    })
    .unwrap();
    let _ = tx.send(Message::Text(joined_msg.into()));

    // Notify other peers in the room
    broadcast_to_room(
        &state,
        &group_id,
        &OutboundMessage::PeerJoined {
            peer_id: &peer_id,
        },
        Some(&peer_id),
    );

    // Process incoming messages
    while let Some(msg_result) = ws_read.next().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                match serde_json::from_str::<InboundMessage>(&text) {
                    Ok(InboundMessage::Patch {
                        encrypted,
                        iv,
                        peer_id: sender_peer_id,
                    }) => {
                        // Forward the encrypted patch to all other peers in the room
                        broadcast_to_room(
                            &state,
                            &group_id,
                            &OutboundMessage::Patch {
                                encrypted: &encrypted,
                                iv: &iv,
                                peer_id: &sender_peer_id,
                            },
                            Some(&sender_peer_id),
                        );
                    }
                    Ok(InboundMessage::SyncRequest {
                        last_op_id,
                        peer_id: requester_peer_id,
                    }) => {
                        // Ask all other peers to send their recent ops to the requester.
                        broadcast_to_room(
                            &state,
                            &group_id,
                            &OutboundMessage::SyncRequest {
                                last_op_id: last_op_id.as_deref(),
                                peer_id: &requester_peer_id,
                            },
                            Some(&requester_peer_id),
                        );
                    }
                    Ok(InboundMessage::Ping) => {
                        let pong =
                            serde_json::to_string(&OutboundMessage::Pong).unwrap();
                        let _ = tx.send(Message::Text(pong.into()));
                    }
                    Err(e) => {
                        warn!("Failed to parse message from {peer_id}: {e}");
                        let err_msg = serde_json::to_string(&OutboundMessage::Error {
                            message: format!("Invalid message: {e}"),
                        })
                        .unwrap();
                        let _ = tx.send(Message::Text(err_msg.into()));
                    }
                }
            }
            Ok(Message::Close(_)) => {
                info!("Peer {peer_id} disconnected cleanly from room {group_id}");
                break;
            }
            Ok(Message::Ping(data)) => {
                let _ = tx.send(Message::Pong(data));
            }
            Ok(Message::Binary(data)) => {
                // E2E sealed op — forward opaque bytes verbatim to the room,
                // excluding this socket. The relay never inspects the payload.
                broadcast_binary_to_room(&state, &group_id, &data, Some(&peer_id));
            }
            Ok(_) => {
                // Ignore pong/other frames
            }
            Err(e) => {
                warn!("WebSocket error for peer {peer_id}: {e}");
                break;
            }
        }
    }

    // Cleanup: remove peer from room
    cleanup_peer(&state, &group_id, &peer_id).await;

    // Stop the writer task
    drop(tx);
    write_task.await.ok();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Send a message to all peers in a room, optionally excluding one peer.
fn broadcast_to_room(
    state: &AppState,
    group_id: &str,
    msg: &OutboundMessage,
    exclude_peer_id: Option<&str>,
) {
    if let Some(room) = state.rooms.get(group_id) {
        let payload = serde_json::to_string(msg).unwrap();
        for peer in room.iter() {
            if let Some(exclude) = exclude_peer_id {
                if peer.peer_id == exclude {
                    continue;
                }
            }
            let _ = peer.tx.send(Message::Text(payload.clone().into()));
        }
    }
}

/// Forward an opaque binary (E2E sealed envelope) to every peer in a room,
/// excluding the sending socket. The relay never parses or inspects the bytes —
/// it is a dumb forwarder (ADR Decision 3A).
fn broadcast_binary_to_room(
    state: &AppState,
    group_id: &str,
    data: &[u8],
    exclude_peer_id: Option<&str>,
) {
    if let Some(room) = state.rooms.get(group_id) {
        for peer in room.iter() {
            if let Some(exclude) = exclude_peer_id {
                if peer.peer_id == exclude {
                    continue;
                }
            }
            let _ = peer.tx.send(Message::Binary(data.to_vec().into()));
        }
    }
}

/// Remove a peer from a room, clean up empty rooms.
async fn cleanup_peer(state: &AppState, group_id: &str, peer_id: &str) {
    let should_remove_room = {
        let mut room = state.rooms.get_mut(group_id);
        if let Some(ref mut room) = room {
            room.retain(|p| p.peer_id != peer_id);
            if room.is_empty() {
                true
            } else {
                // Notify remaining peers
                let left_msg = OutboundMessage::PeerLeft { peer_id };
                let payload = serde_json::to_string(&left_msg).unwrap();
                for p in room.iter() {
                    let _ = p.tx.send(Message::Text(payload.clone().into()));
                }
                false
            }
        } else {
            false
        }
    };

    if should_remove_room {
        state.rooms.remove(group_id);
        info!("Room {group_id} removed (last peer left)");
    }
}