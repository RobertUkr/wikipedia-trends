import type { Message, MessageCode } from '../types.js';

export type Locale = 'en' | 'uk';

export const LOCALES: Locale[] = ['en', 'uk'];
export const DEFAULT_LOCALE: Locale = 'en';

const EN: Record<MessageCode, string> = {
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
  GAPS_INTERPOLATED: '{days} day(s) are missing from the API response and were interpolated.',
  RAW_COUNTS_NOT_COMPARABLE:
    'Project totals were unavailable, so the series is raw view counts. Values are not comparable across editions.',
  WEEKLY_AGGREGATION:
    'The trend is fitted on {weeks} weekly sums rather than {days} daily values, because daily pageviews are ' +
    'autocorrelated and a daily fit reports an interval narrower than the real uncertainty.',
  ABSOLUTE_VS_RELATIVE:
    'Two trends are reported: raw views move {absolute}%/year, the share of edition traffic moves {relative}%/year. ' +
    'The relative one is the measure of interest in the topic; the absolute one also carries whatever the edition ' +
    'as a whole is doing.',
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
  DETAIL_OUTLIERS: '{days} of {total} days removed as spikes (budget {budget}%)',
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
  GAPS_INTERPOLATED: '{days} дн. відсутні у відповіді API та були інтерпольовані.',
  RAW_COUNTS_NOT_COMPARABLE:
    'Загальний трафік розділу недоступний, тому ряд — сирі перегляди. Значення непорівнянні між розділами.',
  WEEKLY_AGGREGATION:
    'Тренд підігнано на {weeks} тижневих сумах, а не на {days} денних значеннях: денні перегляди автокорельовані, ' +
    'і підгонка на них дає інтервал вужчий за реальну невизначеність.',
  ABSOLUTE_VS_RELATIVE:
    'Показано два тренди: сирі перегляди рухаються на {absolute}%/рік, частка трафіку розділу — на {relative}%/рік. ' +
    'Відносний і є мірою інтересу до теми; абсолютний несе ще й те, що відбувається з розділом загалом.',
  EDITION_TRAFFIC_DECLINING:
    'Сирі перегляди падають на {absolute}%/рік, а частка трафіку розділу тримається на {relative}%/рік. Це означає, ' +
    'що читачів втрачає розділ загалом, а не що згасає інтерес саме до теми.',
  TREND_REVERSAL:
    'За весь період тренд {overall}%/рік, а за останні {weeks} тижнів — {recent}%/рік, і жоден інтервал не містить ' +
    'нуля. Пряма за весь діапазон не описує поточний напрямок.',
  NOTE_TREND_REVERSAL: 'поточний напрямок протилежний трендові періоду',
  DETAIL_VOLUME: 'медіана {median} переглядів/день проти смуги шум-сигнал {floor}-{ceiling}',
  DETAIL_LENGTH: '{days} днів із {target} потрібних для висновку рік-до-року',
  DETAIL_STABILITY: '{agreeing} з {total} підвибірок (половини й третини) зберігають знак нахилу всього ряду',
  DETAIL_STABILITY_SPANS_ZERO:
    'інтервал усього ряду перетинає нуль, тож напрямок не заявляється і згода підвибірок не потрібна',
  DETAIL_STABILITY_TOO_SHORT: 'ряд закороткий, щоб розбити його на підвибірки',
  DETAIL_OUTLIERS: '{days} із {total} днів прибрано як сплески (бюджет {budget}%)',
  DETAIL_CONTINUITY: '{missing} відсутніх днів, найдовша прогалина {longest} днів',
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

    return value === undefined ? placeholder : String(value);
  });
}

export function renderAll(messages: Message[], locale: Locale = DEFAULT_LOCALE): string[] {
  return messages.map((message) => render(message, locale));
}

export function message(code: MessageCode, params: Record<string, string | number> = {}): Message {
  return { code, params };
}
