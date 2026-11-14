import { type DurableCore, OperatorCommandError } from '@insignia/database';

type Operator = Pick<ReturnType<DurableCore['publicationHoldOperator']['create']>, 'inspect' | 'restore' | 'resolve'>;
export const PUBLICATION_HOLD_USAGE = `usage:
  insignia-publication-hold inspect --shop <shopId> --config <configId>
  insignia-publication-hold restore --shop <shopId> --config <configId> --operation <id> --inspect-digest <digest> --command-key <key> --confirm
  insignia-publication-hold resolve --shop <shopId> --config <configId> --operation <id> --command-key <key> --confirm`;

/** The observation-only resolution's own refusals (availability-recovery.ts), as bounded codes. */
const FAILURES: readonly (readonly [RegExp, string])[] = [
  [/availability not observed; operator hold retained/, 'original_not_observed'],
  [/does not have an operator availability hold/, 'no_operator_hold'],
  [/Recovery observation drift/, 'observation_drift'],
  [/Recovery idempotency conflict/, 'command_key_conflict'],
  [/Recovery installation inactive|Recovery shop unavailable/, 'installation_inactive'],
];
const FLAGS = ['--shop', '--config', '--operation', '--inspect-digest', '--command-key'] as const;
type Flag = (typeof FLAGS)[number];
type Parsed = { command: 'inspect' | 'restore' | 'resolve'; values: Partial<Record<Flag, string>>; confirm: boolean };

/** Strict parse: one subcommand, each flag once, no unknown or positional arguments. */
export function parsePublicationHoldArguments(argv: readonly string[]): Parsed | { error: string } {
  const [command, ...rest] = argv;
  if (command !== 'inspect' && command !== 'restore' && command !== 'resolve') return { error: 'unknown_command' };
  const values: Partial<Record<Flag, string>> = {};
  let confirm = false;
  for (let i = 0; i < rest.length; i++) {
    const argument = rest[i]!;
    if (argument === '--confirm' && !confirm) {
      confirm = true;
      continue;
    }
    const flag = FLAGS.find((name) => name === argument);
    const value = rest[i + 1];
    if (!flag || values[flag] !== undefined || value === undefined || value.startsWith('--'))
      return { error: 'invalid_arguments' };
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(value)) return { error: 'invalid_arguments' };
    values[flag] = value;
    i++;
  }
  const required: Record<Parsed['command'], readonly Flag[]> = {
    inspect: ['--shop', '--config'],
    restore: ['--shop', '--config', '--operation', '--inspect-digest', '--command-key'],
    resolve: ['--shop', '--config', '--operation', '--command-key'],
  };
  if (
    required[command].some((flag) => values[flag] === undefined) ||
    FLAGS.some((flag) => values[flag] !== undefined && !required[command].includes(flag)) ||
    (command === 'inspect' && confirm)
  )
    return { error: 'invalid_arguments' };
  // A changing command always needs the explicit confirmation; inspect is read only.
  if (command !== 'inspect' && !confirm) return { error: 'confirmation_required' };
  return { command, values, confirm };
}

/**
 * #466 part A: one run of the owner-run operator command. Every run, including a refused or
 * failed one, writes exactly one JSON audit line (`publication_hold_command`) to `write`; it
 * carries identities, the outcome, bounded reason codes and the findings, never a token or a
 * provider body. Exit code: 0 done, 1 refused or failed, 2 usage.
 */
export async function runPublicationHoldCommand(
  argv: readonly string[],
  deps: { operator: () => Promise<Operator> | Operator; write(line: string): void; now?: () => Date },
): Promise<number> {
  const now = deps.now ?? (() => new Date());
  const parsed = parsePublicationHoldArguments(argv);
  const audit = (fields: Record<string, unknown>) =>
    deps.write(`${JSON.stringify({ event: 'publication_hold_command', at: now().toISOString(), ...fields })}\n`);
  if ('error' in parsed) {
    audit({ command: argv[0] ?? null, outcome: 'refused', reasons: [parsed.error], usage: PUBLICATION_HOLD_USAGE });
    return 2;
  }
  const v = parsed.values;
  const identity = {
    command: parsed.command,
    shopId: v['--shop']!,
    configId: v['--config']!,
    ...(v['--operation'] ? { operationId: v['--operation'] } : {}),
    ...(v['--command-key'] ? { commandKey: v['--command-key'] } : {}),
    ...(v['--inspect-digest'] ? { inspectDigest: v['--inspect-digest'] } : {}),
    ...(parsed.confirm ? { confirmed: true } : {}),
  };
  try {
    const operator = await deps.operator();
    if (parsed.command === 'inspect') {
      const report = await operator.inspect({ shopId: identity.shopId, configId: identity.configId });
      audit({ ...identity, outcome: 'inspected', reasons: [], holds: report.holds });
      return 0;
    }
    if (parsed.command === 'restore') {
      const result = await operator.restore({
        shopId: identity.shopId,
        configId: identity.configId,
        operationId: v['--operation']!,
        inspectDigest: v['--inspect-digest']!,
        commandKey: v['--command-key']!,
      });
      audit({ ...identity, ...result });
      return result.outcome === 'restored' ? 0 : 1;
    }
    const resolved = await operator.resolve({
      shopId: identity.shopId,
      configId: identity.configId,
      operationId: v['--operation']!,
      commandKey: v['--command-key']!,
    });
    audit({
      ...identity,
      outcome: 'resolved',
      reasons: [],
      kind: resolved.kind,
      resolution: { version: resolved.resolution.version, createdAt: resolved.resolution.createdAt },
    });
    return 0;
  } catch (error) {
    // Refusals carry a bounded code; anything else is reported by class only (no provider text).
    if (error instanceof OperatorCommandError) audit({ ...identity, outcome: 'refused', reasons: [error.reason] });
    else {
      const message = error instanceof Error ? error.message : '';
      const reason = FAILURES.find(([pattern]) => pattern.test(message))?.[1] ?? 'error';
      audit({
        ...identity,
        outcome: 'failed',
        reasons: [reason],
        errorClass: error instanceof Error ? error.name : 'unknown',
      });
    }
    return 1;
  }
}
