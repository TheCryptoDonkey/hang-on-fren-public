# Gamestr listing submission

Everything gamestr's quick-start step 5 ("Add Game Metadata — contact us to get
your game listed") asks for, ready to send. Scores publish to Gamestr's main
and test relays in the spec's kind-30762 shape, game-signed.

## Metadata

| Field | Value |
|---|---|
| **Name** | Hang On, Fren |
| **Game identifier** (`game` tag) | `hangonfren` |
| **Description** | Riviera Vespa arcade racer — a 42 km grand tour across ten regions, one finish line. Grab the roses, sink the beers (carefully), mind the fly agaric. |
| **Play URL** | https://hang-on-fren.playechoseven.com/ |
| **Icon** (512×512) | https://hang-on-fren.playechoseven.com/icons/icon-512.png |
| **Banner / title art** | https://hang-on-fren.playechoseven.com/art/title-art-orig.png |
| **Genres** | arcade, racing, casual |
| **Platform** | web (desktop + mobile, PWA) |

## Score signing (for the verified badge)

| Field | Value |
|---|---|
| **Signing model** | Game developer pubkey — a server-side claim service validates each run and signs the kind-30762 with the game key; players never sign scores |
| **Game dev npub** | `npub12ycjmydvdlrwx5q9cgm9dv80lg2eez0ykg09dcz56kh49tw8cfeqnap6qw` |
| **Game dev pubkey (hex)** | `51312d91ac6fc6e35005c23656b0effa159c89e4b21e56e054d5af52adc7c272` |
| **Event shape** | kind 30762, `d` = `hangonfren:<player-pubkey>:<level>`, `state` = `final`, player attributed via `p` tag |
| **Relays published to** | main.relay.gamestr.io, test.relay.gamestr.io, relay.trotters.cc, nos.lol, relay.damus.io, relay.nostr.band, relay.primal.net, relay.ditto.pub |

## Ready-to-send message

> Hi — I'd like to list my game on Gamestr.
>
> **Hang On, Fren** (game id `hangonfren`) is a free web-based Riviera Vespa
> arcade racer: a 42 km grand tour across ten regions with roses to grab and a
> finish line to chase. Play at https://hang-on-fren.playechoseven.com/
>
> Scores are game-dev signed (kind 30762, per your spec) by
> `npub12ycjmydvdlrwx5q9cgm9dv80lg2eez0ykg09dcz56kh49tw8cfeqnap6qw` — a
> server-side claim service validates each run before signing, so I'd like
> that pubkey registered for the verified badge.
>
> Icon: https://hang-on-fren.playechoseven.com/icons/icon-512.png
> Banner: https://hang-on-fren.playechoseven.com/art/title-art-orig.png
> Genres: arcade, racing, casual
