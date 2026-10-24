import { formatReport, runPerfSession } from "./harness.js";
const n = (k: string, d: number): number => { const i = process.argv.indexOf(k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const r = await runPerfSession({ seconds: n("--seconds", 60), bots: n("--bots", 8), vehicles: n("--vehicles", 6) });
console.log(formatReport(r, 25));
if (process.argv.includes("--json")) console.log(JSON.stringify(r));
