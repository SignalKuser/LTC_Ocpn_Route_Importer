'use strict'

const { execFile } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')
const { requireResponse, requireGribTool, readDownload, readForecast, readGrid, parseForecasts } = require('./grib-forecast')

const hour = 3600000
const megabyte = 1024 * 1024
const run = promisify(execFile)
const pending = new Map()
const listings = new Map()
const knmiRoot = 'https://api.dataplatform.knmi.nl/open-data/v1/datasets/harmonie_arome_cy43_p1/versions/1.0/files'
const kmiRoot = 'https://opendata.meteo.be/ftp/forecasts/alaro_40l/'
const dwdRoot = 'https://opendata.dwd.de/weather/nwp/icon-eu/grib/'
const franceRoot = 'https://meteofrance-pnt.s3.rbx.io.cloud.ovh.net/'

function failure(message, statusCode) {
  return Object.assign(new Error(message), { statusCode })
}

async function metadata(url, source, headers, json = false) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) })
  requireResponse(response, source)
  const body = (await readDownload(response, null, 4 * megabyte)).toString('utf8')
  return json ? JSON.parse(body) : body
}

function recentListing(key, load) {
  const saved = listings.get(key)
  if (saved && saved.expires > Date.now()) return saved.promise
  const promise = load().catch((error) => {
    listings.delete(key)
    throw error
  })
  listings.set(key, { expires: Date.now() + 5 * 60000, promise })
  return promise
}

function hrefs(html) {
  return Array.from(html.matchAll(/href=["']([^"']+)["']/gi), (match) => match[1])
}

async function download(url, source, signal, onBytes, limit = 64 * megabyte, headers) {
  const response = await fetch(url, { signal, headers })
  requireResponse(response, source)
  return readDownload(response, onBytes, limit)
}

function validateGrib(bytes, source) {
  if (bytes.length < 16 || bytes.toString('ascii', 0, 4) !== 'GRIB' || bytes.toString('ascii', bytes.length - 4) !== '7777') {
    throw failure(`${source} did not return a complete GRIB file`, 502)
  }
  return bytes
}

async function cachedGrid(directory, name, build) {
  const filename = path.join(directory, name)
  if (!pending.has(filename)) {
    const promise = (async () => {
      const existing = await fs.stat(filename).catch((error) => {
        if (error.code !== 'ENOENT') throw error
        return null
      })
      if (existing?.isFile() && existing.size > 0) return filename
      await fs.mkdir(directory, { recursive: true })
      const temporary = path.join(directory, `${randomUUID()}.part`)
      try {
        await build(temporary, AbortSignal.timeout(170000))
        await fs.rename(temporary, filename)
        return filename
      } finally {
        await fs.rm(temporary, { force: true })
      }
    })().finally(() => pending.delete(filename))
    pending.set(filename, promise)
  }
  return pending.get(filename)
}

async function appendGrids(filename, files, load, source, batchSize = 3) {
  if (!files.length) throw failure(`${source} has no forecast files for the selected run`, 502)
  let written = 0
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = await Promise.allSettled(files.slice(i, i + batchSize).map(load))
    const failed = batch.find((result) => result.status === 'rejected' && ![404, 410].includes(result.reason.statusCode))
    if (failed) throw failed.reason
    for (const result of batch) {
      if (result.status !== 'fulfilled') continue
      await fs.appendFile(filename, validateGrib(result.value, source))
      written++
    }
  }
  if (!written) throw failure(`${source} has no available forecast files for the selected run`, 502)
}

