import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repeats = Number(process.argv[2] ?? 3);
const model = process.argv[3] ?? 'claude-haiku-4-5-20251001';
const scenarios = JSON.parse(await readFile(join(root, 'evals', 'scenarios.json'), 'utf8'));
const rows = [];

for (const scenario of scenarios) {
  for (let run = 1; run <= repeats; run += 1) {
    spawnSync('node', [join(root, 'evals', 'run.mjs'), scenario.id, model, '0.5', `r${run}`], { stdio: ['ignore', 'ignore', 'inherit'] });
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
      command: (result.commands[0] ?? '').replace(/^node \S+dist\/cli\.js /, ''),
      costUsd: result.costUsd,
      inputTokens: (result.usage?.input_tokens ?? 0) + (result.usage?.cache_creation_input_tokens ?? 0) + (result.usage?.cache_read_input_tokens ?? 0),
      outputTokens: result.usage?.output_tokens ?? 0,
    });
    console.error(`${scenario.id} r${run}: $${result.costUsd?.toFixed(4)}`);
  }
}

console.log(JSON.stringify({ model, repeats, totalCostUsd: Math.round(rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) * 10000) / 10000, rows }, null, 1));
