import { spanishValidationMessages } from './spanish-validation';

describe('spanishValidationMessages', () => {
  it('turns class-validator errors into Spanish', () => {
    expect(
      spanishValidationMessages([
        {
          property: 'customerNationalId',
          constraints: { matches: 'customerNationalId must match' },
          children: [],
        },
        {
          property: 'customerEmail',
          constraints: { isEmail: 'customerEmail must be an email' },
          children: [],
        },
      ]),
    ).toEqual([
      'La cédula no tiene el formato correcto.',
      'El correo no es un correo válido.',
    ]);
  });

  it('explains a mailbox outside the usual providers', () => {
    expect(
      spanishValidationMessages([
        {
          property: 'email',
          constraints: { mailboxProvider: 'domain' },
          children: [],
        },
      ]),
    ).toEqual([
      'Usa un correo de Gmail, Outlook, Hotmail, iCloud u otro proveedor habitual.',
    ]);
  });

  it('explains a reserved public slug', () => {
    expect(
      spanishValidationMessages([
        {
          property: 'slug',
          constraints: { publicSpaSlug: 'reserved' },
          children: [],
        },
      ]),
    ).toEqual(['Ese identificador no puede usarse como dirección pública.']);
  });
});
