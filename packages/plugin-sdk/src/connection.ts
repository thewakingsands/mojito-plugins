import { decodeHello } from './client.js'
import { pluginError } from './errors.js'
import { limitsSnapshot } from './limits.js'
import { type Envelope, validateEnvelope } from './messages.js'
import { messagePortTransport, RpcClient } from './transport.js'

/** Internal shared handshake for host-transferred ports; identity is pinned for the life of the port. */
export function connectPort(port: MessagePort): Promise<{ client: RpcClient; hello: Envelope }> {
  const transport = messagePortTransport(port)
  return new Promise((resolve, reject) => {
    let detach = () => {}
    const fail = (error: unknown) => {
      clearTimeout(timer)
      detach()
      transport.close()
      reject(error)
    }
    const timer = setTimeout(() => fail(pluginError('timeout', 'Host handshake timed out')), 10000)
    detach = transport.listen(
      (input) => {
        try {
          const message = input as Envelope
          validateEnvelope(message, message.activationId)
          decodeHello(message)
          detach()
          clearTimeout(timer)
          const client = new RpcClient(transport, message.activationId, limitsSnapshot(message.limits))
          resolve({ client, hello: message })
        } catch (error) {
          fail(error)
        }
      },
      () => fail(pluginError('plugin_stopped')),
    )
  })
}
