import { parseReviews } from './reviewsParser'
import { defineParserTests } from '../test-harness'

defineParserTests('reviews', parseReviews)
