# ADR: End-to-End Encryption for the FairShare CRDT Sync Relay

- **Status:** Proposed
- **Date:** 2026-11-14
- **Scope:** `frontend/src/lib/*` (identity, crypto, sync, store) and `relay-server/src/main.rs`
- **Author:** Software Architect (agency-agents)
- **Related:** [`CRDT_SYNC_DESIGN.md`](../CRDT_SYNC_DESIGN.md), [`CODE_REVIEW_F4_F6.md`](../CODE_REVIEW_F4_F6.md) (Blockers B1, S5, S9)

---

## 0. Summary

FairShare relays **operation-based CRDT** sync through an ephemeral Rust WebSocket server. Today the relay "thinks" it is forwarding encrypted patches (`encrypted` + `iv` strings), but the encryption is a **demo** — the key is derived from the group id string (`fairshare-group-key-${gid}`), so any party that knows the group id can decrypt everything. The client also has **no cryptographic relationship between the CRDT op author** (a random `peer_id` UUID) **and its Ed25519 identity key**.

This ADR designs a real end-to-end encryption layer: the relay becomes a **dumb, opaque binary forwarder** that can never read op content, and every op is **sealed to the group's member public keys** so only members can decrypt.

The core design decisions are made below **with the trade-offs explicitly named**. Where we give something up, we say what.

---

## 1. Context

### 1.1 Current state (what the code actually does)

| Area | File | Reality |
|------|------|---------|
| Identity | `identity.ts` | Ed25519 keypair generated on first launch; **private key stored as extractable hex in `localStorage`**. User `id` = 8-char **FNV-1a** fingerprint (non-cryptographic, per the code comment). |
| Crypto | `crypto.ts` | `sign(data)` / `verify(pub, sig, data)` via `@noble/ed25519` + `@noble/hashes`. **No encryption primitive** — Ed25519 is signing-only. |
| Sync | `sync.ts` | `encryptPatch`/`decryptPatch` use Web Crypto AES-256-GCM with a key derived from `_groupKey` via PBKDF2 (hardcoded salt `fairshare-salt`, 100k iters). The `groupKey` is `fairshare-group-key-${gid}` — **guessable**. Wire format is a **JSON text envelope** `{ type:"patch", encrypted, iv, peer_id }`. |
| Sync wiring | `sync.ts` | `syncClient.joinGroup(groupId)` is **defined but never called** (Review B1). So no WebSocket is ever opened and no op is ever sent. **Sync is dead scaffolding.** |
| Op identity | `sync.ts``engine.ts` | `CRDTOperation.peer_id` is a **random UUID** (`crypto.randomUUID()`), unrelated to the Ed25519 public key. `op_id` is a nanoid-style timestamp+random string. |
| Store | `store.ts` | `UserRecord = { id, name, venmo?, paypal?, cashapp? }`. **There is no `publicKey` field** (the task context expected one — it does not exist). Member records are `groupMembers { group_id, user_id }`. |
| Relay | `main.rs` | Parses **JSON text** frames tagged by `type`. `patch` carries `encrypted` + `iv` + `peer_id` (opaque strings, forwarded verbatim). **Binary frames are ignored** (`Ok(_) => {}`). Rooms are in-memory `DashMap`, ephemeral, no disk. |

### 1.2 The three real problems

1. **No real encryption.** The "key" is derivable from the group id, and the op plaintext (`JSON.stringify(op)`), which contains names, amounts, and comments, is recoverable by anyone who knows (or guesses) the group id. The relay could read it too.
2. **Identity is not bound to authorship.** The CRT op says "author = `peer_id` (random UUID)" but the signing key is a separate Ed25519 pair. A forged or replayed op can't be attributed to a real member, and the relay's `peer_id` is self-reported and spoofable.
3. **Sync is not wired.** E2E cannot be built or tested on top of a sync layer that never connects. This is addressed in §8.

---

## 2. Decision 1 — Encryption Scheme

### Options

