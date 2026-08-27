import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup as cleanupDataChannel } from 'node-datachannel'
import TrackerServer from 'bittorrent-tracker/server'
import WebTorrent from 'webtorrent'

const root = await mkdtemp(join(tmpdir(), 'torlink-wt-gate-'))
const sourceDir = join(root, 'source')
const downloadDir = join(root, 'download')
const bufferDir = join(root, 'buffer')
const pathDir = join(root, 'path')
await Promise.all([sourceDir, downloadDir, bufferDir, pathDir].map((dir) => mkdir(dir)))

const payload = Buffer.alloc(4 * 1024 * 1024)
for (let i = 0; i < payload.length; i += 1) payload[i] = i % 251
const sourcePath = join(sourceDir, 'legal-fixture.bin')
const torrentPath = join(root, 'legal-fixture.torrent')
await writeFile(sourcePath, payload)

const timeout = (label, ms = 30_000) => new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  timer.unref?.()
})
const waitFor = (emitter, event, ms = 30_000) => Promise.race([
  new Promise((resolve, reject) => {
    emitter.once(event, resolve)
    emitter.once('error', reject)
  }),
  timeout(event, ms),
])
const destroyClient = (client) => new Promise((resolve, reject) => {
  client.destroy((error) => error ? reject(error) : resolve())
})
const removeTorrent = (client, torrentId) => new Promise((resolve, reject) => {
  client.remove(torrentId, (error) => error ? reject(error) : resolve())
})
const destroyServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve())
})

const report = {
  version: null,
  lifecycle: false,
  errorHandling: false,
  inputs: { magnet: false, infoHash: false, buffer: false, path: false },
  behavior: {},
  network: { tcpPeers: false, udpTracker: false, tracker: false, peerDiscovery: false, dht: false },
  restartRestore: false,
}

report.version = '3.0.21'

const lifecycle = new WebTorrent({ dht: false, tracker: false, lsd: false, utp: false, natUpnp: false, natPmp: false })
let clientErrorObserved = false
lifecycle.on('error', () => { clientErrorObserved = true })
const invalidTorrent = lifecycle.add('not-a-torrent')
let torrentErrorObserved = false
invalidTorrent.once('error', () => { torrentErrorObserved = true })
await new Promise((resolve) => setTimeout(resolve, 100))
report.errorHandling = torrentErrorObserved && !clientErrorObserved
assert.equal(report.errorHandling, true)
await destroyClient(lifecycle)
report.lifecycle = lifecycle.destroyed === true

const tracker = new TrackerServer({ http: false, udp: true, ws: false, stats: false })
tracker.on('error', (error) => { throw error })
await new Promise((resolve) => tracker.listen(0, { udp: '127.0.0.1', udp6: '::1' }, resolve))
const trackerPort = tracker.udp.address().port
const announce = `udp://127.0.0.1:${trackerPort}`

const clientOptions = { dht: false, tracker: true, lsd: false, utp: false, natUpnp: false, natPmp: false }
const seeder = new WebTorrent(clientOptions)
seeder.on('error', (error) => { throw error })
const seeded = await Promise.race([
  new Promise((resolve) => seeder.seed(sourcePath, { announce: [announce] }, resolve)),
  timeout('seed'),
])
await writeFile(torrentPath, seeded.torrentFile)

assert.equal(seeded.files.length, 1)
assert.equal(seeded.files[0].path, 'legal-fixture.bin')
assert.equal(seeded.length, payload.length)
assert.equal(seeded.done, true)
assert.equal(seeded.progress, 1)

const leecher = new WebTorrent(clientOptions)
leecher.on('error', (error) => { throw error })
let metadata = false
let progressEvents = 0
let paused = false
let resumed = false
const downloaded = leecher.add(seeded.magnetURI, { path: downloadDir, announce: [announce] })
downloaded.once('metadata', () => {
  metadata = true
  downloaded.pause()
  paused = downloaded.paused === true
  setTimeout(() => {
    downloaded.resume()
    resumed = downloaded.paused === false
  }, 50)
})
downloaded.on('download', () => { progressEvents += 1 })
if (!downloaded.done) await waitFor(downloaded, 'done')

