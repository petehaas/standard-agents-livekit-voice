import { defineConfig } from 'vite';
import { builder } from '@standardagents/builder';

// The Standard Agents Builder runtime is licensed for local development, and
// for production on Standard Agents hosting only. This demo runs locally.
export default defineConfig({
  plugins: [builder()],
});
