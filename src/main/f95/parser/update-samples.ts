process.env.UPDATE_PARSER_SAMPLES = '1'

const { spawnSync } = await import('node:child_process')
const { propagateSamples } = await import('./sample-io')

function runVitest(filter?: string): void {
  const args = ['vitest', 'run']
  if (filter) args.push(filter)
  const result = spawnSync('bunx', args, {
    stdio: 'inherit',
    env: process.env,
    shell: true
  })
  if (result.status) process.exit(result.status)
}

runVitest('src/main/f95/parser/firstPost')
propagateSamples()
runVitest()
process.exit(0)
