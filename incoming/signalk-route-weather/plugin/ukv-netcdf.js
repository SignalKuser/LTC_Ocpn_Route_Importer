'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { readDownload, requireResponse } = require('./grib-forecast')

const run = promisify(execFile)
const pending = new Map()
const root = 'https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com/'
const fields = ['wind_speed_at_10m', 'wind_direction_at_10m', 'wind_gust_at_10m', 'temperature_at_screen_level', 'pressure_at_mean_sea_level']
const hour = 3600000
const source = 'Met Office UKV'

function runTime(now) {
  // Use a medium-range cycle and allow time for publication to the open archive.
  return new Date(Math.floor((now - 10 * hour) / (12 * hour)) * 12 * hour + 3 * hour)
}

function archiveStamp(time) {
  return time.toISOString().slice(0, 13).replaceAll('-', '') + '00Z'
}

async function fetchRun(directory, cycle, firstStep, onBytes) {
  await fs.mkdir(directory, { recursive: true })
  const stamp = archiveStamp(cycle)
  const signal = AbortSignal.timeout(170000)
  for (let step = firstStep; step <= firstStep + 48; step += 3) {
    const valid = archiveStamp(new Date(cycle.getTime() + step * hour))
    const prefix = `${valid}-PT${String(step).padStart(4, '0')}H00M-`
    const results = await Promise.allSettled(fields.map(async (field) => {
      const basename = `${prefix}${field}.nc`
      const target = path.join(directory, `ukv-${basename}`)
      if ((await fs.stat(target).catch((error) => {
        if (error.code !== 'ENOENT') throw error
        return null
      }))?.size > 0) return
      const response = await fetch(`${root}uk-deterministic-2km/${stamp}/${basename}`, { signal })
      if (response.status === 404) {
        await response.body?.cancel()
        return
      }
      requireResponse(response, source)
      const bytes = await readDownload(response, onBytes, 16 * 1024 * 1024)
      if (bytes.subarray(0, 8).toString('hex') !== '894844460d0a1a0a' && bytes.toString('ascii', 0, 3) !== 'CDF') {
        throw new Error('Met Office did not return a NetCDF file')
      }
      const temporary = path.join(directory, `${randomUUID()}.part`)
      try {
        await fs.writeFile(temporary, bytes, { flag: 'wx' })
        await fs.rename(temporary, target)
      } finally {
        await fs.rm(temporary, { force: true })
      }
    }))
    const error = results.find((result) => result.status === 'rejected')
    if (error) throw error.reason
  }
}

async function fetchUkvRaster(directory, latitude, longitude, onBytes, localOnly) {
  const script = path.join(__dirname, 'ukv-point.py')
  try {
    await run('python3', [script, '--check'], { timeout: 5000 })
  } catch (error) {
    if (error.code !== 'ENOENT' && !error.stderr?.includes('No module named')) throw error
    throw Object.assign(new Error('UKV NetCDF requires python3-gdal on the Signal K Pi'), { statusCode: 503 })
  }
  const now = Date.now()
  const cycle = runTime(now)
  if (!localOnly) {
    const key = path.join(directory, cycle.toISOString())
    if (!pending.has(key)) {
      const firstStep = Math.floor((now - cycle.getTime()) / (3 * hour)) * 3
      pending.set(key, fetchRun(directory, cycle, firstStep, onBytes).finally(() => pending.delete(key)))
    }
    await pending.get(key)
  }
  const { stdout } = await run('python3', [script, directory, String(latitude), String(longitude), new Date(now).toISOString()], {
    timeout: 30000, maxBuffer: 256 * 1024
  })
  return JSON.parse(stdout)
}

module.exports = { fetchUkvRaster }
