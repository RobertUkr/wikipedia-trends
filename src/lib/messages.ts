import type { Message, MessageCode, MessageParam } from '../types.js';

export type Locale = 'en' | 'uk';

export const LOCALES: Locale[] = ['en', 'uk'];
export const DEFAULT_LOCALE: Locale = 'en';

const EN: Record<MessageCode, string> = {
  TRUST_LOW:
    'Trust ({lang}): confidence is low; the weakest part is {weakest}: {detail}. Do not base a decision on this ' +
    'alone.',
  TRUST_MEDIUM:
    'Trust ({lang}): confidence is medium; the weakest part is {weakest}: {detail}. Usable as a direction, not as ' +
    'an exact number.',
  TRUST_HIGH:
    'Trust ({lang}): confidence is high; the weakest part is {weakest}: {detail}. The direction is robust in this ' +
    'data, but it measures attention, not demand.',
  COMPONENT_VOLUME: 'traffic volume',
  COMPONENT_LENGTH: 'series length',
  COMPONENT_STABILITY: 'stability of the direction',
  COMPONENT_OUTLIERS: 'share of spike days',
  COMPONENT_CONTINUITY: 'continuity of the data',
  RECOMMEND_LANGUAGE:
    'Recommendation: {lang} — interest is growing ({percent}%/year relative to edition traffic), confidence ' +
    '{confidence}.',
  RECOMMEND_NONE_ALL_DOWN:
    'Recommendation: no language can be recommended on this evidence — interest declines in all of them; {leader} ' +
    'declines slowest ({percent}%/year), which is still a decline, not growth.',
  RECOMMEND_NONE_LOW_CONFIDENCE:
    'Recommendation: interest grows only where confidence is low ({langs}), so no language can be recommended on ' +
    'this evidence.',
  RECOMMEND_ORDER:
    'What to check next, most promising first: {order}. Criterion: growth 50%, level of attention (per million ' +
    'edition views) 30%, confidence 20% — relative to these languages only.',
  RECOMMEND_NONE_NO_DIRECTION:
    'Recommendation: no language shows growing interest, so no language can be recommended on this evidence.',
  RESEARCH_CANDIDATE: '{qid}: {label} — {description}',
  RESEARCH_CANDIDATE_COVERAGE: '(articles in {langs} of {requested})',
  DIRECTION_UP: 'growing',
  DIRECTION_DOWN: 'declining',
  DIRECTION_FLAT: 'stable',
  DIRECTION_INCONCLUSIVE: 'no clear direction',
  CONFIDENCE_LOW: 'low',
  CONFIDENCE_MEDIUM: 'medium',
  CONFIDENCE_HIGH: 'high',
  HEADLINE_SINGLE:
    'Interest in {topic} ({lang}): {direction} over the period ({percent}%/year, 95% [{low}; {high}]), {recent} ' +
    'since {since} ({recentPercent}%/year); confidence {confidence}.',
  HEADLINE_GROWING:
    'Interest in {topic} is growing in {langs}; {leader} leads at {percent}%/year relative to edition traffic, ' +
    '{recent} since {since}, confidence {confidence}.',
  HEADLINE_ALL_DOWN:
    'Interest in {topic} is declining in every compared language ({langs}); {leader} declines slowest at ' +
    '{percent}%/year, {recent} since {since}.',
  HEADLINE_NO_CLEAR_DIRECTION:
    'The data shows no clear direction of interest in {topic} across {langs}, so no language can be recommended on ' +
    'this evidence.',
  HEADLINE_MIXED_DOWN: 'Interest in {topic} is declining in {down}; in {others} there is no clear change.',
  RESEARCH_LANGUAGE_LINE:
    '{lang}: {direction} ({percent}%/yr, 95% [{low}; {high}]); since {since}: {recent} ({recentPercent}%/yr); ' +
    '{level} per million edition views; confidence {confidence}',
  RESEARCH_NEEDS_CHOICE: '"{topic}" can mean several things. Which one should be analysed?',
  RESEARCH_SEARCH_MATCHES:
    '"{topic}" is not the name of a Wikipedia article. These {lang}.wikipedia articles match it best — which one ' +
    'should be analysed?',
  RESEARCH_NO_ARTICLES: 'None of the requested language editions ({langs}) has an article about "{topic}".',
  RESEARCH_UNAVAILABLE_TITLE: 'Languages without data',
  RESEARCH_REPORT_LINE: 'PDF report: {path}',
  RESEARCH_REPORT_LINE_LANGS: 'PDF report, all editions studied for this topic ({langs}): {path}',
  RESEARCH_MORE_CAVEATS: '{count} more caveat(s) are in the PDF.',
  REPORT_SUBTITLE: 'Languages: {langs} · {from} — {to}',
  REPORT_TABLE_LANG: 'Language',
  REPORT_TABLE_RELATIVE: 'Trend, share of edition',
  REPORT_TABLE_CI: '95% interval',
  REPORT_TABLE_RECENT: 'Recent trend',
  REPORT_TABLE_MEDIAN: 'Median per million',
  REPORT_TABLE_CONFIDENCE: 'Confidence',
  REPORT_TREND_CELL: '{direction} ({percent}%/yr)',
  REPORT_CAVEATS_TITLE: 'Caveats',
  REPORT_MORE_CAVEATS: '{count} more caveat(s) are in the artifact file.',
  REPORT_LANG_CAVEAT: '{lang}: {text}',
  REPORT_CHART_EXCLUDED: 'Not plotted, raw counts only: {langs}.',
  REPORT_FOOTER_SOURCE:
    'Source: Wikimedia Pageviews API (agent=user, access=all-access), normalised by total edition traffic.',
  REPORT_FOOTER_GENERATED: 'Generated {date}',
  REPORT_FOOTER_RANGE: 'Range {from} — {to} ({days} days)',
  REPORT_FOOTER_MISSING: 'Missing days, interpolated: {detail}',
  REPORT_FOOTER_NO_MISSING: 'No missing days.',
  REPORT_FOOTER_ZERO_DAYS: 'Days with zero views, counted as 0: {detail}',
  REPORT_CONFIDENCE_CELL: '{level} ({score})',
  REPORT_CONFIDENCE_CAPPED: '{level} (lowered)',
  CHART_Y_LABEL: 'views per million of edition traffic',
  CHART_LEGEND_RAW: 'daily',
  CHART_LEGEND_SMOOTHED: '7-day average',
  CHART_LEGEND_TREND: 'trend ±95%',
  CHART_LEGEND_OUTLIERS: 'spike days',
  CHART_RECENT_MARKER: 'recent period',
  CHART_NO_DATA: 'no data',
  LOW_VOLUME:
    'Traffic is around {median} views a day. Below {floor} a day the counts are mostly noise; a trend becomes a ' +
    'usable signal closer to {ceiling} a day, so this one should not be read as a product signal on its own.',
  SERIES_TOO_SHORT: 'The series covers only {days} days, which is too short to tell a trend from a seasonal swing.',
  SERIES_SHORTER_THAN_YOY: 'The series covers {days} days; a year-over-year comparison needs {target}.',
  INTERVAL_SPANS_ZERO:
    'The 95% interval spans zero, so the data supports neither growth nor decline, only "no clear change".',
  SLOPE_SIGN_UNSTABLE:
    'The slope changes sign on {flipped} of {total} subsamples, so the direction is not stable inside the period.',
  SPIKES_EXCLUDED:
    '{days} day(s) were excluded as spikes; the trend describes the remaining ordinary days, not the attention peaks.',
  LONG_GAP_POSSIBLE_RENAME:
    'Data is missing for up to {days} days in a row. Besides an API gap this can mean the article was renamed, ' +
    'split or merged, which breaks the comparison.',
  TITLE_HISTORY_MERGED:
    'The article was renamed during the period ({titles}); views of each title are taken for the time it named ' +
    'this article.',
  ZERO_VIEW_DAYS: '{days} day(s) had no views at all; the API omits such days and they count as zero.',
  SHORT_HISTORY:
    'data under «{title}» exists only from {first} to {last}: the article was probably renamed, created or merged, so ' +
    'its trend over the period cannot be measured',
  RAW_COUNTS_NOT_COMPARABLE:
    'Project totals were unavailable, so the series is raw view counts. Values are not comparable across editions.',
  WEEKLY_AGGREGATION:
    'The trend is fitted on {weeks} weekly sums rather than {days} daily values, because daily pageviews are ' +
    'autocorrelated and a daily fit reports an interval narrower than the real uncertainty.',
  ABSOLUTE_VS_RELATIVE: 'Raw views {absolute}%/year, share of edition traffic {relative}%/year.',
  TWO_TRENDS_EXPLAINED:
    'The share of edition traffic is the measure of interest in the topic; raw views also carry whatever the ' +
    'edition as a whole is doing.',
  EDITION_TRAFFIC_DECLINING:
    'Raw views fall {absolute}%/year while the share of edition traffic holds at {relative}%/year. That pattern means ' +
    'the edition is losing readers overall, not that interest in this topic is fading.',
  TREND_REVERSAL:
    'The whole period trends {overall}%/year but the last {weeks} weeks trend {recent}%/year, and neither interval ' +
    'contains zero. A straight line over the whole range does not describe the current direction.',
  NOTE_TREND_REVERSAL: 'recent direction is opposite to the period trend',
  DETAIL_VOLUME: 'median {median} views/day against a {floor}-{ceiling} noise-to-signal band',
  DETAIL_LENGTH: '{days} days of {target} wanted for a year-over-year statement',
  DETAIL_STABILITY: '{agreeing} of {total} subsamples (halves and thirds) keep the sign of the full-series slope',
  DETAIL_STABILITY_SPANS_ZERO:
    'the full-series interval spans zero, so no direction is claimed and subsample agreement is not required',
  DETAIL_STABILITY_TOO_SHORT: 'series too short to split into subsamples',
  DETAIL_OUTLIERS: '{days} of {total} days removed as spikes, budget {budget}%',
  DETAIL_CONTINUITY: '{missing} missing days, longest gap {longest} days',
  ALL_LANGUAGES_DECLINING:
    'Every compared language is declining over this period. Rank 1 means the slowest decline, not growth, and the ' +
    'ranking says nothing about whether the topic is worth entering at all.',
  LOW_CONFIDENCE_LANGUAGES: 'Low confidence for: {langs}. Their positions in the ranking carry little weight.',
  SPANS_ZERO_LANGUAGES:
    'The trend interval spans zero for: {langs}. For these the data shows no direction, not stability.',
  SPIKES_BY_LANGUAGE: 'Spike days excluded before fitting: {detail}.',
  EDITION_IS_NOT_A_COUNTRY:
    'A language edition is not a country, and pageviews are a proxy for attention, not for willingness to pay.',
  MIXED_UNITS:
    'At least one language fell back to raw view counts because project totals were unavailable, so the ranking ' +
    'mixes units.',
  NOTE_SPANS_ZERO: 'interval spans zero: no clear direction',
  NOTE_LOW_CONFIDENCE: 'low confidence: treat the position as indicative only',
  NOTE_RAW_COUNTS: 'raw counts: not comparable across editions',
  NOTE_NO_RESERVATIONS: 'no reservations beyond the shared caveats',
  NO_ARTICLE_WITH_MENTIONS:
    '{project} mentions "{query}" in {hits} article(s) but has no article about the topic itself',
  NO_ARTICLE_NO_HITS: '{project} has no article and no search hits for "{query}"',
  POSSIBLE_ALTERNATIVE:
    '{project} has no article linked to this topic, but "{title}" has a similar title. Unconfirmed: ask the user ' +
    'before treating it as the same topic.',
  SEARCH_FAILED: 'Search on {project} failed: {error}',
  NO_PAGEVIEWS_DATA:
    '{project} has the article "{title}" but the Pageviews API returns no data between {from} and {to}',
  LANGUAGE_FETCH_FAILED: '{code}: {message}',
  NO_SITELINK: '{qid} has no {lang}.wikipedia article',
  YOY_TOO_SHORT: 'year-over-year needs {required} days, the series has {days}',
  YOY_ZERO_BASE: 'the earlier year has a median of zero',
  INSUFFICIENT_CYCLES:
    'seasonality needs {required} full cycles to be identifiable, the series has {cyclesAvailable}',
};

