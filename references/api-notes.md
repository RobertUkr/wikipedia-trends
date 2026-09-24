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
- After an article is renamed, its history stays under the old title and the new title starts from zero. This appears as a long gap and the `LONG_GAP_POSSIBLE_RENAME` caveat.
- Titles come from Wikidata sitelinks. A language without a sitelink is checked by a search in that edition and classified as `no_article` or `possible_alternative`. An alternative is never used without the user's confirmation.

## Rate limits and etiquette

- Wikimedia's current limits (June 2026): about **10 requests/minute** for a client identified only by IP, about **200 requests/minute** with a compliant User-Agent.
- The CLI sends requests one at a time, at most one every 300 ms, and retries 429 and 5xx with exponential backoff and `Retry-After`.
- Set `WIKIMEDIA_CONTACT` (an email or URL). Without it the User-Agent has no contact and the client can fall into the lower tier.
- Responses are cached in `.cache/` for 24 hours; repeated questions do not hit the network.

## Sources

- https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/concepts/page-views.html
- https://diff.wikimedia.org/2020/10/05/bot-or-not-identifying-fake-traffic-on-wikipedia/
- https://diff.wikimedia.org/2025/10/17/new-user-trends-on-wikipedia/
- https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
