import assert from 'node:assert/strict';
import test from 'node:test';
import { other, parseTheme } from '../../web/src/lib/theme.js';

/* The web app has no test runner of its own, so its one pure module is covered from
   the MCP server suite. It is here rather than beside the code because a test nothing
   executes is worse than no test.

   Parsing the cookie is the framework's job (`getCookie`); validating what came
   out of it is this module's, and that is what these cover. */

test('parseTheme admits exactly the two schemes, and nothing else pins one', () => {
  const cases: Array<{ value: string | undefined; want: string | undefined }> = [
    { value: 'dark', want: 'dark' },
    { value: 'light', want: 'light' },
    /* Absent is not dark. A reader who has never touched the toggle has chosen
       nothing, and `color-scheme: light dark` must be left to defer to the OS. */
    { value: undefined, want: undefined },
    { value: '', want: undefined },
    /* A stale or hand-edited cookie is treated as no pin rather than a default. */
    { value: 'Dark', want: undefined },
    { value: 'solarized', want: undefined },
    { value: 'dark light', want: undefined },
  ];

  for (const { value, want } of cases) {
    assert.equal(parseTheme(value), want, `value ${JSON.stringify(value)}`);
  }
});

test('other flips between the two schemes', () => {
  assert.equal(other('dark'), 'light');
  assert.equal(other('light'), 'dark');
});
