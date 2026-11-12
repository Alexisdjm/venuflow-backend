// Project refs identify a Supabase project. They are not passwords.
// Production stays unset until the new project's ref is written here.
// A placeholder never matches a real pooler user, so production commands refuse to run.

export const STAGING_PROJECT_REF = 'tzdeylonxivsjmygccqq';
export const PRODUCTION_PROJECT_REF = 'REPLACE_WITH_PRODUCTION_PROJECT_REF';

export function isConfiguredProjectRef(ref) {
  return typeof ref === 'string' && /^[a-z0-9]{10,}$/i.test(ref);
}
