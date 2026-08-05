import { defineConfig, devices } from '@playwright/test';

// Suite E2E real de navegador (Playwright) -- corre contra el build WEB de
// Expo (`expo export --platform web`, servido estático con `serve`), no
// contra Metro en modo dev (más lento y pensado para hot-reload, no para
// CI). El backend de Supabase se mockea 100% a nivel de red (ver
// e2e/support/supabaseMock.ts) -- las variables EXPO_PUBLIC_SUPABASE_URL/
// ANON_KEY del build de e2e apuntan a un dominio FALSO
// (e2e-mock.supabase.co) a propósito: si algún request se escapa sin
// mockear, falla por DNS en vez de pegarle silenciosamente a producción.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8090',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build:e2e-web && npx serve dist -p 8090 -s',
    url: 'http://127.0.0.1:8090',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
