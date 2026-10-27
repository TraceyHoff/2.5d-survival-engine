// ADR-205: friendly text for server rejections of the inventory arrange commands (split / move / container -> hotbar).
import type { CommandDef } from "@engine/core";
import { INVENTORY_OP_COMMANDS, INVENTORY_OP_REJECT_TEXT } from "@engine/gameplay";
export function inventoryOpRejectText(cmd: CommandDef | undefined, reason: string): string | undefined {
  if (!cmd || !INVENTORY_OP_COMMANDS.includes(cmd)) return undefined;
  return (INVENTORY_OP_REJECT_TEXT as Readonly<Record<string, string>>)[reason] ?? "Couldn't rearrange that.";
}
