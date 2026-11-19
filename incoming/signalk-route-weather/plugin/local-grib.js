'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { requireGribTool, requireResponse, readDownload } = require('./grib-forecast')

const run = promisify(execFile)
const MAX_GRIB_BYTES = 128 * 1024 * 1024
const FILE_ID = /^[a-f0-9]{64}$/
const GRIB_NAME = /\.(?:grb2?|grib2?)$/i

// Group fields with the same physical meaning. Keep near-surface wind and temperature separate from pressure levels.
function fieldFor({ shortName, typeOfLevel, level, discipline, parameterCategory, parameterNumber, centre }) {
  if (['10u', '10v'].includes(shortName)) return shortName === '10u' ? 'u' : 'v'
  if (['u', 'v'].includes(shortName) && typeOfLevel === 'heightAboveGround' && Number(level) === 10) return shortName
  if (shortName === '2t' || (shortName === 't' && typeOfLevel === 'heightAboveGround' && Number(level) === 2)) return 'temperature'
  if (['r', 'rh'].includes(shortName) && (typeOfLevel !== 'heightAboveGround' || Number(level) !== 2)) return null
  const field = ({
    msl: 'pressure', prmsl: 'pressure', gust: 'gust', fg: 'gust', '10fg': 'gust',
    vis: 'visibility', tp: 'precipitation', tcc: 'cloud', '2r': 'humidity', r: 'humidity', rh: 'humidity',
    swh: 'waveHeight', mwd: 'waveDirection', mwp: 'wavePeriod',
    shww: 'windWaveHeight', shts: 'swellHeight', sst: 'seaTemperature',
    zos: 'seaLevel', uo: 'currentU', vo: 'currentV', uc: 'currentU', vc: 'currentV',
    cape: 'cape', cin: 'cin', refc: 'reflectivity', ci: 'iceCover', icec: 'iceCover',
    sithick: 'iceThickness', icetk: 'iceThickness', '2d': 'dewPoint'
  })[shortName]
  if (field) return field
  const code = `${discipline}/${parameterCategory}/${parameterNumber}`
  if (code === '0/16/196' && ['kwbc', '7'].includes(String(centre))) return 'reflectivity'
  return ({
    '0/1/8': 'precipitation', '0/2/22': 'gust', '0/3/1': 'pressure', '0/6/1': 'cloud',
    '0/7/6': 'cape', '0/7/7': 'cin', '0/19/0': 'visibility',
    '10/0/3': 'waveHeight', '10/0/14': 'waveDirection', '10/0/15': 'wavePeriod',
    '10/2/0': 'iceCover', '10/2/1': 'iceThickness'
  })[code] || null
}

const CORE = new Set(['u', 'v', 'temperature', 'pressure', 'gust'])
const MARINE = new Set(['waveHeight', 'waveDirection', 'wavePeriod', 'windWaveHeight', 'swellHeight',
  'seaTemperature', 'seaLevel', 'currentU', 'currentV', 'iceCover', 'iceThickness'])

function problem(message, statusCode = 422) {
  return Object.assign(new Error(message), { statusCode })
}

function validateGrib(bytes) {
  if (!bytes.length || bytes.length > MAX_GRIB_BYTES) throw problem('GRIB file must be between 1 byte and 128 MiB', 413)
  for (let offset = 0; offset < bytes.length;) {
    if (bytes.length - offset < 12 || bytes.toString('ascii', offset, offset + 4) !== 'GRIB') {
      throw problem('Expected a GRIB1 or GRIB2 message')
    }
    const edition = bytes[offset + 7]
    if (edition !== 1 && (edition !== 2 || bytes.length - offset < 20)) throw problem('Unsupported GRIB edition')
    const length = edition === 1 ? bytes.readUIntBE(offset + 4, 3) : Number(bytes.readBigUInt64BE(offset + 8))
    if (length < (edition === 1 ? 12 : 20) || length > bytes.length - offset ||
        bytes.toString('ascii', offset + length - 4, offset + length) !== '7777') {
      throw problem('Incomplete GRIB message')
    }
    offset += length
  }
}

async function gribCommand(command, args) {
  try {
    const { stdout } = await run(command, args, { timeout: 45000, maxBuffer: 12 * 1024 * 1024 })
    return stdout
  } catch (error) {
    if (error.code === 'ENOENT') throw problem('GRIB extraction requires libeccodes-tools on the Signal K Pi', 503)
    throw problem(`${command} could not read the GRIB: ${error.stderr?.trim().split(/\r?\n/)[0] || error.message}`)
  }
}

