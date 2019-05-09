const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const assert = chai.assert
const BotDriver = require('../../').BotDriver
const Capabilities = require('../../').Capabilities
const nock = require('nock')

const myCapsGet = {
  [Capabilities.CONTAINERMODE]: 'simplerest',
  [Capabilities.SIMPLEREST_URL]: 'http://my-host.com/api/endpoint/{{msg.messageText}}',
  [Capabilities.SIMPLEREST_HEADERS_TEMPLATE]: { HEADER1: 'HEADER1VALUE', HEADER2: '{{msg.token}}' },
  [Capabilities.SIMPLEREST_RESPONSE_JSONPATH]: '$'
}
const myCapsPost = {
  [Capabilities.CONTAINERMODE]: 'simplerest',
  [Capabilities.SIMPLEREST_URL]: 'http://my-host.com/api/endpoint',
  [Capabilities.SIMPLEREST_METHOD]: 'POST',
  [Capabilities.SIMPLEREST_HEADERS_TEMPLATE]: { HEADER1: 'HEADER1VALUE', HEADER2: '{{msg.token}}' },
  [Capabilities.SIMPLEREST_BODY_TEMPLATE]: { BODY1: 'BODY1VALUE', BODY2: '{{msg.messageText}}' },
  [Capabilities.SIMPLEREST_RESPONSE_JSONPATH]: '$'
}
const myCapsScriptingMemory = {
  [Capabilities.CONTAINERMODE]: 'simplerest',
  [Capabilities.SIMPLEREST_URL]: 'http://my-host.com/api/endpoint',
  [Capabilities.SIMPLEREST_METHOD]: 'POST',
  [Capabilities.SIMPLEREST_BODY_TEMPLATE]: {
    FUNCTION_WITHOUT_PARAM: '{{fnc.year}}',
    FUNCTION_WITH_PARAM: '{{#fnc.random}}5{{/fnc.random}}',
    FUNCTION_WITH_PARAM_FROM_SCRIPTING_MEMORY: '{{#fnc.random}}{{msg.scriptingMemory.functionArgument}}{{/fnc.random}}',
    USING_CODE: '{{#fnc.func}}1 + 2{{/fnc.func}}',
    VARIABLE: '{{msg.scriptingMemory.variable}}'
  },
  [Capabilities.SIMPLEREST_RESPONSE_JSONPATH]: '$'
}
const msg = {
  messageText: 'messageText',
  token: 'myToken',
  scriptingMemory: {
    variable: 'value',
    functionArgument: '7'

  }
}

