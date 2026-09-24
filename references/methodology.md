# Methodology

How every number in the CLI output is produced. Read this only when the user asks *how* or *why*.

## Data

- Daily pageviews per article from the Wikimedia Pageviews API, always `agent=user`, `access=all-access`.
- The exact article per language comes from Wikidata sitelinks, never from guessing a title.
- Inside the series, a day the API does not return had no views: the API omits zero days. Such days count as 0 and are reported as `zeroDays` with the `ZERO_VIEW_DAYS` caveat.
- Days missing at the start or end of the range (before the article existed, after the last published day) are gaps. They take the value of the nearest known day and are reported as `missingDays`; they are never treated as zero, so a late-created article does not look like growth from nothing. A gap over 90 days stops the analysis (`ShortHistory`).
- After a rename each title is read only for the days it named the article (see `api-notes.md`). Days of a former title that has no data are gaps too, not zero views.

## Normalisation

- Raw views are divided by the total views of the whole language edition on the same day and expressed as **views per million** (`perMillion`).
- This removes what the edition as a whole is doing (for example Wikipedia losing readers to AI answers) and makes languages comparable. A Polish and a Czech article have audiences an order of magnitude apart; raw counts cannot be compared.
- `relativeTrend` is the trend of the share and is the measure of interest. `absoluteTrend` is the trend of raw views and also contains the edition's own movement.
- A 7-day moving average is kept for charts only. It is never used for fitting, because smoothing creates autocorrelation and narrows intervals.

## Spikes

- A first Theil-Sen fit is made on daily values. Days whose residual has a modified z-score above 3.5 (median and MAD, not mean and standard deviation) are spikes.
- Spikes are replaced by interpolation before the trend is fitted, so a news event does not become a trend. Their dates are kept and shown on the chart.

## Trend

- The repaired daily series is summed into whole weeks. The trend is fitted on the **weekly** series (`granularity: "weekly"`, `n_effective` = number of weeks).
- Reason: daily pageviews are strongly autocorrelated, and the confidence interval of the slope assumes independent points. On synthetic AR(1) data with φ = 0.8 the daily interval is 2.2× too narrow; weekly sums remove most of that.
- The fit is **Theil-Sen**: the median of all pairwise slopes. It ignores up to ~29% outlying points, unlike least squares, which a single spike can tilt.
- The 95% interval comes from the Kendall-statistic ranks of the pairwise slopes.
- The percent comes from a second Theil-Sen fit on the logarithm of the weekly values (a zero week gets half the smallest non-zero value added first). `percentPerYear` = (e^(log-slope × 52.14) − 1) × 100, a compound rate: it can never fall below −100%, whereas a linear slope divided by the starting value can on a short, steeply falling window. The interval endpoints are transformed the same way.
- The log keeps the sign of every pairwise slope, so `up` and `down` are the same as the linear fit would give. The linear fit is still drawn on the chart and used for spikes and stability.
- `recentTrend` is the same fit on the last third of the weekly series. It shows the current direction, which can differ from the average over the whole period.

## Direction

| direction | condition on the 95% interval |
|---|---|
| `up` | lower bound > 0 |
| `down` | upper bound < 0 |
| `flat` | contains 0 and lies within ±5%/year — no meaningful change |
| `inconclusive` | contains 0 and is wider — the data cannot tell |

The direction, not the point estimate, is the verdict. `+6.9%/year` with an interval of `[-4.6; 16]` is `inconclusive`.

## Seasonality and year-over-year

- Seasonality is estimated only with at least 3 full yearly cycles: moving median as trend, then the mean profile by day of the year. Its strength is corrected for the variance a profile removes by chance. With fewer cycles the output is `available: false, reason: INSUFFICIENT_CYCLES`.
- Year-over-year compares the median of the last 365 days with the 365 days before. It needs 730 days.

## Confidence

A vector of five scores, each 0..1, plus an overall `low | medium | high`.

| component | what it measures | reaches 0 when |
|---|---|---|
| volume | median raw views per day, log scale between 20 and 500 | ≤ 20 views/day |
| length | days in range vs 730 wanted | very short series |
| stability | share of 5 subsamples (halves, thirds) keeping the sign of the slope; 1 if the interval already spans zero | signs disagree everywhere |
| outlierShare | 1 − share of spike days ÷ 10% budget | ≥ 10% spike days |
| continuity | missing days; capped at 0.4 for a gap ≥ 14 days | many or long gaps |

Overall score = 0.30 volume + 0.25 length + 0.25 stability + 0.10 outlierShare + 0.10 continuity. `high` ≥ 0.7, `medium` ≥ 0.45.

The verdict may never contradict its own caveats:

- volume score < 0.2 → always `low`;
- `LOW_VOLUME`, `SLOPE_SIGN_UNSTABLE` or `TREND_REVERSAL` present → at most `medium`;
- length score < 0.35 → at most `medium`.

## Caveat codes

| code | meaning |
|---|---|
| `LOW_VOLUME` | too few views per day; counts are mostly noise |
| `SERIES_TOO_SHORT` / `SERIES_SHORTER_THAN_YOY` | range too short for a trend / for year-over-year |
| `INTERVAL_SPANS_ZERO` | the interval spans zero and is wider than the flat band: no growth, decline or stability can be claimed |
| `SLOPE_SIGN_UNSTABLE` | the slope changes sign inside the period |
| `TREND_REVERSAL` | the recent trend points the other way than the whole period, both intervals clear of zero |
| `SPIKES_EXCLUDED` | spike days were removed before fitting |
| `LONG_GAP_POSSIBLE_RENAME` | a gap of 14+ days; the article may have been renamed, split or merged |
| `GAPS_INTERPOLATED` | a few missing days were interpolated |
| `ZERO_VIEW_DAYS` | days inside the series with no views; the API omits them and they count as 0 |
| `RAW_COUNTS_NOT_COMPARABLE` | edition totals were missing; the series is raw and not comparable across languages |
| `ABSOLUTE_VS_RELATIVE` | raw views and share of edition traffic point in different directions |
| `EDITION_TRAFFIC_DECLINING` | raw views fall while the share is flat: the edition is shrinking, not interest in the topic |
| `WEEKLY_AGGREGATION` | the fit uses weekly sums |
| `ALL_LANGUAGES_DECLINING` | every compared language declines; rank 1 is the slowest decline |
| `LOW_CONFIDENCE_LANGUAGES`, `SPANS_ZERO_LANGUAGES`, `SPIKES_BY_LANGUAGE`, `MIXED_UNITS` | summaries of the above across languages |
| `EDITION_IS_NOT_A_COUNTRY` | see interpretation.md |

## Ranking in `compare`

`perspective = 0.5·growth + 0.3·level + 0.2·confidence`. Growth (relative trend) and level (median per million) are min-max scaled **across the compared languages only**, so the score ranks them against each other and says nothing in absolute terms.

The order in `RECOMMEND_ORDER` ("what to check next") is this ranking. It is given even when no language can be recommended for a launch.
