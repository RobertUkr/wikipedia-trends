import { describe, expect, it } from 'vitest';
import { opener } from '../src/lib/open.js';

describe('opener', () => {
  it('uses the system viewer on each desktop platform', () => {
    expect(opener('/r.pdf', 'darwin', {})).toEqual({ command: 'open', args: ['/r.pdf'] });
    expect(opener('C:\\r.pdf', 'win32', {})).toEqual({ command: 'cmd', args: ['/c', 'start', '', 'C:\\r.pdf'] });
    expect(opener('/r.pdf', 'linux', { DISPLAY: ':0' })).toEqual({ command: 'xdg-open', args: ['/r.pdf'] });
  });

  it('stays quiet when switched off, in CI, in tests or without a display', () => {
    expect(opener('/r.pdf', 'darwin', { WIKIPEDIA_TRENDS_OPEN: '0' })).toBeNull();
    expect(opener('/r.pdf', 'darwin', { CI: 'true' })).toBeNull();
    expect(opener('/r.pdf', 'darwin', { VITEST: 'true' })).toBeNull();
    expect(opener('/r.pdf', 'linux', {})).toBeNull();
  });
});
