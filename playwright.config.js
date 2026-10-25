import { defineConfig, devices } from '@playwright/test';

const PORT = 3210;
// Optional: point at a locally installed Chromium (used where Playwright's own download is blocked).
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: executablePath
      ? { executablePath, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node src/server.js',
    url: `http://127.0.0.1:${PORT}/api/v1/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), HOST: '127.0.0.1', RATE_LIMIT_ANON: '100000' },
  },
});
