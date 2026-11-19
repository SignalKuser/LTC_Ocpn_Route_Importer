'use strict'

const fs = require('node:fs')
const path = require('node:path')

const CURRENT_MAX_DISTANCE_KM = 15
const CACHE_TTL_MS = 60_000
const KNOTS_TO_MPS = 0.5144444444444445

function parseNumber(value, description) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${description}: ${value}`)
  return parsed
}

function currentError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function parseIndexFile(filename) {
  const lines = fs.readFileSync(filename, 'latin1').split(/\r?\n/)
  const stations = []
  const stationLine = /^c[^:]*:[^:]*:[^:]*:\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+\S+\s+(\S.*)$/
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const match = stationLine.exec(lines[index].trim())
    if (!match) continue
    const fields = lines[index + 1].trim().split(/\s+/)
    if (fields.length < 11 || !fields[0].startsWith('^')) continue
    const station = {
      longitude: parseNumber(match[1], 'station longitude'),
      latitude: parseNumber(match[2], 'station latitude'),
      name: match[3].trim(),
      floodDirection: parseNumber(fields[7], 'flood direction') % 360,
      ebbDirection: parseNumber(fields[8], 'ebb direction') % 360,
      master: fields[10],
      supported: fields.slice(1, 6).every((value) => Number(value) === 0) && Number(fields[9]) === 1
    }
    if (Math.abs(station.latitude) <= 90 && Math.abs(station.longitude) <= 180) stations.push(station)
  }
  return stations
}

function findIntegerLine(lines, start, min, max) {
  for (let index = start; index < lines.length; index += 1) {
    const value = lines[index].trim()
    if (/^\d{1,4}$/.test(value)) {
      const number = Number(value)
      if (number >= min && number <= max) return { index, value: number }
    }
  }
  throw new Error('HARMONIC astronomy table is missing a year or row count')
}

function parseConstituentTable(lines, start, count, constituentNames, label) {
  const valuesByName = new Map()
  let index = start
  while (index < lines.length) {
    const name = lines[index].trim()
    if (name === '*END*') break
    if (!constituentNames.has(name)) {
      index += 1
      continue
    }
    index += 1
    const values = []
    while (index < lines.length && values.length < count) {
      const row = lines[index].trim()
      if (row === '*END*' || constituentNames.has(row)) break
      for (const token of row.split(/\s+/)) {
        if (token) {
          const number = Number(token)
          if (Number.isFinite(number)) values.push(number)
        }
      }
      index += 1
    }
    if (values.length !== count) throw new Error(`HARMONIC ${label} table for ${name} has ${values.length} values; expected ${count}`)
    valuesByName.set(name, values)
  }
  if (valuesByName.size !== constituentNames.size) {
    const missing = [...constituentNames].filter((name) => !valuesByName.has(name))
    throw new Error(`HARMONIC ${label} table is missing: ${missing.slice(0, 5).join(', ')}`)
  }
  return valuesByName
}

function readHarmonicHeader(lines) {
  let countLine = -1
  let constituentCount = 0
  for (let index = 0; index < lines.length; index += 1) {
    const value = lines[index].trim()
    if (!/^\d{1,3}$/.test(value)) continue
    const candidateCount = Number(value)
    if (candidateCount < 1 || candidateCount > 255) continue
    const frequencies = new Map()
    let cursor = index + 1
    while (frequencies.size < candidateCount && cursor < lines.length) {
      const fields = lines[cursor].trim().split(/\s+/)
      const speed = fields.length === 2 ? Number(fields[1]) : NaN
      if (fields.length === 2 && Number.isFinite(speed) && !fields[0].startsWith('#')) frequencies.set(fields[0], speed)
      cursor += 1
      if (lines[cursor - 1].trim() === '*END*') break
    }
    if (frequencies.size === candidateCount) {
      countLine = index
      constituentCount = candidateCount
      break
    }
  }
  if (countLine < 0 || constituentCount === 0) throw new Error('HARMONIC constituent speed table not found')

  const speedMap = new Map()
  let cursor = countLine + 1
  while (speedMap.size < constituentCount && cursor < lines.length) {
    const fields = lines[cursor].trim().split(/\s+/)
    const speed = fields.length === 2 ? Number(fields[1]) : NaN
    if (fields.length === 2 && Number.isFinite(speed) && !fields[0].startsWith('#')) speedMap.set(fields[0], speed)
    cursor += 1
  }
  const constituentNames = new Set(speedMap.keys())

  const equilibriumMarker = lines.findIndex((line) => line.includes('Starting year for equilibrium arguments and node factors'))
  const yearLine = equilibriumMarker >= 0
    ? findIntegerLine(lines, equilibriumMarker + 1, 1800, 2200)
    : findIntegerLine(lines, cursor, 1800, 2200)
  const countLineForEquilibrium = findIntegerLine(lines, yearLine.index + 1, 1, 300)
  const equilibriumEnd = lines.findIndex((line, index) => index > countLineForEquilibrium.index && line.trim() === '*END*')
  if (equilibriumEnd < 0) throw new Error('HARMONIC equilibrium argument table has no *END* marker')
  const equilibrium = parseConstituentTable(
    lines.slice(0, equilibriumEnd + 1),
    countLineForEquilibrium.index + 1,
    countLineForEquilibrium.value,
    constituentNames,
    'equilibrium'
  )

  const nodalMarker = lines.findIndex((line, index) => index > equilibriumEnd && /node factors for the middle of each year/i.test(line))
  const nodalCount = findIntegerLine(lines, nodalMarker >= 0 ? nodalMarker + 1 : equilibriumEnd + 1, 1, 300)
  const nodalEnd = lines.findIndex((line, index) => index > nodalCount.index && line.trim() === '*END*')
  if (nodalEnd < 0) throw new Error('HARMONIC node factor table has no *END* marker')
  const nodal = parseConstituentTable(
    lines.slice(0, nodalEnd + 1),
    nodalCount.index + 1,
    nodalCount.value,
    constituentNames,
    'node factor'
  )
  if (nodalCount.value !== countLineForEquilibrium.value) throw new Error('HARMONIC astronomy tables have different year counts')

  return { speedMap, yearStart: yearLine.value, yearCount: countLineForEquilibrium.value, equilibrium, nodal, stationStart: nodalEnd + 1 }
}

function parseHarmonicFile(filename, stations) {
  const lines = fs.readFileSync(filename, 'latin1').split(/\r?\n/)
  const header = readHarmonicHeader(lines)
  const masters = new Set(stations.map((station) => station.master))
  const records = new Map()
  for (let index = header.stationStart; index < lines.length; index += 1) {
    const master = lines[index].trim()
    if (!masters.has(master)) continue
    let cursor = index + 1
    while (cursor < lines.length && (!lines[cursor].trim() || lines[cursor].trim().startsWith('#'))) cursor += 1
    cursor += 1 // Station meridian / display timezone.
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1
    if (cursor >= lines.length) throw new Error(`HARMONIC mean current missing for ${master}`)
    const mean = parseNumber(lines[cursor].trim().split(/\s+/)[0], `mean current for ${master}`)
    cursor += 1
    const harmonics = new Map()
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor].trim()
      if (!line || line.startsWith('#')) continue
      if (masters.has(line)) break
      const fields = line.split(/\s+/)
      if (!header.speedMap.has(fields[0]) || fields.length < 3) continue
      const amplitude = Number(fields[1])
      const phase = Number(fields[2])
      if (Number.isFinite(amplitude) && Number.isFinite(phase)) harmonics.set(fields[0], { amplitude, phase })
    }
    records.set(master, { mean, harmonics })
  }
  const missing = [...masters].filter((master) => !records.has(master))
  if (missing.length) throw new Error(`${missing.length} IDX master records are missing from HARMONIC; first: ${missing[0]}`)
  return { ...header, records }
}

function distanceKm(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180
  const dLat = radians(b.latitude - a.latitude)
  const dLon = radians(b.longitude - a.longitude)
  const arc = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc))
}

function predictSignedSpeed(dataset, station, time) {
  const date = new Date(time)
  const year = date.getUTCFullYear()
  const yearIndex = year - dataset.yearStart
  if (yearIndex < 0 || yearIndex >= dataset.yearCount) throw currentError(`HARMONIC astronomy table covers ${dataset.yearStart}–${dataset.yearStart + dataset.yearCount - 1}, not ${year}`, 422)
  const record = dataset.records.get(station.master)
  if (!record) throw new Error(`No harmonic record for ${station.master}`)
  const yearStart = Date.UTC(year, 0, 1)
  const hours = (date.getTime() - yearStart) / 3_600_000
  let velocityKnots = record.mean
  for (const [name, speed] of dataset.speedMap) {
    const harmonic = record.harmonics.get(name)
    if (!harmonic || harmonic.amplitude === 0) continue
    const equilibrium = dataset.equilibrium.get(name)[yearIndex]
    const nodeFactor = dataset.nodal.get(name)[yearIndex]
    const phaseDegrees = speed * hours + equilibrium - harmonic.phase
    velocityKnots += nodeFactor * harmonic.amplitude * Math.cos(phaseDegrees * Math.PI / 180)
  }
  return velocityKnots
}

function createCurrentPredictor(getRoot) {
  let cachedRoot = ''
  let cachedAt = 0
  let cachedDatasets = []

  function loadDatasets() {
    const configuredRoot = getRoot()
    if (!configuredRoot) return []
    const root = path.resolve(configuredRoot)
    if (cachedRoot === root && Date.now() - cachedAt < CACHE_TTL_MS) return cachedDatasets
    const files = []
    function walk(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) walk(filename)
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.idx')) files.push(filename)
      }
    }
    walk(root)
    const datasets = []
    for (const idxFile of files) {
      const harmonicFile = idxFile.slice(0, -4)
      if (!fs.existsSync(harmonicFile) || !fs.statSync(harmonicFile).isFile()) continue
      const stations = parseIndexFile(idxFile)
      if (!stations.length) continue
      datasets.push({
        id: Buffer.from(path.relative(root, idxFile)).toString('base64url'),
        name: path.basename(path.dirname(idxFile)),
        relativeIndex: path.relative(root, idxFile),
        harmonicFile,
        stations,
        highResolution: /R\s?2(?:\.0)?\s?km/i.test(path.relative(root, idxFile)),
        germanCoastDetail: /BSH_/i.test(path.relative(root, idxFile)) || (
          /R\s?2(?:\.0)?\s?km/i.test(path.relative(root, idxFile)) &&
          /(Kieler_Bucht|Fehmarn|Mecklenburger_Bucht|Ruegen|Deutsche_Bucht|German|Germany)/i.test(path.relative(root, idxFile))
        ),
        harmonic: null,
        coverage: []
      })
    }
    cachedRoot = root
    cachedAt = Date.now()
    cachedDatasets = datasets
    return datasets
  }

  function coverage(routePoints) {
    const datasets = loadDatasets()
    const measured = datasets.map((dataset) => {
      const distances = routePoints.map((point) => {
        let nearest = { distanceKm: Infinity, stationName: '' }
        for (const station of dataset.stations) {
          const distance = distanceKm(point, station)
          if (distance < nearest.distanceKm) nearest = { distanceKm: distance, stationName: station.name }
        }
        return nearest
      })
      return {
        ...dataset,
        coverage: distances,
        stationCount: dataset.stations.length,
        averageDistanceKm: distances.reduce((sum, item) => sum + item.distanceKm, 0) / routePoints.length,
        maximumDistanceKm: Math.max(...distances.map((item) => item.distanceKm))
      }
    })
    measured.sort((a, b) => a.maximumDistanceKm - b.maximumDistanceKm || a.averageDistanceKm - b.averageDistanceKm)
    const routeMatches = routePoints.map((point, index) => {
      const germanCoastPoint = point.latitude >= 53 && point.latitude <= 55.7 && point.longitude >= 5 && point.longitude <= 15.5
      const detailedChoices = germanCoastPoint
        ? measured.filter((dataset) => dataset.germanCoastDetail && dataset.coverage[index].distanceKm <= CURRENT_MAX_DISTANCE_KM)
        : []
      const candidates = detailedChoices.length ? detailedChoices : measured
      const match = [...candidates].sort((a, b) => a.coverage[index].distanceKm - b.coverage[index].distanceKm)[0]
      return match ? { datasetId: match.id, datasetName: match.name, ...match.coverage[index] } : null
    })
    const publicDatasets = measured.map(({ id, name, highResolution, germanCoastDetail, stationCount, averageDistanceKm, maximumDistanceKm, coverage: datasetCoverage }) => ({
      id, name, highResolution, germanCoastDetail, stationCount, averageDistanceKm, maximumDistanceKm, coverage: datasetCoverage
    }))
    return { configured: Boolean(getRoot()), datasets: publicDatasets, routeMatches }
  }

  function predict(point, timestamp) {
    const datasets = loadDatasets()
    if (!getRoot()) throw currentError('Configure a folder containing paired LTC HARMONIC/IDX files first', 409)
    if (!datasets.length) throw currentError('No paired LTC HARMONIC/IDX datasets were found in the configured folder', 404)
    const result = coverage([point])
    const match = result.routeMatches[0]
    if (!match || match.distanceKm > CURRENT_MAX_DISTANCE_KM) throw currentError(`No LTC current station within ${CURRENT_MAX_DISTANCE_KM} km of this position`, 404)
    const dataset = datasets.find((candidate) => candidate.id === match.datasetId)
    if (!dataset) throw new Error('The selected LTC current dataset disappeared during lookup')
    const station = dataset.stations.find((candidate) => candidate.name === match.stationName)
    if (!station) throw new Error('The nearest LTC current station could not be resolved')
    if (!station.supported) throw currentError(`Unsupported IDX correction at ${station.name}; this build supports the LTC zero-offset, unit-factor records`, 422)
    if (!dataset.harmonic) dataset.harmonic = parseHarmonicFile(dataset.harmonicFile, dataset.stations)
    const speedKnots = predictSignedSpeed(dataset.harmonic, station, timestamp)
    const direction = speedKnots < 0 ? station.ebbDirection : station.floodDirection
    const magnitudeMps = Math.abs(speedKnots) * KNOTS_TO_MPS
    const directionRadians = direction * Math.PI / 180
    return {
      source: 'ltc-harmonic',
      dataset: dataset.name,
      station: station.name,
      distanceKm: match.distanceKm,
      sample: {
        time: new Date(timestamp).toISOString(),
        speedKn: speedKnots,
        direction,
        u: magnitudeMps * Math.sin(directionRadians),
        v: magnitudeMps * Math.cos(directionRadians)
      }
    }
  }

  return { coverage, predict }
}

module.exports = { createCurrentPredictor }
