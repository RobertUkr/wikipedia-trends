import { resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import { runFetch } from './commands/fetch.js';
import { runResolve } from './commands/resolve.js';
import { SkillError } from './types.js';

const MAX_STDOUT_LINES = 40;

const USAGE = {
  resolve: 'resolve --topic "<query>" --lang <code> [--langs pl,cs]',
  fetch: 'fetch --qid Q123 --langs pl,cs --from YYYY-MM-DD --to YYYY-MM-DD [--no-cache] [--out path.json]',
};

function render(value: unknown, depth: number, indent: string): string {
  if (depth >= 2 || value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const items = value.map((item) => `${inner}${render(item, depth + 1, inner)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }

  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  if (entries.length === 0) {
    return '{}';
  }
  const rendered = entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${render(item, depth + 1, inner)}`);
  return `{\n${rendered.join(',\n')}\n${indent}}`;
}

function fit(value: unknown): string {
  const pretty = JSON.stringify(value, null, 2);
  if (pretty.split('\n').length <= MAX_STDOUT_LINES) {
    return pretty;
  }
  const folded = render(value, 0, '');
  return folded.split('\n').length <= MAX_STDOUT_LINES ? folded : JSON.stringify(value);
}

function print(value: unknown): void {
  process.stdout.write(`${fit(value)}\n`);
}

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

function splitLangs(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    print({ ok: true, command: 'help', commands: USAGE });
    return;
  }

  if (command === 'resolve') {
    const { values } = parseArgs({
      args: rest,
      options: {
        topic: { type: 'string' },
        lang: { type: 'string' },
        langs: { type: 'string' },
      },
    });

    if (!values.topic || !values.lang) {
      throw new SkillError('InvalidInput', `Usage: ${USAGE.resolve}`);
    }

    print(await runResolve({ topic: values.topic, lang: values.lang, langs: splitLangs(values.langs) }));
    return;
  }

  if (command === 'fetch') {
    const { values } = parseArgs({
      args: rest,
      options: {
        qid: { type: 'string' },
        langs: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        out: { type: 'string' },
        'no-cache': { type: 'boolean', default: false },
      },
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
        out: values.out ? resolvePath(process.cwd(), values.out) : null,
      }),
    );
    return;
  }

  throw new SkillError('InvalidInput', `Unknown command "${command}"`, { commands: Object.keys(USAGE) });
}

const invoked = process.argv[2] ?? 'cli';
main().catch((error: unknown) => fail(invoked, error));
