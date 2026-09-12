import { parseChangelogSection } from './changelogSectionParser'
import { defineParserTests } from '../test-harness'

defineParserTests('changelogSection', parseChangelogSection)
