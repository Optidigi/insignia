// Reflective replacement is confined to callable own exports of Node builtins.
// Export shapes remain Node's; every selected function is replaced with a refusal.
export function denyFunctions(module: object, deny: () => never): void {
  for (const key of Object.keys(module)) {
    const value: unknown = Reflect.get(module, key);
    if (typeof value === 'function' && !/^[A-Z]/.test(key)) Reflect.set(module, key, deny);
  }
}
