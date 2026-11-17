// Fail-fast helpers: surface broken assumptions immediately with a clear message.

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** Map lookup that throws instead of returning undefined. */
export function mustGet<K, V>(map: Map<K, V>, key: K, what: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`${what} not found: ${String(key)}`);
  }
  return value;
}

/** Array index access that throws instead of returning undefined. */
export function at<T>(items: readonly T[], index: number, what: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`${what}: index ${index} out of range (length ${items.length})`);
  }
  return item;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
