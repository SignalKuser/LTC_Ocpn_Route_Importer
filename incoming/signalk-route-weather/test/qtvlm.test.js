'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { deflateSync } = require('node:zlib')
const { decodeTransfer, parseTransfer } = require('../plugin/qtvlm')
const { createGribLibrary, fieldFor, hasCoverage, validateGrib } = require('../plugin/local-grib')

function transfer(kind, body, prefix = '') {
  const header = Buffer.from(`<qtVlmData><${kind}>${prefix}`)
  const footer = Buffer.from('<qtVlmData>')
  if (kind === 'GRIB') return Buffer.concat([header, body, footer])
  const original = Buffer.from(JSON.stringify(body))
  const size = Buffer.alloc(4)
  size.writeUInt32BE(original.length)
  return Buffer.concat([header, size, deflateSync(original), footer])
}

test('qtVlm pathway retains ordered waypoint names and converts coordinates to degrees', async () => {
  const payload = transfer('PATHWAY', { name: 'Test', points: [
    ['A', '10', '0', '4662.075', '53025.116', ''],
    ['B', '20', '0', '4645.180', '53012.217', '']
  ] })
  const { name, points } = await parseTransfer(decodeTransfer(payload))
  assert.equal(name, 'Test')
  assert.deepEqual(points.map((point) => point.name), ['A', 'B'])
  assert.ok(Math.abs(points[0].position[0] - 4.662075) < 1e-10)
  assert.ok(Math.abs(points[0].position[1] - 53.025116) < 1e-10)
  assert.throws(() => decodeTransfer(payload.subarray(0, -1)), /Incomplete/)
})

test('track timestamps and barrier line coordinates survive conversion', async () => {
  const track = await parseTransfer(decodeTransfer(transfer('TRACK', [
    ['Track', '#ff0000', '1'], ['4700', '53000', '1794744000'], ['4750', '53050', '1794744020']
  ])))
  assert.deepEqual(track.points[1].position, [4.75, 53.05])
  assert.equal(track.points[1].time, new Date(1794744020000).toISOString())

  const barrier = await parseTransfer(decodeTransfer(transfer('BARRIER', {
    name: 'Barrier', points: [['', '0', '#000000', '4595/53045;4611/52994']]
  })))
  assert.deepEqual(barrier.barriers[0].coordinates, [[4.595, 53.045], [4.611, 52.994]])
})

test('the GRIB transport keeps binary bytes and channel intact', () => {
  const binary = Buffer.from([71, 82, 73, 66, 0, 0, 12, 1, 55, 55, 55, 55])
  const decoded = decodeTransfer(transfer('GRIB', binary, '3;detail.grb|'))
  assert.equal(decoded.slot, '3')
  assert.equal(decoded.name, 'detail.grb')
  assert.deepEqual(decoded.data, binary)
  assert.doesNotThrow(() => validateGrib(decoded.data))
  assert.throws(() => validateGrib(decoded.data.subarray(0, -1)), /Expected a GRIB|Incomplete/)
})

test('local GRIB only treats near-surface wind as sailing wind and rejects points beyond a regional grid', () => {
  assert.equal(fieldFor({ shortName: 'u', typeOfLevel: 'isobaricInhPa', level: 500 }), null)
  assert.equal(fieldFor({ shortName: 'u', typeOfLevel: 'heightAboveGround', level: 10 }), 'u')
  assert.equal(fieldFor({ discipline: 10, parameterCategory: 0, parameterNumber: 3 }), 'waveHeight')
  const grid = {
    gridType: 'regular_ll', latitudeOfFirstGridPointInDegrees: 54, latitudeOfLastGridPointInDegrees: 53,
    longitudeOfFirstGridPointInDegrees: 359, longitudeOfLastGridPointInDegrees: 2,
    iDirectionIncrementInDegrees: 1, Ni: 4, iScansNegatively: 0
  }
  assert.equal(hasCoverage(grid, 53.4, -0.3), true)
  assert.equal(hasCoverage(grid, 53.4, 3), false)
  assert.equal(hasCoverage(grid, 52.4, -0.3), false)
})

test('deleting a saved GRIB removes its binary and metadata but leaves other files alone', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'route-weather-grib-'))
  const library = createGribLibrary(directory)
  const [target, other] = ['a'.repeat(64), 'b'.repeat(64)]
  async function writeFile(id) {
    const metadata = { file: { id, name: `${id}.grb`, savedAt: '2026-11-15T12:00:00Z' }, fields: [] }
    await fs.writeFile(path.join(directory, `${id}.json`), JSON.stringify(metadata))
    await fs.writeFile(path.join(directory, `${id}.grib`), 'GRIB')
  }
  try {
    await writeFile(target)
    await writeFile(other)
    assert.equal((await library.list()).length, 2)
    await library.remove(target)
    assert.deepEqual((await library.list()).map(({ id }) => id), [other])
    await assert.rejects(library.forecast(target, 53, 7, []), { statusCode: 404 })
    await assert.rejects(library.remove(target), { statusCode: 404 })
    await assert.rejects(library.remove('../outside'), { statusCode: 400 })
    assert.deepEqual((await fs.readdir(directory)).sort(), [`${other}.grib`, `${other}.json`])
  } finally {
    for (const filename of await fs.readdir(directory)) await fs.unlink(path.join(directory, filename))
    await fs.rmdir(directory)
  }
})
