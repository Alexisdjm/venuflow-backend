import { IsEmail, validate } from 'class-validator';
import { IsMailboxProvider, isMailboxProvider } from './mailbox-provider';

describe('isMailboxProvider', () => {
  it('accepts common mailbox providers', () => {
    expect(isMailboxProvider('Ana.Lopez@Gmail.com')).toBe(true);
    expect(isMailboxProvider('ana@outlook.es')).toBe(true);
    expect(isMailboxProvider('ana@icloud.com')).toBe(true);
    expect(isMailboxProvider('ana@hotmail.com')).toBe(true);
  });

  it('rejects invented or incomplete addresses', () => {
    expect(isMailboxProvider('ana@spa-inventado.com')).toBe(false);
    expect(isMailboxProvider('ana@gmail.com.fake')).toBe(false);
    expect(isMailboxProvider('ana')).toBe(false);
    expect(isMailboxProvider('ana@gmail.com@gmail.com')).toBe(false);
  });
});

class StaffEmailDto {
  @IsEmail()
  @IsMailboxProvider()
  email!: string;
}

describe('staff mailbox decorator', () => {
  it('rejects an invented domain and accepts Gmail', async () => {
    const rejected = new StaffEmailDto();
    rejected.email = 'ana@spa-inventado.com';
    const accepted = new StaffEmailDto();
    accepted.email = 'ana@gmail.com';
    expect((await validate(rejected)).map((error) => error.property)).toContain('email');
    expect(await validate(accepted)).toEqual([]);
  });
});
