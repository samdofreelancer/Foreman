import { createServer, connect } from "node:net"

const [listenHost, listenPortText, targetHost, targetPortText] = process.argv.slice(2)
const listenPort = Number(listenPortText)
const targetPort = Number(targetPortText)

if (!listenHost || !targetHost || !Number.isInteger(listenPort) || !Number.isInteger(targetPort)
  || listenPort < 1 || listenPort > 65535 || targetPort < 1 || targetPort > 65535) {
  process.stderr.write("Usage: node tcp-proxy.mjs <listen-host> <listen-port> <target-host> <target-port>\n")
  process.exit(2)
}

const server = createServer((incoming) => {
  const outgoing = connect({ host: targetHost, port: targetPort })
  incoming.pipe(outgoing)
  outgoing.pipe(incoming)
  outgoing.on("error", () => {
    if (!incoming.destroyed) incoming.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
  })
  incoming.on("error", () => outgoing.destroy())
})

server.on("error", (error) => {
  process.stderr.write(`Foreman WSL proxy failed: ${error.message}\n`)
  process.exitCode = 1
})
server.listen(listenPort, listenHost, () => {
  process.stdout.write(`Foreman proxy listening on ${listenHost}:${listenPort} -> ${targetHost}:${targetPort}\n`)
})

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close())
