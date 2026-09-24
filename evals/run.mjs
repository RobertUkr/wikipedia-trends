import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const workspace = join(realpathSync(tmpdir()), `wikipedia-trends-eval-${process.pid}`);
const results = join(root, 'output', 'evals', 'results');
await rm(workspace, { recursive: true, force: true });
await mkdir(join(workspace, '.claude', 'skills'), { recursive: true });
await symlink(root, join(workspace, '.claude', 'skills', 'wikipedia-trends'));
await mkdir(results, { recursive: true });

const tools = ['Skill', 'Read', 'Bash(node:*)', `Bash(${root}/scripts/setup.sh)`];
const local = !model.startsWith('claude-');

// Returns null for anything that is not a JSON value, e.g. a warning line on stdout.
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function ask(prompt, resume) {
  const args = ['-p', prompt, '--model', model, '--output-format', 'stream-json', '--verbose', '--max-budget-usd', budget];
  const turn = [];

  if (resume) {
    args.push('--resume', resume);
  }

  if (local) {
    args.push('--tools', 'Skill', 'Read', 'Bash');
  }

  args.push('--strict-mcp-config', '--permission-mode', 'default', '--allowedTools', ...tools);
  const child = spawn('claude', args, { cwd: workspace, env: { ...process.env, WIKIPEDIA_TRENDS_OPEN: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  let buffer = '';

  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const event = parseJson(line);

      if (event) {
        turn.push(event);
      }
    }
  });

  return new Promise((done) => {
    child.on('error', (error) => {
      console.error(`claude failed to start: ${error.message}`);
      done(turn);
    });
    child.on('close', () => done(turn));
  });
}

const events = await ask(scenario.prompt);
const turns = [events.find((event) => event.type === 'result') ?? {}];

// Without a session id the follow-up would silently start a fresh conversation.
if (scenario.followUp && !turns[0].session_id) {
  console.error('first turn produced no session_id; follow-up skipped');
} else if (scenario.followUp) {
  const followUp = await ask(scenario.followUp, turns[0].session_id);
  events.push(...followUp);
  turns.push(followUp.find((event) => event.type === 'result') ?? {});
}

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

const final = turns.at(-1) ?? {};
const answer = final.result ?? '';
const clean = (text) => text.replace(/[*`]/g, '').replace(/\s+/g, ' ');
const plain = clean(answer);
const parsedOutputs = toolOutputs.map(parseJson);
const cliOutputs = toolOutputs.filter((_, index) => typeof parsedOutputs[index]?.command === 'string');
const evidence = [...cliOutputs, scenario.prompt, scenario.followUp ?? ''].join('\n');

const NUMBER = /[-+−]?\d+(?:[.,]\d+)?/g;
const normalise = (value) => String(Number(value.replace('−', '-').replace('+', '').replace(',', '.')));
const known = new Set((evidence.match(NUMBER) ?? []).map(normalise));
const absolute = (value) => String(Math.abs(Number(value)));
const knownAbsolute = new Set([...known].map(absolute));
const kind = (value) => (known.has(value) ? 'exact' : knownAbsolute.has(absolute(value)) ? 'signDropped' : 'unknown');

const numbers = (answer.match(NUMBER) ?? []).map((raw) => ({ raw, value: normalise(raw) }));
const exact = numbers.filter((item) => kind(item.value) === 'exact');
const signDropped = numbers.filter((item) => kind(item.value) === 'signDropped');
const unknown = numbers.filter((item) => kind(item.value) === 'unknown');

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
    numbersInOwnText: (joined.match(NUMBER) ?? []).length,
    latinWordsInOwnText: [...new Set(words.match(/\b[A-Za-z]{3,}\b/g) ?? [])],
    own,
    dropped,
  };
}

// A failed research run has no summary to compare against.
const research = parsedOutputs.filter((value) => value?.command === 'research' && value.ok !== false).at(-1);

const summary = {
  scenario: scenario.id,
  model,
  turns: turns.map((turn) => turn.num_turns ?? null),
  costUsd: Math.round(turns.reduce((sum, turn) => sum + (turn.total_cost_usd ?? 0), 0) * 10000) / 10000,
  durationMs: turns.reduce((sum, turn) => sum + (turn.duration_ms ?? 0), 0),
  usage: turns.map((turn) => turn.usage ?? null),
  toolCalls: toolCalls.length,
  toolsByName: toolCalls.reduce((acc, call) => ({ ...acc, [call.tool]: (acc[call.tool] ?? 0) + 1 }), {}),
  commands: toolCalls.filter((call) => call.tool === 'Bash').map((call) => call.input.command),
  numbers: { total: numbers.length, exact: exact.length, signDropped: signDropped.map((item) => item.raw), unknown: unknown.map((item) => item.raw) },
  expected: research
    ? {
        status: research.status,
        headline: research.headline ?? null,
        languages: (research.languages ?? []).map((item) => ({ lang: item.lang, direction: item.direction, recent: item.recentDirection, confidence: item.confidence })),
        caveats: (research.caveats ?? []).length,
        summaryVerbatim: plain.includes(clean(research.summary)),
        ownText: ownText(answer, research.summary),
        reportPathGiven: research.report ? plain.includes(research.report) : null,
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
