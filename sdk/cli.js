#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════
 *  SECOND BRAIN — CLI
 *
 *  A small wrapper over the SDK/REST API for quick terminal use.
 *  Usage: node sdk/cli.js <command> [args]     (or: npm run brain -- <command> ...)
 * ══════════════════════════════════════════════════════════════
 */
import { SecondBrain } from './index.js';
import { TaskQueue } from './task_queue.js';
import { Messenger } from './messenger.js';

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

const brain = new SecondBrain({ agent: 'cli-client', silent: true });

function flag(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const found = args.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

// Parses an integer flag; exits with a clear message instead of sending NaN.
function intFlag(name, fallback) {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(n) || n < 0) {
    console.error(`Error: --${name} must be a non-negative integer (got "${raw}").`);
    process.exit(1);
  }
  return n;
}

// For read commands: a null answer from an unreachable or rejecting server must
// not be reported as "0 results".
function failIfError(what) {
  if (brain.lastError) {
    console.error(`Error: ${what} failed: ${brain.lastError}`);
    process.exit(1);
  }
}

async function run() {
  switch (command) {
    case 'status': {
      const alive = await brain.isAlive();
      if (alive) {
        const health = await brain._fetch('/health');
        console.log(`Second Brain API: ONLINE`);
        console.log(`URL: ${brain.apiUrl}`);
        console.log(`Nodes: ${health?.nodeCount || 0}`);
        console.log(`Edges: ${health?.edgeCount || 0}`);
      } else {
        console.log(`Second Brain API: OFFLINE (check if server is running on ${brain.apiUrl})`);
        process.exit(1);
      }
      break;
    }

    case 'recall': {
      const query = args[1];
      if (!query) {
        console.error('Error: Missing query string for recall. Usage: brain recall "<query>" [--hops=1] [--tokens=2000]');
        process.exit(1);
      }
      const hops = intFlag('hops', 1);
      const maxTokens = intFlag('tokens', 2000);
      const ctx = await brain.recall(query, hops, maxTokens);
      failIfError('recall');
      console.log(ctx.systemPrompt || '(No relevant context found)');
      break;
    }

    case 'search': {
      const searchQ = args[1];
      if (!searchQ) {
        console.error('Error: Missing search term. Usage: brain search "<term>" [--limit=5]');
        process.exit(1);
      }
      const limit = intFlag('limit', 5);
      const results = await brain.search(searchQ, limit);
      failIfError('search');
      console.log(`Found ${results.length} nodes:\n`);
      results.forEach(n => {
        console.log(`- [${n.type.toUpperCase()}] ${n.title} (score: ${(n.score ?? 0).toFixed(2)})`);
        console.log(`  "${n.preview}"\n`);
      });
      break;
    }

    case 'remember': {
      const content = args[1];
      if (!content) {
        console.error('Error: Missing content string. Usage: brain remember "<content>" --title="<title>" [--type=memory] [--tags="t1,t2"]');
        process.exit(1);
      }
      const title = flag('title');
      const type  = flag('type', 'memory');
      const tags  = flag('tags', '').split(',').map(t => t.trim()).filter(Boolean);
      if (!title) {
        console.error('Error: --title="<title>" parameter is required when saving a memory.');
        process.exit(1);
      }
      const res = await brain.remember(content, { title, type, tags });
      if (res && res.success) {
        console.log(`Memory saved successfully as ID: ${res.id}`);
      } else {
        console.error(`Failed to save memory: ${brain.lastError || 'unknown error'}. Is the server running (npm start) and is BRAIN_KEY set correctly if auth is enabled?`);
        process.exit(1);
      }
      break;
    }

    case 'tasks': {
      const sub = args[1];
      const tq = new TaskQueue({ api: brain.apiUrl, apiKey: brain.apiKey, silent: true });
      if (sub === 'submit') {
        const prompt = args[2];
        if (!prompt) {
          console.error('Error: Usage: brain tasks submit "<prompt>" [--agents=a,b] [--priority=5]');
          process.exit(1);
        }
        const agents = flag('agents', '').split(',').map(a => a.trim()).filter(Boolean);
        const priority = intFlag('priority', undefined);
        const result = await tq.submit(prompt, agents, { priority });
        console.log(JSON.stringify(result, null, 2));
      } else if (sub === 'list' || !sub) {
        const status = flag('status', null);
        const tasks = await tq.list(status);
        console.log(`Found ${tasks.length} task(s):\n`);
        tasks.forEach(t => console.log(`- [${(t.tags || []).join(', ')}] ${t.title} (${t.id})`));
      } else {
        console.error(`Unknown tasks subcommand: ${sub}. Usage: brain tasks submit|list`);
        process.exit(1);
      }
      break;
    }

    case 'messages': {
      const sub = args[1];
      const msgr = new Messenger({ api: brain.apiUrl, apiKey: brain.apiKey, silent: true });
      if (sub === 'send') {
        const toAgent = args[2];
        const content = args[3];
        if (!toAgent || !content) {
          console.error('Error: Usage: brain messages send "<toAgent>" "<content>" [--from=agentName] [--subject=...]');
          process.exit(1);
        }
        const result = await msgr.send(flag('from', 'cli'), toAgent, content, { subject: flag('subject') });
        console.log(JSON.stringify(result, null, 2));
      } else if (sub === 'inbox') {
        const agentName = args[2];
        if (!agentName) {
          console.error('Error: Usage: brain messages inbox "<agentName>" [--all]');
          process.exit(1);
        }
        const unreadOnly = !args.includes('--all');
        const messages = await msgr.inbox(agentName, unreadOnly);
        console.log(`Found ${messages.length} message(s) for ${agentName}:\n`);
        messages.forEach(m => console.log(`- ${m.title} [${(m.tags || []).join(', ')}]`));
      } else {
        console.error(`Unknown messages subcommand: ${sub}. Usage: brain messages send|inbox`);
        process.exit(1);
      }
      break;
    }

    case 'org-chart': {
      const chart = await brain._fetch('/org-chart');
      if (!chart) { console.error(`Could not reach Second Brain API${brain.lastError ? `: ${brain.lastError}` : ''}.`); process.exit(1); }
      console.log(`${chart.departmentCount} department(s):\n`);
      for (const dept of chart.departments || []) {
        console.log(`${dept.department} (${dept.memberCount} member(s))`);
        const printMember = (m, depth) => {
          console.log(`${'  '.repeat(depth + 1)}- ${m.title}`);
          (m.reports || []).forEach(r => printMember(r, depth + 1));
        };
        dept.members.forEach(m => printMember(m, 0));
      }
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`Second Brain CLI`);
  console.log(`Usage: brain <command> [arguments]\n`);
  console.log(`Commands:`);
  console.log(`  status                                Checks Second Brain server connection`);
  console.log(`  recall "<query>" [--hops=1] [--tokens=2000]`);
  console.log(`  search "<term>" [--limit=5]`);
  console.log(`  remember "<content>" --title="<t>" [--type=memory] [--tags="t1,t2"]`);
  console.log(`  tasks submit "<prompt>" [--agents=a,b] [--priority=5]`);
  console.log(`  tasks list [--status=pending]`);
  console.log(`  messages send "<toAgent>" "<content>" [--from=agentName] [--subject=...]`);
  console.log(`  messages inbox "<agentName>" [--all]`);
  console.log(`  org-chart                            Prints the department/lead structure`);
  console.log(`\nExample:`);
  console.log(`  npm run brain -- recall "API schema design"`);
}

// Task/message clients throw on server errors (bad input, auth, unreachable);
// print them plainly rather than as an unhandled rejection with a stack trace.
run().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