| Option | What it gives | What it costs | Fit |
|--------|---------------|---------------|-----|
| **A. `@noble/curves` X25519 (ECDH) + Web Crypto AES-256-GCM** | Pure-JS, ~audited (noble is actively maintained with published CVEs and fixes), tree-shakeable (~30 KB gz for x25519), same ecosystem as the existing `@noble/ed25519`/`@noble/hashes`, no WASM/bootstrap. AES-GCM runs in hardware-accelerated native code. | Two crypto stacks (pure-JS DH + native AEAD). Pure-JS DH is fine at this volume (one DH per recipient per op) but is not native-speed. | **Recommended** |
| B. **libsodium.js (WASM)** | Reference-grade, heavily audited (`crypto_box` = X25519 + XSalsa20-Poly1305; `secretstream` = XChaCha20-Poly1305). Memory-lock + non-extractable key APIs. | ~700 KB+ WASM, async `sodium.ready` bootstrap, no tree-shaking, larger bundle, slower first load, extra build tooling. Adds a second dependency family. | Viable but heavy for this app |
| C. **Web Crypto `SubtleCrypto` only** | Native, free of bundle cost, supports **non-exportable** keys (`extractable:false`), hardened key storage. | **No X25519 in the Web Crypto standard** (ECDH is NIST P-256/384/521 only; X25519/Ed25519 are still experimental/inconsistent across Safari/Firefox). Cannot reuse the existing Ed25519 signing key. | **Not viable** for X25519 today |

### Decision

**Use `@noble/curves` for the key-agreement primitive (X25519 ECDH + its HKDF), and Web Crypto `SubtleCrypto` for the AEAD cipher (AES-256-GCM). Keep the existing `@noble/ed25519` signing.**

Concretely per message:
- **Key agreement:** X25519 ECDH (ephemeral sender key × recipient long-term public key) → raw shared secret.
- **Key derivation:** HKDF-SHA-256 (from `@noble/hashes`) over the shared secret + a fixed context string → a 256-bit AES key + 96-bit nonce.
- **AEAD:** AES-256-GCM with a random 96-bit nonce and an **AAD** binding the envelope header (sender public key, recipient fingerprint), so ciphertext can't be transplanted between senders/recipients.

**New dependency:** add `@noble/curves` to `frontend/package.json` (alongside the existing `@noble/ed25519` and `@noble/hashes`).

### Trade-offs (named)

- **Giving up:** the uniformity of a single library. We mix a pure-JS DH (noble/curves) with a native AEAD (SubtleCrypto). The reasons are (a) X25519 is the right curve and isn't in Web Crypto, and (b) AES-GCM in native code is faster and less code than a pure-JS AEAD. If you prefer a fully-noble stack, `@noble/ciphers` provides XChaCha20-Poly1305 but loses native acceleration.
- **Giving up:** any claim to libsodium's gold-standard audit + memory-locking. In exchange we get a ~700 KB smaller bundle and no WASM bootstrap. For a browser expense-split app, bundle weight and load time matter more than the marginal audit status difference.
- **Giving up (with B):** nothing about Web Crypto for X25519. Note this is a **conscious rejection** of the tempting "just use SubtleCrypto" path, because the standard still lacks X25519.
- **Security posture note:** noble's audited status is good but it is pure-JS; constant-time behavior is *designed in* but not universally guaranteed across V8/JSC JIT paths. For per-op DH volume this is a negligible practical risk; document it.

---

## 3. Decision 2 — Key Distribution Model

### Options

| Model | Description | Joining a member | Member leaves | Op size | Rotation cost |
|-------|-------------|------------------|---------------|---------|---------------|
| **A. Shared group secret** | One random group key; all members hold it. Ops encrypted once. | New member gets the key → reads **all** history. | Must **rotate** the key and re-deliver to remainders; ops under old key become a pre/post split. | 1 ciphertext | High |
| **B. Per-recipient (N copies)** | Sender encrypts each op N times, once to each member's public key (X25519 DH + ephemeral key). | Sender adds the new member's public key as a recipient; history is backfilled by a peer re-encrypting to the newcomer on demand. | Stop including the removed member → they can't read **new** ops (they keep old ones they already hold). | N ciphertexts | None needed |
| **C. Hybrid envelope** | One random **content key** per op; content encrypted **once**; the content key is wrapped **N times**, once to each member. | Same as B. | Same as B. | 1 ciphertext + N small wrapped keys | None needed |

### Decision

**Use the hybrid envelope (C): a single symmetric content key per op, wrapped once per recipient via X25519 ECDH.** This is the classic "sealed box" (age / Saltpack / libsodium `crypto_box`) adapted to multi-recipient.

