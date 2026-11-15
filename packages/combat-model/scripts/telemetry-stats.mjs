#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { periodicDefs } from '../dist/defs/index.js'
import { runCli } from '../dist/telemetry-analysis.js'

const result = runCli(process.argv.slice(2), (path) => readFileSync(path, 'utf8'), periodicDefs.actionTypes)
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exitCode = result.exitCode