function hasCoverage(grid, lat, lon) {
  if (grid.gridType !== 'regular_ll') return true
  const [firstLat, lastLat, firstLon, lastLon, increment, width] =
    ['latitudeOfFirstGridPointInDegrees', 'latitudeOfLastGridPointInDegrees', 'longitudeOfFirstGridPointInDegrees',
      'longitudeOfLastGridPointInDegrees', 'iDirectionIncrementInDegrees', 'Ni'].map((key) => Number(grid[key]))
  if (![firstLat, lastLat, firstLon, lastLon, increment, width].every(Number.isFinite)) return false
  if (lat < Math.min(firstLat, lastLat) - 0.000001 || lat > Math.max(firstLat, lastLat) + 0.000001) return false
  if (increment * width >= 359.9999) return true
  const eastward = (value) => ((value % 360) + 360) % 360
  const west = Number(grid.iScansNegatively) ? lastLon : firstLon
  const east = Number(grid.iScansNegatively) ? firstLon : lastLon
  return eastward(lon - west + 0.000001) <= eastward(east - west) + 0.000002
}

function forecastDate(date, hhmm) {
  if (!/^\d{8}$/.test(date) || !/^\d{1,4}$/.test(hhmm)) return null
  const time = hhmm.padStart(4, '0')
  const value = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${time.slice(0, 2)}:${time.slice(2)}:00Z`
  return Number.isFinite(Date.parse(value)) ? value : null
}

function extraValue(field, value, units) {
  if (field === 'cloud' || field === 'humidity' || field === 'iceCover') return units === '%' || units === 'percent' ? value : value * 100
  if (field === 'precipitation') return units === 'm' ? value * 1000 : value
  if (field === 'seaTemperature' || field === 'dewPoint') return units === 'K' ? value - 273.15 : value
  return value
}

function createGribLibrary(directory) {
  const cache = new Map()
  const pending = new Map()
  const deleting = new Set()
  const readers = new Map()

  async function load(id) {
    if (!FILE_ID.test(id)) throw problem('Invalid GRIB file ID', 400)
    if (!cache.has(id)) {
      const filename = path.join(directory, `${id}.json`)
      try { cache.set(id, JSON.parse(await fs.readFile(filename, 'utf8'))) } catch (error) {
        if (error.code === 'ENOENT') throw problem('GRIB file not found', 404)
        throw error
      }
    }
    return cache.get(id)
  }

  async function save(bytes, filename) {
    validateGrib(bytes)
    const name = path.basename(String(filename || 'weather.grb').replace(/\\/g, '/')).slice(0, 180)
    const id = createHash('sha256').update(bytes).update('\0').update(name).digest('hex')
    if (deleting.has(id)) throw problem('This GRIB file is being deleted', 409)
    if (pending.has(id)) return pending.get(id)
    const operation = (async () => {
      try { return (await load(id)).file } catch (error) { if (error.statusCode !== 404) throw error }
      await requireGribTool()
      await fs.mkdir(directory, { recursive: true })
      const target = path.join(directory, `${id}.grib`)
      const temporary = path.join(directory, `${randomUUID()}.part`)
      const metadataTemp = `${temporary}.json`
      try {
        await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
        const keys = 'shortName,typeOfLevel,level,units,centre,discipline,parameterCategory,parameterNumber,gridType,latitudeOfFirstGridPointInDegrees,latitudeOfLastGridPointInDegrees,longitudeOfFirstGridPointInDegrees,longitudeOfLastGridPointInDegrees,iDirectionIncrementInDegrees,Ni,iScansNegatively'
        const { messages } = JSON.parse(await gribCommand('grib_ls', ['-j', '-p', keys, temporary]))
        const fields = messages.map((message) => ({ ...message, field: fieldFor(message) }))
        const supported = new Set(fields.map(({ field }) => field).filter((field) => field && !CORE.has(field)))
        if (supported.has('currentU') && supported.has('currentV')) {
          supported.add('currentSpeed')
          supported.add('currentDirection')
        }
        supported.delete('currentU')
        supported.delete('currentV')
        if (!supported.size && !fields.some(({ field }) => CORE.has(field))) throw problem('No supported weather fields in the GRIB file')
        const file = { id, name, bytes: bytes.length, extras: [...supported], savedAt: new Date().toISOString() }
        const metadata = { file, fields }
        await fs.writeFile(metadataTemp, JSON.stringify(metadata), { flag: 'wx', mode: 0o600 })
        await fs.rename(temporary, target)
        await fs.rename(metadataTemp, path.join(directory, `${id}.json`))
        cache.set(id, metadata)
        return file
      } finally {
        await Promise.all([fs.rm(temporary, { force: true }), fs.rm(metadataTemp, { force: true })])
      }
    })().finally(() => pending.delete(id))
    pending.set(id, operation)
    return operation
  }

  async function importPath(filename) {
    if (typeof filename !== 'string' || !path.isAbsolute(filename) || !GRIB_NAME.test(filename)) {
      throw problem('Enter an absolute path to a GRIB file on the Signal K Pi', 400)
    }
    try {
      const stat = await fs.stat(filename)
      if (!stat.isFile() || stat.size > MAX_GRIB_BYTES) throw problem('Expected a regular GRIB file up to 128 MiB', 413)
      const file = await fs.open(filename, 'r')
      try {
        const bytes = await readDownload({ body: file.createReadStream({ autoClose: false }) }, undefined, MAX_GRIB_BYTES)
        return await save(bytes, filename)
      } finally {
        await file.close()
      }
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw problem('The Pi cannot read this GRIB path', 400)
      throw error
    }
  }

  async function importUrl(address) {
    let url
    try { url = new URL(address) } catch { throw problem('Enter a direct HTTP(S) GRIB URL', 400) }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw problem('Enter a direct HTTP(S) GRIB URL without credentials', 400)
    const response = await fetch(url, { signal: AbortSignal.timeout(90000) })
    requireResponse(response, 'GRIB download')
    let name
    try { name = decodeURIComponent(path.basename(new URL(response.url).pathname)) } catch { name = '' }
    return save(await readDownload(response, undefined, MAX_GRIB_BYTES), GRIB_NAME.test(name) ? name : 'download.grib')
  }

  async function list() {
    const entries = await fs.readdir(directory).catch((error) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const files = await Promise.all(entries.filter((name) => name.endsWith('.json') && FILE_ID.test(name.slice(0, -5)))
      .map(async (name) => {
        const id = name.slice(0, -5)
        if (deleting.has(id)) return null
        try { return JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')).file } catch (error) {
          if (error.code === 'ENOENT') return null
          throw error
        }
      }))
    return files.filter((file) => file && !deleting.has(file.id)).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  async function remove(id) {
    if (!FILE_ID.test(id)) throw problem('Invalid GRIB file ID', 400)
    if (pending.has(id) || deleting.has(id) || readers.has(id)) throw problem('This GRIB file is currently in use', 409)
    deleting.add(id)
    const metadata = path.join(directory, `${id}.json`)
    const staged = path.join(directory, `${randomUUID()}.deleted`)
    try {
      try { await fs.rename(metadata, staged) } catch (error) {
        if (error.code === 'ENOENT') throw problem('GRIB file not found', 404)
        throw error
      }
      try { await fs.rm(path.join(directory, `${id}.grib`), { force: true }) } catch (error) {
        await fs.rename(staged, metadata)
        throw error
      }
      cache.delete(id)
      await fs.rm(staged, { force: true })
    } finally {
      deleting.delete(id)
    }
  }

  async function readForecast(id, lat, lon, requested) {
    const { file, fields } = await load(id)
    const filename = path.join(directory, `${id}.grib`)
    const missing = 999999999
    const stdout = await gribCommand('grib_get', ['-f', '-F', '%.15g', '-s', `missingValue=${missing}`,
      '-p', 'count:i,validityDate:i,validityTime:i', '-l', `${lat},${lon},1`, filename])
    const selection = new Set(requested)
    const records = new Map()
    const marine = new Map()
    for (const line of stdout.trim().split(/\r?\n/)) {
      const [index, date, time, valueText] = line.trim().split(/\s+/)
      const value = Number(valueText)
      const stamp = forecastDate(date, time)
      const grid = fields[Number(index) - 1]
      const field = grid?.field
      if (!field || !stamp || !Number.isFinite(value) || value === missing || !hasCoverage(grid, lat, lon)) continue
      const current = field === 'currentU' || field === 'currentV'
      if (!CORE.has(field) && !(current ? selection.has('currentSpeed') || selection.has('currentDirection') : selection.has(field))) continue
      const group = MARINE.has(field) ? marine : records
      if (!group.has(stamp)) group.set(stamp, {})
      const values = group.get(stamp)
      values[field] ??= CORE.has(field) ? value : extraValue(field, value, grid.units)
    }
    const atmosphere = [...records].map(([date, values]) => {
      const { u, v, temperature, pressure, gust, ...extras } = values
      const wind = Number.isFinite(u) && Number.isFinite(v)
        ? { speed: Math.hypot(u, v), directionTrue: (Math.atan2(-u, -v) + 2 * Math.PI) % (2 * Math.PI), gust }
        : { gust }
      return { date, wind, outside: { temperature, pressure }, extras, source: file.name }
    })
    const sea = [...marine].map(([date, { currentU, currentV, ...extras }]) => {
      if (Number.isFinite(currentU) && Number.isFinite(currentV)) {
        if (selection.has('currentSpeed')) extras.currentSpeed = Math.hypot(currentU, currentV) * 1.9438444924406
        if (selection.has('currentDirection')) extras.currentDirection = (Math.atan2(currentU, currentV) * 180 / Math.PI + 360) % 360
      }
      return { date, extras }
    })
    if (!atmosphere.length && !sea.length) throw problem('No GRIB data at this waypoint', 404)
    return { forecasts: atmosphere, marine: sea }
  }

  async function forecast(id, lat, lon, requested) {
    if (deleting.has(id)) throw problem('This GRIB file is being deleted', 409)
    readers.set(id, (readers.get(id) || 0) + 1)
    try {
      return await readForecast(id, lat, lon, requested)
    } finally {
      const remaining = readers.get(id) - 1
      if (remaining) readers.set(id, remaining)
      else readers.delete(id)
    }
  }

  return { save, importPath, importUrl, list, remove, forecast }
}

module.exports = { createGribLibrary, validateGrib, MAX_GRIB_BYTES, fieldFor, hasCoverage }
