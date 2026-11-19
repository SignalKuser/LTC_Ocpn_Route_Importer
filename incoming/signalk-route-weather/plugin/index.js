'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const openApi = require('../openApi.json')
const { createCurrentPredictor } = require('./current-predictor')
const { fetchFmiForecast, requireResponse, readDownload } = require('./grib-forecast')
const { fetchEcmwfForecast } = require('./ecmwf-grib')
const { fetchRegionalForecast } = require('./regional-grib')
const { fetchUkvRaster } = require('./ukv-netcdf')
const { createGribLibrary, MAX_GRIB_BYTES } = require('./local-grib')
const { createReceiver } = require('./qtvlm')
const { storeQtVlm } = require('./qtvlm-storage')

const PLUGIN_ID = 'signalk-route-weather'
const { version: PACKAGE_VERSION, signalk: { displayName: DISPLAY_NAME } } = require('../package.json')
const LTC_SCHEMA = 'ltc-speech2polardata-2'
const DEFAULTS = { polarDirectory: '', currentDirectory: '', gpxDirectory: '', providerKeys: {}, metNoContact: '', gribSources: [], qtVlmEnabled: false }
const MAX_GPX_BYTES = 2 * 1024 * 1024
const MAX_QTVLM_TRACK_BYTES = 16 * 1024 * 1024
const DIRECT_PROVIDERS = [
  { id: 'local-grib', label: 'Own GRIB file', format: 'GRIB', kind: 'local', available: true },
  { id: 'open-meteo', label: 'Open-Meteo', kind: 'direct', available: true },
  { id: 'met-no', label: 'MET Norway (met.no)', kind: 'direct', available: true },
  { id: 'dwd-grib', label: 'DWD ICON-EU', format: 'GRIB', kind: 'raster', raster: true, available: true },
  { id: 'knmi-grib', label: 'KNMI HARMONIE', format: 'GRIB', kind: 'raster', raster: true, available: true },
  { id: 'kmi-grib', label: 'KMI ALARO', format: 'GRIB', kind: 'raster', raster: true, available: true },
  { id: 'dmi-grib', label: 'DMI HARMONIE', format: 'API', kind: 'raster', raster: true, extraction: 'point', available: true },
  { id: 'fmi-grib', label: 'FMI HARMONIE', format: 'GRIB', kind: 'raster', raster: true, available: true },
  { id: 'meteo-france-grib', label: 'Météo-France AROME', format: 'GRIB', kind: 'raster', raster: true, available: true },
  { id: 'ecmwf-grib', label: 'ECMWF IFS 0.25°', format: 'GRIB', kind: 'raster', raster: true, available: true },
  { id: 'ecmwf-01-grib', label: 'ECMWF IFS 0.1°', format: 'GRIB', kind: 'raster', raster: true, available: true },
  { id: 'dwd-icon-d2', label: 'DWD ICON-D2', kind: 'direct', available: true },
  { id: 'dwd-icon-global', label: 'DWD ICON Global', kind: 'direct', available: true },
  { id: 'ukmo-ukv', label: 'Met Office UKV', kind: 'direct', available: true },
  { id: 'ukmo-ukv-netcdf', label: 'Met Office UKV', format: 'NetCDF', kind: 'raster', raster: true, available: true },
  { id: 'noaa-gfs025', label: 'NOAA GFS', format: 'GRIB', kind: 'raster', raster: true, available: true }
]

const OPEN_METEO_MODELS = {
  'open-meteo': { days: 7 },
  'dwd-icon-d2': { model: 'dwd_icon_d2', days: 2 },
  'dwd-icon-global': { model: 'dwd_icon_global', days: 7 },
  'ukmo-ukv': { model: 'ukmo_uk_deterministic_2km', days: 2 }
}
const ATMOSPHERIC_EXTRAS = {
  'open-meteo': ['visibility', 'precipitation', 'cloud', 'humidity'],
  'dwd-icon-d2': ['precipitation', 'cloud', 'humidity'],
  'dwd-icon-global': ['precipitation', 'cloud', 'humidity'],
  'ukmo-ukv': ['visibility', 'precipitation', 'cloud', 'humidity'],
  'met-no': ['precipitation', 'cloud', 'humidity'],
  'dmi-grib': ['cloud'],
  'ecmwf-01-grib': ['cloud'],
  'ecmwf-grib': ['cloud'],
  'dwd-grib': ['cloud'],
  'noaa-gfs025': ['cloud']
}
const OPEN_METEO_FIELDS = {
  visibility: 'visibility', precipitation: 'precipitation', cloud: 'cloud_cover', humidity: 'relative_humidity_2m'
}
const MARINE_FIELDS = {
  waveHeight: 'wave_height', waveDirection: 'wave_direction', wavePeriod: 'wave_period',
  windWaveHeight: 'wind_wave_height', swellHeight: 'swell_wave_height',
  seaTemperature: 'sea_surface_temperature', seaLevel: 'sea_level_height_msl',
  currentSpeed: 'ocean_current_velocity', currentDirection: 'ocean_current_direction'
}

function selectedFields(value, supported) {
  return String(value || '').split(',').filter((field) => supported.includes(field))
}

function isPolarDocument(document) {
  const vpp = document?.boat?.vpp
  return document?.schema === LTC_SCHEMA &&
    document?.windBasis === 'true-from-apparent-v1' &&
    Array.isArray(vpp?.speeds) && vpp.speeds.length > 0 &&
    Array.isArray(vpp?.angles) && vpp.angles.length > 0
}