const downloadedBytes = await readFile(join(downloadDir, 'legal-fixture.bin'))
assert.deepEqual(downloadedBytes, payload)
assert.equal(downloaded.infoHash, seeded.infoHash)
assert.equal(downloaded.path, downloadDir)
assert.equal(downloaded.files.length, 1)
assert.equal(downloaded.length, payload.length)
assert.equal(downloaded.downloaded, payload.length)
assert.equal(downloaded.done, true)
assert.equal(downloaded.progress, 1)
assert.equal(typeof downloaded.downloadSpeed, 'number')
assert.equal(typeof downloaded.uploadSpeed, 'number')
assert.equal(typeof downloaded.timeRemaining, 'number')

report.inputs.magnet = true
report.behavior = {
  add: true,
  remove: false,
  pause: paused,
  resume: resumed,
  metadata,
  progressEvents,
  downloadSpeed: true,
  uploadSpeed: true,
  downloaded: true,
  length: true,
  timeRemaining: true,
  done: true,
  infoHash: true,
  files: true,
  path: true,
}
report.network.tcpPeers = downloaded.numPeers > 0 || seeded.numPeers > 0
report.network.udpTracker = true
report.network.tracker = true
report.network.peerDiscovery = report.network.tcpPeers

const downloadedInfoHash = downloaded.infoHash
await removeTorrent(leecher, downloadedInfoHash)
report.behavior.remove = await leecher.get(downloadedInfoHash) === null
await destroyClient(leecher)

for (const [kind, source, targetDir] of [
  ['buffer', seeded.torrentFile, bufferDir],
  ['path', torrentPath, pathDir],
]) {
  const client = new WebTorrent({ ...clientOptions, tracker: false })
  client.on('error', (error) => { throw error })
  const torrent = client.add(source, { path: targetDir })
  if (!torrent.ready) await waitFor(torrent, 'ready', 10_000)
  assert.equal(torrent.infoHash, seeded.infoHash)
  report.inputs[kind] = true
  await removeTorrent(client, torrent.infoHash)
  await destroyClient(client)
}

const hashClient = new WebTorrent({ ...clientOptions, tracker: false })
hashClient.on('error', (error) => { throw error })
const byHash = hashClient.add(seeded.infoHash, { path: join(root, 'hash') })
await waitFor(byHash, 'infoHash', 5_000).catch(() => {})
assert.equal(byHash.infoHash, seeded.infoHash)
report.inputs.infoHash = true
await removeTorrent(hashClient, seeded.infoHash)
await destroyClient(hashClient)

const restoredClient = new WebTorrent({ ...clientOptions, tracker: false })
restoredClient.on('error', (error) => { throw error })
const restored = restoredClient.add(torrentPath, { path: downloadDir })
if (!restored.done) await waitFor(restored, 'done', 20_000)
assert.equal(restored.progress, 1)
assert.equal(restored.downloaded, payload.length)
report.restartRestore = true
await destroyClient(restoredClient)

const dhtClient = new WebTorrent({ dht: { bootstrap: false }, tracker: false, lsd: false, utp: false, natUpnp: false, natPmp: false })
dhtClient.on('error', (error) => { throw error })
if (!dhtClient.dht.listening) await waitFor(dhtClient.dht, 'listening', 10_000)
const dhtAddress = dhtClient.dht.address()
assert.ok(dhtAddress.port > 0)
report.network.dht = true
await destroyClient(dhtClient)

await destroyClient(seeder)
await destroyServer(tracker)
cleanupDataChannel()
await rm(root, { recursive: true, force: true })

assert.ok(report.behavior.progressEvents > 0)
assert.ok(Object.values(report.inputs).every(Boolean))
assert.ok(Object.values(report.network).every(Boolean))
console.log(JSON.stringify(report, null, 2))
assert.ok(Object.values(report.behavior).every((value) => value === true || (typeof value === 'number' && value > 0)))
await new Promise((resolve) => setTimeout(resolve, 100))
const activeResources = process.getActiveResourcesInfo().filter((resource) => resource !== 'PipeWrap')
assert.deepEqual(activeResources, [], `resources still active after shutdown: ${activeResources.join(', ')}`)
