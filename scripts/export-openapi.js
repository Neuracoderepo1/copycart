import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROUTES } from '../src/routes.js';

/** Build the OpenAPI document from the same route table the server uses. */
export function buildOpenApi() {
  /** @type {Record<string, Record<string, unknown>>} */
  const paths = {};
  for (const r of ROUTES) {
    const params = [
      ...[...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
      ...(r.query ?? []).map((q) => ({
        name: q.name,
        in: 'query',
        required: false,
        description: q.description,
        schema: q.schema,
      })),
    ];
    (paths[r.path] ??= {})[r.method.toLowerCase()] = {
      operationId: r.operationId,
      summary: r.summary,
      ...(params.length ? { parameters: params } : {}),
      ...(r.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          }
        : {}),
      ...(r.auth === 'required' ? { security: [{ ApiKey: [] }] } : {}),
      responses: {
        [r.operationId === 'outboundRedirect'
          ? '302'
          : r.operationId === 'postEvent'
            ? '202'
            : '200']: { description: 'Success' },
        400: { description: 'Invalid request' },
        ...(r.auth === 'required' ? { 401: { description: 'Missing or invalid API key' } } : {}),
        429: { description: 'Rate limited' },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'CopyCart API',
      version: '0.2.0',
      description: 'Demo-data build. No live exchange data.',
    },
    components: {
      securitySchemes: { ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
    },
    paths,
  };
}

const out = fileURLToPath(new URL('../docs/openapi.json', import.meta.url));
mkdirSync(fileURLToPath(new URL('../docs/', import.meta.url)), { recursive: true });
writeFileSync(out, JSON.stringify(buildOpenApi(), null, 2) + '\n');
console.log(`Wrote ${out}`);
