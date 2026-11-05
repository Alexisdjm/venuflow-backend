import { Logger } from '@nestjs/common';
import { afterCommit } from './after-commit';

describe('afterCommit', () => {
  it('keeps a committed operation successful when the follow-up fails', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(
      afterCommit('mail', async () => {
        throw new Error('token=secret-link');
      }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      'mail failed after the main operation (Error)',
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret-link');
    error.mockRestore();
  });
});
