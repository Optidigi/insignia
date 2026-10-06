import { createServer } from 'node:http';
if (process.argv[1]?.endsWith('element.test.mjs')) {
  const occupied = createServer((_req, res) => { res.writeHead(404); res.end(); });
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(45000, '127.0.0.1', resolve);
  });
  occupied.unref();
  Math.random = () => 0;
}
