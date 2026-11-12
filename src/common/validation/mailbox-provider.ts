import {
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

export const mailboxProviders = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.es',
  'hotmail.com',
  'hotmail.es',
  'live.com',
  'live.com.ve',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'yahoo.com',
  'yahoo.es',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'aol.com',
  'zoho.com',
  'gmx.com',
  'gmx.es',
  'yandex.com',
  'mail.com',
]);

export const mailboxProviderMessage =
  'Usa un correo de Gmail, Outlook, Hotmail, iCloud u otro proveedor habitual.';

export function isMailboxProvider(value: string) {
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || at !== email.indexOf('@')) return false;
  return mailboxProviders.has(email.slice(at + 1));
}

@ValidatorConstraint({ name: 'mailboxProvider', async: false })
class MailboxProviderConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isMailboxProvider(value);
  }
  defaultMessage() {
    return mailboxProviderMessage;
  }
}

export function IsMailboxProvider() {
  return Validate(MailboxProviderConstraint);
}
