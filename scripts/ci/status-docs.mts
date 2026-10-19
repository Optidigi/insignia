import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// This mutable progress document has no executable/data consumers.
// Expanding this set requires tracing consumers; evidence JSON and authority stay full-route.
const documents = new Set(['docs/delivery/state.md']);
const full = (reason: string) => ({ route: 'full', reason });
function refuse(code: string): never {
  throw new Error(code);
}
const likelySecret =
  /shpat_|shpss_|cfat_|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|BEGIN (?:RSA |EC )?PRIVATE KEY|\bBearer\s|[?&](?:token|secret|signature|X-Amz-Signature)=/i;
function linksValid(line: string, file: string, head: string, git: (...args: string[]) => string) {
  for (const match of line.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = match[1];
    if (!target) refuse('STATUS_LINK_INVALID');
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
    let relative: string;
    try {
      relative = decodeURIComponent(target.split('#')[0] ?? '');
    } catch {
      refuse('STATUS_LINK_INVALID');
    }
    if (/[\p{Cc}]/u.test(relative)) refuse('STATUS_LINK_INVALID');
    const normalized = relative ? posix.normalize(posix.join(posix.dirname(file), relative)).replace(/\/$/, '') : file;
    if (normalized.startsWith('../') || normalized.startsWith('/')) refuse('STATUS_LINK_INVALID');
    try {
      git('cat-file', '-e', `${head}:${normalized}`);
    } catch {
      refuse('STATUS_LINK_INVALID');
    }
  }
}

/** Reads actual commit trees; no caller-supplied changed-file list can select a fast route. */
export function classifyStatusDocs({
  cwd,
  base,
  head,
}: {
  cwd: string;
  base?: unknown;
  head?: unknown;
  files?: unknown;
}) {
  if (
    typeof base !== 'string' ||
    typeof head !== 'string' ||
    !/^[a-f0-9]{40}$/i.test(base) ||
    !/^[a-f0-9]{40}$/i.test(head)
  )
    return full('REFS_UNAVAILABLE');
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'] });
  let changes: { status: string; file: string }[];
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
    changes = [];
    for (let i = 0; i < fields.length; i += 2) {
      const status = fields[i],
        file = fields[i + 1];
      if (!status || !file) return full('UNRECOGNIZED_CHANGE');
      changes.push({ status, file });
    }
  } catch {
    return full('REFS_UNAVAILABLE');
  }
  if (!changes.length || changes.some((change) => change.status !== 'M' || !documents.has(change.file)))
    return full('UNRECOGNIZED_CHANGE');
  for (const { file } of changes) {
    let before: string, after: string;
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
    // Command instructions need the comprehensive source/command-target controls.
    if (/\b(?:node|bash|python3|(?:corepack\s+)?pnpm)\s+[A-Za-z./-]/.test(after)) return full('COMMAND_DOC_CHANGE');
    linksValid(after, file, head, git);
  }
  return { route: 'status-docs', reason: 'CURRENT_DOCS_VALIDATED' };
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
          ? '### Status documentation validation\n\nOnly the supported current-progress document changed; Git file scope, links and secret checks validated. Full behavior, PostgreSQL, browser, process and Wasm suites were **not selected**. This is no new product or native qualification.\n'
          : '### Full verification selected\n\nThe change is outside the bounded current-document route, or exact refs were unavailable. Existing full checks and failure semantics apply; classification does not report their outcome.\n',
      );
    console.log(`CI route: ${result.route} (${result.reason})`);
  } catch {
    console.error('Status documentation validation failed; no fast-route success was recorded.');
    process.exitCode = 1;
  }
}
