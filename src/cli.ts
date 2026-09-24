import { resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';
import { runAnalyze } from './commands/analyze.js';
import { runCompare } from './commands/compare.js';
import { runFetch } from './commands/fetch.js';
import { runReport } from './commands/report.js';
import { DEFAULT_YEARS, runResearch } from './commands/research.js';
import { runResolve } from './commands/resolve.js';
import { isLocale } from './lib/messages.js';
import { contactWarning } from './lib/wikimedia.js';
import type { Locale } from './lib/messages.js';
import { SkillError } from './types.js';

// The agent reads stdout whole, so every command prints at most this many lines.
const MAX_STDOUT_LINES = 40;

const USAGE = {
  research:
    'research (--topic "<query>" | --qid Q123) --langs uk,pl [--lang uk] [--years 1-10 | --from YYYY-MM-DD --to YYYY-MM-DD] ' +
    '[--locale uk|en] [--no-cache]',
  resolve: 'resolve --topic "<query>" --lang <code> [--langs pl,cs]',
  fetch: 'fetch --qid Q123 --langs pl,cs --from YYYY-MM-DD --to YYYY-MM-DD [--no-cache] [--out path.json]',
  analyze: 'analyze --qid Q123 --lang cs --from YYYY-MM-DD --to YYYY-MM-DD [--locale uk] [--no-cache] [--out path.json]',
  compare: 'compare --qid Q123 --langs cs,uk --from YYYY-MM-DD --to YYYY-MM-DD [--locale uk] [--no-cache] [--out path.json]',
  report:
    'report --qid Q123 --langs en,de,uk --from YYYY-MM-DD --to YYYY-MM-DD [--locale uk|en] [--artifact path.json] [--no-cache]',
};

// Pretty-prints down to the cutoff depth and keeps anything deeper on one line.
function render(value: unknown, depth: number, indent: string, cutoff: number): string {
  if (depth >= cutoff || value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const items = value.map((item) => `${inner}${render(item, depth + 1, inner, cutoff)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }

  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  if (entries.length === 0) {
    return '{}';
  }
  const rendered = entries.map(
    ([key, item]) => `${inner}${JSON.stringify(key)}: ${render(item, depth + 1, inner, cutoff)}`,
  );
  return `{\n${rendered.join(',\n')}\n${indent}}`;
}

// Folds ever shallower nesting until the JSON fits MAX_STDOUT_LINES, one line as a last resort.
function fit(value: unknown): string {
  const pretty = JSON.stringify(value, null, 2);

  if (pretty.split('\n').length <= MAX_STDOUT_LINES) {
    return pretty;
  }

  for (const cutoff of [2, 1]) {
    const folded = render(value, 0, '', cutoff);

    if (folded.split('\n').length <= MAX_STDOUT_LINES) {
      return folded;
    }
  }

  return JSON.stringify(value);
}

function print(value: unknown): void {
  process.stdout.write(`${fit(value)}\n`);
}

// Errors are JSON on stdout as well, so the agent can relay error.message.
function fail(command: string, error: unknown): never {
  if (error instanceof SkillError) {
    print({ ok: false, command, error: { code: error.code, message: error.message, details: error.details } });
  } else {
    print({
      ok: false,
      command,
      error: { code: 'Unexpected', message: error instanceof Error ? error.message : String(error) },
    });
  }
  process.exit(1);
}

function parseLocale(value: string | undefined): Locale | null {
  if (value === undefined) {
    return null;
  }

  if (!isLocale(value)) {
    throw new SkillError('InvalidInput', `--locale "${value}" is not supported, use en or uk`, { locale: value });
  }

  return value;
}

// parseArgs throws a plain TypeError on an unknown flag; the agent should see it as bad input with the usage line.
function parse<T extends NonNullable<ParseArgsConfig['options']>>(command: keyof typeof USAGE, args: string[], options: T) {
  try {
    return parseArgs<{ args: string[]; options: T }>({ args, options }).values;
  } catch (error) {
    throw new SkillError('InvalidInput', `${error instanceof Error ? error.message : String(error)}. Usage: ${USAGE[command]}`);
  }
}

/** Resolves a user-given path against the working directory; null when the flag is absent. */
function toPath(value: string | undefined): string | null {
  return value ? resolvePath(process.cwd(), value) : null;
}

function splitLangs(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const warning = contactWarning();

  if (warning && process.stderr.isTTY) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  if (!command || command === '--help' || command === '-h') {
    print({ ok: true, command: 'help', commands: USAGE, contact: warning ?? 'WIKIMEDIA_CONTACT is set' });
    return;
  }

  if (command === 'resolve') {
    const values = parse(command, rest, {
      topic: { type: 'string' },
      lang: { type: 'string' },
      langs: { type: 'string' },
    });

    if (!values.topic || !values.lang) {
      throw new SkillError('InvalidInput', `Usage: ${USAGE.resolve}`);
    }

    print(await runResolve({ topic: values.topic, lang: values.lang, langs: splitLangs(values.langs) }));
    return;
  }

  if (command === 'fetch') {
    const values = parse(command, rest, {
      qid: { type: 'string' },
      langs: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      out: { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
    });

    if (!values.qid || !values.langs || !values.from || !values.to) {
      throw new SkillError('InvalidInput', `Usage: ${USAGE.fetch}`);
    }

    print(
      await runFetch({
        qid: values.qid,
        langs: splitLangs(values.langs),
        from: values.from,
        to: values.to,
        noCache: values['no-cache'] === true,
        out: toPath(values.out),
      }),
    );
    return;
  }

  if (command === 'analyze') {
    const values = parse(command, rest, {
      qid: { type: 'string' },
      lang: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      out: { type: 'string' },
      locale: { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
    });

    if (!values.qid || !values.lang || !values.from || !values.to) {
      throw new SkillError('InvalidInput', `Usage: ${USAGE.analyze}`);
    }

    print(
      await runAnalyze({
        qid: values.qid,
        lang: values.lang,
        from: values.from,
        to: values.to,
        noCache: values['no-cache'] === true,
        out: toPath(values.out),
        locale: parseLocale(values.locale),
      }),
    );

    return;
  }

  if (command === 'compare') {
    const values = parse(command, rest, {
      qid: { type: 'string' },
      langs: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      out: { type: 'string' },
      locale: { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
    });

    if (!values.qid || !values.langs || !values.from || !values.to) {
      throw new SkillError('InvalidInput', `Usage: ${USAGE.compare}`);
    }

    print(
      await runCompare({
        qid: values.qid,
        langs: splitLangs(values.langs),
        from: values.from,
        to: values.to,
        noCache: values['no-cache'] === true,
        out: toPath(values.out),
        locale: parseLocale(values.locale),
      }),
    );

    return;
  }

  if (command === 'research') {
    const values = parse(command, rest, {
      topic: { type: 'string' },
      qid: { type: 'string' },
      lang: { type: 'string' },
      langs: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      years: { type: 'string' },
      locale: { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
    });

    if ((!values.topic && !values.qid) || !values.langs) {
      throw new SkillError('InvalidInput', `Usage: ${USAGE.research}`);
    }

    // Number() rejects "2abc" and keeps "1.5" fractional, so both fail the integer check below.
    const years = values.years === undefined ? DEFAULT_YEARS : Number(values.years);

    if (!Number.isInteger(years) || years < 1 || years > 10) {
      throw new SkillError('InvalidInput', `--years must be a whole number from 1 to 10, got "${values.years}"`);
    }

    if ((values.from === undefined) !== (values.to === undefined)) {
      throw new SkillError('InvalidInput', '--from and --to go together');
    }

    print(
      await runResearch({
        topic: values.topic ?? null,
        qid: values.qid ?? null,
        lang: values.lang ?? 'uk',
        langs: splitLangs(values.langs),
        from: values.from ?? null,
        to: values.to ?? null,
        years,
        locale: parseLocale(values.locale) ?? 'uk',
        noCache: values['no-cache'] === true,
      }),
    );

    return;
  }

  if (command === 'report') {
    const values = parse(command, rest, {
      qid: { type: 'string' },
      langs: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      locale: { type: 'string' },
      artifact: { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
    });

    if (!values.qid || !values.langs || !values.from || !values.to) {
      throw new SkillError('InvalidInput', `Usage: ${USAGE.report}`);
    }

    print(
      await runReport({
        qid: values.qid,
        langs: splitLangs(values.langs),
        from: values.from,
        to: values.to,
        locale: parseLocale(values.locale) ?? 'uk',
        artifact: toPath(values.artifact),
        noCache: values['no-cache'] === true,
      }),
    );

    return;
  }

  throw new SkillError('InvalidInput', `Unknown command "${command}"`, { commands: Object.keys(USAGE) });
}

const invoked = process.argv[2] ?? 'cli';
main().catch((error: unknown) => fail(invoked, error));
