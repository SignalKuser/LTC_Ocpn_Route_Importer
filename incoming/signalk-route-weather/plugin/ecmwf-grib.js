'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { requireResponse, requireGribTool, readForecast, readDownload } = require('./grib-forecast')

const root = 'https://data.ecmwf.int/forecasts'
const fields = new Set(['10u', '10v', '2t', 'msl', '10fg'])
const pending = new Map()
const hourMs = 3600000

async function downloadStep(base, signal, onBytes, cloud) {
  const index = await fetch(`${base}.index`, { signal })
  if ([404, 410].includes(index.status)) {
    await index.body?.cancel()
    return null
  }
  requireResponse(index, 'ECMWF')
  const ranges = (await readDownload(index, onBytes, 4 * 1024 * 1024)).toString('utf8').trim().split('\n').map((line) => JSON.parse(line))
    .filter((item) => item.levtype === 'sfc' && (fields.has(item.param) || (cloud && item.param === 'tcc')))
  if (!['10u', '10v'].every((param) => ranges.some((item) => item.param === param))) {
    throw new Error('ECMWF index did not contain both wind components')
  }
  const messages = []
  for (const item of ranges) {
    const start = item._offset
    const length = item._length
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 16 || length > 32 * 1024 * 1024) {
      throw new Error('Invalid GRIB byte range in ECMWF index')
    }
    const end = start + length - 1
    const response = await fetch(`${base}.grib2`, { headers: { Range: `bytes=${start}-${end}` }, signal })
    if ([404, 410].includes(response.status)) {
      await response.body?.cancel()
      if (['10u', '10v'].includes(item.param)) return null
      continue
    }
    requireResponse(response, 'ECMWF')
    if (response.status !== 206 || !response.headers.get('Content-Range')?.startsWith(`bytes ${start}-${end}/`)) {
      await response.body?.cancel()
      throw new Error('ECMWF did not return the requested GRIB byte range')
    }
    const data = await readDownload(response, onBytes, length)
    if (data.length !== length || data.toString('ascii', 0, 4) !== 'GRIB' || data.subarray(-4).toString('ascii') !== '7777') {
      throw new Error('ECMWF returned an incomplete GRIB message')
    }
    messages.push(data)
  }
  return Buffer.concat(messages)
}

async function downloadRun(directory, filename, runTime, onBytes, resolution, cloud) {
  try {
    await fs.access(filename)
    return filename
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await fs.mkdir(directory, { recursive: true })
  const day = runTime.toISOString().slice(0, 10).replaceAll('-', '')
  const hour = runTime.toISOString().slice(11, 13)
  const base = `${root}/${day}/${hour}z/ifs/${resolution}/oper/${day}${hour}0000`
  const suffix = resolution === '0p1' ? '-oper-fc-sfc' : '-oper-fc'
  const temporary = path.join(directory, `${randomUUID()}.part`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 165000)
  try {
    const firstStep = Math.max(0, Math.floor((Date.now() - runTime.getTime()) / (3 * hourMs)) * 3)
    const lastStep = Math.min(firstStep + 72, ['06', '18'].includes(hour) ? 90 : 144)
    const steps = Array.from({ length: Math.max(0, (lastStep - firstStep) / 3 + 1) }, (_, i) => firstStep + i * 3)
    let written = false
    for (let i = 0; i < steps.length; i += 3) {
      const batch = steps.slice(i, i + 3).map((step) => downloadStep(`${base}-${step}h${suffix}`, controller.signal, onBytes, cloud))
      const messages = await Promise.all(batch).catch(async (error) => {
        controller.abort()
        await Promise.allSettled(batch)
        throw error
      })
      const available = messages.filter(Boolean)
      if (available.length) {
        await fs.appendFile(temporary, Buffer.concat(available))
        written = true
      }
    }
    if (!written) throw new Error('ECMWF has no available forecast steps for the selected run')
    await fs.rename(temporary, filename)
    return filename
  } finally {
    clearTimeout(timeout)
    await fs.rm(temporary, { force: true })
  }
}

async function fetchEcmwfForecast(directory, latitude, longitude, onBytes, resolution, cloud) {
  await requireGribTool()
  // Use a cycle with time to publish the full forecast window.
  const runTime = new Date(Math.floor((Date.now() - 9 * hourMs) / (6 * hourMs)) * 6 * hourMs)
  const fine = resolution === '0p1'
  const filename = path.join(directory, `ecmwf-ifs-${fine ? '0p1-' : ''}${cloud ? 'cloud-' : ''}${runTime.toISOString().slice(0, 13).replace(/[-T]/g, '')}.grib2`)
  if (!pending.has(filename)) pending.set(filename, downloadRun(directory, filename, runTime, onBytes, resolution, cloud).finally(() => pending.delete(filename)))
  return readForecast(await pending.get(filename), latitude, longitude, fine ? 'ECMWF IFS 0.1°' : 'ECMWF IFS 0.25°')
}

module.exports = { fetchEcmwfForecast }
