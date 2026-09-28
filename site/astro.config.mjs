import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Social cards need absolute URLs.
  site: 'https://comment-sidecar.zainzafar.net',
  vite: {
    define: {
      // The page renders the repository's example with the extension's own code (src/lib/example.js).
      __REPOSITORY__: JSON.stringify(fileURLToPath(new URL('..', import.meta.url))),
    },
  },
});