describe('connectors.simplerest.nock', function () {
  it('should build JSON GET url', async () => {
    const caps = {
      [Capabilities.CONTAINERMODE]: 'simplerest',
      [Capabilities.SIMPLEREST_URL]: 'http://my-host.com/api/endpoint/{{msg.messageText}}',
      [Capabilities.SIMPLEREST_HEADERS_TEMPLATE]: { HEADER1: 'HEADER1VALUE', HEADER2: '{{msg.token}}' },
      [Capabilities.SIMPLEREST_RESPONSE_JSONPATH]: '$',
      [Capabilities.SIMPLEREST_PING_URL]: 'https://mock.com/pingget'
    }
    const scope = nock('https://mock.com')
      .get('/pingget')
      .reply(200, {
        status: 'ok'
      })
      .persist()
    const driver = new BotDriver(caps)
    const container = await driver.Build()
    const body = JSON.stringify({})
    const pingConfig = {
      method: 'GET',
      uri: 'https://mock.com/pingget',
      body: body,
      timeout: 10000
    }
    const response = await container.pluginInstance._waitForPingUrl(pingConfig, 2)
    assert.equal(response.body, '{"status":"ok"}')
    scope.persist(false)
  })
  it(`post ping endpoint`, async () => {
    const caps = {
      [Capabilities.CONTAINERMODE]: 'simplerest',
      [Capabilities.SIMPLEREST_URL]: 'http://my-host.com/api/endpoint/{{msg.messageText}}',
      [Capabilities.SIMPLEREST_HEADERS_TEMPLATE]: { HEADER1: 'HEADER1VALUE', HEADER2: '{{msg.token}}' },
      [Capabilities.SIMPLEREST_RESPONSE_JSONPATH]: '$',
      [Capabilities.SIMPLEREST_PING_URL]: 'https://mock.com/pingpost',
      [Capabilities.SIMPLEREST_PING_RETRIES]: 2

    }
    const scope = nock('https://mock.com')
      .post('/pingpost', { status: 'ok?' }, null)
      .reply(200, {
        status: 'ok'
      })
      .persist()
    const driver = new BotDriver(caps)
    const container = await driver.Build()
    const body = JSON.stringify({ status: 'ok?' })
    const pingConfig = {
      method: 'POST',
      uri: 'https://mock.com/pingpost',
      body: body,
      timeout: 100
    }
    const response = await container.pluginInstance._waitForPingUrl(pingConfig, 2)
    assert.equal(response.body, '{"status":"ok"}')
    scope.persist(false)
  })
  it(`error case can't connect`, async () => {
    const caps = {
      [Capabilities.CONTAINERMODE]: 'simplerest',
      [Capabilities.SIMPLEREST_URL]: 'http://my-host.com/api/endpoint/{{msg.messageText}}',
      [Capabilities.SIMPLEREST_HEADERS_TEMPLATE]: { HEADER1: 'HEADER1VALUE', HEADER2: '{{msg.token}}' },
      [Capabilities.SIMPLEREST_RESPONSE_JSONPATH]: '$',
      [Capabilities.SIMPLEREST_PING_URL]: 'https://mock.com/pingfail',
      [Capabilities.SIMPLEREST_PING_RETRIES]: 2
    }
    const scope = nock('https://mock.com')
      .get('/pingfail')
      .reply(404, {
        error: 'notOk'
      })
      .persist()
    const driver = new BotDriver(caps)
    const container = await driver.Build()
    const body = JSON.stringify({})
    const pingConfig = {
      method: 'GET',
      uri: 'https://mock.com/pingfail',
      body: body,
      timeout: 100
    }
    try {
      await container.pluginInstance._waitForPingUrl(pingConfig, 2)
      assert.fail(`expected ping error`)
    } catch (err) {
    }
    scope.persist(false)
  })
})

