import { createServer } from 'node:http';

export function startHealthCheck(port: number, getStatus: () => object): void {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ...getStatus() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port);
}
