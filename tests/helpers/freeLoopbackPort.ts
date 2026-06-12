import net from 'node:net';

/**
 * Ask the OS for an ephemeral loopback port (bind to `127.0.0.1:0`, read
 * assigned port, release). Use this in v15 HTTP integration tests instead of
 * picking from overlapping fixed random bands — parallel suites otherwise
 * collide and produce false failures (e.g. transcribe 415 expected, 503 received).
 */
export async function freeLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}
