import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';

// glob patterns must use forward slashes even on Windows.
const here = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');

export function buildOpenApiSpec({ basePath }) {
  return swaggerJsdoc({
    definition: {
      openapi: '3.0.3',
      info: {
        title: 'microshort 2 — api',
        version: '0.1.0',
        description: 'System of record for users, API keys, short URLs and clicks. '
          + 'End users authenticate with a JWT (auth endpoints) or an API key (everything else). '
          + 'Endpoints under /internal are for the redirect service only.',
      },
      servers: [{ url: basePath || '/' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
          serviceToken: { type: 'apiKey', in: 'header', name: 'X-Service-Token' },
        },
      },
      tags: [
        { name: 'Auth' }, { name: 'URLs' }, { name: 'Admin' }, { name: 'Internal' }, { name: 'Ops' },
      ],
    },
    apis: [`${here}/routes/*.js`, `${here}/app.js`],
  });
}
