#!/usr/bin/env node
// Structural verification of the skill-proposal gate — Relay module.
//
// Retro's "pattern repeated 3+ times" skill proposal is an LLM judgment
// call: it can cite evidence that doesn't hold up, or file one off a tally
// only it can see. This script makes the claim checkable. For each proposal
// in .ai/artifacts/skill-proposals/, it extracts the slugs named in the
// **Evidence** section and counts how many of them actually appear as
// `(slug)` tags on bullets under "Conventions confirmed" in
// .ai/project-memory.md — the cross-feature record every role already
// reads. Fewer than 3 verifiable slugs means the gate's own threshold is
// not met by anything a human can audit.
//
// Advisory and non-blocking by design (same posture as run-pipeline.sh's
// diagram-vs-diff pre-check): it catches the trivial failure before a human
// spends time on the proposal, not instead of their judgment.
//
// Dependency-free. Usage:
//   node verify-skill-proposals.mjs \
//     [--memory=.ai/project-memory.md] \
//     [--proposals-dir=.ai/artifacts/skill-proposals] \
//     [--min-slugs=3]

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Content between a `**Label**` bold marker and the next bold marker (the
// proposal template is a list of `- **Label** — text` items), or end of
// text. Returns null when the label is absent entirely.
export function extractBoldSection(text, label) {
  const re = new RegExp(
    '\\*\\*' + escapeRegExp(label) + '\\*\\*\\s*—?[\\t ]*[\\r\\n]?' +
    '([\\s\\S]*?)(?=\\n[\\t ]*(?:-[\\t ]*)?\\*\\*[^*\\n]+\\*\\*|$)',
    'i'
  );
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

// Distinct `(slug)` tags ending bullets inside one memory category (its
// heading until the next heading of any level). Tags are matched at
// end-of-line only — the documented convention ("tag each new bullet with
// `(slug)`") — so parenthesized prose mid-bullet never counts.
export function memoryCategorySlugs(memoryText, category) {
  const headingRe = new RegExp(
    '^#{1,6}[ \\t]+.*' + escapeRegExp(category) + '.*$', 'im'
  );
  const hm = memoryText.match(headingRe);
  if (!hm) return new Set();
  const rest = memoryText.slice(hm.index + hm[0].length);
  const next = rest.match(/^#{1,6}[ \t]/m);
  const section = next ? rest.slice(0, next.index) : rest;
  const slugs = new Set();
  for (const m of section.matchAll(/^\s*[-*][^\n]*\(([a-z0-9][a-z0-9-]*)\)\s*$/gm)) {
    slugs.add(m[1]);
  }
  return slugs;
}

// The subset of `known` slugs that appear in `text` on their own boundaries
// — a slug followed/preceded by more slug characters (e.g. "settings-toggle"
// inside "settings-toggles-v2") does not count as citing it.
export function citedSlugs(text, known) {
  const cited = [];
  for (const slug of known) {
    const re = new RegExp('(?<![\\w-])' + escapeRegExp(slug) + '(?![\\w-])');
    if (re.test(text)) cited.push(slug);
  }
  return cited.sort();
}

// Verify one proposal against the project memory. Returns
// { ok, cited, reason } — ok true iff at least `minSlugs` distinct slugs
// cited in the Evidence section are present as tags in Conventions confirmed.
export function verifyProposal(proposalText, memoryText, minSlugs = 3) {
  const evidence = extractBoldSection(proposalText, 'Evidence');
  if (!evidence) {
    return { ok: false, cited: [], reason: 'proposal has no **Evidence** section to check' };
  }
  const known = memoryCategorySlugs(memoryText, 'Conventions confirmed');
  if (known.size === 0) {
    return {
      ok: false,
      cited: [],
      reason: 'no (slug)-tagged bullets found under Conventions confirmed in project memory',
    };
  }
  const cited = citedSlugs(evidence, known);
  if (cited.length < minSlugs) {
    return {
      ok: false,
      cited,
      reason:
        `only ${cited.length} of the cited slugs verifiable in Conventions confirmed` +
        ` (${cited.join(', ') || 'none'}) — the 3+ pattern threshold is not auditable`,
    };
  }
  return { ok: true, cited, reason: '' };
}

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const memoryPath = args.memory || '.ai/project-memory.md';
  const proposalsDir = args['proposals-dir'] || '.ai/artifacts/skill-proposals';
  const minSlugs = parseInt(args['min-slugs'], 10) || 3;

  if (!existsSync(proposalsDir)) {
    console.log('  (no skill proposals directory — nothing to verify)');
    return 0;
  }
  const proposals = readdirSync(proposalsDir).filter(f => f.endsWith('.md'));
  if (proposals.length === 0) {
    console.log('  (no skill proposals found — nothing to verify)');
    return 0;
  }
  if (!existsSync(memoryPath)) {
    console.log(`  (project memory not found at ${memoryPath} — verification skipped)`);
    return 0;
  }
  const memoryText = readFileSync(memoryPath, 'utf-8');

  let warnings = 0;
  for (const f of proposals) {
    const proposalText = readFileSync(join(proposalsDir, f), 'utf-8');
    const r = verifyProposal(proposalText, memoryText, minSlugs);
    if (r.ok) {
      console.log(
        `  OK — ${f}: evidence cites ${r.cited.length} slugs present in Conventions confirmed (${r.cited.join(', ')})`
      );
    } else {
      warnings++;
      console.log(`  WARNING — ${f}: ${r.reason}.`);
      console.log('  Not blocking — the proposal still gets human review — but its evidence could not be verified against project memory.');
    }
  }
  return warnings > 0 ? 0 : 0; // advisory: never fails the pipeline
}

if (process.argv[1] && process.argv[1].endsWith('verify-skill-proposals.mjs')) {
  const code = main();
  process.exit(code);
}
