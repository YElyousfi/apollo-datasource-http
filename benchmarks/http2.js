// mostly copied from  https://github.com/Ethan-Arrowood/undici-fetch/blob/main/benchmarks/index.js

const fs = require('fs')
const { createSecureServer } = require('http2')
const h2url = require('h2url')
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads')

function printResults(results, n) {
  console.log(`Results for ${n} subsequent requests: `)
  const baseKey = 'apollo-datasource-http (http2)'
  const baselineTiming = Number.parseInt(
    results[baseKey].endTime - results[baseKey].startTime,
  )
  for (const [key, timing] of Object.entries(results)) {
    const elapsedTT = Number.parseFloat(timing.endTime - timing.startTime)
    console.log(
      `${key.padEnd(25)} | total time: ${elapsedTT}ns (${(elapsedTT * 0.000_001).toFixed(3)}ms)`,
    )
  }

  console.log('---')
  for (const [key, timing] of Object.entries(results)) {
    if (key === baseKey) continue
    const elapsedTT = Number.parseFloat(timing.endTime - timing.startTime)
    const percent = ((baselineTiming - elapsedTT) / elapsedTT) * 100
    console.log(`${baseKey} <> ${key} percent change: ${percent.toFixed(3)}%`)
  }
}

if (isMainThread) {
  const server = createSecureServer(
    {
      allowHTTP1: true,
      key: fs.readFileSync('localhost-privkey.pem'),
      cert: fs.readFileSync('localhost-cert.pem'),
    },
    (request, res) => {
      process.nextTick(() => {
        res.end('{}')
      })
    },
  )

  server.listen(() => {
    const N = 1000
    const url = `https://localhost:${server.address().port}`

    const spawnWorker = (N, url, clientType) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
          workerData: { N, url, clientType },
        })
        worker.on('message', resolve)
        worker.on('error', reject)
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`))
          }
        })
      })

    Promise.all([
      spawnWorker(N, url, 'apollo-datasource-rest (http1)'),
      spawnWorker(N, url, 'apollo-datasource-http (http2)'),
      spawnWorker(N, url, 'h2url (http2)'),
    ]).then((values) => {
      const results = {}
      for (const { clientType, startTime, endTime } of values) {
        results[clientType] = { startTime, endTime }
      }

      console.log(results)
      printResults(results, N)

      server.close()
    })
  })
} else {
  const { N, url, clientType } = workerData

  let factory = null
  switch (clientType) {
    case 'apollo-datasource-http (http2)': {
      const { HTTPDataSource } = require('..')
      factory = () => {
        return new (class MoviesAPI extends HTTPDataSource {
          baseURL = url
          constructor() {
            super({
              request: {
                http2: true,
                https: {
                  rejectUnauthorized: false,
                },
              },
            })
          }
          async getFoo(path) {
            return this.get(path)
          }
        })()
      }
      break
    }

    case 'apollo-datasource-rest (http1)': {
      const https = require('https')
      const { RESTDataSource, HTTPCache } = require('apollo-datasource-rest')
      const agent = new https.Agent({
        rejectUnauthorized: false,
        keepAlive: true,
      })
      factory = () => {
        const store = new Map()
        const httpCache = new HTTPCache({
          async get(key) {
            return store.get(key)
          },
          async set(key, value) {
            store.set(key, value)
          },
        })
        const datasource = new (class MoviesAPI extends RESTDataSource {
          baseURL = url
          async getFoo(path) {
            return this.get(
              path,
              {},
              {
                agent,
              },
            )
          }
        })()
        datasource.httpCache = httpCache
        return datasource
      }
      break
    }

    case 'h2url (http2)': {
      factory = () => {
        return {
          async getFoo(path) {
            const res = await h2url.concat({ url: `${url}${path}` })
          }
        }
      }
      break
    }

    default: {
      throw new Error(`Invalid data-source ${clientType}`)
    }
  }

  const run = async (N, factory) => {
    const startTime = process.hrtime.bigint()

    for (let i = 0; i < N; i++) {
      const datasource = factory()
      // unique url to avoid request deduplication
      await datasource.getFoo(`/${i}`)
    }

    const endTime = process.hrtime.bigint()

    return { startTime, endTime }
  }

  run(N, factory)
    .then(({ startTime, endTime }) => {
      parentPort.postMessage({
        clientType,
        startTime,
        endTime,
      })
      process.exit(1)
    })
    .catch((err) => {
      console.log(err)
      process.exit(1)
    })
}
