import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function renderMailTemplate(
  name: string,
  variables: Record<string, string>,
) {
  const html = readFileSync(templatePath(name), 'utf8');
  return Object.entries(variables).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, escapeHtml(value)),
    html,
  );
}

function templatePath(name: string) {
  const compiled = join(__dirname, name);
  if (existsSync(compiled)) return compiled;
  return join(process.cwd(), 'src/modules/mail/templates', name);
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
