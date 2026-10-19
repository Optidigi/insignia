import { createDurableCore, type DurableCore } from '@insignia/database';
import { Pool } from 'pg';

type Overrides = { [K in keyof DurableCore]?: Partial<DurableCore[K]> };

/** Complete real repository interfaces, with a transport that can never reach PostgreSQL.
 * Tests override only the operations their scenario permits; an unexpected SQL operation fails.
 */
export function durableCoreFixture(overrides: Overrides): DurableCore {
  const pool = new Pool();
  const deny = () => {
    throw new Error('Unexpected database operation in worker unit fixture');
  };
  Object.defineProperty(pool, 'query', { value: deny });
  Object.defineProperty(pool, 'connect', { value: deny });
  const core = createDurableCore(pool);
  for (const key in overrides) {
    const descriptor = Object.getOwnPropertyDescriptor(overrides, key);
    if (descriptor && !Reflect.set(core, key, Object.assign({}, Reflect.get(core, key), descriptor.value)))
      throw new Error('Repository fixture override unavailable');
  }
  return core;
}