async function unzipBzip2(bytes, directory) {
  const temporary = path.join(directory, `${randomUUID()}.part`)
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' })
    const { stdout } = await run('bzip2', ['-dc', temporary], { encoding: 'buffer', maxBuffer: 16 * megabyte, timeout: 12000 })
    return stdout
  } catch (error) {
    if (error.code === 'ENOENT') throw failure('DWD ICON requires bzip2 on the Signal K Pi (Debian package: bzip2)', 503)
    throw error
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

function runStamp(time) {
  return new Date(time).toISOString().slice(0, 13).replace(/[-T]/g, '')
}

function firstForecastHour(runTime) {
  return Math.max(0, Math.floor((Date.now() - runTime) / (3 * hour)) * 3)
}

async function dwdPlan(cloud) {
  const source = 'DWD ICON-EU'
  const latest = Math.floor((Date.now() - 4 * hour) / (3 * hour)) * 3 * hour
  const parameters = ['U_10M', 'V_10M', 'T_2M', 'PMSL', 'VMAX_10M']
  if (cloud) parameters.push('CLCT')
  for (let attempt = 0; attempt < 3; attempt++) {
    const time = latest - attempt * 3 * hour
    const stamp = runStamp(time)
    const runDirectory = `${dwdRoot}${stamp.slice(-2)}/`
    const catalogues = await Promise.all(parameters.map(async (param) => {
      const folder = `${runDirectory}${param.toLowerCase()}/`
      try {
        const listing = hrefs(await metadata(folder, source))
        const pattern = new RegExp(`^icon-eu_europe_regular-lat-lon_single-level_${stamp}_(\\d{3})_${param}\\.grib2\\.bz2$`, 'i')
        return new Map(listing.flatMap((name) => {
          const match = name.match(pattern)
          return match ? [[Number(match[1]), new URL(name, folder)]] : []
        }))
      } catch (error) {
        if (error.statusCode === 404) return new Map()
        throw error
      }
    }))
    const start = firstForecastHour(time)
    const [u, v] = catalogues
    const steps = [...u.keys()].filter((step) => v.has(step) && step % 3 === 0 && step >= start && step <= start + 48)
    if (steps.length < 3) continue
    return { stamp, files: steps.flatMap((step) => catalogues.flatMap((catalogue) => catalogue.has(step) ? [catalogue.get(step)] : [])) }
  }
  throw failure(`${source} has no recent complete run`, 502)
}

async function fetchDwd(directory, lat, lon, onBytes, cloud) {
  const source = 'DWD ICON-EU'
  const key = cloud ? 'dwd-icon-eu-cloud' : 'dwd-icon-eu'
  const plan = await recentListing(key, () => dwdPlan(cloud))
  const filename = await cachedGrid(directory, `${key}-${plan.stamp}.grib2`, (temporary, signal) => appendGrids(temporary, plan.files,
    async (url) => unzipBzip2(await download(url, source, signal, onBytes, 8 * megabyte), directory), source))
  return readForecast(filename, lat, lon, source)
}

async function fetchGfs(directory, latitude, longitude, onBytes, cloud) {
  const source = 'NOAA GFS'
  const cycle = Math.floor((Date.now() - 6 * hour) / (6 * hour)) * 6 * hour
  const stamp = runStamp(cycle)
  const day = stamp.slice(0, 8)
  const cycleHour = stamp.slice(-2)
  const firstStep = firstForecastHour(cycle)
  const steps = Array.from({ length: 25 }, (_, index) => firstStep + index * 3)
  const filename = await cachedGrid(directory, `noaa-gfs025-${cloud ? 'cloud-' : ''}${stamp}.grib2`, (temporary, signal) =>
    appendGrids(temporary, steps, (step) => {
      const url = new URL('https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl')
      url.search = new URLSearchParams({
        dir: `/gfs.${day}/${cycleHour}/atmos`,
        file: `gfs.t${cycleHour}z.pgrb2.0p25.f${String(step).padStart(3, '0')}`,
        lev_10_m_above_ground: 'on', lev_2_m_above_ground: 'on', lev_mean_sea_level: 'on', lev_surface: 'on',
        var_UGRD: 'on', var_VGRD: 'on', var_TMP: 'on', var_PRMSL: 'on', var_GUST: 'on'
      })
      if (cloud) {
        url.searchParams.set('lev_entire_atmosphere', 'on')
        url.searchParams.set('var_TCDC', 'on')
      }
      return download(url, source, signal, onBytes, 16 * megabyte)
    }, source, 2))
  return readForecast(filename, latitude, longitude, source)
}

async function fetchKmi(directory, lat, lon, onBytes) {
  const source = 'KMI ALARO'
  const stamp = await recentListing('kmi', async () => {
    const runs = hrefs(await metadata(kmiRoot, source)).filter((name) => /^\d{10}\/$/.test(name)).sort().reverse()
    for (const candidate of runs.slice(0, 4)) {
      const listing = hrefs(await metadata(kmiRoot + candidate, source))
      const stamp = candidate.slice(0, -1)
      if (['10U', '10V', '2T', 'MSLP'].every((field) => listing.includes(`alaro40l_${stamp}_${field}.grb`))) return stamp
    }
    throw failure(`${source} has no complete run`, 502)
  })
  const outputs = []
  for (const [field, code] of Object.entries({ '10U': '10u', '10V': '10v', '2T': '2t', MSLP: 'msl' })) {
    const name = `alaro40l_${stamp}_${field}.grb`
    const filename = await cachedGrid(directory, name, async (temporary, signal) => {
      const bytes = await download(`${kmiRoot}${stamp}/${name}`, source, signal, onBytes)
      await fs.writeFile(temporary, validateGrib(bytes, source))
    })
    const text = await readGrid(filename, lat, lon, 'shortName:s')
    outputs.push(text.replace(/^(\s*\d{8}\s+\d{1,4}\s+)\S+/gm, (_match, dateAndTime) => dateAndTime + code))
  }
  return parseForecasts(outputs.join('\n'), source)
}

async function readRange(url, start, size, source, signal, onBytes) {
  const end = start + size - 1
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal })
  requireResponse(response, source)
  if (response.status !== 206 || !response.headers.get('Content-Range')?.startsWith(`bytes ${start}-${end}/`)) {
    await response.body?.cancel()
    throw failure(`${source} did not return the requested archive range`, 502)
  }
  const bytes = await readDownload(response, onBytes, size)
  if (bytes.length !== size) throw failure(`${source} returned an incomplete archive range`, 502)
  return bytes
}

