/**
 * QA2: panel intent -> net command payload. Entity args the net command maps itself (def.entityFields: NetClient
 * converts entity -> NetId) stay local entities; only the rest are converted here. Converting both ways (the old code)
 * turned every party / clan / trade invite into a lookup of a NetId as an entity -> send failed -> "Not connected.".
 */
export function intentPayload(args: Readonly<Record<string, number | number[]>>, entities: readonly string[] | undefined, netFields: readonly string[], netIdOf: (e: number) => number | undefined): Record<string, number | number[]> | undefined {
  const out: Record<string, number | number[]> = { ...args };
  for (const k of entities ?? []) { if (netFields.includes(k)) continue; const id = netIdOf(out[k] as number); if (id === undefined) return undefined; out[k] = id; }
  return out;
}
