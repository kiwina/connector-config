const { createApp } = require('@kava-labs/ilp-connector')
const {
  convert,
  usd,
  xrp,
  xrpBase,
  connectCoinCap
} = require('@kava-labs/crypto-rate-utils')
const { parse, resolve } = require('path')
const chokidar = require('chokidar')

async function run() {
  const rateApi = await connectCoinCap()

  const outgoingChannelAmount = convert(usd(10), xrpBase(), rateApi).toString()
  const maxPacketAmount = convert(usd(0.2), xrpBase(), rateApi).toString()

  const config = {
    env: process.env.CONNECTOR_ENV,
    adminApi: true,
    adminApiPort: 7769,
    ilpAddress: process.env.ILP_ADDRESS,
    spread: 0,
    backend: '@kava-labs/ilp-backend-crypto',
    store: '@kava-labs/ilp-store-redis',
    storeConfig: {
      password: process.env.REDIS_PASS,
      prefix: 'connector',
      host: '127.0.0.1',
      port: 6379
    },
    accountProviders: {
      servers: {
        type: 'plugin'
      },
      xrp: {
        type: 'btp-server',
        options: {
          listener: {
            port: 7443
          },
          defaultAccountInfo: {
            plugin: 'ilp-plugin-xrp-paychan',
            relation: 'child',
            assetCode: 'XRP',
            assetScale: 9,
            // Options passed into the plugin itself
            options: {
              assetScale: 9,
              xrpServer: process.env.XRP_SERVER,
              secret: process.env.XRP_SECRET,
              channelAmount: outgoingChannelAmount
            },
            balance: {
              maximum: '0',
              settleTo: '0',
              settleThreshold: '0'
            },
            maxPacketAmount
          }
        }
      }
    },
    accounts: {}
  }

  const { listen, addPlugin, removePlugin } = createApp(config)

  // Start the connector
  await listen()

  // Setup a watcher for the file to hot swap the plugin if the config changes
  const paths = ['./servers/**/*.js']
  if (!process.env.ILP_ADDRESS.startsWith('local')) {
    paths.push('./peers/*.js')
  }
  const watcher = chokidar.watch(paths, {
    awaitWriteFinish: true
  })

  const add = async path => {
    const { name: accountId, ext } = parse(path)
    if (ext === '.js') {
      const createConfig = require(resolve(path))
      const accountConfig = createConfig(rateApi)

      await addPlugin(accountId, accountConfig)
    }
  }

  const remove = async path => {
    const { name: accountId } = parse(path)
    await removePlugin(accountId)
  }

  watcher.on('add', add)
  watcher.on('change', async path => {
    await remove(path)
    await add(path)
  })
  watcher.on('unlink', remove)
}

run()
