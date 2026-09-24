import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // A contact keeps requestJson in the 300 ms tier; without one it paces mocked requests 6 s apart.
    env: { WIKIMEDIA_CONTACT: 'tests@example.invalid' },
  },
});
