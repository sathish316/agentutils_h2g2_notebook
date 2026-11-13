// Settings: choose the default ACP agent, edit agent commands, test connections, permission mode.
import { api } from './api.js';
import { h, icon, toast } from './util.js';

const splitArgs = (s) => (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((a) => a.replace(/^["']|["']$/g, ''));
const joinArgs = (a = []) => a.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ');

async function render(root) {
  const [{ agents }, settings] = await Promise.all([api.agents(), api.settings()]);
  const save = async (patch, msg = 'Saved') => {
    try { await api.saveSettings(patch); toast(msg); render(root); } catch (err) { toast(err.message); }
  };

  const card = (a) => {
    const cmd = h('input', { value: a.command });
    const args = h('input', { value: joinArgs(a.args) });
    const env = h('input', { value: Object.entries(a.env || {}).map(([k, v]) => `${k}=${v}`).join(' '), placeholder: 'KEY=value …' });
    const result = h('div', { class: 'result' });
    const editor = h('div', { class: 'edit hidden' },
      h('label', { class: 'field' }, 'Command', cmd),
      h('label', { class: 'field' }, 'Arguments', args),
      h('label', { class: 'field full' }, 'Environment', env),
      h('div', { class: 'full', style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'pill primary', onclick: () => save({ agents: { [a.id]: { command: cmd.value.trim(), args: splitArgs(args.value), env: Object.fromEntries(splitArgs(env.value).map((kv) => kv.split(/=(.*)/s).slice(0, 2))), name: a.builtin ? undefined : a.name } } }) }, 'Save'),
        a.overridden || !a.builtin ? h('button', { class: 'pill', onclick: () => save({ agents: { [a.id]: null } }, a.builtin ? 'Reset to default' : 'Removed') }, a.builtin ? 'Reset to default' : 'Remove') : null));
    const test = async () => {
      result.textContent = 'Starting agent and opening a session…';
      try {
        const r = await api.testAgent(a.id);
        result.textContent = r.ok
          ? `✓ ACP v${r.protocolVersion} · ${r.agentInfo ? `${r.agentInfo.title || r.agentInfo.name} ${r.agentInfo.version || ''}` : 'agent'} · session opened in ${r.ms} ms`
          : `✕ ${r.error || r.sessionError}${r.hint ? `\n${r.hint}` : ''}${r.authMethods?.length ? `\nAuth methods: ${r.authMethods.join(', ')}` : ''}`;
      } catch (err) { result.textContent = `✕ ${err.message}`; }
    };
    return h('div', { class: `agent-card${settings.defaultAgent === a.id ? ' default' : ''}` },
      h('div', { class: 'top' },
        h('span', { class: `dot ${a.available ? 'ok' : 'bad'}`, title: a.available ? a.path : 'command not found on PATH' }),
        h('span', { class: 'name' }, a.name, a.overridden ? h('span', { style: { fontWeight: 400, color: 'var(--ink-faint)', fontSize: '12px' } }, '  (customized)') : null),
        settings.defaultAgent === a.id
          ? h('span', { class: 'scope' }, 'default')
          : h('button', { class: 'pill', onclick: () => save({ defaultAgent: a.id }, `${a.name} is now the default`) }, 'Make default'),
        h('button', { class: 'pill', onclick: test }, 'Test'),
        h('button', { class: 'pill', onclick: () => editor.classList.toggle('hidden'), html: icon('pen', 14) })),
      h('div', { class: 'cmd' }, `${a.command} ${joinArgs(a.args)}`),
      result, editor);
  };

  const addId = h('input', { placeholder: 'id, e.g. my-agent' });
  const addName = h('input', { placeholder: 'Display name' });
  const addCmd = h('input', { placeholder: 'command' });
  const addArgs = h('input', { placeholder: 'args' });

  const repoCard = (place, title, blurb) => {
    const st = settings.repoStatus?.[place] || {};
    const input = h('input', { value: st.url || '', placeholder: 'git URL, e.g. git@github.com:me/notes.git or a local path', spellcheck: false, 'aria-label': `${title} git URL` });
    const status = h('div', { class: `status${st.configured && !st.cloned ? ' bad' : ''}` },
      !st.configured ? 'Not set. Notebooks cannot be moved here.' : st.cloned ? 'Cloned and ready.' : 'Set, but the local clone is missing. Save again to re-clone.');
    const apply = async (url, doneMsg) => {
      status.className = 'status';
      status.textContent = url ? 'Cloning…' : 'Clearing…';
      try { await api.saveSettings({ repos: { [place]: url } }); toast(doneMsg); render(root); } catch (err) { status.className = 'status bad'; status.textContent = err.message; }
    };
    return h('div', { class: 'repo-card' },
      h('div', { class: 'name', style: { fontWeight: 650, marginBottom: '2px' } }, title),
      h('p', { class: 'help', style: { margin: '0 0 10px' } }, blurb),
      h('div', { class: 'row' }, input,
        h('button', { class: 'pill primary', onclick: () => input.value.trim() && apply(input.value.trim(), `${title} saved and cloned`) }, 'Save'),
        st.configured ? h('button', { class: 'pill', onclick: () => apply('', `${title} cleared`) }, 'Clear') : null),
      status);
  };
  const commitAgent = h('select', { 'aria-label': 'Commit message agent', onchange: (e) => save({ commitAgent: e.target.value || null }, 'Commit message agent updated') },
    h('option', { value: '', selected: !settings.commitAgent }, 'None (use default message)'),
    agents.map((a) => h('option', { value: a.id, selected: settings.commitAgent === a.id }, a.name)));

  root.replaceChildren(
    h('section', { class: 'sheet-static' },
      h('h1', {}, 'Settings'),
      h('p', { class: 'help' }, 'Notebook viewers talk to ACP agents through this server. The agent starts in the repo root, reads AGENTS.md, and is told which notebook to update. Each notebook remembers the agent you pick in its composer; new notebooks use the default.')),
    h('section', { class: 'sheet-static' },
      h('h2', {}, 'Agents'),
      h('p', { class: 'help' }, 'Green dot = command found on PATH. “Test” starts the agent, performs the ACP handshake and opens a session.'),
      agents.map(card),
      h('details', {}, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, 'Add a custom ACP agent'),
        h('div', { class: 'agent-card', style: { marginTop: '10px' } },
          h('div', { class: 'edit' },
            h('label', { class: 'field' }, 'Id', addId), h('label', { class: 'field' }, 'Name', addName),
            h('label', { class: 'field' }, 'Command', addCmd), h('label', { class: 'field' }, 'Arguments', addArgs),
            h('div', { class: 'full' }, h('button', {
              class: 'pill primary',
              onclick: () => addId.value && addCmd.value && save({ agents: { [addId.value.trim()]: { name: addName.value.trim() || addId.value.trim(), command: addCmd.value.trim(), args: splitArgs(addArgs.value) } } }, 'Agent added'),
            }, 'Add agent')))))),
    h('section', { class: 'sheet-static' },
      h('h2', {}, 'Saved and shared notebooks'),
      h('p', { class: 'help' }, 'A notebook can live Local (notebooks/, untracked), Saved (your own git repo) or Shared (a second repo for notebooks others should read). Each repo is cloned into .h2g2/ on this machine and uses your existing git credentials (SSH keys or credential helper); H2G2 stores none. Change a notebook’s place from the gear on its cover in the library.'),
      repoCard('saved', 'Saved repo', 'Private or public. Sync commits “Saved notes updates” unless a commit message agent is chosen below.'),
      repoCard('shared', 'Shared repo', 'For notebooks others should read. Sync commits “Shared notes updates” by default.'),
      h('div', { class: 'repo-card' },
        h('div', { class: 'name', style: { fontWeight: 650, marginBottom: '2px' } }, 'Commit message agent'),
        h('p', { class: 'help', style: { margin: '0 0 10px' } }, 'Sync gives this agent the notebook’s diff and asks for a short message. If it is not set, fails or times out, the default message is used and the commit still happens.'),
        h('div', { class: 'row' }, commitAgent))),
    h('section', { class: 'sheet-static' },
      h('h2', {}, 'Permissions'),
      h('p', { class: 'help' }, 'When an agent asks to edit files or run commands: “Ask” shows approve/deny buttons in the activity drawer; “Auto” approves automatically for requests that are allowed to write (never for “Just answer”).'),
      h('div', { class: 'seg' }, settings.permissionModes.map((m) => h('button', {
        class: settings.permissionMode === m ? 'on' : '', onclick: () => save({ permissionMode: m }),
      }, m === 'ask' ? 'Ask me' : 'Auto-approve')))));
}

const root = h('main', { class: 'settings' });
document.body.append(
  h('header', { class: 'toolbar' },
    h('a', { class: 'tbtn', href: '/', html: `${icon('shelf')}<span>Library</span>` }),
    h('span', { class: 'spacer' })),
  root);
render(root).catch((err) => toast(err.message));
