/**
 * !help — list available commands.
 *
 * `!help` lists everything.
 * `!help <command>` shows usage + the longer help text for one command.
 */

export async function help(parsed, ctx) {
  const reg = ctx.registry;
  if (!reg) return { ok: false, error: 'help: missing registry in ctx' };

  const target = parsed.args[0]?.toLowerCase().replace(/^!/, '');
  if (target) {
    if (!reg.has(target)) {
      return { ok: true, reply: `Unknown command: !${target}. Try !help for the list.` };
    }
    const entry = reg.list().find((e) => e.name === target);
    return {
      ok: true,
      reply: `**!${entry.name}** ${entry.args}\n${entry.help}`,
    };
  }

  const lines = reg.list()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => `!${e.name}${e.args ? ' ' + e.args : ''} — ${e.help.split('\n')[0]}`);
  return {
    ok: true,
    reply: `Available commands:\n\n${lines.join('\n')}\n\nUse !help <command> for details on one.`,
  };
}
