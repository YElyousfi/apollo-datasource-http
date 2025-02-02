import { ApolloError, AuthenticationError, ForbiddenError } from 'apollo-server-errors'
import anyTest, { TestInterface } from 'ava'
import { uid } from 'uid'
import nock from 'nock'
import { CancelError, HTTPDataSource, TimeoutError, RequestOptions, RequestError, Request } from '../src'
import { DataSourceConfig } from 'apollo-datasource'

const test = anyTest as TestInterface<{ path: string }>

test.beforeEach((t) => {
  t.context.path = `/${uid()}`
})

test('Should be able to make a simple GET call', async (t) => {
  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL).get(path).reply(200, { name: 'foo' })

  const dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path)
    }
  })()

  const response = await dataSource.getFoo()

  t.is(scope.isDone(), true)
  t.deepEqual(response.body, { name: 'foo' })
})

test('Should error with ApolloError', async (t) => {
  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL).get(path).reply(400)

  const dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path)
    }
  })()

  await t.throwsAsync(
    dataSource.getFoo(),
    { instanceOf: ApolloError, message: 'Response code 400 (Bad Request)' },
    'Bad request',
  )
  t.is(scope.isDone(), true)
})

test('Should error with AuthenticationError', async (t) => {
  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL).get(path).reply(401)

  const dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path)
    }
  })()

  await t.throwsAsync(
    dataSource.getFoo(),
    {
      instanceOf: AuthenticationError,
      message: 'Response code 401 (Unauthorized)',
    },
    'Unauthenticated',
  )
  t.is(scope.isDone(), true)
})

test('Should error with ForbiddenError', async (t) => {
  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL).get(path).reply(403)

  const dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path)
    }
  })()

  await t.throwsAsync(
    dataSource.getFoo(),
    {
      instanceOf: ForbiddenError,
      message: 'Response code 403 (Forbidden)',
    },
    'Unauthenticated',
  )
  t.is(scope.isDone(), true)
})

test('Should cache subsequent GET calls to the same endpoint', async (t) => {
  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL).get(path).times(1).reply(200, { name: 'foo' })

  const dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path)
    }
  })()

  let response = await dataSource.getFoo()
  t.false(response.isFromCache)
  t.deepEqual(response.body, { name: 'foo' })

  response = await dataSource.getFoo()
  t.deepEqual(response.body, { name: 'foo' })

  response = await dataSource.getFoo()
  t.deepEqual(response.body, { name: 'foo' })

  t.is(scope.isDone(), true)
})

test('Should be able to define a custom cache key for request memoization', async (t) => {
  t.plan(5)

  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL).get(path).times(1).reply(200, { name: 'foo' })

  const dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    onCacheKeyCalculation(_requestOptions: RequestOptions) {
      t.pass('onCacheKeyCalculation');
      return 'foo'
    }

    async getFoo() {
      return await this.get(path)
    }

    async getBar() {
      return await this.get(path + 'bar')
    }
  })()

  let response = await dataSource.getFoo()
  t.deepEqual(response.body, { name: 'foo' })

  response = await dataSource.getBar()
  t.deepEqual(response.body, { name: 'foo' })

  t.is(scope.isDone(), true)
})

test('Should timeout', async (t) => {
  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL).get(path).delay(300).reply(200, { name: 'foo' })

  const dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    constructor() {
      super({
        requestOptions: {
          timeout: 100,
        },
      })
    }

    async getFoo() {
      return await this.get(path)
    }
  })()

  await t.throwsAsync(
    dataSource.getFoo(),
    {
      instanceOf: TimeoutError,
      message: "Timeout awaiting 'request' for 100ms",
    },
    'Timeout',
  )

  t.is(scope.isDone(), true)
})

test('Should call onRequestError on request error', async (t) => {
  t.plan(5)

  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL).get(path).reply(500)

  const dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async onRequestError(error: Error, request?: Request) {
      t.true(error instanceof RequestError);
      t.truthy(request);
      t.pass('onRequestError');
    }

    async getFoo() {
      return await this.get(path)
    }
  })()

  await t.throwsAsync(
    dataSource.getFoo(),
    {
      instanceOf: ApolloError,
      message: "Response code 500 (Internal Server Error)",
    },
    'Server error',
  )

  t.is(scope.isDone(), true)
})

test.cb('Should abort request', (t) => {
  t.plan(2)

  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL).get(path).delay(500).reply(200, { name: 'foo' })

  const dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    constructor() {
      super({
        requestOptions: {
          timeout: 1000,
        },
      })
    }

    async getFoo() {
      return await this.get(path)
    }
  })()

  t.throwsAsync(
    async () => {
      try {
        await dataSource.getFoo()
        t.fail()
      } catch (error) {
        t.is(scope.isDone(), false)
        throw error
      }
    },
    {
      instanceOf: CancelError,
      message: 'Promise was canceled',
    },
    'Timeout',
  ).finally(t.end)

  dataSource.abort()
})

test('Should be able to modify request in willSendRequest', async (t) => {
  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL, {
    reqheaders: {
      'X-Foo': 'bar',
    },
  })
    .get(path)
    .reply(200, { name: 'foo' })

  const dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async beforeRequest(requestOptions: RequestOptions) {
      requestOptions.headers = {
        'X-Foo': 'bar',
      }
    }

    async getFoo() {
      return await this.get(path)
    }
  })()

  const response = await dataSource.getFoo()

  t.is(scope.isDone(), true)
  t.deepEqual(response.body, { name: 'foo' })
})

