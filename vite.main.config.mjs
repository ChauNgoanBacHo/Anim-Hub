import { defineConfig, loadEnv } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return { build: { rollupOptions: { external: ['original-fs'] } }, define: {
    __ANIMATION_NOTES_SHEET_URL__: JSON.stringify(env.ANIMATION_NOTES_SHEET_URL || process.env.ANIMATION_NOTES_SHEET_URL || ''),
    __GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || ''),
    __GOOGLE_OAUTH_CLIENT_SECRET__: JSON.stringify(env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''),
    __GOOGLE_WORKSPACE_DOMAIN__: JSON.stringify(env.GOOGLE_WORKSPACE_DOMAIN || process.env.GOOGLE_WORKSPACE_DOMAIN || ''),
    __CLOSURE_SHEET_URL__: JSON.stringify(env.CLOSURE_SHEET_URL || process.env.CLOSURE_SHEET_URL || ''),
  } };
});
