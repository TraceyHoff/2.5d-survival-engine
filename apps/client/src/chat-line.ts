/** QA2: chat log line. Senders whose name is unknown (old history, players who left) read "Unknown survivor", never "#3". */
export const CHAT_TAG = ["Global", "Local", "Party", "Clan", "Trade", "Whisper", "System"];
export const UNKNOWN_SURVIVOR = "Unknown survivor";
export function chatSender(fromPlayer: number, name: (id: number) => string | undefined): string {
  return fromPlayer ? name(fromPlayer) || UNKNOWN_SURVIVOR : "";
}
export function chatLine(channel: number, who: string, text: string): string {
  return `[${CHAT_TAG[channel] ?? "?"}] ${who ? `${who}: ` : ""}${text}`;
}
