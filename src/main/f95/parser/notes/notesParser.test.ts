import { parseNotes } from './notesParser'
import { defineParserTests } from '../test-harness'

defineParserTests('notes', parseNotes)
