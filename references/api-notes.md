# API notes

Limits of the data source and known problems. Read this when a result looks strange.

## Coverage

- Per-article daily pageviews exist from **2015-07-01**. Earlier data is a different dataset (pagecounts) with bots included and cannot be joined to this one.
- Data for a day is published with a delay of about a day. `research` ends its default range two days back for that reason.

## Agents

- `agent=user` is always used. `spider` (self-identified crawlers) and `automated` (bots detected by heuristics) are excluded.
- The `automated` class exists **from April 2020**. Before that, undeclared bots were counted as users, so series crossing April 2020 can show an artificial drop.
- **2025 reclassification.** From about May 2025 unusually high "human" traffic, mostly from Brazil, turned out to be bots built to evade detection. Wikimedia reclassified the data for **March–August 2025**; after the correction human pageviews were about 8% lower than in the same months of 2024. Trends crossing 2025 include this correction and the general decline Wikimedia attributes to AI answers and social media. The relative trend removes the edition-wide part.
- Bot detection keeps changing. A sudden level shift in all articles of an edition on one date is more likely a classification change than a change of interest; check the edition totals.

## Titles and redirects

- Views of a redirect are counted under the redirect title, **not** under the target article. Alternative spellings are therefore invisible, and the tool undercounts topics with many redirects.
- After an article is renamed, the Pageviews API keeps its history under the old title and the new title starts from zero. The tool follows the rename: it reads the sitelink history of the Wikidata item and takes each title only for the days it named the article (`TITLE_HISTORY_MERGED`).
- When the Wikidata edit does not name the old title (a manual `wbsetsitelink-set`), the old title is looked up among the redirects to the new one, closest in time first, and confirmed by the move log. The sitelink may be updated up to 30 days after the move; the switch is made on the day of the move.
- If a rename still cannot be traced, it shows up as a long gap at the edge of the series; more than 90 days stops the analysis with `ShortHistory`. A former title with no data in the middle of the history counts as missing days, not as zero views, and lowers continuity (`LONG_GAP_POSSIBLE_RENAME`).
- Titles come from Wikidata sitelinks. A language without a sitelink is checked by a search in that edition and classified as `no_article` or `possible_alternative`. An alternative is never used without the user's confirmation.

## Rate limits and etiquette

- Wikimedia's current limits (June 2026): about **10 requests/minute** for a client identified only by IP, about **200 requests/minute** with a compliant User-Agent.
- The CLI sends requests one at a time and retries 429 and 5xx with exponential backoff and `Retry-After`.
- There is no built-in contact. With `WIKIMEDIA_CONTACT` (an email or URL) set, the User-Agent carries it and the CLI sends at most one request every 300 ms. Without it the User-Agent names only the tool, the client is in the lower tier, and the CLI waits 6 s between requests.
- Responses are cached in `.cache/` for 24 hours; repeated questions do not hit the network.

## Sources

- https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/concepts/page-views.html
- https://diff.wikimedia.org/2020/10/05/bot-or-not-identifying-fake-traffic-on-wikipedia/
- https://diff.wikimedia.org/2025/10/17/new-user-trends-on-wikipedia/
- https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
