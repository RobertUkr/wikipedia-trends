---
name: wikipedia-trends
description: Measures interest in a topic from Wikipedia pageviews and compares language editions. Use for product questions such as "is interest in X growing", "how much can we trust that", "which language should we launch in next". Not for sales, prices or countries. Load this skill before anything else: it holds the one command to run. There is no npm script.
---

# wikipedia-trends

The CLI does all the maths. You run one command, read its JSON and repeat it.

`<dir>` below is this skill's base directory. Always call the CLI by its absolute path, as one command. Never `cd` first — it is blocked.

## Run one command: research

```
node <dir>/dist/cli.js research --topic "<topic>" --lang <language of the topic words> --langs <editions> [--years 2] [--locale uk]
```

If that fails because `dist/cli.js` is missing, run `<dir>/scripts/setup.sh` once and repeat.

- `--topic`: the subject as a Wikipedia article would be titled — "астрономія", not "курс з астрономії". For an activity ("вивчення англійської") pass its subject concept.
- `--langs`: Wikipedia editions to measure, e.g. `uk`, `pl,cs`, `en,de,uk`; at most 8.
- `--lang`: language the topic is written in (`uk` for "астрономія", `en` for "astronomy").
- `--years`: leave it out unless the user names a period ("за два роки" → `--years 2`). Use 3 only if they ask about seasonality.
- `--locale`: `uk` if the user writes Ukrainian, otherwise `en`.

It resolves the topic, fetches data, analyses, compares and writes a PDF. Do not call other commands to build this yourself.

## Scenarios

| user asks | command |
|---|---|
| compare topic X in two languages over two years | `research --topic "X" --lang uk --langs pl,cs --years 2` |
| is interest in X growing in uk, can we trust it | `research --topic "X" --lang uk --langs uk` |
| compare editions, which audiences to explore next | `research --topic "X" --lang uk --langs en,de,pl,uk` |
| follow-up: other editions, period or meaning | same command plus `--qid` from the previous JSON, keep `--topic`, change only that flag |

Every follow-up is a new `research` run, then its `summary` is your answer. Asked about one language from a previous answer → rerun with `--langs` set to that language. Never answer a follow-up by comparing or explaining numbers yourself. Follow-ups are cheap: data is cached for 24 hours.

## Your answer is `summary`

Whatever the `status`, paste `summary` whole, as is, and write nothing else — no intro, no conclusion, no sentence of your own. It already contains the verdict with its numbers, the trust assessment, the recommendation, every language, every caveat and the PDF path.

- `status: needs_choice`: `summary` lists candidate topics and asks which one. Paste it and wait. When the user picks, rerun with `--qid <qid>` instead of `--topic`.
- `ok: false`: tell the user `error.message`. Retry at most once.

## Hard rules

- NEVER answer from this skill's files — source, tests, README or examples hold fixtures, not data. Numbers come only from a CLI run you made now. If the CLI cannot run, say so and stop.
- NEVER compute, estimate, round, average or convert a number. Never write a number that is not inside `summary`.
- NEVER judge a trend by eye, from the chart or from the percent alone. `direction` is the verdict: `up`, `down`, `flat` (stable), `inconclusive` (the data cannot tell — not growth, not decline, even if the percent is positive).
- NEVER compare raw view counts between languages. Only per-million figures and relative trends are comparable.
- Pageviews measure attention, not willingness to pay. A language edition is not a country.

## Other commands

Use only if the user asks for one step specifically.

| command | does | example |
|---|---|---|
| `resolve` | topic → Wikidata QID and article titles | `resolve --topic "X" --lang uk --langs pl,cs` |
| `fetch` | daily views to a file | `fetch --qid Q333 --langs uk --from 2024-01-01 --to 2025-12-31` |
| `analyze` | trend and confidence, one language | `analyze --qid Q333 --lang uk --from … --to … --locale uk` |
| `compare` | ranking of several languages | `compare --qid Q333 --langs uk,pl --from … --to … --locale uk` |
| `report` | PDF from an existing analysis | `report --qid Q333 --langs uk,pl --from … --to … --locale uk` |

## References — read only when asked how or why

- `references/methodology.md`: how trend, direction and confidence are computed; every caveat code.
- `references/interpretation.md`: what a result does not mean.
- `references/api-notes.md`: data limits, bot reclassifications, redirects, rate limits.
