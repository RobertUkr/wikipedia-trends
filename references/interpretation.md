# Interpretation

What a result means and, more often, what it does not. Read this when the user wants to act on a result.

## What the tool measures

Attention: how often people open one Wikipedia article, as a share of everything read in that language edition.

## What it does not measure

- **Willingness to pay.** Reading about a topic is not demand for a product. Use it as one signal next to search, sales and survey data.
- **Countries.** A language edition is not a country. Readers of en.wikipedia live everywhere; many Ukrainians read ru or en; Czech and Slovak readers overlap.
- **The topic as a whole.** Only one article per language is measured. Interest that goes to neighbouring articles, redirects or other sites is invisible.
- **Absolute market size across languages.** Per-million shares compare how prominent a topic is inside each edition, not how many people care. A small edition with a high share is not a large market.

## Reading a trend

- Read `direction` first. `up`/`down` are claims; `flat` means no meaningful change; `inconclusive` means the data cannot tell. Never turn an `inconclusive` +6.9% into "growing".
- Read `recentTrend` next. For a launch decision the current direction matters more than the three-year average. A `TREND_REVERSAL` caveat means the average points the wrong way.
- `absoluteTrend` falling while `relativeTrend` is flat means the edition is losing readers, not the topic.
- Seasonality is only reported with 3+ years of data. Two years cannot separate a trend from a yearly cycle.

## Reading confidence

- `low`: do not base a decision on it. Usually too few views per day.
- `medium`: usable as a direction, not as a number.
- `high`: the direction is robust inside this data. It is still attention, not demand.
- The five components say *why*. Quote the weak one.

## Reading a comparison

- Only per-million figures and relative trends are comparable across languages. Never compare raw views.
- The ranking is relative to the compared set. Adding or removing a language changes the scores.
- If every language declines, rank 1 is the slowest decline. Do not present it as growth.
- A language missing from `languages` and present in `unavailable` has no article. That is a finding: the topic is not covered there, which can be an opportunity or a sign of low relevance.

## Recommending a language

Recommend a language only if its `direction` is `up` and its confidence is not `low`. Otherwise say that no language can be recommended on this evidence, and say why.
