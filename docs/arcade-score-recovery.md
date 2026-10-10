# Arcade personal score recovery

The previous published `20260722211910` client fell back to a guest key when a personal
Nostr signer fails or cannot sign. Its entry asset is `index-DmrMN_y4.js`,
SHA-256 `651a54716eb6fbba50020d73fdeda2866e0fd05f0cd1606f2715cc6b1fe61ed6`.
That can publish a personal run under a different account. Five new regressions
reproduce this behaviour, account/template substitution and post-logout
submission in the unchanged source.

The replacement captures the run identity and details before asynchronous
work. Personal claims require that account's live signer and a canonical,
unchanged signature. Logout and session replacement prevent a pending claim.
An explicit guest run remains a guest run; personal signer failures never
create or select a guest key.

Before attempting a personal claim, the client stores only its public receipt:
original public key, score summary, run details and whether it came from the
arcade. The queue is bounded and does not evict an older receipt for a new one.
Malformed or oversized records are ignored; unexpected fields are stripped.
Storage failure is reported if signing fails, rather than claiming a saved
retry exists. Successful relay publication clears only the exact receipt
confirmed by that response. Unconfirmed publication retains it.

A title/game-over panel offers RECONNECT IN ARCADE or RECONNECT NOSTR.
RETRY SCORE appears only for the original selected account and signs a new
NIP-98 authorisation for the saved payload. Reconnecting never automatically
publishes. Controls have a minimum 44-pixel height, preserve receipts across
reload, and stay hidden during gameplay and name entry.

All 206 unit tests, type checks, client and server builds pass. The browser
recovery flow and 390-pixel-wide controls also pass; see the
[local recovery evidence](evidence/arcade-personal-score-recovery.json).
Multiple saved runs can be selected independently, so a rejected older run does
not prevent retrying another one. Confirmation removes only the selected run.
The browser fixture seeds a public receipt, serves the local build under the
consumer origin, blocks external writes and relay sockets, and simulates only
the claim response. It is not a real earned run, My Signet login or publication.
Client revision `2c6716f` is now published on the new Hetzner server. All six
entry/runtime files match its tested artifact; see the
[public deployment proof](evidence/client-live-2c6716f.json). Hosted unit/build
runs `38092373260` and `38092377053` pass.

An actual published My Signet run now proves earned-score recovery. Closing
the arcade before normal play left a 4,331-point receipt after signing timed
out, with no guest fallback or score HTTP attempt. Explicit approval with the
same account and RETRY SCORE returned HTTP 200, published to six of seven
relays and cleared the receipt. Independent authority/player/score verification
and fresh displays in both arcade editions pass; see
[earned recovery](evidence/hangonfren-earned-recovery-2c6716f.json) and
[display checks](evidence/hangonfren-earned-recovery-ui-2c6716f.json).
No game state or receipt was seeded. The 600 browser origin was mapped to
Hetzner; physical-phone checks remain open.

The existing Deploy workflow now accepts `client_only=true`. That path tests,
builds and archives the exact branch revision, then publishes only static
client files through the existing custom-domain SSH configuration. It skips
GitHub Pages and API jobs. The release metadata includes the full source
revision, and each deployment has its own release directory before switching
the current symlink. No historic-score migration is requested for this fix.

The client-only Actions deployment built and archived the expected revision
but its configured SSH key was rejected before upload (run `38092435973`).
Publication used the established `stall` SSH access: stage the tested artifact
in a new release directory, check the prior release, then atomically switch the
client symlink. That route changed no API configuration and restarted no API.
The Actions deployment credential still needs maintenance; no credential or
hosting policy was changed during this release.

## Submission already in progress

The next client correction shares one pending submission for each personal
account/run, so a retry cannot prompt the signer or send the same claim twice.
The title/game-over recovery control shows submission progress and disables
that run's retry until the original attempt settles. Reconnect remains explicit.
A stalled clock lookup is bounded to 4.2 seconds; the claim and its response
body are bounded to 15 seconds. Timeout retains the public receipt and releases
the attempt for a later explicit retry. Public run details are copied before
asynchronous work.

All 212 local tests, type checks and client/server builds pass. Two new duplicate
approval/claim regressions fail on unchanged source and pass after the fix.
Additional tests cover stalled clock, claim and response-body timeouts, explicit
retry after timeout and immutable run details. The private browser check uses
normal keyboard play, a private canonical parent and simulated local claim
confirmation: the earned 4,293-point run makes exactly one signature and HTTP
request, retry stays disabled throughout approval and HTTP wait, and confirmed
publication clears the receipt. Controls remain at least 44 pixels at 390px.
See [in-flight browser proof](evidence/personal-score-inflight-browser.json).

This candidate is not yet deployed; the public `2c6716f` earned-score recovery
proof above remains a separate result. Hosted runs `38095637805` and `38095640260` pass all 212 tests and builds
at `53113df`; publication of the new correction remains pending. Reliability
checks now archive the exact client with full source revision metadata, so the
checked artifact can be published through established stall access while the
Actions SSH credential needs maintenance.