Why not A (shared group secret): the current sync code and `CRDT_SYNC_DESIGN.md` §5.3 both gesture at a "shared group secret (e.g. invite code via HKDF)". That is the weakest option here — an invite code is low-entropy, may be relayed or logged, and **one compromised member exposes the entire group's history**. It also makes leave/join a key-rotation operation, which is exactly the painful path for a sync system where devices come and go.

Why not pure B: N full ciphertexts per op is wasteful when the payload is identical for all recipients. C gets 1 ciphertext + N small wrapped keys (~32–48 bytes each).

### Why C also solves the CRDT backfill problem naturally

CRDT sync replays the op log. A **new device** needs the full history. With per-recipient wrapping, an existing member handling a `sync_request` simply **re-encrypts its local ops to the newcomer's public key** on the fly. There is no shared secret to deliver, and no history to re-derive. The cost: **every sender must know every member's public key** (satisfied by a signed member directory, §6), and must do N X25519 DH ops + N AEAD wraps per op.

### Trade-offs (named)

- **Giving up (vs shared secret):** the ability to read the entire history with one key, and the simplicity of encrypting once. In exchange we get **no key rotation** on membership change and **true per-member access control**.
- **Giving up (vs pure B):** N full ciphertexts for identical payload. We accept a slightly more complex wrap step to keep the wire small.
- **Giving up (forward secrecy):** long-term static keys mean that if a member's private key is compromised, an attacker can decrypt **past and future** ops sealed to that key. Achieving forward secrecy would require per-message ephemeral keys plus Diffie-Hellman ratcheting (a Signal-style double ratchet), which is **out of scope** for a splitwise clone. Documented as a known limitation.
- **Join subtlety:** a new member cannot read *past* ops unless an existing peer re-encrypts them. If no other member is online to backfill, the new device starts with an empty (or partial) view until a peer comes online. With shared-secret A, a new member reads everything immediately — that's the one thing A does better.
- **Op size grows with membership:** each op is `1 ciphertext + N×(recipient-hash + wrapped key + nonce)`. Fine for 2–10-person groups; for large groups (50+) this becomes a real multiplier.

---

## 4. Decision 3 — Relay Changes

### Options

| Option | Relay change | Trade-off |
|--------|--------------|-----------|
| **A. Opaque binary forwarder** | Handle `Message::Binary`; copy the bytes **verbatim** to every other peer in the room (excluding the sending socket). Drop the JSON `patch` parse entirely. Text frames remain only for control (`sync_request`, `ping`, presence). | Relay is maximally simple and **cannot see even the envelope metadata** (no base64, no `peer_id` field, no field names). Gives up *any* server-side payload awareness. |
| **B. Keep opaque JSON text** | Relay keeps forwarding `{ type:"patch", encrypted, iv, peer_id }` strings; it already does this. | ~33% base64 inflation on the wire (every encrypt→b64→relay→b64→decrypt). Relay still parses JSON and needs the `type` discriminator; it sees message **sizes** and the self-reported `peer_id`, both of which are read as metadata. |
| **C. New text subtype** | Add `"type":"sealed"` carrying a single base64 blob. | Minimal change but still JSON + base64; cosmetic improvement over B. |

### Decision

**Adopt A: the relay forwards opaque binary frames verbatim.** It should not parse, validate, or inspect patch payloads at all.

