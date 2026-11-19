'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { parseTransfer } = require('./qtvlm')

function resourceId(parts) {
  const hex = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function escaped(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
}

async function writeArtifact(directory, name, digest, suffix, contents) {
  const safe = name.replace(/[^\p{L}\p{N}_. -]/gu, '_').slice(0, 95).replace(/^\.+/, '') || 'qtVlm'
  const filename = `${safe}-${digest.slice(0, 12)}.${suffix}`
  const temporary = path.join(directory, `${randomUUID()}.part`)
  await fs.mkdir(directory, { recursive: true })
  try {
    await fs.writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, path.join(directory, filename))
  } finally {
    await fs.rm(temporary, { force: true })
  }
  return filename
}

function feature(type, coordinates, properties) {
  return { type: 'Feature', geometry: { type, coordinates }, properties }
}

async function storeQtVlm(transfer, digest, { resources, grib, trackDirectory, barrierDirectory, python }) {
  const received = await parseTransfer(transfer, python)
  const { kind, points, barriers, data, slot } = received
  const name = String(received.name || '').trim().slice(0, 180) || 'qtVlm'
  const now = new Date().toISOString()
  if (kind === 'GRIB') {
    const file = await grib.save(data, name)
    return { kind, name: file.name, slot, fileId: file.id }
  }
  if (kind === 'TRACK') {
    const entries = points.map(({ position: [lon, lat], time }) =>
      `<trkpt lat="${lat}" lon="${lon}">${time ? `<time>${time}</time>` : ''}</trkpt>`).join('\n')
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="qtVlm receiver" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${escaped(name)}</name><trkseg>\n${entries}\n</trkseg></trk></gpx>\n`
    const file = await writeArtifact(trackDirectory, name, digest, 'gpx', gpx)
    return { kind, name, file, count: points.length }
  }
  if (kind === 'BARRIER') {
    const features = barriers.map(({ coordinates, label, mode, color }) => {
      const closed = coordinates.length > 3 && coordinates[0].every((value, index) => value === coordinates.at(-1)[index])
      return feature(closed ? 'Polygon' : 'LineString', closed ? [coordinates] : coordinates, { label, mode, color })
    })
    const file = await writeArtifact(barrierDirectory, name, digest, 'geojson',
      JSON.stringify({ type: 'FeatureCollection', name, features }))
    return { kind, name, file, count: barriers.length }
  }
  if (!resources?.setResource) throw new Error('Signal K Resources API is unavailable')
  if (kind === 'ROUTE' || kind === 'PATHWAY') {
    if (points.length < 2) throw new Error('qtVlm routes require at least two points')
    const id = resourceId(['qtVlm', kind, name, points.map(({ position, name }) => [position, name])])
    const geometry = feature('LineString', points.map(({ position }) => position), {
      name, waypoints: points, importSource: 'qtVlm'
    })
    await resources.setResource('routes', id, { name, feature: geometry, timestamp: now })
    return { kind, name, count: points.length }
  }
  for (const point of points) {
    const { name: pointName, position, description, ...attributes } = point
    const properties = { ...attributes, ...(kind === 'ARCHIVE' ? { qtVlmArchive: name } : {}) }
    const id = resourceId(['qtVlm', kind, kind === 'ARCHIVE' ? name : '', pointName, position])
    await resources.setResource('waypoints', id, {
      name: pointName, description, feature: feature('Point', position, properties), timestamp: now
    })
  }
  return { kind, name, count: points.length }
}

module.exports = { storeQtVlm }
