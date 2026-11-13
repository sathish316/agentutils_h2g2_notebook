// Thin wrapper over the user's own git binary and config (no npm dependency, no credential handling).
import { execFile } from 'node:child_process';

/** Run `git <args>` in cwd. Resolves to stdout; rejects with an Error whose message is git's own text. */
export function git(cwd, args, { timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd, timeout, maxBuffer: 32 * 1024 * 1024,
      // Never hang on a credential prompt; keep git's messages in English so callers can match them.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const text = String(stderr || '').trim() || String(stdout || '').trim() || err.message;
      reject(Object.assign(new Error(text.replace(/^(fatal|error): /gm, '')), { code: err.code, git: true }));
    });
  });
}

export const ok = (p) => p.then(() => true, () => false);