describe('connectors.simplerest.build', function () {
  it('should build JSON GET url', async function () {
    const myCaps = Object.assign({}, myCapsGet)
    const driver = new BotDriver(myCaps)
    const container = await driver.Build()
    assert.equal(container.pluginInstance.constructor.name, 'SimpleRestContainer')

    await container.Start()
    const request = container.pluginInstance._buildRequest(msg)

    assert.isUndefined(request.json)
    assert.isObject(request.headers)
    assert.isUndefined(request.body)
    assert.equal(request.headers.HEADER2, msg.token)
    assert.equal(request.uri, 'http://my-host.com/api/endpoint/messageText')

    await container.Clean()
  })
  it('should build JSON GET url from encoded characters', async function () {
    const myCaps = Object.assign({}, myCapsGet)
    myCaps[Capabilities.SIMPLEREST_HEADERS_TEMPLATE] = { ORIG: '{{{msg.messageText}}}' }

    const myMsg = Object.assign({}, msg)
    myMsg.messageText = '&?äüö'

    const driver = new BotDriver(myCaps)
    const container = await driver.Build()
    assert.equal(container.pluginInstance.constructor.name, 'SimpleRestContainer')

    await container.Start()
    const request = container.pluginInstance._buildRequest(myMsg)
    assert.isUndefined(request.json)
    assert.isObject(request.headers)
    assert.isUndefined(request.body)
    assert.equal(request.headers.ORIG, myMsg.messageText)
    assert.equal(request.uri, 'http://my-host.com/api/endpoint/' + encodeURIComponent(myMsg.messageText))

    await container.Clean()
  })

  it('should build JSON POST request body', async function () {
    const myCaps = Object.assign({}, myCapsPost)
    const driver = new BotDriver(myCaps)
    const container = await driver.Build()
    assert.equal(container.pluginInstance.constructor.name, 'SimpleRestContainer')

    await container.Start()
    const request = container.pluginInstance._buildRequest(msg)

    assert.isTrue(request.json)
    assert.isObject(request.headers)
    assert.isObject(request.body)
    assert.equal(request.headers.HEADER2, msg.token)
    assert.equal(request.body.BODY2, msg.messageText)

    await container.Clean()
  })
  it('should build JSON POST request body from strings', async function () {
    const myCaps = Object.assign({}, myCapsPost)
    myCaps[Capabilities.SIMPLEREST_BODY_TEMPLATE] = JSON.stringify(myCaps[Capabilities.SIMPLEREST_BODY_TEMPLATE])
    myCaps[Capabilities.SIMPLEREST_HEADERS_TEMPLATE] = JSON.stringify(myCaps[Capabilities.SIMPLEREST_HEADERS_TEMPLATE])

    const driver = new BotDriver(myCaps)
    const container = await driver.Build()
    assert.equal(container.pluginInstance.constructor.name, 'SimpleRestContainer')

    await container.Start()
    const request = container.pluginInstance._buildRequest(msg)

    assert.isTrue(request.json)
    assert.isObject(request.headers)
    assert.isObject(request.body)
    assert.equal(request.headers.HEADER2, msg.token)
    assert.equal(request.body.BODY2, msg.messageText)

    await container.Clean()
  })
  it('should build url-form-encoded POST request body', async function () {
    const myCaps = Object.assign({}, myCapsPost)
    myCaps[Capabilities.SIMPLEREST_BODY_RAW] = true
    myCaps[Capabilities.SIMPLEREST_HEADERS_TEMPLATE] = { 'Content-Type': 'application/x-www-form-urlencoded' }
    myCaps[Capabilities.SIMPLEREST_BODY_TEMPLATE] = 'BODY1=BODY1VALUE&BODY2={{msg.messageText}}'

    const driver = new BotDriver(myCaps)
    const container = await driver.Build()
    assert.equal(container.pluginInstance.constructor.name, 'SimpleRestContainer')

    await container.Start()
    const request = container.pluginInstance._buildRequest(msg)
    assert.isObject(request.headers)
    assert.isString(request.body)
    assert.equal(request.body, 'BODY1=BODY1VALUE&BODY2=messageText')

    await container.Clean()
  })
  it('should use scriptingMemory variables', async function () {
    const myCaps = Object.assign({}, myCapsScriptingMemory)
    const driver = new BotDriver(myCaps)
    const container = await driver.Build()

    await container.Start()
    const request = container.pluginInstance._buildRequest(msg)

    assert.isTrue(request.json)
    assert.exists(request.body)

    assert.exists(request.body.FUNCTION_WITHOUT_PARAM)
    assert.equal(request.body.FUNCTION_WITHOUT_PARAM.length, 4)

    assert.exists(request.body.FUNCTION_WITH_PARAM)
    assert.equal(request.body.FUNCTION_WITH_PARAM.length, 5)

    assert.exists(request.body.FUNCTION_WITH_PARAM_FROM_SCRIPTING_MEMORY)
    assert.equal(request.body.FUNCTION_WITH_PARAM_FROM_SCRIPTING_MEMORY.length, 7)

    assert.exists(request.body.USING_CODE)
    assert.equal(request.body.USING_CODE, 3)

    assert.exists(request.body.VARIABLE)
    assert.equal(request.body.VARIABLE, 'value')

    await container.Clean()
  })
})