function parseOrcPolar(contents, name) {
  const invalid = (message) => Object.assign(new Error(`ORC polar CSV: ${message}`), { statusCode: 422 })
  const lines = contents.trim().split(/\r?\n/).filter((line) => line.trim())
  const [header, ...rows] = lines.map((line) => line.split(';').map((cell) => cell.trim()))
  if (header?.[0].toLowerCase() !== 'twa/tws' || header.length < 2 || !rows.length) {
    throw invalid('expected a twa/tws header and semicolon-separated polar rows')
  }
  const number = (cell) => /^\d+(?:\.\d+)?$/.test(cell) ? Number(cell) : NaN
  const speeds = header.slice(1).map(number)
  if (speeds.some((speed) => !Number.isFinite(speed)) || new Set(speeds).size !== speeds.length) {
    throw invalid('wind speeds must be unique non-negative numbers in knots')
  }
  const angles = []
  const vpp = { speeds, angles }
  for (const [index, row] of rows.entries()) {
    const angle = number(row[0])
    const values = row.slice(1).map((cell) => cell === '' ? null : number(cell))
    if (!Number.isFinite(angle) || angle > 180 || angles.includes(angle) ||
      values.length !== speeds.length || values.some((value) => value !== null && !Number.isFinite(value))) {
      throw invalid(`invalid angle or boat speed on data row ${index + 1}`)
    }
    angles.push(angle)
    vpp[angle] = values
  }
  if (!angles.some((angle) => vpp[angle].some((speed) => speed > 0))) throw invalid('no positive boat speeds')
  return { windBasis: 'orc-true-wind', boat: { name, vpp } }
}