test('Initialize data source with cache and context', async (t) => {
  t.plan(4)

  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL).get(path).reply(200, { name: 'foo' })

  const dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      t.deepEqual(this.context, {
        a: 1,
      })
      return await this.get(path)
    }
  })()

  const map = new Map<string, string>()

  dataSource.initialize({
    context: {
      a: 1,
    },
    cache: {
      async delete(key: string) {
        return map.delete(key)
      },
      async get(key: string) {
        return map.get(key)
      },
      async set(key: string, value: string) {
        map.set(key, value)
      },
    },
  })

  const response = await dataSource.getFoo()

  t.is(scope.isDone(), true)
  t.deepEqual(response.body, { name: 'foo' })
  t.truthy(map.get(`keyv:cacheable-request:GET:https://api.example.com${path}`))
})

test('Response is cached with max-age', async (t) => {
  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL).get(path).once().reply(
    200,
    { name: 'foo' },
    {
      'Cache-Control': 'public, max-age=60',
    },
  )

  let dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path, {
        cacheOptions: {
          shared: true,
          cacheHeuristic: 0.1,
          immutableMinTimeToLive: 24 * 3600 * 1000, // 24h
          ignoreCargoCult: false,
        },
      })
    }
  })()

  const map = new Map<string, string>()

  const config: DataSourceConfig<Record<string, unknown>> = {
    context: {},
    cache: {
      async delete(key: string) {
        return map.delete(key)
      },
      async get(key: string) {
        return map.get(key)
      },
      async set(key: string, value: string) {
        map.set(key, value)
      },
    },
  }

  dataSource.initialize(config)

  let response = await dataSource.getFoo()

  t.is(scope.isDone(), true)
  t.false(response.isFromCache)
  t.deepEqual(response.body, { name: 'foo' })
  t.true(map.size > 0)

  dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path)
    }
  })()

  dataSource.initialize(config)

  response = await dataSource.getFoo()
  t.true(response.isFromCache)
  t.deepEqual(response.body, { name: 'foo' })
})

test('Response is not cached', async (t) => {
  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scope = nock(baseURL).get(path).twice().reply(
    200,
    { name: 'foo' },
    {
      'Cache-Control': 'public, no-cache, no-store',
    },
  )

  let dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path, {
        cacheOptions: {
          shared: true,
          cacheHeuristic: 0.1,
          immutableMinTimeToLive: 24 * 3600 * 1000, // 24h
          ignoreCargoCult: false,
        },
      })
    }
  })()

  const map = new Map<string, string>()

  const config: DataSourceConfig<Record<string, unknown>> = {
    context: {},
    cache: {
      async delete(key: string) {
        return map.delete(key)
      },
      async get(key: string) {
        return map.get(key)
      },
      async set(key: string, value: string) {
        map.set(key, value)
      },
    },
  }

  dataSource.initialize(config)

  let response = await dataSource.getFoo()

  t.false(response.isFromCache)
  t.deepEqual(response.body, { name: 'foo' })
  t.true(map.size === 0)

  dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path)
    }
  })()

  dataSource.initialize(config)

  response = await dataSource.getFoo()
  t.is(scope.isDone(), true)
  t.false(response.isFromCache)
  t.deepEqual(response.body, { name: 'foo' })
})

test('Response is not cached due to origin error', async (t) => {
  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scopeSuccess = nock(baseURL).get(path).once().reply(
    200,
    { name: 'foo' },
    {
      'Cache-Control': 'public, max-age=0',
    },
  )

  let dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path, {
        cacheOptions: {
          shared: true,
          cacheHeuristic: 0.1,
          immutableMinTimeToLive: 24 * 3600 * 1000, // 24h
          ignoreCargoCult: false,
        },
      })
    }
  })()

  const map = new Map<string, string>()

  const config: DataSourceConfig<Record<string, unknown>> = {
    context: {},
    cache: {
      async delete(key: string) {
        return map.delete(key)
      },
      async get(key: string) {
        return map.get(key)
      },
      async set(key: string, value: string) {
        map.set(key, value)
      },
    },
  }

  dataSource.initialize(config)

  const response = await dataSource.getFoo()

  t.is(scopeSuccess.isDone(), true)
  t.false(response.isFromCache)
  t.deepEqual(response.body, { name: 'foo' })
  t.true(map.size > 0)

  dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path)
    }
  })()

  dataSource.initialize(config)

  const scopeError = nock(baseURL).get(path).once().reply(500)

  await t.throwsAsync(
    dataSource.getFoo(),
    {
      message: 'Response code 500 (Internal Server Error)',
    },
    'message',
  )
  t.is(scopeError.isDone(), true)
  t.false(response.isFromCache)
})

test('Response is cached due to stale-if-error', async (t) => {
  const baseURL = 'https://api.example.com'
  const { path } = t.context
  const scopeSuccess = nock(baseURL).get(path).once().reply(
    200,
    { name: 'foo' },
    {
      'Cache-Control': 'public, max-age=0, stale-if-error=200',
    },
  )
  const scopeError = nock(baseURL).get(path).once().reply(500)

  let dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path)
    }
  })()

  const map = new Map<string, string>()

  const config: DataSourceConfig<Record<string, unknown>> = {
    context: {},
    cache: {
      async delete(key: string) {
        return map.delete(key)
      },
      async get(key: string) {
        return map.get(key)
      },
      async set(key: string, value: string) {
        map.set(key, value)
      },
    },
  }

  dataSource.initialize(config)

  let response = await dataSource.getFoo()

  t.is(scopeSuccess.isDone(), true)
  t.false(response.isFromCache)
  t.deepEqual(response.body, { name: 'foo' })
  t.true(map.size > 0)

  dataSource = new (class extends HTTPDataSource {
    baseURL = baseURL

    async getFoo() {
      return await this.get(path)
    }
  })()

  dataSource.initialize(config)

  response = await dataSource.getFoo()
  t.is(scopeError.isDone(), true)
  t.true(response.isFromCache)
  t.deepEqual(response.body, { name: 'foo' })
})
