import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const documents = new Map([
  ['docs/delivery/state.md', 'Latest integration:'],
  ['docs/delivery/evidence/m8-context-runtime/WORKLIST.md', 'Latest main:'],
]);
const full = (reason) => ({ route: 'full', reason });
const refuse = (code) => {
  throw new Error(code);
};
const likelySecret =
  /shpat_|shpss_|cfat_|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|BEGIN (?:RSA |EC )?PRIVATE KEY|\bBearer\s|[?&](?:token|secret|signature|X-Amz-Signature)=/i;
// Keep all prose/punctuation fixed. Only hashes and numeric status/reference identifiers may vary.
const skeleton = (line) =>
  line.replace(/(?<![A-Za-z0-9])[a-f0-9]{7,40}(?![A-Za-z0-9])/gi, '<sha>').replace(/\d+/g, '<n>');
function latest(text, prefix) {
  const lines = text.split('\n');
  const matches = lines.filter((line) => line.startsWith(prefix));
  if (matches.length !== 1) refuse('STATUS_LINE_INVALID');
  return { line: matches[0], rest: lines.filter((line) => !line.startsWith(prefix)).join('\n') };
}
function linksValid(line, file, head, git) {
  for (const match of line.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = match[1];
    if (
      /^https:\/\/github\.com\/Optidigi\/insignia\/(?:pull\/\d+|actions\/runs\/\d+(?:\/job\/\d+)?|commit\/[a-f0-9]{40}|blob\/[a-f0-9]{40}\/[A-Za-z0-9_./-]+)(?:#[A-Za-z0-9_-]+)?$/.test(
        target,
      )
    )
      continue;
    if (
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) ||
      target.startsWith('/') ||
      target.includes('?') ||
      target.includes('\\')
    )
      refuse('STATUS_LINK_INVALID');
    let relative;
    try {
      relative = decodeURIComponent(target.split('#')[0]);
    } catch {
      refuse('STATUS_LINK_INVALID');
    }
    if (/[\p{Cc}]/u.test(relative)) refuse('STATUS_LINK_INVALID');
    const normalized = relative ? posix.normalize(posix.join(posix.dirname(file), relative)) : file;
    if (normalized.startsWith('../') || normalized.startsWith('/')) refuse('STATUS_LINK_INVALID');
    try {
      git('cat-file', '-e', `${head}:${normalized}`);
    } catch {
      refuse('STATUS_LINK_INVALID');
    }
  }
}

/** Reads actual commit trees; no caller-supplied changed-file list can select a fast route. */
export function classifyStatusDocs({ cwd, base, head }) {
  if (![base, head].every((ref) => typeof ref === 'string' && /^[a-f0-9]{40}$/i.test(ref)))
    return full('REFS_UNAVAILABLE');
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'] });
  let changes;
  try {
    for (const ref of [base, head])
      if (git('rev-parse', '--verify', `${ref}^{commit}`).trim().toLowerCase() !== ref.toLowerCase())
        return full('REFS_UNAVAILABLE');
    const fields = git(
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--name-status',
      '-z',
      base,
      head,
      '--',
    ).split('\0');
    if (fields.pop() !== '' || fields.length % 2) return full('UNRECOGNIZED_CHANGE');
    changes = Array.from({ length: fields.length / 2 }, (_, i) => ({ status: fields[2 * i], file: fields[2 * i + 1] }));
  } catch {
    return full('REFS_UNAVAILABLE');
  }
  if (!changes.length || changes.some((change) => change.status !== 'M' || !documents.has(change.file)))
    return full('UNRECOGNIZED_CHANGE');
  const changed = new Set(changes.map((change) => change.file));
  for (const [file, prefix] of documents) {
    let before, after;
    try {
      for (const ref of [base, head])
        if (!git('ls-tree', ref, '--', file).startsWith('100644 blob ')) return full('UNRECOGNIZED_CHANGE');
      before = git('show', `${base}:${file}`);
      after = git('show', `${head}:${file}`);
    } catch {
      return full('REFS_UNAVAILABLE');
    }
    if (Buffer.byteLength(after) > 262144 || Buffer.byteLength(before) > 262144) return full('UNRECOGNIZED_CHANGE');
    if (likelySecret.test(after)) refuse('STATUS_SECRET_REFUSED');
    const prior = latest(before, prefix),
      current = latest(after, prefix);
    if (!changed.has(file)) continue;
    if (prior.rest !== current.rest || skeleton(prior.line) !== skeleton(current.line))
      return full('SUBSTANTIVE_DOC_CHANGE');
    linksValid(current.line, file, head, git);
  }
  return { route: 'status-docs', reason: 'STATUS_REFERENCES_VALIDATED' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = classifyStatusDocs({
      cwd: process.cwd(),
      base: process.env.CI_BASE_SHA,
      head: process.env.CI_HEAD_SHA,
    });
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `route=${result.route}\n`);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        result.route === 'status-docs'
          ? '### Status documentation validation\n\nOnly existing integration-reference lines changed; document structure and changed links validated. Full behavior, PostgreSQL, browser, process and Wasm suites were **not selected**. This is no new product or native qualification.\n'
          : '### Full verification selected\n\nThe change is outside the narrow status-reference route, or exact refs were unavailable. Existing full checks and failure semantics apply; classification does not report their outcome.\n',
      );
    console.log(`CI route: ${result.route} (${result.reason})`);
  } catch {
    console.error('Status documentation validation failed; no fast-route success was recorded.');
    process.exitCode = 1;
  }
}
