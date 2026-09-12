import { parseDeveloperNotes } from './developerNotesParser'
import { defineParserTests } from '../test-harness'

defineParserTests('developerNotes', parseDeveloperNotes)
