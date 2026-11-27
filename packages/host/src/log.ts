/** Tiny tagged logger. Timestamps are relative to process start, which reads well on video. */
const started = Date.now();

function stamp() {
  return `+${((Date.now() - started) / 1000).toFixed(2).padStart(7)}s`;
}

function line(level: string, tag: string, text: string) {
  return `${stamp()} ${level} ${`[${tag}]`.padEnd(10)} ${text}`;
}

export const log = {
  info: (tag: string, text: string) => console.log(line(' ', tag, text)),
  warn: (tag: string, text: string) => console.warn(line('!', tag, text)),
  error: (tag: string, text: string) => console.error(line('x', tag, text)),
};
