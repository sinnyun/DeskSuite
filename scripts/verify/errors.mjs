#!/usr/bin/env node
// 用法：node scripts/verify/errors.mjs [--wait 4000] [--no-reload]
import { connectCdp, parseFlags } from './common.mjs'

const { flags } = parseFlags(process.argv.slice(2))
const wait = Number(flags.wait ?? 4000)
const reload = flags['no-reload'] !== true

const events = []
const cdp = await connectCdp({
  onEvent: (message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails
      events.push({
        type: 'exception',
        text: details.exception?.description || details.text
      })
    } else if (message.method === 'Log.entryAdded') {
      const entry = message.params.entry
      if (entry.level === 'error' || entry.level === 'warning') {
        // network 类错误只有 text（如 ERR_FILE_NOT_FOUND）时无法定位，附带 url 才能查缺哪个资源
        events.push({
          type: entry.level,
          source: entry.source,
          text: entry.text,
          ...(entry.url ? { url: entry.url } : {})
        })
      }
    } else if (message.method === 'Runtime.consoleAPICalled') {
      const type = message.params.type
      if (type === 'error' || type === 'warning') {
        events.push({
          type,
          text: message.params.args
            .map((arg) => arg.value ?? arg.description ?? '')
            .join(' ')
            .slice(0, 500)
        })
      }
    }
  }
})

try {
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  if (reload) {
    await cdp.send('Page.enable')
    await cdp.send('Page.reload', { ignoreCache: true })
  }
  await new Promise((resolve) => setTimeout(resolve, wait))
} finally {
  cdp.close()
}

console.log(JSON.stringify({ reload, wait, count: events.length, events }, null, 2))
const fatal = events.some((event) => event.type === 'error' || event.type === 'exception')
process.exit(fatal ? 1 : 0)
