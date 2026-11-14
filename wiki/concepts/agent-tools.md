---
type: concept
created: 2026-09-11
updated: 2026-09-11
sources: [code, log]
---
# GloryMap as tools an agent can call

`mcp/glorymap-server.mjs`. Six tools over the deployed API, for a Claude agent that plans
somebody's day. Related: [[trip-agent-bridge]], [[queue-review]], [[studio-lots]].

## The open question, answered

[[trip-agent-bridge]] built `POST /api/trip/plan` on 10.09 and deliberately **did not guess
the transport**, because the four candidates — an MCP session, a third-party product, a
custom GPT, something still being written — want four different wrappers, and guessing is
the expensive kind of wrong.

The owner answered it on 11.09: **his trip agent is a Claude agent.** So the wrapper is MCP,
and the guess that was avoided cost nothing.

## It calls the API; it does not reimplement it

Every honesty rule this project has lives in the routes: a candidate labelled as a
candidate, a studio lot flagged as one, a source named on every stop, a coordinate that may
be missing. A server that queried Supabase directly would re-derive all of it and drift —
**and the drift would be invisible**, because an agent cannot see that the pin it was handed
should have been hollow.

Read-only, and it uses no credential: the routes it calls are the ones the browser calls.
That also keeps it clear of #191 — an agent acting for the owner is not a third party, and
nothing here redistributes anything the site does not already show.

## The six tools

| tool | answers |
|---|---|
| `places_near` | what is around this point, nearest first |
| `places_along_route` | what is worth stopping for along a line I am walking |
| `film_places` | everything we hold about one film |
| `place_details` | every film with a fact at one place, and its evidence |
| `search_titles` | a name → an id |
| `plan_day` | ordered stops, a walking route, and how much of it is verified |

`plan_day` takes an optional `library`, which is how the traveller's own films reach it
without ever being stored: the titles are compared in memory and written nowhere
([[personal-library]]).

## Every answer carries the caveat as words

A hollow pin is read as unverified at a glance. **An agent has no pin.** So the labelling
that the map does with shape, this does with text — `status`, `said_by`, `source_url`,
`studio_lot` on every row, and a `note` on every response saying what `pending` means and
that a lot is somewhere you cannot walk in. In Los Angeles that is not a corner case: the
graph holds **one** verified place against 5,266 queue rows.

## One rule deliberately looser here than in the graph

`namesMatch` refuses **"Frolic Room"** against **"Frolic Room, Hollywood Boulevard,
Hollywood"** — it allows the longer name only one extra word. That is correct where it is
used, which is merging rows INTO the graph, where a wrong merge is a false claim about where
something happened.

Here the case is narrower and the risk is smaller: MovieLocations appends the address to the
name as a matter of format, and this is a **list handed to an agent, not a row written
anywhere**. A wrong grouping shows two films under one heading and is visible in the
payload; a wrong merge in the graph is not. So `sameSpotName` adds one rule — a
multi-word name that is a prefix of the other, within 150 m — and nothing is written.

Measured on the first real call: six stops along Hollywood Boulevard were four places.
Frolic Room went from two entries of one film to one entry of two (*L.A. Confidential*,
*Once Upon a Time… in Hollywood*); Grauman's Chinese Theatre from 21 + 2 to 22.

**El Capitan Theatre and "El Capitan Theater" stay separate**, and should: that is a real
spelling difference, and matching across it is the fuzzy comparison this project refuses.

## Running it

```bash
claude mcp add glorymap -- node /path/to/mcp/glorymap-server.mjs
```

`GLORYMAP_URL` overrides the target; it defaults to production, so the agent works without
a local server running.
