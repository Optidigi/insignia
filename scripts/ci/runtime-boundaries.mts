/** Temporary typed admission for actual operational modules pending their source migration. */
import assert from 'node:assert/strict';
import type { Writable } from 'node:stream';
import { object } from './validation.mts';

async function moduleAt(path: string) {
  const value: unknown = await import(new URL(path, import.meta.url).href);
  return object(value);
}
export async function verifierSourcePaths(): Promise<string[]> {
  const module = await moduleAt('../m5-runtime/trusted-release-launch.mjs');
  const values: unknown = module.SOURCE_PATHS;
  assert.ok(Array.isArray(values) && values.every((value: unknown) => typeof value === 'string'));
  const paths: string[] = [];
  for (const value of values) {
    assert.ok(typeof value === 'string');
    paths.push(value);
  }
  return paths;
}
export async function qualifyVerifierArtifact(root: string, digest: string) {
  const module = await moduleAt('../../deployment/release-verifier/artifact.mts');
  assert.ok(typeof module.qualifyVerifierArtifact === 'function');
  const result: unknown = await module.qualifyVerifierArtifact(root, digest);
  const value = object(result);
  assert.ok(typeof value.sourceTree === 'string');
  return { ...value, sourceTree: value.sourceTree };
}
export async function readVerifierStartup(path: string): Promise<unknown> {
  const module = await moduleAt('../../deployment/release-verifier/artifact.mts');
  assert.ok(typeof module.readVerifierStartup === 'function');
  const value: unknown = await module.readVerifierStartup(path);
  return value;
}
export async function writePrivatePacket(pipe: Writable, packet: Buffer, timeout?: number): Promise<void> {
  const module = await moduleAt('../release/private-pipe.mts');
  assert.ok(typeof module.writePrivatePacket === 'function');
  await module.writePrivatePacket(pipe, packet, timeout);
}
