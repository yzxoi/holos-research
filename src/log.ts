/**
 * Minimal structured logger for the research system.
 * Replaces scattered console.warn/error calls with prefix-tagged messages.
 */

export const log = {
  warn(tag: string, msg: string, detail?: unknown) {
    const ts = new Date().toISOString().slice(11, 19);
    console.warn(`[${ts}] [${tag}] ${msg}`, detail ?? "");
  },
  error(tag: string, msg: string, detail?: unknown) {
    const ts = new Date().toISOString().slice(11, 19);
    console.error(`[${ts}] [${tag}] ${msg}`, detail ?? "");
  },
  info(tag: string, msg: string, detail?: unknown) {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] [${tag}] ${msg}`, detail ?? "");
  },
};
