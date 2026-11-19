'use strict'

const { execFile } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')

const run = promisify(execFile)
const cacheAge = 3 * 60 * 60 * 1000
const downloads = new Map()

function requireResponse(response, provider) {
  if (response.ok) return
  const error = new Error(`${provider} API returned HTTP ${response.status} ${response.statusText}`)
  error.statusCode = response.status
  error.retryAfter = response.headers.get('Retry-After')
  throw error
}

async function readDownload(response, onBytes, limit = Infinity) {
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    onBytes?.(chunk.byteLength)
    if (size > limit) throw new Error('Weather response exceeds the allowed download size')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

async function downloadGrid(directory, name, url, onBytes) {
  const filename = path.join(directory, name)
  const info = await fs.stat(filename).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (info && Date.now() - info.mtimeMs < cacheAge) return filename

  await fs.mkdir(directory, { recursive: true })
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  requireResponse(response, 'FMI HARMONIE')
  const bytes = await readDownload(response, onBytes, 12 * 1024 * 1024)
  if (bytes.toString('ascii', 0, 4) !== 'GRIB' || bytes.subarray(-4).toString('ascii') !== '7777') {
    throw new Error('FMI did not return a complete GRIB file')
  }
  const temporary = path.join(directory, `${randomUUID()}.part`)
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' })
    await fs.rename(temporary, filename)
  } finally {
    await fs.rm(temporary, { force: true })
  }
  return filename
}

function parseForecasts(output, source) {
  const times = new Map()
  for (const line of output.trim().split(/\r?\n/)) {
    const [date, time, shortName, valueText] = line.trim().split(/\s+/)
    const value = Number(valueText)
    if (!/^\d{8}$/.test(date) || !/^\d{1,4}$/.test(time) || !Number.isFinite(value)) continue
    const hhmm = time.padStart(4, '0')
    const stamp = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`
    if (!Number.isFinite(Date.parse(stamp))) continue
    const fields = times.get(stamp) || {}
    fields[shortName] = value
    times.set(stamp, fields)
  }
  const records = []
  for (const [date, fields] of times) {
    const u = fields['10u'] ?? fields.u
    const v = fields['10v'] ?? fields.v
    if (!Number.isFinite(u) || !Number.isFinite(v) || Math.abs(u) > 150 || Math.abs(v) > 150) continue
    const cloud = fields.tcc
    // GRIB editions and local tables can encode total cloud cover as a fraction or percent.
    const cloudPercent = Number.isFinite(cloud) && cloud >= 0 && cloud <= 100
      ? (source.startsWith('ECMWF') ? cloud * 100 : cloud)
      : null
    records.push({
      date,
      wind: { speed: Math.hypot(u, v), directionTrue: (Math.atan2(-u, -v) + 2 * Math.PI) % (2 * Math.PI), gust: fields['10fg'] ?? fields.fg ?? fields.gust },
      outside: { temperature: fields['2t'] ?? fields.t, pressure: fields.msl ?? fields.prmsl },
      extras: cloudPercent !== null && cloudPercent <= 100 ? { cloud: cloudPercent } : undefined,
      source
    })
  }
  if (!records.length) throw new Error(`${source} GRIB does not contain a usable wind forecast at this waypoint`)
  return records.sort((a, b) => a.date.localeCompare(b.date))
}

async function requireGribTool() {
  try {
    await run('grib_get', ['-V'], { timeout: 4000 })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const missing = new Error('GRIB forecasts need grib_get on the Signal K Pi (Debian package: libeccodes-tools)')
    missing.statusCode = 503
    throw missing
  }
}

async function readGrid(filename, latitude, longitude, keys, where) {
  const { stdout } = await run('grib_get', [
    ...(where ? ['-w', where] : []), '-p', `validityDate:i,validityTime:i,${keys}`,
    '-l', `${latitude},${longitude},1`, filename
  ], { timeout: 25000, maxBuffer: 512 * 1024 })
  return stdout
}

async function readForecast(filename, latitude, longitude, source) {
  return parseForecasts(await readGrid(filename, latitude, longitude, 'shortName:s'), source)
}

async function fetchFmiForecast(directory, latitude, longitude, onBytes) {
  await requireGribTool()
  const south = Math.floor(latitude * 4) / 4
  const west = Math.floor(longitude * 4) / 4
  const name = `fmi-${south}-${west}.grib2`
  const key = path.join(directory, name)
  const url = new URL('https://opendata.fmi.fi/download')
  url.search = new URLSearchParams({
    producer: 'harmonie_scandinavia_surface', param: 'Temperature,WindUMS,WindVMS',
    bbox: [west - 0.03, south - 0.03, west + 0.28, south + 0.28].join(','),
    format: 'grib2', projection: 'EPSG:4326', timestep: '60', levels: '0'
  })
  if (!downloads.has(key)) {
    downloads.set(key, downloadGrid(directory, name, url, onBytes).finally(() => downloads.delete(key)))
  }
  const filename = await downloads.get(key)
  return readForecast(filename, latitude, longitude, 'FMI HARMONIE')
}

module.exports = { fetchFmiForecast, requireResponse, requireGribTool, readForecast, readDownload, readGrid, parseForecasts }