module.exports = function routeWeatherPlugin(app) {
  let settings = { ...DEFAULTS }
  let settingsFile
  let snapshotDirectory
  let trackDirectory
  let barrierDirectory
  let grib
  let running = false
  let qtVlmEnabled = false
  let importSequence = 0
  const qtVlmHistory = []
  const receiver = createReceiver(async (transfer, digest) => {
    const imported = await storeQtVlm(transfer, digest, { resources: app.resourcesApi, grib, trackDirectory, barrierDirectory })
    qtVlmHistory.unshift({ ...imported, sequence: ++importSequence })
    qtVlmHistory.length = Math.min(qtVlmHistory.length, 12)
    app.debug(`qtVlm ${imported.kind} imported: ${imported.name}`)
  }, (error) => {
    qtVlmHistory.unshift({ error: error.message, sequence: ++importSequence })
    qtVlmHistory.length = Math.min(qtVlmHistory.length, 12)
    app.error(`qtVlm: ${error.message}`)
  })
  const deletingRoutes = new Set()
  const currentPredictor = createCurrentPredictor(() => settings.currentDirectory)

  function saveSettings(nextSettings) {
    const temporaryFile = `${settingsFile}.tmp`
    fs.writeFileSync(temporaryFile, `${JSON.stringify(nextSettings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.chmodSync(temporaryFile, 0o600)
    fs.renameSync(temporaryFile, settingsFile)
    fs.chmodSync(settingsFile, 0o600)
    settings = nextSettings
  }

  function updateQtVlmReceiver(enabled) {
    qtVlmEnabled = enabled
    if (running && enabled) receiver.start()
    else receiver.stop()
  }

  function saveQtVlmOption(enabled) {
    const configuration = app.readPluginOptions()?.configuration || {}
    return new Promise((resolve, reject) => {
      app.savePluginOptions({ ...configuration, qtVlmEnabled: enabled }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  function listRasterCache(directory, prefix = '') {
    const entries = []
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = path.join(prefix, entry.name)
      const fullPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) entries.push(...listRasterCache(fullPath, relativePath))
      else if (entry.isFile() && !entry.name.endsWith('.part')) {
        try {
          entries.push({ name: relativePath, directory: false, bytes: fs.statSync(fullPath).size })
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
      }
    }
    return entries
  }

  function loadSettings() {
    const dataDirectory = app.getDataDirPath()
    fs.mkdirSync(dataDirectory, { recursive: true })
    settingsFile = path.join(dataDirectory, 'webapp-settings.json')
    snapshotDirectory = path.join(dataDirectory, 'weather-snapshots')
    trackDirectory = path.join(dataDirectory, 'qtvlm-tracks')
    barrierDirectory = path.join(dataDirectory, 'qtvlm-barriers')
    fs.mkdirSync(trackDirectory, { recursive: true })
    fs.mkdirSync(barrierDirectory, { recursive: true })
    grib = createGribLibrary(path.join(dataDirectory, 'local-grib'))
    fs.mkdirSync(snapshotDirectory, { recursive: true })
    if (!fs.existsSync(settingsFile)) return

    const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    if (typeof saved.polarDirectory !== 'string' || (saved.currentDirectory !== undefined && typeof saved.currentDirectory !== 'string')) {
      throw new Error('Saved webapp settings have an invalid directory value')
    }
    settings = {
      ...DEFAULTS,
      polarDirectory: saved.polarDirectory,
      currentDirectory: saved.currentDirectory || '',
      gpxDirectory: typeof saved.gpxDirectory === 'string' ? saved.gpxDirectory : '',
      providerKeys: saved.providerKeys && typeof saved.providerKeys === 'object' && !Array.isArray(saved.providerKeys) ? saved.providerKeys : {},
      metNoContact: typeof saved.metNoContact === 'string' ? saved.metNoContact : '',
      gribSources: Array.isArray(saved.gribSources) ? saved.gribSources : [],
      qtVlmEnabled: saved.qtVlmEnabled === true
    }
  }

  function resolvePolarFile(id) {
    const isCsv = /\.csv$/i.test(id)
    if (!(isCsv ? /^[^/\\:\x00-\x1f]{1,200}\.csv$/i.test(id) : /^[A-Za-z0-9_-]{1,64}$/.test(id))) {
      const error = new Error('Invalid polar file id')
      error.statusCode = 400
      throw error
    }
    if (!settings.polarDirectory) {
      const error = new Error('Configure the LTC polar directory in the webapp first')
      error.statusCode = 409
      throw error
    }

    const directory = path.resolve(settings.polarDirectory)
    const filename = path.resolve(directory, isCsv ? id : `${id}.json`)
    if (path.dirname(filename) !== directory) {
      const error = new Error('Polar file is outside the configured directory')
      error.statusCode = 400
      throw error
    }
    const stat = fs.lstatSync(filename)
    if (!stat.isFile()) {
      const error = new Error('Polar entry is not a regular file')
      error.statusCode = 400
      throw error
    }
    if (isCsv) {
      if (stat.size > 1024 * 1024) throw Object.assign(new Error('ORC polar CSV exceeds 1 MiB'), { statusCode: 413 })
      return parseOrcPolar(fs.readFileSync(filename, 'utf8'), id.slice(0, -4))
    }
    const document = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (!isPolarDocument(document)) {
      const error = new Error('Polar file is not a supported LTC true-wind polar')
      error.statusCode = 422
      throw error
    }
    return document
  }

  function sendError(res, error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500
    if (error.retryAfter) res.set('Retry-After', error.retryAfter)
    if (statusCode >= 500) app.error(`Route Weather API error: ${error.message}`)
    res.status(statusCode).json({ error: error.message })
  }

  function gpxLibrary(directory) {
    if (directory && fs.realpathSync(directory) !== directory) throw Object.assign(new Error('GPX directory has changed. Save the directory again.'), { statusCode: 409 })
    const files = directory ? fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.gpx$/i.test(entry.name))
      .map((entry) => entry.name).sort((a, b) => a.localeCompare(b)) : []
    const qtVlmTracks = fs.readdirSync(trackDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.gpx$/i.test(entry.name)).map((entry) => entry.name).sort()
    return { directory, files, qtVlmTracks, qtVlmTrackDirectory: fs.realpathSync(trackDirectory) }
  }

  function gpxFilePath(query) {
    const managedDirectory = fs.realpathSync(trackDirectory)
    const directory = query.directory === managedDirectory ? managedDirectory : settings.gpxDirectory
    const name = query.file
    if (!directory || query.directory !== directory) throw Object.assign(new Error('GPX directory has changed. Refresh the list.'), { statusCode: 409 })
    if (typeof name !== 'string' || !/^[^/\\:\u0000]+\.gpx$/i.test(name)) throw Object.assign(new Error('Invalid GPX filename'), { statusCode: 400 })
    if (fs.realpathSync(directory) !== directory) throw Object.assign(new Error('GPX directory has changed. Save the directory again.'), { statusCode: 409 })
    const filename = path.join(directory, name)
    const stat = fs.lstatSync(filename, { throwIfNoEntry: false })
    if (!stat?.isFile()) throw Object.assign(new Error('GPX file not found'), { statusCode: 404 })
    return filename
  }

  function snapshotId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
      const error = new Error('Invalid weather snapshot id')
      error.statusCode = 400
      throw error
    }
    return value
  }

  function readSnapshot(id) {
    const filename = path.join(snapshotDirectory, `${snapshotId(id)}.json`)
    const snapshot = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (!snapshot || typeof snapshot.routeId !== 'string' || !Array.isArray(snapshot.points)) {
      const error = new Error('Stored weather snapshot has an invalid format')
      error.statusCode = 422
      throw error
    }
    return snapshot
  }

  function routeSnapshots(routeId) {
    return fs.readdirSync(snapshotDirectory)
      .filter((name) => /^[A-Za-z0-9_-]{1,80}\.json$/.test(name))
      .flatMap((name) => {
        const id = name.slice(0, -5)
        try {
          const snapshot = readSnapshot(id)
          return snapshot.routeId === routeId ? [{ ...snapshot, id }] : []
        } catch (error) {
          if (error.code === 'ENOENT') return []
          throw error
        }
      })
  }

  function removeSnapshot(id) {
    try {
      fs.unlinkSync(path.join(snapshotDirectory, `${snapshotId(id)}.json`))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  async function removeRouteAndSnapshots(id) {
    if (deletingRoutes.has(id)) throw new Error('Route deletion is already running')
    deletingRoutes.add(id)
    try {
      const snapshots = routeSnapshots(id)
      const resources = app.resourcesApi
      if (!resources?.getResource || !resources?.deleteResource) throw new Error('Signal K Resources API is unavailable')
      const existing = await resources.getResource('routes', id).catch((error) => {
        if (error.code === 'ENOENT' || error.message === `Resource not found! (${id})`) return null
        throw error
      })
      if (existing) await resources.deleteResource('routes', id)
      for (const snapshot of snapshots) removeSnapshot(snapshot.id)
    } finally {
      deletingRoutes.delete(id)
    }
  }

  async function fetchForecast(provider, latitude, longitude, onBytes, localOnly, requestedExtras) {
    const lat = Number(latitude)
    const lon = Number(longitude)
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
      const error = new Error('Invalid forecast coordinates')
      error.statusCode = 400
      throw error
    }
    if (provider === 'met-no' && !settings.metNoContact) {
      const error = new Error('MET Norway requires contact information in the User-Agent; configure it on page 2')
      error.statusCode = 409
      throw error
    }
    const extras = selectedFields(requestedExtras, Object.hasOwn(ATMOSPHERIC_EXTRAS, provider) ? ATMOSPHERIC_EXTRAS[provider] : [])
    if (provider === 'dmi-grib') return fetchDmiHarmonieForecast(lat, lon, onBytes, extras)
    if (provider === 'ukmo-ukv-netcdf') {
      const records = await fetchUkvRaster(path.join(path.dirname(snapshotDirectory), 'raster-cache'), lat, lon, onBytes, localOnly)
      if (records.length === 0) {
        throw Object.assign(new Error('Met Office UKV has no usable forecast at this waypoint and time'), { statusCode: 404 })
      }
      return records
    }
    if (provider === 'fmi-grib') return fetchFmiForecast(path.join(path.dirname(snapshotDirectory), 'raster-cache'), lat, lon, onBytes)
    if (provider === 'ecmwf-grib' || provider === 'ecmwf-01-grib') {
      return fetchEcmwfForecast(path.join(path.dirname(snapshotDirectory), 'raster-cache'), lat, lon, onBytes, provider === 'ecmwf-01-grib' ? '0p1' : '0p25', extras.includes('cloud'))
    }
    if (['dwd-grib', 'knmi-grib', 'kmi-grib', 'meteo-france-grib', 'noaa-gfs025'].includes(provider)) {
      return fetchRegionalForecast(provider, path.join(path.dirname(snapshotDirectory), 'raster-cache'), lat, lon, settings.providerKeys[provider], onBytes, extras)
    }
    const openMeteo = Object.hasOwn(OPEN_METEO_MODELS, provider) ? OPEN_METEO_MODELS[provider] : null
    const hourlyFields = ['temperature_2m', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'weather_code']
    if (openMeteo) hourlyFields.push(...extras.map((field) => OPEN_METEO_FIELDS[field]))
    const url = openMeteo
      ? `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${hourlyFields.join(',')}&wind_speed_unit=ms&timezone=UTC&forecast_days=${openMeteo.days}${openMeteo.model ? `&models=${openMeteo.model}&cell_selection=nearest` : ''}`
      : provider === 'met-no'
        ? `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`
        : ''
    if (!url) {
      const error = new Error('Unsupported direct weather provider')
      error.statusCode = 404
      throw error
    }
    const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': `LTC_Ocpn_Route_Importer/${PACKAGE_VERSION} (${settings.metNoContact || 'Signal K route weather app'})` },
      signal: AbortSignal.timeout(20000)
    })
    requireResponse(response, provider)
    const data = JSON.parse(await readDownload(response, onBytes))
    if (openMeteo) {
      const hourly = data.hourly
      if (!Array.isArray(hourly?.time)) throw new Error('Open-Meteo response did not include hourly forecasts')
      const source = DIRECT_PROVIDERS.find(({ id }) => id === provider).label
      const records = hourly.time.flatMap((time, index) => {
        const speed = hourly.wind_speed_10m?.[index]
        const direction = hourly.wind_direction_10m?.[index]
        if (!Number.isFinite(speed) || !Number.isFinite(direction)) return []
        const temperature = hourly.temperature_2m?.[index]
        const pressure = hourly.pressure_msl?.[index]
        const code = hourly.weather_code?.[index]
        return [{
          date: new Date(`${time}Z`).toISOString(),
          wind: {
            speed,
            directionTrue: direction * Math.PI / 180,
            gust: hourly.wind_gusts_10m?.[index] ?? undefined
          },
          outside: {
            temperature: Number.isFinite(temperature) ? temperature + 273.15 : undefined,
            pressure: Number.isFinite(pressure) ? pressure * 100 : undefined
          },
          weatherCode: code ?? undefined,
          description: Number.isFinite(code) ? openMeteoDescription(code) : undefined,
          extras: Object.fromEntries(extras.map((field) => [field, hourly[OPEN_METEO_FIELDS[field]]?.[index]])),
          source
        }]
      })
      if (!records.length) throw new Error(`${source}: no forecast at this waypoint`)
      return records
    }
    const timeseries = data.properties?.timeseries
    if (!Array.isArray(timeseries)) throw new Error('MET Norway response did not include a forecast timeseries')
    return timeseries.map((entry) => {
      const details = entry.data?.instant?.details || {}
      const next = entry.data?.next_1_hours?.details || entry.data?.next_6_hours?.details || {}
      const symbolCode = entry.data?.next_1_hours?.summary?.symbol_code || entry.data?.next_6_hours?.summary?.symbol_code || ''
      return {
        date: entry.time,
        wind: { speed: details.wind_speed, directionTrue: details.wind_from_direction * Math.PI / 180, gust: details.wind_speed_of_gust },
        outside: { temperature: details.air_temperature + 273.15, pressure: details.air_pressure_at_sea_level * 100 },
        extras: Object.fromEntries(extras.map((field) => [field, {
          precipitation: entry.data?.next_1_hours?.details?.precipitation_amount,
          cloud: details.cloud_area_fraction, humidity: details.relative_humidity
        }[field]])),
        precipitation: next.precipitation_amount,
        symbolCode,
        description: symbolCode.replace(/_(day|night|polartwilight)$/i, '').replaceAll('_', ' '),
        source: 'MET Norway'
      }
    })
  }

  async function fetchDmiHarmonieForecast(latitude, longitude, onBytes, extras) {
    if (longitude < -43 || longitude > 40 || latitude < 37 || latitude > 70) {
      const error = new Error('DMI HARMONIE DINI does not cover this route point; its published model area is north-western Europe')
      error.statusCode = 422
      throw error
    }
    const url = new URL('https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/position')
    url.searchParams.set('coords', `POINT(${longitude} ${latitude})`)
    url.searchParams.set('crs', 'crs84')
    url.searchParams.set('parameter-name', [
      'temperature-2m', 'wind-speed-10m', 'wind-dir-10m', 'gust-wind-speed-10m',
      'pressure-sealevel', 'fraction-of-cloud-cover', 'total-precipitation'
    ].join(','))
    url.searchParams.set('f', 'GeoJSON')
    const response = await fetch(url, {
      headers: { Accept: 'application/geo+json, application/json' },
      signal: AbortSignal.timeout(20000)
    })
    requireResponse(response, 'DMI HARMONIE')
    const payload = JSON.parse(await readDownload(response, onBytes))
    if (!Array.isArray(payload.features)) throw new Error('DMI HARMONIE response did not include GeoJSON forecast features')
    const gridCoordinates = payload.features.find((feature) => Array.isArray(feature.geometry?.coordinates))?.geometry.coordinates
    if (gridCoordinates?.length >= 2) {
      const radians = Math.PI / 180
      const latitudeDelta = (Number(gridCoordinates[1]) - latitude) * radians
      const longitudeDelta = (Number(gridCoordinates[0]) - longitude) * radians
      const haversine = Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(latitude * radians) * Math.cos(Number(gridCoordinates[1]) * radians) * Math.sin(longitudeDelta / 2) ** 2
      const distanceKm = 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)))
      if (!Number.isFinite(distanceKm) || distanceKm > 15) {
        const error = new Error(`DMI HARMONIE's nearest grid point is ${distanceKm.toFixed(1)} km from this waypoint; refusing a distant extrapolation`)
        error.statusCode = 422
        throw error
      }
    }
    return payload.features.map((feature) => {
      const properties = feature.properties || {}
      const directionDegrees = finiteForecastNumber(properties['wind-dir-10m'])
      const cloudCover = finiteForecastNumber(properties['fraction-of-cloud-cover'])
      const precipitation = finiteForecastNumber(properties['total-precipitation'])
      return {
        date: properties.step,
        wind: {
          speed: finiteForecastNumber(properties['wind-speed-10m']),
          directionTrue: directionDegrees === null ? null : directionDegrees * Math.PI / 180,
          gust: finiteForecastNumber(properties['gust-wind-speed-10m'])
        },
        outside: {
          temperature: finiteForecastNumber(properties['temperature-2m']),
          pressure: finiteForecastNumber(properties['pressure-sealevel']),
          cloudCover,
          precipitation
        },
        extras: extras.includes('cloud') && cloudCover !== null ? { cloud: cloudCover * 100 } : undefined,
        description: precipitation > 0.2 ? 'rain' : cloudCover === null ? 'forecast' : cloudCover < 0.2 ? 'clear sky' : cloudCover < 0.6 ? 'cloudy' : 'overcast',
        source: 'DMI HARMONIE DINI'
      }
    }).filter((record) => typeof record.date === 'string' && Number.isFinite(Date.parse(record.date)))
  }

  function finiteForecastNumber(value) {
    const number = Number(value)
    return value !== null && value !== undefined && Number.isFinite(number) ? number : null
  }

  async function fetchMarineForecast(latitude, longitude, requested, onBytes) {
    const lat = Number(latitude)
    const lon = Number(longitude)
    const fields = selectedFields(requested, Object.keys(MARINE_FIELDS))
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !fields.length) {
      throw Object.assign(new Error('Invalid marine forecast coordinates or fields'), { statusCode: 400 })
    }
    const url = new URL('https://marine-api.open-meteo.com/v1/marine')
    url.search = new URLSearchParams({
      latitude: lat, longitude: lon, hourly: fields.map((field) => MARINE_FIELDS[field]).join(','),
      timezone: 'UTC', cell_selection: 'sea', forecast_days: 7
    })
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
    requireResponse(response, 'Open-Meteo Marine')
    const { hourly, hourly_units: units } = JSON.parse(await readDownload(response, onBytes))
    if (!Array.isArray(hourly?.time)) throw new Error('Open-Meteo Marine: missing forecast times')
    return hourly.time.flatMap((date, index) => {
      const extras = Object.fromEntries(fields.flatMap((field) => {
        const variable = MARINE_FIELDS[field]
        const value = hourly[variable]?.[index]
        if (!Number.isFinite(value)) return []
        return [[field, field === 'currentSpeed' && units?.[variable] === 'km/h' ? value / 1.852 : value]]
      }))
      return Object.keys(extras).length ? [{ date: `${date}Z`, extras }] : []
    })
  }

  function openMeteoDescription(code) {
    if (code === 0) return 'clear sky'
    if ([1, 2, 3].includes(code)) return 'cloudy'
    if ([45, 48].includes(code)) return 'fog'
    if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle'
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain'
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow'
    if ([95, 96, 99].includes(code)) return 'thunderstorm'
    return 'weather forecast'
  }

  return {
    id: PLUGIN_ID,
    name: DISPLAY_NAME,
    description: 'Route weather forecasts with persistent runs and optional LTC polar/current coverage.',
    start(configuration = {}) {
      loadSettings()
      running = true
      updateQtVlmReceiver(configuration.qtVlmEnabled ?? settings.qtVlmEnabled)
      if (configuration.qtVlmEnabled === undefined && settings.qtVlmEnabled) {
        saveQtVlmOption(true).catch((error) => app.error(`Could not migrate the qtVlm setting: ${error.message}`))
      }
      app.setPluginStatus('Webapp available')
      app.debug(`${DISPLAY_NAME} started`)
    },
    stop() {
      running = false
      receiver.stop()
      app.debug(`${DISPLAY_NAME} stopped`)
    },
    schema() {
      return {
        type: 'object',
        properties: {
          qtVlmEnabled: { type: 'boolean', title: 'Enable qtVlm receiver (port 5555)', default: qtVlmEnabled }
        }
      }
    },
    getOpenApi() {
      return openApi
    },
    registerWithRouter(router) {
      router.access('readonly').get('/version', (_req, res) => {
        res.status(200).json({ packageVersion: PACKAGE_VERSION, appVersion: PACKAGE_VERSION, snapshotDirectory })
      })

      router.access('readonly').get('/settings', (_req, res) => {
        res.status(200).json({ polarDirectory: settings.polarDirectory, currentDirectory: settings.currentDirectory })
      })

      router.access('readonly').get('/qtvlm', (_req, res) => {
        const barriers = (barrierDirectory ? fs.readdirSync(barrierDirectory, { withFileTypes: true }) : [])
          .filter((entry) => entry.isFile() && entry.name.endsWith('.geojson')).map((entry) => entry.name)
        res.json({ enabled: qtVlmEnabled, listening: receiver.isListening(), history: qtVlmHistory, barriers })
      })

      router.access('readwrite').put('/qtvlm', async (req, res) => {
        try {
          if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Expected an enabled flag' })
          await saveQtVlmOption(req.body.enabled)
          updateQtVlmReceiver(req.body.enabled)
          res.json({ enabled: qtVlmEnabled })
        } catch (error) { sendError(res, error) }
      })

      router.access('readonly').get('/qtvlm/barrier', (req, res) => {
        const filename = req.query.file
        if (typeof filename !== 'string' || !/^[^/\\:\x00]+\.geojson$/.test(filename)) return res.status(400).json({ error: 'Invalid barrier filename' })
        const file = path.join(barrierDirectory, filename)
        if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) return res.status(404).json({ error: 'Barrier file not found' })
        res.download(file)
      })

      router.access('readonly').get('/local-grib', async (_req, res) => {
        try {
          const files = await grib.list()
          const sources = settings.gribSources.map(({ id, name }) => ({ id, name }))
          res.json({ files, sources })
        } catch (error) { sendError(res, error) }
      })

      router.access('readwrite').delete('/local-grib/:id', async (req, res) => {
        try {
          await grib.remove(req.params.id)
          for (let index = qtVlmHistory.length - 1; index >= 0; index--) {
            if (qtVlmHistory[index].fileId === req.params.id) qtVlmHistory.splice(index, 1)
          }
          res.json({ deleted: true })
        } catch (error) { sendError(res, error) }
      })

      router.access('readwrite').post('/local-grib', async (req, res) => {
        try {
          const { filePath, url, sourceId, sourceName } = req.body || {}
          const source = settings.gribSources.find(({ id }) => id === sourceId)
          if (sourceId && !source) return res.status(404).json({ error: 'Saved GRIB source not found' })
          if (filePath) return res.status(201).json(await grib.importPath(filePath))
          const address = source?.url || url
          const file = await grib.importUrl(address)
          if (typeof sourceName === 'string' && sourceName.trim()) {
            const name = sourceName.trim().slice(0, 100)
            const existing = settings.gribSources.find((entry) => entry.name === name)
            const saved = { id: existing?.id || randomUUID(), name, url: address }
            saveSettings({ ...settings, gribSources: [...settings.gribSources.filter((entry) => entry.id !== saved.id), saved] })
          }
          res.status(201).json(file)
        } catch (error) { sendError(res, error) }
      })

      router.access('readwrite').post('/local-grib/upload', async (req, res) => {
        try {
          if (!req.is('application/octet-stream')) return res.status(415).json({ error: 'Expected a binary GRIB file' })
          if (Number(req.get('Content-Length')) > MAX_GRIB_BYTES) return res.status(413).json({ error: 'GRIB file exceeds 128 MiB' })
          const chunks = []
          let size = 0
          for await (const chunk of req.iterator({ destroyOnReturn: false })) {
            size += chunk.length
            if (size > MAX_GRIB_BYTES) {
              req.resume()
              return res.status(413).json({ error: 'GRIB file exceeds 128 MiB' })
            }
            chunks.push(chunk)
          }
          res.status(201).json(await grib.save(Buffer.concat(chunks, size), req.query.name))
        } catch (error) { sendError(res, error) }
      })

      router.access('readonly').get('/gpx-files', (_req, res) => {
        try { res.status(200).json(gpxLibrary(settings.gpxDirectory)) } catch (error) { sendError(res, error) }
      })

      router.access('readwrite').put('/gpx-files', (req, res) => {
        try {
          const directory = req.body?.directory
          if (typeof directory !== 'string' || (directory !== '' && !path.isAbsolute(directory))) {
            return res.status(400).json({ error: 'Enter an absolute GPX directory path' })
          }
          const library = gpxLibrary(directory ? fs.realpathSync(directory) : '')
          saveSettings({ ...settings, gpxDirectory: library.directory })
          res.status(200).json(library)
        } catch (error) {
          if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) error.statusCode = 400
          sendError(res, error)
        }
      })

      router.access('readonly').get('/gpx-files/content', (req, res) => {
        try {
          const filename = gpxFilePath(req.query)
          const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0))
          try {
            const stat = fs.fstatSync(fd)
            const managed = path.dirname(filename) === fs.realpathSync(trackDirectory)
            const limit = managed ? MAX_QTVLM_TRACK_BYTES : MAX_GPX_BYTES
            if (!stat.isFile() || stat.size > limit) return res.status(413).json({ error: `GPX file exceeds the ${limit / (1024 * 1024)} MiB limit` })
            const buffer = Buffer.alloc(stat.size + 1)
            let bytes = 0
            while (bytes < buffer.length) {
              const read = fs.readSync(fd, buffer, bytes, buffer.length - bytes)
              if (!read) break
              bytes += read
            }
            if (bytes !== stat.size) return res.status(409).json({ error: 'GPX file changed while reading. Try again.' })
            res.status(200).json({ text: buffer.toString('utf8', 0, bytes) })
          } finally { fs.closeSync(fd) }
        } catch (error) { sendError(res, error) }
      })

      router.access('readwrite').delete('/gpx-files', (req, res) => {
        try {
          fs.unlinkSync(gpxFilePath(req.query))
          res.status(200).json({ deleted: true })
        } catch (error) { sendError(res, error) }
      })

      router.access('readonly').get('/provider-credentials', (_req, res) => {
        const providerKeys = Object.fromEntries(Object.entries(settings.providerKeys).map(([id, key]) => [id, typeof key === 'string' && key.length > 0]))
        res.status(200).json({ providerKeys, metNoContact: settings.metNoContact })
      })

      router.access('readwrite').put('/provider-credentials', (req, res) => {
        try {
          const incoming = req.body?.providerKeys ?? {}
          if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
            const error = new Error('Provider keys must be an object keyed by provider id')
            error.statusCode = 400
            throw error
          }
          const providerKeys = { ...settings.providerKeys }
          for (const [id, key] of Object.entries(incoming)) {
            if (!['knmi-grib', 'meteo-france-grib'].includes(id) || typeof key !== 'string' || key.length > 2048) {
              const error = new Error(`Unsupported provider credential: ${id}`)
              error.statusCode = 400
              throw error
            }
            if (key.length > 0) providerKeys[id] = key
          }
          const metNoContact = req.body?.metNoContact
          if (typeof metNoContact !== 'string' || metNoContact.trim() !== metNoContact || metNoContact.length > 256) {
            const error = new Error('MET Norway contact must be a trimmed string of at most 256 characters')
            error.statusCode = 400
            throw error
          }
          saveSettings({ ...settings, providerKeys, metNoContact })
          res.status(200).json({ providerKeys: Object.fromEntries(Object.entries(providerKeys).map(([id, key]) => [id, key.length > 0])), metNoContact })
        } catch (error) {
          sendError(res, error)
        }
      })

      router.access('readwrite').delete('/provider-credentials/:id', (req, res) => {
        const id = String(req.params.id || '')
        if (!['knmi-grib', 'meteo-france-grib'].includes(id)) return res.status(400).json({ error: 'Unsupported provider credential' })
        const providerKeys = { ...settings.providerKeys }
        delete providerKeys[id]
        saveSettings({ ...settings, providerKeys })
        res.status(200).json({ providerKeys: Object.fromEntries(Object.entries(providerKeys).map(([keyId, key]) => [keyId, key.length > 0])) })
      })

      router.access('readonly').get('/raster-cache', (_req, res) => {
        try {
          const directory = path.join(path.dirname(snapshotDirectory), 'raster-cache')
          fs.mkdirSync(directory, { recursive: true })
          const files = listRasterCache(directory).sort((a, b) => a.name.localeCompare(b.name))
          res.status(200).json({ directory, files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) })
        } catch (error) {
          sendError(res, error)
        }
      })

      router.access('readwrite').delete('/raster-cache', (req, res) => {
        try {
          const directory = path.join(path.dirname(snapshotDirectory), 'raster-cache')
          fs.mkdirSync(directory, { recursive: true })
          const name = req.query.file
          const files = listRasterCache(directory).filter((file) => name === undefined || file.name === name)
          if (name !== undefined && !files.length) {
            return res.status(404).json({ error: 'Raster cache file not found' })
          }
          for (const file of files) {
            try {
              fs.unlinkSync(path.join(directory, file.name))
            } catch (error) {
              if (error.code !== 'ENOENT') throw error
            }
          }
          res.status(200).json({ deleted: true, directory })
        } catch (error) {
          sendError(res, error)
        }
      })

      router.access('readwrite').put('/settings', (req, res) => {
        try {
          const polarDirectory = req.body?.polarDirectory
          if (typeof polarDirectory !== 'string' || polarDirectory.trim() !== polarDirectory) {
            const error = new Error('Polar directory must be a trimmed path string')
            error.statusCode = 400
            throw error
          }
          if (polarDirectory && !path.isAbsolute(polarDirectory)) {
            const error = new Error('Polar directory must be an absolute path on the Signal K server')
            error.statusCode = 400
            throw error
          }
          if (polarDirectory && !fs.existsSync(polarDirectory)) {
            const error = new Error('Configured polar directory does not exist on this Signal K server')
            error.statusCode = 400
            throw error
          }
          if (polarDirectory && !fs.statSync(polarDirectory).isDirectory()) {
            const error = new Error('Configured polar path is not a directory')
            error.statusCode = 400
            throw error
          }

          const currentDirectory = req.body?.currentDirectory ?? settings.currentDirectory
          if (typeof currentDirectory !== 'string' || currentDirectory.trim() !== currentDirectory) {
            const error = new Error('Current data directory must be a trimmed path string')
            error.statusCode = 400
            throw error
          }
          if (currentDirectory && !path.isAbsolute(currentDirectory)) {
            const error = new Error('Current data directory must be an absolute path on the Signal K server')
            error.statusCode = 400
            throw error
          }
          if (currentDirectory && (!fs.existsSync(currentDirectory) || !fs.statSync(currentDirectory).isDirectory())) {
            const error = new Error('Current data path does not exist or is not a directory')
            error.statusCode = 400
            throw error
          }

          const nextSettings = { ...settings, polarDirectory, currentDirectory }
          saveSettings(nextSettings)
          res.status(200).json(settings)
        } catch (error) {
          sendError(res, error)
        }
      })

      router.access('readonly').get('/polars', (_req, res) => {
        if (!settings.polarDirectory) {
          return res.status(200).json({ configured: false, files: [], warnings: [] })
        }
        try {
          const names = fs.readdirSync(settings.polarDirectory)
            .filter((name) => /^[A-Za-z0-9_-]{1,64}\.json$/.test(name) || /\.csv$/i.test(name))
          const files = []
          const warnings = []
          for (const name of names) {
            try {
              const id = name.endsWith('.json') ? name.slice(0, -5) : name
              const document = resolvePolarFile(id)
              files.push({
                id,
                name: document.boat.name || document.name || id,
                boatType: document.boat.boat?.type || '',
                windBasis: document.windBasis,
                updatedAt: document.updatedAt || null
              })
            } catch (error) {
              warnings.push({ file: name, message: error.message })
            }
          }
          res.status(200).json({ configured: true, files, warnings })
        } catch (error) {
          sendError(res, error)
        }
      })

      router.access('readonly').get('/polars/:id', (req, res) => {
        try {
          const document = resolvePolarFile(req.params.id)
          res.status(200).json({
            id: req.params.id,
            name: document.boat.name || document.name || req.params.id,
            windBasis: document.windBasis,
            vpp: document.boat.vpp
          })
        } catch (error) {
          sendError(res, error)
        }
      })

      router.access('readonly').get('/providers', (_req, res) => {
        res.status(200).json(DIRECT_PROVIDERS.map((provider) => ({ ...provider, extras: ATMOSPHERIC_EXTRAS[provider.id] || [] })))
      })

      router.access('readonly').get('/internet-status', async (_req, res) => {
        const probes = await Promise.allSettled(['https://www.debian.org/', 'https://www.cloudflare.com/'].map(async (url) => {
          const response = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(4500) })
          return response.ok
        }))
        res.set('Cache-Control', 'no-store').json({ online: probes.some((probe) => probe.status === 'fulfilled' && probe.value) })
      })

      router.access('readonly').get('/current-datasets', (req, res) => {
        try {
          const points = JSON.parse(String(req.query.points || '[]'))
          if (!Array.isArray(points) || points.length === 0 || points.length > 500 || points.some((point) => !Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude)) || Math.abs(Number(point.latitude)) > 90 || Math.abs(Number(point.longitude)) > 180)) {
            const error = new Error('Pass up to 500 route points as a JSON array of latitude/longitude values')
            error.statusCode = 400
            throw error
          }
          res.status(200).json(currentPredictor.coverage(points.map((point) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude) }))))
        } catch (error) {
          sendError(res, error)
        }
      })

      router.access('readonly').get('/currents/predict', (req, res) => {
        try {
          const latitude = Number(req.query.latitude)
          const longitude = Number(req.query.longitude)
          const time = Date.parse(String(req.query.time || ''))
          if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(time)) {
            const error = new Error('Provide valid latitude, longitude, and ISO date/time parameters')
            error.statusCode = 400
            throw error
          }
          res.status(200).json(currentPredictor.predict({ latitude, longitude }, time))
        } catch (error) {
          sendError(res, error)
        }
      })

      router.access('readonly').get('/forecasts/point', async (req, res) => {
        const streaming = req.get('Accept') === 'application/x-ndjson'
        let bytes = 0
        let lastUpdate = 0
        const sendEvent = (event) => {
          if (res.destroyed) return
          res.write(`${JSON.stringify(event)}\n`)
          res.flush?.()
        }
        const onBytes = streaming ? (count) => {
          bytes += count
          const now = Date.now()
          if (now - lastUpdate >= 100) {
            sendEvent({ bytes })
            lastUpdate = now
          }
        } : undefined
        if (streaming) res.set('Content-Type', 'application/x-ndjson').set('Cache-Control', 'no-store')
        try {
          const provider = String(req.query.provider || '')
          if (provider === 'local-grib') {
            const lat = Number(req.query.lat)
            const lon = Number(req.query.lon)
            if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
              throw Object.assign(new Error('Invalid forecast coordinates'), { statusCode: 400 })
            }
            const forecast = await grib.forecast(String(req.query.grib || ''), lat, lon, String(req.query.extras || '').split(','))
            const result = { ...forecast, provider, fetchedAt: new Date().toISOString() }
            if (streaming) sendEvent({ bytes, result })
            else res.json(result)
            return
          }
          const records = await fetchForecast(provider, req.query.lat, req.query.lon, onBytes, String(req.query.localOnly) === 'true', req.query.extras)
          const result = { forecasts: records, provider, fetchedAt: new Date().toISOString() }
          if (provider === 'open-meteo' && req.query.marine) {
            try {
              result.marine = await fetchMarineForecast(req.query.lat, req.query.lon, req.query.marine, onBytes)
            } catch (error) {
              result.marineError = error.message
            }
          }
          if (streaming) sendEvent({ bytes, result })
          else res.status(200).json(result)
        } catch (error) {
          if (streaming) sendEvent({ bytes, error: error.message, statusCode: error.statusCode, retryAfter: error.retryAfter })
          else sendError(res, error)
        } finally {
          if (streaming && !res.destroyed) res.end()
        }
      })

      router.access('readonly').get('/forecasts/marine', async (req, res) => {
        try {
          let bytes = 0
          const forecasts = await fetchMarineForecast(req.query.lat, req.query.lon, req.query.fields, (count) => { bytes += count })
          res.status(200).json({ forecasts, bytes })
        } catch (error) {
          sendError(res, error)
        }
      })

      router.access('readonly').get('/snapshots', (req, res) => {
        try {
          const routeId = String(req.query.routeId || '')
          const items = routeSnapshots(routeId)
            .map(({ id, routeId: savedRouteId, routeName, provider, fetchedAt }) => ({ id, routeId: savedRouteId, routeName, provider, fetchedAt }))
            .sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))
          res.status(200).json(items)
        } catch (error) {
          sendError(res, error)
        }
      })

      router.access('readonly').get('/snapshots/:id', (req, res) => {
        try {
          res.status(200).json(readSnapshot(req.params.id))
        } catch (error) {
          sendError(res, error)
        }
      })

      router.access('readwrite').post('/snapshots', async (req, res) => {
        try {
          const value = req.body
          if (!value || typeof value.routeId !== 'string' || typeof value.routeName !== 'string' || typeof value.provider !== 'string' || !Array.isArray(value.points)) {
            const error = new Error('Snapshot requires routeId, routeName, provider and points')
            error.statusCode = 400
            throw error
          }
          if (!value.routeId.startsWith('gpx-') && app.resourcesApi?.getResource) {
            await app.resourcesApi.getResource('routes', value.routeId)
          }
          if (deletingRoutes.has(value.routeId)) {
            return res.status(409).json({ error: 'Route deletion is already running' })
          }
          const snapshot = {
            id: `${Date.now()}_${require('node:crypto').randomBytes(6).toString('hex')}`,
            routeId: value.routeId,
            routeName: value.routeName,
            provider: value.provider,
            fetchedAt: new Date().toISOString(),
            points: value.points
          }
          const target = path.join(snapshotDirectory, `${snapshot.id}.json`)
          const temporary = `${target}.tmp`
          fs.writeFileSync(temporary, `${JSON.stringify(snapshot)}\n`, { encoding: 'utf8', mode: 0o600 })
          fs.renameSync(temporary, target)
          res.status(201).json(snapshot)
        } catch (error) {
          sendError(res, error)
        }
      })

      router.access('readwrite').post('/deletions', async (req, res) => {
        const { kind, ids } = req.body || {}
        const validId = kind === 'routes' ? /^[^/\\%\x00-\x20]{1,200}$/ : /^[A-Za-z0-9_-]{1,80}$/
        if (!['routes', 'snapshots'].includes(kind) || !Array.isArray(ids) || !ids.length ||
          ids.some((id) => typeof id !== 'string' || !validId.test(id) || id === '.' || id === '..' || (kind === 'routes' && id.startsWith('gpx-')))) {
          return res.status(400).json({ error: 'Invalid deletion selection' })
        }
        const deleted = []
        const failed = []
        for (const id of new Set(ids)) {
          try {
            if (kind === 'routes') await removeRouteAndSnapshots(id)
            else removeSnapshot(id)
            deleted.push(id)
          } catch (error) {
            failed.push({ id, error: error.message })
          }
        }
        res.status(200).json({ deleted, failed })
      })

      router.access('readwrite').delete('/snapshots/:id', (req, res) => {
        try {
          removeSnapshot(req.params.id)
          res.status(204).end()
        } catch (error) {
          sendError(res, error)
        }
      })
    }
  }
}
