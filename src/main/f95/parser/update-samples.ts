process.env.UPDATE_PARSER_SAMPLES = '1'

const { spawnSync } = await import('node:child_process')
const { propagateSamples, samplesAvailable } = await import('./sample-io')

if (!samplesAvailable()) {
  console.error(
    'Parser samples root not found. Expected sibling repo f95-gamemanager-parser-samples or parser/samples junction.'
  )
  process.exit(1)
}

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
