import { expect, it } from 'vitest';
import { trimEndChars } from '../../../src/utils/trim-end-chars.js';

it('removes only the trailing run of selected characters, including long input', () => {
  expect(trimEndChars('https://host/path' + '/'.repeat(100_000), '/')).toBe('https://host/path');
  expect(trimEndChars('C:\\data\\memory' + '/\\'.repeat(100_000), '/\\')).toBe('C:\\data\\memory');
  expect(trimEndChars('unchanged', '/')).toBe('unchanged');
  expect(trimEndChars('////', '/')).toBe('');
});
