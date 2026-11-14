# FairShare Relay Server

Ephemeral WebSocket relay for CRDT sync. Forwards JSON patches between peers in the same room. No data is stored permanently.

## How it works

- Clients connect via WebSocket to `/ws/group/{group_id}?peer_id={peer_id}`
- Each group is an ephemeral room (in-memory `DashMap`)
- JSON patch messages are forwarded to all other peers in the same room
- Empty rooms are cleaned up automatically when the last peer disconnects

## Build

```bash
cargo build
```

## Run

```bash
cargo run
```

Listens on `0.0.0.0:3002` by default. Use `--port` and `--host` flags to change:

```bash
cargo run -- --port 9090 --host 127.0.0.1
```

## Connect

```bash
# Using websocat (install: cargo install websocat)
websocat ws://localhost:3002/ws/group/my_group?peer_id=alice
```

Send a patch (all other peers in the room will receive it):
```json
{"type": "patch", "encrypted": "...", "iv": "...", "peer_id": "alice"}
```

## Protocol

| Direction   | Message Type       | Description                            |
|-------------|--------------------|----------------------------------------|
| Client      | `join` (reserved)  | Group/peer identified via URL path+query |
| Server      | `room_joined`      | Confirms join, includes peer count     |
| Server      | `peer_joined`      | Broadcast: a new peer entered the room |
| Server      | `peer_left`        | Broadcast: a peer left the room        |
| Client      | `patch`            | Forward an encrypted CRDT patch        |
| Client      | `sync_request`     | Request missed ops from other peers    |
| Client      | `ping`             | Health check → server replies `pong`   |
| Server      | `error`            | Parse or protocol error                |