async function knmiTarEntries(url, source, signal, onBytes) {
  const entries = []
  let offset = 0
  for (let i = 0; i < 256; i++) {
    const header = await readRange(url, offset, 512, source, signal, onBytes)
    if (header.every((byte) => byte === 0)) return entries
    const name = header.toString('utf8', 0, 100).split('\0', 1)[0].split('/').at(-1)
    const sizeText = header.toString('ascii', 124, 136).replace(/\0/g, '').trim()
    const size = /^[0-7]+$/.test(sizeText) ? Number.parseInt(sizeText, 8) : NaN
    if (!Number.isSafeInteger(size) || size > 128 * megabyte) throw failure(`${source} returned an invalid archive entry`, 502)
    const match = name.match(/^HA43_N20_(\d{12})_(\d{3})([0-5]\d)_GB$/)
    if (match && size > 0) {
      entries.push({ stamp: match[1], leadMinutes: Number(match[2]) * 60 + Number(match[3]), start: offset + 512, size })
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  throw failure(`${source} archive contains too many entries`, 502)
}

async function fetchKnmi(directory, lat, lon, apiKey, onBytes) {
  const source = 'KNMI HARMONIE'
  const headers = { Authorization: apiKey }
  const name = await recentListing('knmi', async () => {
    const data = await metadata(`${knmiRoot}?maxKeys=10&orderBy=filename&sorting=desc`, source, headers, true)
    const filename = data.files?.find((file) => /^HARM43_V1_P1_\d{10}\.tar$/i.test(file.filename))?.filename
    if (!filename) throw failure(`${source} did not list a forecast archive`, 502)
    return filename
  })
  const filename = await cachedGrid(directory, `knmi-${name}.grb`, async (temporary, signal) => {
    const { temporaryDownloadUrl } = await metadata(`${knmiRoot}/${encodeURIComponent(name)}/url`, source, headers, true)
    if (!temporaryDownloadUrl || new URL(temporaryDownloadUrl).protocol !== 'https:') throw failure(`${source} did not return a secure download URL`, 502)
    const entries = await knmiTarEntries(temporaryDownloadUrl, source, signal, onBytes)
    if (!entries.length) throw failure(`${source} archive contains no HARMONIE forecast files`, 502)
    const stamp = entries[0].stamp
    const time = Date.parse(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:00Z`)
    const start = firstForecastHour(time) * 60
    const selected = entries.filter((entry) => entry.stamp === stamp && entry.leadMinutes % 180 === 0 && entry.leadMinutes >= start && entry.leadMinutes <= start + 48 * 60)
    await appendGrids(temporary, selected, (entry) => readRange(temporaryDownloadUrl, entry.start, entry.size, source, signal, onBytes), source, 2)
  })
  const output = await readGrid(filename, lat, lon, 'indicatorOfParameter:i,indicatorOfTypeOfLevel:i,level:i,timeRangeIndicator:i', 'indicatorOfParameter=1/11/33/34')
  const fields = { '1:103:0': 'msl', '11:105:2': '2t', '33:105:10': '10u', '34:105:10': '10v' }
  const lines = output.trim().split(/\r?\n/).flatMap((line) => {
    const [date, time, param, type, level, range, value] = line.trim().split(/\s+/)
    const field = fields[`${param}:${type}:${level}`]
    return field && range === '0' ? [`${date} ${time} ${field} ${value}`] : []
  })
  return parseForecasts(lines.join('\n'), source)
}

async function francePlan() {
  const source = 'Météo-France AROME'
  const latest = Math.floor((Date.now() - 4 * hour) / (3 * hour)) * 3 * hour
  for (let attempt = 0; attempt < 4; attempt++) {
    const time = latest - attempt * 3 * hour
    const stamp = runStamp(time)
    const iso = new Date(time).toISOString().replace('.000', '')
    const prefix = `pnt/${iso}/arome/0025/SP1/`
    const url = new URL(franceRoot)
    url.search = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '100' })
    const listing = await metadata(url, source)
    const start = firstForecastHour(time)
    const entries = Array.from(listing.matchAll(/<Key>([^<]+)<\/Key>/g), (match) => match[1])
      .filter((key) => key.startsWith(prefix) && /^[A-Za-z0-9_:/.-]+$/.test(key) && key.endsWith('.grib2'))
      .map((key) => ({ key, step: key.match(/__(\d{2})H__/), range: key.match(/__(\d{2})H(\d{2})H__/) }))
    const hourly = entries.filter(({ step }) => step && Number(step[1]) % 3 === 0 && Number(step[1]) >= start)
    const selected = hourly.length >= 3 ? hourly : entries.filter(({ range }) => range && Number(range[2]) >= start)
    if (selected.length >= 3) return { stamp, files: selected.map(({ key }) => new URL(key, franceRoot)) }
  }
  throw failure(`${source} has no recent surface forecast run`, 502)
}

async function fetchFrance(directory, lat, lon, onBytes) {
  const source = 'Météo-France AROME'
  if (lat < 37.5 || lat > 55.4 || lon < -12 || lon > 16) throw failure(`Waypoint is outside the ${source} grid`, 422)
  const plan = await recentListing('arome', francePlan)
  const filename = await cachedGrid(directory, `meteo-france-arome-${plan.stamp}.grib2`, (temporary, signal) => appendGrids(temporary, plan.files,
    (url) => download(url, source, signal, onBytes, 96 * megabyte), source, 2))
  return readForecast(filename, lat, lon, source)
}

async function fetchRegionalForecast(provider, directory, latitude, longitude, apiKey, onBytes, extras = []) {
  if (provider === 'knmi-grib' && !apiKey) throw failure('KNMI requires an Open Data API key. Save it on page 2.', 409)
  await requireGribTool()
  if (provider === 'dwd-grib') return fetchDwd(directory, latitude, longitude, onBytes, extras.includes('cloud'))
  if (provider === 'noaa-gfs025') return fetchGfs(directory, latitude, longitude, onBytes, extras.includes('cloud'))
  if (provider === 'kmi-grib') return fetchKmi(directory, latitude, longitude, onBytes)
  if (provider === 'knmi-grib') return fetchKnmi(directory, latitude, longitude, apiKey, onBytes)
  return fetchFrance(directory, latitude, longitude, onBytes)
}

module.exports = { fetchRegionalForecast }
