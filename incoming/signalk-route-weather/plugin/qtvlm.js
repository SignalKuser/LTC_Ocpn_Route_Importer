'use strict'

const dgram = require('node:dgram')
const net = require('node:net')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const { inflateSync } = require('node:zlib')
const { MAX_GRIB_BYTES } = require('./local-grib')

const PORT = 5555
const MARKER = Buffer.from('<qtVlmData>')
const TYPES = new Set(['ROUTE', 'PATHWAY', 'GRIB', 'POI', 'ARCHIVE', 'BARRIER', 'TRACK'])
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024
const MAX_TRANSFER_BYTES = MAX_GRIB_BYTES + 1024

function decodeTransfer(buffer) {
  const match = /^<qtVlmData><([A-Z]+)>/.exec(buffer.subarray(0, 64).toString('ascii'))
  if (!match || !TYPES.has(match[1])) throw new Error('Unsupported qtVlm transfer type')
  if (!buffer.subarray(-MARKER.length).equals(MARKER)) throw new Error('Incomplete qtVlm transfer')
  const kind = match[1]
  let start = match[0].length
  const end = buffer.length - MARKER.length
  let name = ''
  let slot
  if (kind === 'GRIB' || kind === 'ARCHIVE') {
    const divider = buffer.indexOf(124, start)
    if (divider < start || divider > start + 512 || divider >= end) throw new Error('Invalid qtVlm file header')
    name = buffer.toString('utf8', start, divider)
    start = divider + 1
    if (kind === 'GRIB') {
      const separator = name.indexOf(';')
      if (separator < 1) throw new Error('Missing qtVlm GRIB slot')
      slot = name.slice(0, separator)
      if (!/^[123]$/.test(slot)) throw new Error('Invalid qtVlm GRIB slot')
      name = name.slice(separator + 1)
      return { kind, name, slot, data: buffer.subarray(start, end) }
    }
  }
  if (end - start < 5) throw new Error('Missing qtVlm compressed payload')
  const length = buffer.readUInt32BE(start)
  if (length < 1 || length > MAX_DOCUMENT_BYTES) throw new Error('Invalid qtVlm document size')
  const output = inflateSync(buffer.subarray(start + 4, end), { maxOutputLength: length, info: true })
  if (output.buffer.length !== length || output.engine.bytesWritten !== end - start - 4) throw new Error('Invalid qtVlm compressed payload')
  return { kind, name, data: output.buffer }
}

function readXml(kind, data, python = 'python3') {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(__dirname, 'qtvlm-xml.py'), kind], { windowsHide: true })
    const stdout = []
    const stderr = []
    const deadline = setTimeout(() => child.kill(), 12000)
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', (error) => {
      clearTimeout(deadline)
      reject(error.code === 'ENOENT' ? new Error('qtVlm XML import requires python3 on the Signal K Pi') : error)
    })
    child.on('close', (code) => {
      clearTimeout(deadline)
      if (code !== 0) return reject(new Error(Buffer.concat(stderr).toString().trim() || 'qtVlm XML parser failed'))
      try { resolve(JSON.parse(Buffer.concat(stdout))) } catch (error) { reject(error) }
    })
    child.stdin.on('error', reject)
    child.stdin.end(data)
  })
}

function position(longitude, latitude, scale = 1) {
  if (longitude === '' || latitude === '' || longitude == null || latitude == null) throw new Error('Missing qtVlm coordinates')
  const lon = Number(longitude) / scale
  const lat = Number(latitude) / scale
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error('Invalid qtVlm coordinates')
  return [lon, lat]
}