Why: the relay has never had authority in this design — CRDT idempotency and dedup already happen client-side via the op-log (`op_id`), and the relay stores nothing, so **server-side dedup/validation was never a real capability** (it's ephemeral). Eliminating the JSON parse makes the relay blind to everything except *connection* and *bytes*, which is the strongest confidentiality posture. There is nothing meaningful to validate anyway: the relay cannot cheaply verify signatures without the member directory, and doing so would reintroduce plaintext metadata (the number/shape of ops).

### Exactly what the relay must change

1. In `handle_connection`, switch on `Message::Binary` and forward `msg.as_bytes()` to the room, excluding the sending socket.
2. Keep `Message::Text` for control messages (`sync_request`, `ping`, `peers`). Optionally rename `patch` to a non-content name, though the relay no longer needs to read it.
3. **Remove** the `InboundMessage::Patch { encrypted, iv, peer_id }` variant and the `OutboundMessage::Patch { encrypted, iv, peer_id }` variant. The relay now excludes the sender by **WebSocket socket identity**, not by a self-reported `peer_id`.

### Trade-offs (named)

- **Giving up (server-side features):** any future content-aware capability — push notifications with op content ("Alice added $50 dinner"), server-side conflict resolution, content-based rate limiting/moderation, server-side analytics on op content. Under E2E these become impossible (this is also the *point* — see §7). Note: the relay can still do **connection-level** rate limiting (bytes/s, msg/s) and preserve presence events; it just can't filter on content.
- **Giving up (op metadata):** the relay no longer sees op count, `encrypted`/`iv` field names, or `peer_id`. It still sees room membership, connect/disconnect timing, message **sizes** and volume. E2E encrypts **content, not metadata**.
- **Giving up (backfill visibility):** the relay cannot help a new device "find who to backfill from" beyond broadcasting a `sync_request` to the room; peers must answer with re-sealed ops.
- **Gaining:** a smaller wire format (raw bytes, no base64) and a relay with effectively **zero crypto attack surface** — it never holds keys, never decrypts, and can't be meaningfully attacked to recover content.

---

## 5. Decision 4 — Key Storage

### Options

| Option | What it gives | What it costs |
|--------|---------------|---------------|
| **A. Keep `localStorage` (extractable)** | Portability: survives backup/restore, device transfer; simple; **works with `@noble/curves`** (keys are just `Uint8Array`s). | The private key is plaintext in a place any script can read. **XSS = full compromise.** |
| **B. Web Crypto non-exportable** (`extractable:false`) | Browser-hardened key storage; cannot be serialized/read by JS; strong XSS resistance. | **No X25519** (Web Crypto ECDH is P-256 only). Can't pass the key to noble. **Not portable** — can't back it up or move it without an export flow that defeats the property; identity is per-device. |

### Decision

**Add a distinct X25519 encryption keypair alongside the existing Ed25519 signing keypair, both stored in `localStorage` (Option A).** Derive the X25519 secret deterministically from the same 32-byte identity seed as the Ed25519 key (via HKDF with a distinct domain-separation label, e.g. `"fairshare/x25519"`), so there is **one identity seed to back up** but **two independent functions**.

Concretely, extend `crypto.ts` as follows:
- Persist a 32-byte **seed** (not the raw scalar) — `identity_seed`.
- `signKey = seed` for Ed25519 (unchanged).
- `x25519_secret = HKDF(identity_seed, "fairshare/x25519")` → `x25519.getSharedSecret`.

**Hardening path (documented, not implemented now):**
- At-rest protection: re-encrypt the stored seed with a user passphrase (PBKDF2/scrypt from `@noble/hashes`) and store only the ciphertext. This defends against naive storage reads and casual theft, but **not** against a memory-reading XSS that can run crypto in-page.

### Trade-offs (named)

- **Giving up (with A):** any hard guarantee against XSS exfiltration. This app **renders user content** (comment text, expense descriptions) and runs `tesseract.js` OCR — a non-trivial attack surface. We accept this because (a) portability/backup is essential for a multi-device expense app, and (b) `@noble/curves` requires raw key bytes, which are inherently readable in JS memory. **Site explicitly** in docs: "if an attacker can run arbitrary JS in the page, your keys and data are gone."
- **Giving up (with B):** device portability and the ability to use X25519. P-256 non-extractable via Web Crypto is the *only* way to get a truly non-exportable key today, and it restricts us to NIST curves and per-device identities. We reject this for a splitwise clone.
- **Single-seed trade-off:** deriving both Ed25519 and X25519 from one seed means **one compromise compromises both signing and encryption**. The alternative (two independent seeds) halves that blast radius but doubles the backup/restore surface and complicates "identity" UX. I recommend **one seed**, with the label-separated derivation, because the practical blast radius is dominated by "device compromise = everything anyway," not by "signing key leaked but encryption key safe."
- **Not chosen:** the `ed25519 → curve25519` birational conversion (libsodium `pk_to_curve25519`). It reuses the exact Ed25519 seed so you get "one key, two uses," but the conversion is mathematically subtle (clamping, sign-bit handling) and easy to get wrong. A fresh, HKDF-labelled X25519 key is safer and easier to audit.

---

## 6. Decision 5 & 6 — Wire Format + Identity Binding

### 6.1 Wire format

The current format is a JSON text envelope. We move to a **compact binary envelope** carried as a **WebSocket binary frame** (Decision 3A). Control messages stay JSON text.

**Sealed envelope layout** (binary, little-endian; all lengths in bytes):

```
offset  len  field
──────  ───  ─────────────────────────────────────────────────────
0       2    magic = 0x46 0x45  ("FE")
2       1    version = 0x01
3       1    flags  (bit0: has_signature)
4       32   sender_ed25519_pubkey        (identity, for signature verify)
36      32   sender_ephemeral_x25519_pub  (fresh ephemeral per op)
68      1    recipient_count  N  (≤255)
── per recipient i (×N) ───────────────────────────────────────────
        8    recipient_key_id             (first 8 bytes of HASH256(recipient_x25519_pub))
        1    wrapped_key_len
        m    wrapped_content_key          (AES-256-GCM over content key, key=HKDF(ECDH(eph,recipient_pub)), nonce = per-recipient 12B)
        12   wrapped_nonce
── after recipients ───────────────────────────────────────────────
        12   content_nonce                (for the AEAD over the payload)
        4    ciphertext_len
        c    ciphertext + tag             (AES-256-GCM(content_key, content_nonce, aad=sender_pubkey+recipient_count+delimiter))
        64   signature (Ed25519 over offset 0 .. end of ciphertext)  [if flags.sign]
```

The **ciphertext** is a single AEAD over the plaintext `JSON` of the `CRDTOperation`, and the **signature** is Ed25519 over everything before it. The recipient:
1. Looks up its `recipient_key_id` to find its wrapped key.
2. Uses its **long-term X25519 private key** + the **sender ephemeral X25519 public key** to unwrap the content key.
3. Decrypts the payload, then verifies the **sender's Ed25519 signature** against the sender's public key **as recorded in the signed member directory** (not the self-declared bytes in the envelope — otherwise anyone could impersonate).

### 6.2 Identity binding

The receiver needs to know **who** sent the op (to pick the correct wrapped key and to trust the author). Options:

| Option | Binds author? | Cost |
|--------|---------------|------|
| **Signed envelope with sender's Ed25519 pubkey** | Yes — cryptographically, if the pubkey is verified against a trusted member directory. | 64-byte signature per op; requires a trusted member→pubkey registry. |
| HMAC with a shared group key | Proves the sender knew the group key, **not** who they are. | No per-sender attribution; any member can forge. Conflicts with per-recipient distribution. |
| Relay's `peer_id` (current) | No — self-reported, spoofable by any peer or the relay. | None; cannot be trusted under E2E. |

### Decision

**Sign the sealed envelope with the sender's Ed25519 key and verify against a trusted, signed member directory.** Concretely:

- The **group must be bootstrapped as a signed member directory**: when a group is created, the creator publishes a `create_group` op containing each member's **Ed25519 public key + X25519 public key**, and **signs it**. Subsequent `add_member` / `remove_member` ops are likewise signed by the group creator (or by each user adding themselves). This establishes the set of *trusted* keys.
- Each **op envelope is signed** by the author; recipients verify the signature against the *directory's* copy of the author's key. This simultaneously authenticates authorship and prevents a relay from re-ordering or splicing sealed envelopes (GCM auth also defeats splicing).
- **Fix the identity mismatch:** replace the CRDT op's random-UUID `peer_id` with the **author's Ed25519 public key** (or a proper SHA-256-derived fingerprint). This unifies "CRDT authorship" and "crypto identity," so a signature over the op directly vouches for `op.peer_id`. (Note: current `fingerprint()` in `crypto.ts` is FNV-1a and is **non-cryptographic**; use a SHA-256-derived fingerprint for identity keys.)

### Trade-offs (named)

- **Giving up (signing):** 64 bytes and one Ed25519 verification per op. Verification is cheap and needed anyway for authenticity. It also means the sender's **public** keys are visible in the clear (fine — public — but they broaden the metadata a relay or observer can correlate).
- **Giving up (self-declared key trust):** we must maintain a **trusted member directory**, which means the directory itself must be authenticated (signed by the creator) and reconciled across devices. This is added complexity and a new sync surface. The alternative — trusting the self-declared pubkey in the envelope — is **unsafe** (impersonation), so we take on the directory.
- **Giving up (metadata privacy):** a recipient can still see **who** sends ops (public keys) and **message sizes**. E2E hides content, not the communication graph.

---

## 7. Consequences

### What this enables

- **True privacy:** the relay (and anyone who controls, compromises, or subpoenas it) sees only opaque sealed envelopes — no amounts, names, comments, payment handles, descriptions, or group metadata.
- **No server trust for confidentiality.** The relay is a dumb pipe; there is nothing useful to exfiltrate from it.
- **Member-level access control:** only members (who hold a wrapped key) can decrypt. A removed member cannot read ops sealed after their removal; a non-member cannot read anything.
- **Authenticity:** signed ops mean a peer cannot forge another member's expense/comment/settlement, and cannot replay-tamper (Lamport + `op_id` idempotency + GCM auth + signature).

### What it prevents (consequences of giving up server visibility)

- **Server-side content features** become impossible:
  - Push/web notifications **with op content** ("Alice added $50 dinner") — the server never sees content. If you keep the in-page `notifyActivity`, fine; server push can only say "something happened," not what.
  - Server-side **conflict resolution**, dedup, or reconciliation. CRDT idempotency already lives client-side, but the server cannot help a new device reconstruct state except by relaying backfilled ops.
  - Server-side **moderation / abuse filtering / search / analytics** on op content.
- **No server-side backup or recovery.** The relay is ephemeral and stores nothing; if all devices in a group lose their local data simultaneously, the group's history is **unrecoverable**. With a central (plaintext) server you'd get recovery for free; E2E trades that away. This is a **real, user-visible risk** to document and to mitigate with local export/import (`store.export/importStoreState`) and local backups.
- **Metadata still leaks.** The relay and any network observer can see: which `group_id` room, who joins/leaves when, message **sizes**, and traffic volume. E2E does not hide metadata. Mitigation (at bandwidth cost): pad ciphertexts to fixed sizes / constant message interval. Out of scope, but worth noting.
- **No forward secrecy** (§3). A stolen long-term private key decrypts that member's past+future sealed ops.
- **Compromised-member exposure is inherent.** Any member can read whatever is sealed to them; you cannot prevent a member from screenshotting or re-sharing once decrypted.

---

## 8. Prerequisite — Sync Must Be Wired First

`syncClient.joinGroup()` is **defined but never called** (`sync.ts:303`; review Block B1). Consequences that block E2E until fixed:

1. `this.currentGroupId` stays `null`, so `connect()` short-circuits and **no WebSocket is ever opened**.
2. Every `enqueue(...)` (comments, expenses, settlements, `update_profile`) is called **without a `groupId`** → all ops become `group_id: 'unknown'`, which never maps to a real room.
3. `update_profile` (payment handles) is **user-global**, not group-scoped — but it's modeled as a per-group room op. It should go to a **user-scoped encrypted channel**, not a group room (review S9).
4. The queue and op-log **never drain** (`flushQueue` sends but never removes; review S5) — an unbounded growth that E2E must not worsen.

### Implementation order (hard sequencing)

1. **Phase 0 — wire sync.** Call `syncClient.joinGroup(groupId)` in `GroupPage`'s effect; route `update_profile` to a user-global channel; fix `group_id` for all `enqueue` calls; drain the queue on ack. Verify two browsers converge **with the existing demo encryption**. *This must land first — E2E is untestable on dead sync.*
2. **Phase 1 — real keys + member directory.** Add `@noble/curves`; generate the X25519 encryption keypair (HKDF from the identity seed); add `publicKey` / `x25519PublicKey` to `UserRecord` and to the signed member directory; replace FNV `fingerprint()` with a SHA-256 fingerprint.
3. **Phase 2 — seal/unseal.** Implement the binary envelope (§6); swap `encryptPatch`/`decryptPatch` for `sealOp`/`openOp`; switch to binary WS frames; relay drops JSON patch parsing.
4. **Phase 3 — on/off** (feature flag). New groups use E2E; legacy groups remain on the old path until migrated (§9).

---

## 9. Migration Path

Because the relay is **ephemeral and stores nothing**, there is **no encrypted history at the server** to migrate — the plaintext CRDT state lives **on devices** (`localStorage`). This makes migration mostly about exchanging keys and re-broadcasting local state, not about decrypting server data.

### Existing groups (currently on the fake-key demo path)

1. **Steady-state risk check:** devices already hold the plaintext state locally. The only "old" data on the wire is the trivial demo encryption, which is already insecure but was never actually transmitted (sync is dead). So there is **nothing sensitive historically leaked on the network** yet — a fortunate consequence of sync never being wired.
2. **Establish keys.** Each member upgrades → gets an Ed25519 + X25519 keypair. Note: existing devices generated an Ed25519 keypair on first launch; on upgrade we **preserve** the existing Ed25519 identity (so `user.id` and previously-signed data stay stable) and **add** the X25519 key, derived from the same seed.
3. **Bootstrapping the member directory.** For each existing group, a **designated trusted member** publishes the signed member directory (`create`/`update_group` with full member public keys). Because members know the group online/offline, the directory re-encrypts-and-broadcasts — this is the one-time trust bootstrapping. The trade-off: there is no group-wide shared secret to hand out; trust is established pairwise through the signed directory.
4. **Converge then switch.** Devices already agree on plaintext. A member emits its **own** local ops re-sealed as E2E envelopes (no plaintext re-broadcast); the peer-driven `sync_request` reply re-seals history ops to the requester's key. Once a device has received the signed directory and a fresh sealed op, it flips `e2e=true` for that group. Any op that fails to unseal is silently dropped (matching current `decryptPatch` behavior) and the device stays on the legacy path until it can unseal — so rollback is non-destructive.

### New groups

Create the signed member directory **first** (`create_group` signed by creator with all members' keys), then emit sealed ops. No legacy path.

### Rollback

E2E is **off** for a group until every device can unseal. A device that can't unseal keeps using the legacy demo path; the relay forwards both, and the op-log idempotency means either representation of the same `op_id` yields the same result on a device that understands it. So migration is **gradual and safe**, at the cost of running both paths during transition.

### What migration gives up

- **No faceless server-side recovery.** Migration cannot pull history back from a server; a device that wiped its data before upgrade has no server copy to restore from. Users must rely on local export/backup.
- **Double-encryption overhead during transition** for a short window (both sealed and legacy demo ops in flight for partial groups).

---

## 10. Risks / Open Questions

| Risk / question | Owner | Notes |
|-----------------|-------|-------|
| `@noble/curves` adds a new dependency; verify its audit/CVE status at the pinned version. | Security review | Pin and review patch releases; noble publishes CVEs/patches. |
| Member directory trust model — who signs membership changes? (Creator-only vs self-join vs multi-sig.) | Architect | Creator-signed is simplest but a single point of trust; unresolved for larger/less-trusted groups. |
| Metadata leakage (room, size, timing) — decide whether to pad. | Architect / PM | Padding costs bandwidth; note as a follow-up, not a blocker. |
| Passphrase-protected at-rest key. | Security review | Nice hardening, not required for MVP. |
| Large groups (N > ~30) make the per-recipient envelope plus N DH ops a real cost. | Architect | Consider a shared group key as an optimization only for large groups, with the rotation cost accepted. |
| Multi-device identity — same user on two devices has two keypairs? Unify per-user identity across devices. | PM | Out of scope; E2E models per-device keys, which complicates "same person, two devices." |

---

## 11. References

- `frontend/src/lib/identity.ts`, `crypto.ts`, `sync.ts`, `engine.ts`, `store.ts` — current implementation (audited above).
- `relay-server/src/main.rs`, `relay-server/README.md` — current relay protocol.
- `CRDT_SYNC_DESIGN.md` §5.3 — prior (insecure) encryption sketch; superseded by this ADR.
- `CODE_REVIEW_F4_F6.md` — Blockers B1 (sync not wired), S5 (queue never drains), S9 (`update_profile` scoping).
- Noble libraries: `@noble/curves` (X25519/Ed25519/ECDH), `@noble/ed25519`, `@noble/hashes` (HKDF/SHA-256) — currently only `ed25519` + `hashes` are installed.
