// Browser helpers for the existing OverlayPlugin callHandler interface.
;(() => {
  const listeners = new Map()
  let started = false
  const ready = new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!window.OverlayPluginApi?.ready) return
      clearInterval(timer)
      resolve()
    }, 10)
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true })
  })
  window.callOverlayHandler = async (request) => {
    await ready
    return new Promise((resolve) =>
      window.OverlayPluginApi.callHandler(JSON.stringify(request), (raw) => resolve(JSON.parse(raw))),
    )
  }
  window.__OverlayCallback = (event) => {
    for (const callback of listeners.get(event.type) ?? []) callback(event)
  }
  window.addOverlayListener = (event, callback) => {
    const callbacks = listeners.get(event) ?? new Set()
    callbacks.add(callback)
    listeners.set(event, callbacks)
    if (started) void window.callOverlayHandler({ call: 'subscribe', events: [event] })
  }
  window.removeOverlayListener = (event, callback) => {
    const callbacks = listeners.get(event)
    callbacks?.delete(callback)
    if (callbacks && !callbacks.size) {
      listeners.delete(event)
      if (started) void window.callOverlayHandler({ call: 'unsubscribe', events: [event] })
    }
  }
  window.startOverlayEvents = () => {
    if (started) return
    started = true
    void window.callOverlayHandler({ call: 'subscribe', events: [...listeners.keys()] })
  }
})()
