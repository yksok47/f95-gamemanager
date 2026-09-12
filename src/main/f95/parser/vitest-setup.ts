import { propagateSamples, resolveSamplesRoot, samplesAvailable } from './sample-io'

export default function setup(): void {
  if (!samplesAvailable()) {
    console.log(
      '[parser] samples root missing — parser sample tests will pass without running fixtures.'
    )
    return
  }
  console.log(`[parser] samples root: ${resolveSamplesRoot()}`)
  propagateSamples()
}
