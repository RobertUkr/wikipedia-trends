import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repeats = Number(process.argv[2] ?? 3);
const model = process.argv[3] ?? 'claude-haiku-4-5-20251001';
const scenarios = JSON.parse(await readFile(join(root, 'evals', 'scenarios.json'), 'utf8'));
const rows = [];
const sum = (items, pick) => (items ?? []).filter(Boolean).reduce((total, item) => total + (pick(item) ?? 0), 0);

for (const scenario of scenarios) {
  for (let run = 1; run <= repeats; run += 1) {
    const { status } = spawnSync('node', [join(root, 'evals', 'run.mjs'), scenario.id, model, '0.5', `r${run}`], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });

    // A failed run would otherwise be summarised from the previous batch's result file.
    if (status !== 0) {
      rows.push({ scenario: scenario.id, run, error: status });
      console.error(`${scenario.id} r${run}: run.mjs exited with ${status}`);
      continue;
    }

    const result = JSON.parse(await readFile(join(root, 'output', 'evals', 'results', `${scenario.id}-r${run}.json`), 'utf8'));
    const own = result.expected?.ownText ?? {};
    rows.push({
      scenario: scenario.id,
      run,
      toolCalls: result.toolCalls,
      failed: result.expected?.failedToolCalls ?? null,
      numbers: `${result.numbers.exact}/${result.numbers.total}`,
      unknownNumbers: result.numbers.unknown,
      ownLines: own.ownLines,
      droppedLines: own.droppedLines,
      numbersInOwnText: own.numbersInOwnText,
      latinInOwnText: own.latinWordsInOwnText,
      status: result.expected?.status ?? null,
      commands: result.commands.map((command) => command.replace(/^node \S+dist\/cli\.js /, '')),
      costUsd: result.costUsd,
      inputTokens: sum(result.usage, (usage) => usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens),
      outputTokens: sum(result.usage, (usage) => usage.output_tokens),
    });
    console.error(`${scenario.id} r${run}: $${result.costUsd?.toFixed(4)}`);
  }
}

console.log(JSON.stringify({ model, repeats, totalCostUsd: Math.round(sum(rows, (row) => row.costUsd) * 10000) / 10000, rows }, null, 1));
