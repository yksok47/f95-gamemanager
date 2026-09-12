import { parseChangelog } from './changelogParser'
import { defineParserTests } from '../test-harness'

defineParserTests('changelog', parseChangelog)