async function parseTransfer(transfer, python) {
  const { kind, name, data } = transfer
  if (kind === 'GRIB') return transfer
  if (kind === 'ROUTE' || kind === 'POI' || kind === 'ARCHIVE') {
    const xml = await readXml(kind, data, python)
    return { kind, name: xml.name || name || xml.points[0]?.name, points: xml.points.map((point) =>
      ({ ...point, position: position(...point.position) })) }
  }
  const json = JSON.parse(data)
  if (kind === 'TRACK') {
    if (!Array.isArray(json) || !Array.isArray(json[0]) || json.length < 2) throw new Error('Invalid qtVlm track')
    return { kind, name: json[0][0], points: json.slice(1).map(([lon, lat, seconds]) => {
      const value = Number(seconds)
      const date = new Date(value * 1000)
      return { position: position(lon, lat, 1000), time: value > 0 && Number.isFinite(date.getTime()) ? date.toISOString() : null }
    }) }
  }
  if (!Array.isArray(json?.points)) throw new Error('Missing qtVlm points')
  if (kind === 'PATHWAY') {
    return { kind, name: json.name, points: json.points.map(([pointName, sequence, mode, lon, lat]) =>
      ({ name: pointName, position: position(lon, lat, 1000), sequence, mode })) }
  }
  const barriers = json.points.map(([label, mode, color, vertices]) => {
    const coordinates = vertices.split(';').filter(Boolean).map((vertex) => {
      const [lon, lat] = vertex.split('/')
      return position(lon, lat, 1000)
    })
    if (coordinates.length < 2) throw new Error('Invalid qtVlm barrier geometry')
    return { label, mode, color, coordinates }
  })
  if (!barriers.length) throw new Error('qtVlm barrier set is empty')
  return { kind, name: json.name, barriers }
}

function createReceiver(accept, report) {
  let udp
  let tcp
  let busy = false
  let listening = false
  const senders = new Map()

  function start() {
    if (udp) return
    senders.clear()
    const owned = dgram.createSocket('udp4')
    udp = owned
    owned.on('listening', () => { if (udp === owned) listening = true })
    owned.on('error', (error) => {
      report(error)
      if (udp === owned) stop()
    })
    owned.on('message', (packet, remote) => {
      const text = packet.toString('utf8')
      if (packet.length > 1024 || !/^qtVlmDataExchange;[^;]+;5555;[^\r\n]*;\r?\n$/.test(text)) return
      const now = Date.now()
      for (const [address, announcement] of senders) if (now - announcement.seen > 4200) senders.delete(address)
      const previous = senders.get(remote.address)
      senders.set(remote.address, { text, seen: now, received: previous?.text === text && previous.received })
      if (busy || previous?.text === text && previous.received) return

      busy = true
      const socket = net.createConnection({ host: remote.address, port: PORT })
      tcp = socket
      socket.setTimeout(8000, () => socket.destroy(new Error('qtVlm transfer timed out')))
      const chunks = []
      let size = 0
      let finished = false
      socket.on('error', (error) => { if (!finished && udp === owned) report(error) })
      socket.on('end', () => {
        if (!finished && udp === owned) report(new Error('qtVlm connection ended before the complete transfer arrived'))
      })
      socket.on('close', () => {
        if (tcp === socket) tcp = null
        if (!finished) busy = false
      })
      socket.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_TRANSFER_BYTES) return socket.destroy(new Error('qtVlm transfer exceeds 128 MiB'))
        chunks.push(chunk)
        if (chunk.subarray(-MARKER.length).equals(MARKER) ||
            (chunk.length < MARKER.length && chunks.length > 1 &&
              Buffer.concat(chunks.slice(-MARKER.length)).subarray(-MARKER.length).equals(MARKER))) {
          finished = true
          socket.destroy()
          const current = senders.get(remote.address)
          if (current?.text === text) current.received = true
          Promise.resolve().then(() => {
            if (udp !== owned) return
            const raw = Buffer.concat(chunks, size)
            const digest = createHash('sha256').update(raw).digest('hex')
            return accept(decodeTransfer(raw), digest)
          }).catch(report).finally(() => { busy = false })
        }
      })
    })
    owned.bind(PORT)
  }

  function stop() {
    if (!udp) return
    const owned = udp
    udp = null
    listening = false
    owned.close()
    tcp?.destroy()
  }

  return { start, stop, isListening: () => listening }
}

module.exports = { createReceiver, decodeTransfer, parseTransfer }
