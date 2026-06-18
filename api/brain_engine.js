/**
 * ══════════════════════════════════════════════════════════════
 *  SECOND BRAIN — Brain Engine
 *  Core logic: reads vault .md files, parses wikilinks,
 *  builds graph, runs keyword search, assembles context.
 *  Pure Node.js · Zero dependencies · Fully offline
 * ══════════════════════════════════════════════════════════════
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = path.resolve(__dirname, '..', 'vault');

// ── YAML frontmatter parser (simple, no deps) ────────────────────────────────
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let   val = line.slice(colonIdx + 1).trim();
    // Parse arrays: [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    }
    meta[key] = val;
  }
  return { meta, body: match[2] };
}

function buildFrontmatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) lines.push(`${k}: [${v.join(', ')}]`);
    else                   lines.push(`${k}: ${v}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

// ── Wikilink & tag parser ─────────────────────────────────────────────────────
function stripCodeBlocks(text) {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, '') // remove multi-line code blocks
    .replace(/`[^`\r\n]+`/g, '');    // remove inline code blocks
}

export function parseWikiLinks(text = '') {
  const cleanText = stripCodeBlocks(text);
  const links = [], re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(cleanText)) !== null) links.push(m[1].trim());
  return [...new Set(links)];
}

export function parseTags(text = '') {
  const cleanText = stripCodeBlocks(text);
  const tags = [], re = /#([a-zA-Z_][\w\-/]*)/g; // Match standard tags, supporting sub-tags like parent/child
  let m;
  while ((m = re.exec(cleanText)) !== null) {
    const tag = m[1];
    if (/^\d+$/.test(tag)) continue; // ignore pure numerical hashes (e.g. hex colors, header links)
    tags.push(tag.toLowerCase());
  }
  return [...new Set(tags)];
}

// ── Load ALL .md files from vault recursively ────────────────────────────────
export function loadVault() {
  const nodes = {};

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(fullPath); continue; }
      if (!entry.name.endsWith('.md')) continue;

      try {
        const raw       = fs.readFileSync(fullPath, 'utf8');
        const { meta, body } = parseFrontmatter(raw);
        const relPath   = path.relative(VAULT_DIR, fullPath).replace(/\\/g, '/');
        const id        = relPath.replace(/\.md$/, '');
        const title     = path.basename(entry.name, '.md');
        const allTags   = [...new Set([
          ...(Array.isArray(meta.tags) ? meta.tags : []),
          ...parseTags(body),
        ])];

        nodes[id] = {
          id,
          title,
          type:      meta.type      || 'note',
          tags:      allTags,
          agent:     meta.agent     || null,
          createdAt: meta.createdAt || null,
          importance: parseInt(meta.importance, 10) || 5,
          lastAccessedAt: meta.lastAccessedAt || meta.createdAt || new Date().toISOString().split('T')[0],
          content:   body.trim(),
          filePath:  fullPath,
          relPath,
        };
      } catch (e) {
        console.warn(`[brain] Could not read ${fullPath}: ${e.message}`);
      }
    }
  }

  walk(VAULT_DIR);
  return nodes;
}

// ── Write a node to vault as .md file ────────────────────────────────────────
export function writeNode(node, subdir = '') {
  const folder   = subdir
    ? path.join(VAULT_DIR, subdir)
    : path.join(VAULT_DIR, node.type === 'note' ? '' : node.type + 's');

  fs.mkdirSync(folder, { recursive: true });

  const safeName = node.title.replace(/[<>:"/\\|?*]/g, '-');
  const filePath = path.join(folder, `${safeName}.md`);

  const meta = {
    type:      node.type      || 'note',
    tags:      node.tags      || [],
    agent:     node.agent     || 'unknown',
    createdAt: node.createdAt || new Date().toISOString().split('T')[0],
    importance: node.importance || 5,
    lastAccessedAt: node.lastAccessedAt || node.createdAt || new Date().toISOString().split('T')[0],
  };

  const content = buildFrontmatter(meta) + `# ${node.title}\n\n${node.content || ''}`;
  fs.writeFileSync(filePath, content, 'utf8');

  // Return node id
  const relPath = path.relative(VAULT_DIR, filePath).replace(/\\/g, '/');
  return relPath.replace(/\.md$/, '');
}

// ── Update an existing .md file ───────────────────────────────────────────────
export function updateNodeFile(filePath, patch) {
  if (!fs.existsSync(filePath)) return false;
  const raw            = fs.readFileSync(filePath, 'utf8');
  const { meta, body } = parseFrontmatter(raw);

  const newMeta    = { ...meta, ...(patch.meta || {}) };
  const newContent = patch.content !== undefined ? patch.content : body;
  const newTitle   = patch.title   || path.basename(filePath, '.md');

  fs.writeFileSync(filePath, buildFrontmatter(newMeta) + `# ${newTitle}\n\n${newContent}`, 'utf8');
  return true;
}

// ── Delete a .md file ─────────────────────────────────────────────────────────
export function deleteNodeFile(filePath) {
  if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return true; }
  return false;
}

// ── Build edge list from all wikilinks ────────────────────────────────────────
export function buildEdges(nodes) {
  const edges = [];
  const byTitle = {};
  for (const n of Object.values(nodes)) {
    byTitle[n.title.toLowerCase()] = n.id;
  }

  for (const node of Object.values(nodes)) {
    for (const link of parseWikiLinks(node.content)) {
      const targetId = byTitle[link.toLowerCase()];
      if (targetId && targetId !== node.id) {
        edges.push({ source: node.id, target: targetId,
                     sourceTitle: node.title, targetTitle: nodes[targetId]?.title });
      }
    }
  }
  return edges;
}

// ── Build backlinks map ────────────────────────────────────────────────────────
export function buildBacklinks(nodes) {
  const map = {};
  for (const { source, target } of buildEdges(nodes)) {
    if (!map[target]) map[target] = [];
    if (!map[target].includes(source)) map[target].push(source);
  }
  return map;
}

// ── TF-IDF Cosine Similarity Search & Time-Decay scoring ──────────────────────
function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1);
}

function getDecayFactor(node) {
  const today = new Date();
  const lastAccessStr = node.lastAccessedAt || node.createdAt || new Date().toISOString().split('T')[0];
  const lastAccess = new Date(lastAccessStr);
  const diffTime = Math.abs(today - lastAccess);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  const importance = parseInt(node.importance, 10) || 5;
  let halfLife = 30; // default medium half-life
  if (importance >= 8) halfLife = 180;
  else if (importance <= 4) halfLife = 7;
  
  const lambda = 0.693 / halfLife;
  return Math.exp(-lambda * diffDays);
}

export function searchNodes(nodes, query, limit = 10) {
  // Filter out archived nodes from standard search
  const allNodes = Object.values(nodes).filter(n => n.type !== 'archive');
  if (!allNodes.length) return [];

  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  const df = {};
  const docTokens = allNodes.map(node => {
    // Boost title and tags by repeating them in search corpus
    const text = `${node.title} ${node.title} ${node.tags.join(' ')} ${node.tags.join(' ')} ${node.content}`;
    const tokens = tokenize(text);
    const uniqueTokens = new Set(tokens);
    for (const t of uniqueTokens) {
      df[t] = (df[t] || 0) + 1;
    }
    return { id: node.id, tokens };
  });

  const N = allNodes.length;
  const queryTf = {};
  for (const t of queryTokens) queryTf[t] = (queryTf[t] || 0) + 1;

  const queryVector = {};
  let queryMagnitudeSq = 0;
  for (const t of Object.keys(queryTf)) {
    const idf = Math.log(1 + N / (df[t] || 1));
    const tfidf = queryTf[t] * idf;
    queryVector[t] = tfidf;
    queryMagnitudeSq += tfidf * tfidf;
  }
  const queryMagnitude = Math.sqrt(queryMagnitudeSq);
  if (queryMagnitude === 0) return [];

  const results = [];
  allNodes.forEach((node, index) => {
    const tokens = docTokens[index].tokens;
    const docTf = {};
    for (const t of tokens) docTf[t] = (docTf[t] || 0) + 1;

    let dotProduct = 0;
    let docMagnitudeSq = 0;
    for (const t of Object.keys(docTf)) {
      const idf = Math.log(1 + N / (df[t] || 1));
      const tfidf = docTf[t] * idf;
      docMagnitudeSq += tfidf * tfidf;
      if (queryVector[t]) dotProduct += queryVector[t] * tfidf;
    }

    const docMagnitude = Math.sqrt(docMagnitudeSq);
    let cosineSim = 0;
    if (queryMagnitude > 0 && docMagnitude > 0) {
      cosineSim = dotProduct / (queryMagnitude * docMagnitude);
    }

    // Boost exact matches in title
    if (node.title.toLowerCase().includes(query.toLowerCase())) cosineSim += 0.4;
    if (node.title.toLowerCase() === query.toLowerCase()) cosineSim += 0.8;

    // Apply Time-Decay weight
    const score = cosineSim * getDecayFactor(node);

    if (score > 0.05) {
      results.push({
        id:      node.id,
        title:   node.title,
        type:    node.type,
        tags:    node.tags,
        agent:   node.agent,
        score,
        preview: node.content.replace(/[#*\[\]`>_]/g, '').slice(0, 160).trim(),
      });
    }
  });

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function archiveStaleNodes(nodes) {
  const today = new Date();
  let archivedCount = 0;
  for (const node of Object.values(nodes)) {
    if (node.type === 'archive' || node.tags.includes('core') || node.tags.includes('system')) continue;

    const lastAccessStr = node.lastAccessedAt || node.createdAt || new Date().toISOString().split('T')[0];
    const lastAccess = new Date(lastAccessStr);
    const diffTime = Math.abs(today - lastAccess);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const importance = parseInt(node.importance, 10) || 5;

    // Archive thresholds: Low importance & 14 days inactive, or Medium importance & 45 days inactive
    if ((importance <= 4 && diffDays > 14) || (importance <= 7 && diffDays > 45)) {
      const archiveDir = path.join(VAULT_DIR, 'archive');
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

      // Change file meta and rewrite
      updateNodeFile(node.filePath, {
        meta: { type: 'archive' }
      });

      // Move file physical location
      const newPath = path.join(archiveDir, path.basename(node.filePath));
      fs.renameSync(node.filePath, newPath);
      archivedCount++;
      console.log(`[brain] 📦 Archived stale node: "${node.title}" (inactive for ${diffDays} days)`);
    }
  }
  return archivedCount;
}

// ── Smart context retrieval: seed + N hops + token budget ────────────────────
export function buildContext(nodes, query, hops = 1, maxTokens = 2000) {
  const seeds = searchNodes(nodes, query, 3);
  if (!seeds.length) return { query, nodes: [], tokenEstimate: 0, systemPrompt: '' };

  const byTitle  = {};
  for (const n of Object.values(nodes)) byTitle[n.title.toLowerCase()] = n.id;

  const visited = new Set();
  const queue   = seeds.map(s => ({ id: s.id, hop: 0 }));
  const result  = [];
  let   tokens  = 0;

  while (queue.length) {
    const { id, hop } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);

    const node = nodes[id];
    if (!node) continue;

    const est = Math.ceil(node.content.length / 4);
    if (tokens + est > maxTokens && result.length > 0) break;
    result.push({ ...node, hop });
    tokens += est;

    if (hop < hops) {
      for (const link of parseWikiLinks(node.content)) {
        const tid = byTitle[link.toLowerCase()];
        if (tid && !visited.has(tid)) queue.push({ id: tid, hop: hop + 1 });
      }
    }
  }

  return {
    query,
    hops,
    tokenEstimate: tokens,
    nodeCount:     result.length,
    nodes:         result,
    systemPrompt:  buildSystemPrompt(result),
  };
}

function buildSystemPrompt(nodes) {
  if (!nodes.length) return '';
  const lines = ['## Knowledge Base Context\n',
    `> ${nodes.length} relevant nodes retrieved. Use this context to answer accurately.\n`];
  for (const n of nodes) {
    lines.push(`### ${n.title} [${n.type.toUpperCase()}]`);
    lines.push(n.content);
    lines.push('');
  }
  return lines.join('\n');
}

