import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { relayStudioApi } from './server/api';

// Studio is a local-only dev tool — there is no production build. Always
// run it via `npm run dev` (proxied from the project root as `npm run
// studio`) from the root of a project that has already run /relay:setup.
export default defineConfig({
  plugins: [react(), relayStudioApi()],
});
