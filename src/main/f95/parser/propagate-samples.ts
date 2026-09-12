import { propagateSamples } from './sample-io'

const { copied, skipped } = propagateSamples()

if (copied.length) {
  console.log(`Copied ${copied.length} sample file(s):`)
  for (const line of copied) console.log(`  ${line}`)
} else {
  console.log('No sample files to copy.')
}

if (skipped.length) {
  console.log(`Skipped ${skipped.length}:`)
  for (const line of skipped) console.log(`  ${line}`)
}
