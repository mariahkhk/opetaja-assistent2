import { spawnSync } from 'child_process'

export default async function globalSetup() {
  if (process.env.E2E_SKIP_BUILD === '1') return
  console.log('[e2e] building dist/ via bun run build:dev')
  const r = spawnSync('bun', ['run', 'build:dev'], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('build:dev failed')
}
