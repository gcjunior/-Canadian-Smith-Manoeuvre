import http from 'node:http';

export function startHealthServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/ready') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'not found' }));
  });
  server.listen(port, '0.0.0.0');
  return server;
}