const UK: Record<MessageCode, string> = {
  TRUST_LOW:
    'Довіра ({lang}): достовірність низька, найслабша складова — {weakest}: {detail}. Самостійно рішення на цьому ' +
    'ухвалювати не можна.',
  TRUST_MEDIUM:
    'Довіра ({lang}): достовірність середня, найслабша складова — {weakest}: {detail}. Придатне як напрямок, а не ' +
    'як точне число.',
  TRUST_HIGH:
    'Довіра ({lang}): достовірність висока, найслабша складова — {weakest}: {detail}. Напрямок стійкий у межах ' +
    'цих даних, але це увага, а не попит.',
  COMPONENT_VOLUME: 'обсяг трафіку',
  COMPONENT_LENGTH: 'довжина ряду',
  COMPONENT_STABILITY: 'стабільність напрямку',
  COMPONENT_OUTLIERS: 'частка днів-сплесків',
  COMPONENT_CONTINUITY: 'неперервність даних',
  RECOMMEND_LANGUAGE:
    'Рекомендація: {lang} — інтерес зростає ({percent}%/рік відносно трафіку розділу), достовірність — {confidence}.',
  RECOMMEND_NONE_ALL_DOWN:
    'Рекомендація: на цих даних жодну мову рекомендувати не можна — інтерес падає в усіх; найповільніше падає ' +
    '{leader} ({percent}%/рік), але це спад, а не ріст.',
  RECOMMEND_NONE_LOW_CONFIDENCE:
    'Рекомендація: інтерес зростає лише там, де достовірність низька ({langs}), тож рекомендувати мову на цій ' +
    'підставі не можна.',
  RECOMMEND_ORDER:
    'Кого перевіряти далі, від найперспективнішого: {order}. Критерій: зростання 50%, рівень уваги (на млн переглядів ' +
    'розділу) 30%, достовірність 20% — лише відносно цих мов.',
  RECOMMEND_NONE_NO_DIRECTION:
    'Рекомендація: жодна мова не показує зростання інтересу, тож рекомендувати мову на цій підставі не можна.',
  RESEARCH_CANDIDATE: '{qid}: {label} — {description}',
  RESEARCH_CANDIDATE_COVERAGE: '(статті є в: {langs}; із запитаних {requested})',
  DIRECTION_UP: 'зростає',
  DIRECTION_DOWN: 'падає',
  DIRECTION_FLAT: 'стабільний',
  DIRECTION_INCONCLUSIVE: 'без ясного напрямку',
  CONFIDENCE_LOW: 'низька',
  CONFIDENCE_MEDIUM: 'середня',
  CONFIDENCE_HIGH: 'висока',
  HEADLINE_SINGLE:
    'Інтерес до «{topic}» ({lang}): за період — {direction} ({percent}%/рік, 95% [{low}; {high}]), з {since} — ' +
    '{recent} ({recentPercent}%/рік); достовірність — {confidence}.',
  HEADLINE_GROWING:
    'Інтерес до «{topic}» зростає в: {langs}; лідер — {leader}, {percent}%/рік відносно трафіку розділу, ' +
    'з {since} — {recent}, достовірність — {confidence}.',
  HEADLINE_ALL_DOWN:
    'Інтерес до «{topic}» падає в усіх порівнюваних мовах ({langs}); найповільніше — {leader}, {percent}%/рік, ' +
    'з {since} — {recent}.',
  HEADLINE_NO_CLEAR_DIRECTION:
    'Дані не показують ясного напрямку інтересу до «{topic}» у мовах {langs}, тож жодну мову на цій підставі ' +
    'рекомендувати не можна.',
  HEADLINE_MIXED_DOWN: 'Інтерес до «{topic}» падає в: {down}; у {others} явної зміни немає.',
  RESEARCH_LANGUAGE_LINE:
    '{lang}: {direction} ({percent}%/рік, 95% [{low}; {high}]); з {since} — {recent} ({recentPercent}%/рік); ' +
    '{level} на млн переглядів розділу; достовірність — {confidence}',
  RESEARCH_NEEDS_CHOICE: '«{topic}» може означати кілька різних тем. Яку з них аналізувати?',
  RESEARCH_SEARCH_MATCHES:
    '«{topic}» — не назва статті у Вікіпедії. Ось статті {lang}.wikipedia, які найкраще відповідають запиту, — яку з ' +
    'них аналізувати?',
  RESEARCH_NO_ARTICLES: 'Жоден із запитаних мовних розділів ({langs}) не має статті про «{topic}».',
  RESEARCH_UNAVAILABLE_TITLE: 'Мови без даних',
  RESEARCH_REPORT_LINE: 'PDF-звіт: {path}',
  RESEARCH_REPORT_LINE_LANGS: 'PDF-звіт, усі розділи, які досліджували для цієї теми ({langs}): {path}',
  RESEARCH_MORE_CAVEATS: 'Решта застережень ({count}) — у PDF.',
  REPORT_SUBTITLE: 'Мови: {langs} · {from} — {to}',
  REPORT_TABLE_LANG: 'Мова',
  REPORT_TABLE_RELATIVE: 'Тренд, частка розділу',
  REPORT_TABLE_CI: '95% інтервал',
  REPORT_TABLE_RECENT: 'Поточний тренд',
  REPORT_TABLE_MEDIAN: 'Медіана на млн',
  REPORT_TABLE_CONFIDENCE: 'Достовірність',
  REPORT_TREND_CELL: '{direction} ({percent}%/рік)',
  REPORT_CAVEATS_TITLE: 'Застереження',
  REPORT_MORE_CAVEATS: 'Решта застережень ({count}) — у файлі артефакту.',
  REPORT_LANG_CAVEAT: '{lang}: {text}',
  REPORT_CHART_EXCLUDED: 'Не показано на графіку, лише сирі перегляди: {langs}.',
  REPORT_FOOTER_SOURCE:
    'Джерело: Wikimedia Pageviews API (agent=user, access=all-access), нормалізовано на загальний трафік розділу.',
  REPORT_FOOTER_GENERATED: 'Згенеровано {date}',
  REPORT_FOOTER_RANGE: 'Діапазон {from} — {to} ({days} днів)',
  REPORT_FOOTER_MISSING: 'Пропущені дні, інтерпольовано: {detail}',
  REPORT_FOOTER_NO_MISSING: 'Пропущених днів немає.',
  REPORT_FOOTER_ZERO_DAYS: 'Дні без переглядів, враховано як 0: {detail}',
  REPORT_CONFIDENCE_CELL: '{level} ({score})',
  REPORT_CONFIDENCE_CAPPED: '{level} (знижено)',
  CHART_Y_LABEL: 'перегляди на мільйон трафіку розділу',
  CHART_LEGEND_RAW: 'щоденно',
  CHART_LEGEND_SMOOTHED: 'середнє за 7 днів',
  CHART_LEGEND_TREND: 'тренд ±95%',
  CHART_LEGEND_OUTLIERS: 'дні-сплески',
  CHART_RECENT_MARKER: 'поточний період',
  CHART_NO_DATA: 'немає даних',
  LOW_VOLUME:
    'Трафік — близько {median} переглядів на день. Нижче {floor} на день це переважно шум; сигналом тренд стає ' +
    'ближче до {ceiling} на день, тож самостійно цей результат не можна читати як продуктовий сигнал.',
  SERIES_TOO_SHORT: 'Ряд охоплює лише {days} днів — замало, щоб відрізнити тренд від сезонного коливання.',
  SERIES_SHORTER_THAN_YOY: 'Ряд охоплює {days} днів; для порівняння рік-до-року потрібно {target}.',
  INTERVAL_SPANS_ZERO:
    '95% інтервал перетинає нуль, тож дані не підтверджують ані ріст, ані спад — лише «явної зміни немає».',
  SLOPE_SIGN_UNSTABLE:
    'Нахил міняє знак на {flipped} з {total} підвибірок, тож напрямок нестабільний усередині періоду.',
  SPIKES_EXCLUDED:
    '{days} дн. виключено як сплески; тренд описує решту звичайних днів, а не піки уваги.',
  LONG_GAP_POSSIBLE_RENAME:
    'Дані відсутні до {days} днів поспіль. Крім прогалини в API це може означати, що статтю перейменували, ' +
    'розділили або обʼєднали — тоді порівняння ламається.',
  TITLE_HISTORY_MERGED:
    'Статтю за період перейменовували ({titles}); перегляди кожної назви взято лише за час, коли вона була ' +
    'назвою цієї статті.',
  ZERO_VIEW_DAYS: '{days} дн. без жодного перегляду: API таких днів не повертає, вони враховані як нуль.',
  SHORT_HISTORY:
    'дані під назвою «{title}» є лише з {first} по {last}: статтю, ймовірно, перейменували, створили чи обʼєднали, ' +
    'тож тренд за період виміряти не можна',
  RAW_COUNTS_NOT_COMPARABLE:
    'Загальний трафік розділу недоступний, тому ряд — сирі перегляди. Значення непорівнянні між розділами.',
  WEEKLY_AGGREGATION:
    'Тренд підігнано на {weeks} тижневих сумах, а не на {days} денних значеннях: денні перегляди автокорельовані, ' +
    'і підгонка на них дає інтервал вужчий за реальну невизначеність.',
  ABSOLUTE_VS_RELATIVE: 'Сирі перегляди — {absolute}%/рік, частка трафіку розділу — {relative}%/рік.',
  TWO_TRENDS_EXPLAINED:
    'Частка трафіку розділу — це міра інтересу до теми; сирі перегляди несуть ще й те, що відбувається з розділом ' +
    'загалом.',
  EDITION_TRAFFIC_DECLINING:
    'Сирі перегляди падають на {absolute}%/рік, а частка трафіку розділу тримається на {relative}%/рік. Це означає, ' +
    'що читачів втрачає розділ загалом, а не що згасає інтерес саме до теми.',
  TREND_REVERSAL:
    'За весь період тренд {overall}%/рік, а за останні {weeks} тижнів — {recent}%/рік, і жоден інтервал не містить ' +
    'нуля. Пряма за весь діапазон не описує поточний напрямок.',
  NOTE_TREND_REVERSAL: 'поточний напрямок протилежний трендові періоду',
  DETAIL_VOLUME: 'медіана переглядів на день — {median} при смузі шум-сигнал {floor}-{ceiling}',
  DETAIL_LENGTH: '{days} днів із {target} потрібних для висновку рік-до-року',
  DETAIL_STABILITY: '{agreeing} з {total} підвибірок (половини й третини) зберігають знак нахилу всього ряду',
  DETAIL_STABILITY_SPANS_ZERO:
    'інтервал усього ряду перетинає нуль, тож напрямок не заявляється і згода підвибірок не потрібна',
  DETAIL_STABILITY_TOO_SHORT: 'ряд закороткий, щоб розбити його на підвибірки',
  DETAIL_OUTLIERS: '{days} із {total} днів прибрано як сплески, бюджет {budget}%',
  DETAIL_CONTINUITY: 'відсутніх днів — {missing}, найдовша прогалина — {longest} дн.',
  ALL_LANGUAGES_DECLINING:
    'Усі порівнювані мови за цей період падають. Ранг 1 означає найповільніше падіння, а не ріст, і рейтинг ' +
    'нічого не каже про те, чи варто взагалі заходити в цю тему.',
  LOW_CONFIDENCE_LANGUAGES: 'Низька достовірність для: {langs}. Їхні позиції в рейтингу важать мало.',
  SPANS_ZERO_LANGUAGES:
    'Інтервал тренду перетинає нуль для: {langs}. Для них дані показують відсутність напрямку, а не стабільність.',
  SPIKES_BY_LANGUAGE: 'Дні-сплески, виключені перед підгонкою: {detail}.',
  EDITION_IS_NOT_A_COUNTRY:
    'Мовний розділ не дорівнює країні, а перегляди — проксі уваги, а не готовності платити.',
  MIXED_UNITS:
    'Принаймні одна мова відкотилася на сирі перегляди через недоступний загальний трафік розділу, тож рейтинг ' +
    'змішує одиниці.',
  NOTE_SPANS_ZERO: 'інтервал перетинає нуль: явного напрямку немає',
  NOTE_LOW_CONFIDENCE: 'низька достовірність: позиція лише орієнтовна',
  NOTE_RAW_COUNTS: 'сирі перегляди: непорівнянні між розділами',
  NOTE_NO_RESERVATIONS: 'без застережень понад спільні',
  NO_ARTICLE_WITH_MENTIONS:
    '{project} згадує «{query}» у {hits} статтях, але окремої статті про тему немає',
  NO_ARTICLE_NO_HITS: '{project} не має ані статті, ані результатів пошуку за «{query}»',
  POSSIBLE_ALTERNATIVE:
    '{project} не має статті, привʼязаної до цієї теми, але «{title}» має схожу назву. Не підтверджено: спитайте ' +
    'користувача, перш ніж вважати це тією самою темою.',
  SEARCH_FAILED: 'Пошук у {project} не вдався: {error}',
  NO_PAGEVIEWS_DATA:
    '{project} має статтю «{title}», але Pageviews API не повертає даних між {from} і {to}',
  LANGUAGE_FETCH_FAILED: '{code}: {message}',
  NO_SITELINK: '{qid} не має статті в {lang}.wikipedia',
  YOY_TOO_SHORT: 'для рік-до-року потрібно {required} днів, у ряді їх {days}',
  YOY_ZERO_BASE: 'медіана попереднього року дорівнює нулю',
  INSUFFICIENT_CYCLES:
    'щоб сезонність була ідентифікованою, потрібно {required} повних цикли, у ряді їх {cyclesAvailable}',
};

export const DICTIONARIES: Record<Locale, Record<MessageCode, string>> = { en: EN, uk: UK };

export function isLocale(value: string): value is Locale {
  return (LOCALES as string[]).includes(value);
}

export function render(message: Message, locale: Locale = DEFAULT_LOCALE): string {
  const template = DICTIONARIES[locale][message.code];

  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => {
    const value = message.params[key];

    if (value === undefined) {
      return placeholder;
    }

    return typeof value === 'object' ? render(value, locale) : String(value);
  });
}

export function renderAll(messages: Message[], locale: Locale = DEFAULT_LOCALE): string[] {
  return messages.map((message) => render(message, locale));
}

export function message(code: MessageCode, params: Record<string, MessageParam> = {}): Message {
  return { code, params };
}
