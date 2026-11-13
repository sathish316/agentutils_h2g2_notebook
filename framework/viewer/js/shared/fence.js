// Shared by the browser viewer and Node tests. Keep dependency-free.
/** Parse a fence info string: `python run title="Hello world" height=300` */
export function parseInfo(info = '') {
  const out = { lang: '', flags: new Set(), opts: {} };
  const re = /([A-Za-z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))|(\S+)/g;
  let m;
  let first = true;
  while ((m = re.exec(info))) {
    if (m[5] !== undefined) {
      if (first) out.lang = m[5].toLowerCase();
      else out.flags.add(m[5].toLowerCase());
    } else {
      out.opts[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
    }
    first = false;
  }
  return out;
}
