# NDP MCP Server

**NormalDance Protocol (NDP)** — open music rights & royalties protocol. This MCP server
gives AI agents 24 tools (incl. the A7 §7.27 anchor circuit: get_epoch_anchor, verify_track_proof with offline-verified Merkle inclusion proofs) to verify artists, identify tracks by perceptual fingerprint
(ADNA), read rights manifests (NDT), register works and audit the registry.

Audio file becomes a self-contained rights object: the manifest travels inside the file,
the fingerprint survives re-encoding and remixes, and royalties cascade down the
derivation chain (sample → track → remix, up to 10 levels).

## Tools (21)

verify_artist · get_artist_passport · check_artist_tracks · register_track ·
identify_track (ADNA v1/v2, ~0.03 s fragment localization) · get_track_manifest ·
check_track_ownership · get_royalty_balance · start_ucp_checkout · snapshot_epoch ·
stats_journal · subject_mint/subject_status/subject_keys · receipt_batch ·
audience_summary/audience_superfans · opt_in · get_system_stats · get_label_info ·
trigger_n8n_workflow

Verdict thresholds: ≥0.90 same track · 0.75–0.90 derivative (genre-adjusted) · <0.75 unrelated.

## Install

**Claude Code**

```bash
claude mcp add --transport sse ndp https://mcp.normaldance.ru/http --header "Authorization: Bearer YOUR_NDP_TOKEN"
```

**Any MCP client (streamable HTTP / SSE)**

- URL: `https://mcp.normaldance.ru/http`
- Header: `Authorization: Bearer YOUR_NDP_TOKEN`

**From source (stdio)**

```bash
git clone https://github.com/AENDYSTUDIO/ndp-mcp && cd ndp-mcp
npm install
REGISTRY_URL=https://mcp.normaldance.ru REGISTRY_TOKEN=… npm start
```

## Getting a token

The public endpoint is key-gated (fair-use, no anonymous writes). Get a key:
Telegram [@NORMALDANCE](https://t.me/NORMALDANCE) — sandbox keys for testing are issued freely.

## Links

- Site: https://normaldance.ru · Docs: https://normaldance.ru/docs/ · API: https://normaldance.ru/en/api.html
- Live registry stats: https://normaldance.ru/stats.html
- License: MIT
