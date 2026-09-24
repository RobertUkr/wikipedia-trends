import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [scenarioId, model = 'claude-haiku-4-5-20251001', budget = '0.5', runTag = ''] = process.argv.slice(2);
const scenarios = JSON.parse(await readFile(join(root, 'evals', 'scenarios.json'), 'utf8'));
const scenario = scenarios.find((item) => item.id === scenarioId);

if (!scenario) {
  console.error(`unknown scenario "${scenarioId}", expected one of ${scenarios.map((item) => item.id).join(', ')}`);
  process.exit(2);
}

const workspace = join(root, 'output', 'evals', 'workspace');
const results = join(root, 'output', 'evals', 'results');
await rm(workspace, { recursive: true, force: true });
await mkdir(join(workspace, '.claude', 'skills'), { recursive: true });
await symlink(root, join(workspace, '.claude', 'skills', 'wikipedia-trends'));
await mkdir(results, { recursive: true });

const args = [
  '-p',
  scenario.prompt,
  '--model',
  model,
  '--output-format',
  'stream-json',
  '--verbose',
  '--max-budget-usd',
  budget,
  '--allowedTools',
  'Skill',
  'Read',
  'Bash(node:*)',
  `Bash(${root}/scripts/setup.sh)`,
];

const events = [];
const child = spawn('claude', args, { cwd: workspace, stdio: ['ignore', 'pipe', 'inherit'] });
let buffer = '';

child.stdout.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';

  for (const line of lines) {
    if (line.trim()) {
      events.push(JSON.parse(line));
    }
  }
});

await new Promise((done) => child.on('close', done));

const toolCalls = [];
const toolOutputs = [];
let toolFailures = 0;

for (const event of events) {
  for (const block of event.message?.content ?? []) {
    if (event.type === 'assistant' && block.type === 'tool_use') {
      toolCalls.push({ tool: block.name, input: block.input });
    }

    if (event.type === 'user' && block.type === 'tool_result') {
      const content = Array.isArray(block.content)
        ? block.content.map((part) => part.text ?? '').join('\n')
        : String(block.content ?? '');
      toolOutputs.push(content);

      if (block.is_error) {
        toolFailures += 1;
      }
    }
  }
}

const final = events.find((event) => event.type === 'result') ?? {};
const answer = final.result ?? '';
const clean = (text) => text.replace(/[*`]/g, '').replace(/\s+/g, ' ');
const plain = clean(answer);
const withoutLang = (text) => clean(text).replace(/^[a-z]{2,3}: /, '');
const evidence = [...toolOutputs, scenario.prompt].join('\n');

const NUMBER = /[-+−]?\d+(?:[.,]\d+)?/g;
const normalise = (value) => String(Number(value.replace('−', '-').replace('+', '').replace(',', '.')));
const known = new Set((evidence.match(NUMBER) ?? []).map(normalise));
const knownAbsolute = new Set([...known].map((value) => String(Math.abs(Number(value)))));

const numbers = (answer.match(NUMBER) ?? []).map((raw) => ({ raw, value: normalise(raw) }));
const exact = numbers.filter((item) => known.has(item.value));
const signDropped = numbers.filter((item) => !known.has(item.value) && knownAbsolute.has(String(Math.abs(Number(item.value)))));
const unknown = numbers.filter((item) => !known.has(item.value) && !knownAbsolute.has(String(Math.abs(Number(item.value)))));

function ownText(answerText, summaryText) {
  const lines = (text) =>
    text
      .split('\n')
      .map((line) => clean(line).trim())
      .filter((line) => line.length > 0 && !/^-{3,}$/.test(line));
  const given = lines(summaryText);
  const written = lines(answerText);
  const own = written.filter((line) => !given.includes(line));
  const dropped = given.filter((line) => !written.includes(line));
  const joined = own.join(' ');
  const words = joined.replace(/https?:\/\/\S+|\S*\/\S+\.pdf\S*/g, ' ');

  return {
    ownLines: own.length,
    droppedLines: dropped.length,
    numbersInOwnText: (joined.match(/[-+−]?\d+(?:[.,]\d+)?/g) ?? []).length,
    latinWordsInOwnText: [...new Set(words.match(/\b[A-Za-z]{3,}\b/g) ?? [])],
    own,
    dropped,
  };
}

const research = toolOutputs
  .map((text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })
  .find((value) => value?.command === 'research' && value?.status === 'done');

const summary = {
  scenario: scenario.id,
  model,
  turns: final.num_turns ?? null,
  costUsd: final.total_cost_usd ?? null,
  durationMs: final.duration_ms ?? null,
  usage: final.usage ?? null,
  toolCalls: toolCalls.length,
  toolsByName: toolCalls.reduce((acc, call) => ({ ...acc, [call.tool]: (acc[call.tool] ?? 0) + 1 }), {}),
  commands: toolCalls.filter((call) => call.tool === 'Bash').map((call) => call.input.command),
  numbers: { total: numbers.length, exact: exact.length, signDropped: signDropped.map((item) => item.raw), unknown: unknown.map((item) => item.raw) },
  expected: research
    ? {
        headline: research.headline,
        languages: research.languages.map((item) => ({ lang: item.lang, direction: item.direction, recent: item.recentDirection, confidence: item.confidence })),
        caveats: research.caveats.length,
        summaryVerbatim: plain.includes(clean(research.summary)),
        ownText: ownText(answer, research.summary),
        headlineVerbatim: plain.includes(clean(research.headline)),
        languageLinesVerbatim: `${research.languages.filter((item) => plain.includes(withoutLang(item.text))).length}/${research.languages.length}`,
        caveatsVerbatim: `${research.caveats.filter((item) => plain.includes(withoutLang(item))).length}/${research.caveats.length}`,
        confidenceWordsMissing: research.languages.map((item) => item.text.split('— ').pop()).filter((word) => !plain.includes(word)),
        reportPathGiven: plain.includes(research.report),
        failedToolCalls: toolFailures,
      }
    : null,
  answer,
};

await rm(workspace, { recursive: true, force: true });
const name = runTag ? `${scenario.id}-${runTag}` : scenario.id;
await writeFile(join(results, `${name}.json`), JSON.stringify(summary, null, 2));
await writeFile(join(results, `${name}.events.jsonl`), events.map((event) => JSON.stringify(event)).join('\n'));

const { answer: _answer, ...compact } = summary;
console.log(JSON.stringify(compact, null, 2));
